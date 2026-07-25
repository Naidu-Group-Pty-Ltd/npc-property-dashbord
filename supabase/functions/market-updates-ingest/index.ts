// Market Updates Ingest — Phase 2
// Fetches enabled RSS sources, deduplicates, classifies with Lovable AI Gateway
// (google/gemini-3-flash-preview) into 8 real-estate intelligence segments,
// enriches with implications/risk flags/citations, and persists to market_updates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { adapterFor } from "./adapters/index.ts";
import type { SourceConfig } from "./adapters/types.ts";
import { MARKET_AUDIENCES, MARKET_SEGMENTS, normaliseClassification } from "./classification.ts";

const json = (body: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const AI_MODEL = Deno.env.get("MARKET_AI_MODEL") ?? "google/gemini-3-flash-preview";
const RELEVANCE_THRESHOLD = Number(Deno.env.get("MARKET_RELEVANCE_THRESHOLD") ?? 40);
const AI_CONFIDENCE_THRESHOLD = Number(Deno.env.get("MARKET_AI_CONFIDENCE_THRESHOLD") ?? 55);

async function isAdminOrSuperadmin(sb: any, userId: string): Promise<boolean> {
  if (!userId || userId === "service_role") return true;
  const { data: roleRows } = await sb
    .from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((row: any) => row.role);
  if (roles.some((role: string) => ["admin", "superadmin", "super_admin"].includes(role))) return true;

  const { data: customUser } = await sb
    .from("custom_users").select("role_display, is_active").eq("id", userId).maybeSingle();
  if (!customUser?.is_active) return false;
  return ["admin", "superadmin", "super_admin"].includes(
    String(customUser.role_display ?? "").toLowerCase(),
  );
}

const SEGMENTS = MARKET_SEGMENTS;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function relevanceScore(item: any) {
  const t = `${item.title} ${item.excerpt ?? ""}`.toLowerCase();
  const keywords = [
    "australia", "australian", "property", "housing", "home", "dwelling",
    "rba", "apra", "asic", "abs", "mortgage", "loan", "lending", "interest rate",
    "rental", "rent", "vacancy", "tenant", "landlord",
    "construction", "builder", "approval", "supply", "material",
    "planning", "zoning", "land release",
    "inflation", "cpi", "gdp", "wages", "labour", "employment",
    "nsw", "vic", "qld", "wa", "sa", "tas", "act", "nt",
    "sydney", "melbourne", "brisbane", "perth", "adelaide",
    "policy", "regulation", "legislation", "tax", "stamp duty",
    "first home", "grant", "scheme",
  ];
  return Math.min(100, keywords.reduce((n, w) => n + (t.includes(w) ? 8 : 0), 0));
}

function freshnessTier(publishedAt: string | null | undefined) {
  const ref = publishedAt ? new Date(publishedAt).getTime() : Date.now();
  const ageHrs = (Date.now() - ref) / 3_600_000;
  if (ageHrs < 6) return "breaking";
  if (ageHrs < 24) return "today";
  if (ageHrs < 24 * 7) return "this_week";
  return "older";
}

function heuristicClassify(item: any) {
  const t = `${item.title} ${item.excerpt ?? ""}`.toLowerCase();
  const segments: string[] = [];
  if (/(rba|apra|bank|rate|lending|mortgage|loan|credit)/.test(t)) segments.push("finance");
  if (/(property|housing|home price|dwelling|median|clearance)/.test(t)) segments.push("property");
  if (/(construction|builder|approval|material|supply|infrastructure)/.test(t)) segments.push("construction");
  if (/(parliament|minister|government|senate|bill|election)/.test(t)) segments.push("political");
  if (/(inflation|cpi|gdp|wages|jobs|employment|unemployment)/.test(t)) segments.push("economic");
  if (/(homeless|equity|acoss|ahuri|affordability|social)/.test(t)) segments.push("social");
  if (/(regulation|legislation|tax|stamp duty|nccp|asic|revenue|scheme|grant|first home)/.test(t))
    segments.push("policy_regulation");
  if (/(rent|vacancy|tenancy|tenant|landlord|yield)/.test(t)) segments.push("rental");
  if (!segments.length) segments.push("property");
  return normaliseClassification({ category: segments[0], segments, audience_tags: [], confidence_score: 40 });
}

function sourceConfig(source: any): SourceConfig { return { id:source.id, source_key:source.source_key, name:source.name, adapter_type:source.adapter_type || source.source_type, primary_url:source.primary_url || source.url, feed_urls:Array.isArray(source.feed_urls)?source.feed_urls:[], listing_urls:Array.isArray(source.listing_urls)?source.listing_urls:[], adapter_config:source.adapter_config || {}, source_authority:source.source_authority, perspective:source.perspective, copyright_mode:source.copyright_mode, next_cursor:source.next_cursor }; }
async function fetchSource(source:any){
  const cfg=sourceConfig(source);
  if (["feed_with_html_fallback","rss_with_html_fallback"].includes(cfg.adapter_type)) {
    const rss=adapterFor({...cfg,adapter_type:"rss"});
    try { return await rss.fetch(cfg); } catch (feedError) {
      const html=adapterFor({...cfg,adapter_type:"html_listing"}); const batch=await html.fetch(cfg); batch.validation.fallbackUsed=true; batch.validation.safeError=String((feedError as Error).message).slice(0,240); return batch;
    }
  }
  if(cfg.adapter_type==="html_listing_or_licensed_feed") return adapterFor({...cfg,adapter_type:"html_listing"}).fetch(cfg);
  return adapterFor(cfg).fetch(cfg,cfg.next_cursor);
}

async function classifyWithAI(item: any, source: any) {
  if (!LOVABLE_API_KEY) return null;
  const tool = {
    type: "function",
    function: {
      name: "record_market_update",
      description:
        "Classify an Australian real-estate intelligence item into segments with implications and citations.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: SEGMENTS as unknown as string[] },
          segments: {
            type: "array",
            items: { type: "string", enum: SEGMENTS as unknown as string[] },
          },
          geography: { type: "array", items: { type: "string" } },
          impact_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
          audience_tags: {
            type: "array",
            items: {
              type: "string",
              enum: MARKET_AUDIENCES as unknown as string[],
            },
          },
          ai_summary: { type: "string" },
          key_points: { type: "array", items: { type: "string" } },
          why_it_matters: { type: "string" },
          property_implications: { type: "string" },
          finance_implications: { type: "string" },
          policy_implications: { type: "string" },
          risk_flags: { type: "array", items: { type: "string" } },
          lending_criteria_tags: { type: "array", items: { type: "string" } }, legal_topics: { type: "array", items: { type: "string" } }, economic_topics: { type: "array", items: { type: "string" } },
          legal_status: { type: "string" }, effective_date: { type: ["string","null"] }, primary_source_urls: { type: "array", items: { type: "string" } },
          confidence_score: { type: "number" },
        },
        required: [
          "category", "segments", "geography", "impact_level", "audience_tags",
          "ai_summary", "key_points", "why_it_matters", "confidence_score",
        ],
        additionalProperties: false,
      },
    },
  };

  const body = {
    model: AI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an Australian real-estate market intelligence analyst. Classify items into these segments: " +
          SEGMENTS.join(", ") +
          ". Multi-tag when clearly relevant. Ground every claim in the provided source text; never invent facts, figures or citations. Use plain factual Australian English. Separate reporting, advocacy, legal commentary, bills, enacted Acts, operative law and lender policy. Never infer a commencement or effective date without a primary source. Use concise transformative metadata-only summaries. If context is thin, mark impact_level 'low' and confidence_score below 50.",
      },
      {
        role: "user",
        content: `Source: ${source.name} (${source.source_authority ?? source.category}; perspective: ${source.perspective ?? "not stated"})
URL: ${item.canonicalUrl}
Published: ${item.publishedAt ?? "unknown"}
Title: ${item.title}
Excerpt:
${item.excerpt ?? "(no excerpt supplied)"}`,
      },
    ],
    tools: [tool],
    tool_choice: { type: "function", function: { name: "record_market_update" } },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI classify ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) return null;
  try {
    const parsed = JSON.parse(tc.function.arguments);
    if (!Array.isArray(parsed.segments) || !parsed.segments.length) {
      parsed.segments = [parsed.category];
    }
    parsed.segments = parsed.segments.filter((s: string) => SEGMENTS.includes(s as any));
    if (!parsed.segments.length) parsed.segments = ["property"];
    return normaliseClassification(parsed);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get("origin"));
  cors["Access-Control-Allow-Headers"] += ", x-cron-secret";
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, Allow: "POST", "content-type": "application/json" },
    });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  const secret = Deno.env.get("MARKET_INGESTION_CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const apikey = req.headers.get("apikey") ?? "";
  let authorised =
    (secret && req.headers.get("x-cron-secret") === secret) ||
    (serviceRoleKey && ((bearer && bearer === serviceRoleKey) || (apikey && apikey === serviceRoleKey)));

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let requestedBy: string | null = null;

  if (!authorised) {
    const verified = await verifyAuth(sb, req.headers, {});
    if (verified.error || !verified.userId) {
      return json({ error: "Unauthorised market ingestion request." }, 401, cors);
    }
    requestedBy = verified.userId;
    authorised = await isAdminOrSuperadmin(sb, verified.userId);
    if (!authorised) return json({ error: "Forbidden market ingestion request." }, 403, cors);
  }

  const { force = false, sourceIds = null, trigger_type = 'manual', test = false } =
    await req.json().catch(() => ({} as any));

  const { data: run, error: runError } = await sb.rpc('acquire_market_ingestion_run', {
    p_trigger: trigger_type, p_requested_by: requestedBy, p_timeout_seconds: Math.ceil(Number(Deno.env.get('MARKET_UPDATES_RUN_TIMEOUT_MS') ?? 180000) / 1000),
  });
  if (runError) return json({ error: 'Unable to acquire ingestion lock.' }, 503, cors);
  if (run?.metadata?.single_flight_reused) {
    return json({ runId: run.id, status: run.status, active: true, message: 'An ingestion run is already active.' }, 202, cors);
  }

  let query = sb.from("market_sources").select("*").eq("enabled", true);
  if (Array.isArray(sourceIds) && sourceIds.length) query = query.in("id", sourceIds);
  const { data: sources, error } = await query;
  if (error) {
    await sb.from("market_ingestion_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: "Unable to read the source registry." }).eq("id", run.id);
    return json({ error: "Unable to read the Market Updates source registry." }, 500, cors);
  }
  if (!sources?.length) {
    const { count } = await sb.from("market_sources").select("id", { count: "exact", head: true });
    const message = count === 0
      ? "The Market Updates source registry has not been seeded in this environment."
      : "No enabled market sources are configured in the connected database.";
    await sb.from("market_ingestion_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: message }).eq("id", run.id);
    return json({ runId: run.id, status: "failed", error: message }, 422, cors);
  }

  const summary = {
    runId: run.id,
    sourcesConsidered: sources?.length ?? 0,
    sourcesProcessed: 0,
    ingested: 0,
    published: 0,
    candidates: 0,
    ignored: 0,
    failed: 0,
    skippedDuplicates: 0,
    aiClassified: 0,
    aiFallbacks: 0,
    sourceErrors: [] as Array<{ sourceId: string; message: string }>,
    message: "Market ingestion completed.",
  };

  for (const source of sources ?? []) {
    let fetchRunId: string | null = null;
    try {
      const last = source.last_fetched_at
        ? Date.now() - new Date(source.last_fetched_at).getTime()
        : Infinity;
      if (!force && last < (source.refresh_frequency_minutes ?? source.refresh_frequency_hours * 60) * 60_000) continue;
      summary.sourcesProcessed++;

      const { data: fetchRun } = await sb.from("market_source_fetch_runs").insert({
        ingestion_run_id: run.id, source_id: source.id, status: "running",
      }).select("id").single();
      fetchRunId = fetchRun?.id ?? null;

      await sb
        .from("market_sources")
        .update({ last_fetched_at: new Date().toISOString(), last_error: null })
        .eq("id", source.id);

      const batch = await fetchSource(source);
      const items = batch.items;
      if (test) {
        summary.ingested += items.length;
        if (fetchRunId) await sb.from("market_source_fetch_runs").update({ status: "completed", completed_at: new Date().toISOString(), http_status: batch.validation.httpStatus, adapter_used: batch.validation.format, feed_url_used: batch.validation.endpoint, latency_ms: batch.validation.latencyMs, items_discovered: items.length }).eq("id", fetchRunId);
        continue;
      }

      let sourcePublished = 0;

      for (const item of items) {
        const dedupe_hash = await sha256(
          [item.canonicalUrl, item.title, source.name, item.publishedAt ?? ""]
            .join("|")
            .toLowerCase(),
        );
        const { data: existing } = await sb
          .from("market_updates")
          .select("id")
          .eq("dedupe_hash", dedupe_hash)
          .maybeSingle();
        if (existing) {
          summary.skippedDuplicates++;
          continue;
        }

        const relevance = relevanceScore(item);
        if (relevance < RELEVANCE_THRESHOLD) {
          // Persist as ignored to prevent re-processing next cycle.
          await sb.from("market_updates").insert({
            source_id: source.id,
            source_name: source.name,
            source_url: item.canonicalUrl,
            canonical_url: item.canonicalUrl,
            original_url: item.originalUrl,
            external_id: item.externalId,
            source_published_at: item.publishedAt,
            title: item.title,
            slug: item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 180),
            category: "other",
            segments: [],
            geography: ["Australia"],
            impact_level: "low",
            audience_tags: [],
            raw_excerpt: item.excerpt,
            key_points: [],
            risk_flags: [],
            citation_urls: [item.canonicalUrl],
            relevance_score: relevance,
            freshness_tier: freshnessTier(item.publishedAt),
            status: "ignored",
            dedupe_hash,
          });
          summary.ingested++;
          summary.ignored++;
          continue;
        }

        let ai: any = null;
        try {
          ai = await classifyWithAI(item, source);
          if (ai) summary.aiClassified++;
        } catch (e) {
          console.warn(`AI classify failed for ${source.name}:`, String(e?.message ?? e));
        }
        if (!ai) {
          const heur = heuristicClassify(item);
          ai = {
            category: heur.category,
            segments: heur.segments,
            geography: ["Australia"],
            impact_level: relevance > 60 ? "medium" : "low",
            audience_tags: [],
            ai_summary: item.excerpt?.slice(0, 500) ?? null,
            key_points: [],
            why_it_matters: null,
            property_implications: null,
            finance_implications: null,
            policy_implications: null,
            risk_flags: [],
            confidence_score: 40,
          };
          summary.aiFallbacks++;
        }

        const confidence = Number(ai.confidence_score ?? 0);
        const citation_urls = [item.canonicalUrl].filter(Boolean);
        const status =
          confidence >= AI_CONFIDENCE_THRESHOLD && citation_urls.length ? "published" : "candidate";

        await sb.from("market_updates").insert({
          source_id: source.id,
          source_name: source.name,
          source_url: item.canonicalUrl,
            canonical_url: item.canonicalUrl,
            original_url: item.originalUrl,
            external_id: item.externalId,
          source_published_at: item.publishedAt,
          title: item.title,
          slug: item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 180),
          category: ai.category,
          segments: ai.segments,
          geography: ai.geography?.length ? ai.geography : ["Australia"],
          impact_level: ai.impact_level ?? "medium",
          audience_tags: ai.audience_tags ?? [],
          raw_excerpt: item.excerpt,
          ai_summary: ai.ai_summary,
          key_points: ai.key_points ?? [],
          why_it_matters: ai.why_it_matters,
          property_implications: ai.property_implications ?? null,
          finance_implications: ai.finance_implications ?? null,
          policy_implications: ai.policy_implications ?? null,
          risk_flags: ai.risk_flags ?? [],
          confidence_score: confidence,
          citation_urls,
          source_authority: source.source_authority, source_perspective: source.perspective, author:item.author, public_excerpt:item.excerpt,
          source_payload_hash: await sha256(JSON.stringify({title:item.title,url:item.canonicalUrl,date:item.publishedAt,excerpt:item.excerpt})), classification_version:"market-v2", summarisation_version:"market-v2", model_used:AI_MODEL,
          lending_criteria_tags: ai.lending_criteria_tags ?? [], legal_topics: ai.legal_topics ?? [], economic_topics: ai.economic_topics ?? [], legal_status: ai.legal_status ?? "not_applicable", effective_date:ai.effective_date ?? null, primary_source_urls:ai.primary_source_urls ?? [],
          relevance_score: relevance,
          freshness_tier: freshnessTier(item.publishedAt),
          status,
          dedupe_hash,
        });

        summary.ingested++;
        if (status === "published") summary.published++;
        if (status === "published") sourcePublished++;
        else summary.candidates++;
      }

      if (fetchRunId) await sb.from("market_source_fetch_runs").update({ status: batch.validation.fallbackUsed ? "degraded" : "completed", completed_at: new Date().toISOString(), http_status: batch.validation.httpStatus, adapter_used: batch.validation.format, feed_url_used: batch.validation.endpoint, latency_ms: batch.validation.latencyMs, items_discovered: items.length, items_published: sourcePublished, safe_error_message: batch.validation.fallbackUsed ? batch.validation.safeError : null }).eq("id", fetchRunId);

      await sb
        .from("market_sources")
        .update({ last_success_at: new Date().toISOString(), last_error: batch.validation.fallbackUsed ? batch.validation.safeError : null, consecutive_failures:0, health_status:batch.validation.fallbackUsed?'degraded':'healthy', last_http_status:batch.validation.httpStatus, last_latency_ms:batch.validation.latencyMs, last_items_discovered:items.length, last_items_published:sourcePublished })
        .eq("id", source.id);
    } catch (e) {
      summary.failed++;
      const message = String(e?.message ?? e);
      summary.sourceErrors.push({ sourceId: source.id, message });
      if (fetchRunId) await sb.from("market_source_fetch_runs").update({ status: "failed", completed_at: new Date().toISOString(), safe_error_message: message.slice(0, 240), consecutive_failure_count: (source.consecutive_failures ?? 0) + 1 }).eq("id", fetchRunId);
      await sb.from("market_sources").update({ last_error: message.slice(0,240), consecutive_failures:(source.consecutive_failures??0)+1, health_status:(source.consecutive_failures??0)+1>=3?'failed':'degraded' }).eq("id", source.id);
    }
  }

  const finalStatus = summary.failed ? (summary.sourcesProcessed > summary.failed ? 'partial' : 'failed') : 'completed';
  await sb.from('market_ingestion_runs').update({status:finalStatus,completed_at:new Date().toISOString(),sources_considered:summary.sourcesConsidered,sources_processed:summary.sourcesProcessed,sources_succeeded:Math.max(0,summary.sourcesProcessed-summary.failed),sources_failed:summary.failed,items_discovered:summary.ingested+summary.skippedDuplicates,items_deduplicated:summary.skippedDuplicates,items_classified:summary.aiClassified,items_published:summary.published,items_candidate:summary.candidates,items_ignored:summary.ignored}).eq('id',run.id);
  if(summary.published>0&&!test){
    const cronSecret = Deno.env.get('MARKET_INGESTION_CRON_SECRET');
    if (cronSecret) fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/market-updates-digest`,{method:'POST',headers:{'x-cron-secret':cronSecret,'content-type':'application/json'},body:JSON.stringify({period:'24h',internal_action:'post_ingestion'})}).catch(()=>undefined);
  }
  return json({...summary,status:finalStatus}, 200, cors);
});
