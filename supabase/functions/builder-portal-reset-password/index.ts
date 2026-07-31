/**
 * Builder / Developer Portal — password reset completion.
 *
 * Mirrors `solicitor-portal-reset-password`. Attempts are consumed atomically in
 * the database so concurrent guesses cannot share a stale counter.
 *
 * Correction: the candidate code is HASHED before comparison and the database
 * function answers match / no-match. No secret is ever returned to the Edge
 * Function, and a wrong code is reported identically to an unknown account.
 *
 * Actions: `verify_otp` (validate before showing the password form) and reset.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { hashPassword } from '../_shared/password.ts';
import { validatePasswordStrength } from '../_shared/passwordValidation.ts';
import { createCorsHeaders, createClearBuilderSessionCookie } from '../_shared/auth.ts';
import { hashSessionToken } from '../_shared/sessionHash.ts';
import { validateBuilderPortalRequest } from '../_shared/builderSessionToken.ts';
import { auditBuilderIdentity, revokeAllBuilderSessions } from '../_shared/builderSessions.ts';

const MAX_OTP_ATTEMPTS = 5;
const GENERIC_CODE_ERROR = 'Invalid or expired code';

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (payload: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(payload), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
    });

  if (!validateBuilderPortalRequest(req)) return json({ error: GENERIC_CODE_ERROR }, 400);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { action, email, otp, new_password } = await req.json();
    if (!email || !otp) return json({ error: 'Email and code are required' }, 400);

    const normalizedEmail = String(email).toLowerCase().trim();
    const otpHash = await hashSessionToken(String(otp).trim());
    if (!otpHash) return json({ error: GENERIC_CODE_ERROR }, 400);

    const { data, error: consumeError } = await supabase.rpc('consume_builder_portal_reset_attempt', {
      p_email: normalizedEmail,
      p_token_hash: otpHash,
      p_max: MAX_OTP_ATTEMPTS,
    });
    const result = Array.isArray(data) ? data[0] : data;

    if (consumeError || !result || result.status === 'not_found') {
      return json({ error: GENERIC_CODE_ERROR }, 400);
    }
    if (result.status === 'expired') {
      return json({ error: 'This code has expired. Please request a new one.' }, 400);
    }
    if (result.status === 'too_many') {
      return json({ error: 'Too many incorrect attempts. Please request a new code.' }, 429);
    }

    if (action === 'verify_otp') return json({ success: true });

    if (!new_password || typeof new_password !== 'string') {
      return json({ error: 'A new password is required' }, 400);
    }
    const strength = await validatePasswordStrength(new_password);
    if (!strength.isValid) {
      return json({ error: strength.error || 'Password does not meet the required strength' }, 400);
    }

    const passwordHash = await hashPassword(new_password);

    // Single-use: clearing the hash means a replay of the same code resolves to
    // 'not_found' on the next attempt.
    await supabase.from('builder_portal_users').update({
      password_hash: passwordHash,
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
      reset_token_hash: null,
      reset_token_expires_at: null,
      reset_attempts: 0,
      failed_login_attempts: 0,
      locked_until: null,
      // A completed reset is a proven mailbox challenge, so an account that was
      // still showing as "invited" is treated as activated.
      ...(result.invite_accepted_at ? {} : {
        invite_accepted_at: new Date().toISOString(),
        invite_token_hash: null,
        invite_token_expires_at: null,
      }),
    }).eq('id', result.user_id);

    // Every live session dies with the old password. The Phase 1 trigger on
    // password_changed_at does this too; the explicit call keeps the count for
    // the audit record and covers any future trigger change.
    const revoked = await revokeAllBuilderSessions(supabase, result.user_id, 'password_reset');

    await auditBuilderIdentity(supabase, req, {
      userId: result.user_id,
      action: 'builder_password_reset_completed',
      metadata: { sessions_revoked: revoked },
    });

    // The caller is not signed in by a reset — the Solicitor flow returns them
    // to login, and Builder matches that.
    return json({ success: true, sessions_revoked: revoked }, 200, {
      'Set-Cookie': createClearBuilderSessionCookie(),
    });
  } catch (error) {
    console.error('[builder-portal-reset-password]', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
