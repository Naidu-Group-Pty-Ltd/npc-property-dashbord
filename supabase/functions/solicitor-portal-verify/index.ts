import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders } from "../_shared/auth.ts"
import { csrfDenied, enforceCsrf } from "../_shared/csrfGuard.ts"
import { resolveSolicitorSession } from "../_shared/solicitorPortalAuth.ts"
import { extractSolicitorSessionToken } from "../_shared/solicitorSessionToken.ts"

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const action = typeof body?.action === 'string' ? body.action : null;

    // Every successful verification updates last_seen_at, so cookie-authenticated
    // requests require CSRF protection even when no explicit action is supplied.
    const csrf = enforceCsrf(req);
    if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

    if (!extractSolicitorSessionToken(req.headers, body)) {
      return new Response(
        JSON.stringify({ error: 'Session token is required', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (!session.ok || !session.user) {
      return new Response(
        JSON.stringify({ error: session.error, valid: false }),
        { status: session.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'accept_terms') {
      await supabase
        .from('solicitor_portal_users')
        .update({ has_accepted_terms: true, terms_accepted_at: new Date().toISOString() })
        .eq('id', session.user.id)
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'complete_onboarding') {
      await supabase
        .from('solicitor_portal_users')
        .update({ has_completed_onboarding: true })
        .eq('id', session.user.id)
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Track presence for the "what's changed since your last visit" surface.
    const previousSeenAt = session.user.last_seen_at;
    await supabase
      .from('solicitor_portal_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.user.id)

    return new Response(
      JSON.stringify({
        valid: true,
        user: {
          id: session.user.id,
          firm_id: session.user.firm_id,
          email: session.user.email,
          name: session.user.name,
          phone: session.user.phone,
          position: session.user.position,
          portal_role: session.user.portal_role,
          firm_name: session.user.firm?.trading_name || session.user.firm?.name || null,
          practising_states: session.user.firm?.practising_states || [],
          has_accepted_terms: session.user.has_accepted_terms,
          has_completed_onboarding: session.user.has_completed_onboarding,
          must_change_password: session.user.must_change_password,
        },
        previous_seen_at: previousSeenAt,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Solicitor portal verify error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', valid: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
