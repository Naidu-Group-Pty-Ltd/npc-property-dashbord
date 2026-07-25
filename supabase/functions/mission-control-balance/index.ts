// Mission Control balance proxy.
// Frontend reads token balance via this function so the API key never leaves the server.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getBalance, MissionControlError } from "../_shared/missionControl.ts";

Deno.serve(async (req) => {
  // Credentialed CORS: the app invokes this function with
  // credentials:'include' (HttpOnly session cookie), and browsers reject a
  // wildcard Access-Control-Allow-Origin at preflight for credentialed
  // requests — the POST never leaves the browser and the UI surfaces it as
  // "Failed to load". createCorsHeaders echoes the exact allow-listed origin
  // and sets Access-Control-Allow-Credentials.
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* GET / empty */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error ?? "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const balance = await getBalance();
    // Surface both detailed MC fields and the legacy frontend shape (available/allowance/used/reserved).
    return new Response(JSON.stringify(balance), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    const isMc = e instanceof MissionControlError;
    const status = isMc ? e.status : 500;
    const payload = isMc
      ? { error: e.code, message: e.message }
      : { error: "internal_error", message: e instanceof Error ? e.message : String(e) };
    console.error("[mission-control-balance] error", payload);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
