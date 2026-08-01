// Market Updates Q&A — Phase 6: hybrid retrieval, adaptive model, conversation history,
// richer grounded schema (key figures, follow-ups, sentiment, time horizon).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireModulePermission } from '../_shared/authz.ts';
import { consumeRateLimit, enforceJsonBodyLimit, getTrustedClientIp, requireHumanOrSignedInternal, securityJsonError } from '../_shared/requestSecurity.ts';
import { callLLM } from '../_shared/llmRouter.ts';
import { createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { classifyMarketError, logMarketEvent, marketCorrelationId } from '../_shared/marketUpdatesObservability.ts';

const REFUSAL = 'I do not have enough sourced market updates to answer that yet.';

interface Ctx {
  id: string;
  title: string;
  source_name: string;
  source_url: string;
  source_published_at?: string | null;
  category?: string | null;
  segments?: string[] | null;
  geography?: string[] | null;
  impact_level?: string | null;
  ai_summary?: string | null;
  why_it_matters?: string | null;
  key_points?: string[] | null;
  citation_urls?: string[] | null;
}

interface HistoryTurn { role: 'user' | 'assistant'; content: string }

const STOP = new Set(['what','when','where','which','with','about','into','this','that','have','from','been','will','would','should','could','their','there','than','then','they','them','are','the','and','for','was','how','why','who','you','your','our','has','does','doing','tell','give','show','explain']);

function pickTerms(q: string): string[] {
  return Array.from(new Set(
    q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 3 && !STOP.has(t))
  )).slice(0, 12);
}

// Question is "complex" → route to deeper model.
function isComplex(q: string, history: HistoryTurn[]): boolean {
  const wc = q.split(/\s+/).length;
  const marks = (q.match(/\?/g) ?? []).length;
  const multi = /\b(and|also|then|compare|versus|vs\.?|trend|forecast|impact|why|implication|scenario|difference|between)\b/i.test(q);
  return wc > 22 || marks > 1 || multi || history.length >= 4;
}

function recencyBoost(publishedAt?: string | null): number {
  if (!publishedAt) return 0;
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0;
  // 3.0 today → 0 at ~90 days (exponential-ish decay).
  return Math.max(0, 3 * Math.exp(-ageDays / 30));
}

function impactBoost(level?: string | null): number {
  return level === 'high' ? 1.5 : level === 'medium' ? 0.75 : 0;
}

function rankAndTrim(rows: Ctx[], terms: string[], segment: string | undefined, limit = 12): Ctx[] {
  const scored = rows.map(r => {
    const blob = `${r.title} ${r.ai_summary ?? ''} ${r.why_it_matters ?? ''} ${(r.key_points ?? []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (r.title?.toLowerCase().includes(t)) score += 2;   // title match weighted higher
      else if (blob.includes(t)) score += 1;
    }
    if (segment && r.segments?.includes(segment)) score += 1.5;
    score += recencyBoost(r.source_published_at);
    score += impactBoost(r.impact_level);
    return { r, score };
  });
  const filtered = scored.filter(x => x.score > 0.5);
  const use = filtered.length ? filtered : scored; // semantic fallback → keep top recent/impact
  return use.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.r);
}

async function callAI(
  agentKey: 'market_updates_qa_fast' | 'market_updates_qa_deep',
  question: string,
  context: Ctx[],
  history: HistoryTurn[],
) {
  const contextBlock = context.map((c, i) => {
    const cites = Array.from(new Set([...(c.citation_urls ?? []), c.source_url].filter(Boolean)));
    return `[[${i + 1}]] id=${c.id}
Title: ${c.title}
Source: ${c.source_name} — ${c.source_published_at ?? 'date unknown'}
Category: ${c.category ?? 'n/a'} | Segments: ${(c.segments ?? []).join(', ') || 'n/a'} | Geography: ${(c.geography ?? []).join(', ') || 'n/a'} | Impact: ${c.impact_level ?? 'n/a'}
Summary: ${c.ai_summary ?? ''}
Why it matters: ${c.why_it_matters ?? ''}
Key points: ${(c.key_points ?? []).join(' • ')}
Citations: ${cites.join(' ')}`;
  }).join('\n\n');

  const system = `You are the NPC Australian property-market intelligence assistant.
STRICT RULES:
1. Answer ONLY from the numbered CONTEXT items below. Never use outside knowledge, memory, or assumptions.
2. If the CONTEXT does not contain enough grounded evidence to answer, respond with EXACTLY: "${REFUSAL}" and set used_ids to [].
3. Cite the update ids you relied on in used_ids. IMPORTANT: used_ids MUST contain the raw id value shown after "id=" in each context item — never the "[[N]]" display marker, never the title, never a shortened form. Copy the id string verbatim. Do not fabricate ids.
4. Never give personal financial, tax, legal or investment advice. Attribute claims to their source.
5. Keep the main answer under 260 words, plain Australian English, factual, quantitative where the sources support it.
6. Extract concrete numbers (rates, percentages, prices, volumes, dates) into key_figures with the source id.
7. Suggest 2–3 tightly-scoped follow_up_questions the user could ask next given only the CONTEXT you have.
8. Use conversation history for pronoun resolution only, never as a source of facts.
9. sentiment ∈ {positive, neutral, cautious, negative}. time_horizon ∈ {immediate, short_term, medium_term, long_term, unclear}.`;

  const historyMsgs = history.slice(-6).map(h => ({ role: h.role, content: h.content }));
  const messages = [
    { role: 'system', content: system },
    ...historyMsgs,
    { role: 'user', content: `QUESTION: ${question}\n\nCONTEXT:\n${contextBlock}` },
  ];

  const body = {
    messages,
    tools: [{
      type: 'function',
      function: {
        name: 'submit_market_answer',
        description: 'Return a source-grounded answer or refuse.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answer: { type: 'string' },
            used_ids: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
            limitations: { type: 'array', items: { type: 'string' } },
            follow_up_questions: { type: 'array', items: { type: 'string' } },
            key_figures: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                  source_id: { type: 'string' },
                },
                required: ['label', 'value'],
              },
            },
            time_horizon: { type: 'string', enum: ['immediate','short_term','medium_term','long_term','unclear'] },
            sentiment: { type: 'string', enum: ['positive','neutral','cautious','negative'] },
          },
          required: ['answer','used_ids','confidence','limitations','follow_up_questions','key_figures','time_horizon','sentiment'],
        },
      },
    }],
    tool_choice: { type: 'function', function: { name: 'submit_market_answer' } },
  };

  const started = Date.now();
  const result = await callLLM({
    agentKey, messages:body.messages as any, tools:body.tools, toolChoice:body.tool_choice, requiredToolName:'submit_market_answer', requireValidToolArguments:true,
    timeoutMs:30_000, deadlineAt:Date.now()+65_000,
  });
  const call = result.toolCalls?.find((toolCall:any) => toolCall?.function?.name === 'submit_market_answer');
  if (!call?.function?.arguments) throw Object.assign(new Error('qa_tool_output_missing'), { attempts:result.attempts });
  const parsed = JSON.parse(call.function.arguments);
  return {
    answer: String(parsed.answer ?? REFUSAL).trim(),
    used_ids: Array.isArray(parsed.used_ids) ? parsed.used_ids.map(String) : [],
    confidence: Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : 50,
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations.map(String) : [],
    follow_up_questions: Array.isArray(parsed.follow_up_questions) ? parsed.follow_up_questions.map(String).slice(0, 4) : [],
    key_figures: Array.isArray(parsed.key_figures) ? parsed.key_figures.slice(0, 8).map((figure:any) => ({ label:String(figure.label ?? ''), value:String(figure.value ?? ''), source_id:figure.source_id ? String(figure.source_id) : undefined })) : [],
    time_horizon: typeof parsed.time_horizon === 'string' ? parsed.time_horizon : 'unclear',
    sentiment: typeof parsed.sentiment === 'string' ? parsed.sentiment : 'neutral',
    telemetry:{ model_used:result.modelUsed, route_used:result.routeUsed, provider_attempts:result.attempts.map(attempt => ({ route:attempt.route, model_id:attempt.model_id, ok:attempt.ok, status:attempt.status ?? null })), fallback_used:result.attempts.length > 1, ai_latency_ms:Date.now()-started, ai_failure_reason:null },
  };
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const RATE_LIMIT_HOUR = Number(Deno.env.get('MARKET_QA_RATE_LIMIT_HOUR') || 30);
const RATE_LIMIT_DAY = Number(Deno.env.get('MARKET_QA_RATE_LIMIT_DAY') || 200);

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  // Provisional id for early error responses; upgraded from the request body
  // once it is parsed (browsers cannot send the header — see below).
  let requestCorrelationId=marketCorrelationId(req.headers);
  cors['x-correlation-id']=requestCorrelationId;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers:{ ...cors, 'content-type':'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Invalid request.' }, 400);
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);
  const parsed = await enforceJsonBodyLimit<any>(req, 100_000);
  if (!parsed.ok) return new Response(parsed.error.body, { status: parsed.error.status, headers: { ...cors, 'content-type': 'application/json' } });
  // A browser cannot attach `x-correlation-id` — that would require every
  // reachable edge function to be redeployed with the header allow-listed
  // before the preflight would pass — so the client sends it in the body.
  requestCorrelationId = marketCorrelationId(req.headers, parsed.value);
  cors['x-correlation-id'] = requestCorrelationId;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // Human requests and scheduled work have distinct trust paths. Scheduled
  // callers must present a signed internal envelope and be on this target's
  // allowlist; they never impersonate a browser Bearer token.
  const auth = await requireHumanOrSignedInternal(sb, req, parsed.raw, ['market-qa-subscriptions', 'market-qa-digest-runner'], parsed.value);
  if (!auth.ok || !auth.actorId) return new Response(securityJsonError(401, 'authentication_required', auth.correlationId).body, { status: 401, headers: { ...cors, 'content-type': 'application/json' } });
  const isScheduledInternal = auth.method === 'internal_hmac';
  if (isScheduledInternal && parsed.value?.internal_action !== 'scheduled_qa') return new Response(securityJsonError(403, 'internal_action_denied', auth.correlationId).body, { status: 403, headers: { ...cors, 'content-type': 'application/json' } });
  const targetUserId = isScheduledInternal && typeof parsed.value?.target_user_id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.value.target_user_id)
    ? parsed.value.target_user_id : auth.actorId;
  if (isScheduledInternal && targetUserId === auth.actorId) return new Response(securityJsonError(400, 'target_user_required', auth.correlationId).body, { status: 400, headers: { ...cors, 'content-type': 'application/json' } });
  const permission = await requireModulePermission(sb, { userId: targetUserId, authMethod: isScheduledInternal ? 'human' : auth.method }, 'market_updates', 'can_view');
  if (!permission.ok) return new Response(securityJsonError(403, 'market_access_denied', auth.correlationId).body, { status: 403, headers: { ...cors, 'content-type': 'application/json' } });
  const payload = parsed.value;
  const question = typeof payload?.question === 'string' ? payload.question.trim().slice(0, 4000) : '';
  const updateIds: string[] = Array.isArray(payload?.updateIds) ? payload.updateIds.filter((id: unknown) => typeof id === 'string').slice(0, 20) : [];
  const segment: string | undefined = typeof payload?.segment === 'string' && payload.segment.length <= 80 ? payload.segment : undefined;
  const stream = payload?.stream === true;
  const conversation_id: string | null = typeof payload?.conversation_id === 'string' && payload.conversation_id.length <= 100 ? payload.conversation_id : null;
  const history: HistoryTurn[] = Array.isArray(payload?.history) ? payload.history.filter((h: any) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').map((h: any) => ({ role: h.role, content: String(h.content).slice(0, 1200) })).slice(-6) : [];
  if (question.length < 4) return json({ answer: REFUSAL, citations: [], source_update_ids: [], confidence_score: 0, limitations: ['A specific question is required.'], follow_up_questions: [], key_figures: [], time_horizon: 'unclear', sentiment: 'neutral', retrieved: [], question_id: null });
  const ip = getTrustedClientIp(req.headers);
  try {
    const limits = await Promise.all([consumeRateLimit(sb, `marketqa:user:${targetUserId}`, RATE_LIMIT_HOUR, 3600), consumeRateLimit(sb, `marketqa:daily:${targetUserId}`, RATE_LIMIT_DAY, 86400), consumeRateLimit(sb, 'marketqa:global', Number(Deno.env.get('MARKET_QA_GLOBAL_DAILY_LIMIT') || 2000), 86400), ...(!isScheduledInternal && ip ? [consumeRateLimit(sb, `marketqa:ip:${ip}`, 60, 3600)] : [])]);
    if (limits.some((limit) => !limit.allowed)) return new Response(securityJsonError(429, 'rate_limited', auth.correlationId).body, { status: 429, headers: { ...cors, 'content-type': 'application/json' } });
  } catch { return new Response(securityJsonError(503, 'metering_unavailable', auth.correlationId).body, { status: 503, headers: { ...cors, 'content-type': 'application/json' } }); }
  const userId = targetUserId;

  const terms = pickTerms(question);

  // Anchor ids from prior turns in the same conversation — retrieval boost + inclusion.
  let anchorIds: string[] = [];
  if (conversation_id) {
    const { data: prior, error:priorError } = await sb.from('market_update_questions')
      .select('source_update_ids')
      .eq('conversation_id', conversation_id)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(3);
    if (priorError) return json({ error:'Conversation history could not be loaded.', code:'conversation_retrieval_failed', retryable:true, correlation_id:auth.correlationId },503);
    if (prior) {
      anchorIds = Array.from(new Set(prior.flatMap((p: any) => Array.isArray(p.source_update_ids) ? p.source_update_ids : []))).slice(0, 8);
    }
  }

  // Candidate retrieval — larger pool for hybrid rerank.
  let q = sb.from('market_updates')
    .select('id,title,source_name,source_url,source_published_at,category,segments,geography,impact_level,ai_summary,why_it_matters,key_points,citation_urls')
    .eq('status', 'published')
    .is('archived_at', null)
    .order('source_published_at', { ascending: false, nullsFirst: false })
    .limit(updateIds.length ? updateIds.length : 200);
  if (updateIds.length) q = q.in('id', updateIds);
  if (segment) q = q.contains('segments', [segment]);
  if (terms.length && !updateIds.length) {
    const or = terms.map(t => `title.ilike.%${t}%,ai_summary.ilike.%${t}%,why_it_matters.ilike.%${t}%`).join(',');
    q = q.or(or);
  }

  let { data, error } = await q;
  // Phase 8: track how retrieval assembled the context.
  let retrievalMode: 'hybrid' | 'vector' | 'lexical' | 'fallback' = (data && data.length) ? 'vector' : 'fallback';

  // Phase 7 hybrid lexical: supplement with full-text search over the tsvector column.
  if (!error && !updateIds.length && terms.length) {
    try {
      const tsQuery = terms.slice(0, 8).join(' | ');
      let lexicalQuery = sb.from('market_updates')
        .select('id,title,source_name,source_url,source_published_at,category,segments,geography,impact_level,ai_summary,why_it_matters,key_points,citation_urls')
        .eq('status', 'published')
        .is('archived_at', null);
      if (segment) lexicalQuery = lexicalQuery.contains('segments', [segment]);
      const { data: lex } = await lexicalQuery
        .textSearch('search_tsv', tsQuery, { type: 'websearch', config: 'english' })
        .order('source_published_at', { ascending: false, nullsFirst: false })
        .limit(60);
      if (Array.isArray(lex) && lex.length) {
        const existing = new Set((data ?? []).map((r: any) => r.id));
        const added = lex.filter((r: any) => !existing.has(r.id));
        data = [...(data ?? []), ...added];
        if (added.length && (data?.length ?? 0) > added.length) retrievalMode = 'hybrid';
        else if (added.length) retrievalMode = 'lexical';
      }
    } catch { logMarketEvent('warn',{ function:'market-updates-qa', stage:'lexical_supplement', status:'skipped', correlation_id:auth.correlationId }); }
  }

  // Semantic fallback: if term-restricted query returned nothing, pull recent high-impact pool.
  if (!error && (!data || data.length === 0) && !updateIds.length) {
    let fallbackQuery = sb.from('market_updates')
      .select('id,title,source_name,source_url,source_published_at,category,segments,geography,impact_level,ai_summary,why_it_matters,key_points,citation_urls')
      .eq('status', 'published')
      .is('archived_at', null);
    if (segment) fallbackQuery = fallbackQuery.contains('segments',[segment]);
    const fallback = await fallbackQuery.order('source_published_at', { ascending: false, nullsFirst: false }).limit(80);
    if (fallback.error) error = fallback.error;
    data = fallback.data ?? [];
    retrievalMode = 'fallback';
  }


  // Ensure anchor updates are always in the pool.
  if (anchorIds.length) {
    const existing = new Set((data ?? []).map((r: any) => r.id));
    const missing = anchorIds.filter(id => !existing.has(id));
    if (missing.length) {
      const anchorRows = await sb.from('market_updates')
        .select('id,title,source_name,source_url,source_published_at,category,segments,geography,impact_level,ai_summary,why_it_matters,key_points,citation_urls')
        .eq('status','published')
        .is('archived_at',null)
        .in('id', missing);
      if (anchorRows.error) return json({ error:'Conversation sources could not be loaded.', code:'retrieval_failed', retryable:true, correlation_id:auth.correlationId },503);
      const permittedAnchors = segment ? (anchorRows.data ?? []).filter((row:any) => Array.isArray(row.segments) && row.segments.includes(segment)) : (anchorRows.data ?? []);
      data = [...(data ?? []), ...permittedAnchors];
    }
  }

  if (error) {
    logMarketEvent('warn',{ function:'market-updates-qa', stage:'retrieval', status:'failed', correlation_id:auth.correlationId, error_class:'unknown' });
    return json({ error:'Published Market Updates context could not be retrieved.', code:'retrieval_failed', retryable:true, correlation_id:auth.correlationId },503);
  }

  // Boost anchor rows during ranking.
  const anchorSet = new Set(anchorIds);
  const raw = (data ?? []) as Ctx[];
  const preScored = raw.map(r => ({ ...r, __anchor: anchorSet.has(r.id) ? 3 : 0 } as any));
  const context = rankAndTrim(preScored, terms.length ? terms : pickTerms(question), segment)
    .sort((a: any, b: any) => (b.__anchor ?? 0) - (a.__anchor ?? 0));

  if (!context.length) {
    return json({
      answer: REFUSAL, citations: [], source_update_ids: [], confidence_score: 0,
      limitations: ['No published source-backed update matched the question.'],
      follow_up_questions: [], key_figures: [], time_horizon: 'unclear', sentiment: 'neutral',
    });
  }

  const contextIds = new Set(context.map(c => c.id));
  const agentKey = isComplex(question, history) ? 'market_updates_qa_deep' : 'market_updates_qa_fast';
  let ai:any;
  try {
    ai = await callAI(agentKey, question, context, history);
  } catch (providerError:any) {
    const providerCode=classifyMarketError(providerError);
    logMarketEvent('warn',{ function:'market-updates-qa', stage:'provider', status:'failed', correlation_id:auth.correlationId, retry_attempt:Array.isArray(providerError?.attempts) ? providerError.attempts.length : 0, error_class:classifyMarketError(providerError) });
    return json({ error:'The configured Market Updates Q&A route is unavailable.', code:providerCode, stage:'classification', retryable:!['provider_unauthorised','provider_payment_required'].includes(providerCode), correlation_id:auth.correlationId }, 503);
  }

  let answer: string, used_ids: string[], confidence: number, limitations: string[];
  let follow_up_questions: string[] = [];
  let key_figures: Array<{ label: string; value: string; source_id?: string }> = [];
  let time_horizon = 'unclear';
  let sentiment = 'neutral';

  // Defensive: some models return the "[[N]]" display label or a bare index
  // instead of the raw id. Remap those to the real context id before validation
  // so a well-grounded answer isn't dropped into the extractive fallback.
  const remapCitedId = (raw: string): string => {
    const s = String(raw).trim();
    if (contextIds.has(s)) return s;
    const m = s.match(/^\[?\[?\s*(\d+)\s*\]?\]?$/);
    if (m) {
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < context.length) return context[idx].id;
    }
    return s;
  };
  const aiUsedIds = ai ? Array.from(new Set(ai.used_ids.map(remapCitedId))) : [];
  const aiKeyFigures = ai ? ai.key_figures.map(k => ({
    ...k,
    source_id: k.source_id ? remapCitedId(k.source_id) : undefined,
  })) : [];

  if (ai.answer === REFUSAL && aiUsedIds.length === 0) {
    answer = REFUSAL;
    used_ids = [];
    confidence = Math.max(0, Math.min(100, ai.confidence));
    limitations = ai.limitations.length ? ai.limitations : ['The retrieved source-backed updates do not contain enough evidence to answer.'];
    follow_up_questions = ai.follow_up_questions;
    time_horizon = ai.time_horizon;
    sentiment = ai.sentiment;
  } else if (!aiUsedIds.length || aiUsedIds.some(id => !contextIds.has(id)) || ai.answer.length < 4) {
    answer = REFUSAL;
    used_ids = [];
    confidence = 0;
    limitations = ['The generated answer could not be validated against the retrieved source records.'];
  } else {
    answer = ai.answer;
    used_ids = aiUsedIds.filter(id => contextIds.has(id));
    confidence = Math.max(0, Math.min(100, ai.confidence));
    limitations = ai.limitations.length ? ai.limitations : ['Answer limited to stored market update summaries and citations; not financial, legal, tax or investment advice.'];
    follow_up_questions = ai.follow_up_questions;
    key_figures = aiKeyFigures.filter(k => Boolean(k.source_id) && contextIds.has(k.source_id!));
    time_horizon = ai.time_horizon;
    sentiment = ai.sentiment;
  }

  const citations = Array.from(new Set(
    context.filter(c => used_ids.includes(c.id))
      .flatMap(c => [...(c.citation_urls ?? []), c.source_url].filter(Boolean))
  ));

  // Transparency: every retrieved item flagged as used or considered-only.
  const usedSet = new Set(used_ids);
  const retrieved = context.map(c => ({
    id: c.id,
    title: c.title,
    source_name: c.source_name,
    source_url: c.source_url,
    source_published_at: c.source_published_at ?? null,
    impact_level: c.impact_level ?? null,
    used: usedSet.has(c.id),
  }));

  // Persist turn and capture inserted row id for "Share answer" affordance.
  const insertRow = {
    question, answer, correlation_id:auth.correlationId,
    source_update_ids: used_ids,
    citation_urls: citations,
    confidence_score: confidence,
    conversation_id,
    follow_up_questions,
    key_figures,
    time_horizon,
    sentiment,
    ...ai.telemetry,
    created_by: userId,
    metadata: {
      retrieval_mode: retrievalMode,
      context_size: context.length,
      terms,
      segment: segment ?? null,
    },
  };
  const persistPromise = sb.from('market_update_questions').insert(insertRow).select('id').maybeSingle()
    .then((res: any) => { if (res?.error) logMarketEvent('warn',{ function:'market-updates-qa', stage:'persistence', status:'failed', correlation_id:auth.correlationId, error_class:'database_insert_failed' }); return res?.data?.id ?? null; });

  let question_id: string | null = null;
  if (!stream) {
    question_id = await persistPromise.catch(() => null);
  } else {
    // Kick off but don't block streaming; question_id will be inlined in metadata if it lands in time.
    persistPromise.catch(() => null);
  }

  const finalPayload = {
    correlation_id:auth.correlationId,
    answer,
    citations,
    source_update_ids: used_ids,
    confidence_score: confidence,
    limitations,
    follow_up_questions,
    key_figures,
    time_horizon,
    sentiment,
    model_used: ai.telemetry.model_used,
    route_used: ai.telemetry.route_used,
    fallback_used: ai.telemetry.fallback_used,
    context_size: context.length,
    conversation_id,
    retrieved,
    retrieval_mode: retrievalMode,
    question_id,
  };


  if (!stream) {
    return json(finalPayload);
  }

  // Await persistence so metadata can include question_id (used by "Share answer").
  const pid = await persistPromise.catch(() => null);
  const streamPayload = { ...finalPayload, question_id: pid };

  // SSE streaming: chunk answer word-by-word for progressive typewriter UI.
  const encoder = new TextEncoder();
  const words = answer.split(/(\s+)/);

  const body = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseEvent('start', { model_used:ai.telemetry.model_used, route_used:ai.telemetry.route_used, context_size:context.length })));
        let acc = '';
        for (const w of words) {
          acc += w;
          controller.enqueue(encoder.encode(sseEvent('delta', { text: w, acc })));
          await new Promise(r => setTimeout(r, 12));
        }
        controller.enqueue(encoder.encode(sseEvent('metadata', streamPayload)));
        controller.enqueue(encoder.encode(sseEvent('done', { ok: true })));
      } catch (e) {
        controller.enqueue(encoder.encode(sseEvent('error', { message: (e as Error).message })));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
  });
});
