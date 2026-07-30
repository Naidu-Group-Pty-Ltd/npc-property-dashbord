import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { verifyPassword } from "../_shared/password.ts"
import { createCorsHeaders, createSolicitorSessionCookie } from "../_shared/auth.ts"

const SESSION_HOURS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

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

    const { email, password, turnstile_token } = await req.json()

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: 'Email and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Turnstile — fails closed when REQUIRE_TURNSTILE=true but the secret is absent.
    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY')
    if (!turnstileSecret && Deno.env.get('REQUIRE_TURNSTILE') === 'true') {
      console.error('TURNSTILE_SECRET_KEY missing while REQUIRE_TURNSTILE=true — failing closed')
      return new Response(
        JSON.stringify({ error: 'Security verification is unavailable. Please try again later.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (turnstileSecret) {
      if (!turnstile_token) {
        return new Response(
          JSON.stringify({ error: 'Security verification required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: turnstileSecret, response: turnstile_token }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyData.success) {
        return new Response(
          JSON.stringify({ error: 'Security verification failed. Please try again.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const { data: portalUser, error: userError } = await supabase
      .from('solicitor_portal_users')
      .select(`
        id, firm_id, email, name, phone, position, portal_role,
        password_hash, is_active, revoked_at,
        has_accepted_terms, has_completed_onboarding,
        failed_login_attempts, locked_until, must_change_password,
        solicitor_firms:firm_id (id, name, trading_name, practising_states, is_active)
      `)
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (userError || !portalUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!portalUser.is_active || portalUser.revoked_at) {
      return new Response(
        JSON.stringify({ error: 'Your access has been revoked. Please contact your administrator.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const firm = portalUser.solicitor_firms as any;
    if (!firm || !firm.is_active) {
      return new Response(
        JSON.stringify({ error: 'The legal practice linked to this account is no longer active.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (portalUser.locked_until && new Date(portalUser.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(portalUser.locked_until).getTime() - Date.now()) / 60000);
      return new Response(
        JSON.stringify({ error: `Account temporarily locked. Try again in ${minutesLeft} minute(s).` }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!portalUser.password_hash) {
      return new Response(
        JSON.stringify({ error: 'Please accept your invite first to set up your password.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const isValid = await verifyPassword(password, portalUser.password_hash)
    if (!isValid) {
      const newAttempts = (portalUser.failed_login_attempts || 0) + 1;
      const updates: Record<string, any> = { failed_login_attempts: newAttempts };
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_MINUTES);
        updates.locked_until = lockUntil.toISOString();
        updates.failed_login_attempts = 0;
      }
      await supabase.from('solicitor_portal_users').update(updates).eq('id', portalUser.id);

      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS)

    await supabase
      .from('solicitor_portal_users')
      .update({
        session_token: sessionToken,
        session_expires_at: expiresAt.toISOString(),
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
      })
      .eq('id', portalUser.id)

    await supabase.from('solicitor_portal_activity_log').insert({
      solicitor_user_id: portalUser.id,
      firm_id: portalUser.firm_id,
      actor_user_id: portalUser.id,
      actor_type: 'solicitor_user',
      action: 'login',
      entity_type: 'session',
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: req.headers.get('user-agent') || null,
      metadata: { email: normalizedEmail },
    });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: portalUser.id,
          firm_id: portalUser.firm_id,
          email: portalUser.email,
          name: portalUser.name,
          phone: portalUser.phone,
          position: portalUser.position,
          portal_role: portalUser.portal_role,
          firm_name: firm.trading_name || firm.name,
          practising_states: firm.practising_states || [],
          has_accepted_terms: portalUser.has_accepted_terms,
          has_completed_onboarding: portalUser.has_completed_onboarding,
          must_change_password: !!portalUser.must_change_password,
        },
        must_change_password: !!portalUser.must_change_password,
        session_token: sessionToken,
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
    console.error('Solicitor portal login error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...createCorsHeaders(origin), 'Content-Type': 'application/json' } }
    )
  }
})
