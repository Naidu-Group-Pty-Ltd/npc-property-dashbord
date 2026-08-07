/**
 * aml_screening consumer — processes `aml.screening.requested` events.
 *
 * The worker owns the provider call so the browser never does, and party
 * screening state is a PROJECTION of canonical evidence: every execution
 * writes an aml.screening_checks row, candidates become aml.screening_matches
 * rows, and the subject's state is derived from those — never invented here.
 * Technical conditions (provider unresolvable, stale list data, transport
 * failure) land in state='error' + error_category and are retried /
 * dead-lettered by the platform outbox machinery. A technical failure can
 * NEVER project to 'completed': stale lists and outages are our problem, not
 * a cleared customer.
 */
import {
  getScreeningProvider,
  resolveTenantProvider,
  runWithMetrics,
  ProviderResolutionError,
  type ScreeningScope,
} from '../_shared/aml/providers/index.ts';
import {
  computeRefreshDueAt,
  matchDedupKey,
  projectPartyScreeningState,
  screeningClaimDecision,
} from '../_shared/aml/partyScreening.pure.ts';

/** Party screening asks the local lists exactly what they can answer. */
const PARTY_SCREENING_SCOPE: ScreeningScope[] = ['sanctions'];

/**
 * A worker that died mid-run leaves 'processing'; reclaim after this. Must be
 * shorter than the outbox's cumulative retry backoff before dead-lettering
 * (attempts cap at 10, backoff 2^n capped at 1h) so an in-flight retry can
 * still reclaim a dead worker's subject before the event dead-letters.
 */
const STUCK_PROCESSING_MINUTES = 10;

async function sha256Hex(input: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Same hash-chained case-event append the AML edge functions use. */
async function appendCaseEvent(
  db: any, caseId: string, category: string, summary: string, payload: any,
): Promise<void> {
  const { data: prev } = await db.schema('aml').from('case_events')
    .select('row_hash').eq('case_id', caseId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    case_id: caseId, category, summary, payload,
    actor_id: null, actor_label: 'outbox-worker', prev_hash: prevHash, created_at: now,
  }));
  await db.schema('aml').from('case_events').insert({
    case_id: caseId, category, summary, payload,
    actor_id: null, actor_label: 'outbox-worker',
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

/** Rescreen cadence from the existing monitoring rule (365-day default). */
async function rescreenIntervalDays(db: any): Promise<number> {
  const { data } = await db.schema('aml').from('monitoring_rules')
    .select('criteria').eq('trigger_kind', 'rescreen_due').eq('is_enabled', true)
    .limit(1).maybeSingle();
  const days = Number((data?.criteria as any)?.interval_days ?? 365);
  return Number.isFinite(days) && days > 0 ? days : 365;
}

export async function processScreeningEvent(db: any, event: any): Promise<void> {
  const subjectId = String(event?.payload?.party_screening_subject_id ?? '');
  if (!subjectId) return; // malformed event: nothing to do, never retryable

  const { data: subject, error: loadErr } = await db.schema('aml')
    .from('party_screening_subjects').select('*').eq('id', subjectId).maybeSingle();
  if (loadErr) throw loadErr;
  if (!subject) return;

  // Eligibility (single shared rule — screeningClaimDecision):
  //   queued/error            → claim and run;
  //   terminal states         → duplicate/stale event, succeed silently;
  //   fresh 'processing'      → someone else holds it: RETRY the event.
  // Retrying the in-flight case matters: succeeding would mark the event
  // processed, and if the holder had died the subject would sit in
  // 'processing' forever with no event left to wake it. A retried delivery
  // either finds the terminal state (holder finished) or reclaims once the
  // staleness window passes (holder died).
  const decision = screeningClaimDecision(subject, Date.now(), STUCK_PROCESSING_MINUTES);
  if (decision === 'obsolete') return;
  if (decision === 'in_flight_retry') {
    throw new Error(`screening_in_flight: subject ${subjectId} is being processed by another worker — retry`);
  }

  // Optimistic claim — a concurrent worker loses the conditional update, so
  // the provider runs at most once per delivery. The conditional predicate is
  // authoritative; the JS decision above is only routing.
  const stuckCutoff = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60_000).toISOString();
  const { data: claimed } = await db.schema('aml').from('party_screening_subjects')
    .update({ state: 'processing', updated_at: new Date().toISOString() })
    .eq('id', subjectId)
    .or(`state.in.(queued,error),and(state.eq.processing,updated_at.lt.${stuckCutoff})`)
    .select('id').maybeSingle();
  if (!claimed) {
    // Lost the race to a live worker an instant ago — same as in-flight.
    throw new Error(`screening_in_flight: subject ${subjectId} was claimed concurrently — retry`);
  }

  const technical = async (category: string, message: string) => {
    await db.schema('aml').from('party_screening_subjects').update({
      state: 'error',
      error_category: category,
      updated_at: new Date().toISOString(),
      // last_screened_at untouched: no screening was performed.
    }).eq('id', subjectId);
    await appendCaseEvent(db, subject.case_id, 'system',
      `Party screening failed technically for ${subject.screened_name} (${category}) — screening remains outstanding`,
      { party_screening_subject_id: subjectId, error_category: category, error: message.slice(0, 300) });
  };

  try {
    await runScreeningForSubject(db, subject);
  } catch (err: any) {
    const message = String(err?.message ?? 'screening_failure');
    if (err instanceof ProviderResolutionError) {
      await technical(
        err.code === 'provider_misconfigured' ? 'provider_misconfigured' : 'provider_not_configured',
        message,
      );
    } else if (/sanctions_list_unavailable/.test(message)) {
      await technical('list_data_unavailable', message);
    } else if (/timeout|timed out/i.test(message)) {
      await technical('timeout', message);
    } else {
      await technical('provider_unavailable', message);
    }
    // Re-throw so the platform outbox machinery applies backoff and
    // dead-lettering. The subject stays 'error' — outstanding, never clear.
    throw err;
  }
}

/**
 * The real processing body: resolve the provider server-side, execute against
 * the canonical screening tables, then project the subject from the result.
 */
export async function runScreeningForSubject(db: any, subject: any): Promise<void> {
  const tenantId = String(subject.tenant_id ?? 'default');
  const resolved = await resolveTenantProvider(db, tenantId, 'pep_sanctions');
  const provider = getScreeningProvider({ resolved, admin: db });

  // Reuse the unfinished canonical check from a failed attempt; a fresh
  // screening round gets a fresh check so history accumulates, not mutates.
  let checkId: string | null = null;
  if (subject.screening_check_id) {
    const { data: existing } = await db.schema('aml').from('screening_checks')
      .select('id, status').eq('id', subject.screening_check_id).maybeSingle();
    if (existing && ['in_progress', 'failed', 'pending'].includes(String(existing.status))) {
      checkId = existing.id;
      await db.schema('aml').from('screening_checks').update({
        status: 'in_progress', provider: provider.name,
        updated_at: new Date().toISOString(),
      }).eq('id', checkId);
    }
  }
  if (!checkId) {
    const { data: inserted, error: insertErr } = await db.schema('aml')
      .from('screening_checks').insert({
        case_id: subject.case_id,
        subject_label: subject.screened_name,
        subject_type: 'individual',
        provider: provider.name,
        scope: PARTY_SCREENING_SCOPE,
        status: 'in_progress',
        metadata: {
          party_screening_subject_id: subject.id,
          party_type: subject.party_type,
          party_id: subject.party_id ?? null,
        },
      }).select('id').single();
    if (insertErr) throw insertErr;
    checkId = inserted.id as string;
    await db.schema('aml').from('party_screening_subjects')
      .update({ screening_check_id: checkId, updated_at: new Date().toISOString() })
      .eq('id', subject.id);
  }

  let result;
  try {
    result = await runWithMetrics(db, {
      tenantId, capability: 'pep_sanctions',
      providerKey: provider.name, costCents: resolved?.costCents ?? 0,
      configId: resolved?.configId ?? null,
    }, () => provider.runScreening({
      caseId: subject.case_id,
      subjectLabel: subject.screened_name,
      subjectType: 'individual',
      scope: PARTY_SCREENING_SCOPE,
      // All identifying information the reconciled party carries. Missing
      // DOB stays missing — the matcher treats it as 'unknown', never as a
      // mismatch or a failure.
      metadata: {
        ...(subject.date_of_birth ? { date_of_birth: String(subject.date_of_birth) } : {}),
        ...(Array.isArray(subject.aliases) && subject.aliases.length
          ? { aliases: subject.aliases } : {}),
        ...(subject.country ? { country: String(subject.country) } : {}),
        party_screening_subject_id: subject.id,
      },
    }));
  } catch (err) {
    // The canonical record says what happened; the thrown error drives the
    // subject's error projection and the outbox retry in the caller.
    await db.schema('aml').from('screening_checks').update({
      status: 'failed',
      result_summary: {
        error_category: /sanctions_list_unavailable/.test(String((err as Error)?.message))
          ? 'list_data_unavailable' : 'provider_unavailable',
        error: String((err as Error)?.message ?? 'screening_failure').slice(0, 300),
      },
      completed_at: new Date().toISOString(),
    }).eq('id', checkId);
    throw err;
  }

  const now = new Date().toISOString();
  await db.schema('aml').from('screening_checks').update({
    status: result.status,
    provider_reference: result.providerReference,
    result_summary: result.summary,
    completed_at: now,
  }).eq('id', checkId);

  if (result.matches.length > 0) {
    // Idempotency on redelivery after a partial failure: only insert
    // candidates the check does not already carry. Keyed on the list's own
    // external id, falling back to name+list for providers that supply none.
    const { data: existingMatches } = await db.schema('aml').from('screening_matches')
      .select('details, matched_name, list_name').eq('screening_check_id', checkId);
    const known = new Set((existingMatches ?? []).map((m: any) => matchDedupKey(m)));
    const fresh = result.matches.filter((m) => !known.has(matchDedupKey(m)));
    if (fresh.length > 0) {
      const { error: matchErr } = await db.schema('aml').from('screening_matches').insert(
        fresh.map((m) => ({
          screening_check_id: checkId,
          case_id: subject.case_id,
          match_type: m.matchType,
          list_name: m.listName,
          matched_name: m.matchedName,
          score: m.score,
          jurisdiction: m.jurisdiction,
          details: m.details,
        })),
      );
      if (matchErr) throw matchErr;
    }
  }

  // Project the subject from the canonical match set — never from the raw
  // result alone, so a rerun over an already-adjudicated check stays
  // consistent with the recorded adjudications.
  const { data: allMatches } = await db.schema('aml').from('screening_matches')
    .select('status').eq('screening_check_id', checkId);
  const projected = projectPartyScreeningState((allMatches ?? []).map((m: any) => m.status));

  const intervalDays = await rescreenIntervalDays(db);
  const listVersions = (result.raw as any)?.list_versions ?? {};
  const listVersion = Object.entries(listVersions)
    .map(([code, v]) => `${code}:${v}`).join(' ').slice(0, 500) || null;

  await db.schema('aml').from('party_screening_subjects').update({
    state: projected,
    screening_check_id: checkId,
    provider_key: provider.name,
    list_version: listVersion,
    last_screened_at: now,
    refresh_due_at: computeRefreshDueAt(now, intervalDays),
    error_category: null,
    updated_at: now,
  }).eq('id', subject.id);

  await appendCaseEvent(
    db, subject.case_id,
    result.matches.length > 0 ? 'pep_sanctions_hit' : 'system',
    result.matches.length > 0
      ? `Party screening found ${result.matches.length} candidate match(es) for ${subject.screened_name} — human adjudication required`
      : `Party screening ${projected} for ${subject.screened_name} via ${provider.name}`,
    {
      party_screening_subject_id: subject.id,
      screening_check_id: checkId,
      state: projected,
      match_count: result.matches.length,
      scopes_covered: (result.summary as any)?.scopes_covered ?? PARTY_SCREENING_SCOPE,
    },
  );
}
