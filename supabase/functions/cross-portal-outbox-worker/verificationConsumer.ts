/**
 * aml_verification consumer — processes `aml.verification.requested` events.
 *
 * The worker owns the provider call so the browser never does. It never
 * invents an identity outcome: `status` (the identity result) changes only
 * when the provider actually examined usable captures; every technical
 * condition lands in `processing_status` + `provider_error_category` and is
 * retried/dead-lettered by the platform outbox machinery. A customer attempt
 * (`attempt_consumed`) is recorded ONLY for an authoritative outcome.
 */
import {
  getIdvProvider,
  resolveTenantProvider,
  runWithMetrics,
  currentEnvironment,
  ProviderResolutionError,
} from '../_shared/aml/providers/index.ts';

const OUTCOME_TO_STATUS: Record<string, string> = {
  verified: 'passed',
  failed: 'failed',
  manual_review: 'referred',
};

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function processVerificationEvent(db: any, event: any): Promise<void> {
  const checkId = String(event?.payload?.verification_check_id ?? '');
  if (!checkId) return; // malformed event: nothing to do, never retryable

  const { data: check, error: loadErr } = await db.schema('aml').from('verification_checks')
    .select('*').eq('id', checkId).maybeSingle();
  if (loadErr) throw loadErr;
  // Eligibility: stale/duplicate/cancelled events must not reprocess a check
  // that already has an outcome or was withdrawn.
  if (!check) return;
  if (check.superseded_at || check.status !== 'pending') return;
  if (!['submitted', 'queued', 'retry_scheduled'].includes(check.processing_status ?? 'submitted')) return;

  // Optimistic claim — a concurrent worker loses the conditional update and
  // walks away, so the provider is called at most once per event delivery.
  const { data: claimed } = await db.schema('aml').from('verification_checks')
    .update({
      processing_status: 'processing',
      processing_started_at: new Date().toISOString(),
      processing_attempts: (check.processing_attempts ?? 0) + 1,
    })
    .eq('id', checkId)
    .in('processing_status', ['submitted', 'queued', 'retry_scheduled'])
    .select('id').maybeSingle();
  if (!claimed) return;

  const technical = async (category: string, message: string) => {
    await db.schema('aml').from('verification_checks').update({
      processing_status: 'technical_failure',
      provider_error_category: category,
      failure_reason: message.slice(0, 300),
      // status untouched: a technical condition is not an identity outcome
      // and consumes no attempt.
    }).eq('id', checkId);
  };

  try {
    await runProviderForCheck(db, check);
  } catch (err: any) {
    if (err instanceof ProviderResolutionError) {
      await technical(
        err.code === 'provider_misconfigured' ? 'provider_misconfigured' : 'provider_not_configured',
        err.message,
      );
    } else if (/storage_unreadable/.test(String(err?.message))) {
      await technical('storage_unreadable', String(err.message));
    } else if (/timeout|timed out/i.test(String(err?.message))) {
      await technical('timeout', String(err.message));
    } else {
      await technical('provider_unavailable', String(err?.message ?? 'provider_failure'));
    }
    // Re-throw so the platform outbox machinery applies backoff and
    // dead-lettering. The check row stays technical — never a customer
    // failure, never an attempt.
    throw err;
  }
}

/**
 * The real processing body, separated so the capture download and provider
 * call are testable and the metadata payload is built exactly once.
 */
export async function runProviderForCheck(db: any, check: any): Promise<void> {
  const resolved = await resolveTenantProvider(db, 'default', 'idv');
  const provider = getIdvProvider({ resolved, admin: db });

  const docBlob = await db.storage.from('aml-documents').download(check.document_reference);
  if (docBlob.error || !docBlob.data) throw new Error('storage_unreadable:document');
  const documentImage = await toBase64(docBlob.data);

  let selfieImage = '';
  if (check.biometric_storage_path) {
    const selfieBlob = await db.storage.from('aml-biometrics').download(check.biometric_storage_path);
    if (selfieBlob.error || !selfieBlob.data) throw new Error('storage_unreadable:selfie');
    selfieImage = await toBase64(selfieBlob.data);
  }

  const result = await runWithMetrics(db, {
    tenantId: 'default', capability: 'idv',
    providerKey: provider.name, costCents: resolved?.costCents ?? 0,
    configId: resolved?.configId ?? null,
  }, () => provider.runIdv({
    caseId: check.case_id,
    subjectLabel: check.party_label ?? 'Customer',
    method: selfieImage ? 'document_and_liveness' : 'document_only',
    metadata: { document_image_b64: documentImage, selfie_image_b64: selfieImage },
  }));

  if (result.status === 'pending' || result.status === 'in_progress') {
    // Unusable capture: the provider looked but could not examine identity.
    // No identity outcome, NO attempt consumed — the client recaptures.
    await db.schema('aml').from('verification_checks').update({
      processing_status: 'capture_unusable',
      provider_error_category: 'capture_unusable',
      provider_attempt_reference: result.providerReference,
      outcome_detail: { ...(check.outcome_detail ?? {}), capture: result.raw?.face ?? null },
      processing_completed_at: new Date().toISOString(),
    }).eq('id', check.id);
    return;
  }

  // Authoritative outcome: the one place a customer attempt is consumed.
  await db.schema('aml').from('verification_checks').update({
    status: OUTCOME_TO_STATUS[result.status] ?? 'referred',
    processing_status: 'completed',
    attempt_consumed: true,
    authoritative: provider.mode !== 'simulator',
    execution_mode: provider.mode === 'simulator' ? 'simulation' : 'live',
    environment: currentEnvironment(),
    provider: provider.name,
    provider_reference: result.providerReference,
    provider_attempt_reference: result.providerReference,
    outcome_detail: result.raw,
    completed_at: new Date().toISOString(),
    processing_completed_at: new Date().toISOString(),
  }).eq('id', check.id);
}
