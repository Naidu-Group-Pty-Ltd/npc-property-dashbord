// Report metering middleware.
// Wraps an edge function handler with Mission Control reserve → run → commit/cancel.
// Adds tokensUsed/tokensReserved/estimatedTokens/durationMs to JSON responses
// and matching x-* headers. Logs every reserve/commit/cancel event to
// token_audit_log and a final outcome row to token_usage_history.

import {
  reserveTokens,
  commitTokens,
  cancelTokens,
  InsufficientTokensError,
  MissionControlError,
  AGENCY_TENANT_REF,
  type ReserveResult,
  type TokenKind,
} from "./missionControl.ts";
import { estimateTokens, fallbackActual, type EstimateOptions } from "./tokenEstimator.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "./auth.ts";

function adminClient() {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function resolveUserId(req: Request, body: any): Promise<string | null> {
  try {
    const client = adminClient();
    if (!client) return null;
    const { userId } = await verifyAuth(client, req.headers, body);
    if (userId === "service_role") return body?.userId || body?.created_by || body?.user_id || null;
    return userId || null;
  } catch (e) {
    console.warn("[reportMetering] resolveUserId failed", e);
    return null;
  }
}

export interface MeteringPlan {
  kind: TokenKind;
  userId: string;
  idempotencyKey: string;
  estimateOptions?: EstimateOptions;
  requestPayload?: Record<string, unknown>;
  estimatedTokensOverride?: number;
  functionName?: string;
}

export type PlanResolver = (
  body: any,
  req: Request,
) => Promise<MeteringPlan | null> | MeteringPlan | null;

const baseCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-portal-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
};

function corsFor(req: Request) {
  const origin = req.headers.get("origin");
  return origin ? { ...baseCors, "Access-Control-Allow-Origin": origin } : baseCors;
}

function rebuildRequest(req: Request, body: any): Request {
  if (body === undefined) return req;
  const headers = new Headers(req.headers);
  return new Request(req.url, { method: req.method, headers, body: JSON.stringify(body) });
}

async function logAudit(row: Record<string, unknown>) {
  try {
    const client = adminClient();
    if (!client) return;
    await client.from("token_audit_log").insert(row);
  } catch (e) {
    console.warn("[reportMetering] audit log failed", e);
  }
}

async function logUsage(row: Record<string, unknown>) {
  try {
    const client = adminClient();
    if (!client) return;
    await client.from("token_usage_history").insert(row);
  } catch (e) {
    console.warn("[reportMetering] usage log failed", e);
  }
}

export function withReportMetering(
  resolvePlan: PlanResolver,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return handler(req);

    let body: any = undefined;
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : undefined;
    } catch { body = undefined; }
    const forwardReq = rebuildRequest(req, body);
    const cors = corsFor(req);

    let plan: MeteringPlan | null = null;
    try { plan = await resolvePlan(body, req); }
    catch (e) {
      console.warn("[reportMetering] plan resolver threw, bypassing metering", e);
      plan = null;
    }

    console.log("[reportMetering] plan resolved", {
      hasPlan: !!plan,
      hasUserId: !!plan?.userId,
      hasIdempotencyKey: !!plan?.idempotencyKey,
      kind: plan?.kind,
    });

    if (!plan || !plan.userId || !plan.idempotencyKey) {
      console.warn("[reportMetering] bypassing metering — plan/userId/idempotencyKey missing", {
        hasBody: body !== undefined,
        hasPlan: !!plan,
        userId: plan?.userId ?? null,
        idempotencyKey: plan?.idempotencyKey ?? null,
      });
      return handler(forwardReq);
    }

    const functionName = plan.functionName || (() => {
      try { return new URL(req.url).pathname.split("/").filter(Boolean).pop() || "unknown"; }
      catch { return "unknown"; }
    })();

    // Catalog override: if the caller forwarded a `__catalog.report_slug`, look
    // up the canonical credit_cost in Mission Control's pricing catalog. The
    // token balance is already denominated in billing credits, so a report's
    // credit_cost maps 1:1 to reserved balance. MC_TOKENS_PER_CREDIT stays a
    // knob (default 1) in case the balance is ever re-scaled to raw tokens —
    // it must NOT re-inflate credits back into thousands of LLM tokens.
    let catalogTokens: number | null = null;
    const catalogHint = body?.__catalog;
    if (catalogHint?.report_slug) {
      try {
        const { getReportCreditCost } = await import("./missionControlCatalog.ts");
        const credits =
          (typeof catalogHint?.credit_cost === "number" && catalogHint.credit_cost > 0)
            ? catalogHint.credit_cost
            : await getReportCreditCost(String(catalogHint.report_slug));
        if (credits && credits > 0) {
          const perCredit = Number(Deno.env.get("MC_TOKENS_PER_CREDIT") ?? "1");
          catalogTokens = Math.max(1, Math.ceil(credits * (isFinite(perCredit) ? perCredit : 1)));
        }
      } catch (e) {
        console.warn("[reportMetering] catalog lookup failed", e);
      }
    }

    const estimated =
      catalogTokens ??
      (plan.estimatedTokensOverride && plan.estimatedTokensOverride > 0
        ? plan.estimatedTokensOverride
        : estimateTokens(plan.kind, plan.estimateOptions));

    const startedAt = Date.now();
    let reservation: ReserveResult | null = null;
    // Operator-assigned tracking id for this tenant/clone, echoed by Mission
    // Control on reserve. Stamped onto usage/audit rows so token usage joins
    // Stripe payments (which carry the same billing_user_id) on one key.
    let billingUserId: string | null = null;
    try {
      reservation = await reserveTokens({
        kind: plan.kind,
        estimatedTokens: estimated,
        idempotencyKey: plan.idempotencyKey,
        userId: plan.userId,
        requestPayload: plan.requestPayload,
      });
      billingUserId = reservation.billingUserId ?? null;
      await logAudit({
        event: "reserve",
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        job_id: reservation.jobId,
        requested_tokens: estimated,
        reserved_tokens: reservation.reserved,
        available_tokens: reservation.available,
        status: "ok",
        request_payload: plan.requestPayload ?? null,
      });
    } catch (e) {
      if (e instanceof InsufficientTokensError) {
        await logAudit({
          event: "reserve",
          user_id: plan.userId,
          agency_ref: AGENCY_TENANT_REF,
          function_name: functionName,
          kind: plan.kind,
          idempotency_key: plan.idempotencyKey,
          requested_tokens: estimated,
          available_tokens: e.available,
          status: "insufficient_funds",
          error_message: e.message,
          request_payload: plan.requestPayload ?? null,
        });
        await logUsage({
          user_id: plan.userId,
          agency_ref: AGENCY_TENANT_REF,
          function_name: functionName,
          kind: plan.kind,
          idempotency_key: plan.idempotencyKey,
          estimated_tokens: estimated,
          status: "insufficient_funds",
          error_message: e.message,
          duration_ms: Date.now() - startedAt,
          request_payload: plan.requestPayload ?? null,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "insufficient_funds",
              message: e.message,
              available: e.available,
              requested: e.requested,
            },
          }),
          { status: 402, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      if (e instanceof MissionControlError && e.code === "unconfigured") {
        // Metering is intentionally OFF in environments where Mission Control
        // is not set up at all — bypass is by design, not a dependency failure.
        console.warn("[reportMetering] Mission Control unconfigured — bypassing");
        return handler(forwardReq);
      }
      // FAIL CLOSED (Phase 9): Mission Control IS configured but the reserve
      // errored (transient / network / 5xx). Previously we ran the paid handler
      // for free, so an attacker could exhaust paid credits by forcing MC
      // errors. Refuse the request instead; the caller can retry.
      const msg = e instanceof Error ? e.message : "metering_unavailable";
      console.error("[reportMetering] reserve failed — failing closed", e);
      await logAudit({
        event: "reserve",
        user_id: plan.userId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        requested_tokens: estimated,
        status: "error",
        error_message: msg,
        request_payload: plan.requestPayload ?? null,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "metering_unavailable",
            message: "Usage metering is temporarily unavailable. Please retry shortly.",
          },
        }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    let response: Response;
    try {
      response = await handler(forwardReq);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "handler_threw";
      await cancelTokens(reservation!.jobId, msg);
      await logAudit({
        event: "cancel",
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        job_id: reservation!.jobId,
        reserved_tokens: reservation!.reserved,
        status: "error",
        reason: msg,
        error_message: msg,
      });
      await logUsage({
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        estimated_tokens: estimated,
        reserved_tokens: reservation!.reserved,
        status: "failed",
        error_message: msg,
        duration_ms: Date.now() - startedAt,
        job_id: reservation!.jobId,
      });
      throw err;
    }

    const durationMs = Date.now() - startedAt;
    const ok = response.ok;
    const headerUsedRaw = response.headers.get("x-mc-tokens-used");
    const headerUsed = headerUsedRaw ? Number(headerUsedRaw) : 0;
    const actual = headerUsed > 0 ? Math.ceil(headerUsed) : fallbackActual(estimated, ok);

    if (!ok) {
      await cancelTokens(reservation!.jobId, `handler_status_${response.status}`);
      await logAudit({
        event: "cancel",
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        job_id: reservation!.jobId,
        reserved_tokens: reservation!.reserved,
        status: "error",
        reason: `status_${response.status}`,
      });
      await logUsage({
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        estimated_tokens: estimated,
        reserved_tokens: reservation!.reserved,
        status: "failed",
        error_message: `handler_status_${response.status}`,
        duration_ms: durationMs,
        job_id: reservation!.jobId,
      });
      return response;
    }

    try {
      await commitTokens(reservation!.jobId, actual);
      await logAudit({
        event: "commit",
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        job_id: reservation!.jobId,
        reserved_tokens: reservation!.reserved,
        used_tokens: actual,
        status: "ok",
      });
    } catch (e) {
      console.error("[reportMetering] commit failed", e);
    }

    await logUsage({
      user_id: plan.userId,
      billing_user_id: billingUserId,
      agency_ref: AGENCY_TENANT_REF,
      function_name: functionName,
      kind: plan.kind,
      idempotency_key: plan.idempotencyKey,
      estimated_tokens: estimated,
      reserved_tokens: reservation!.reserved,
      actual_tokens: actual,
      duration_ms: durationMs,
      status: "success",
      job_id: reservation!.jobId,
      request_payload: plan.requestPayload ?? null,
    });

    const usageMeta = {
      tokensUsed: actual,
      tokensReserved: reservation!.reserved,
      estimatedTokens: estimated,
      durationMs,
    };

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const json = await response.clone().json();
        const merged =
          json && typeof json === "object" && !Array.isArray(json)
            ? { ...json, ...usageMeta }
            : { data: json, ...usageMeta };
        const headers = new Headers(response.headers);
        headers.set("x-tokens-used", String(actual));
        headers.set("x-tokens-reserved", String(reservation!.reserved));
        headers.set("x-tokens-estimated", String(estimated));
        headers.set("x-duration-ms", String(durationMs));
        return new Response(JSON.stringify(merged), { status: response.status, headers });
      } catch { /* fall through */ }
    }

    const headers = new Headers(response.headers);
    headers.set("x-tokens-used", String(actual));
    headers.set("x-tokens-reserved", String(reservation!.reserved));
    headers.set("x-tokens-estimated", String(estimated));
    headers.set("x-duration-ms", String(durationMs));
    return new Response(response.body, { status: response.status, headers });
  };
}

export function buildIdempotencyKey(
  prefix: string,
  parts: Array<string | number | null | undefined>,
): string {
  const safe = parts.map((p) => String(p ?? "").trim().toLowerCase()).join("|");
  return `${prefix}:${safe}`;
}
