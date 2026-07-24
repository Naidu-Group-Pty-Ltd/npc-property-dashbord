/**
 * AML provider orchestration (Phase 6 upgrade).
 *
 * Tri-mode isolation:
 *   - "simulator": deterministic, no external calls (default, safe for tests).
 *   - "live":      real external provider adapters. If a requested provider is
 *                  not wired, the factory THROWS (never silently falls back to
 *                  simulator) so that a live-mode misconfiguration surfaces
 *                  loudly instead of producing a false-pass.
 *
 * Mode is resolved per capability using (in priority order):
 *   1. `provider_configs.mode` for the tenant's active provider (if `admin` client passed).
 *   2. Env override: `AML_PROVIDER_MODE` = "simulator" | "live".
 *   3. Default: "simulator".
 *
 * Providers MUST NEVER be selected client-side. Callers pass a hint only;
 * the shared factory + tenant configuration decide.
 */

export type IdvMethod = "document_and_liveness" | "document_only" | "database_lookup" | "manual";

export interface IdvRequest {
  caseId: string;
  subjectLabel: string;
  method: IdvMethod;
  metadata?: Record<string, unknown>;
}

export interface IdvResult {
  provider: string;
  providerReference: string;
  status: "verified" | "failed" | "manual_review" | "pending" | "in_progress";
  overallScore: number;
  checks: Array<{ name: string; status: "pass" | "fail" | "warn"; detail?: string }>;
  raw: Record<string, unknown>;
}

export type ScreeningScope = "pep" | "sanctions" | "adverse_media" | "watchlist";

export interface ScreeningRequest {
  caseId: string;
  subjectLabel: string;
  subjectType: "individual" | "entity" | "trust";
  scope: ScreeningScope[];
  metadata?: Record<string, unknown>;
}

export interface ScreeningMatch {
  matchType: "pep" | "sanctions" | "adverse_media" | "watchlist" | "other";
  listName: string;
  matchedName: string;
  score: number;
  jurisdiction?: string;
  details: Record<string, unknown>;
}

export interface ScreeningResult {
  provider: string;
  providerReference: string;
  status: "clear" | "matched" | "review";
  matches: ScreeningMatch[];
  summary: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface IdvProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  runIdv(req: IdvRequest): Promise<IdvResult>;
}

export interface ScreeningProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  runScreening(req: ScreeningRequest): Promise<ScreeningResult>;
}

export type ProviderMode = "simulator" | "live";
export type ProviderCapability = "idv" | "screening" | "adverse_media";

// ---------- deterministic simulators ----------

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function pseudoRandom(seed: number, salt: string): number {
  const n = hashSeed(`${seed}|${salt}`);
  return (n % 10_000) / 10_000;
}

const SIMULATOR_IDV: IdvProvider = {
  name: "simulator",
  mode: "simulator",
  async runIdv(req) {
    const seed = hashSeed(`${req.caseId}|${req.subjectLabel}`);
    const scoreBase = pseudoRandom(seed, "idv");
    const overallScore = Math.round((0.6 + scoreBase * 0.4) * 100) / 100;
    const status: IdvResult["status"] =
      overallScore >= 0.85 ? "verified" : overallScore >= 0.70 ? "manual_review" : "failed";
    return {
      provider: "simulator",
      providerReference: `SIM-IDV-${seed.toString(36).slice(0, 10).toUpperCase()}`,
      status,
      overallScore,
      checks: [
        { name: "document_authenticity", status: status === "failed" ? "fail" : "pass" },
        { name: "face_match", status: overallScore >= 0.8 ? "pass" : "warn" },
        { name: "liveness", status: req.method === "document_only" ? "warn" : "pass" },
        { name: "database_crossmatch", status: "pass" },
      ],
      raw: { simulated: true, method: req.method, generated_at: new Date().toISOString() },
    };
  },
};

const KNOWN_LIST_HITS = [
  { pattern: /vladimir|putin/i, list: "OFAC SDN",           type: "sanctions" as const, jur: "US" },
  { pattern: /kim jong/i,       list: "UN Consolidated",    type: "sanctions" as const, jur: "UN" },
  { pattern: /orban|erdogan/i,  list: "PEP Register",       type: "pep" as const,       jur: "EU" },
];

const SIMULATOR_SCREENING: ScreeningProvider = {
  name: "simulator",
  mode: "simulator",
  async runScreening(req) {
    const seed = hashSeed(`${req.caseId}|${req.subjectLabel}`);
    const matches: ScreeningMatch[] = [];

    for (const rule of KNOWN_LIST_HITS) {
      if (rule.pattern.test(req.subjectLabel) && req.scope.includes(rule.type as ScreeningScope)) {
        matches.push({
          matchType: rule.type,
          listName: rule.list,
          matchedName: req.subjectLabel,
          score: 0.92,
          jurisdiction: rule.jur,
          details: { rule: "keyword", simulated: true },
        });
      }
    }

    if (req.scope.includes("adverse_media") && pseudoRandom(seed, "am") > 0.85) {
      matches.push({
        matchType: "adverse_media",
        listName: "Aggregated News",
        matchedName: req.subjectLabel,
        score: 0.62,
        details: { headline: "Regulatory inquiry (simulated)", simulated: true },
      });
    }

    const status: ScreeningResult["status"] =
      matches.length === 0 ? "clear"
      : matches.some((m) => m.score >= 0.85) ? "matched"
      : "review";

    return {
      provider: "simulator",
      providerReference: `SIM-SCR-${seed.toString(36).slice(0, 10).toUpperCase()}`,
      status,
      matches,
      summary: {
        scope: req.scope,
        match_count: matches.length,
        high_confidence_count: matches.filter((m) => m.score >= 0.85).length,
      },
      raw: { simulated: true, generated_at: new Date().toISOString() },
    };
  },
};

// ---------- live adapter stubs (throw until wired) ----------
//
// Real adapters (Frankie, Trulioo, ComplyAdvantage, Refinitiv, Dow Jones…)
// will be added here one by one. Each stub throws a clearly-labelled error so
// that "live" mode never silently falls back to simulator results.

const LIVE_IDV_ADAPTERS: Record<string, () => IdvProvider> = {
  // "frankie":       () => makeFrankieIdvProvider(),
  // "trulioo":       () => makeTruliooIdvProvider(),
};
const LIVE_SCREENING_ADAPTERS: Record<string, () => ScreeningProvider> = {
  // "complyadvantage": () => makeComplyAdvantageProvider(),
  // "refinitiv":       () => makeRefinitivProvider(),
  // "dowjones":        () => makeDowJonesProvider(),
};

// ---------- resolver + factory ----------

export interface ResolvedProvider {
  providerKey: string;
  mode: ProviderMode;
  configId: string | null;
  config: Record<string, unknown>;
  costCents: number;
}

/**
 * Resolve the tenant's highest-priority active provider for a capability.
 * Returns null if the tenant has no configured provider (caller falls back
 * to env / simulator default).
 */
export async function resolveTenantProvider(
  admin: any,
  tenantId: string,
  capability: ProviderCapability,
): Promise<ResolvedProvider | null> {
  if (!admin) return null;
  try {
    const { data } = await admin.schema("aml").from("provider_configs")
      .select("id, provider_key, mode, config, cost_per_unit_cents, priority, active")
      .eq("tenant_id", tenantId)
      .eq("capability", capability)
      .eq("active", true)
      .order("priority", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      providerKey: String(data.provider_key),
      mode: (data.mode === "live" ? "live" : "simulator") as ProviderMode,
      configId: data.id ?? null,
      config: (data.config ?? {}) as Record<string, unknown>,
      costCents: Number(data.cost_per_unit_cents ?? 0),
    };
  } catch (e) {
    console.warn("[aml/providers] resolveTenantProvider failed", (e as Error)?.message);
    return null;
  }
}

function envMode(): ProviderMode {
  const v = (Deno.env.get("AML_PROVIDER_MODE") || "").toLowerCase();
  return v === "live" ? "live" : "simulator";
}

export interface FactoryOptions {
  /** Tenant-resolved provider (see `resolveTenantProvider`). */
  resolved?: ResolvedProvider | null;
  /** Free-form hint from caller; only used when no tenant config exists. */
  preferred?: string;
}

export function getIdvProvider(opts: FactoryOptions = {}): IdvProvider {
  const mode: ProviderMode = opts.resolved?.mode ?? envMode();
  const key = (opts.resolved?.providerKey || opts.preferred || "simulator").toLowerCase();

  if (mode === "simulator" || key === "simulator") return SIMULATOR_IDV;

  const build = LIVE_IDV_ADAPTERS[key];
  if (!build) {
    throw new Error(
      `[aml/providers] IDV provider "${key}" is set to live mode but no adapter is wired. ` +
      `Configure the adapter or switch this provider back to simulator mode in AML › Configuration › Providers.`,
    );
  }
  return build();
}

export function getScreeningProvider(opts: FactoryOptions = {}): ScreeningProvider {
  const mode: ProviderMode = opts.resolved?.mode ?? envMode();
  const key = (opts.resolved?.providerKey || opts.preferred || "simulator").toLowerCase();

  if (mode === "simulator" || key === "simulator") return SIMULATOR_SCREENING;

  const build = LIVE_SCREENING_ADAPTERS[key];
  if (!build) {
    throw new Error(
      `[aml/providers] Screening provider "${key}" is set to live mode but no adapter is wired. ` +
      `Configure the adapter or switch this provider back to simulator mode in AML › Configuration › Providers.`,
    );
  }
  return build();
}

/** Adverse media resolves to the same screening adapter, restricted to that scope. */
export function getAdverseMediaProvider(opts: FactoryOptions = {}): ScreeningProvider {
  return getScreeningProvider(opts);
}

// ---------- metrics helper ----------

/**
 * Wrap a provider call, recording latency + success/failure + cost into
 * `aml.provider_metrics_daily`. Metrics failures never break the call.
 */
export async function runWithMetrics<T>(
  admin: any,
  args: {
    tenantId: string;
    capability: ProviderCapability;
    providerKey: string;
    costCents?: number;
    configId?: string | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  let failed = 0;
  try {
    const out = await fn();
    return out;
  } catch (e) {
    failed = 1;
    if (admin && args.configId) {
      await admin.schema("aml").from("provider_configs").update({
        last_health_at: new Date().toISOString(),
        last_health_status: "failing",
        last_health_message: (e as Error)?.message?.slice(0, 240) ?? "provider_failure",
      }).eq("id", args.configId).then(() => {}, () => {});
    }
    throw e;
  } finally {
    const latency = Date.now() - started;
    try {
      if (admin) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existing } = await admin.schema("aml").from("provider_metrics_daily")
        .select("id, call_count, failure_count, latency_ms_sum, cost_cents_sum")
        .eq("tenant_id", args.tenantId)
        .eq("capability", args.capability)
        .eq("provider_key", args.providerKey)
        .eq("metric_date", today)
        .maybeSingle();
      if (existing) {
        await admin.schema("aml").from("provider_metrics_daily").update({
          call_count: (existing.call_count ?? 0) + 1,
          failure_count: (existing.failure_count ?? 0) + failed,
          latency_ms_sum: Number(existing.latency_ms_sum ?? 0) + latency,
          cost_cents_sum: Number(existing.cost_cents_sum ?? 0) + (failed ? 0 : Number(args.costCents ?? 0)),
        }).eq("id", existing.id);
      } else {
        await admin.schema("aml").from("provider_metrics_daily").insert({
          tenant_id: args.tenantId,
          capability: args.capability,
          provider_key: args.providerKey,
          metric_date: today,
          call_count: 1,
          failure_count: failed,
          latency_ms_sum: latency,
          cost_cents_sum: failed ? 0 : Number(args.costCents ?? 0),
        });
      }
      }
    } catch (metricErr) {
      console.warn("[aml/providers] metric recording failed", (metricErr as Error)?.message);
    }
  }
}

// ---------- webhook signature verification ----------

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHex || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(macBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== signatureHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  }
  return diff === 0;
}
