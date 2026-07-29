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
    // The projection now lives on the server (aml-cases `search_clients`) —
    // the dialog receives a name-only shape and never a client record.
    expect(casesSource).toContain("select('id, primary_first_name, primary_surname, is_active')");
    expect(dialogSource).toMatch(/label: string;\s*\n?\s*is_active: boolean;/);
    expect(dialogSource).not.toMatch(/total_portfolio_value|email|phone/);
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

  it("preserves client-wide and per-deal assignment scope on every read", () => {
    expect(fpSource).toContain("finance_portal_client_assignments");
    expect(fpSource).toContain('.select("client_id, purchase_file_id")');
    expect(fpSource).toContain('.in("client_id", Array.from(allowedClients))');
    expect(fpSource).toContain("a.purchase_file_id == null");
    expect(fpSource).toContain("String(a.purchase_file_id) === String(r.purchase_file_id)");
    expect(fpSource).toContain("if (!isAssignedRequest(r)) return null;");
    expect(fpSource).toContain("(data ?? []).filter(isAssignedRequest).map(safeRequestProjection)");
  });

  it("never projects case identifiers or internal fields to the partner", () => {
    const projStart = fpSource.indexOf("function safeRequestProjection");
    const projEnd = fpSource.indexOf("function num(");
    const projection = fpSource.slice(projStart, projEnd);
    expect(projection).not.toContain("case_id");
    expect(projection).not.toContain("discrepancy_id");
    expect(projection).not.toContain("resolution_note");
    expect(fpSource).toContain(".map(safeRequestProjection)");
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

  it("authorizes recommendation and service-gate access against the case tenant", () => {
    const helper = riskSource.slice(
      riskSource.indexOf("async function tenantCaseAccess"),
      riskSource.indexOf("Deno.serve"));
    expect(helper).toContain('.eq("tenant_id", tenantId)');
    expect(helper).toContain('rpc("is_superadmin"');

    for (const operation of ["recommend", "list_recommendations", "set_service_gate", "gate_contract"]) {
      const start = riskSource.indexOf(`op === "${operation}"`);
      const next = riskSource.indexOf('if (op === "', start + 10);
      const branch = riskSource.slice(start, next < 0 ? undefined : next);
      expect(branch).toContain("tenantCaseAccess(admin, userId, caseId)");
    }
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

describe("monitoring and ongoing CDD (Phase 10, §12.9 + §18)", () => {
  const monSource = readFileSync(
    join(repo, "supabase/functions/aml-monitoring/index.ts"), "utf8");
  const cddMigration = readFileSync(
    join(repo, "supabase/migrations/20260726120000_aml_ongoing_cdd.sql"), "utf8");

  it("schedules the periodic cycle from the case's risk rating", () => {
    const branch = monSource.slice(
      monSource.indexOf('op === "schedule_periodic_review"'),
      monSource.indexOf('op === "record_trigger_review"'));
    expect(branch).toContain("hasTenantAccess(caseRow.tenant_id, WRITE_ROLES)");
    expect(branch).toContain("reviewIntervalMonths(caseRow)");
    expect(monSource).toContain("DEFAULT_REVIEW_INTERVALS");
  });

  it("authorizes every Phase 10 case operation against the case tenant", () => {
    expect(monSource).toContain('aml.rpc("has_any_tenant_aml_role"');
    expect(monSource).toContain('aml.rpc("has_tenant_aml_role"');
    for (const nextOperation of [
      "record_trigger_review", "assign_review", "extend_review_deadline",
      "end_relationship", "set_monitoring_status", "case_monitoring_summary",
    ]) {
      const start = nextOperation === "record_trigger_review"
        ? monSource.indexOf('op === "schedule_periodic_review"')
        : monSource.indexOf(`op === "${nextOperation}"`);
      const following = monSource.indexOf('if (op ===', start + 1);
      const branch = monSource.slice(start, following === -1 ? undefined : following);
      expect(branch).toContain("hasTenantAccess(caseRow.tenant_id");
    }
  });

  it("raises trigger reviews only from a known trigger catalogue with detail", () => {
    const branch = monSource.slice(
      monSource.indexOf('op === "record_trigger_review"'),
      monSource.indexOf('op === "assign_review"'));
    expect(branch).toContain("TRIGGER_KINDS[triggerKind]");
    expect(branch).toContain("detail must be at least 10 characters");
    expect(monSource).toContain("screening_match:");
    expect(monSource).toContain("ownership_change:");
  });

  it("never moves a deadline silently — reason, original date and count are kept", () => {
    const branch = monSource.slice(
      monSource.indexOf('op === "extend_review_deadline"'),
      monSource.indexOf('op === "end_relationship"'));
    expect(branch).toContain("reason must be at least 10 characters");
    expect(branch).toContain("original_due_at: existing.original_due_at ?? existing.due_at");
    expect(branch).toContain("extension_count: Number(existing.extension_count ?? 0) + 1");
    expect(branch).toContain("appendCaseEvent(");
  });

  it("relationship end is reasoned, gated on outstanding work and preserves history", () => {
    const branch = monSource.slice(
      monSource.indexOf('op === "end_relationship"'),
      monSource.indexOf('op === "set_monitoring_status"'));
    expect(branch).toContain("Reviewer/MLRO required");
    expect(branch).toContain("reason must be at least 10 characters");
    expect(branch).toContain("open_obligations");
    // Scheduled work is cancelled, never deleted.
    expect(branch).not.toContain(".delete()");
    expect(branch).toContain('outcome: "relationship_ended"');
  });

  it("ended relationships stop generating new monitoring work", () => {
    expect(monSource).toContain('.eq("monitoring_status", "ended")');
    expect(monSource).toContain("if (isEnded(s.case_id)) continue;");
    expect(monSource).toContain('.eq("monitoring_status", "active")');
    expect(monSource).toContain("relationship_ended");
  });

  it("reinstating an ended relationship is MLRO-only", () => {
    const branch = monSource.slice(
      monSource.indexOf('op === "set_monitoring_status"'),
      monSource.indexOf('op === "case_monitoring_summary"'));
    expect(branch).toContain("Only the MLRO can reinstate monitoring on an ended relationship");
    expect(branch).toContain("ending a relationship uses end_relationship");
  });

  it("migration is additive with a documented rollback", () => {
    expect(cddMigration).toContain("ADD COLUMN IF NOT EXISTS monitoring_status");
    expect(cddMigration).toContain("ADD COLUMN IF NOT EXISTS relationship_ended_at");
    expect(cddMigration).toContain("ADD COLUMN IF NOT EXISTS extension_count");
    expect(cddMigration).toContain("-- ROLLBACK:");
    expect(cddMigration).not.toMatch(/DROP TABLE(?!\s+IF EXISTS aml\.(finance_requests|service_gate_decisions))/);
  });
});

describe("records and retention (Phase 11, §18 + §19)", () => {
  const recSource = readFileSync(
    join(repo, "supabase/functions/aml-records/index.ts"), "utf8");
  const retMigration = readFileSync(
    join(repo, "supabase/migrations/20260726140000_aml_retention_triggers.sql"), "utf8");

  it("retention runs from recorded trigger events, never from age since upload", () => {
    const branch = recSource.slice(
      recSource.indexOf('case "dry_run_scan"'),
      recSource.indexOf('case "request_approval"'));
    // Candidates come from the trigger table's due minimum-retention dates.
    expect(branch).toContain('from("retention_triggers")');
    expect(branch).toContain('.lte("minimum_retention_date", nowIso)');
    // The old age-based cutoff must be gone entirely.
    expect(branch).not.toContain("retention_years) * 365.25");
    expect(branch).not.toMatch(/\.lt\(src\.timestampCol, cutoff\)/);
  });

  it("only accepts the §18 trigger catalogue and requires a legal basis", () => {
    expect(recSource).toContain("RETENTION_TRIGGER_KINDS");
    for (const kind of [
      "relationship_end", "occasional_transaction_complete", "transaction_date",
      "program_version_obsolete", "investigation_complete", "report_complete", "legal_hold_release",
    ]) {
      expect(recSource).toContain(`${kind}:`);
    }
    const branch = recSource.slice(
      recSource.indexOf('case "record_retention_trigger"'),
      recSource.indexOf('case "sync_case_triggers"'));
    expect(branch).toContain("trigger_kind invalid");
    expect(branch).toContain("legal_basis is required");
    // Re-recording supersedes rather than rewriting the basis.
    expect(branch).toContain("superseded_at: new Date().toISOString()");
  });

  it("checks dependencies and legal holds before any disposal, at scan and at execution", () => {
    expect(recSource).toContain("async function dependencyBlockersFor(");
    for (const blocker of [
      "open_regulatory_report", "open_reporting_obligation", "open_investigation",
      "referenced_as_evidence", "relationship_not_ended",
    ]) {
      expect(recSource).toContain(blocker);
    }
    const exec = recSource.slice(
      recSource.indexOf('case "execute_scan"'),
      recSource.indexOf('case "audit_timeline"'));
    expect(exec).toContain("await activeHoldFor(");
    expect(exec).toContain("await dependencyBlockersFor(");
    expect(exec).toContain("retention_trigger_no_longer_operative");
  });

  it("records disposal evidence describing only what actually happened", () => {
    const exec = recSource.slice(
      recSource.indexOf('case "execute_scan"'),
      recSource.indexOf('case "audit_timeline"'));
    expect(exec).toContain("disposal_evidence:");
    expect(exec).toContain("evidence_hash");
    expect(exec).toContain('dependency_check: "passed"');
    expect(exec).toContain('legal_hold_check: "passed"');
    // A soft disposal must not claim redaction it did not perform.
    expect(exec).toContain("no field-level redaction performed");
    // A failed disposal is recorded as failed, not as disposed.
    expect(exec).toContain('disposition: "failed"');
  });

  it("verifies the hash chain by recomputation for independent review", () => {
    const branch = recSource.slice(
      recSource.indexOf('case "verify_audit_chain"'),
      recSource.indexOf('case "export_audit_bundle"'));
    expect(branch).toContain("recomputed !== ev.row_hash");
    expect(branch).toContain("prev_hash_discontinuity");
    expect(branch).toContain("intact: breaks.length === 0");
  });

  it("audit export is MLRO-only, reasoned and carries its own integrity statement", () => {
    const branch = recSource.slice(recSource.indexOf('case "export_audit_bundle"'));
    expect(branch).toContain("MLRO required");
    expect(branch).toContain("reason must be at least 10 characters");
    expect(branch).toContain("bundle_hash");
    expect(branch).toContain("integrity:");
    expect(branch).toContain("Audit bundle exported for case");
  });

  it("trigger table is browser read-only and the migration is reversible", () => {
    expect(retMigration).toContain("ALTER TABLE aml.retention_triggers ENABLE ROW LEVEL SECURITY;");
    expect(retMigration).toContain("GRANT SELECT ON aml.retention_triggers TO authenticated;");
    expect(retMigration).not.toMatch(/CREATE POLICY[\s\S]{0,160}ON aml\.retention_triggers[\s\S]{0,80}FOR (ALL|INSERT|UPDATE)/);
    expect(retMigration).toContain("-- ROLLBACK:");
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

/* ------------------------------------------------------------------ */
/* Activation → client portal → AUSTRAC consent                        */
/* ------------------------------------------------------------------ */

describe("activation client picker", () => {
  const dialog = readFileSync(
    join(repo, "src/components/aml/ActivateClientDialog.tsx"), "utf8");

  it("looks clients up through the AML-gated op, not the general client broker", () => {
    // get-client-data listMode narrows to created_by/assigned_team_user_id for
    // anyone who is not a superadmin, which left the picker empty for the
    // compliance officers who actually perform activation.
    expect(dialog).not.toContain("get-client-data");
    expect(dialog).toContain("amlCasesApi.searchClients");
  });

  it("surfaces search failures instead of showing an empty result", () => {
    expect(dialog).toContain('setSearchState("error")');
    expect(dialog).toContain("searchError");
    expect(dialog).not.toContain(".catch(() => setClients([]))");
  });

  it("keeps the search narrow and AML-role-gated on the server", () => {
    const branch = casesSource.slice(
      casesSource.indexOf("case 'search_clients':"),
      casesSource.indexOf("case 'client_summary':"));
    expect(branch).toContain("if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403)");
    expect(branch).toContain(".eq('is_active', true)");
    expect(branch).toContain(".limit(20)");
    // Projection must not leak financial or contact data into the picker.
    expect(branch).toContain("select('id, primary_first_name, primary_surname, is_active')");
    expect(branch).not.toMatch(/email|phone|portfolio|income/i);
    // This file's response helper is jsonResponse; `jr` belongs to other
    // functions and would be a ReferenceError at runtime here.
    expect(casesSource).not.toMatch(/\bjr\(/);
  });
});

describe("activation hands the client a portal link", () => {
  const branch = casesSource.slice(
    casesSource.indexOf("case 'activate_client':"),
    casesSource.indexOf("case 'update':"));

  it("posts a portal notification deep-linking the compliance check", () => {
    expect(branch).toContain("client_portal_notifications");
    expect(branch).toContain("action_url: '/client/aml'");
  });

  it("reports back whether the client can actually reach the link", () => {
    expect(branch).toContain("client_portal_users");
    expect(branch).toContain("has_portal_access");
    expect(branch).toContain("no active portal login yet");
  });

  it("keeps the notification portal-safe — no risk or screening content", () => {
    const notify = branch.slice(branch.indexOf("client_portal_notifications"));
    expect(notify).not.toMatch(/risk_rating|risk_score|screening|reviewer_notes|mlro/i);
  });

  it("does not fail a recorded activation because a notification failed", () => {
    expect(branch).toContain("portal notification insert failed");
    expect(branch).toContain("notified = true");
  });
});

describe("AUSTRAC consent contract", () => {
  const consentMigration = readFileSync(
    join(repo, "supabase/migrations/20260727090000_aml_consent_catalogue.sql"), "utf8");
  const portalAml = readFileSync(join(repo, "src/pages/portal/PortalAml.tsx"), "utf8");

  it("publishes a versioned, server-owned catalogue rather than hard-coded text", () => {
    expect(consentMigration).toContain("CREATE TABLE IF NOT EXISTS aml.consent_documents");
    expect(consentMigration).toContain("UNIQUE (code, version)");
    expect(consentMigration).toContain("-- ROLLBACK:");
    // Wording must not live in the frontend bundle any more.
    expect(portalAml).not.toContain("in line with the AUSTRAC AML/CTF Act 2006 and Rules");
    expect(portalAml).toContain("amlPortalApi.getConsents");
  });

  it("references AUSTRAC and the statutory basis for each disclosure", () => {
    expect(consentMigration).toContain("statutory_basis");
    expect(consentMigration).toContain("Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth)");
    expect(consentMigration).toContain("Privacy Act 1988 (Cth)");
    expect(consentMigration).toContain("https://www.austrac.gov.au/about-us/privacy-policy");
    for (const code of [
      "privacy_notice", "identity_verification", "aml_ctf_program",
      "regulatory_reporting", "record_keeping",
    ]) {
      expect(consentMigration).toContain(`'${code}', '2026.1'`);
    }
  });

  it("does not ask the customer to accept terms that bind the reporting entity", () => {
    // The AUSTRAC Online terms are between AUSTRAC and us. They may be linked
    // for context; they must never be presented as a customer consent item.
    const acceptanceRows = consentMigration.slice(consentMigration.indexOf("INSERT INTO aml.consent_documents"));
    expect(acceptanceRows).not.toMatch(/'austrac_online[^']*',\s*'2026\.1',\s*'consent'/);
    expect(consentMigration).toContain("AUSTRAC Online (how we lodge reports)");
  });

  it("binds each acceptance to the exact wording presented", () => {
    expect(consentMigration).toContain("document_hash");
    expect(portalSource).toContain("consentCanonicalText");
    expect(portalSource).toContain("document_hash: documentHash");
  });

  it("enforces the consent gate on the server for every collection op", () => {
    for (const op of [
      "case 'save_questionnaire':", "case 'request_upload_url':",
      "case 'confirm_upload':", "case 'submit_for_review':",
    ]) {
      const idx = portalSource.indexOf(op);
      expect(idx).toBeGreaterThan(-1);
      expect(portalSource.slice(idx, idx + 700)).toContain("consentRequiredResponse");
    }
  });

  it("fails closed when no catalogue is in force", () => {
    expect(portalSource).toContain("satisfied: Boolean(version) && documents.length > 0 && outstanding.length === 0");
  });

  it("rejects acceptances against unknown or superseded wording", () => {
    const branch = portalSource.slice(
      portalSource.indexOf("case 'record_consent':"),
      portalSource.indexOf("case 'list_requirements':"));
    expect(branch).toContain("consent_document_unknown");
    expect(branch).toContain("consent_version_stale");
  });

  it("drives the portal gate from the server, not a browser-local flag", () => {
    expect(portalAml).toContain("data?.consent?.satisfied");
    expect(portalAml).not.toContain("aml_portal_consent:");
  });

  it("gives the command centre trackable confirmation of acceptance", () => {
    const branch = casesSource.slice(
      casesSource.indexOf("case 'consent_status':"),
      casesSource.indexOf("case 'search_clients':"));
    expect(branch).toContain("document_hash");
    expect(branch).toContain("outstanding");
    expect(branch).toContain("history:");
  });
});

/* ------------------------------------------------------------------ */
/* Identity verification — owner decisions of 2026-07-28              */
/* ------------------------------------------------------------------ */

describe("verification checks encode the owner's decisions", () => {
  const vcMigration = readFileSync(
    join(repo, "supabase/migrations/20260728120000_aml_verification_checks.sql"), "utf8");
  const optionalBiometricConsentMigration = readFileSync(
    join(repo, "supabase/migrations/20260729030000_optional_biometric_consent.sql"), "utf8");

  it("is per party, not per case — a trust needs several verifications", () => {
    expect(vcMigration).toContain("party_id uuid");
    expect(vcMigration).toContain("party_label text NOT NULL");
    expect(vcMigration).toContain(
      "ON aml.verification_checks(case_id, COALESCE(party_id, case_id), check_type, attempt_number)");
  });

  it("decision 4 — three attempts total, enforced by the database", () => {
    expect(vcMigration).toContain("CHECK (attempt_number BETWEEN 1 AND 3)");
    // The third failure is terminal for the automated path.
    expect(vcMigration).toMatch(/CHECK \(status IN \([^)]*'exhausted'/s);
  });

  it("decision 3 — no calendar expiry is introduced", () => {
    // Comments explain the deliberate absence, so assert against code only.
    const code = vcMigration.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(code).not.toMatch(/\bexpires_at\b/);
    expect(code).not.toMatch(/\bnext_verification_due\b/);
    expect(code).not.toMatch(/\bre_verification_due\b/);
  });

  it("decision 2 — a retained biometric cannot exist without its consent", () => {
    expect(vcMigration).toContain("biometric_consent_id uuid REFERENCES aml.consents(id)");
    expect(vcMigration).toContain("CONSTRAINT biometric_requires_consent");
    // Storage path present ⇒ consent, kind and capture time must all be present.
    const c = vcMigration.slice(vcMigration.indexOf("CONSTRAINT biometric_requires_consent"));
    expect(c).toContain("biometric_consent_id IS NOT NULL");
    expect(c).toContain("biometric_kind IS NOT NULL");
    expect(c).toContain("biometric_captured_at IS NOT NULL");
  });

  it("publishes a separate biometric consent — APP 3.3 needs its own", () => {
    expect(vcMigration).toContain("'biometric_collection', '2026.2', 'consent'");
    expect(vcMigration).toContain(
      "Privacy Act 1988 (Cth), section 6 — biometric information is sensitive information");
    expect(vcMigration).toContain("Australian Privacy Principle 3.3");
    // The client must be told retention happens, and offered the way out.
    expect(vcMigration).toContain("We retain your facial image");
    expect(vcMigration).toContain("You do not have to consent to this");
    expect(vcMigration).toContain("up to three attempts");
  });

  it("keeps biometric consent outside the portal-wide required consent gate", () => {
    const biometricRow = vcMigration.slice(vcMigration.indexOf("'biometric_collection', '2026.2'"));
    expect(biometricRow).toMatch(/false, 25\s*\)/);
    expect(optionalBiometricConsentMigration).toContain("SET required = false");
    expect(optionalBiometricConsentMigration).toContain("code = 'biometric_collection'");
    expect(optionalBiometricConsentMigration).toContain("version = '2026.2'");
  });

  it("carries the whole catalogue forward — a version must be self-complete", () => {
    // The gate reads acceptance as version-specific, so publishing only the new
    // document at 2026.2 would leave the AUSTRAC consents reading as outstanding.
    expect(vcMigration).toMatch(/SELECT code, '2026\.2'[\s\S]*WHERE version = '2026\.1'/);
  });

  it("is deny-by-default and reversible", () => {
    expect(vcMigration).toContain("ALTER TABLE aml.verification_checks ENABLE ROW LEVEL SECURITY;");
    expect(vcMigration).toContain("GRANT ALL ON aml.verification_checks TO service_role;");
    expect(vcMigration).not.toMatch(/GRANT .* ON aml\.verification_checks TO authenticated/);
    expect(vcMigration).toContain("-- ROLLBACK:");
  });

  it("keeps the provider swappable — no vendor baked into the schema", () => {
    // Decision 1 is a self-hosted open-source stack; the schema must not
    // hard-code it, since the DVS layer will come from a commercial gateway.
    expect(vcMigration).toContain("provider text");
    expect(vcMigration).not.toMatch(/CHECK \(provider IN/);
  });
});

describe("KYC vendor documentation stays internally consistent", () => {
  const options = readFileSync(join(repo, "docs/aml/kyc-integration-options.md"), "utf8");
  const investigation = readFileSync(join(repo, "docs/aml/kyc-repo-investigation.md"), "utf8");

  it("does not recommend CompreFace without flagging the weights licence", () => {
    // The Apache-2.0 badge covers the code, not the InsightFace-ArcFace weights.
    // A future edit that drops this caveat would reintroduce a licence breach.
    const row = options.split("\n").find(l => l.includes("exadel-inc/CompreFace"));
    expect(row).toBeDefined();
    expect(row).toMatch(/non-commercial|licence required/i);
    expect(options).toContain("Correction (2026-07-28)");
    expect(options).toContain("recognition-oss-pack@insightface.ai");
  });

  it("records why each investigated repo was rejected", () => {
    for (const repoName of [
      "FaceOnLive/ID-Verification-OpenKYC",
      "vyayasan/kyc-analyst",
      "DoubangoTelecom/KYC-Documents-Verif-SDK",
    ]) {
      expect(investigation).toContain(repoName);
    }
    // The load-bearing findings, so a later summariser cannot soften them.
    expect(investigation).toContain("all rights reserved");
    expect(investigation).toContain("must not be used in commercial products");
    expect(investigation).toMatch(/cannot activate on standard VMs/);
  });

  it("keeps the no-LLM-in-the-determination-path line explicit", () => {
    expect(investigation).toContain("conflicts with our protected baseline");
    expect(investigation).toMatch(/risk evaluation never moves the service gate/);
  });
});

describe("zero-cost KYC solution keeps its licence evidence", () => {
  const zeroCost = readFileSync(join(repo, "docs/aml/kyc-zero-cost-solution.md"), "utf8");
  const options = readFileSync(join(repo, "docs/aml/kyc-integration-options.md"), "utf8");

  it("names the model whose weights are actually permissive", () => {
    // SFace is the only face-match model found with Apache-2.0 *weights*.
    // If this is ever swapped for ArcFace/InsightFace the stack stops being free.
    expect(zeroCost).toContain("face_recognition_sface");
    expect(zeroCost).toMatch(/Apache-2\.0,? weights included|Apache-2\.0 \*including\* its weights/);
    // Apache-2.0 obliges us to retain the attribution; assert it survives,
    // tolerating the line wrapping in the prose.
    expect(zeroCost.replace(/\s+/g, " "))
      .toContain("Shenzhen Institute of Artificial Intelligence and Robotics for Society");
  });

  it("takes sanctions data from DFAT directly, not via the CC-BY-NC aggregator", () => {
    expect(zeroCost).toContain("DFAT Consolidated List");
    expect(zeroCost).toMatch(/OpenSanctions[\s\S]{0,200}CC-BY-NC/);
  });

  it("states the DVS gap rather than implying parity with a paid stack", () => {
    expect(zeroCost).toContain("No DVS");
    expect(zeroCost).toMatch(/not checking against the issuing authority/i);
    expect(zeroCost).toContain("compensating control");
  });

  it("keeps the upgrade path open — no schema rework to add DVS later", () => {
    expect(zeroCost).toMatch(/check_type = 'dvs'/);
    expect(zeroCost).toContain("no schema change");
  });

  it("cross-links from the paid evaluation so neither is read alone", () => {
    expect(options).toContain("kyc-zero-cost-solution.md");
  });
});
