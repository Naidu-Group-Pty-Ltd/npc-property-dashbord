import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_SCREENING_SCOPES,
  decideScreeningPolicy,
  deriveScreeningScope,
  PERIMETER_REASON_CODES,
  providerReadinessRelevant,
  readPerimeter,
  reconcileSubjectToScope,
  requiredScopes,
  SCREENING_POLICY_VERSION,
} from "../../../supabase/functions/_shared/aml/screeningPolicy.pure.ts";
import {
  isPartyScreeningMissing,
  partyScreeningOutstanding,
} from "../../../supabase/functions/_shared/aml/partyScreening.pure.ts";
import { deriveAmlScreeningScope } from "./screeningScope";

/**
 * Sanctions screening stops being universally mandatory — and the ONE basis
 * on which it may be stood down.
 *
 * Targeted financial sanctions bind every dealing under the Charter of the
 * United Nations Act 1945 and the Autonomous Sanctions Act 2011. They are
 * not risk-based, so no rating, profile or questionnaire answer reduces
 * them. What can be true is that a case is not a dealing at all — an enquiry
 * that never became an engagement, an administrative duplicate, a service
 * declined before it commenced.
 *
 * Everything below is about that distinction holding under pressure: that
 * the perimeter is the only lever, that it fails closed, that `not_required`
 * never becomes "clear", and that a case nobody had to screen is not held up
 * by a provider it does not use.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const casesFn = read("supabase/functions/aml-cases/index.ts");
const policyFn = read("supabase/functions/_shared/aml/screeningPolicy.pure.ts");
const migration = read(
  "supabase/migrations/20260920000000_aml_screening_scope_perimeter.sql");

/** A case that is plainly inside the perimeter, answers complete, low risk. */
const CLEAN_INPUT = {
  answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
  entityType: "individual",
  riskRating: "low",
  enhancedDueDiligence: false,
  anyPepFinding: false,
} as const;

/** The stored perimeter row for a case that is outside it, sanctions only. */
const OUTSIDE = {
  classification: "outside_perimeter",
  reason_code: "enquiry_only",
  scopes_excluded: ["sanctions"],
  recorded_by_label: "mlro@npcservices.com.au",
  recorded_at: "2026-08-18T00:00:00.000Z",
  superseded_at: null,
};

describe("1-2. an eligible case has sanctions not_required", () => {
  it("marks sanctions not required, with a reason code and a reason", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.sanctions.required).toBe(false);
    expect(d.sanctions.optional).toBe(true);
    expect(d.sanctions.reasonCode).toBe("perimeter:enquiry_only");
    expect(d.sanctions.reason).toMatch(/never entered into/i);
    expect(requiredScopes(d)).not.toContain("sanctions");
  });

  it("says plainly that nobody was screened", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.sanctions.reason).toMatch(/not a screening result/i);
    expect(d.sanctions.reason).toMatch(/nobody has been cleared/i);
  });
});

describe("19. a case inside the perimeter keeps sanctions mandatory", () => {
  it("requires sanctions with no perimeter row at all", () => {
    const d = deriveScreeningScope(CLEAN_INPUT);
    expect(d.sanctions.required).toBe(true);
    expect(d.sanctions.optional).toBe(false);
    expect(d.sanctions.reasonCode).toBe("tfs_obligation");
  });

  it("cannot be stood down by ANY risk or profile input", () => {
    // The whole input space, without a perimeter finding. Sanctions survives
    // every combination, because it does not answer to risk.
    for (const riskRating of ["low", "medium", "high", "prohibited", null]) {
      for (const entityType of ["individual", "company", "trust", null]) {
        for (const edd of [true, false]) {
          for (const pep of ["yes", "no", null] as const) {
            const d = deriveScreeningScope({
              answers: { pep, adverse: "no", thirdParty: "no", overseasFunding: "no" },
              entityType, riskRating, enhancedDueDiligence: edd, anyPepFinding: false,
            });
            expect(d.sanctions.required).toBe(true);
          }
        }
      }
    }
  });
});

describe("the perimeter fails closed", () => {
  it.each([
    ["no row", null],
    ["undefined", undefined],
    ["a string", "outside_perimeter"],
    ["classification missing", { reason_code: "enquiry_only", scopes_excluded: ["sanctions"] }],
    ["an unknown reason code", { ...OUTSIDE, reason_code: "low_risk" }],
    ["no reason code", { ...OUTSIDE, reason_code: null }],
    ["excluding nothing", { ...OUTSIDE, scopes_excluded: [] }],
    ["excluding an unknown scope", { ...OUTSIDE, scopes_excluded: ["everything"] }],
    ["superseded", { ...OUTSIDE, superseded_at: "2026-08-18T01:00:00.000Z" }],
  ])("keeps sanctions required when the perimeter is %s", (_label, perimeter) => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter });
    expect(d.sanctions.required).toBe(true);
    expect(readPerimeter(perimeter).classification).toBe("designated_service");
  });

  it("offers no reason code that is about risk", () => {
    // "low risk" as a sanctions exemption is the one basis an auditor would
    // reject, so it must not be expressible.
    for (const code of PERIMETER_REASON_CODES) {
      expect(code).not.toMatch(/risk|low|rating|score/i);
    }
  });
});

describe("22-23. the scopes are decided independently", () => {
  it("stands sanctions down while PEP stays mandatory", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.sanctions.required).toBe(false);
    expect(d.pep.required).toBe(true);
    expect(requiredScopes(d)).toContain("pep");
  });

  it("stands PEP down while sanctions stays mandatory", () => {
    const d = deriveScreeningScope({
      ...CLEAN_INPUT,
      perimeter: { ...OUTSIDE, scopes_excluded: ["pep"] },
    });
    expect(d.pep.required).toBe(false);
    expect(d.sanctions.required).toBe(true);
  });

  it("keeps adverse media and watchlist on their own risk rule", () => {
    // Untouched by a sanctions-only perimeter finding: they are stood down
    // here by the risk rule, and that is a different reason code.
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.adverse_media.required).toBe(false);
    expect(d.adverse_media.reasonCode).toBe("risk_not_triggered");
    expect(d.watchlist.reasonCode).toBe("risk_not_triggered");

    // ...and a triggered case keeps them even with the perimeter finding.
    const triggered = deriveScreeningScope({
      ...CLEAN_INPUT, riskRating: "high", perimeter: OUTSIDE,
    });
    expect(triggered.sanctions.required).toBe(false);
    expect(triggered.adverse_media.required).toBe(true);
    expect(triggered.adverse_media.reasonCode).toBe("risk_triggered");
  });

  it("every scope carries its own reason code", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    for (const k of ALL_SCREENING_SCOPES) {
      expect(d[k].reasonCode).toBeTruthy();
      expect(d[k].reason).toBeTruthy();
      expect(d[k].scope).toBe(k);
    }
  });
});

describe("5-6, 24. provider readiness is scope-aware", () => {
  it("is irrelevant when nothing required needs the provider", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    // sanctions not required, adverse media and watchlist not triggered.
    expect(providerReadinessRelevant(d)).toBe(false);
  });

  it("is relevant the moment a scope that uses it is required", () => {
    expect(providerReadinessRelevant(deriveScreeningScope(CLEAN_INPUT))).toBe(true);
    const triggered = deriveScreeningScope({
      ...CLEAN_INPUT, riskRating: "high", perimeter: OUTSIDE,
    });
    expect(providerReadinessRelevant(triggered)).toBe(true);
  });

  it("is relevant for a voluntary run, and only for that run", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(providerReadinessRelevant(d, { voluntaryRunRequested: true })).toBe(true);
    expect(providerReadinessRelevant(d)).toBe(false);
  });
});

describe("28-29. the gates ignore a scope nobody required", () => {
  const now = "2026-08-18T00:00:00.000Z";

  it("partyScreeningOutstanding returns nothing for a not_required subject", () => {
    expect(partyScreeningOutstanding(
      { required: false, state: "not_required" }, now)).toBeNull();
    expect(isPartyScreeningMissing(
      { required: false, state: "not_required" }, now)).toBe(false);
  });

  it("still reports a required subject that has not been screened", () => {
    expect(partyScreeningOutstanding(
      { required: true, state: "not_started" }, now)).toBe("incomplete");
    expect(isPartyScreeningMissing(
      { required: true, state: "not_started" }, now)).toBe(true);
  });

  it("still reports a technical error, which is never a clear result", () => {
    expect(partyScreeningOutstanding(
      { required: true, state: "error" }, now)).toBe("incomplete");
  });
});

describe("10, 30. not_required is never rendered as clear", () => {
  const serverScopes = [
    { scope: "sanctions", required: false, optional: true, state: "not_required",
      reason_code: "perimeter:enquiry_only",
      reason: "This record exists for an enquiry or quotation only." },
    { scope: "pep", required: true, optional: false, state: "required",
      reason_code: "pep_determination_required", reason: "A determination must be established." },
  ] as const;

  it("marks the reading notRequired, distinct from resolved", () => {
    const view = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, serverScopes as never);
    const sanctions = view.determinations.find((d) => d.scope === "sanctions")!;
    expect(sanctions.required).toBe(false);
    expect(sanctions.notRequired).toBe(true);
    // Satisfied for the stage...
    expect(sanctions.resolved).toBe(true);
    // ...and never described as a screening outcome.
    expect(sanctions.detail).toMatch(/not required/i);
    expect(sanctions.detail).not.toMatch(/\bclear\b/i);
    expect(sanctions.detail).not.toMatch(/no match/i);
    expect(sanctions.detail).not.toMatch(/screened and/i);
  });

  it("does not list a not-required scope as outstanding", () => {
    const view = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, serverScopes as never);
    expect(view.outstanding.join(" ")).not.toMatch(/sanction/i);
  });

  it("keeps PEP outstanding on the very same case", () => {
    const view = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, serverScopes as never);
    expect(view.outstanding.join(" ")).toMatch(/PEP determination/i);
    expect(view.canAdvance).toBe(false);
  });

  it("11. advances once the other required scopes resolve", () => {
    const view = deriveAmlScreeningScope({
      answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
      entityType: "individual",
      sanctionsState: "not_started",
      pepDetermination: {
        result: "not_pep", determinedAt: "2026-08-01T00:00:00.000Z",
        reviewDueAt: "2027-08-01T00:00:00.000Z", supersededAt: null,
      },
      now: "2026-08-18T00:00:00.000Z",
    }, null, serverScopes as never);
    expect(view.outstanding).toEqual([]);
    expect(view.canAdvance).toBe(true);
  });

  it("without a server decision, every scope is still required", () => {
    // An older server sends no scopes. The browser must not read silence as
    // an exemption.
    const view = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, null);
    const sanctions = view.determinations.find((d) => d.scope === "sanctions")!;
    expect(sanctions.required).toBe(true);
    expect(sanctions.notRequired).toBeFalsy();
  });
});

describe("18. the client cannot manufacture an exemption", () => {
  it("the scope engine reads no `required` field from its input", () => {
    // Anything a caller claims about `required` is ignored because nothing
    // reads it: the decision comes from the perimeter row and the risk rule.
    const forged = deriveScreeningScope({
      ...CLEAN_INPUT,
      // @ts-expect-error — deliberately forging a field the type has no place for
      sanctions: { required: false }, required: ["pep"], scopes: { sanctions: false },
    });
    expect(forged.sanctions.required).toBe(true);
  });

  it("a perimeter row invented in the request body still needs a valid shape", () => {
    const forged = deriveScreeningScope({
      ...CLEAN_INPUT,
      perimeter: { classification: "outside_perimeter", reason_code: "because_i_said" },
    });
    expect(forged.sanctions.required).toBe(true);
  });

  it("the operation takes a classification and reason code, never a required flag", () => {
    const op = casesFn.slice(
      casesFn.indexOf("case 'classify_screening_perimeter'"),
      casesFn.indexOf("case 'run_optional_screening'"));
    expect(op).toMatch(/body\.classification/);
    expect(op).toMatch(/body\.reason_code/);
    expect(op).not.toMatch(/body\.required/);
    expect(op).not.toMatch(/body\.state/);
  });
});

describe("17. only the right roles may act", () => {
  const classify = casesFn.slice(
    casesFn.indexOf("case 'classify_screening_perimeter'"),
    casesFn.indexOf("case 'run_optional_screening'"));
  const optional = casesFn.slice(
    casesFn.indexOf("case 'run_optional_screening'"),
    casesFn.indexOf("case 'queue_party_screening'"));

  it("classifying the perimeter needs reviewer or MLRO, not merely write", () => {
    // canWrite includes analysts. Standing down a sanctions obligation is a
    // compliance act, not data entry.
    expect(classify).toMatch(/roles\.has\('reviewer'\)/);
    expect(classify).toMatch(/roles\.has\('mlro'\)/);
    expect(classify).toMatch(/insufficient_role/);
  });

  it("running an optional screening needs a write role", () => {
    expect(optional).toMatch(/if \(!canWrite\) return jsonResponse/);
  });
});

describe("12-16. the optional run", () => {
  const optional = casesFn.slice(
    casesFn.indexOf("case 'run_optional_screening'"),
    casesFn.indexOf("case 'queue_party_screening'"));

  it("13. uses the normal provider pipeline", () => {
    expect(optional).toMatch(/runScreeningInline\(admin, subjectId\)/);
  });

  it("refuses to run against a scope that is actually required", () => {
    expect(optional).toMatch(/scopeRow\.required === true/);
    expect(optional).toMatch(/scope_is_required/);
  });

  it("15. never rewrites the policy decision", () => {
    // `required` is reported false whatever the run produces, and the
    // operation writes nothing to case_screening_scopes.
    expect(optional).toMatch(/scope_required: false/);
    expect(optional).not.toMatch(/from\('case_screening_scopes'\)[\s\S]{0,80}(update|insert)/);
  });

  it("14. persists a real check, marked voluntary and attributed", () => {
    expect(optional).toMatch(/voluntary: true/);
    expect(optional).toMatch(/policy_required: false/);
    expect(optional).toMatch(/scope_decision_id/);
    expect(optional).toMatch(/requested_by: userId/);
  });

  it("records who asked BEFORE the run, so no check can exist without it", () => {
    const stamp = optional.indexOf("voluntary_run_at: nowIso");
    const run = optional.indexOf("runScreeningInline");
    expect(stamp).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(run);
  });

  it("16. an unavailable provider refuses the run and blocks nothing", () => {
    expect(optional).toMatch(/provider_unavailable_for_optional_run/);
    expect(optional).toMatch(/nothing is blocked/i);
    // 200, not an error: the case is not in a bad state.
    expect(optional).toMatch(/scope_required: false,\s*\n\s*subject,\s*\n\s*\}, 200\)/);
    // and it must not mark the subject failed.
    const refusal = optional.slice(optional.indexOf("if (!optReady)"), optional.indexOf("const nowIso"));
    expect(refusal).not.toMatch(/error_category/);
    expect(refusal).not.toMatch(/state: 'error'/);
  });
});

describe("3. an exempt case queues no screening work automatically", () => {
  it("auto-execution requires the sanctions scope", () => {
    expect(casesFn).toContain(
      "const providerReadyForAuto = providerReady && scope.sanctions.required;");
  });

  it("the stalled-subject converger does not fire for an exempt scope", () => {
    expect(casesFn).toContain(
      "if (canWrite && scope.sanctions.required && !providerReadyForAuto)");
  });
});

describe("25, 3-4. reconciling a subject with the scope, behaviourally", () => {
  const sub = (state: string, extra: Record<string, unknown> = {}) =>
    ({ state, required: true, ...extra });

  it("a possible match stays required when sanctions is stood down", () => {
    const r = reconcileSubjectToScope(sub("possible_match"), false);
    expect(r.action).toBe("keep_finding");
    expect(r.patch).toBeNull();
  });

  it("a confirmed match stays required too", () => {
    expect(reconcileSubjectToScope(sub("confirmed_match"), false).action)
      .toBe("keep_finding");
  });

  it("a completed check keeps its state and loses only the obligation", () => {
    const r = reconcileSubjectToScope(sub("completed"), false);
    expect(r.action).toBe("release");
    expect(r.patch).toEqual({ required: false });
    expect(r.patch).not.toHaveProperty("state");
    expect(r.retireQueued).toBe(false);
  });

  it("a false positive is treated the same way", () => {
    expect(reconcileSubjectToScope(sub("false_positive"), false).patch)
      .toEqual({ required: false });
  });

  it("an unscreened subject becomes not_required and its queue is retired", () => {
    const r = reconcileSubjectToScope(sub("not_started"), false);
    expect(r.action).toBe("release");
    expect(r.patch).toEqual({
      required: false, state: "not_required", error_category: null,
    });
    expect(r.retireQueued).toBe(true);
  });

  it("an errored subject is released rather than left showing a fault", () => {
    const r = reconcileSubjectToScope(sub("error"), false);
    expect(r.patch?.state).toBe("not_required");
    expect(r.patch?.error_category).toBeNull();
    expect(r.retireQueued).toBe(true);
  });

  it("a stale queued request is retired — no job survives the exemption", () => {
    const r = reconcileSubjectToScope(sub("queued"), false);
    expect(r.retireQueued).toBe(true);
    expect(r.patch?.state).toBe("not_required");
  });

  it("an in-flight VOLUNTARY run is left alone", () => {
    for (const state of ["queued", "processing"]) {
      const r = reconcileSubjectToScope(
        sub(state, { required: false, voluntaryRunAt: "2026-08-18T00:00:00Z" }), false);
      expect(r.action).toBe("keep_in_flight");
      expect(r.patch).toBeNull();
      expect(r.retireQueued).toBe(false);
    }
  });

  it("is idempotent — a settled subject is not rewritten on every read", () => {
    const r = reconcileSubjectToScope(
      { state: "not_required", required: false }, false);
    expect(r.action).toBe("none");
    expect(r.patch).toBeNull();
  });

  it("withdrawing the exemption restores unscreened, never a result", () => {
    const r = reconcileSubjectToScope(
      { state: "not_required", required: false }, true);
    expect(r.action).toBe("restore");
    expect(r.patch).toEqual({ required: true, state: "not_started" });
  });

  it("withdrawing it does not disturb a subject that already has evidence", () => {
    const r = reconcileSubjectToScope(
      { state: "completed", required: false }, true);
    expect(r.patch).toEqual({ required: true, state: "completed" });
  });

  it("no reconciliation ever writes a satisfied screening state", () => {
    // The one thing that would turn "not required" into "screened and clear".
    for (const state of [
      "not_started", "queued", "processing", "error", "completed",
      "false_positive", "possible_match", "confirmed_match", "not_required",
    ]) {
      for (const required of [true, false]) {
        const r = reconcileSubjectToScope({ state, required: true }, required);
        if (r.patch?.state) {
          expect(["not_required", "not_started", state]).toContain(r.patch.state);
          expect(r.patch.state).not.toBe("completed");
        }
      }
    }
  });
});

describe("25b. the applier does what the decision says, and nothing else", () => {
  const helper = casesFn.slice(
    casesFn.indexOf("async function syncScreeningScopeDecision"),
    casesFn.indexOf("async function ensureScreeningSubjects"));

  it("delegates the decision to the pure module", () => {
    expect(helper).toMatch(/reconcileSubjectToScope\(/);
  });

  it("retires the queue before writing the stand-down, scoped to the subject", () => {
    expect(helper).toMatch(/superseded_by_scope_decision/);
    expect(helper).toMatch(/\.eq\('aggregate_id', s\.id\)/);
    const retire = helper.indexOf("superseded_by_scope_decision");
    const write = helper.indexOf("from('party_screening_subjects')\n      .update({ ...decision.patch");
    expect(retire).toBeGreaterThan(-1);
    expect(retire).toBeLessThan(helper.indexOf("...decision.patch"));
  });
});

describe("8-9, 26. the decision is persisted so it can be reconstructed", () => {
  const helper = casesFn.slice(
    casesFn.indexOf("async function syncScreeningScopeDecision"),
    casesFn.indexOf("async function ensureScreeningSubjects"));

  it("writes reason code, reason, policy version and the material inputs", () => {
    expect(helper).toMatch(/reason_code: decided\.reasonCode/);
    expect(helper).toMatch(/reason: decided\.reason/);
    expect(helper).toMatch(/policy_version: scope\.policyVersion/);
    expect(helper).toMatch(/material_inputs: scope\.evidence/);
    expect(helper).toMatch(/decision_source: 'server_policy'/);
    expect(helper).toMatch(/perimeter_id: perimeterId/);
  });

  it("supersedes rather than overwrites, so history survives", () => {
    expect(helper).toMatch(/superseded_at: nowIso/);
    expect(helper).toMatch(/\.insert\(\{/);
  });

  it("the evidence reproduces the exemption from stored inputs", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.evidence["case.perimeter"]).toBe("outside_perimeter");
    expect(d.evidence["case.perimeter_reason"]).toBe("enquiry_only");
    expect(d.evidence["case.perimeter_scopes_excluded"]).toBe("sanctions");
    expect(d.policyVersion).toBe(SCREENING_POLICY_VERSION);
  });

  it("the table refuses a state that disagrees with `required`", () => {
    expect(migration).toMatch(/case_screening_scopes_state_agrees/);
    expect(migration).toMatch(/decision_source = 'server_policy'/);
  });

  it("the table refuses an exemption with no reason or no scopes", () => {
    expect(migration).toMatch(/case_screening_perimeter_reason_required/);
    expect(migration).toMatch(/case_screening_perimeter_scopes_required/);
  });
});

describe("there is one rule, not two", () => {
  it("decideScreeningPolicy is an adapter over the scope engine", () => {
    // It used to hold the rule itself, with sanctions hardcoded into
    // `required`. Two copies of one rule is how they drift.
    const fn = policyFn.slice(
      policyFn.indexOf("export function decideScreeningPolicy"),
      policyFn.indexOf("/* ─────────────────────────── Enrolment"));
    expect(fn).toMatch(/deriveScreeningScope\(input as ScreeningScopeInput\)/);
    expect(fn).not.toMatch(/required: ScreeningScopeKey\[\] = \["sanctions", "pep"\]/);
  });

  it("the legacy shape still requires sanctions with no perimeter", () => {
    expect(decideScreeningPolicy(CLEAN_INPUT).required).toContain("sanctions");
    expect(decideScreeningPolicy(CLEAN_INPUT).required).toContain("pep");
  });

  it("27. the API publishes the same decision the UI renders", () => {
    const sync = casesFn.slice(casesFn.indexOf("case 'sync_screening_stage'"));
    expect(sync).toMatch(/scopes: ALL_SCREENING_SCOPES\.map/);
    expect(sync).toMatch(/reason_code: scope\[k\]\.reasonCode/);
    expect(sync).toMatch(/provider_relevant: providerRelevant/);
    const card = read("src/components/aml/ScreeningStageCard.tsx");
    expect(card).toMatch(/\(sync\.scopes \?\? \[\]\)\.map/);
    expect(card).toMatch(/not required/);
  });
});
