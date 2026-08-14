/**
 * The Standalone identity verification sequence.
 *
 * One customer submission → three billed provider calls → one canonical
 * `aml.verification_checks` outcome. This module owns the order, the money and
 * the settlement; it is the only place any of the three is decided.
 *
 * ## Where it runs
 *
 * Server-side only, and never inside the request that the customer is waiting
 * on. Two callers, one implementation:
 *
 *   - `aml-verification-processor`, invoked directly by the portal the moment a
 *     submission is accepted (so the wait is seconds) and by pg_cron as the
 *     watchdog (so a killed isolate does not strand anybody);
 *   - `cross-portal-outbox-worker`, if the durable `aml.verification.requested`
 *     event is ever driven.
 *
 * All three race safely, because every one of them has to win the same
 * conditional claim before it can spend a cent.
 *
 * ## The rule that shapes everything else: these calls cost money
 *
 * Didit bills per 200 response and publishes no idempotency key —
 * `vendor_data` is documented as an opaque correlation string and explicitly
 * NOT as one. Three consequences run through this file:
 *
 *  1. **One owner per attempt.** `claimCheck` is a conditional UPDATE from a
 *     queued state to `processing`. A double-click, a second tab, a re-fired
 *     cron sweep and a redelivered outbox event all lose it and walk away, so
 *     the sequence runs at most once per submission.
 *  2. **Nothing here ever throws to trigger a retry.** The outbox machinery
 *     retries a throwing consumer with exponential backoff up to ten times.
 *     For a free consumer that is correct; for this one it would be ten
 *     unattended purchases of the same verification. Every failure is recorded
 *     on the row and the function returns normally. The retry is a human or a
 *     fresh customer submission — a controlled one.
 *  3. **An ambiguous timeout stops the sequence.** A request that left and
 *     whose response never arrived has an unknown billing state. It is recorded
 *     as `timeout` with `billing_unknown`, it consumes no attempt, and nothing
 *     re-sends it.
 *
 * ## What the customer's allowance is spent on
 *
 * Only an authoritative examination. `canonicalOutcome` — shared with the
 * self-hosted path and the staff re-run — is the single place that decides,
 * and it consumes nothing for a capture the provider could not examine. Every
 * technical condition on this path lands in `processing_status` +
 * `provider_error_category` and leaves `status` alone.
 */

import {
  getStandaloneIdvProvider,
  resolveTenantProvider,
  runWithMetrics,
  currentEnvironment,
  ProviderResolutionError,
  type StandaloneIdvProvider,
} from './providers/index.ts';
import {
  composeStandaloneOutcome,
  readFaceMatch,
  readIdVerification,
  readLiveness,
  mayProceed,
  type IdVerificationReading,
  type LivenessReading,
  type FaceMatchReading,
  type StandaloneErrorCategory,
} from './providers/diditStandalone.pure.ts';
import {
  DiditStandaloneError, decodeInlineImage, readStandaloneEnvConfig,
} from './providers/diditStandaloneClient.ts';
import { canonicalOutcome } from './verificationOutcome.pure.ts';
import { stripImagePayloads } from './verificationEvidence.pure.ts';
import { buildVendorData } from './providers/didit.pure.ts';
import {
  parseDocumentChoice, identityDocumentCapturePlan,
  type IdentityDocumentChoice,
} from './identityDocuments.pure.ts';

/** Matches MAX_VERIFICATION_ATTEMPTS in aml-client-portal and the DB counter. */
export const MAX_VERIFICATION_ATTEMPTS = 3;

/** Processing states a check may be claimed from. */
export const CLAIMABLE_STATES = ['submitted', 'queued', 'retry_scheduled'] as const;

/**
 * The capture plan the portal wrote when it prepared the attempt.
 *
 * Held on the row rather than recomputed, so the objects the server generated
 * paths for are exactly the objects it later downloads. Recomputing would open
 * the gap this design exists to close: the browser tells us an attempt id and
 * nothing else, and every path comes from here.
 */
export interface StandaloneCapturePlan {
  document_choice: IdentityDocumentChoice;
  objects: {
    document_front: { bucket: string; path: string };
    document_back: { bucket: string; path: string } | null;
    selfie: { bucket: string; path: string };
  };
}

export function readCapturePlan(check: any): StandaloneCapturePlan | null {
  const raw = check?.outcome_detail?.standalone_capture;
  if (!raw || typeof raw !== 'object') return null;
  const choice = parseDocumentChoice(raw.document_choice);
  const objects = raw.objects;
  if (!choice || !objects || typeof objects !== 'object') return null;
  const object = (v: unknown) => {
    if (!v || typeof v !== 'object') return null;
    const bucket = String((v as any).bucket ?? '');
    const path = String((v as any).path ?? '');
    return bucket && path ? { bucket, path } : null;
  };
  const front = object(objects.document_front);
  const selfie = object(objects.selfie);
  if (!front || !selfie) return null;
  return {
    document_choice: choice,
    objects: {
      document_front: front,
      document_back: object(objects.document_back),
      selfie,
    },
  };
}

async function download(db: any, bucket: string, path: string): Promise<Uint8Array> {
  const res = await db.storage.from(bucket).download(path);
  if (res.error || !res.data) throw new Error(`storage_unreadable:${bucket}/${path}`);
  return new Uint8Array(await res.data.arrayBuffer());
}

/**
 * Take exclusive ownership of a check.
 *
 * The conditional `in(...)` is the whole concurrency model: Postgres serialises
 * the UPDATE, the winner gets a row back and the losers get null. Nothing below
 * this line can run twice for one submission, which is what stops a
 * double-click from becoming two invoices.
 */
export async function claimCheck(db: any, checkId: string): Promise<any | null> {
  // `processing_attempts` is read first so the increment reflects the row we
  // are about to claim; a lost race writes nothing at all, so it cannot drift.
  const { data: before } = await db.schema('aml').from('verification_checks')
    .select('processing_attempts').eq('id', checkId).maybeSingle();

  const { data } = await db.schema('aml').from('verification_checks')
    .update({
      processing_status: 'processing',
      processing_started_at: new Date().toISOString(),
      processing_attempts: Number(before?.processing_attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', checkId)
    .in('processing_status', CLAIMABLE_STATES as unknown as string[])
    .is('superseded_at', null)
    .eq('status', 'pending')
    .select('*').maybeSingle();
  return data ?? null;
}

/** Attempts this party has actually spent — never the row count. */
async function attemptsConsumed(
  db: any, caseId: string, partyId: string | null,
): Promise<number> {
  const { data, error } = await db.schema('aml')
    .rpc('verification_attempts_used', { p_case_id: caseId, p_party_id: partyId });
  if (!error && typeof data === 'number') return data;
  let q = db.schema('aml').from('verification_checks')
    .select('id').eq('case_id', caseId).eq('check_type', 'electronic_idv')
    .eq('attempt_consumed', true);
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const fallback = await q;
  return (fallback.data ?? []).length;
}

/**
 * Record a technical condition and stop.
 *
 * `status` is deliberately untouched. A provider outage, an empty credit
 * balance, a rate limit, an unreadable object and an ambiguous timeout are all
 * conditions of NPC's infrastructure or its supplier — none of them is
 * something the customer did, so none of them may look like one.
 */
async function recordTechnical(
  db: any, check: any, category: StandaloneErrorCategory | string,
  message: string, extra: Record<string, unknown> = {},
): Promise<void> {
  await db.schema('aml').from('verification_checks').update({
    processing_status: 'technical_failure',
    provider_error_category: category,
    failure_reason: String(message).slice(0, 300),
    processing_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    outcome_detail: stripImagePayloads({
      ...(check.outcome_detail ?? {}),
      standalone: { ...(check.outcome_detail?.standalone ?? {}), ...extra },
    }),
  }).eq('id', check.id);
}

export interface StandaloneRunResult {
  checkId: string;
  outcome:
  | 'verified' | 'failed' | 'referred' | 'exhausted'
  | 'retake_required' | 'technical_failure' | 'not_claimed';
}

/**
 * Run the whole sequence for one claimed check.
 *
 * `check` must already be claimed — call `claimCheck` first. Splitting the two
 * keeps the claim testable on its own and makes it impossible to write a caller
 * that runs the sequence without one.
 */
export async function runStandaloneVerification(
  db: any, check: any,
): Promise<StandaloneRunResult> {
  const checkId = String(check.id);

  const plan = readCapturePlan(check);
  if (!plan) {
    // The row was prepared by something that did not write a plan, or the plan
    // was damaged. Nothing can be downloaded and no call may be made.
    await recordTechnical(db, check, 'worker_failure',
      'standalone check has no capture plan');
    return { checkId, outcome: 'technical_failure' };
  }

  const required = identityDocumentCapturePlan(plan.document_choice);

  let provider: StandaloneIdvProvider;
  let resolved: Awaited<ReturnType<typeof resolveTenantProvider>> = null;
  try {
    resolved = await resolveTenantProvider(db, 'default', 'idv');
    provider = getStandaloneIdvProvider({ resolved, admin: db });
  } catch (err: any) {
    const category = err instanceof ProviderResolutionError
      && err.code === 'provider_misconfigured'
      ? 'provider_misconfigured' : 'provider_not_configured';
    await recordTechnical(db, check, category, String(err?.message ?? err));
    return { checkId, outcome: 'technical_failure' };
  }

  /**
   * Which Didit deployment this run is about to spend against.
   *
   * The Standalone APIs leave nothing to inspect in the Didit console
   * (`save_api_request=false` persists no session there), so when a charge
   * appears against an unexpected balance the only evidence is here. The
   * key suffix matches the `…XXXX` preview the Didit console shows for each
   * application's key, so one log line answers "which application, which
   * environment" — and nothing logged is secret: no key, no token, no URL
   * with credentials, no customer data.
   */
  const envConfig = readStandaloneEnvConfig();
  console.info('[aml-verification] standalone run', JSON.stringify({
    check_id: checkId,
    environment: currentEnvironment(),
    provider: provider.name,
    api_base: Deno.env.get('DIDIT_API_BASE_URL') || 'https://verification.didit.me',
    api_key_suffix: envConfig.apiKey ? `…${envConfig.apiKey.slice(-4)}` : null,
  }));

  // Captures first: a missing object costs nothing to discover and must be
  // discovered before any paid call.
  let frontBytes: Uint8Array;
  let backBytes: Uint8Array | null = null;
  let selfieBytes: Uint8Array;
  try {
    frontBytes = await download(
      db, plan.objects.document_front.bucket, plan.objects.document_front.path);
    if (required.document_back) {
      if (!plan.objects.document_back) throw new Error('storage_unreadable:document_back');
      backBytes = await download(
        db, plan.objects.document_back.bucket, plan.objects.document_back.path);
    }
    selfieBytes = await download(db, plan.objects.selfie.bucket, plan.objects.selfie.path);
  } catch (err: any) {
    await recordTechnical(db, check, 'storage_unreadable', String(err?.message ?? err));
    return { checkId, outcome: 'technical_failure' };
  }

  /**
   * The correlation handle sent to the provider.
   *
   * Opaque, internal, and never a name, an email or a document number. It is
   * echoed back on the response and is what ties a provider request id to an
   * NPC attempt in the evidence record. It is NOT an idempotency key and is
   * never treated as one — Didit does not document it as one.
   */
  const vendorData = buildVendorData(
    check.case_id, check.party_id ?? null, check.capture_sequence ?? check.attempt_number ?? 1);
  const metadata = {
    npc_verification_check_id: checkId,
    npc_capture_sequence: check.capture_sequence ?? check.attempt_number ?? 1,
  };

  /**
   * The policy in force for THIS attempt, recorded with it.
   *
   * A threshold is a compliance decision, and it can be changed. Without this,
   * a reviewer six months from now reading a face-match score of 62 would have
   * no way to know whether it passed under the policy that applied on the day.
   * Staff-only: nothing in the portal projection reads it.
   */
  const evidenceBase: Record<string, unknown> = {
    integration_mode: 'standalone',
    provider: provider.name,
    save_api_request: false,
    document_choice: plan.document_choice,
    required_captures: required,
    thresholds_applied: {
      liveness_decline_below: provider.thresholds.liveness,
      face_match_decline_below: provider.thresholds.faceMatch,
    },
    started_at: new Date().toISOString(),
  };

  const persistProgress = async (extra: Record<string, unknown>) => {
    await db.schema('aml').from('verification_checks').update({
      outcome_detail: stripImagePayloads({
        ...(check.outcome_detail ?? {}),
        standalone: { ...evidenceBase, ...extra },
      }),
      updated_at: new Date().toISOString(),
    }).eq('id', checkId);
  };

  /**
   * Meter one billed step, at that step's own price.
   *
   * `runWithMetrics` adds `costCents` to `provider_metrics_daily.cost_cents_sum`
   * once per successful call, and the Command Centre renders that sum as the
   * 30-day spend. Didit prices the three endpoints separately — ID 20c,
   * liveness 5c, face match 5c — so passing one flat figure for all three would
   * misreport every attempt: three times over on a full pass, and by more on a
   * sequence that stopped at the first step.
   *
   * Per-step pricing makes the fail-fast sequence account correctly by
   * construction. A declined document records 20 and nothing else, because the
   * later steps genuinely never happened. `cost_per_unit_cents` is the fallback
   * when a deployment's config predates the map.
   */
  const unitCosts = (resolved?.config?.['standalone_unit_costs_cents'] ?? {}) as
    Record<string, unknown>;
  const stepCost = (step: 'id_verification' | 'passive_liveness' | 'face_match'): number => {
    const value = unitCosts[step];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : (resolved?.costCents ?? 0);
  };

  const meter = <T>(
    step: 'id_verification' | 'passive_liveness' | 'face_match', fn: () => Promise<T>,
  ) => runWithMetrics(db, {
    tenantId: 'default', capability: 'idv', providerKey: provider.name,
    costCents: stepCost(step), configId: resolved?.configId ?? null,
  }, fn);

  /* ── Step A: ID verification ─────────────────────────────────────────── */

  let id: IdVerificationReading;
  try {
    const body = await meter('id_verification', () => provider.verifyIdentityDocument({
      frontImage: frontBytes,
      backImage: required.document_back ? backBytes : null,
      vendorData, metadata,
    }));
    id = readIdVerification(body);
  } catch (err: any) {
    return await handleProviderError(db, check, 'id_verification', err, evidenceBase, checkId);
  }

  // The portrait exists in this variable and nowhere else. It is never
  // persisted, never logged and never returned — `id.sanitised` (what goes to
  // the database) has it removed by name.
  const portraitBytes = decodeInlineImage(id.portraitBase64);

  await persistProgress({ id_verification: id.sanitised, id_verdict: id.verdict });

  let liveness: LivenessReading | null = null;
  let faceMatch: FaceMatchReading | null = null;

  /* ── Step B: passive liveness — only if A was conclusive and clean ───── */

  if (mayProceed(id.verdict)) {
    try {
      const body = await meter('passive_liveness', () => provider.checkPassiveLiveness({
        userImage: selfieBytes, vendorData, metadata,
      }));
      liveness = readLiveness(body);
    } catch (err: any) {
      return await handleProviderError(db, check, 'passive_liveness', err, {
        ...evidenceBase, id_verification: id.sanitised, id_verdict: id.verdict,
      }, checkId);
    }
    await persistProgress({
      id_verification: id.sanitised, id_verdict: id.verdict,
      liveness: liveness.sanitised, liveness_verdict: liveness.verdict,
    });
  }

  /* ── Step C: face match 1:1 — only if B was conclusive and clean ─────── */

  //
  // A missing portrait is NOT an error and does not reach the provider. The
  // document was approved but carried no usable cropped face, so there is
  // nothing to compare a selfie against: `faceMatch` stays null, the
  // composition reads that as a step that never ran, and the attempt settles as
  // a referral. Calling Face Match with the whole document page instead would
  // be paying for a comparison against a photograph of a page.
  if (liveness && mayProceed(liveness.verdict) && portraitBytes) {
    try {
      const body = await meter('face_match', () => provider.compareFaces({
        userImage: selfieBytes, refImage: portraitBytes, vendorData, metadata,
      }));
      faceMatch = readFaceMatch(body);
    } catch (err: any) {
      return await handleProviderError(db, check, 'face_match', err, {
        ...evidenceBase, id_verification: id.sanitised, id_verdict: id.verdict,
        liveness: liveness.sanitised, liveness_verdict: liveness.verdict,
      }, checkId);
    }
  }

  /* ── Settle ──────────────────────────────────────────────────────────── */

  const composition = composeStandaloneOutcome({
    claimed: plan.document_choice, id, liveness, faceMatch,
  });

  const outcome = canonicalOutcome(
    { status: composition.status, raw: {} },
    {
      attemptsConsumed: await attemptsConsumed(db, check.case_id, check.party_id ?? null),
      maxAttempts: MAX_VERIFICATION_ATTEMPTS,
    },
  );

  const evidence = stripImagePayloads({
    ...(check.outcome_detail ?? {}),
    standalone: {
      ...evidenceBase,
      completed_at: new Date().toISOString(),
      id_verification: id.sanitised,
      id_verdict: id.verdict,
      liveness: liveness?.sanitised ?? null,
      liveness_verdict: liveness?.verdict ?? 'not_reached',
      liveness_score: liveness?.score ?? null,
      face_match: faceMatch?.sanitised ?? null,
      face_match_verdict: faceMatch?.verdict ?? 'not_reached',
      face_match_score: faceMatch?.score ?? null,
      face_match_reference: portraitBytes ? 'id_portrait' : 'unavailable',
      document_classification: composition.consistency,
      checks: composition.checks,
      provider_request_ids: {
        id_verification: id.requestId,
        passive_liveness: liveness?.requestId ?? null,
        face_match: faceMatch?.requestId ?? null,
      },
      capture_objects: plan.objects,
    },
  });

  if (outcome.processingStatus === 'capture_unusable') {
    // The provider looked and could not examine identity. No identity outcome,
    // NO attempt consumed — the customer photographs it again.
    await db.schema('aml').from('verification_checks').update({
      processing_status: outcome.processingStatus,
      provider_error_category: outcome.providerErrorCategory,
      provider: provider.name,
      provider_attempt_reference: id.requestId,
      outcome_detail: evidence,
      processing_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', checkId);
    return { checkId, outcome: 'retake_required' };
  }

  await db.schema('aml').from('verification_checks').update({
    status: outcome.status,
    processing_status: outcome.processingStatus,
    attempt_consumed: outcome.attemptConsumed,
    authoritative: true,
    execution_mode: 'live',
    environment: currentEnvironment(),
    provider: provider.name,
    provider_reference: id.requestId,
    provider_attempt_reference: id.requestId,
    outcome_detail: evidence,
    completed_at: new Date().toISOString(),
    processing_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', checkId);

  return { checkId, outcome: outcome.status as StandaloneRunResult['outcome'] };
}

/**
 * A provider call failed. Record what kind of failure, and never a customer
 * outcome.
 *
 * `capture_unreadable` is the one that is about the photograph rather than the
 * infrastructure — a 400 carrying `COULD_NOT_RECOGNIZE_DOCUMENT`. It is
 * recorded as `capture_unusable`, which is the state the portal already renders
 * as "please take the photo again" and which consumes no attempt. Every other
 * category is a technical failure.
 */
async function handleProviderError(
  db: any, check: any, step: string, err: unknown,
  evidence: Record<string, unknown>, checkId: string,
): Promise<StandaloneRunResult> {
  const standalone = err instanceof DiditStandaloneError ? err : null;
  const category: string = standalone?.category ?? 'provider_unavailable';
  const message = String((err as Error)?.message ?? err);

  const detail = {
    ...evidence,
    failed_step: step,
    failed_category: category,
    // The one fact a reconciliation needs and nothing else records: we sent a
    // request whose outcome — and whose billing — we never learned.
    billing_unknown: standalone?.billingUnknown ?? false,
    failed_at: new Date().toISOString(),
  };

  if (category === 'capture_unreadable') {
    await db.schema('aml').from('verification_checks').update({
      processing_status: 'capture_unusable',
      provider_error_category: 'capture_unusable',
      failure_reason: message.slice(0, 300),
      outcome_detail: stripImagePayloads({
        ...(check.outcome_detail ?? {}), standalone: detail,
      }),
      processing_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', checkId);
    return { checkId, outcome: 'retake_required' };
  }

  await recordTechnical(db, check, category, message, detail);
  return { checkId, outcome: 'technical_failure' };
}

/**
 * Claim and run, in one call.
 *
 * Returns `not_claimed` when somebody else already owns the check — which is a
 * normal, expected result of the design and not an error: it is what a second
 * tab, a re-fired sweep and a redelivered event are supposed to get.
 */
export async function processStandaloneCheck(
  db: any, checkId: string,
): Promise<StandaloneRunResult> {
  const claimed = await claimCheck(db, checkId);
  if (!claimed) return { checkId, outcome: 'not_claimed' };
  return await runStandaloneVerification(db, claimed);
}
