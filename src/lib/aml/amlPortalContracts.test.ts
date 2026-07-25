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

describe("verification relationships (Phase 6, §12.4)", () => {
  const entitiesSource = readFileSync(
    join(repo, "supabase/functions/aml-entities/index.ts"), "utf8");
  const start = entitiesSource.indexOf('op === "link_verification"');
  const end = entitiesSource.indexOf('op === "list_provenance"');
  const branch = start >= 0 && end > start ? entitiesSource.slice(start, end) : undefined;

  it("exists and requires a write role", () => {
    expect(branch).toBeDefined();
    expect(branch).toContain("requireWrite();");
  });

  it("derives the party's verification state from the linked check, never from input", () => {
    expect(branch).toContain('String(check.status) === "verified"');
    expect(branch).not.toContain("body.verification_state");
  });

  it("rejects checks that belong to a different case", () => {
    expect(branch).toContain("belongs to a different case");
  });

  it("audits every link into the hash chain", () => {
    expect(branch).toContain("appendCaseEvent(");
    expect(branch).toContain("Verification linked for");
  });
});

describe("finance request loop — staff side (Phase 7, §15.4)", () => {
  const requestMigration = readFileSync(
    join(repo, "supabase/migrations/20260726093000_aml_finance_requests.sql"), "utf8");

  it("creates requests behind the write gate with a validated kind", () => {
    const branch = financeSource.slice(
      financeSource.indexOf('op === "create_finance_request"'),
      financeSource.indexOf('op === "review_finance_request"'));
    expect(branch).toContain("requireWrite();");
    expect(branch).toContain("FINANCE_REQUEST_KINDS.has(kind)");
  });

  it("advances the finance-portal dimension per §15.3 at each step", () => {
    expect(financeSource).toContain('"clarification_required" : "information_required"');
    expect(financeSource).toContain('setFinancePortalStatus(reqRow.case_id, "under_review")');
    expect(financeSource).toContain('["under_review", "accepted", "no_further_action"].includes(financeStatusAfter)');
  });

  it("audits request lifecycle into the hash chain", () => {
    expect(financeSource).toContain("Finance request sent:");
    expect(financeSource).toContain("Finance request ${outcome}:");
  });

  it("uses the shared reconciliation engine, not a local copy", () => {
    expect(financeSource).toContain('from "../_shared/amlFinanceEngine.ts"');
    expect(financeSource).not.toContain("function detectDiscrepancies");
  });

  it("request table is deny-by-default and reversible", () => {
    expect(requestMigration).toContain("ALTER TABLE aml.finance_requests ENABLE ROW LEVEL SECURITY;");
    expect(requestMigration).toContain("GRANT ALL ON aml.finance_requests TO service_role;");
    expect(requestMigration).not.toMatch(/GRANT .* ON aml\.finance_requests TO authenticated/);
    expect(requestMigration).toContain("DROP TABLE IF EXISTS aml.finance_requests;");
  });
});

describe("finance portal request channel is finance-safe (Phase 7, §15.1/§15.2)", () => {
  const fpSource = readFileSync(
    join(repo, "supabase/functions/finance-portal-aml-requests/index.ts"), "utf8");
  const codeOnly = fpSource
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  it("authenticates with the finance-portal session, not staff auth", () => {
    expect(fpSource).toContain("resolveFinancePartner(");
    expect(fpSource).not.toContain("verifyAuth(");
  });

  it("scopes every read to the partner's client assignments", () => {
    expect(fpSource).toContain("finance_portal_client_assignments");
    expect(fpSource).toContain('allowedClients.has(String(r.client_id))');
    expect(fpSource).toContain('.in("client_id", Array.from(allowedClients))');
  });

  it("never projects case identifiers or internal fields to the partner", () => {
    const projStart = fpSource.indexOf("function safeRequestProjection");
    const projEnd = fpSource.indexOf("function num(");
    const projection = fpSource.slice(projStart, projEnd);
    expect(projection).not.toContain("case_id");
    expect(projection).not.toContain("discrepancy_id");
    expect(projection).not.toContain("resolution_note");
    expect(fpSource).toContain("requests: (data ?? []).map(safeRequestProjection)");
  });

  it("returns no risk, screening or discrepancy detail in any response", () => {
    expect(codeOnly).not.toMatch(/risk_rating|risk_score|pep|sanction|screening/i);
    // Submissions acknowledge without echoing what the engine detected.
    expect(fpSource).toContain('return jr({ ok: true, status: "submitted" });');
    expect(fpSource).not.toContain("detected.length");
    expect(fpSource).not.toMatch(/jr\(\{[^}]*discrepanc/i);
  });

  it("creates canonical records through the shared engine (§15.4 steps 4-6)", () => {
    expect(fpSource).toContain('from "../_shared/amlFinanceEngine.ts"');
    expect(fpSource).toContain('source: "finance_portal"');
    expect(fpSource).toContain('detected_by: "finance_submission"');
    expect(fpSource).toContain("appendCaseEvent(");
  });
});

describe("risk, decision and service gate (Phase 8, §12.8 + §16 + C.4)", () => {
  const riskSource = readFileSync(
    join(repo, "supabase/functions/aml-risk/index.ts"), "utf8");
  const gateMigration = readFileSync(
    join(repo, "supabase/migrations/20260726110000_aml_service_gate_and_counterparty_cdd.sql"), "utf8");

  it("refuses a rating override without evidence and stamps the policy version", () => {
    expect(riskSource).toContain("evidence is required");
    expect(riskSource).toContain("evidence_note: evidence");
    expect(riskSource).toContain("program_version: overridePolicyVersion");
  });

  it("records analyst recommendations behind the write gate and closes the loop on decide", () => {
    const branch = riskSource.slice(
      riskSource.indexOf('op === "recommend"'),
      riskSource.indexOf('op === "list_recommendations"'));
    expect(branch).toContain("Insufficient permissions");
    expect(branch).toContain("rationale must be at least 10 characters");
    expect(riskSource).toContain('status: "actioned", actioned_decision_id: dec.id');
  });

  it("only changes the service gate through an explicit reasoned decision", () => {
    const branch = riskSource.slice(
      riskSource.indexOf('op === "set_service_gate"'),
      riskSource.indexOf('op === "gate_contract"'));
    expect(branch).toContain("Reviewer/MLRO required");
    expect(branch).toContain("reason must be at least 10 characters");
    expect(branch).toContain("requires the MLRO");
    // Approval preconditions — never inferred from stage or rating.
    expect(branch).toContain("gate_requires_cleared_decision");
    expect(branch).toContain("unresolved mandatory holds");
    expect(branch).toContain('"no_controls"');
  });

  it("evaluate never writes the service-gate dimension (§16 separation)", () => {
    const evalBranch = riskSource.slice(
      riskSource.indexOf('op === "evaluate"'),
      riskSource.indexOf('op === "list_assessments"'));
    expect(evalBranch).not.toContain("service_gate_status");
  });

  it("returns the C.4 gate contract fields", () => {
    const branch = riskSource.slice(
      riskSource.indexOf('op === "gate_contract"'),
      riskSource.indexOf('op === "recalc_status"'));
    for (const field of ["status", "effective_at", "conditions", "decision_id", "approved_by", "policy_version", "audit_event_id"]) {
      expect(branch).toContain(`${field}:`);
    }
  });

  it("reports staleness from material-input changes (recalculation triggers)", () => {
    expect(riskSource).toContain('reasons.push("screening_changed")');
    expect(riskSource).toContain('reasons.push("funding_changed")');
    expect(riskSource).toContain('reasons.push("questionnaire_changed")');
  });

  it("gate and recommendation tables are read-only to the browser", () => {
    expect(gateMigration).toContain("ALTER TABLE aml.service_gate_decisions ENABLE ROW LEVEL SECURITY;");
    expect(gateMigration).toContain("ALTER TABLE aml.analyst_recommendations ENABLE ROW LEVEL SECURITY;");
    expect(gateMigration).not.toMatch(/CREATE POLICY .* ON aml\.service_gate_decisions[\s\S]{0,120}FOR (ALL|INSERT|UPDATE)/);
    expect(gateMigration).not.toMatch(/CREATE POLICY .* ON aml\.analyst_recommendations[\s\S]{0,120}FOR (ALL|INSERT|UPDATE)/);
  });
});

describe("transaction and counterparty CDD (Phase 9, §12.5)", () => {
  const txSource = readFileSync(
    join(repo, "supabase/functions/aml-transactions/index.ts"), "utf8");

  it("marking uncooperative requires a reason and recorded reasonable steps", () => {
    const branch = txSource.slice(
      txSource.indexOf('op === "mark_uncooperative"'),
      txSource.indexOf('op === "counterparty_cdd_summary"'));
    expect(branch).toContain("reason must be at least 10 characters");
    expect(branch).toContain("insufficient_attempts");
    expect(branch).toContain("attemptCount < 2");
  });

  it("delayed CDD requires a dated deadline and a justification", () => {
    const branch = txSource.slice(
      txSource.indexOf('op === "set_delayed_cdd"'),
      txSource.indexOf('op === "mark_uncooperative"'));
    expect(branch).toContain("deadline must be a YYYY-MM-DD date");
    expect(branch).toContain("justification must be at least 10 characters");
    expect(branch).toContain("appendCpCaseEvent");
  });

  it("the generic counterparty upsert cannot set the controlled fields", () => {
    const branch = txSource.slice(
      txSource.indexOf('op === "upsert_cp_case"'),
      txSource.indexOf('op === "delete_cp_case"'));
    expect(branch).toContain("delete p.delayed_cdd_deadline;");
    expect(branch).toContain("delete p.uncooperative;");
    expect(branch).toContain("delete p.uncooperative_reason;");
  });

  it("counterparty actions land on the hash-chained case timeline", () => {
    expect(txSource).toContain("Counterparty marked uncooperative:");
    expect(txSource).toContain("Delayed CDD recorded for");
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
