import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MANUAL_OUTCOMES,
  UNABLE_REASONS,
  UNABLE_REASON_TEXT,
  manualScreeningAdmissible,
  planManualScreening,
  type ManualOutcome,
} from "../../../supabase/functions/_shared/aml/manualScreening.pure.ts";

/**
 * Manual screening: the SECOND way of carrying out a screening the policy
 * already requires.
 *
 * The thing every test here exists to stop is one sentence long: a manual
 * "no match" is the claim that a customer is not on a sanctions list, it is
 * recorded as `clear` like any other screening, and it is the cheapest thing
 * in this product to record carelessly. So the evidence behind it is pinned
 * in three independent places — this module, the edge function, and a table
 * constraint — and these tests assert all three, because two of them agreeing
 * while the third is missing is exactly how a "screening" with nothing behind
 * it reaches a client file.
 *
 * The other half is the boundary the feature must never cross. Choosing to
 * screen by hand is a statement about METHOD. It is not an exemption, it does
 * not touch `required`, and no path in the implementation can spell one.
 */

const evidenced = (over: Record<string, unknown> = {}) => ({
  outcome: "no_match" as ManualOutcome,
  sources: [{ source_type: "sanctions_list", source_name: "DFAT Consolidated List" }],
  searchedNames: ["Pat Example"],
  rationale: "Searched the published consolidated list against the full legal name and "
    + "both recorded transliterations; no listing corresponds.",
  ...over,
});

const root = process.cwd();
const pureSource = readFileSync(
  join(root, "supabase/functions/_shared/aml/manualScreening.pure.ts"), "utf8");
const functionSource = readFileSync(
  join(root, "supabase/functions/aml-cases/index.ts"), "utf8");
const migrationSource = readFileSync(
  join(root, "supabase/migrations/20260921000000_aml_manual_screening.sql"), "utf8");
const dialogSource = readFileSync(
  join(root, "src/components/aml/ManualScreeningDialog.tsx"), "utf8");
const panelSource = readFileSync(
  join(root, "src/components/aml/PartyScreeningPanel.tsx"), "utf8");

/** Judge code, never comments — a rule this repo has been bitten by three times. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

const functionCode = stripComments(functionSource);
const migrationCode = stripComments(migrationSource);
const pureCode = stripComments(pureSource);

/* ── 1. The vocabulary is closed ──────────────────────────────────────── */

describe("manual screening — closed vocabularies", () => {
  it("recognises exactly four outcomes", () => {
    expect([...MANUAL_OUTCOMES]).toEqual(
      ["no_match", "possible_match", "confirmed_match", "unable_to_complete"]);
  });

  it("recognises exactly four reasons a screening could not be concluded", () => {
    expect([...UNABLE_REASONS]).toEqual([
      "insufficient_identity", "source_unavailable",
      "evidence_inconclusive", "other_documented_reason",
    ]);
  });

  it("explains every unable reason to the operator", () => {
    for (const reason of UNABLE_REASONS) {
      expect(UNABLE_REASON_TEXT[reason].length).toBeGreaterThan(20);
    }
  });

  it("refuses an outcome outside the vocabulary", () => {
    const plan = planManualScreening(evidenced({ outcome: "cleared" as ManualOutcome }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("unknown_outcome");
  });

  it("refuses a missing outcome rather than assuming one", () => {
    const plan = planManualScreening(evidenced({ outcome: undefined as never }));
    expect(plan.ok).toBe(false);
  });
});

/* ── 2. The evidence bar for a claim about the customer ───────────────── */

describe("manual screening — a conclusion about the customer must be evidenced", () => {
  it("accepts a fully evidenced no-match", () => {
    const plan = planManualScreening(evidenced());
    expect(plan.ok).toBe(true);
  });

  it("refuses a no-match with no source checked", () => {
    const plan = planManualScreening(evidenced({ sources: [] }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("sources_required");
  });

  it("refuses a source entry that names no source", () => {
    const plan = planManualScreening(evidenced({
      sources: [{ source_type: "sanctions_list", source_name: "   " }],
    }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("sources_required");
  });

  it("refuses a no-match with no name searched", () => {
    const plan = planManualScreening(evidenced({ searchedNames: [] }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("names_required");
  });

  it("refuses a blank name as a searched name", () => {
    const plan = planManualScreening(evidenced({ searchedNames: ["  ", ""] }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("names_required");
  });

  it("refuses a rationale too short to be one", () => {
    const plan = planManualScreening(evidenced({ rationale: "no hits" }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("rationale_required");
  });

  it("holds a possible match to the same evidence bar", () => {
    const plan = planManualScreening(evidenced({
      outcome: "possible_match", sources: [],
      candidates: [{ matchedName: "Patrik Exampel" }],
    }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("sources_required");
  });

  it("deduplicates and trims the names actually searched", () => {
    const plan = planManualScreening(evidenced({
      searchedNames: [" Pat Example ", "Pat Example", "P. Example"],
    }));
    expect(plan.ok && plan.normalisedNames).toEqual(["Pat Example", "P. Example"]);
  });

  it("normalises a source with no type to 'other' rather than dropping it", () => {
    const plan = planManualScreening(evidenced({
      sources: [{ source_type: "", source_name: "Public register" }],
    }));
    expect(plan.ok && plan.normalisedSources[0].source_type).toBe("other");
  });
});

/* ── 3. What each outcome MEANS downstream ────────────────────────────── */

describe("manual screening — mapping onto the canonical vocabulary", () => {
  it("records a no-match as a clear check that discharges the obligation", () => {
    const plan = planManualScreening(evidenced());
    expect(plan.ok && plan.checkStatus).toBe("clear");
    expect(plan.ok && plan.subjectState).toBe("completed");
    expect(plan.ok && plan.satisfiesObligation).toBe(true);
  });

  it("records a possible match as a matched check with an OPEN candidate", () => {
    const plan = planManualScreening(evidenced({
      outcome: "possible_match", candidates: [{ matchedName: "Patrik Exampel" }],
    }));
    expect(plan.ok && plan.checkStatus).toBe("matched");
    expect(plan.ok && plan.subjectState).toBe("possible_match");
    expect(plan.ok && plan.candidateStatus).toBe("open");
  });

  it("records a confirmed match as a confirmed candidate", () => {
    const plan = planManualScreening(evidenced({
      outcome: "confirmed_match", candidates: [{ matchedName: "Patrik Exampel" }],
    }));
    expect(plan.ok && plan.subjectState).toBe("confirmed_match");
    expect(plan.ok && plan.candidateStatus).toBe("confirmed");
  });

  it("does NOT treat a finding as a discharged obligation", () => {
    for (const outcome of ["possible_match", "confirmed_match"] as const) {
      const plan = planManualScreening(evidenced({
        outcome, candidates: [{ matchedName: "Patrik Exampel" }],
      }));
      expect(plan.ok && plan.satisfiesObligation).toBe(false);
    }
  });

  it("refuses a match that names nothing that matched", () => {
    const plan = planManualScreening(evidenced({ outcome: "possible_match", candidates: [] }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("candidate_required");
  });

  it("only 'no match' ever satisfies the obligation", () => {
    const satisfying = MANUAL_OUTCOMES.filter((outcome) => {
      const plan = planManualScreening(evidenced({
        outcome, candidates: [{ matchedName: "Patrik Exampel" }],
        unableReason: "source_unavailable",
      }));
      return plan.ok && plan.satisfiesObligation;
    });
    expect(satisfying).toEqual(["no_match"]);
  });
});

/* ── 4. 'Unable to complete' is the honest failure state ──────────────── */

describe("manual screening — unable to complete", () => {
  it("is accepted without sources, names or a rationale", () => {
    const plan = planManualScreening({
      outcome: "unable_to_complete", sources: [], searchedNames: [], rationale: "",
      unableReason: "source_unavailable",
    });
    expect(plan.ok).toBe(true);
  });

  it("still requires a reason code", () => {
    const plan = planManualScreening({
      outcome: "unable_to_complete", sources: [], searchedNames: [], rationale: "",
    });
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("unable_reason_required");
  });

  it("refuses a reason outside the fixed list", () => {
    const plan = planManualScreening({
      outcome: "unable_to_complete", sources: [], searchedNames: [], rationale: "",
      unableReason: "too_busy" as never,
    });
    expect(plan.ok).toBe(false);
  });

  it("satisfies nothing and leaves the party outstanding", () => {
    const plan = planManualScreening({
      outcome: "unable_to_complete", sources: [], searchedNames: [], rationale: "",
      unableReason: "insufficient_identity",
    });
    expect(plan.ok && plan.satisfiesObligation).toBe(false);
    expect(plan.ok && plan.subjectState).toBe("error");
    expect(plan.ok && plan.checkStatus).toBe("failed");
  });

  it("normalises and caps the candidates rather than passing the request through", () => {
    const plan = planManualScreening(evidenced({
      outcome: "possible_match",
      candidates: [
        { matchedName: "  Patrik Exampel  ", listName: " DFAT ", extra: "ignored" } as never,
        { matchedName: "   " },
      ],
    }));
    expect(plan.ok && plan.normalisedCandidates).toEqual([{
      matchedName: "Patrik Exampel", listName: "DFAT",
      reference: null, matchBasis: null, jurisdiction: null, notes: null,
    }]);
  });

  it("a candidate cannot introduce a key the module does not name", () => {
    const plan = planManualScreening(evidenced({
      outcome: "possible_match",
      candidates: [{ matchedName: "Patrik Exampel", status: "confirmed" } as never],
    }));
    expect(plan.ok && Object.keys(plan.normalisedCandidates[0])).toEqual(
      ["matchedName", "listName", "reference", "matchBasis", "jurisdiction", "notes"]);
  });

  it("never produces a candidate", () => {
    const plan = planManualScreening({
      outcome: "unable_to_complete", sources: [], searchedNames: [], rationale: "",
      unableReason: "evidence_inconclusive",
      candidates: [{ matchedName: "Patrik Exampel" }],
    });
    expect(plan.ok && plan.candidateStatus).toBeNull();
  });
});

/* ── 5. When a manual attempt may be recorded at all ──────────────────── */

describe("manual screening — admissibility mirrors the automated path", () => {
  it("admits a party nothing has screened yet", () => {
    expect(manualScreeningAdmissible({ state: "not_started" }).ok).toBe(true);
  });

  it("admits a re-screen of a completed party", () => {
    expect(manualScreeningAdmissible({ state: "completed" }).ok).toBe(true);
  });

  it("admits a party whose automated attempt errored", () => {
    expect(manualScreeningAdmissible({ state: "error" }).ok).toBe(true);
  });

  it("refuses to overwrite an automated run already in flight", () => {
    for (const state of ["queued", "processing"]) {
      const verdict = manualScreeningAdmissible({ state });
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.code).toBe("already_in_progress");
    }
  });

  it("refuses to screen over an unadjudicated finding", () => {
    for (const state of ["possible_match", "confirmed_match"]) {
      const verdict = manualScreeningAdmissible({ state });
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.code).toBe("adjudication_required");
    }
  });
});

/* ── 6. The boundary: a METHOD, never an exemption ────────────────────── */

describe("manual screening — never an exemption", () => {
  it("produces no field that could stand a scope down", () => {
    const plan = planManualScreening(evidenced());
    expect(plan.ok).toBe(true);
    expect(Object.keys(plan as object)).not.toContain("required");
    expect(JSON.stringify(plan)).not.toContain("not_required");
  });

  it("the pure module never mentions not_required at all", () => {
    expect(pureCode).not.toMatch(/not_required/);
  });

  it("the edge function's manual op never writes `required` on the subject", () => {
    const op = functionCode.split("case 'record_manual_screening'")[1]
      ?.split("case 'queue_party_screening'")[0] ?? "";
    // `policy_required:` is the RECORD of what policy already decided and is
    // allowed. A bare `required:` would be this op deciding it, and is not.
    expect(op).not.toMatch(/(?<![_a-z])required:/);
    expect(op).not.toMatch(/scope_required/);
    expect(op).not.toMatch(/required = /);
  });

  it("the edge function's manual op never writes to the scope decision table", () => {
    const op = functionCode.split("case 'record_manual_screening'")[1]
      ?.split("case 'queue_party_screening'")[0] ?? "";
    expect(op).not.toMatch(/case_screening_scopes'\)\s*\n?\s*\.(insert|update|upsert)/);
    expect(op).not.toMatch(/case_screening_perimeter/);
  });

  it("reads whether policy required the screening rather than accepting it", () => {
    const op = functionCode.split("case 'record_manual_screening'")[1]
      ?.split("case 'queue_party_screening'")[0] ?? "";
    expect(op).toMatch(/case_screening_scopes/);
    expect(op).toMatch(/const policyRequired = scopeRow \? scopeRow\.required === true : true/);
    expect(op).not.toMatch(/body\.policy_required/);
    expect(op).not.toMatch(/body\.voluntary/);
  });
});

/* ── 7. What the client cannot forge ──────────────────────────────────── */

describe("manual screening — the browser cannot supply the facts that matter", () => {
  const op = functionCode.split("case 'record_manual_screening'")[1]
    ?.split("case 'queue_party_screening'")[0] ?? "";

  it("is refused outright unless the caller holds the MLRO role", () => {
    expect(op).toMatch(/if \(!roles\.has\('mlro'\)\)/);
    expect(op).toMatch(/403/);
  });

  it("takes the performer from the session, never the request", () => {
    expect(op).toMatch(/performed_by: userId/);
    expect(op).not.toMatch(/body\.performed_by/);
  });

  it("stamps the time on the server", () => {
    expect(op).toMatch(/performed_at: nowIso/);
    expect(op).not.toMatch(/body\.performed_at/);
  });

  it("takes the case from the SUBJECT, never from a body-supplied case id", () => {
    expect(op).toMatch(/const caseId = String\(subject\.case_id\)/);
    expect(op).not.toMatch(/body\.case_id/);
  });

  it("checks the subject and the case belong to the same tenant", () => {
    expect(op).toMatch(/tenant_mismatch/);
  });

  it("re-runs the whole plan server-side rather than trusting a browser verdict", () => {
    expect(op).toMatch(/planManualScreening\(/);
    expect(op).toMatch(/if \(!plan\.ok\) return jsonResponse/);
    expect(op).not.toMatch(/body\.check_status/);
    expect(op).not.toMatch(/body\.satisfies/);
  });

  it("refuses a scope it does not support instead of coercing it to sanctions", () => {
    expect(op).toMatch(/unsupported_scope/);
  });
});

/* ── 8. What the record actually says ─────────────────────────────────── */

describe("manual screening — the record is honest about what produced it", () => {
  const op = functionCode.split("case 'record_manual_screening'")[1]
    ?.split("case 'queue_party_screening'")[0] ?? "";

  it("names the provider as manual rather than borrowing a real one", () => {
    expect(op).toMatch(/provider: 'manual_mlro'/);
  });

  it("keeps execution_mode meaning live-vs-simulator", () => {
    // Overloading it would make every manual check read as a simulation,
    // which `aml-cases` treats as non-authoritative.
    expect(op).toMatch(/execution_mode: 'live'/);
    expect(op).not.toMatch(/execution_mode: 'manual'/);
  });

  it("marks the method on its own axis", () => {
    expect(op).toMatch(/screening_method: 'manual'/);
  });

  it("writes candidates to the CANONICAL match table so adjudication is shared", () => {
    expect(op).toMatch(/from\('screening_matches'\)/);
  });

  it("builds the match rows from the plan, never from the request body", () => {
    // A `.map` over `body.candidates` is opaque to the mass-assignment gate
    // and lets a submitted key reach a column nobody named.
    expect(op).toMatch(/plan\.normalisedCandidates\.map/);
    expect(op).not.toMatch(/body\.candidates as any\[\]/);
  });

  it("advances the freshness clock only when the obligation is discharged", () => {
    expect(op).toMatch(/if \(plan\.satisfiesObligation\) \{[\s\S]*?last_screened_at = nowIso/);
  });

  it("ages a manual result on the same interval an automated one ages on", () => {
    expect(op).toMatch(/computeRefreshDueAt\(nowIso, await rescreenIntervalDays\(admin\)\)/);
    expect(functionCode).toMatch(/trigger_kind', 'rescreen_due'/);
  });

  it("appends a case event naming the method, the sources and the outcome", () => {
    expect(op).toMatch(/manual_screening_recorded/);
    expect(op).toMatch(/sources:/);
    expect(op).toMatch(/names_searched:/);
  });
});

/* ── 9. The database enforces the same rule independently ─────────────── */

describe("manual screening — the table refuses what the code refuses", () => {
  it("adds the method as a new column rather than overloading execution_mode", () => {
    expect(migrationCode).toMatch(/ADD COLUMN IF NOT EXISTS screening_method text/);
    expect(migrationCode).not.toMatch(/execution_mode.*manual/);
  });

  it("constrains the method to automated or manual", () => {
    expect(migrationCode).toMatch(/CHECK \(screening_method IN \('automated', 'manual'\)\)/);
  });

  it("defaults every historical row to automated", () => {
    expect(migrationCode).toMatch(/screening_method text NOT NULL DEFAULT 'automated'/);
  });

  it("requires a manual check to name who performed it and when", () => {
    expect(migrationCode).toMatch(/screening_checks_manual_actor/);
    expect(migrationCode).toMatch(/performed_by IS NOT NULL AND performed_at IS NOT NULL/);
  });

  it("requires a manual conclusion about the customer to carry its evidence", () => {
    const clause = migrationCode.split("screening_checks_manual_evidence")[1] ?? "";
    expect(clause).toMatch(/jsonb_array_length\(sources_checked\) >= 1/);
    expect(clause).toMatch(/jsonb_array_length\(searched_names\) >= 1/);
    expect(clause).toMatch(/length\(btrim\(rationale\)\) >= 20/);
  });

  it("exempts only unable_to_complete from that bar, and makes it say why", () => {
    const clause = migrationCode.split("screening_checks_manual_evidence")[1] ?? "";
    expect(clause).toMatch(/manual_outcome = 'unable_to_complete'/);
    expect(migrationCode).toMatch(/screening_checks_unable_reason_required/);
  });

  it("uses the same rationale minimum the pure module uses", () => {
    const min = Number(/RATIONALE_MIN = (\d+)/.exec(pureCode)?.[1]);
    expect(min).toBe(20);
    expect(migrationCode).toContain(`length(btrim(rationale)) >= ${min}`);
  });

  it("constrains the outcome vocabulary to the module's four values", () => {
    for (const outcome of MANUAL_OUTCOMES) expect(migrationCode).toContain(`'${outcome}'`);
  });

  it("constrains the unable-reason vocabulary to the module's four values", () => {
    for (const reason of UNABLE_REASONS) expect(migrationCode).toContain(`'${reason}'`);
  });

  it("is additive and idempotent, so it cannot rewrite a historical check", () => {
    expect(migrationCode).not.toMatch(/\bUPDATE aml\.screening_checks\b/);
    expect(migrationCode).not.toMatch(/\bDROP COLUMN\b/);
    for (const stmt of migrationCode.match(/ADD COLUMN[^,;]*/g) ?? []) {
      expect(stmt).toContain("IF NOT EXISTS");
    }
  });

  it("records a retention schedule for the manual record", () => {
    expect(migrationCode).toMatch(/manual_screening_check/);
  });
});

/* ── 10. One rule, one implementation ─────────────────────────────────── */

describe("manual screening — the browser and the server share one rule", () => {
  it("the dialog decides with the SAME module the edge function decides with", () => {
    expect(dialogSource).toMatch(
      /from "\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/aml\/manualScreening\.pure"/);
    expect(dialogSource).toMatch(/planManualScreening\(/);
  });

  it("the dialog never re-implements the evidence bar itself", () => {
    // A second copy of "at least one source" is how the two come to disagree.
    expect(stripComments(dialogSource)).not.toMatch(/length\s*[<>]=?\s*20/);
  });

  it("shows the server's own refusal message rather than inventing one", () => {
    expect(dialogSource).toMatch(/\{plan\.message\}/);
  });

  it("offers the control only to the MLRO, and says the server checks too", () => {
    expect(panelSource).toMatch(/\{isMlro && /);
    expect(panelSource).toMatch(/edge\s*\n?\s*\*\s*function checks the role itself/);
  });

  it("never offers manual screening for a scope that is not required", () => {
    const guard = /\{isMlro && \[([^\]]*)\]\.includes\(s\.state\)/.exec(panelSource)?.[1] ?? "";
    expect(guard).not.toContain("not_required");
    expect(guard).not.toContain("queued");
    expect(guard).not.toContain("processing");
  });

  it("says on the page how the current position was reached", () => {
    expect(panelSource).toMatch(/screened manually by the MLRO/);
  });
});
