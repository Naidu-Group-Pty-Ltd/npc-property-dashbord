import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { MarketDigest24h, MarketDigestGenerationResult, MarketDigestPeriod, MarketIngestionRun, MarketIngestionSummary, MarketQAMessage, MarketSource, MarketSourceHealth, MarketSourceRegistrySummary, MarketUpdate, MarketUpdateFilters, MarketUpdatesOperationalIssue } from '@/types/marketUpdates';

const safeArray = <T>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];
const safeObject = <T extends Record<string, any>>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v)) ? v as T : {} as T;
const db = supabase as any;
function warnMissing(context: string, error: any) { if (import.meta.env.DEV) console.warn(`[Market Updates] ${context}`, error?.message ?? error); }

export class MarketUpdatesOperationalError extends Error {
  constructor(public readonly issue: MarketUpdatesOperationalIssue, options?: { cause?: unknown }) { super(issue.message); this.name = 'MarketUpdatesOperationalError'; if (options?.cause !== undefined) (this as any).cause = options.cause; }
}

function operationalError(stage: MarketUpdatesOperationalIssue['stage'], error: any, functionName?: string): MarketUpdatesOperationalError {
  if (error instanceof MarketUpdatesOperationalError) return error;
  const status = Number(error?.status || error?.statusCode) || undefined;
  const raw = String(error?.message ?? error ?? '').toLowerCase();
  const code = error?.network ? 'network_error'
    : status === 401 ? 'unauthorised'
    : status === 403 || raw.includes('permission denied') || raw.includes('row-level security') ? 'rls_denied'
    : status === 404 ? 'function_missing'
    : raw.includes('does not exist') || raw.includes('schema cache') || raw.includes('pgrst205') || raw.includes('42p01') ? 'migration_missing'
    : status && status >= 500 ? 'server_error' : 'unknown';
  const messages: Record<string, string> = {
    network_error: 'The Market Updates service could not be reached.', unauthorised: 'Your sign-in session is missing or expired.',
    rls_denied: 'Your account is not authorised to access this Market Updates operation.', function_missing: `The ${functionName ?? 'required'} Edge Function is not deployed.`,
    migration_missing: 'The Market Updates database migration has not been applied in this environment.', server_error: 'The Market Updates service returned an internal error.', unknown: 'Market Updates could not complete this operation.',
  };
  const remediation: Record<string, string> = {
    network_error: 'Check connectivity and retry.', unauthorised: 'Sign in again, then retry.', rls_denied: 'Ask an administrator to verify your role and Market Updates policies.',
    function_missing: 'Deploy the Market Updates Edge Functions to the frontend project.', migration_missing: 'Apply the pending Market Updates migrations and seed migration.',
    server_error: 'Review the function log and latest ingestion run, then retry.', unknown: 'Retry; if it persists, review the connected project and function logs.',
  };
  return new MarketUpdatesOperationalError({ stage, code: code as MarketUpdatesOperationalIssue['code'], message: messages[code], remediation: remediation[code], httpStatus: status, functionName, retryable: !['rls_denied'].includes(code) }, { cause: error });
}

const mapUpdate = (r: any): MarketUpdate => ({
  ...r,
  geography: safeArray(r.geography),
  audience_tags: safeArray(r.audience_tags),
  key_points: safeArray(r.key_points),
  risk_flags: safeArray(r.risk_flags),
  citation_urls: safeArray(r.citation_urls),
  segments: safeArray(r.segments),
  freshness_tier: r.freshness_tier ?? 'older',
  relevance_score: Number(r.relevance_score ?? 0),
});

const mapDigest = (r: any): MarketDigest24h => ({
  ...r,
  period: r.period ?? '24h',
  top_update_ids: safeArray(r.top_update_ids),
  finance_lending_highlights: safeArray(r.finance_lending_highlights),
  property_market_highlights: safeArray(r.property_market_highlights),
  construction_supply_highlights: safeArray(r.construction_supply_highlights),
  policy_regulation_highlights: safeArray(r.policy_regulation_highlights),
  political_economic_watchpoints: safeArray(r.political_economic_watchpoints),
  social_watchpoints: safeArray(r.social_watchpoints),
  segment_breakdown: safeObject(r.segment_breakdown),
  client_advisory_implications: safeArray(r.client_advisory_implications),
  recommended_watchlist_for_tomorrow: safeArray(r.recommended_watchlist_for_tomorrow),
  source_urls: safeArray(r.source_urls),
});

async function invokeMarketRead<T>(body: Record<string, any>, stage: MarketUpdatesOperationalIssue['stage'] = 'database'): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>('market-updates-status', body);
  if (error) throw operationalError(stage, error, 'market-updates-status');
  if (!data) throw operationalError(stage, new Error('Market Updates read returned no data.'), 'market-updates-status');
  return data;
}

export async function fetchMarketUpdates(filters: MarketUpdateFilters = {}): Promise<MarketUpdate[]> {
  const payload = await invokeMarketRead<{ updates?: any[] }>({
    action:'updates', status:filters.status ?? 'published', limit:filters.limit ?? 200,
    category:filters.category, impact:filters.impact, freshness:filters.freshness, geography:filters.geography,
    audience:filters.audience, segment:filters.segment, dateFrom:filters.dateRange?.from, dateTo:filters.dateRange?.to,
  });
  const updates = safeArray<any>(payload.updates).map(mapUpdate);
  if (!filters.search) return updates;
  const search = filters.search.toLowerCase();
  return updates.filter(update => `${update.title} ${update.ai_summary ?? ''} ${update.source_name}`.toLowerCase().includes(search));
}

export async function fetchLatestMarketDigest(period: MarketDigestPeriod = '24h'): Promise<MarketDigest24h | null> {
  const payload = await invokeMarketRead<{ digest?: any | null }>({ action:'digest', period }, 'digest');
  return payload.digest ? mapDigest(payload.digest) : null;
}

export async function fetchMarketSources(): Promise<MarketSource[]> {
  const payload = await invokeMarketRead<{ sources?: MarketSource[] }>({ action:'sources' });
  return safeArray<MarketSource>(payload.sources);
}

export interface MarketSourceAlert { source_id: string; name: string; severity: 'error' | 'warning' | 'info'; message: string; }

export async function fetchMarketSourceAdminSnapshot(): Promise<{ sources: MarketSource[]; legacySources: MarketSource[]; alerts: MarketSourceAlert[]; registry: MarketSourceRegistrySummary }> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-source-admin', { action: 'list' });
    if (error) throw error;
    const payload = data as any;
    const registry = safeObject<Record<string, any>>(payload?.registry);
    return {
      sources: safeArray<MarketSource>(payload?.sources),
      legacySources: safeArray<MarketSource>(payload?.legacy_sources),
      alerts: safeArray<MarketSourceAlert>(payload?.alerts),
      registry: {
        canonical: Number(registry.canonical ?? 0),
        enabledCanonical: Number(registry.enabledCanonical ?? 0),
        disabledCanonical: Number(registry.disabledCanonical ?? 0),
        archivedLegacy: Number(registry.archivedLegacy ?? 0),
        unresolvedLegacy: Number(registry.unresolvedLegacy ?? 0),
        totalRecords: Number(registry.totalRecords ?? 0),
        matchedLegacy: Number(registry.matchedLegacy ?? 0),
        mergedRows: Number(registry.mergedRows ?? 0),
        updateReferencesReassigned: Number(registry.updateReferencesReassigned ?? 0),
        fetchRunReferencesReassigned: Number(registry.fetchRunReferencesReassigned ?? 0),
        reconciledAt: registry.reconciledAt ?? null,
      },
    };
  } catch (e) { throw operationalError('function', e, 'market-updates-source-admin'); }
}

export async function toggleMarketSource(source_id: string, enabled: boolean): Promise<MarketSource | null> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-source-admin', { action: 'toggle', source_id, enabled });
    if (error) throw error;
    return (data as any)?.source ?? null;
  } catch (e) { throw operationalError('function', e, 'market-updates-source-admin'); }
}

export async function updateMarketSourceConfig(source_id: string, patch: Partial<Pick<MarketSource, 'refresh_frequency_minutes' | 'reliability_tier' | 'description'>>): Promise<MarketSource | null> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-source-admin', { action: 'update', source_id, ...patch });
    if (error) throw error;
    return (data as any)?.source ?? null;
  } catch (e) { throw operationalError('function', e, 'market-updates-source-admin'); }
}

export async function clearMarketSourceError(source_id: string): Promise<MarketSource | null> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-source-admin', { action: 'clear_error', source_id });
    if (error) throw error;
    return (data as any)?.source ?? null;
  } catch (e) { throw operationalError('function', e, 'market-updates-source-admin'); }
}

export async function fetchMarketSourceHealth(): Promise<MarketSourceHealth> {
  const payload = await invokeMarketRead<{ status?: MarketSourceHealth }>({ action:'status' });
  if (!payload.status) throw operationalError('database', new Error('Market Updates status was missing.'), 'market-updates-status');
  return payload.status;
}

export async function triggerMarketIngestion(options: { force?: boolean; trigger_type?:'page_open'|'manual'|'digest_prerequisite'; sourceIds?:string[]; test?:boolean } = {}): Promise<MarketIngestionSummary> {
  try {
    const { data, error } = await invokeSecureFunction<MarketIngestionSummary>('market-updates-ingest', options);
    if (error) throw error;
    if (!data) throw new Error('Market ingestion returned no result.');
    return data;
  } catch (e: any) { throw operationalError('ingestion', e, 'market-updates-ingest'); }
}

export async function followMarketIngestionRun(runId: string, timeoutMs = 190_000): Promise<MarketIngestionSummary> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await invokeMarketRead<{ run?: MarketIngestionRun | null }>({ action:'run', runId });
    if (!payload.run) throw operationalError('database', new Error('Ingestion run was not found.'), 'market-updates-status');
    const run = payload.run;
    if (!['queued', 'running'].includes(run.status)) {
      if (run.status === 'failed') throw new MarketUpdatesOperationalError({ stage:'ingestion', code:'source_failed', message:run.error_summary || 'The Market Updates ingestion run failed.', remediation:'Open Sources to review source health, then retry.', functionName:'market-updates-ingest', retryable:true });
      return { runId:run.id, status:run.status, active:false, sourcesConsidered:run.sources_considered, sourcesProcessed:run.sources_processed, sourcesSucceeded:run.sources_succeeded, sourcesFailed:run.sources_failed, ingested:run.items_discovered, published:run.items_published, candidates:(run as any).items_candidate ?? 0, ignored:(run as any).items_ignored ?? 0, failed:run.sources_failed, skippedDuplicates:(run as any).items_deduplicated ?? 0, sourceErrors:[], message:`Market ingestion ${run.status}.` };
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new MarketUpdatesOperationalError({ stage:'ingestion', code:'server_error', message:'The active Market Updates ingestion did not finish before the polling timeout.', remediation:'Refresh the view to inspect the latest run before retrying.', functionName:'market-updates-ingest', retryable:true });
}

const FRESH_GUARD='market-updates-ensure-fresh';
export async function ensureMarketUpdatesFresh(health:MarketSourceHealth,publishedCount:number):Promise<MarketIngestionSummary|null>{
  const last=health.lastSuccessAt?Date.now()-Date.parse(health.lastSuccessAt):Infinity;
  const staleMinutes=60; // authoritative threshold is also enforced server-side
  if(publishedCount>0&&last<staleMinutes*60_000)return null;
  const guarded=Number(sessionStorage.getItem(FRESH_GUARD)||0);
  if(Date.now()-guarded<5*60_000)return null;
  sessionStorage.setItem(FRESH_GUARD,String(Date.now()));
  const result = await triggerMarketIngestion({force:false,trigger_type:'page_open'});
  return result.active && result.runId ? followMarketIngestionRun(result.runId) : result;
}

export async function generateMarketDigest(period: MarketDigestPeriod = '24h'): Promise<MarketDigestGenerationResult> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-digest', { period });
    if (error) throw error;
    const digest = (data as any)?.digest ? mapDigest((data as any).digest) : (await fetchLatestMarketDigest(period));
    return { digest, message: (data as any)?.message ?? '', noData: Boolean((data as any)?.noData) };
  } catch (e) { throw operationalError('digest', e, 'market-updates-digest'); }
}

// Back-compat alias
export const generateMarketDigest24h = () => generateMarketDigest('24h');

export async function answerMarketUpdateQuestion(
  question: string,
  updateIds?: string[],
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  segment?: string,
  conversation_id?: string | null,
): Promise<MarketQAMessage> {
  try {
    const { data, error } = await db.functions.invoke('market-updates-qa', { body: { question, updateIds, history, segment, conversation_id } });
    if (error) throw error;
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: data.answer,
      citations: safeArray(data.citations),
      source_update_ids: safeArray(data.source_update_ids),
      confidence_score: data.confidence_score,
      limitations: safeArray(data.limitations),
      created_at: new Date().toISOString(),
      follow_up_questions: safeArray(data.follow_up_questions),
      key_figures: Array.isArray(data.key_figures) ? data.key_figures : [],
      time_horizon: data.time_horizon,
      sentiment: data.sentiment,
      model_used: data.model_used,
      retrieved: Array.isArray(data.retrieved) ? data.retrieved : [],
      question_id: data.question_id ?? null,
      rate_limited: Boolean(data.rate_limited),
    };
  } catch (e) {
    warnMissing('Market Q&A function unavailable or insufficient context.', e);
    return { id: crypto.randomUUID(), role:'assistant', content:'I do not have enough sourced market updates to answer that yet.', citations:[], source_update_ids:[], confidence_score:0, limitations:['Market Q&A only answers from published, source-backed market updates.'], created_at:new Date().toISOString(), follow_up_questions: [], key_figures: [], retrieved: [], question_id: null };
  }
}

/** SSE-streaming variant. `onDelta` receives the accumulated answer text as it streams.
 *  Returns the final assistant message once the stream completes. */
export async function streamMarketUpdateQuestion(
  question: string,
  opts: {
    updateIds?: string[];
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    segment?: string;
    conversation_id?: string | null;
    onDelta?: (acc: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<MarketQAMessage> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/market-updates-qa`;
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      },
      body: JSON.stringify({
        question,
        updateIds: opts.updateIds,
        history: opts.history,
        segment: opts.segment,
        conversation_id: opts.conversation_id,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let metadata: any = null;
    let acc = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const lines = frame.split('\n');
        let event = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (event === 'delta') {
            acc = parsed.acc ?? (acc + (parsed.text ?? ''));
            opts.onDelta?.(acc);
          } else if (event === 'metadata') {
            metadata = parsed;
          }
        } catch { /* ignore parse errors */ }
      }
    }
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: metadata?.answer ?? acc,
      citations: safeArray(metadata?.citations),
      source_update_ids: safeArray(metadata?.source_update_ids),
      confidence_score: metadata?.confidence_score,
      limitations: safeArray(metadata?.limitations),
      created_at: new Date().toISOString(),
      follow_up_questions: safeArray(metadata?.follow_up_questions),
      key_figures: Array.isArray(metadata?.key_figures) ? metadata.key_figures : [],
      time_horizon: metadata?.time_horizon,
      sentiment: metadata?.sentiment,
      model_used: metadata?.model_used,
      retrieved: Array.isArray(metadata?.retrieved) ? metadata.retrieved : [],
      question_id: metadata?.question_id ?? null,
      rate_limited: Boolean(metadata?.rate_limited),
    };
  } catch (e) {
    warnMissing('Market Q&A streaming failed; falling back to non-streaming.', e);
    return answerMarketUpdateQuestion(question, opts.updateIds, opts.history, opts.segment, opts.conversation_id);
  }
}
