/**
 * Staff (Internal Dashboard) → Client Portal Handoff: CREATE
 *
 * Staff-authenticated. Mints a one-time, short-lived handoff token so an
 * internal staff member can open the client portal as the client (full access
 * or read-only) directly from the Client Management page.
 *
 * The token is redeemed at /client/handoff?token=...
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return jsonResponse({ error: auth.error || 'Authentication required' }, 401);
    }

    const { client_id, readonly = false } = body ?? {};
    if (!client_id || typeof client_id !== 'string') {
      return jsonResponse({ error: 'client_id required' }, 400);
    }

    // Find an active client portal user for this client
    const { data: targetPortalUser } = await supabase
      .from('client_portal_users')
      .select('id, email, status')
      .eq('client_id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!targetPortalUser) {
      return jsonResponse({
        error: 'This client has no active portal account yet. Send them a Portal Access invite first.',
      }, 404);
    }

    const token = crypto.randomUUID() + '.' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const userAgent = req.headers.get('user-agent') || null;

    const { error: insErr } = await supabase
      .from('finance_portal_handoff_tokens')
      .insert({
        token,
        finance_user_id: null,
        finance_contact_id: null,
        staff_user_id: auth.userId,
        client_id,
        target_portal_user_id: targetPortalUser.id,
        is_readonly: !!readonly,
        expires_at: expiresAt.toISOString(),
        ip_address: ip,
        user_agent: userAgent,
      });

    if (insErr) throw insErr;

    // Audit on the client side
    await supabase.from('client_activity_log').insert({
      client_id,
      actor_user_id: auth.userId,
      actor_type: 'staff',
      action: 'staff_portal_handoff_created',
      entity_type: 'client_portal',
      metadata: {
        readonly: !!readonly,
        target_portal_user_id: targetPortalUser.id,
      },
    }).catch(() => { /* table optional; ignore failures */ });

    return jsonResponse({
      success: true,
      token,
      expires_at: expiresAt.toISOString(),
      target_email: targetPortalUser.email,
      target_portal_user_id: targetPortalUser.id,
      readonly: !!readonly,
    });
  } catch (err: any) {
    console.error('[staff-client-portal-handoff-create] Error:', err);
    return jsonResponse({ error: err?.message || 'Internal error' }, 500);
  }
});
