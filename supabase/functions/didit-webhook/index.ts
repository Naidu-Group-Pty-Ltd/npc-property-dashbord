/**
 * Didit webhook receiver — the ONLY inbound path that may settle a hosted
 * identity verification.
 *
 * ## Why this function has no JWT
 *
 * `verify_jwt = false`, because Didit's servers call it and cannot hold a
 * Supabase JWT. The HMAC signature IS the authentication boundary, and it is
 * treated as one: the raw body is verified before a single service-role query
 * runs, an unsigned or stale request never reaches the database, and no request
 * that fails verification can move AML state by any route. Registered as
 * `webhook-secret` in SECURITY_REGISTRY.json for the same reason.
 *
 * ## Why the webhook body is not the decision
 *
 * The payload carries a `decision` object and it is deliberately ignored. A
 * shared secret proves the event is real; it does not make the body a safe
 * source for an identity outcome. So the signature admits the event, and the
 * authoritative decision is then read back from Didit over an authenticated
 * server-to-server call. The body supplies exactly one thing: which session to
 * go and ask about.
 *
 * ## Crash safety
 *
 * The event row is recorded BEFORE processing and marked `processed_at` only
 * after the outcome is applied. A delivery that crashes between the two is
 * re-processed on retry rather than short-circuited as a replay — the failure
 * mode of "dedupe first, process second", which silently drops the outcome and
 * strands the customer. Re-processing is safe because the settling UPDATE in
 * `applyDiditDecision` is conditional on the row still being unsettled, so an
 * attempt can never be consumed twice however many times this runs.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyDiditWebhook, fetchDiditDecision, DiditApiError,
} from '../_shared/aml/providers/diditClient.ts';
import {
  diditWorkflowId, resolveTenantProvider, currentEnvironment, isStandaloneIdvProvider,
} from '../_shared/aml/providers/index.ts';
import {
  applyDiditDecision, DiditCorrelationError,
  HOSTED_CHECK_COLUMNS, type HostedCheckRow,
} from '../_shared/aml/diditOutcome.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });

/**
 * Didit's error categories, mapped onto the vocabulary
 * `verification_checks.provider_error_category` already permits.
 *
 * A 4xx from Didit means NPC sent something it would not accept — our request
 * or our configuration — so it lands as `provider_misconfigured` rather than
 * inventing a new enum value the CHECK constraint would reject.
 */
function errorCategoryFor(e: DiditApiError): string {
  switch (e.category) {
    case 'timeout': return 'timeout';
    case 'provider_not_configured': return 'provider_not_configured';
    case 'provider_rejected_request': return 'provider_misconfigured';
    default: return 'provider_unavailable';
  }
}

Deno.serve(async (req) => {
  // No CORS and no OPTIONS: this endpoint has no browser callers, and
  // advertising one would only widen its surface.
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = Deno.env.get('DIDIT_WEBHOOK_SECRET') || null;

  // The raw bytes are what was signed. Read as text and verify BEFORE parsing:
  // JSON.parse → JSON.stringify does not round-trip byte-for-byte, so
  // verifying a re-serialised body would either reject valid deliveries or, if
  // "fixed" by canonicalising, verify a body other than the one signed.
  const rawBody = await req.text();

  const verification = await verifyDiditWebhook({
    rawBody,
    signatureHeader: req.headers.get('x-signature'),
    timestampHeader: req.headers.get('x-timestamp'),
    secret,
  });
  if (!verification.ok) {
    // 401 is deliberate: Didit retries on 5xx/404/timeout, so an unauthenticated
    // delivery is refused once and not re-attempted. The reason is a category,
    // never an echo of what was sent.
    return json({ ok: false, reason: verification.rejection }, 401);
  }

  // ── Authenticated from here. Only now does a service-role client exist.
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    payload = parsed as Record<string, unknown>;
  } catch {
    // Signed but malformed. Real, and still unusable — 400 so it is not retried.
    return json({ ok: false, reason: 'malformed_body' }, 400);
  }

  const eventId = String(payload['event_id'] ?? '');
  const webhookType = String(payload['webhook_type'] ?? 'unknown');
  const sessionId = String(payload['session_id'] ?? '');
  const eventEnvironment = String(payload['environment'] ?? '');

  if (!eventId || !sessionId) {
    return json({ ok: false, reason: 'missing_event_id_or_session_id' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  /**
   * Replay/dedupe on Didit's `event_id`, which their retries reuse by design.
   *
   * An existing row that was already PROCESSED short-circuits. An existing row
   * that was not is re-processed: that is the crash-between-insert-and-apply
   * case, and treating it as a replay would lose the outcome permanently.
   */
  const { data: existing } = await admin.schema('aml').from('provider_events')
    .select('id, processed_at')
    .eq('provider', 'didit').eq('dedup_key', eventId).maybeSingle();

  if (existing?.processed_at) {
    return json({ ok: true, replay: true, processed: true });
  }

  let eventRowId: string | null = existing?.id ?? null;
  if (!eventRowId) {
    const { data: inserted, error: insertErr } = await admin.schema('aml')
      .from('provider_events').insert({
        provider: 'didit',
        event_type: webhookType,
        dedup_key: eventId,
        signature_ok: true,
        // Identifiers and lifecycle only. The body's `decision` object is NOT
        // stored: it carries signed URLs to the customer's ID photograph,
        // selfie and liveness video, plus the data read off their document.
        payload: {
          webhook_type: webhookType,
          session_id: sessionId,
          status: String(payload['status'] ?? ''),
          environment: eventEnvironment,
          timestamp: payload['timestamp'] ?? null,
          created_at: payload['created_at'] ?? null,
          application_id: payload['application_id'] ?? null,
        },
      }).select('id').maybeSingle();
    if (insertErr) {
      // A concurrent delivery of the same event won the unique index. Both
      // proceed; the conditional settling update decides which one counts.
      const { data: raced } = await admin.schema('aml').from('provider_events')
        .select('id, processed_at')
        .eq('provider', 'didit').eq('dedup_key', eventId).maybeSingle();
      if (raced?.processed_at) return json({ ok: true, replay: true, processed: true });
      eventRowId = raced?.id ?? null;
    } else {
      eventRowId = inserted?.id ?? null;
    }
  }

  const markEvent = async (fields: Record<string, unknown>) => {
    if (!eventRowId) return;
    await admin.schema('aml').from('provider_events').update(fields).eq('id', eventRowId);
  };

  /**
   * Correlate the session to the canonical row.
   *
   * The lookup is by the session id NPC itself stored when it created the
   * session. Nothing in the body is trusted to name a case or a party — a
   * caller-supplied `case_id` would be an open door onto any case in the
   * system, and the payload does not get to choose which row it settles.
   */
  /*
   * Deliberately NOT `.maybeSingle()`.
   *
   * `vendor_data` is person-scoped, and `POST /v3/session/` upserts on
   * `workflow_id + vendor_data` — so one session id can legitimately be
   * referenced by more than one NPC row: a row released as superseded (a
   * workflow revision, a changed document choice) and the live row that
   * replaced it both carry it. `maybeSingle()` fails outright on a second row,
   * which would turn a real customer's outcome into a 500 and, after Didit
   * stopped retrying, into no outcome at all.
   *
   * The live row is the one that may settle, so the ordering states that:
   * un-superseded first, then most recently created. The rows are already
   * scoped to one case and party by construction — every one of them was
   * minted for this session — so this chooses between attempts of the same
   * applicant, never between applicants.
   */
  const { data: checkRows } = await admin.schema('aml').from('verification_checks')
    .select(HOSTED_CHECK_COLUMNS)
    .eq('provider', 'didit')
    .eq('provider_reference', sessionId)
    .order('superseded_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(1);
  // Through `unknown` because postgrest-js infers the row type from the literal
  // text of the select and gives up on this one, yielding `GenericStringError`
  // rather than a row — the reason `HOSTED_CHECK_COLUMNS` states its shape once
  // and callers assert it.
  const check = ((checkRows ?? [])[0] ?? null) as unknown as HostedCheckRow | null;

  if (!check) {
    /**
     * Nothing hosted matched. Before calling it unknown, work out whether this
     * is the ONE case that is expected and benign: a persisted **Standalone**
     * request.
     *
     * `save_api_request=true` persists each Standalone call as an API-type
     * session, and Didit emits `status.updated` for those too. So this endpoint
     * now receives events for checks whose authoritative result NPC already
     * has — the synchronous response the call itself returned.
     *
     * Such an event must be acknowledged and then do NOTHING. The Standalone
     * architecture has exactly one authoritative result path and this is not
     * it: settling from a webhook here would create a second one, racing the
     * response the orchestrator already composed and potentially overwriting a
     * settled attempt. There is deliberately no branch below that could.
     *
     * Classified rather than lumped in with `unknown_session`, because an
     * operator reading a log of "unknown session" for every routine
     * verification would be reading an alarm that means nothing is wrong.
     */
    const { data: standaloneRows } = await admin.schema('aml')
      .from('verification_checks')
      .select('id, provider')
      .eq('provider_reference', sessionId)
      .limit(1);
    const standalone = (standaloneRows ?? [])[0] as { id: string; provider: string } | undefined;
    if (standalone && isStandaloneIdvProvider(standalone.provider)) {
      await markEvent({
        verification_check_id: standalone.id,
        error: 'standalone_session_ignored',
        processed_at: new Date().toISOString(),
      });
      // 2xx: acknowledged, so Didit stops retrying. `processed: false` because
      // nothing was applied, and nothing ever will be from here.
      return json({ ok: true, processed: false, reason: 'standalone_session_ignored' }, 202);
    }

    // A session NPC did not create, or one whose row is gone. Accepted so it
    // is not retried, recorded so it is visible, and it changes nothing.
    await markEvent({ error: 'unknown_session', processed_at: new Date().toISOString() });
    return json({ ok: true, processed: false, reason: 'unknown_session' }, 202);
  }

  await markEvent({ verification_check_id: check.id });

  /**
   * Sandbox events must never settle a production case.
   *
   * Both environments sign with their own secret, so this should be
   * unreachable — but the cost of being wrong is a real customer marked
   * verified by a test session, and the check is one comparison.
   */
  const npcEnvironment = currentEnvironment();
  if (npcEnvironment === 'production' && eventEnvironment === 'sandbox') {
    await markEvent({ error: 'sandbox_event_in_production', processed_at: new Date().toISOString() });
    return json({ ok: true, processed: false, reason: 'environment_mismatch' }, 202);
  }

  // The workflow NPC configured. A decision from any other workflow ran modules
  // NPC did not choose, and is refused below by `assertDecisionCorrelates`.
  const resolved = await resolveTenantProvider(admin, 'default', 'idv');
  const expectedWorkflowId = diditWorkflowId(resolved);
  if (!expectedWorkflowId) {
    await markEvent({ error: 'workflow_not_configured' });
    return json({ ok: false, reason: 'not_configured' }, 500);
  }

  const apiKey = Deno.env.get('DIDIT_API_KEY') || '';
  if (!apiKey) {
    await markEvent({ error: 'api_key_not_configured' });
    return json({ ok: false, reason: 'not_configured' }, 500);
  }

  // ── The authoritative read. The body said something changed; this is what it
  //    actually says.
  let decision: Record<string, unknown>;
  try {
    decision = await fetchDiditDecision(apiKey, sessionId);
  } catch (e) {
    const category = e instanceof DiditApiError ? errorCategoryFor(e) : 'provider_unavailable';
    // OUR failure, not the customer's. The identity status is untouched and no
    // attempt is consumed; the check stays in flight for the retry, the
    // portal's reconcile, or a staff retry.
    await admin.schema('aml').from('verification_checks').update({
      provider_error_category: category,
      failure_reason: `didit_decision_unavailable: ${String((e as Error)?.message ?? '').slice(0, 240)}`,
      updated_at: new Date().toISOString(),
    }).eq('id', check.id).eq('attempt_consumed', false);
    await markEvent({ error: `decision_fetch_failed:${category}` });
    // 5xx so Didit retries. Nothing here is final.
    return json({ ok: false, reason: 'decision_unavailable' }, 503);
  }

  try {
    const result = await applyDiditDecision({
      db: admin,
      check,
      decision,
      expectedWorkflowId,
      source: 'webhook',
      environment: npcEnvironment,
    });
    await markEvent({ processed_at: new Date().toISOString(), error: null });
    return json({ ok: true, processed: true, outcome: result.kind });
  } catch (e) {
    if (e instanceof DiditCorrelationError) {
      // The decision does not belong to this row: wrong workflow, wrong
      // vendor_data, wrong session. An integration fault, never a customer
      // outcome — recorded, accepted so it is not retried, and it changes no
      // AML state.
      await admin.schema('aml').from('verification_checks').update({
        provider_error_category: 'provider_misconfigured',
        failure_reason: `didit_correlation_failed: ${e.code}`,
        updated_at: new Date().toISOString(),
      }).eq('id', check.id).eq('attempt_consumed', false);
      await markEvent({ error: `correlation_failed:${e.code}`, processed_at: new Date().toISOString() });
      return json({ ok: true, processed: false, reason: 'correlation_failed' }, 202);
    }
    console.error('[didit-webhook] apply failed', (e as Error)?.message);
    await markEvent({ error: `apply_failed: ${String((e as Error)?.message ?? '').slice(0, 200)}` });
    // Left unprocessed on purpose so a retry re-runs it.
    return json({ ok: false, reason: 'apply_failed' }, 500);
  }
});
