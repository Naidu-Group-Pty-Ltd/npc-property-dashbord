/**
 * Phase 13 — Shared step-up enforcement.
 *
 * Verifies that the caller holds a live short-lived step-up session for the
 * requested capability. Session tokens are issued by `aml-step-up` and stored
 * hashed in `aml.step_up_sessions`.
 *
 * Returns null when the caller is authorised (or bypass=true). Returns a Response
 * error when the token is missing, mismatched, revoked, or expired.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export interface RequireStepUpArgs {
  admin: any;
  userId: string;
  capability: "aml.report" | "aml.configure" | "aml.investigate" | "aml.view";
  token?: string | null;
  headers?: Headers;
}

export async function requireStepUpSession(args: RequireStepUpArgs): Promise<Response | null> {
  const token = (args.token ?? args.headers?.get("x-aml-step-up-token") ?? "").toString().trim();
  if (!token) {
    return new Response(JSON.stringify({
      error: "Step-up required",
      code: "step_up_required",
      capability: args.capability,
    }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const hash = await sha256Hex(`${args.userId}:${args.capability}:${token}`);
  const { data, error } = await args.admin.schema("aml").from("step_up_sessions")
    .select("id, expires_at, revoked_at")
    .eq("user_id", args.userId).eq("capability", args.capability).eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) {
    return new Response(JSON.stringify({
      error: "Invalid step-up session",
      code: "step_up_invalid",
      capability: args.capability,
    }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const live = !data.revoked_at && new Date(data.expires_at).getTime() > Date.now();
  if (!live) {
    return new Response(JSON.stringify({
      error: "Step-up session expired",
      code: "step_up_expired",
      capability: args.capability,
    }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return null;
}
