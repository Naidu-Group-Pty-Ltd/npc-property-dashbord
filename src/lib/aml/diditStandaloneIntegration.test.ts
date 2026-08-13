import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The Standalone integration held at its boundaries.
 *
 * These are source and contract assertions, in the style the rest of this
 * directory uses, because the properties they protect are not reachable from a
 * unit test: "the browser never gets the API key", "no new attempt opens a
 * provider window", "every paid call sends save_api_request=false" and "a
 * failed paid call is never automatically retried" are statements about which
 * code exists and which does not.
 *
 * Every one of them corresponds to a way this integration could be wrong that
 * would not fail any behavioural test — it would just quietly cost money, leak
 * a credential, or send a customer to somebody else's website.
 */

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * The same source with its comments removed.
 *
 * Needed wherever an assertion is "this identifier does not appear", because
 * the modules under test explain at length why it does not — and prose saying
 * "no score crosses this boundary" is indistinguishable from a `score:` field
 * to a substring match. Comments are stripped so the assertion reads the code.
 */
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const CLIENT = read('supabase/functions/_shared/aml/providers/diditStandaloneClient.ts');
const ORCHESTRATOR = read('supabase/functions/_shared/aml/standaloneVerification.ts');
const PORTAL = read('supabase/functions/aml-client-portal/index.ts');
const PROCESSOR = read('supabase/functions/aml-verification-processor/index.ts');
const CONSUMER = read('supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts');
const REGISTRY = read('supabase/functions/_shared/aml/providers/index.ts');
const STEP = read('src/components/portal/IdentityVerificationStep.tsx');
const PORTAL_API = read('src/lib/aml/amlPortalApi.ts');
const MIGRATION = read('supabase/migrations/20260911000000_aml_didit_standalone_capture.sql');

/* ─────────────────── the browser never reaches Didit ────────────────────── */

describe('the customer never sees, and the browser never calls, the provider', () => {
  const BROWSER_FILES = [
    'src/components/portal/IdentityVerificationStep.tsx',
    'src/lib/aml/amlPortalApi.ts',
    'src/lib/aml/identityDocuments.ts',
    'src/lib/aml/captureImage.ts',
  ];

  it('no browser module names the provider host or its endpoints', () => {
    for (const file of BROWSER_FILES) {
      const source = read(file);
      expect(source, file).not.toContain('verification.didit.me');
      expect(source, file).not.toContain('/v3/id-verification');
      expect(source, file).not.toContain('/v3/passive-liveness');
      expect(source, file).not.toContain('/v3/face-match');
      expect(source, file).not.toContain('DIDIT_API_KEY');
      expect(source, file).not.toContain('x-api-key');
    }
  });

  it('no browser module imports a provider client', () => {
    for (const file of BROWSER_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/from ['"].*diditStandaloneClient/);
      expect(source, file).not.toMatch(/from ['"].*providers\/diditClient/);
    }
  });

  it('the capture journey opens no window, embeds nothing and redirects nowhere', () => {
    // The whole of `SecureCaptureCheck` — from its declaration to the end of
    // the file's capture section — must contain none of the hosted flow's
    // machinery. The hosted component above it still may: it is legacy and
    // serves sessions opened before the cutover.
    const start = STEP.indexOf('function SecureCaptureCheck(');
    expect(start).toBeGreaterThan(0);
    const capture = STEP.slice(start);
    for (const forbidden of ['window.open', 'iframe', 'verification_url',
      'postMessage', 'CHECK_WINDOW_TARGET', 'location.replace', 'location.href']) {
      expect(capture, forbidden).not.toContain(forbidden);
    }
  });

  it('the capture journey uploads only to a signed URL the server minted', () => {
    const start = STEP.indexOf('function SecureCaptureCheck(');
    const capture = STEP.slice(start);
    // The one fetch in the journey is the PUT to `grant.upload_url`.
    const fetches = capture.match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(capture).toContain('fetch(grant.upload_url');
  });

  it('the portal API sends an attempt id on submission, never a storage path', () => {
    const start = PORTAL_API.indexOf('submitVerificationAttempt:');
    const end = PORTAL_API.indexOf('getConsents:', start);
    const op = PORTAL_API.slice(start, end);
    expect(op).toContain("'submit_verification_attempt'");
    expect(op).not.toContain('storage_path');
    expect(op).not.toContain('bucket');
  });

  it('the browser cannot assert a result, a score, a threshold or a provider', () => {
    for (const forbidden of ['verified: true', 'liveness_passed', 'face_match_passed',
      'face_liveness_score_decline_threshold', 'face_match_score_decline_threshold',
      'didit_standalone']) {
      expect(PORTAL_API, forbidden).not.toContain(forbidden);
      expect(STEP, forbidden).not.toContain(forbidden);
    }
  });
});

/* ───────────────────── every paid call, as documented ───────────────────── */

describe('the provider calls', () => {
  it('uses the three documented Standalone endpoints', () => {
    expect(CLIENT).toContain("'/v3/id-verification/'");
    expect(CLIENT).toContain("'/v3/passive-liveness/'");
    expect(CLIENT).toContain("'/v3/face-match/'");
  });

  it('never creates a hosted session and never asks for a decision', () => {
    expect(CLIENT).not.toContain('/v3/session/');
    expect(CLIENT).not.toContain('/decision/');
    expect(CLIENT).not.toContain('workflow_id');
    expect(CLIENT).not.toContain('callback');
  });

  it('sends save_api_request=false on every call, from one place', () => {
    // Set in `baseForm`, which every endpoint builds on — so a fourth endpoint
    // cannot be added without it.
    expect(CLIENT).toContain("form.append('save_api_request', 'false')");
    expect(CLIENT.match(/save_api_request/g)?.length).toBeGreaterThanOrEqual(1);
    expect(CLIENT).not.toContain("'save_api_request', 'true'");
  });

  it('asks for document liveness on the ID call', () => {
    expect(CLIENT).toContain("form.append('perform_document_liveness', 'true')");
  });

  it('sends the back image only when one was supplied', () => {
    expect(CLIENT).toMatch(/if \(args\.backImage[\s\S]{0,80}form\.append\('back_image'/);
  });

  it('sends the selfie to liveness and the selfie PLUS the ID portrait to face match', () => {
    const livenessAt = CLIENT.indexOf('export async function checkPassiveLiveness');
    const faceMatchAt = CLIENT.indexOf('export async function compareFaces');
    expect(livenessAt).toBeGreaterThan(0);
    expect(faceMatchAt).toBeGreaterThan(livenessAt);

    const liveness = CLIENT.slice(livenessAt, faceMatchAt);
    expect(liveness).toContain("form.append('user_image'");
    // Liveness takes one face. A reference image here would be a face match.
    expect(liveness).not.toContain("form.append('ref_image'");

    const faceMatch = CLIENT.slice(faceMatchAt, CLIENT.indexOf('export function decodeInlineImage'));
    expect(faceMatch).toContain("form.append('user_image'");
    expect(faceMatch).toContain("form.append('ref_image'");
  });

  it('uses the provider-returned ID portrait as the face-match reference', () => {
    expect(ORCHESTRATOR).toContain('decodeInlineImage(id.portraitBase64)');
    expect(ORCHESTRATOR).toContain('refImage: portraitBytes');
  });

  it('lets fetch generate the multipart boundary — it never writes Content-Type', () => {
    // Writing `multipart/form-data` by hand omits the boundary parameter and
    // every request becomes an unparseable body that reads like a bad image.
    const post = code(CLIENT.slice(
      CLIENT.indexOf('async function postMultipart'),
      CLIENT.indexOf('function imagePart('),
    ));
    // No Content-Type key in the request headers, and nothing constructing a
    // boundary by hand.
    expect(post).not.toMatch(/['"]Content-Type['"]\s*:/);
    expect(post).not.toMatch(/boundary\s*[=:]/);
    expect(post).toContain('body: form');
  });

  it('carries the API key in a server-side header and nowhere else', () => {
    expect(CLIENT).toContain("'x-api-key': apiKey");
    // Never in a URL, a body field, or metadata.
    expect(CLIENT).not.toMatch(/api_key=/);
    expect(CLIENT).not.toMatch(/form\.append\([^)]*apiKey/);
  });

  it('redacts the key and any URL out of every error it raises', () => {
    expect(CLIENT).toContain('function redact');
    expect(CLIENT).toContain('out.split(apiKey).join');
  });

  it('never sends customer PII as vendor_data or metadata', () => {
    // vendor_data is the opaque npc:<case>:<party>:<sequence> handle.
    expect(ORCHESTRATOR).toContain('buildVendorData(');
    const metadata = ORCHESTRATOR.slice(ORCHESTRATOR.indexOf('const metadata = {'));
    const block = metadata.slice(0, metadata.indexOf('};') + 2);
    for (const forbidden of ['name', 'email', 'address', 'dob', 'document_number']) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });
});

/* ──────────────────── thresholds are server-owned ──────────────────────── */

describe('thresholds', () => {
  it('come from the function environment and are validated', () => {
    expect(REGISTRY).toContain('readStandaloneThresholds');
    expect(REGISTRY).toContain('DIDIT_LIVENESS_THRESHOLD');
    expect(REGISTRY).toContain('DIDIT_FACE_MATCH_THRESHOLD');
  });

  it('make the provider unusable when missing, rather than falling back', () => {
    // A vendor default of 30 is documented as permissive. Inheriting it would
    // make NPC's compliance position somebody else's default.
    expect(REGISTRY).toMatch(/if \(!apiKey \|\| !thresholds\)[\s\S]{0,200}ProviderResolutionError/);
    expect(REGISTRY).toContain('diditStandaloneConfigured');
  });

  it('are recorded on every attempt as the policy in force at the time', () => {
    expect(ORCHESTRATOR).toContain('thresholds_applied');
    expect(ORCHESTRATOR).toContain('liveness_decline_below');
    expect(ORCHESTRATOR).toContain('face_match_decline_below');
  });

  it('are never projected to the portal', () => {
    const status = PORTAL.slice(PORTAL.indexOf("case 'verification_status':"));
    const body = code(status.slice(0, status.indexOf("case 'start_hosted_verification':")));
    // Field names, not prose: the surrounding comments say the word "score"
    // precisely because none of it crosses the wire.
    for (const field of ['threshold', 'score', 'liveness', 'face_match', 'warnings']) {
      expect(body, field).not.toMatch(new RegExp(`\\b${field}\\w*\\s*:`));
    }
  });
});

/* ─────────────── standalone readiness excludes hosted secrets ───────────── */

describe('provider readiness', () => {
  it('does not require a workflow id or a webhook secret', () => {
    // Readiness is decided by `standaloneIdvReadiness`, which reads the key and
    // the two thresholds and nothing else. There is no workflow on this path,
    // and with save_api_request=false no webhook is ever emitted — requiring
    // either would refuse a correctly configured deployment.
    const fn = REGISTRY.slice(REGISTRY.indexOf('export function standaloneIdvReadiness'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('DIDIT_API_KEY');
    expect(body).toContain('DIDIT_LIVENESS_THRESHOLD');
    expect(body).toContain('DIDIT_FACE_MATCH_THRESHOLD');
    expect(body).not.toContain('DIDIT_WORKFLOW_ID');
    expect(body).not.toContain('DIDIT_WEBHOOK_SECRET');
    expect(REGISTRY).toContain('function diditStandaloneConfigured');
  });

  it('gates the capture UI, not just the submission', () => {
    // The camera must never open against a provider that cannot judge the
    // result — collecting a face with no purpose that can be served (APP 3).
    const prepare = PORTAL.slice(PORTAL.indexOf("case 'prepare_verification_attempt':"));
    const body = prepare.slice(0, prepare.indexOf("case 'submit_verification_attempt':"));
    expect(body).toContain("availability !== 'available'");
    expect(body).toContain('biometric_consent_required');
    expect(body).toContain('attempts_exhausted');
    // And the refusal happens before any storage grant is issued.
    expect(body.indexOf("availability !== 'available'"))
      .toBeLessThan(body.indexOf('createSignedUploadUrl'));
    expect(body.indexOf('biometric_consent_required'))
      .toBeLessThan(body.indexOf('createSignedUploadUrl'));
  });
});

/* ──────────────────────── storage is server-named ──────────────────────── */

describe('storage', () => {
  it('names every capture path on the server, from the attempt id', () => {
    expect(PORTAL).toContain('function capturePaths(caseId: string, attemptId: string)');
    expect(PORTAL).toContain('`${caseId}/verification/${attemptId}`');
  });

  it('keeps the selfie in the biometrics bucket and the document in documents', () => {
    expect(PORTAL).toMatch(/document_front: 'aml-documents'/);
    expect(PORTAL).toMatch(/document_back: 'aml-documents'/);
    expect(PORTAL).toMatch(/selfie: 'aml-biometrics'/);
  });

  it('never accepts a storage path on the submission', () => {
    const submit = PORTAL.slice(PORTAL.indexOf("case 'submit_verification_attempt':"));
    const body = submit.slice(0, submit.indexOf("case 'request_verification_upload_url':"));
    expect(body).not.toContain('body.document_storage_path');
    expect(body).not.toContain('body.selfie_storage_path');
    expect(body).not.toContain('body.storage_path');
    expect(body).not.toContain('body.bucket');
    // Paths come off the prepared row.
    expect(body).toContain('plan.objects.document_front.path');
    expect(body).toContain('plan.objects.selfie.path');
  });

  it('scopes the attempt lookup to the caller’s own case', () => {
    const submit = PORTAL.slice(PORTAL.indexOf("case 'submit_verification_attempt':"));
    const body = submit.slice(0, submit.indexOf("case 'request_verification_upload_url':"));
    expect(body).toMatch(/\.eq\('id', attemptId\)[\s\S]{0,120}\.eq\('case_id', c\.id\)/);
  });

  it('checks every required object exists, its size and its type', () => {
    const submit = PORTAL.slice(PORTAL.indexOf("case 'submit_verification_attempt':"));
    const body = submit.slice(0, submit.indexOf("case 'request_verification_upload_url':"));
    expect(body).toContain('inspectCapture');
    expect(body).toContain('MIN_CAPTURE_BYTES');
    expect(body).toContain('MAX_CAPTURE_BYTES');
    expect(body).toContain('ACCEPTED_CAPTURE_MIME');
    expect(body).toContain('capture_incomplete');
  });

  it('requires the back only where the chosen document has one', () => {
    const submit = PORTAL.slice(PORTAL.indexOf("case 'submit_verification_attempt':"));
    const body = submit.slice(0, submit.indexOf("case 'request_verification_upload_url':"));
    expect(body).toContain('identityDocumentCapturePlan(documentChoice)');
    expect(body).toContain('if (!required[kind]) continue');
  });

  it('creates no public bucket and returns no permanent read URL', () => {
    expect(MIGRATION).not.toMatch(/public\s*=\s*true/i);
    expect(PORTAL).not.toContain('getPublicUrl');
  });
});

/* ───────────────── attempts, idempotency and concurrency ───────────────── */

describe('the attempt allowance', () => {
  it('prepares a DRAFT, which the attempt counter cannot see', () => {
    expect(PORTAL).toContain("processing_status: 'draft'");
    expect(PORTAL).toContain('attempt_consumed: false');
    expect(MIGRATION).toContain("'draft'");
    // The counter counts consumed attempts, not rows.
    expect(MIGRATION).toContain('aml.verification_attempts_used()');
  });

  it('enforces one draft per party in the database, not only in code', () => {
    expect(MIGRATION).toContain('uq_aml_verification_draft_capture');
    expect(MIGRATION).toMatch(/WHERE check_type = 'electronic_idv'\s+AND processing_status = 'draft'/);
  });

  it('adopts an existing draft when it loses the race', () => {
    const prepare = PORTAL.slice(PORTAL.indexOf("case 'prepare_verification_attempt':"));
    const body = prepare.slice(0, prepare.indexOf("case 'submit_verification_attempt':"));
    expect(body).toContain("insert.error.code === '23505'");
    expect(body).toContain('draftCaptureAttempt(admin, c.id, partyId)');
  });

  it('submits by a conditional transition, so a double tap queues once', () => {
    const submit = PORTAL.slice(PORTAL.indexOf("case 'submit_verification_attempt':"));
    const body = submit.slice(0, submit.indexOf("case 'request_verification_upload_url':"));
    expect(body).toMatch(/processing_status: 'queued'[\s\S]{0,600}\.eq\('processing_status', 'draft'\)/);
    expect(body).toContain('already_processing');
  });

  it('never consumes an attempt for a technical failure', () => {
    // `recordTechnical` writes processing_status and the category, and
    // deliberately leaves `status` and `attempt_consumed` alone.
    const fn = ORCHESTRATOR.slice(ORCHESTRATOR.indexOf('async function recordTechnical'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain("processing_status: 'technical_failure'");
    expect(body).not.toContain('attempt_consumed');
    expect(body).not.toMatch(/\bstatus:/);
  });

  it('treats an unreadable document as a retake, not a failed identity', () => {
    expect(ORCHESTRATOR).toMatch(
      /category === 'capture_unreadable'[\s\S]{0,300}processing_status: 'capture_unusable'/);
  });
});

describe('duplicate paid requests', () => {
  it('claims a check conditionally before any provider call', () => {
    expect(ORCHESTRATOR).toContain('export async function claimCheck');
    expect(ORCHESTRATOR).toMatch(/\.in\('processing_status', CLAIMABLE_STATES/);
    expect(ORCHESTRATOR).toContain("if (!claimed) return { checkId, outcome: 'not_claimed' }");
    // The claim happens in processStandaloneCheck, which every caller uses.
    expect(PROCESSOR).toContain('processStandaloneCheck');
    expect(CONSUMER).toContain('processStandaloneCheck');
  });

  it('never re-throws from the standalone path, so the outbox cannot re-buy it', () => {
    const branch = CONSUMER.slice(CONSUMER.indexOf('if (isStandaloneIdvProvider'));
    const body = branch.slice(0, branch.indexOf('\n  }') + 4);
    expect(body).toContain('await processStandaloneCheck(db, checkId)');
    expect(body).not.toContain('throw');
  });

  it('records an ambiguous timeout as billing-unknown and stops', () => {
    expect(CLIENT).toContain('billingUnknown');
    expect(CLIENT).toMatch(/aborted \? 'timeout'/);
    expect(ORCHESTRATOR).toContain('billing_unknown');
    // No retry loop anywhere in the client.
    expect(CLIENT).not.toMatch(/for \([^)]*attempt[^)]*\)/);
    expect(CLIENT).not.toContain('retryable');
  });

  it('retires an expired claim instead of re-running it', () => {
    const fn = PROCESSOR.slice(PROCESSOR.indexOf('async function releaseStaleClaims'));
    expect(fn).toContain("processing_status: 'technical_failure'");
    expect(fn).not.toContain('processStandaloneCheck');
  });
});

/* ──────────────────────── the fail-fast sequence ───────────────────────── */

describe('fail-fast ordering', () => {
  it('runs ID, then liveness, then face match — each gated on the last', () => {
    const idAt = ORCHESTRATOR.indexOf('provider.verifyIdentityDocument({');
    const livenessAt = ORCHESTRATOR.indexOf('provider.checkPassiveLiveness({');
    const faceAt = ORCHESTRATOR.indexOf('provider.compareFaces({');
    expect(idAt).toBeGreaterThan(0);
    expect(livenessAt).toBeGreaterThan(idAt);
    expect(faceAt).toBeGreaterThan(livenessAt);

    expect(ORCHESTRATOR).toContain('if (mayProceed(id.verdict))');
    expect(ORCHESTRATOR).toContain('if (liveness && mayProceed(liveness.verdict) && portraitBytes)');
  });

  it('downloads the captures before spending anything', () => {
    expect(ORCHESTRATOR.indexOf('storage_unreadable'))
      .toBeLessThan(ORCHESTRATOR.indexOf('provider.verifyIdentityDocument({'));
  });
});

/* ───────────────────── evidence and data retention ─────────────────────── */

describe('what is written to the case record', () => {
  it('passes every persisted payload through the sanitiser', () => {
    // The reader scrubs by name; `stripImagePayloads` sweeps by size on top.
    expect(ORCHESTRATOR).toContain('stripImagePayloads');
    expect(ORCHESTRATOR).not.toContain('portraitBase64,');
    // The portrait variable is never written into an update.
    expect(ORCHESTRATOR).not.toMatch(/outcome_detail:[\s\S]{0,400}portrait/);
  });

  it('records the staff-only evidence an adjudicator needs', () => {
    for (const field of ['integration_mode', 'provider_request_ids', 'document_classification',
      'liveness_score', 'face_match_score', 'capture_objects', 'thresholds_applied']) {
      expect(ORCHESTRATOR, field).toContain(field);
    }
  });

  it('keeps the source captures — nothing deletes them after the call', () => {
    expect(ORCHESTRATOR).not.toContain('.remove(');
    expect(PROCESSOR).not.toContain('.remove(');
  });
});

/* ─────────────────────── the hosted flow is legacy ─────────────────────── */

describe('the hosted cutover', () => {
  it('creates no new hosted session from the capture journey', () => {
    const start = STEP.indexOf('function SecureCaptureCheck(');
    const capture = STEP.slice(start);
    expect(capture).not.toContain('startHostedVerification');
  });

  it('keeps the hosted RESULT path wired, while the capture UI is gone', () => {
    /*
     * The adapter and the webhook stay: a late signed outcome for a session
     * that already ran must still settle the canonical record, and removing
     * them would strand it.
     *
     * What changed at the cutover is that no customer can start or resume one.
     * The operation still exists so a cached browser build gets a typed 409
     * rather than an unknown-op error — see hostedIdvRetired.test.ts, which
     * asserts the refusal precedes every other statement in it.
     */
    expect(REGISTRY).toContain('"didit": (opts) => makeDiditIdvProvider(opts)');
    expect(PORTAL).toContain("case 'start_hosted_verification':");
    expect(PORTAL).toContain("code: 'hosted_flow_retired'");
  });

  it('refuses the older single-shot capture ops under the standalone provider', () => {
    expect(PORTAL).toContain('capture_flow_superseded');
  });

  it('records the exact drain condition, in real column and status names', () => {
    const doc = read('docs/aml/DIDIT_STANDALONE_IDV.md');
    expect(doc).toContain("processing_status IN ('submitted', 'queued', 'processing')");
    expect(doc).toContain('superseded_at IS NULL');
    expect(doc).toContain("provider = 'didit'");
  });

  it('answers the portal with `capture` and never names the integration', () => {
    const status = PORTAL.slice(PORTAL.indexOf("case 'verification_status':"));
    const body = status.slice(0, status.indexOf("case 'start_hosted_verification':"));
    // Unconditional since the hosted cutover — see hostedIdvRetired.test.ts.
    expect(body).toContain("provider_flow: 'capture'");
    expect(body).not.toContain("'didit_standalone'");
  });
});

/* ──────────────────── the portal does not storm the server ─────────────── */

describe('status refresh', () => {
  it('polls with a bounded, backing-off schedule that ends', () => {
    expect(STEP).toContain('const PROCESSING_POLL_MS = [');
    const open = STEP.indexOf('const PROCESSING_POLL_MS = [');
    const list = STEP.slice(open + 'const PROCESSING_POLL_MS = ['.length, STEP.indexOf('];', open));
    const delays = (list.match(/\d[\d_]*/g) ?? []).map((n) => Number(n.replace(/_/g, '')));
    expect(delays.length).toBeGreaterThan(3);
    // Strictly increasing: a flat interval is how a page left open becomes a
    // request storm.
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(2_000);
  });

  it('uses setTimeout with an explicit end, never setInterval', () => {
    const start = STEP.indexOf('function SecureCaptureCheck(');
    const capture = STEP.slice(start);
    expect(capture).not.toContain('setInterval');
    expect(capture).toContain('index < PROCESSING_POLL_MS.length');
  });

  it('keeps the first-read baseline that stopped the portal blinking', () => {
    // Announcing a change on the first read reloaded the page, which blanked
    // the portal, which remounted this component, which made the same state
    // look new again. Forever.
    expect(STEP).toContain('baselineCaseRef');
    expect(STEP).toContain('reportedRef.current = signature');
  });
});

/* ───────────────────────── processor access ────────────────────────────── */

/* ─────────────── the outbox trigger, and the draft transition ──────────── */

describe('the durable event a submitted draft has to emit', () => {
  // `lastIndexOf` for the DROP: the ROLLBACK comment at the top of the
  // migration names the same statement, and slicing to the FIRST occurrence
  // produced an empty string that every assertion then passed against.
  const emitFn = MIGRATION.slice(
    MIGRATION.indexOf('CREATE OR REPLACE FUNCTION aml.tg_emit_verification_requested'),
    MIGRATION.lastIndexOf('DROP TRIGGER IF EXISTS trg_aml_verification_outbox'));

  it('fires on UPDATE as well as INSERT', () => {
    /*
     * Measured against production before writing the migration: the trigger
     * there is `tgtype = 5` — ROW (1) + INSERT (4), and no UPDATE bit. A
     * Standalone attempt is INSERTed as a draft and becomes queued by an
     * UPDATE, so on the old trigger the durable event was never written and
     * the outbox path silently did not exist for the new flow.
     */
    expect(MIGRATION).toContain('AFTER INSERT OR UPDATE ON aml.verification_checks');
  });

  it('emits only for a queued or submitted check that has a capture', () => {
    expect(emitFn).toContain("NEW.processing_status IN ('submitted', 'queued')");
    // The condition from 20260908000000 stays: a hosted-session check has no
    // NPC-held document and must never enter the image worker.
    expect(emitFn).toContain('NEW.document_reference IS NOT NULL');
  });

  it('cannot emit for a draft', () => {
    // `draft` is absent from the emitting states, so preparing an attempt
    // writes no event — which is what makes preparation free.
    const states = emitFn.match(/NEW\.processing_status IN \(([^)]*)\)/)?.[1] ?? '';
    expect(states).not.toContain('draft');
  });

  it('de-duplicates per row, so a second UPDATE emits nothing new', () => {
    // The key is the row id, and the insert is ON CONFLICT DO NOTHING — so a
    // row emits exactly once however many times it is updated into an
    // emitting state.
    expect(emitFn).toContain("'aml-verify-' || NEW.id::text");
    expect(emitFn).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
  });

  it('asserts at apply time that the UPDATE bit actually took', () => {
    // A silent no-op here would mean submitted attempts emitting no durable
    // event in production, which is invisible until somebody is stranded.
    expect(MIGRATION).toContain('(t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16');
    expect(MIGRATION).toContain('does not fire on UPDATE');
  });
});

describe('the draft transition', () => {
  const submit = PORTAL.slice(
    PORTAL.indexOf("case 'submit_verification_attempt':"),
    PORTAL.indexOf("case 'request_verification_upload_url':"));

  it('sets document_reference in the same update that queues the attempt', () => {
    // The trigger keys on `document_reference IS NOT NULL`, so setting it in a
    // later statement would emit nothing.
    const update = submit.slice(submit.indexOf(".update({\n            processing_status: 'queued'"));
    const block = update.slice(0, update.indexOf('.eq('));
    expect(block).toContain("processing_status: 'queued'");
    expect(block).toContain('document_reference:');
  });

  it('only ever transitions FROM draft', () => {
    expect(submit).toContain(".eq('processing_status', 'draft')");
  });
});

describe('the processor', () => {
  it('accepts signed internal callers only', () => {
    expect(PROCESSOR).toContain('verifySignedInternal');
    expect(PROCESSOR).toContain("['pg_cron', 'aml-client-portal', 'aml-verification']");
    expect(PROCESSOR).not.toContain('x-portal-session-token');
  });

  it('is dispatched without blocking the customer’s request', () => {
    const submit = PORTAL.slice(PORTAL.indexOf("case 'submit_verification_attempt':"));
    const body = submit.slice(0, submit.indexOf("case 'request_verification_upload_url':"));
    expect(body).toContain("callInternalFunction(\n          'aml-verification-processor'");
    expect(body).not.toContain('await callInternalFunction');
    expect(body).toContain('waitUntil');
  });

  it('is also driven by a schedule, so a lost dispatch cannot strand anybody', () => {
    const schedule = read(
      'supabase/migrations/20260911000100_aml_verification_processor_schedule.sql');
    expect(schedule).toContain('aml-verification-processor');
    expect(schedule).toContain("'* * * * *'");
    expect(schedule).toContain('cron_invoke_signed_function');
  });

  it('leaves the self-hosted capture path to the outbox worker', () => {
    expect(PROCESSOR).toContain('isStandaloneIdvProvider(row.provider)');
  });

  it('runs on its own schedule, not the retention one', () => {
    const processorCron = read(
      'supabase/migrations/20260911000100_aml_verification_processor_schedule.sql');
    const retentionCron = read(
      'supabase/migrations/20260911000200_aml_idv_capture_retention.sql');
    // Different jobs, different cadences, different blast radii. Coupling them
    // would put deletion of evidence on a one-minute loop.
    expect(processorCron).toContain("'aml-verification-processor-1min'");
    expect(retentionCron).toContain("'aml-idv-retention-daily'");
    expect(processorCron).not.toContain('aml-idv-retention');
    expect(retentionCron).not.toContain('aml-verification-processor');
  });
});

/* ────────────── implementing is not the same as switching on ───────────── */

describe('deploying this changes nobody’s journey', () => {
  it('seeds the provider INACTIVE', () => {
    // The whole point of the separation: migrations and functions can ship,
    // and the customer still meets exactly the flow they met yesterday until
    // an operator decides otherwise.
    expect(MIGRATION).toMatch(/20, 'USD', false, 'live', 'DIDIT_API_KEY'/);
    // The activation statements exist only as commented instructions.
    const activations = [...MIGRATION.matchAll(/^\s*--\s*UPDATE aml\.provider_configs SET active/gm)];
    expect(activations.length).toBeGreaterThanOrEqual(2);
    // …and no executable statement flips it on.
    const executable = MIGRATION.split('\n')
      .filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(executable).not.toMatch(/UPDATE aml\.provider_configs\s+SET active\s*=\s*true/i);
  });

  it('cannot have two IDV providers serving new attempts at once', () => {
    // The resolver takes the single highest-priority ACTIVE row, so even a
    // mis-set pair resolves deterministically rather than alternating.
    const resolver = REGISTRY.slice(REGISTRY.indexOf('export async function resolveTenantProvider'));
    const body = resolver.slice(0, resolver.indexOf('\n}'));
    expect(body).toContain('.eq("active", true)');
    expect(body).toContain('.order("priority", { ascending: true })');
    expect(body).toContain('.limit(1)');
    // And the standalone row outranks the hosted one, so the safe direction
    // wins a misconfiguration: NPC's own camera, never a surprise popup.
    expect(MIGRATION).toMatch(/'Didit Standalone APIs \(NPC capture\)', 5,/);
  });
});

/* ─────────────────── staff diagnostics and cost metadata ───────────────── */

describe('an operator can tell WHICH thing is unconfigured', () => {
  const VERIFICATION = read('supabase/functions/aml-verification/index.ts');

  it('separates a missing credential from a missing threshold from a bad one', () => {
    expect(REGISTRY).toContain('export function standaloneIdvReadiness');
    expect(REGISTRY).toContain('api_key_present');
    expect(REGISTRY).toContain('liveness_threshold');
    expect(REGISTRY).toContain('face_match_threshold');
    // "missing" and "invalid" are different faults with opposite fixes: a
    // secret nobody set, versus one set to 0.6 on a 0-100 scale.
    expect(REGISTRY).toContain('classifyThreshold');
  });

  it('is reported on the staff readiness endpoint only', () => {
    expect(VERIFICATION).toContain('standalone_readiness: standaloneReadiness');
    // Never on the customer's side.
    expect(PORTAL).not.toContain('standaloneIdvReadiness');
    expect(PORTAL_API).not.toContain('standalone_readiness');
    expect(STEP).not.toContain('standalone_readiness');
  });

  it('does not ask a Standalone deployment for hosted-only secrets', () => {
    // There is no workflow and no webhook on this path, so reporting them
    // would send an operator hunting for a secret that is correctly absent.
    const secrets = VERIFICATION.slice(
      VERIFICATION.indexOf('const isStandalone = capability === "idv"'),
      VERIFICATION.indexOf('const standaloneReadiness'));
    const standaloneBranch = secrets.slice(secrets.indexOf('} : isStandalone ? {'));
    expect(standaloneBranch).toContain('DIDIT_LIVENESS_THRESHOLD');
    expect(standaloneBranch).toContain('DIDIT_FACE_MATCH_THRESHOLD');
    expect(standaloneBranch).not.toContain('DIDIT_WEBHOOK_SECRET');
    expect(standaloneBranch).not.toContain('DIDIT_WORKFLOW_ID');
  });

  it('reports presence and validity, never a value', () => {
    const fn = REGISTRY.slice(REGISTRY.indexOf('export function standaloneIdvReadiness'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // Every read is reduced to a boolean or a state word before it is returned.
    expect(body).toContain('Boolean(Deno.env.get("DIDIT_API_KEY"))');
    expect(body).not.toMatch(/return[\s\S]*Deno\.env\.get\("DIDIT_LIVENESS_THRESHOLD"\)\s*[,}]/);
  });
});

describe('a paid integration does not report as free', () => {
  it('records the per-call price of each endpoint, not one flat figure', () => {
    // `cost_per_unit_cents` is added to provider_metrics_daily.cost_cents_sum
    // once per SUCCESSFUL call and rendered as "30-day cost". Didit prices the
    // three endpoints separately, so one figure would misreport every attempt.
    expect(MIGRATION).toContain('standalone_unit_costs_cents');
    expect(MIGRATION).toContain("'id_verification', 20");
    expect(MIGRATION).toContain("'passive_liveness', 5");
    expect(MIGRATION).toContain("'face_match', 5");
    expect(MIGRATION).toContain("'pricing_currency', 'USD'");
    expect(MIGRATION).toContain('pricing_source');
  });

  it('is not seeded at zero', () => {
    // A growing spend reported as free is the one answer worse than an
    // imprecise number.
    expect(MIGRATION).not.toMatch(/'didit_standalone',[\s\S]{0,200}\n\s*0, 'AUD'/);
    expect(MIGRATION).toMatch(/20, 'USD', false, 'live'/);
  });

  it('meters each step at its own price', () => {
    expect(ORCHESTRATOR).toContain("meter('id_verification'");
    expect(ORCHESTRATOR).toContain("meter('passive_liveness'");
    expect(ORCHESTRATOR).toContain("meter('face_match'");
    expect(ORCHESTRATOR).toContain('standalone_unit_costs_cents');
    // A fail-fast sequence therefore costs what it actually cost: the later
    // steps never ran, so they are never metered.
    expect(ORCHESTRATOR).toContain('costCents: stepCost(step)');
  });

  it('falls back to the column when a deployment predates the map', () => {
    expect(ORCHESTRATOR).toContain('resolved?.costCents ?? 0');
  });
});
