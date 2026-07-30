import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders } from "../_shared/auth.ts"

const MAX_OTP_ATTEMPTS = 5;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { action, email, otp, new_password } = await req.json()

    if (!email || !otp) {
      return json({ error: 'Email and code are required' }, 400)
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const { data: user } = await supabase
      .from('solicitor_portal_users')
      .select('id, firm_id, reset_token, reset_token_expires_at, reset_attempts, is_active, revoked_at, invite_accepted_at')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (!user || !user.is_active || user.revoked_at || !user.reset_token) {
      return json({ error: 'Invalid or expired code' }, 400)
    }

    if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
      return json({ error: 'This code has expired. Please request a new one.' }, 400)
    }

    if ((user.reset_attempts || 0) >= MAX_OTP_ATTEMPTS) {
      await supabase
        .from('solicitor_portal_users')
        .update({ reset_token: null, reset_token_expires_at: null })
        .eq('id', user.id)
      return json({ error: 'Too many incorrect attempts. Please request a new code.' }, 429)
    }

    // Constant-length comparison on a 6-digit code.
    if (String(otp).trim() !== user.reset_token) {
      await supabase
        .from('solicitor_portal_users')
        .update({ reset_attempts: (user.reset_attempts || 0) + 1 })
        .eq('id', user.id)
      return json({ error: 'Invalid or expired code' }, 400)
    }

    // === VERIFY ONLY ===
    if (action === 'verify_otp') {
      return json({ success: true })
    }

    // === RESET PASSWORD ===
    if (!new_password || typeof new_password !== 'string' || new_password.length < 10) {
      return json({ error: 'Password must be at least 10 characters' }, 400)
    }

    const passwordHash = await hashPassword(new_password)

    await supabase
      .from('solicitor_portal_users')
      .update({
        password_hash: passwordHash,
        must_change_password: false,
        reset_token: null,
        reset_token_expires_at: null,
        reset_attempts: 0,
        // Invalidate any live session so a stolen session cannot survive a reset.
        session_token: null,
        session_expires_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        // A completed reset is a proven mailbox challenge — treat it as invite acceptance
        // so the account stops showing as "invited" forever in the Command Centre.
        ...(user.invite_accepted_at ? {} : { invite_accepted_at: new Date().toISOString(), invite_token: null, invite_token_expires_at: null }),
      })
      .eq('id', user.id)

    await supabase.from('solicitor_portal_activity_log').insert({
      solicitor_user_id: user.id,
      firm_id: user.firm_id,
      actor_user_id: user.id,
      actor_type: 'solicitor_user',
      action: 'password_reset_completed',
      entity_type: 'session',
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    });

    return json({ success: true })
  } catch (error: any) {
    console.error('Solicitor portal reset-password error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
})
