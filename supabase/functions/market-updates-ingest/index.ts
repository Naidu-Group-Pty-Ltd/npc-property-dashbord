// Market Updates Ingest — Phase 2
// Fetches enabled RSS sources, deduplicates, classifies with Lovable AI Gateway
// (google/gemini-3-flash-preview) into 8 real-estate intelligence segments,
// enriches with implications/risk flags/citations, and persists to market_updates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth } from "../_shared/auth.ts";
import { requireModulePermission } from "../_shared/authz.ts";
import { verifyRequiredCronSecret, securityJsonError } from "../_shared/requestSecurity.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const AI_MODEL = Deno.env.get("MARKET_AI_MODEL") ?? "google/gemini-3-flash-preview";
const RELEVANCE_THRESHOLD = Number(Deno.env.get("MARKET_RELEVANCE_THRESHOLD") ?? 40);
const AI_CONFIDENCE_THRESHOLD = Number(Deno.env.get("MARKET_AI_CONFIDENCE_THRESHOLD") ?? 55);

const SEGMENTS = [
  "finance",
  "property",
  "construction",
  "political",
  "economic",
  "social",
  "policy_regulation",
  "rental",
] as const;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
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
  return { category: segments[0], segments };
}

async function fetchRss(source: any): Promise<any[]> {
  if (source.source_type !== "rss") return [];
  const res = await fetch(source.url, {
    headers: {
      "User-Agent": "NPC-MarketIntel/1.0 (+https://npcservices.com.au)",
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`RSS fetch failed ${res.status} for ${source.url}`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)]
    .slice(0, 25)
    .map((m) => {
      const x = m[0];
      const pick = (tag: string) =>
        x.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]
          ?.replace(/<!\[CDATA\[|\]\]>/g, "")
          ?.replace(/<[^>]+>/g, "")
          ?.trim();
      const linkAttr = x.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
      return {
        title: pick("title") ?? "Untitled market update",
        source_url: pick("link") ?? linkAttr ?? source.url,
        source_published_at: pick("pubDate") ?? pick("published") ?? pick("updated") ?? null,
        excerpt: pick("description") ?? pick("summary") ?? pick("content") ?? null,
      };
    })
    .filter((i) => i.title && i.source_url);
  return items;
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
              enum: ["buyers", "investors", "owner_occupiers", "brokers", "advisers", "developers", "policy"],
            },
          },
          ai_summary: { type: "string" },
          key_points: { type: "array", items: { type: "string" } },
          why_it_matters: { type: "string" },
          property_implications: { type: "string" },
          finance_implications: { type: "string" },
          policy_implications: { type: "string" },
          risk_flags: { type: "array", items: { type: "string" } },
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
          ". Multi-tag when clearly relevant. Ground every claim in the provided source text; never invent facts, figures or citations. Use plain factual Australian English. If context is thin, mark impact_level 'low' and confidence_score below 50.",
      },
      {
        role: "user",
        content: `Source: ${source.name} (${source.category})
URL: ${item.source_url}
Published: ${item.source_published_at ?? "unknown"}
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
    return parsed;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const secret = Deno.env.get("MARKET_INGESTION_CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const apikey = req.headers.get("apikey") ?? "";
  const automated =
    verifyRequiredCronSecret(secret, req.headers.get("x-cron-secret")) ||
    Boolean(serviceRoleKey && (bearer === serviceRoleKey || apikey === serviceRoleKey));

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!automated) {
    let bodyPreview: any = {};
    try { bodyPreview = await req.clone().json(); } catch {}
    const verified = await verifyAuth(sb, req.headers, bodyPreview);
    if (verified.error || !verified.userId) return securityJsonError(401, "unauthorized");
    const permission = await requireModulePermission(
      sb,
      { userId: verified.userId, authMethod: verified.authMethod },
      "market_updates",
      "can_edit",
    );
    if (!permission.ok) return securityJsonError(403, "market_ingest_admin_required");
  }

  const { force = false, sourceIds = null } =
    await req.json().catch(() => ({} as any));

  let query = sb.from("market_sources").select("*").eq("enabled", true);
  if (Array.isArray(sourceIds) && sourceIds.length) query = query.in("id", sourceIds);
  const { data: sources, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const summary = {
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
    try {
      const last = source.last_fetched_at
        ? Date.now() - new Date(source.last_fetched_at).getTime()
        : Infinity;
      if (!force && last < source.refresh_frequency_hours * 3_600_000) continue;
      summary.sourcesProcessed++;

      await sb
        .from("market_sources")
        .update({ last_fetched_at: new Date().toISOString(), last_error: null })
        .eq("id", source.id);

      const items = await fetchRss(source);

      for (const item of items) {
        const dedupe_hash = hash(
          [item.source_url, item.title, source.name, item.source_published_at ?? ""]
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
            source_url: item.source_url,
            source_published_at: item.source_published_at,
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
            citation_urls: [item.source_url],
            relevance_score: relevance,
            freshness_tier: freshnessTier(item.source_published_at),
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
        const citation_urls = [item.source_url].filter(Boolean);
        const status =
          confidence >= AI_CONFIDENCE_THRESHOLD && citation_urls.length ? "published" : "candidate";

        await sb.from("market_updates").insert({
          source_id: source.id,
          source_name: source.name,
          source_url: item.source_url,
          source_published_at: item.source_published_at,
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
          relevance_score: relevance,
          freshness_tier: freshnessTier(item.source_published_at),
          status,
          dedupe_hash,
        });

        summary.ingested++;
        if (status === "published") summary.published++;
        else summary.candidates++;
      }

      await sb
        .from("market_sources")
        .update({ last_success_at: new Date().toISOString(), last_error: null })
        .eq("id", source.id);
    } catch (e) {
      summary.failed++;
      const message = String(e?.message ?? e);
      summary.sourceErrors.push({ sourceId: source.id, message });
      await sb.from("market_sources").update({ last_error: message }).eq("id", source.id);
    }
  }

  return json(summary);
});
