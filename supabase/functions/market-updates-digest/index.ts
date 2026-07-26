// Market Updates Digest — Phase 2
// Generates period-scoped executive digests (24h / weekly / biweekly / monthly / quarterly / annual)
// from published, source-cited market updates. Calls the central assignment-based LLM router for the narrative, and persists one row per (period, period_start) in market_digests.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { consumeRateLimit, verifyRequiredCronSecret, securityJsonError } from "../_shared/requestSecurity.ts";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireModulePermission } from '../_shared/authz.ts';
import { callLLM } from '../_shared/llmRouter.ts';

const jsonWithCors = (cors: Record<string, string>) => (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

type Period = "24h" | "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
const VALID_PERIODS: Period[] = ["24h", "weekly", "biweekly", "monthly", "quarterly", "annual"];
function periodWindow(period: Period, ref = new Date()): { start: Date; end: Date } {
  const end = new Date(ref);
  const start = new Date(ref);
  switch (period) {
    case "24h": start.setUTCDate(end.getUTCDate() - 1); break;
    case "weekly": start.setUTCDate(end.getUTCDate() - 7); break;
    case "biweekly": start.setUTCDate(end.getUTCDate() - 14); break;
    case "monthly": start.setUTCMonth(end.getUTCMonth() - 1); break;
    case "quarterly": start.setUTCMonth(end.getUTCMonth() - 3); break;
    case "annual": start.setUTCFullYear(end.getUTCFullYear() - 1); break;
  }
  return { start, end };
}


async function synthesizeWithAI(period: Period, windowLabel: string, updates: any[]) {
  const compact = updates.slice(0, 60).map((u: any) => ({
    id: u.id,
    title: u.title,
    segments: u.segments,
    impact: u.impact_level,
    source: u.source_name,
    url: u.source_url,
    published_at: u.source_published_at,
    summary: u.ai_summary,
    why: u.why_it_matters,
  }));

  const tool = {
    type: "function",
    function: {
      name: "record_market_digest",
      description: "Produce an evidence-grounded Australian market intelligence digest.",
      parameters: {
        type: "object",
        properties: {
          executive_summary: { type: "string" },
          top_update_ids: { type: "array", items: { type: "string" } },
          finance_lending_highlights: { type: "array", items: { type: "string" } },
          property_market_highlights: { type: "array", items: { type: "string" } },
          construction_supply_highlights: { type: "array", items: { type: "string" } },
          policy_regulation_highlights: { type: "array", items: { type: "string" } },
          political_economic_watchpoints: { type: "array", items: { type: "string" } },
          social_watchpoints: { type: "array", items: { type: "string" } },
          segment_breakdown: {
            type: "object",
            description: "Short per-segment narrative keyed by segment name.",
            additionalProperties: { type: "string" },
          },
          buyer_implications: { type: "string" },
          investor_implications: { type: "string" },
          broker_adviser_implications: { type: "string" },
          client_advisory_implications: { type: "array", items: { type: "string" } },
          recommended_watchlist_for_tomorrow: { type: "array", items: { type: "string" } },
          confidence_score: { type: "number" },
        },
        required: [
          "executive_summary", "top_update_ids",
          "finance_lending_highlights", "property_market_highlights",
          "construction_supply_highlights", "policy_regulation_highlights",
          "political_economic_watchpoints", "segment_breakdown",
          "confidence_score",
        ],
        additionalProperties: false,
      },
    },
  };

  const started = Date.now();
  const result = await callLLM({
    agentKey:'market_updates_digest',
    messages:[
      { role:'system', content:"You are an Australian real-estate market intelligence editor. Produce a factual, source-grounded " + period + " digest. Cite only supplied updates and use their raw IDs in top_update_ids. Never invent figures, sources or events. Australian English; concise executive tone." },
      { role:'user', content:`Period: ${period} (${windowLabel})\nUpdates (${updates.length} total):\n${JSON.stringify(compact, null, 2)}` },
    ],
    tools:[tool], toolChoice:{ type:'function', function:{ name:'record_market_digest' } }, requiredToolName:'record_market_digest', requireValidToolArguments:true,
    timeoutMs:35_000, deadlineAt:Date.now()+70_000,
  });
  const toolCall = result.toolCalls?.find((call:any) => call?.function?.name === 'record_market_digest');
  if (!toolCall?.function?.arguments) throw Object.assign(new Error('digest_tool_output_missing'), { attempts:result.attempts });
  return {
    body:JSON.parse(toolCall.function.arguments),
    telemetry:{
      model_used:result.modelUsed, route_used:result.routeUsed,
      provider_attempts:result.attempts.map(attempt => ({ route:attempt.route, model_id:attempt.model_id, ok:attempt.ok, status:attempt.status ?? null })),
      fallback_used:result.attempts.length > 1, ai_latency_ms:Date.now()-started, ai_failure_reason:null,
    },
  };
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get("origin"));
  const json = jsonWithCors(cors);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);
  // WP-03: strict cron auth via constant-time helper. Admin manual trigger
  // still allowed via authenticated Bearer (verifyAuth) — attacker-controlled
  // headers alone can no longer reach the AI generation path.
  const cronSecret = Deno.env.get("MARKET_INGESTION_CRON_SECRET");
  const cronHeader = req.headers.get("x-cron-secret");
  const cronOk = verifyRequiredCronSecret(cronSecret, cronHeader);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let interactiveUserId: string | null = null;
  if (!cronOk) {
    let bodyPreview: any = {};
    try { bodyPreview = await req.clone().json(); } catch {}
    const auth = await verifyAuth(sb, req.headers, bodyPreview);
    if (auth.error || !auth.userId) return securityJsonError(401, "unauthorized");
    const permission = await requireModulePermission(sb, { userId: auth.userId, authMethod: auth.authMethod }, 'market_updates', 'can_edit');
    if (!permission.ok) return securityJsonError(403, 'market_digest_admin_required');
    interactiveUserId = auth.userId;
  }

  const payload = await req.json().catch(() => ({}));
  const period: Period = VALID_PERIODS.includes(payload?.period) ? payload.period : "24h";
  const { start, end } = periodWindow(period);
  const windowLabel = `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;

  // Cron and manual retries are idempotent per period window. Return the
  // authoritative existing digest before any provider call.
  const { data: existingDigest } = await sb.from('market_digests')
    .select('*').eq('period', period).eq('period_start', start.toISOString()).maybeSingle();
  if (existingDigest) return json({ digest: existingDigest, noData: false, period, period_start: start.toISOString(), period_end: end.toISOString(), idempotent: true, message: 'Market digest already exists for this period.' });

  if (interactiveUserId) {
    try {
      const [userLimit, globalLimit] = await Promise.all([
        consumeRateLimit(sb, `market-digest:user:${interactiveUserId}`, Number(Deno.env.get('MARKET_DIGEST_USER_DAILY_LIMIT') || 3), 86400),
        consumeRateLimit(sb, 'market-digest:global', Number(Deno.env.get('MARKET_DIGEST_GLOBAL_DAILY_LIMIT') || 24), 86400),
      ]);
      if (!userLimit.allowed || !globalLimit.allowed) return securityJsonError(429, 'rate_limited');
    } catch { return securityJsonError(503, 'metering_unavailable'); }
  }

  const { data: updates, error } = await sb
    .from("market_updates")
    .select(
      "id, title, category, segments, impact_level, geography, source_name, source_url, source_published_at, ai_summary, why_it_matters, citation_urls, ingested_at",
    )
    .eq("status", "published")
    .gte("ingested_at", start.toISOString())
    .lte("ingested_at", end.toISOString())
    .order("ingested_at", { ascending: false })
    .limit(200);

  if (error) return json({ error: error.message }, 500);
  if (!updates?.length) {
    return json({
      digest: null,
      noData: true,
      period,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      message: `No source-backed market updates were found in the ${period} window.`,
    });
  }

  let synthesis:any;
  try {
    synthesis = await synthesizeWithAI(period, windowLabel, updates);
  } catch (providerError:any) {
    console.warn(JSON.stringify({ function:'market-updates-digest', stage:'provider', status:'failed', attempts:Array.isArray(providerError?.attempts) ? providerError.attempts.length : 0 }));
    return json({ error:'The configured Market Updates digest route is unavailable.', code:'provider_unavailable', retryable:true }, 503);
  }
  const body = synthesis.body;

  const digest = {
    period,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    executive_summary: body.executive_summary,
    top_update_ids: body.top_update_ids ?? [],
    finance_lending_highlights: body.finance_lending_highlights ?? [],
    property_market_highlights: body.property_market_highlights ?? [],
    construction_supply_highlights: body.construction_supply_highlights ?? [],
    policy_regulation_highlights: body.policy_regulation_highlights ?? [],
    political_economic_watchpoints: body.political_economic_watchpoints ?? [],
    social_watchpoints: body.social_watchpoints ?? [],
    segment_breakdown: body.segment_breakdown ?? {},
    buyer_implications: body.buyer_implications ?? null,
    investor_implications: body.investor_implications ?? null,
    broker_adviser_implications: body.broker_adviser_implications ?? null,
    client_advisory_implications: body.client_advisory_implications ?? [],
    recommended_watchlist_for_tomorrow: body.recommended_watchlist_for_tomorrow ?? [],
    source_urls: [
      ...new Set(
        updates.flatMap((u: any) =>
          Array.isArray(u.citation_urls) && u.citation_urls.length ? u.citation_urls : [u.source_url],
        ),
      ),
    ],
    confidence_score: Number(body.confidence_score ?? 70),
    status: "published",
    ...synthesis.telemetry,
  };

  // Upsert on (period, period_start) — replace same-day regenerations for the same window.
  const { data, error: insertError } = await sb
    .from("market_digests")
    .upsert(digest, { onConflict: "period,period_start" })
    .select("*")
    .single();
  if (insertError) return json({ error: insertError.message }, 500);

  return json({
    digest: data,
    noData: false,
    period,
    period_start: digest.period_start,
    period_end: digest.period_end,
    update_count: updates.length,
    message: `${period} market digest generated from ${updates.length} sourced update(s).`,
  });
});
