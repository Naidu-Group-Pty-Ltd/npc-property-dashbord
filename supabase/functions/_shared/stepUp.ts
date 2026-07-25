/**
 * WP-11C — Generic step-up (recent-reauth) enforcement.
 *
 * Verifies that the caller holds a live, unrevoked, unexpired step-up session
 * for the requested capability. Tokens are minted by `security-step-up` and
 * stored hashed in `public.step_up_sessions` (SHA-256 with server pepper).
 * Each proof is additionally bound to the active Command Centre staff session
 * that issued it, so a stolen proof cannot be replayed from another session.
 *
 * The enforcement can be dark-launched via env `STEP_UP_ENFORCED`:
 *   - "true"           → enforce for all capabilities
 *   - "false"/"off"    → soft-audit only (never blocks; emergency rollback)
 *   - comma list       → enforce only for listed capabilities
 *     e.g. "role.change,secrets.update"
 *
 * Callers use:
 *   const gate = await requireStepUp(supabase, { userId, capability, req, body });
 *   if (gate) return gate; // 401 response
 */

import { hashSessionToken, isSessionHashConfigured } from "./sessionHash.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type StepUpCapability =
  | "role.change"
  | "role.remove"
  | "aml.role.set"
  | "secrets.update"
  | "commission.payout.generate"
  | "commission.payout.mark_paid"
  | "commission.payout.cancel"
  | "docusign.send"
  | "docusign.void"
  | "storage.destructive"
  | "mailbox.destructive";

const ONE_TIME_CAPABILITIES = new Set<StepUpCapability>([
  "commission.payout.generate", "commission.payout.mark_paid", "commission.payout.cancel",
  "docusign.send", "docusign.void", "secrets.update", "role.change", "role.remove",
]);

type StaffSession = { id: string };

/**
 * Resolve the current Command Centre session without trusting a browser-supplied
 * session ID. This deliberately accepts the same session-token locations as
 * `verifyAuth`, but always verifies the token against the authoritative row.
 */
function extractStaffSessionToken(req?: Request, body?: any): string | null {
  const cookie = req?.headers.get("cookie") ?? "";
  // WP-11B/C cookie-only: the staff session lives in the host-prefixed
  // `__Host-session_token` cookie. Match it first (the legacy `session_token`
  // cookie name is kept as a transitional fallback).
  const hostCookie = cookie.match(/(?:^|;\s*)__Host-session_token=([^;]+)/);
  if (hostCookie?.[1]) return hostCookie[1];
  const cookieMatch = cookie.match(/(?:^|;\s*)session_token=([^;]+)/);
  if (cookieMatch?.[1]) return cookieMatch[1];

  const commandCentre = req?.headers.get("x-command-centre-session-token");
  if (commandCentre?.trim()) return commandCentre.trim();
  const session = req?.headers.get("x-session-token");
  if (session?.trim()) return session.trim();

  const bodyToken = body?.command_centre_session_token ?? body?.session_token;
  return typeof bodyToken === "string" && bodyToken.trim() ? bodyToken.trim() : null;
}

export async function resolveActiveStaffSession(
  admin: any,
  userId: string,
  req?: Request,
  body?: any,
): Promise<StaffSession | null> {
  const token = extractStaffSessionToken(req, body);
  if (!token) return null;

  const now = new Date().toISOString();
  const select = "id, expires_at, idle_expires_at, revoked_at";
  const base = () => admin.from("user_sessions")
    .select(select)
    .eq("user_id", userId)
    .eq("portal_scope", "staff")
    .is("revoked_at", null)
    .gt("expires_at", now);

  // Keep this lookup aligned with the dual-read session migration. A legacy
  // plaintext row can be used only while the session itself remains valid.
  const hash = isSessionHashConfigured() ? await hashSessionToken(token) : null;
  let data: any = null;
  if (hash) {
    const result = await base().eq("token_hash", hash).maybeSingle();
    data = result.data;
  }
  if (!data) {
    const result = await base().eq("session_token", token).maybeSingle();
    data = result.data;
  }
  if (!data) return null;
  if (data.idle_expires_at && new Date(data.idle_expires_at).getTime() <= Date.now()) return null;
  return { id: data.id };
}

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashStepUpToken(userId: string, capability: string, token: string) {
  const pepper = (globalThis as any).Deno?.env?.get?.("STEP_UP_TOKEN_PEPPER") ?? "";
  return sha256Hex(`${pepper}:${userId}:${capability}:${token}`);
}

function enforcementModeFor(capability: string): "enforce" | "audit" {
  const raw = ((globalThis as any).Deno?.env?.get?.("STEP_UP_ENFORCED") ?? "").trim().toLowerCase();
  // High-risk capabilities are fail-closed by default. Audit-only mode now
  // requires an explicit emergency configuration rather than being the silent
  // production default.
  if (raw === "false" || raw === "off" || raw === "0") return "audit";
  if (!raw) return "enforce";
  if (raw === "true" || raw === "on" || raw === "1" || raw === "*") return "enforce";
  const list = raw.split(",").map((s: string) => s.trim()).filter(Boolean);
  return list.includes(capability.toLowerCase()) ? "enforce" : "audit";
}

function extractStepUpToken(req?: Request, body?: any): string | null {
  const hdr = req?.headers.get("x-step-up-token");
  if (hdr && hdr.length >= 16) return hdr.trim();
  const bodyTok = body?.step_up_token ?? body?.step_up_session_token;
  if (typeof bodyTok === "string" && bodyTok.length >= 16) return bodyTok.trim();
  return null;
}

export interface RequireStepUpArgs {
  userId: string;
  capability: StepUpCapability | string;
  req?: Request;
  body?: any;
  /** When true, always audit-log even if not enforced. */
  logAudit?: boolean;
}

/**
 * Returns a Response (401) when step-up is required and missing/expired;
 * returns null when the caller is authorised (or when running in audit mode).
 */
export async function requireStepUp(
  admin: any,
  args: RequireStepUpArgs,
): Promise<Response | null> {
  const mode = enforcementModeFor(args.capability);
  const token = extractStepUpToken(args.req, args.body);
  const now = Date.now();

  let valid = false;
  let reason: "missing" | "invalid" | "expired" | "session_required" | "session_mismatch" | "insufficient_assurance" | "ok" = "missing";

  if (token) {
    const staffSession = await resolveActiveStaffSession(admin, args.userId, args.req, args.body);
    if (!staffSession) {
      reason = "session_required";
    } else {
      const hash = await hashStepUpToken(args.userId, args.capability, token);
      const { data } = await admin
        .from("step_up_sessions")
        .select("id, bound_session_id, expires_at, revoked_at, consumed_at, assurance_level")
        .eq("user_id", args.userId)
        .eq("capability", args.capability)
        .eq("token_hash", hash)
        .maybeSingle();
      if (!data) reason = "invalid";
      else if (data.bound_session_id !== staffSession.id) reason = "session_mismatch";
      else if (data.revoked_at || data.consumed_at || new Date(data.expires_at).getTime() <= now) reason = "expired";
      else if (mode === "enforce" && Number(data.assurance_level) < 2) reason = "insufficient_assurance";
      else {
        reason = "ok";
        valid = true;
        if (mode === "enforce" && ONE_TIME_CAPABILITIES.has(args.capability as StepUpCapability)) {
          const { data: consumed } = await admin.from("step_up_sessions")
            .update({ consumed_at: new Date().toISOString() })
            .eq("id", data.id).is("consumed_at", null).select("id").maybeSingle();
          if (!consumed) { valid = false; reason = "expired"; }
        }
      }
    }
  }

  if (mode === "audit" || valid) {
    if (args.logAudit && !valid) {
      try {
        await admin.from("security_events").insert({ action: "step_up.audit", decision: "allow", actor_type: "human", actor_id: args.userId, reason_code: reason, metadata_redacted: { capability: args.capability, enforced: false } });
      } catch { /* best-effort */ }
    }
    return null;
  }

  // Enforced + not valid → block
  try {
    await admin.from("security_events").insert({ action: "step_up.blocked", decision: "deny", actor_type: "human", actor_id: args.userId, reason_code: reason, metadata_redacted: { capability: args.capability, enforced: true } });
  } catch { /* best-effort */ }

  return new Response(
    JSON.stringify({
      success: false,
      error: "Recent reauthentication required",
      code: "step_up_required",
      capability: args.capability,
      reason,
    }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

/** Utility for issuers: generate a URL-safe token. */
export function generateStepUpToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
