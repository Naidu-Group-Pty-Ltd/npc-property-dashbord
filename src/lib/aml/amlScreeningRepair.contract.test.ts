import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source contracts for the AML screening repair (Defects A–H).
 *
 * House style: the edge functions are Deno code, so these tests hold the
 * source to its contract — the behavioural halves live in
 * localListsScreening.test.ts and partyScreeningProjection.test.ts against
 * the pure modules the functions import.
 */

const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const verification = read("supabase/functions/aml-verification/index.ts");
const cases = read("supabase/functions/aml-cases/index.ts");
const risk = read("supabase/functions/aml-risk/index.ts");
const monitoring = read("supabase/functions/aml-monitoring/index.ts");
const worker = read("supabase/functions/cross-portal-outbox-worker/index.ts");
const screeningConsumer = read("supabase/functions/cross-portal-outbox-worker/screeningConsumer.ts");
const providers = read("supabase/functions/_shared/aml/providers/index.ts");
const migration = read("supabase/migrations/20260807120000_aml_screening_repair.sql");
const refreshWorkflow = read(".github/workflows/aml-sanctions-refresh.yml");
const clientPortal = read("supabase/functions/aml-client-portal/index.ts");
const financePortal = read("supabase/functions/aml-finance/index.ts");

describe("Defect B — provider selection is server-side only", () => {
  it("run_screening never passes a request-controlled provider hint", () => {
    const op = verification.slice(
      verification.indexOf('case "run_screening"'),
      verification.indexOf('case "list_screening"'));
    expect(op).not.toContain("preferred");
    expect(op).not.toContain("body.provider");
    expect(op).toContain("getScreeningProvider({ resolved, admin })");
  });

  it("defaults the scope to the provider's declared coverage, not a wish-list", () => {
    const op = verification.slice(
      verification.indexOf('case "run_screening"'),
      verification.indexOf('case "list_screening"'));
    expect(op).not.toContain('["pep", "sanctions", "adverse_media"];');
    expect(op).toContain("provider.supportedScopes");
  });

  it("stale list data is recorded as screening-incomplete, never as an outcome", () => {
    const op = verification.slice(
      verification.indexOf('case "run_screening"'),
      verification.indexOf('case "list_screening"'));
    expect(op).toContain("list_data_unavailable");
    expect(op).toContain('status: "pending"');
  });
});

describe("Defect C — queueing a party creates real, idempotent screening work", () => {
  it("the migration emits aml.screening.requested transactionally on the queued transition", () => {
    expect(migration).toContain("aml.tg_emit_party_screening_requested");
    expect(migration).toContain("'aml.screening.requested'");
    expect(migration).toContain("NEW.state = 'queued'");
    expect(migration).toContain("OLD.state IS DISTINCT FROM NEW.state");
    expect(migration).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
    // Identifiers only — no name, DOB or match content in the outbox payload.
    expect(migration).toContain("'party_screening_subject_id', NEW.id");
    expect(migration).not.toMatch(/payload[\s\S]{0,200}screened_name/);
  });

  it("the worker routes the event to the screening consumer, ahead of the aml.* catch-all", () => {
    expect(worker).toContain("import { processScreeningEvent } from './screeningConsumer.ts'");
    const routing = worker.indexOf("event.event_type==='aml.screening.requested'");
    const catchAll = worker.indexOf("startsWith('aml.')");
    expect(routing).toBeGreaterThan(-1);
    expect(routing).toBeLessThan(catchAll);
  });

  it("the consumer claims optimistically and walks away from replayed or concurrent deliveries", () => {
    expect(screeningConsumer).toContain("if (!claimable) return");
    expect(screeningConsumer).toContain("if (!claimed) return");
    expect(screeningConsumer).toMatch(/state\.in\.\(queued,error\)/);
  });

  it("executes through the canonical engine — provider factory, metrics, screening_checks, screening_matches", () => {
    expect(screeningConsumer).toContain("resolveTenantProvider");
    expect(screeningConsumer).toContain("getScreeningProvider({ resolved, admin: db })");
    expect(screeningConsumer).toContain("runWithMetrics");
    expect(screeningConsumer).toContain("from('screening_checks')");
    expect(screeningConsumer).toContain("from('screening_matches')");
  });

  it("passes every identifying detail the party carries — DOB, aliases, country — inventing none", () => {
    expect(screeningConsumer).toContain("date_of_birth");
    expect(screeningConsumer).toContain("aliases: subject.aliases");
    expect(screeningConsumer).toContain("country");
  });

  it("projects the party from canonical matches and links the check with list evidence", () => {
    expect(screeningConsumer).toContain("projectPartyScreeningState");
    expect(screeningConsumer).toContain("screening_check_id: checkId");
    expect(screeningConsumer).toContain("list_version");
    expect(screeningConsumer).toContain("refresh_due_at: computeRefreshDueAt");
  });

  it("technical failure projects to error — retried and dead-lettered, never clear", () => {
    expect(screeningConsumer).toContain("state: 'error'");
    expect(screeningConsumer).toContain("error_category: category");
    expect(screeningConsumer).toContain("list_data_unavailable");
    // Re-thrown so the platform outbox applies backoff / dead-lettering.
    expect(screeningConsumer).toMatch(/throw err;/);
    expect(screeningConsumer).not.toContain("state: 'completed',\n      error_category");
  });
});

describe("Defect D — one authoritative adjudication mechanism", () => {
  const adjudicateOp = cases.slice(
    cases.indexOf("case 'adjudicate_party_screening'"),
    cases.indexOf("case 'list_pep_determinations'"));

  it("party adjudication resolves the canonical match with a hash-chained resolution", () => {
    expect(adjudicateOp).toContain("match_id");
    expect(adjudicateOp).toContain("match_resolutions");
    expect(adjudicateOp).toContain("prev_hash");
    expect(adjudicateOp).toContain("from('screening_matches')");
  });

  it("a subject with no canonical screening cannot be adjudicated into a finding", () => {
    expect(adjudicateOp).toContain("no_canonical_screening");
    expect(adjudicateOp).toContain("canonical_match_required");
  });

  it("party state is derived from the canonical match set, not asserted", () => {
    expect(adjudicateOp).toContain("projectPartyScreeningState");
    expect(adjudicateOp).not.toContain("state: outcome");
  });

  it("resolve_match in aml-verification reprojects linked party subjects the same way", () => {
    const resolveOp = verification.slice(
      verification.indexOf('case "resolve_match"'),
      verification.indexOf("list_verification_checks"));
    expect(resolveOp).toContain("projectPartyScreeningState");
    expect(resolveOp).toContain("party_screening_subjects");
  });

  it("adjudication stays human: reviewer or MLRO only", () => {
    expect(adjudicateOp).toContain("roles.has('reviewer') || roles.has('mlro')");
  });
});

describe("Defect E — auditable PEP determination", () => {
  const pepOp = cases.slice(cases.indexOf("case 'record_pep_determination'"));

  it("records subject, result, classification, methods, rationale, who and when, hash-chained", () => {
    for (const needle of [
      "subject_name", "result", "pep_type", "pep_relationship",
      "methods", "rationale", "determined_by", "determined_at",
      "row_hash", "review_due_at",
    ]) expect(pepOp).toContain(needle);
  });

  it("a not_pep without recorded methods is rejected — a guess is not a determination", () => {
    expect(pepOp).toContain("At least one method/source");
  });

  it("a pep result requires the AUSTRAC classification", () => {
    expect(pepOp).toContain("foreign|domestic|international_organisation");
    expect(pepOp).toContain("self|family_member|close_associate");
  });

  it("supersedes rather than edits, and the schema enforces classification and review indexing", () => {
    expect(pepOp).toContain("superseded_at: now");
    expect(migration).toContain("pep_result_requires_classification");
    expect(migration).toContain("idx_aml_pep_det_review");
    expect(migration).toContain("'pep_determination', 7, 'AML/CTF Act s 107'");
  });
});

describe("Risk integration — PEP feeds risk without becoming a rejection", () => {
  it("authoritative PEP inputs come from the recorded determination, EDD case and approvals queue", () => {
    const fn = risk.slice(risk.indexOf("async function authoritativeMandatoryInputs"));
    expect(fn).toContain("pep_determinations");
    expect(fn).toContain("pepControlsRequired");
    expect(fn).toContain("edd_cases");
    expect(fn).toContain("pep_service_approval");
  });

  it("PEP is represented separately from sanctions — never as a sanctions match", () => {
    const fn = risk.slice(
      risk.indexOf("async function authoritativeMandatoryInputs"),
      risk.indexOf("function blockingHolds"));
    expect(fn).toContain('inputs.pep = ');
    // The sanctions input remains keyed on canonical confirmed sanctions
    // matches only; the pep inputs never touch inputs.screening.
    expect(fn).toContain('.eq("match_type", "sanctions")');
    expect(fn).not.toMatch(/inputs\.screening[^\n]*pep/);
  });

  it("clearance blocks on incomplete, unresolved and stale required screening — and on missing PEP work", () => {
    const fn = risk.slice(
      risk.indexOf("async function screeningCompletenessReasons"),
      risk.indexOf("async function clearanceBlockReasons"));
    expect(fn).toContain("partyScreeningOutstanding");
    expect(fn).toContain("party_screening_incomplete");
    expect(fn).toContain("party_screening_unresolved");
    expect(fn).toContain("party_screening_stale");
    expect(fn).toContain("unadjudicated_screening_matches");
    expect(fn).toContain("case_screening_missing");
    expect(fn).toContain("pep_determination_outstanding");
  });

  it("PEP EDD and senior-manager approval gate clearance explicitly", () => {
    const fn = risk.slice(
      risk.indexOf("async function clearanceBlockReasons"),
      risk.indexOf("* Tenant-scoped authorization"));
    expect(fn).toContain("pep_edd_outstanding");
    expect(fn).toContain("pep_senior_manager_approval_outstanding");
    expect(fn).toContain("screeningCompletenessReasons");
  });

  it("the seeded triggers keep PEP a hold, not a sanctions-style block", () => {
    expect(migration).toContain("'pep_edd_outstanding'");
    expect(migration).toContain("'pep_approval_outstanding'");
    expect(migration).toMatch(/'pep_edd_outstanding'[\s\S]{0,400}'hold'/);
    expect(migration).not.toMatch(/pep[\s\S]{0,200}sanctioned/i);
  });

  it("straight-through auto-clearance cannot bypass the completeness gate", () => {
    const op = risk.slice(risk.indexOf('if (op === "evaluate")'), risk.indexOf('if (op === "list_assessments")'));
    expect(op).toContain("stBlockers");
    expect(op).toContain("clearanceBlockReasons");
    expect(op).toContain("stEligible && stBlockers.length === 0");
  });

  it("senior manager is not silently the MLRO — resolution requires a recorded designation", () => {
    const op = risk.slice(risk.indexOf('op === "resolve_approval"'), risk.indexOf("list_senior_managers"));
    expect(op).toContain("senior_manager_designations");
    expect(op).toContain("senior_manager_designation_required");
    expect(migration).toContain("senior_manager_designations");
  });
});

describe("missing_mandatory — every non-final state is outstanding", () => {
  it("get_submission_review uses the shared outstanding rule, not a two-state list", () => {
    const op = cases.slice(
      cases.indexOf("case 'get_submission_review'"),
      cases.indexOf("case 'accept_submission'"));
    expect(op).toContain("isPartyScreeningMissing");
    expect(op).not.toContain("['not_started', 'possible_match'].includes(s.state)");
  });
});

describe("Defect H — ongoing screening is party-aware", () => {
  it("the scheduled scan queues never-screened and refresh-overdue required parties through the same canonical path", () => {
    const fn = monitoring.slice(monitoring.indexOf("async function runScheduledScans"));
    expect(fn).toContain("party_screening_subjects");
    expect(fn).toContain('.eq("required", true).eq("state", "not_started")');
    expect(fn).toContain('lt("refresh_due_at"');
    expect(fn).toContain('state: "queued"');
    // No second screening implementation: the scan only flips state; the
    // outbox trigger + worker execute it.
    expect(fn).not.toContain("getScreeningProvider");
  });

  it("ended relationships stay excluded from every party pass", () => {
    const fn = monitoring.slice(monitoring.indexOf("async function runScheduledScans"));
    const partySection = fn.slice(fn.indexOf("Party-aware screening currency"));
    expect(partySection.split("isEnded(").length).toBeGreaterThanOrEqual(4);
  });

  it("PEP determinations due for review are surfaced", () => {
    const fn = monitoring.slice(monitoring.indexOf("async function runScheduledScans"));
    expect(fn).toContain("pep_determinations");
    expect(fn).toContain("PEP determination review due");
  });

  it("the case monitoring summary reflects the most urgent required party state", () => {
    const op = monitoring.slice(monitoring.indexOf('op === "case_monitoring_summary"'));
    expect(op).toContain("party_screening_subjects");
    expect(op).toContain("most_urgent_state");
    expect(op).toContain("next_refresh_due_at");
  });
});

describe("Nightly sanctions refresh failure mode", () => {
  it("a scheduled run without write credentials fails loudly instead of dry-running", () => {
    expect(refreshWorkflow).toContain("exit 1");
    expect(refreshWorkflow).toContain("::error::");
    expect(refreshWorkflow).not.toContain("running a dry run only");
  });

  it("an explicit dry run remains available and needs no credentials", () => {
    expect(refreshWorkflow).toContain("Dry run (explicitly requested)");
    expect(refreshWorkflow).toContain("github.event.inputs.dry_run == 'true'");
    // The credential check is skipped for a deliberate dry run.
    expect(refreshWorkflow).toMatch(/id: creds\n\s+if: github\.event\.inputs\.dry_run != 'true'/);
  });

  it("does not weaken the parser tests, hashing or prune protections", () => {
    expect(refreshWorkflow).toContain("npm run test:aml-sanctions");
    const loader = read("scripts/aml/load-sanctions-lists.mjs");
    expect(loader).toContain("PRUNE_SHRINK_FLOOR");
    expect(loader).toContain("sha256");
    expect(loader).toContain("refusing to publish an empty list");
  });
});

describe("Privacy — screening detail stays out of the portals", () => {
  it.each([
    ["client portal", clientPortal],
    ["finance portal", financePortal],
  ])("the %s never reads screening matches, party screening or PEP determinations", (_label, source) => {
    expect(source).not.toContain("screening_matches");
    expect(source).not.toContain("party_screening_subjects");
    expect(source).not.toContain("pep_determinations");
    expect(source).not.toContain("match_resolutions");
    expect(source).not.toContain("senior_manager_designations");
  });

  it("the outbox event carries identifiers only", () => {
    expect(migration).not.toMatch(/jsonb_build_object\([\s\S]{0,200}(screened_name|date_of_birth|match)/);
  });
});

describe("KYC / IDV is untouched by this repair", () => {
  it("the IDV provider path and verification consumer keep their shape", () => {
    // The IDV factory still refuses simulators in production and the
    // verification consumer still owns identity outcomes — this repair is
    // screening-only.
    expect(providers).toContain("getIdvProvider");
    expect(providers).toContain("makeSelfHostedIdvProvider");
    const verificationConsumer = read("supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts");
    expect(verificationConsumer).toContain("processVerificationEvent");
    expect(verificationConsumer).toContain("attempt_consumed");
  });
});
