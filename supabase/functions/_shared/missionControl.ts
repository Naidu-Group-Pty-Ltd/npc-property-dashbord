// Mission Control token client — reserve / commit / cancel / balance / packs.
// Aurixa Mission Control is the single source of truth for billing.
// This module is the ONLY place that talks to its public token API.
//
// API contract: see prime-repo-token-integration_1.md
//   - auth header:        x-clone-api-key
//   - request payload:    snake_case (tenant_ref, estimated_tokens, idempotency_key, …)
//   - balance response:   { tenant, balance: { available, reserved, lifetime_granted, lifetime_spent } }
//   - rate-limited:       60 req/min/key, 429 + Retry-After
//   - idempotent retries: same idempotency_key returns existing job

const BASE_URL = (Deno.env.get("MISSION_CONTROL_URL") ?? "").replace(/\/+$/, "");
const API_KEY = Deno.env.get("MISSION_CONTROL_CLONE_API_KEY") ?? "";

// Stable per-agency tenant ref. Single-agency install → Supabase project ref.
const PROJECT_REF =
  Deno.env.get("SUPABASE_URL")?.match(/https:\/\/([^.]+)\./)?.[1] ?? "prime";
export const AGENCY_TENANT_REF = `prime:${PROJECT_REF}`;
export const AGENCY_DISPLAY_NAME = Deno.env.get("MISSION_CONTROL_AGENCY_NAME") ?? "Prime";

export type TokenKind =
  | "report.investment.compass"
  | "report.investment.executive"
  | "report.investment.snapshot"
  | "report.suburb.compass"
  | "report.postcode.compass"
  | "report.market-intelligence"
  | "report.portfolio-review"
  | "report.bulk-item"
  | "report.chart-analysis"
  | "report.qualitative-regen"
  | "aml_identity_check"
  | "aml_screening_check";

export interface ReserveArgs {
  kind: TokenKind;
  estimatedTokens: number;
  idempotencyKey: string;
  userId: string;
  requestPayload?: Record<string, unknown>;
  ttlSeconds?: number;
}

export interface ReserveResult {
  jobId: string;
  reserved: number;
  available: number;
  idempotent?: boolean;
  status?: string;
  /** Operator-assigned tracking id for this tenant/clone (Mission Control). */
  billingUserId?: string | null;
}

export interface BalanceResult {
  available: number;
  allowance: number;
  used: number;
  reserved: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  planName: string | null;
  overagePolicy: string | null;
  currentPeriodEnd: string | null;
  /** True when Mission Control marks this tenant billing-exempt (no plan,
   * never funds-gated). Set per-tenant in MC, so clone installs of this same
   * code keep normal plan enforcement. */
  exempt: boolean;
}

export interface TopupPack {
  id: string;
  slug: string;
  name: string;
  tokens: number;
  priceCents: number;
  currency: string;
  expiresAfterDays: number | null;
}

export interface TopupPacksResult {
  packs: TopupPack[];
  topupUrl: string | null;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export class MissionControlError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "MissionControlError";
  }
}

export class InsufficientTokensError extends MissionControlError {
  constructor(public available: number, public requested: number, details?: unknown) {
    super(
      "insufficient_funds",
      `Insufficient tokens: requested ${requested}, available ${available}`,
      402,
      details,
    );
    this.name = "InsufficientTokensError";
  }
}

export class RateLimitedError extends MissionControlError {
  constructor(public retryAfterSeconds: number, details?: unknown) {
    super("rate_limited", `Mission Control rate limited; retry after ${retryAfterSeconds}s`, 429, details);
    this.name = "RateLimitedError";
  }
}

function assertConfigured() {
  if (!BASE_URL || !API_KEY) {
    throw new MissionControlError(
      "unconfigured",
      "MISSION_CONTROL_URL or MISSION_CONTROL_CLONE_API_KEY missing",
      500,
    );
  }
}

async function mcFetchRaw(path: string, init: RequestInit): Promise<Response> {
  assertConfigured();
  return await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-clone-api-key": API_KEY,
      ...(init.headers ?? {}),
    },
  });
}

/** Fetch with one retry on 429 (honoring Retry-After) and 5xx (500ms back-off). */
async function mcFetch(path: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await mcFetchRaw(path, init);
    if (res.status === 429 && attempt === 0) {
      const ra = Number(res.headers.get("retry-after") ?? "1");
      const waitMs = Math.min(Math.max(ra, 1), 10) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (res.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    return res;
  }
  // Unreachable, but TypeScript-safe fallback.
  return await mcFetchRaw(path, init);
}

async function parseOrThrow(res: Response): Promise<any> {
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* keep raw */ }

  // MC uses `ok: false` envelope even on 200 for some errors (e.g. insufficient_funds).
  const okFlag = body?.ok !== false;
  if (res.ok && okFlag) return body;

  const code = body?.error ?? body?.code ?? "mc_error";
  const message = body?.message ?? (typeof code === "string" ? code : `Mission Control ${res.status}`);

  if (code === "insufficient_funds") {
    throw new InsufficientTokensError(
      Number(body?.available ?? 0),
      Number(body?.required ?? body?.requested ?? 0),
      body,
    );
  }
  if (code === "rate_limited" || res.status === 429) {
    throw new RateLimitedError(
      Number(body?.retry_after_seconds ?? res.headers.get("retry-after") ?? 1),
      body,
    );
  }
  throw new MissionControlError(code, message, res.status || 500, body);
}

export async function reserveTokens(args: ReserveArgs): Promise<ReserveResult> {
  const res = await mcFetch("/api/public/tokens/reserve", {
    method: "POST",
    body: JSON.stringify({
      tenant_ref: AGENCY_TENANT_REF,
      display_name: AGENCY_DISPLAY_NAME,
      kind: args.kind,
      estimated_tokens: args.estimatedTokens,
      idempotency_key: args.idempotencyKey,
      ttl_seconds: args.ttlSeconds,
      request_payload: {
        user_id: args.userId,
        ...(args.requestPayload ?? {}),
      },
    }),
  });
  const body = await parseOrThrow(res);
  return {
    jobId: body.job_id ?? body.jobId,
    reserved: Number(body.reserved_tokens ?? body.reserved ?? args.estimatedTokens),
    available: Number(body.available_after ?? body.available ?? 0),
    idempotent: Boolean(body.idempotent),
    status: body.status,
    billingUserId: body.billing_user_id ?? null,
  };
}

export async function commitTokens(jobId: string, actualTokens: number, resultMeta?: Record<string, unknown>): Promise<void> {
  // Commit must always succeed eventually. Retry once on 5xx — commit is idempotent on completed jobs.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await mcFetchRaw("/api/public/tokens/commit", {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        actual_tokens: actualTokens,
        result_meta: resultMeta,
      }),
    });
    if (res.ok) { await res.text(); return; }
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((r) => setTimeout(r, Math.min(ra, 10) * 1000));
      continue;
    }
    if (res.status < 500 || attempt === 2) {
      await parseOrThrow(res);
      return;
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
}

export async function cancelTokens(jobId: string, reason?: string): Promise<void> {
  try {
    const res = await mcFetchRaw("/api/public/tokens/cancel", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, reason: reason?.slice(0, 280) ?? "generation_failed" }),
    });
    await res.text();
  } catch (e) {
    // Best effort — never let cancel failure mask the original error.
    // Reservations auto-expire after TTL anyway.
    console.error("[missionControl] cancel failed", e);
  }
}

export async function getBalance(): Promise<BalanceResult> {
  const q = new URLSearchParams({
    tenant_ref: AGENCY_TENANT_REF,
    display_name: AGENCY_DISPLAY_NAME,
  });
  const res = await mcFetch(`/api/public/tokens/balance?${q.toString()}`, { method: "GET" });
  const body = await parseOrThrow(res);

  const tenant = body?.tenant ?? {};
  const plan = tenant?.billing_plans ?? null;
  const balance = body?.balance ?? body ?? {};

  const allowance = Number(plan?.monthly_allowance ?? body?.allowance ?? 0);
  const lifetimeGranted = Number(balance?.lifetime_granted ?? 0);
  const lifetimeSpent = Number(balance?.lifetime_spent ?? balance?.used ?? 0);
  const available = Number(balance?.available ?? 0);
  const reserved = Number(balance?.reserved ?? 0);

  // `used` should reflect CURRENT PERIOD consumption (matches the "of N allowance"
  // progress bar in the UI), not lifetime spend. Prefer an MC-provided period figure
  // when available; otherwise derive it from allowance − available − reserved and
  // cap at the allowance so the pill can't show implausible multi-million totals
  // caused by legacy lifetime_spent bleed-through.
  const periodUsedRaw = Number(
    balance?.period_used ?? balance?.current_period_spent ?? body?.period_used ?? NaN,
  );
  const derivedUsed = Math.max(0, allowance - available - reserved);
  const used = Number.isFinite(periodUsedRaw) && periodUsedRaw >= 0
    ? Math.min(periodUsedRaw, allowance > 0 ? allowance : periodUsedRaw)
    : allowance > 0
      ? Math.min(derivedUsed, allowance)
      : 0;

  return {
    available,
    reserved,
    allowance,
    used,
    lifetimeGranted,
    lifetimeSpent,
    planName: plan?.name ?? null,
    overagePolicy: plan?.overage_policy ?? null,
    currentPeriodEnd: tenant?.current_period_end ?? null,
    exempt: Boolean(tenant?.billing_exempt),
  };
}

export async function listTopupPacks(
  opts: {
    limit?: number;
    offset?: number;
    /** When set, Mission Control mints the topup_url as an attributed handoff
     * deep link carrying this user (user-attributed pricing workflow). */
    originUserId?: string;
    originUsername?: string | null;
  } = {},
): Promise<TopupPacksResult> {
  const q = new URLSearchParams({ tenant_ref: AGENCY_TENANT_REF });
  if (opts.limit) q.set("limit", String(Math.min(opts.limit, 100)));
  if (opts.offset) q.set("offset", String(opts.offset));
  if (opts.originUserId) {
    q.set("origin_user_id", opts.originUserId.slice(0, 200));
    if (opts.originUsername) q.set("origin_username", opts.originUsername.slice(0, 200));
  }
  const res = await mcFetch(`/api/public/tokens/packs?${q.toString()}`, { method: "GET" });
  const body = await parseOrThrow(res);
  const pagination = body?.pagination ?? {};
  return {
    packs: Array.isArray(body?.packs)
      ? body.packs.map((p: any) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          tokens: Number(p.tokens ?? 0),
          priceCents: Number(p.price_cents ?? 0),
          currency: String(p.currency ?? "USD"),
          expiresAfterDays: p.expires_after_days ?? null,
        }))
      : [],
    topupUrl: body?.topup_url ?? null,
    pagination: {
      limit: Number(pagination.limit ?? 50),
      offset: Number(pagination.offset ?? 0),
      total: Number(pagination.total ?? 0),
      hasMore: Boolean(pagination.has_more),
      nextOffset: pagination.next_offset ?? null,
    },
  };
}

// ── Billing handoff (user-attributed pricing workflow) ─────────────────────
// Mints a single-use, expiring deep link into Mission Control's pricing page
// that carries the initiating command-center user server-to-server. The
// browser only ever sees the opaque `?h=<uuid>` token.

export interface HandoffArgs {
  originUserId: string;
  originUsername?: string | null;
  /** '<mode>' or '<mode>:<item_id>' — restricts what the handoff can buy. */
  intent?: string;
  /** Absolute https URL back into this app for the post-checkout return CTA. */
  returnUrl?: string;
}

export interface HandoffResult {
  url: string;
  handoffId: string;
  expiresAt: string | null;
}

export async function createBillingHandoff(args: HandoffArgs): Promise<HandoffResult> {
  const payload: Record<string, unknown> = {
    tenant_ref: AGENCY_TENANT_REF,
    display_name: AGENCY_DISPLAY_NAME,
    origin_user_id: args.originUserId,
    origin_username: args.originUsername ?? undefined,
    intent: args.intent,
    return_url: args.returnUrl,
  };

  let res = await mcFetch("/api/public/billing/handoff", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  // A misconfigured clone deploy_url must not kill attribution: retry once
  // without the return link if Mission Control rejects it.
  if (res.status === 400 && args.returnUrl) {
    const text = await res.clone().text().catch(() => "");
    if (text.includes("return_url")) {
      delete payload.return_url;
      res = await mcFetch("/api/public/billing/handoff", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  }

  const body = await parseOrThrow(res);
  return {
    url: body.url,
    handoffId: body.handoff_id,
    expiresAt: body.expires_at ?? null,
  };
}

// ── Purchase history read-back (user-attributed pricing workflow) ──────────

export interface PurchaseRecord {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: string;
  mode: string;
  itemSlug: string | null;
  quantity: number;
  amountCents: number | null;
  currency: string | null;
  originUserId: string | null;
  originUsername: string | null;
  originSource: string;
}

export interface PurchaseHistoryResult {
  purchases: PurchaseRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export async function listPurchases(
  opts: { limit?: number; offset?: number; status?: string } = {},
): Promise<PurchaseHistoryResult> {
  const q = new URLSearchParams({ tenant_ref: AGENCY_TENANT_REF });
  if (opts.limit) q.set("limit", String(Math.min(opts.limit, 100)));
  if (opts.offset) q.set("offset", String(opts.offset));
  if (opts.status) q.set("status", opts.status);
  const res = await mcFetch(`/api/public/purchases?${q.toString()}`, { method: "GET" });
  const body = await parseOrThrow(res);
  const pagination = body?.pagination ?? {};
  return {
    purchases: Array.isArray(body?.purchases)
      ? body.purchases.map((p: any) => ({
          id: p.id,
          createdAt: p.created_at,
          completedAt: p.completed_at ?? null,
          status: String(p.status ?? "completed"),
          mode: String(p.mode ?? ""),
          itemSlug: p.item_slug ?? null,
          quantity: Number(p.quantity ?? 1),
          amountCents: p.amount_cents ?? null,
          currency: p.currency ?? null,
          originUserId: p.origin_user_id ?? null,
          originUsername: p.origin_username ?? null,
          originSource: String(p.origin_source ?? ""),
        }))
      : [],
    pagination: {
      limit: Number(pagination.limit ?? 25),
      offset: Number(pagination.offset ?? 0),
      total: Number(pagination.total ?? 0),
      hasMore: Boolean(pagination.has_more),
      nextOffset: pagination.next_offset ?? null,
    },
  };
}

/**
 * Convenience wrapper: reserve → run → commit/cancel.
 * `run` receives the reservation and must return { actualTokens, result }.
 */
export async function withTokenReservation<T>(
  args: ReserveArgs,
  run: (reservation: ReserveResult) => Promise<{ actualTokens: number; result: T; resultMeta?: Record<string, unknown> }>,
): Promise<T> {
  const reservation = await reserveTokens(args);
  try {
    const { actualTokens, result, resultMeta } = await run(reservation);
    await commitTokens(reservation.jobId, actualTokens, resultMeta);
    return result;
  } catch (err) {
    await cancelTokens(reservation.jobId, err instanceof Error ? err.message : "error");
    throw err;
  }
}
