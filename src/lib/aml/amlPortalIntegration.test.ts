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
