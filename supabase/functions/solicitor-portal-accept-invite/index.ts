import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders, createSolicitorSessionCookie } from "../_shared/auth.ts"

const SESSION_HOURS = 12;

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

    const { action, token, password } = await req.json()
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Invite token is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: portalUser, error: lookupError } = await supabase
      .from('solicitor_portal_users')
      .select(`
        id, firm_id, email, name, position, portal_role, is_active, revoked_at,
        invite_token, invite_token_expires_at, invite_accepted_at, password_hash,
        solicitor_firms:firm_id (id, name, trading_name, practising_states, is_active)
      `)
      .eq('invite_token', token)
      .maybeSingle()

    if (lookupError || !portalUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired invite link', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!portalUser.invite_token_expires_at || new Date(portalUser.invite_token_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'This invite has expired. Please request a new one from your administrator.', valid: false, expired: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (portalUser.revoked_at || !portalUser.is_active) {
      return new Response(
        JSON.stringify({ error: 'This invite is no longer valid.', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const firm = portalUser.solicitor_firms as any;
    if (!firm || !firm.is_active) {
      return new Response(
        JSON.stringify({ error: 'The linked legal practice is no longer active.', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === VALIDATE ONLY ===
    if (action === 'validate') {
      return new Response(
        JSON.stringify({
          valid: true,
          email: portalUser.email,
          name: portalUser.name,
          position: portalUser.position,
          portal_role: portalUser.portal_role,
          firm_name: firm.trading_name || firm.name,
          already_active: !!portalUser.invite_accepted_at && !!portalUser.password_hash,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === ACCEPT INVITE ===
    if (!password || typeof password !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Password is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (password.length < 10) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 10 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const hashedPassword = await hashPassword(password)
    const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS)

    const { error: updateError } = await supabase
      .from('solicitor_portal_users')
      .update({
        password_hash: hashedPassword,
        must_change_password: false,
        invite_token: null,
        invite_token_expires_at: null,
        invite_accepted_at: new Date().toISOString(),
        session_token: sessionToken,
        session_expires_at: expiresAt.toISOString(),
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
      })
      .eq('id', portalUser.id)

    if (updateError) {
      console.error('[solicitor-portal-accept-invite] update failed:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to activate your account' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    await supabase.from('solicitor_portal_activity_log').insert({
      solicitor_user_id: portalUser.id,
      firm_id: portalUser.firm_id,
      actor_user_id: portalUser.id,
      actor_type: 'solicitor_user',
      action: 'invite_accepted',
      entity_type: 'solicitor_portal_user',
      entity_id: portalUser.id,
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: req.headers.get('user-agent') || null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: portalUser.id,
          firm_id: portalUser.firm_id,
          email: portalUser.email,
          name: portalUser.name,
          position: portalUser.position,
          portal_role: portalUser.portal_role,
          firm_name: firm.trading_name || firm.name,
          practising_states: firm.practising_states || [],
          has_accepted_terms: false,
          has_completed_onboarding: false,
          must_change_password: false,
        },
        expires_at: expiresAt.toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createSolicitorSessionCookie(sessionToken, expiresAt),
        }
      }
    )
  } catch (error: any) {
    console.error('Solicitor portal accept-invite error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
