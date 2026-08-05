/**
 * Portal ↔ Command Center integration contracts (PR #1939).
 *
 * Source contracts pin the load-bearing properties of the canonical
 * verification pipeline so they cannot be silently reintroduced: canonical
 * writes, transactional outbox emission, attempt accounting, client-safe
 * readiness, closed action vocabulary, versioned responses, worker
 * idempotency and risk integration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const portalFn = readFileSync("supabase/functions/aml-client-portal/index.ts", "utf8");
const verificationFn = readFileSync("supabase/functions/aml-verification/index.ts", "utf8");
const riskFn = readFileSync("supabase/functions/aml-risk/index.ts", "utf8");
const workerIndex = readFileSync("supabase/functions/cross-portal-outbox-worker/index.ts", "utf8");
const consumer = readFileSync("supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts", "utf8");
const canonicalMigration = readFileSync("supabase/migrations/20260831000000_aml_canonical_verification_model.sql", "utf8");
const outboxMigration = readFileSync("supabase/migrations/20260831000100_aml_verification_outbox_and_request_notifications.sql", "utf8");

const idvBlock = portalFn.slice(portalFn.indexOf("case 'submit_verification'"), portalFn.indexOf("case 'request_verification_upload_url'"));

describe("canonical verification model", () => {
  it("portal submission writes verification_checks, never identity_checks", () => {
    expect(idvBlock).toContain("from('verification_checks').insert");
    expect(idvBlock).not.toContain("identity_checks");
  });
  it("migration keeps identity_checks untouched as read-only history", () => {
    // Executable statements only — the documented ROLLBACK header is comment.
    const executable = canonicalMigration.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(executable).not.toMatch(/(ALTER|UPDATE|DROP|INSERT INTO|DELETE FROM)\s+(TABLE\s+)?aml\.identity_checks/i);
    expect(executable).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b/);
  });
  it("adjudicated legacy electronic rows keep their consumed-attempt meaning", () => {
    expect(canonicalMigration).toContain("attempt_consumed = true");
    expect(canonicalMigration).toContain("IN ('passed','failed','referred','exhausted')");
  });
});

describe("attempt accounting", () => {
  it("the server counter counts only consumed, non-simulated, non-superseded attempts", () => {
    expect(canonicalMigration).toContain("AND attempt_consumed");
    expect(canonicalMigration).toContain("AND execution_mode <> 'simulation'");
    expect(canonicalMigration).toContain("AND superseded_at IS NULL");
  });
  it("the portal asks the RPC first and keeps MAX(attempt_number) only as legacy fallback", () => {
    const helper = portalFn.slice(portalFn.indexOf("async function verificationAttemptsUsed"), portalFn.indexOf("async function activeProcessingCheck"));
    expect(helper).toContain(".rpc('verification_attempts_used'");
    expect(helper.indexOf(".rpc(")).toBeLessThan(helper.indexOf("attempt_number"));
  });
  it("the worker consumes an attempt only on an authoritative outcome", () => {
    const authoritativeBlock = consumer.slice(consumer.indexOf("Authoritative outcome"));
    expect(authoritativeBlock).toContain("attempt_consumed: true");
    expect(consumer.slice(0, consumer.indexOf("Authoritative outcome"))).not.toContain("attempt_consumed: true");
  });
  it("unusable captures and technical failures never touch status or attempts", () => {
    const unusable = consumer.slice(consumer.indexOf("capture_unusable"), consumer.indexOf("Authoritative outcome"));
    expect(unusable).not.toContain("attempt_consumed: true");
    const technical = consumer.slice(consumer.indexOf("const technical"), consumer.indexOf("try {"));
    expect(technical).toContain("processing_status: 'technical_failure'");
    expect(technical).not.toMatch(/\bstatus:\s*'/);
  });
});

describe("transactional outbox pipeline", () => {
  it("the event is emitted by an AFTER trigger in the same transaction", () => {
    expect(outboxMigration).toContain("AFTER INSERT ON aml.verification_checks");
    expect(outboxMigration).toContain("'aml.verification.requested'");
    expect(outboxMigration).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
  });
  it("event payloads carry identifiers only — no PII, paths or images", () => {
    const payload = outboxMigration.slice(outboxMigration.indexOf("tg_emit_verification_requested"), outboxMigration.indexOf("trg_aml_verification_outbox"));
    expect(payload).not.toMatch(/storage_path|document_reference|party_label|email|image/);
  });
  it("the portal stamps a stable per-capture idempotency key and collapses duplicates", () => {
    expect(idvBlock).toContain("idempotency_key");
    expect(idvBlock).toContain("'23505'");
    expect(idvBlock).toContain("already_processing");
    expect(canonicalMigration).toContain("uq_aml_verification_idempotency");
  });
  it("the worker routes verification events to a dedicated consumer with eligibility and claim guards", () => {
    expect(workerIndex).toContain("aml_verification");
    expect(workerIndex).toContain("processVerificationEvent");
    expect(consumer).toContain("check.status !== 'pending'");
    expect(consumer).toContain("check.superseded_at");
    expect(consumer).toContain(".in('processing_status', ['submitted', 'queued', 'retry_scheduled'])");
  });
  it("the worker never logs or emits image bytes or secrets", () => {
    expect(consumer).not.toMatch(/console\.log\([^)]*(image|b64|token|secret)/i);
  });
});

describe("client-safe readiness", () => {
  it("the portal exposes only the closed client vocabulary", () => {
    const helper = portalFn.slice(portalFn.indexOf("clientSafeIdvAvailability"), portalFn.indexOf("/* ─"));
    for (const internal of ["ready_live", "simulator_non_production", "not_configured", "misconfigured", "secrets"]) {
      expect(helper).not.toContain(`'${internal}'`);
    }
    expect(portalFn).toContain("'temporarily_unavailable'");
    expect(portalFn).toContain("'manual_verification_required'");
  });
  it("the selfie upload URL is gated on availability, attempts and no active processing", () => {
    const uploadBlock = portalFn.slice(portalFn.indexOf("case 'request_verification_upload_url'"), portalFn.indexOf("case 'list_requirements'"));
    expect(uploadBlock).toContain("clientSafeIdvAvailability");
    expect(uploadBlock).toContain("attempts_exhausted");
    expect(uploadBlock).toContain("already_processing");
  });
  it("submission itself re-checks availability server-side", () => {
    expect(idvBlock).toContain("clientSafeIdvAvailability");
  });
});

describe("actionable requests and responses", () => {
  it("only the closed action vocabulary projects to the client, with whitelisted routing fields", () => {
    expect(portalFn).toContain("CLIENT_ACTION_CODES.includes(String(r.action_code");
    const projection = portalFn.slice(portalFn.indexOf("action_target: {"), portalFn.indexOf("due_at: r.due_at"));
    expect(projection).not.toMatch(/url|href|link/i);
  });
  it("the migration constrains action codes and adds notification state", () => {
    expect(outboxMigration).toContain("'complete_identity_verification'");
    expect(outboxMigration).toContain("notification_status");
  });
  it("a client request writes its portal notification and event transactionally", () => {
    expect(outboxMigration).toContain("AFTER INSERT ON aml.client_requests");
    expect(outboxMigration).toContain("client_portal_notifications");
    expect(outboxMigration).toContain("'aml.client_request.created'");
  });
  it("responses are written as the versioned v1 contract after validation", () => {
    const respond = portalFn.slice(portalFn.indexOf("case 'respond_client_request'"), portalFn.indexOf("case 'submit_for_review'"));
    expect(respond).toContain("version: 1");
    expect(respond).toContain("response_version: 1");
    expect(respond).toContain("completed_action");
  });
});

describe("risk integration", () => {
  it("canonical failures feed mandatory inputs only when authoritative and consumed", () => {
    const canonical = riskFn.slice(riskFn.indexOf("failedCanonicalIdv"), riskFn.indexOf("confirmedSanctions"));
    expect(canonical).toContain('.eq("authoritative", true)');
    expect(canonical).toContain('.eq("attempt_consumed", true)');
    expect(canonical).toContain('.is("superseded_at", null)');
  });
  it("canonical completions mark the assessment stale", () => {
    expect(riskFn).toContain("canonicalIdv");
    expect(riskFn).toContain('gt("completed_at", since)');
  });
});

describe("staff technical retry", () => {
  it("retries only technical failures and dead letters, never authoritative outcomes", () => {
    const retry = verificationFn.slice(verificationFn.indexOf('case "retry_verification_processing"'), verificationFn.indexOf('case "provider_readiness"'));
    expect(retry).toContain('["technical_failure", "dead_lettered"]');
    expect(retry).toContain("retry_not_eligible");
    expect(retry).not.toContain("attempt_consumed: true");
  });
});

describe("server-derived journey", () => {
  it("verified wording requires actual party verification state", () => {
    const journey = portalFn.slice(portalFn.indexOf("function buildJourney"), portalFn.indexOf("const MAX_UPLOAD_BYTES") > 0 ? portalFn.length : portalFn.length);
    expect(journey).toContain("partiesResolved");
    expect(journey).toContain("'You are verified.'");
    expect(journey).toContain("Your adviser is reviewing your information.");
    expect(journey).not.toContain("reuses it");
  });
  it("overview returns the journey computed server-side", () => {
    expect(portalFn).toContain("journey: buildJourney({");
  });
});

/* ── Continuation coverage: staff surfaces, portal actions, evidence ── */
const casesFn = readFileSync("supabase/functions/aml-cases/index.ts", "utf8");
const reviewPure = readFileSync("supabase/functions/_shared/aml/submissionReview.ts", "utf8");
const completionMigration = readFileSync("supabase/migrations/20260901000000_aml_integration_completion.sql", "utf8");
const reviewPanel = readFileSync("src/components/aml/SubmissionReviewPanel.tsx", "utf8");
const legacyPanel = readFileSync("src/components/aml/LegacyVerificationHistoryPanel.tsx", "utf8");
const partyPanel = readFileSync("src/components/aml/PartyVerificationPanel.tsx", "utf8");
const screeningPanel = readFileSync("src/components/aml/PartyScreeningPanel.tsx", "utf8");
const workspace = readFileSync("src/pages/aml/AmlCaseWorkspace.tsx", "utf8");
const portalPage2 = readFileSync("src/pages/portal/PortalAml.tsx", "utf8");

describe("submission review", () => {
  it("returns an immutable package and never writes the snapshot", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'get_submission_review'"), casesFn.indexOf("case 'accept_submission'"));
    for (const key of ["consent_evidence", "differences", "missing_mandatory", "risk", "related_parties", "verification", "screening"]) {
      expect(block).toContain(key);
    }
    const decide = casesFn.slice(casesFn.indexOf("case 'accept_submission'"), casesFn.indexOf("case 'review_document_v2'"));
    expect(decide).not.toMatch(/update\(\{[^}]*snapshot/s);
    expect(decide).toContain("service_gate_unchanged: true");
    expect(decide).not.toMatch(/service_gate_status:/);
  });
  it("gates accept/escalate on reviewer or MLRO and requires reasons elsewhere", () => {
    const decide = casesFn.slice(casesFn.indexOf("case 'accept_submission'"), casesFn.indexOf("case 'review_document_v2'"));
    expect(decide).toContain("roles.has('reviewer') || roles.has('mlro')");
    expect(decide).toContain("reason.length < 10");
  });
  it("changes requests create the client request that triggers the notification", () => {
    const decide = casesFn.slice(casesFn.indexOf("case 'accept_submission'"), casesFn.indexOf("case 'review_document_v2'"));
    expect(decide).toContain("from('client_requests').insert");
    expect(decide).toContain("action_code: actionCode");
  });
  it("diffing is pure, field-level and flags material sections", () => {
    expect(reviewPure).toContain("export function diffSubmissions");
    expect(reviewPure).toContain("MATERIAL_SECTIONS");
    expect(reviewPure).toMatch(/'personal_details', 'entity_details', 'related_parties', 'funding'/);
  });
  it("the UI is its own workspace section and shows the gate read-only", () => {
    expect(workspace).toContain('"submission-review"');
    expect(workspace).toContain('label: "Submission Review"');
    expect(workspace).toContain('section: "submission-review" as SectionKey');
    expect(reviewPanel).toContain("Service gate (read-only)");
    expect(reviewPanel).toContain("does not approve the service gate");
  });
  it("the review UI has loading, error-retry and empty states", () => {
    expect(reviewPanel).toContain("Try again");
    expect(reviewPanel).toContain("has not submitted their onboarding yet");
    expect(reviewPanel).toContain('aria-busy="true"');
  });
});

describe("document rejection and replacement", () => {
  it("rejection requires a client-safe code and an internal note, kept separate", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'review_document_v2'"), casesFn.indexOf("case 'list_party_reconciliation'"));
    expect(block).toContain("isClientSafeRejectionReason");
    expect(block).toContain("An internal review reason is required");
    expect(block).toContain("client_safe_rejection_reason: safeCopy");
    expect(block).toContain("internal_review_note: internalNote");
  });
  it("rejection raises a replacement request and keeps the rejected document", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'review_document_v2'"), casesFn.indexOf("case 'list_party_reconciliation'"));
    expect(block).toContain("action_code: 'upload_document'");
    expect(block).not.toMatch(/\.delete\(\)/);
  });
  it("lineage columns exist and internal notes are staff-only in the review package", () => {
    expect(completionMigration).toContain("previous_document_id");
    expect(completionMigration).toContain("replacement_document_id");
    const block = casesFn.slice(casesFn.indexOf("case 'get_submission_review'"), casesFn.indexOf("case 'accept_submission'"));
    expect(block).toContain("canWrite || roles.has('auditor') ? d.internal_review_note : null");
  });
});

describe("P3 evidence and P6 biometric governance", () => {
  it("evidence references govern the object without duplicating it", () => {
    expect(completionMigration).toContain("aml.idv_evidence_references");
    expect(completionMigration).toContain("information_classification text NOT NULL");
    expect(completionMigration).toContain("CHECK (information_classification IN ('P3','P6'))");
    expect(completionMigration).toContain("legal_hold boolean NOT NULL DEFAULT false");
    expect(completionMigration).toContain("disposal_evidence jsonb");
  });
  it("retention registers every new record type with necessity-based raw classes", () => {
    for (const t of ["verification_check", "idv_evidence_reference", "biometric_capture",
      "submission_review_decision", "document_version", "document_review_decision",
      "client_request_notification", "party_reconciliation_item", "party_field_provenance",
      "party_screening_subject", "party_verification_link"]) {
      expect(completionMigration).toContain(`'${t}'`);
    }
    expect(completionMigration).toMatch(/\('idv_evidence_reference',\s*0,/);
    expect(completionMigration).toMatch(/\('biometric_capture',\s*0,/);
  });
});

describe("party reconciliation", () => {
  it("never merges automatically and demands a rationale", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'resolve_party_reconciliation'"), casesFn.indexOf("case 'list_party_verification_links'"));
    expect(block).toContain("A rationale is required");
    expect(block).toContain("cross_case_denied");
    expect(block).toContain("from('party_field_provenance').insert");
  });
  it("similarity is suggestion-only in the pure resolver", () => {
    expect(reviewPure).toContain("requires_confirmation: true");
    expect(reviewPure).toMatch(/exact = stable[\s\S]{0,200}stable_identifier/);
    expect(reviewPure).toContain("basis: 'name_similarity'");
  });
  it("screening work is created only after resolution", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'resolve_party_reconciliation'"), casesFn.indexOf("case 'list_party_verification_links'"));
    expect(block).toContain("['linked', 'created'].includes(resolution) && item.screening_required");
    expect(block).toContain("from('party_screening_subjects').insert");
  });
});

describe("party verification links", () => {
  it("refuses cross-case and non-authoritative evidence and requires an unlink reason", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'link_party_verification'"), casesFn.indexOf("case 'list_party_screening'"));
    expect(block).toContain("cross_case_denied");
    expect(block).toContain("not_authoritative");
    expect(block).toContain("An unlink reason is required");
  });
  it("the UI derives state and never sets a verified flag directly", () => {
    expect(partyPanel).toContain("derived from the canonical check");
    expect(partyPanel).not.toMatch(/verification_state\s*[:=]/);
  });
});

describe("party screening orchestration", () => {
  it("dedupes inside the freshness window and restricts adjudication", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'queue_party_screening'"), casesFn.indexOf("      default:"));
    expect(block).toContain("within_freshness_window");
    expect(block).toContain("roles.has('reviewer') || roles.has('mlro')");
    expect(block).toContain("An adjudication note is required");
  });
  it("the panel states screening follows reconciliation and hides detail from clients", () => {
    expect(screeningPanel).toContain("screening follows");
    expect(screeningPanel).toContain("Clients never see screening detail");
  });
});

describe("unified staff verification surface", () => {
  it("mounts one canonical surface plus a collapsed legacy panel", () => {
    expect(workspace).toContain("<VerificationSection");
    expect(workspace).toContain("<LegacyVerificationHistoryPanel");
    expect(workspace).not.toMatch(/<VerificationTab[\s\S]{0,400}<VerificationSection/);
    const identity = workspace.slice(workspace.indexOf('section === "identity"'), workspace.indexOf('section === "submission-review"'));
    expect(identity).not.toContain("<VerificationTab");
  });
  it("legacy history is read-only with simulator labelling", () => {
    expect(legacyPanel).toContain("Test simulation — not compliance evidence");
    expect(legacyPanel).toContain("Nothing here can be retried or promoted");
    // No executable action: the only "retry" mention is the doc comment
    // stating that nothing here can be retried.
    const code = legacyPanel.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*") && !l.trimStart().startsWith("//")).join("\n");
    expect(code).not.toMatch(/initiateIdv|retryVerification|onClick=\{[^}]*retry/i);
  });
});

describe("client portal request actions", () => {
  it("routes internally through the closed vocabulary with no URLs", () => {
    expect(portalPage2).toContain("REQUEST_ACTIONS");
    for (const code of ["complete_identity_verification", "upload_document",
      "update_questionnaire_section", "review_consent", "provide_clarification", "review_and_submit"]) {
      expect(portalPage2).toContain(code);
    }
    const nav = portalPage2.slice(portalPage2.indexOf("onNavigate={(target"), portalPage2.indexOf("/>", portalPage2.indexOf("onNavigate={(target")));
    expect(nav).not.toMatch(/action_url|window\.location|href/);
  });
  it("unknown or unavailable targets fail safe", () => {
    expect(portalPage2).toContain("That step is not available yet");
  });
  it("responses use the versioned v1 contract", () => {
    expect(portalPage2).toContain("version: 1");
    expect(portalPage2).toContain("completed_action: 'provide_clarification'");
  });
  it("request status is shown in client-safe language", () => {
    expect(portalPage2).toContain("Action required");
    expect(portalPage2).toContain("Response sent");
  });
});
