/**
 * Phase 1 portal-safe contract tests. These read the edge-function and
 * migration sources and assert the tri-portal disclosure contracts hold at
 * the server boundary (directive Appendix B/C) — they fail if restricted
 * fields creep back into portal payloads or activation loses its guardrails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the repo root; jsdom rewrites import.meta.url to an http
// scheme, so resolve the sources from the working directory instead.
const repo = process.cwd();
const financeSource = readFileSync(join(repo, "supabase/functions/aml-finance/index.ts"), "utf8");
const portalSource = readFileSync(join(repo, "supabase/functions/aml-client-portal/index.ts"), "utf8");
const casesSource = readFileSync(join(repo, "supabase/functions/aml-cases/index.ts"), "utf8");
const migrationSource = readFileSync(
  join(repo, "supabase/migrations/20260725153000_aml_case_workflow_dimensions.sql"), "utf8");

describe("finance-safe limited_status contract (Phase 1)", () => {
  const limitedStatusBranch = financeSource.match(
    /if \(op === "limited_status"\) \{([\s\S]*?)\n {4}\}/,
  )?.[1];

  it("has a limited_status branch", () => {
    expect(limitedStatusBranch).toBeDefined();
  });

  it("returns only finance-safe fields", () => {
    expect(limitedStatusBranch).toContain("finance_status:");
    expect(limitedStatusBranch).toContain("service_readiness:");
    expect(limitedStatusBranch).toContain("open_finance_discrepancies:");
  });

  it("never returns raw risk or internal case state", () => {
    expect(limitedStatusBranch).not.toContain("risk_rating:");
    expect(limitedStatusBranch).not.toContain("risk_score");
    expect(limitedStatusBranch).not.toMatch(/status:\s*c\.status/);
  });

  it("derives readiness only from an explicit approved gate", () => {
    expect(limitedStatusBranch).toContain('"approved"');
    expect(limitedStatusBranch).toContain('"approved_with_controls"');
  });

  it("keeps case handoff ops blocked pre-auth", () => {
    expect(financeSource).toContain(
      'if (opPre === "create_case_handoff" || opPre === "redeem_case_handoff")',
    );
    expect(financeSource).toContain(
      "AML case snapshots are not available in the finance portal",
    );
  });
});

describe("client-portal safe payload contract (Phase 1)", () => {
  it("ships the portal-safe status token, not the internal case enum", () => {
    expect(portalSource).toContain("portalStatusFor(");
    expect(portalSource).not.toMatch(/status:\s*c\.status/);
  });

  it("collapses internal escalation states behind safe labels", () => {
    expect(portalSource).toContain("escalated_mlro: 'under_review'");
    expect(portalSource).toContain("blocked: 'contact_adviser'");
  });

  it("does not return staff-authored reviewer notes to the client", () => {
    expect(portalSource).not.toContain("reviewer_notes");
  });

  it("never selects risk or screening fields for the portal payload", () => {
    const codeOnly = portalSource
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(codeOnly).not.toMatch(/risk_rating|risk_score|screening|pep|sanction/i);
  });

  it("still scopes every case lookup to the authenticated portal client", () => {
    expect(portalSource).toContain(".eq('client_id', clientId)");
  });
});

describe("activation contract (Phase 1, directive §17)", () => {
  const activateBranch = casesSource.match(
    /case 'activate_client': \{([\s\S]*?)\n {6}\}/,
  )?.[1];

  it("still requires human confirmation, an active client and a reason", () => {
    expect(activateBranch).toContain("Human confirmation is required");
    expect(activateBranch).toContain("Client is not active");
    expect(activateBranch).toContain("reason must be at least 10 characters");
  });

  it("writes explicit activation fields and preserves the legacy model label", () => {
    expect(activateBranch).toContain("activation_timing:");
    expect(activateBranch).toContain("agreement_state:");
    expect(activateBranch).toContain("legacy_activation_model: model");
    expect(activateBranch).toContain("'post_agreement_trigger'");
    expect(activateBranch).toContain("'conditional_agreement'");
  });

  it("starts the service gate at cdd_incomplete, never approved", () => {
    expect(activateBranch).toContain("service_gate_status: 'cdd_incomplete'");
    expect(activateBranch).not.toContain("service_gate_status: 'approved'");
  });

  it("keeps the Model B legal-approval guardrail and surfaces settings read errors", () => {
    expect(activateBranch).toContain("model_b_not_approved");
    expect(activateBranch).toContain("if (settingsErr) throw settingsErr;");
  });

  it("maps unique-index duplicate violations to the 409 contract", () => {
    expect(activateBranch).toContain("'23505'");
    expect(activateBranch).toContain("An open AML case already exists for this client");
  });
});

describe("manual case creation is a restricted exception (Phase 3, §10.4)", () => {
  const createBranch = casesSource.match(
    /case 'create': \{([\s\S]*?)\n {6}\}/,
  )?.[1];

  it("requires the MLRO role, not just any write role", () => {
    expect(createBranch).toContain("if (!isMlro)");
    expect(createBranch).toContain("manual_creation_restricted");
  });

  it("requires a recorded exception category, authority and reason", () => {
    expect(createBranch).toContain("EXCEPTION_CATEGORIES");
    expect(createBranch).toContain("'data_migration'");
    expect(createBranch).toContain("exception.reason must be at least 10 characters");
    expect(createBranch).toContain("exception.authority is required");
  });

  it("persists the exception on the case and in the audit event", () => {
    expect(createBranch).toContain("creation_exception: exceptionRecord");
    expect(createBranch).toContain("authorised exception");
  });
});

describe("client summary is scoped and read-only (Phase 4, §13)", () => {
  const summaryBranch = casesSource.match(
    /case 'client_summary': \{([\s\S]*?)\n {6}\}/,
  )?.[1];

  it("exists and requires a client id", () => {
    expect(summaryBranch).toBeDefined();
    expect(summaryBranch).toContain("client_id is required");
  });

  it("only reads case, requirement and request data for that client", () => {
    expect(summaryBranch).toContain(".eq('client_id', clientId)");
    expect(summaryBranch).not.toContain(".insert(");
    expect(summaryBranch).not.toContain(".update(");
    expect(summaryBranch).not.toContain(".delete(");
  });

  it("reports open-case state matching the duplicate-prevention rule", () => {
    expect(summaryBranch).toContain("'cleared', 'blocked', 'closed'");
    expect(summaryBranch).toContain("has_open_case");
  });
});

describe("activation dialog has no raw-UUID entry (Phase 4, §13.4)", () => {
  const dialogSource = readFileSync(
    join(repo, "src/components/aml/ActivateClientDialog.tsx"), "utf8");

  it("uses a client picker instead of a UUID input", () => {
    expect(dialogSource).not.toContain("Client ID (UUID)");
    expect(dialogSource).not.toContain("00000000-0000-0000-0000-000000000000");
    expect(dialogSource).toContain("Search clients by name");
  });

  it("loads only a slim, non-sensitive client projection for the picker", () => {
    expect(dialogSource).toContain("id, primary_first_name, primary_surname, is_active");
  });

  it("does not surface internal model vocabulary in the options", () => {
    expect(dialogSource).not.toContain("designated service triggered");
    expect(dialogSource).not.toContain("Model B — pre-service");
  });
});

describe("conditional questionnaire engine (Phase 5, §14.2–14.4)", () => {
  it("is versioned and server-driven", () => {
    expect(portalSource).toContain("QUESTIONNAIRE_VERSION = '2'");
    expect(portalSource).toContain("questionnaire_version: QUESTIONNAIRE_VERSION");
    expect(portalSource).toContain("function applicableSections(");
  });

  it("adds entity and related-party sections for the right structures", () => {
    expect(portalSource).toContain("'entity_details'");
    expect(portalSource).toContain("'related_parties'");
    expect(portalSource).toContain("ENTITY_STRUCTURES = new Set(['Company', 'Trust', 'SMSF', 'Partnership'])");
    expect(portalSource).toContain("MULTI_PARTY_STRUCTURES = new Set(['Joint', 'Company', 'Trust', 'SMSF', 'Partnership'])");
  });

  it("keeps base sections applicable for every structure", () => {
    expect(portalSource).toMatch(/out: string\[\] = \['purchasing_structure', 'personal_details'\]/);
    expect(portalSource).toContain("out.push('purchase_profile', 'funding')");
  });

  it("validates saves against the full catalogue and retains superseded answers", () => {
    expect(portalSource).toContain("ALL_SECTIONS.includes(body.section)");
    // The pre-Phase-5 fixed-list check must not survive anywhere.
    expect(portalSource).not.toMatch(/(?<!ALL_)SECTIONS\.includes\(body\.section\)/);
  });

  it("blocks final submission until every applicable section is submitted", () => {
    expect(portalSource).toContain("Cannot submit — some sections are incomplete");
    expect(portalSource).toContain("missing_sections");
  });

  it("freezes the engine version and applicable list into the submission snapshot", () => {
    expect(portalSource).toContain("applicable_sections: active");
  });
});

describe("questionnaire reconciliation into canonical parties (Phase 6)", () => {
  const entitiesSource = readFileSync(
    join(repo, "supabase/functions/aml-entities/index.ts"), "utf8");
  const importStart = entitiesSource.indexOf('op === "import_from_questionnaire"');
  const importEnd = entitiesSource.indexOf('op === "list_provenance"');
  const importBranch = importStart >= 0 && importEnd > importStart
    ? entitiesSource.slice(importStart, importEnd)
    : undefined;

  it("exists and requires a write role", () => {
    expect(importBranch).toBeDefined();
    expect(importBranch).toContain("requireWrite();");
  });

  it("never silently overwrites recorded values — blanks fill, mismatches conflict", () => {
    // Fill is gated on the recorded value being empty…
    expect(importBranch).toContain('if (c.recorded == null || String(c.recorded).trim() === "")');
    // …and a disagreement becomes a flagged conflict, not an update.
    expect(importBranch).toContain("report.conflicts.push");
    expect(importBranch).not.toContain("upsert(row)");
  });

  it("records every source value in field_provenance with client-portal attribution", () => {
    expect(importBranch).toContain('from("field_provenance").insert(');
    expect(importBranch).toContain('source_type: "client_portal"');
    expect(importBranch).toContain('conflict_status: row.conflict ? "conflict" : "none"');
  });

  it("is idempotent per source response and field", () => {
    expect(importBranch).toContain("provSeen");
    expect(importBranch).toContain("if (provSeen.has(");
  });

  it("preserves non-canonical parties for review instead of dropping them", () => {
    expect(importBranch).toContain("parties_needing_review");
    expect(importBranch).toContain("no_entity_structure_on_case");
  });

  it("appends a hash-chained audit event describing the reconciliation", () => {
    expect(importBranch).toContain("appendCaseEvent(");
    expect(importBranch).toContain("Client questionnaire reconciled into ownership records");
  });

  it("scopes provenance reads to a single case", () => {
    const provBranch = entitiesSource.slice(importEnd);
    expect(provBranch).toContain('.eq("case_id", caseId)');
    expect(provBranch).not.toContain(".insert(");
  });

  it("keeps ownership internals out of the client portal entirely", () => {
    expect(portalSource).not.toContain("beneficial_owners");
    expect(portalSource).not.toContain("field_provenance");
    expect(portalSource).not.toContain("authorised_representatives");
  });
});

describe("workflow-dimension migration invariants", () => {
  it("enforces one open case per client with a partial unique index", () => {
    expect(migrationSource).toContain("CREATE UNIQUE INDEX IF NOT EXISTS aml_cases_one_open_per_client");
    expect(migrationSource).toMatch(/WHERE client_id IS NOT NULL\s*\n\s*AND status NOT IN/);
  });

  it("records backfill provenance outside the hash chain", () => {
    expect(migrationSource).toContain("aml.workflow_dimension_migrations");
    expect(migrationSource).not.toContain("INSERT INTO aml.case_events");
  });

  it("marks unclassifiable activations for human review instead of guessing", () => {
    expect(migrationSource).toContain("'ambiguous_pending_review'");
    expect(migrationSource).toContain("'legacy_unclassified'");
  });

  it("provenance table is deny-by-default with service-role-only access", () => {
    expect(migrationSource).toContain("ALTER TABLE aml.field_provenance ENABLE ROW LEVEL SECURITY;");
    expect(migrationSource).toContain("GRANT ALL ON aml.field_provenance TO service_role;");
    expect(migrationSource).not.toMatch(/GRANT .* ON aml\.field_provenance TO authenticated/);
  });
});
