// Mission Control billing handoff proxy (user-attributed pricing workflow).
// Verifies the signed-in command-center user, then asks Mission Control to
// mint a single-use attributed deep link into the Aurixa Systems storefront
// pricing page — the user's identity travels server-to-server under the clone
// API key; the browser only ever receives the opaque handoff URL.
//
// Contract with the frontend: ALWAYS returns 200 with `{ url: string | null }`
// (plus handoffId/expiresAt on success). A null url tells the caller to fall
// back to the static storefront pricing URL (AURIXA_PRICING_URL) — a purchase
// CTA must never hard-fail because attribution was unavailable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { createBillingHandoff } from "../_shared/missionControl.ts";

// "save_card" is the wallet flow: the storefront auto-launches a Stripe
// setup-mode Checkout instead of a purchase (billing & usage page).
const MODES = new Set(["topup", "seat_plan", "setup_package", "save_card"]);

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
    try { body = await req.json(); } catch { /* allow empty */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error ?? "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    // intent: a purchase mode ('topup' | 'seat_plan' | 'setup_package'),
    // optionally narrowed to one item; anything else ('pricing', 'catalog')
    // means "browse the whole catalog" and sends no restriction.
    const rawIntent = typeof body?.intent === "string" ? body.intent : "";
    const itemId = typeof body?.itemId === "string" ? body.itemId.slice(0, 100) : "";
    const intent = MODES.has(rawIntent)
      ? itemId
        ? `${rawIntent}:${itemId}`
        : rawIntent
      : undefined;

    // Return link back into this app; Mission Control validates the host
    // against this clone's registered deploy_url.
    const originHeader = req.headers.get("origin") ?? "";
    const returnPath = typeof body?.returnPath === "string" && body.returnPath.startsWith("/")
      ? body.returnPath
      : "/";
    const returnUrl = originHeader.startsWith("https://")
      ? `${originHeader}${returnPath}`
      : undefined;

    try {
      const handoff = await createBillingHandoff({
        originUserId: auth.userId,
        originUsername: auth.username ?? null,
        intent,
        returnUrl,
      });
      return new Response(
        JSON.stringify({
          url: handoff.url,
          handoffId: handoff.handoffId,
          expiresAt: handoff.expiresAt,
        }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    } catch (e) {
      // Attribution is best-effort — degrade to the static URL client-side.
      console.error("[mission-control-handoff] mint failed", e);
      return new Response(JSON.stringify({ url: null }), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
  } catch (e) {
    console.error("[mission-control-handoff] error", e);
    return new Response(
      JSON.stringify({ url: null, error: e instanceof Error ? e.message : String(e) }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }
});
