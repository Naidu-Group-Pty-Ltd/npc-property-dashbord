/**
 * Phase 13 — AML Step-Up Authentication.
 *
 * Server-issued short-lived challenge/response for privileged AML capabilities
 * (aml.report, aml.configure). Replaces the Phase 2 "type CONFIRM" placeholder.
 *
 * POST { op, ...args }
 *   op: 'issue'   { capability } -> { challenge_id, expires_at, delivery } (code delivered out-of-band)
 *   op: 'verify'  { challenge_id, code } -> { session_token, capability, expires_at }
 *   op: 'check'   { capability, session_token } -> { valid: boolean, expires_at }
 *   op: 'revoke'  { session_id } -> { ok }
 *   op: 'list'    -> { sessions: [...], recent_challenges: [...] }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
import { getBrandConfig } from "../_shared/brand-config.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token, x-command-centre-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STEP_UP_CAPABILITIES = new Set(["aml.report", "aml.configure", "aml.investigate", "aml.view"]);
const CODE_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 15 * 60;

async function sha256(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function genNumericCode(digits = 6) {
  const buf = new Uint32Array(1); crypto.getRandomValues(buf);
  return (buf[0] % 10 ** digits).toString().padStart(digits, "0");
}
function genToken(bytes = 32) {
  const b = new Uint8Array(bytes); crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

async function deliverCode(admin: any, recipient: string, code: string, capability: string) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return { ok: false, error: "Step-up email delivery is not configured" };
  const brand = await getBrandConfig(admin);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: brand.fromHeaderAdmin,
      to: [recipient],
      subject: `${brand.companyName} AML verification code`,
      html: `<p>Your verification code for <strong>${capability}</strong> is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 5 minutes. If you did not request it, contact your administrator.</p>`,
    }),
  });
  if (!response.ok) {
    console.error("[aml-step-up] Resend delivery failed", response.status);
    return { ok: false, error: "Could not deliver the step-up code" };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const aml = admin.schema("aml" as any);

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;

    // Confirm user has some AML role at all.
    const { data: hasRole } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasRole) return jr({ error: "No AML role" }, 403);

    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? null;
    const ua = req.headers.get("user-agent") ?? null;

    const op = body?.op as string;

    switch (op) {
      case "issue": {
        const capability = String(body.capability ?? "");
        if (!STEP_UP_CAPABILITIES.has(capability)) return jr({ error: "Unknown capability" }, 400);
        const { data: user, error: userError } = await admin.from("custom_users")
          .select("email, username").eq("id", userId).maybeSingle();
        const recipient = String(user?.email ?? user?.username ?? "").trim();
        if (userError || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
          return jr({ error: "A verified staff email is required for step-up authentication" }, 409);
        }
        const code = genNumericCode(6);
        const codeHash = await sha256(`${userId}:${capability}:${code}`);
        const expires_at = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
        const { data, error } = await aml.from("step_up_challenges").insert({
          user_id: userId, capability, code_hash: codeHash, expires_at, ip, user_agent: ua,
        }).select("id, expires_at").single();
        if (error) return jr({ error: error.message }, 500);
        const delivery = await deliverCode(admin, recipient, code, capability);
        if (!delivery.ok) {
          await aml.from("step_up_challenges").delete().eq("id", data.id);
          return jr({ error: delivery.error }, 503);
        }
        return jr({
          challenge_id: data.id,
          expires_at: data.expires_at,
          delivery: "email",
          destination_hint: maskEmail(recipient),
        });
      }

      case "verify": {
        const challenge_id = String(body.challenge_id ?? "");
        const code = String(body.code ?? "");
        if (!challenge_id || !code) return jr({ error: "Missing challenge_id or code" }, 400);
        const { data: ch, error } = await aml.from("step_up_challenges").select("*").eq("id", challenge_id).maybeSingle();
        if (error || !ch) return jr({ error: "Challenge not found" }, 404);
        if (ch.user_id !== userId) return jr({ error: "Challenge does not belong to caller" }, 403);
        if (ch.verified_at) return jr({ error: "Challenge already used" }, 409);
        if (new Date(ch.expires_at).getTime() < Date.now()) return jr({ error: "Challenge expired" }, 410);
        if (ch.attempts >= ch.max_attempts) return jr({ error: "Too many attempts" }, 429);
        const expectedHash = await sha256(`${userId}:${ch.capability}:${code}`);
        if (expectedHash !== ch.code_hash) {
          await aml.from("step_up_challenges").update({ attempts: ch.attempts + 1 }).eq("id", challenge_id);
          return jr({ error: "Incorrect code" }, 401);
        }
        const token = genToken(32);
        const tokenHash = await sha256(`${userId}:${ch.capability}:${token}`);
        const expires_at = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
        const { data: sess, error: sErr } = await aml.from("step_up_sessions").insert({
          user_id: userId, capability: ch.capability, token_hash: tokenHash, expires_at, ip, user_agent: ua,
        }).select("id, expires_at").single();
        if (sErr) return jr({ error: sErr.message }, 500);
        await aml.from("step_up_challenges").update({ verified_at: new Date().toISOString() }).eq("id", challenge_id);
        return jr({ session_id: sess.id, session_token: token, capability: ch.capability, expires_at: sess.expires_at });
      }

      case "check": {
        const capability = String(body.capability ?? "");
        const session_token = String(body.session_token ?? "");
        if (!capability || !session_token) return jr({ valid: false });
        const tokenHash = await sha256(`${userId}:${capability}:${session_token}`);
        const { data, error } = await aml.from("step_up_sessions")
          .select("id, expires_at, revoked_at")
          .eq("user_id", userId).eq("capability", capability).eq("token_hash", tokenHash)
          .maybeSingle();
        if (error || !data) return jr({ valid: false });
        const live = !data.revoked_at && new Date(data.expires_at).getTime() > Date.now();
        return jr({ valid: live, expires_at: data.expires_at });
      }

      case "revoke": {
        const session_id = String(body.session_id ?? "");
        if (!session_id) return jr({ error: "Missing session_id" }, 400);
        const { error } = await aml.from("step_up_sessions").update({
          revoked_at: new Date().toISOString(), revoke_reason: body.reason ?? "manual_revoke",
        }).eq("id", session_id).eq("user_id", userId);
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true });
      }

      case "list": {
        const [{ data: sessions }, { data: challenges }] = await Promise.all([
          aml.from("step_up_sessions").select("id, capability, expires_at, revoked_at, created_at, ip, user_agent")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
          aml.from("step_up_challenges").select("id, capability, expires_at, verified_at, attempts, created_at")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
        ]);
        return jr({ sessions: sessions ?? [], recent_challenges: challenges ?? [], user_label: userLabel });
      }

      default:
        return jr({ error: "Unknown op" }, 400);
    }
  } catch (e) {
    return jr({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
