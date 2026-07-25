import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { MarketDigest24h, MarketDigestGenerationResult, MarketDigestPeriod, MarketIngestionRun, MarketIngestionSummary, MarketQAMessage, MarketSource, MarketSourceHealth, MarketUpdate, MarketUpdateFilters } from '@/types/marketUpdates';

const safeArray = <T>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];
const safeObject = <T extends Record<string, any>>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v)) ? v as T : {} as T;
const db = supabase as any;
function warnMissing(context: string, error: any) { if (import.meta.env.DEV) console.warn(`[Market Updates] ${context}`, error?.message ?? error); }

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

export async function fetchMarketUpdates(filters: MarketUpdateFilters = {}): Promise<MarketUpdate[]> {
  try {
    let q = db.from('market_updates').select('*')
      .eq('status', filters.status ?? 'published')
      .order('source_published_at', { ascending: false, nullsFirst: false })
      .order('ingested_at', { ascending: false })
      .limit(filters.limit ?? 200);
    if (filters.category && filters.category !== 'all') q = q.eq('category', filters.category);
    if (filters.impact && filters.impact !== 'all') q = q.eq('impact_level', filters.impact);
    if (filters.freshness && filters.freshness !== 'all') q = q.eq('freshness_tier', filters.freshness);
    if (filters.geography && filters.geography !== 'all') q = q.contains('geography', [filters.geography]);
    if (filters.audience && filters.audience !== 'all') q = q.contains('audience_tags', [filters.audience]);
    if (filters.segment && filters.segment !== 'all') q = q.contains('segments', [filters.segment]);
    if (filters.search) q = q.or(`title.ilike.%${filters.search}%,ai_summary.ilike.%${filters.search}%,source_name.ilike.%${filters.search}%`);
    if (filters.dateRange?.from) q = q.gte('source_published_at', filters.dateRange.from);
    if (filters.dateRange?.to) q = q.lte('source_published_at', filters.dateRange.to);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapUpdate);
  } catch (error) { warnMissing('Unable to fetch market_updates; returning empty feed.', error); return []; }
}

export async function fetchLatestMarketDigest(period: MarketDigestPeriod = '24h'): Promise<MarketDigest24h | null> {
  try {
    const { data, error } = await db.from('market_digests').select('*').eq('status','published').eq('period', period).order('generated_at',{ ascending:false }).limit(1).maybeSingle();
    if (error) throw error;
    return data ? mapDigest(data) : null;
  } catch (e) { warnMissing('Unable to fetch latest market_digests.', e); return null; }
}

export async function fetchMarketSources(): Promise<MarketSource[]> { try { const { data, error } = await db.from('market_sources').select('*').order('name'); if (error) throw error; return data ?? []; } catch (e) { warnMissing('Unable to fetch market_sources.', e); return []; } }

export interface MarketSourceAlert { source_id: string; name: string; severity: 'error' | 'warning' | 'info'; message: string; }

export async function fetchMarketSourceAdminSnapshot(): Promise<{ sources: MarketSource[]; alerts: MarketSourceAlert[] }> {
  try {
    const { data, error } = await db.functions.invoke('market-updates-source-admin', { body: { action: 'list' } });
    if (error) throw error;
    return { sources: safeArray<MarketSource>(data?.sources), alerts: safeArray<MarketSourceAlert>(data?.alerts) };
  } catch (e) { warnMissing('Admin source snapshot unavailable (admin role required).', e); return { sources: [], alerts: [] }; }
}

export async function toggleMarketSource(source_id: string, enabled: boolean): Promise<MarketSource | null> {
  try {
    const { data, error } = await db.functions.invoke('market-updates-source-admin', { body: { action: 'toggle', source_id, enabled } });
    if (error) throw error;
    return data?.source ?? null;
  } catch (e) { warnMissing('Toggle source failed.', e); return null; }
}

export async function updateMarketSourceConfig(source_id: string, patch: Partial<Pick<MarketSource, 'refresh_frequency_hours' | 'reliability_tier' | 'description'>>): Promise<MarketSource | null> {
  try {
    const { data, error } = await db.functions.invoke('market-updates-source-admin', { body: { action: 'update', source_id, ...patch } });
    if (error) throw error;
    return data?.source ?? null;
  } catch (e) { warnMissing('Update source failed.', e); return null; }
}

export async function clearMarketSourceError(source_id: string): Promise<MarketSource | null> {
  try {
    const { data, error } = await db.functions.invoke('market-updates-source-admin', { body: { action: 'clear_error', source_id } });
    if (error) throw error;
    return data?.source ?? null;
  } catch (e) { warnMissing('Clear source error failed.', e); return null; }
}

export async function fetchMarketSourceHealth(): Promise<MarketSourceHealth> {
  const sources = await fetchMarketSources();
  const failed = sources.filter(s => s.health_status === 'failed' || (s.consecutive_failures ?? 0) >= 3);
  const degraded = sources.filter(s => s.health_status === 'degraded' || ((s.consecutive_failures ?? 0) > 0 && (s.consecutive_failures ?? 0) < 3));
  const latest = (field: keyof MarketSource) => sources.map(s => s[field] as string | null | undefined).filter(Boolean).sort().pop() ?? null;
  const { data } = await db.from('market_ingestion_runs').select('*').order('started_at',{ascending:false}).limit(1).maybeSingle();
  return { totalSources: sources.length, enabledSources: sources.filter(s => s.enabled).length, healthySources:sources.filter(s=>s.health_status==='healthy').length, degradedSources:degraded.length, failedSources: failed.length, lastFetchedAt: latest('last_fetched_at'), lastSuccessAt: latest('last_success_at'), lastError: failed[0]?.last_error ?? null, latestRun:(data as MarketIngestionRun|null) ?? null };
}

export async function triggerMarketIngestion(options: { force?: boolean; trigger_type?:'page_open'|'manual'|'digest_prerequisite'; sourceIds?:string[]; test?:boolean } = {}): Promise<MarketIngestionSummary> {
  try {
    const { data, error } = await invokeSecureFunction<MarketIngestionSummary>('market-updates-ingest', options);
    if (error) throw error;
    if (!data) throw new Error('Market ingestion returned no result.');
    return data;
  } catch (e: any) { warnMissing('Ingestion function unavailable or not authorised.', e); return { ingested:0,published:0,candidates:0,ignored:0,failed:1,skippedDuplicates:0,sourceErrors:[],message:'Market ingestion is unavailable or you are not authorised to run it.' }; }
}

const FRESH_GUARD='market-updates-ensure-fresh';
export async function ensureMarketUpdatesFresh(health:MarketSourceHealth,publishedCount:number):Promise<MarketIngestionSummary|null>{
  const last=health.lastSuccessAt?Date.now()-Date.parse(health.lastSuccessAt):Infinity;
  const staleMinutes=60; // authoritative threshold is also enforced server-side
  if(publishedCount>0&&last<staleMinutes*60_000)return null;
  const guarded=Number(sessionStorage.getItem(FRESH_GUARD)||0);
  if(Date.now()-guarded<5*60_000)return null;
  sessionStorage.setItem(FRESH_GUARD,String(Date.now()));
  return triggerMarketIngestion({force:false,trigger_type:'page_open'});
}

export async function generateMarketDigest(period: MarketDigestPeriod = '24h'): Promise<MarketDigestGenerationResult> {
  try {
    const { data, error } = await db.functions.invoke('market-updates-digest', { body: { period } });
    if (error) throw error;
    const digest = data?.digest ? mapDigest(data.digest) : (await fetchLatestMarketDigest(period));
    return { digest, message: data?.message ?? '', noData: Boolean(data?.noData) };
  } catch (e) {
    warnMissing('Digest function unavailable.', e);
    return { digest: null, noData: true, message: 'No source-backed market updates were found for this period.' };
  }
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
