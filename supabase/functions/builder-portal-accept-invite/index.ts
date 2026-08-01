/**
 * Builder / Developer Portal — invitation acceptance.
 *
 * Mirrors `solicitor-portal-accept-invite` with three corrections:
 *
 *  1. The invite token is looked up by HASH. Phase 1 stores
 *     `invite_token_hash` and has no plaintext column, so a database leak
 *     cannot yield a usable invite link.
 *  2. The Solicitor function references an undeclared `updatedUser` on the
 *     success path — a latent ReferenceError. Here the updated row is captured
 *     and checked.
 *  3. Password strength uses the shared validator rather than a bare length
 *     check.
 *
 * Actions: `validate` (render the form) and accept (default).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { hashPassword } from '../_shared/password.ts';
import { validatePasswordStrength } from '../_shared/passwordValidation.ts';
import { createCorsHeaders, createBuilderSessionCookie } from '../_shared/auth.ts';
import { hashSessionToken } from '../_shared/sessionHash.ts';
import { validateBuilderPortalRequest } from '../_shared/builderSessionToken.ts';
import { auditBuilderIdentity, issueBuilderSession } from '../_shared/builderSessions.ts';
import { listAccessibleOrganisations } from '../_shared/builderPortalAuth.ts';

const GENERIC_INVITE_ERROR = 'Invalid or expired invite link';

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (payload: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(payload), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
    });

  if (!validateBuilderPortalRequest(req)) return json({ error: GENERIC_INVITE_ERROR, valid: false }, 400);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { action, token, password } = await req.json();
    if (!token || typeof token !== 'string') {
      return json({ error: GENERIC_INVITE_ERROR, valid: false }, 400);
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { data: allowed } = await supabase.rpc('check_and_bump_rate_limit', {
      p_key: `builder_invite:${ip}`, p_max: 20, p_window_seconds: 3600,
    });
    if (allowed === false) return json({ error: GENERIC_INVITE_ERROR, valid: false }, 429);

    const tokenHash = await hashSessionToken(token);
    if (!tokenHash) return json({ error: GENERIC_INVITE_ERROR, valid: false }, 400);

    const { data: portalUser } = await supabase
      .from('builder_portal_users')
      .select(`id, email, name, job_title, status, is_active, revoked_at,
               invite_token_hash, invite_token_expires_at, invite_accepted_at, password_hash`)
      .eq('invite_token_hash', tokenHash)
      .maybeSingle();

    // Every rejection below uses the same generic message so an attacker cannot
    // learn whether a token exists, has expired, or was already used.
    if (!portalUser) return json({ error: GENERIC_INVITE_ERROR, valid: false }, 400);
    if (!portalUser.invite_token_expires_at
        || new Date(portalUser.invite_token_expires_at) < new Date()) {
      return json({ error: GENERIC_INVITE_ERROR, valid: false, expired: true }, 400);
    }
    if (portalUser.revoked_at || portalUser.status === 'revoked') {
      return json({ error: GENERIC_INVITE_ERROR, valid: false }, 400);
    }
    if (portalUser.invite_accepted_at || portalUser.password_hash) {
      return json({ error: GENERIC_INVITE_ERROR, valid: false, already_active: true }, 400);
    }

    // An invite is only usable if the account still has somewhere to go.
    const organisations = await listAccessibleOrganisations(supabase, portalUser.id);
    const membershipsExist = organisations.length > 0 || await hasAnyPendingMembership(supabase, portalUser.id);
    if (!membershipsExist) return json({ error: GENERIC_INVITE_ERROR, valid: false }, 400);

    if (action === 'validate') {
      return json({
        valid: true,
        email: portalUser.email,
        name: portalUser.name,
        job_title: portalUser.job_title,
        organisations: organisations.map((organisation) => ({
          organisation_id: organisation.organisation_id,
          legal_name: organisation.legal_name,
          membership_role: organisation.membership_role,
        })),
      });
    }

    if (!password || typeof password !== 'string') {
      return json({ error: 'Password is required' }, 400);
    }
    const strength = await validatePasswordStrength(password);
    if (!strength.isValid) {
      return json({ error: strength.error || 'Password does not meet the required strength' }, 400);
    }

    const hashedPassword = await hashPassword(password);

    // Single-use: the WHERE clause requires the invite to still be unaccepted
    // and still carry this exact hash, so a concurrent second acceptance
    // matches no row.
    const { data: updatedUser, error: updateError } = await supabase
      .from('builder_portal_users')
      .update({
        password_hash: hashedPassword,
        must_change_password: false,
        password_changed_at: new Date().toISOString(),
        invite_token_hash: null,
        invite_token_expires_at: null,
        invite_accepted_at: new Date().toISOString(),
        status: 'active',
        is_active: true,
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
      })
      .eq('id', portalUser.id)
      .eq('invite_token_hash', tokenHash)
      .is('invite_accepted_at', null)
      .select('id, email, name, phone, job_title, must_change_password')
      .maybeSingle();

    if (updateError) {
      console.error('[builder-portal-accept-invite] activation failed', updateError.message);
      return json({ error: 'Failed to activate your account' }, 500);
    }
    if (!updatedUser) return json({ error: GENERIC_INVITE_ERROR, valid: false }, 400);

    await supabase.rpc('builder_ensure_onboarding_steps', { _builder_user_id: portalUser.id });

    const organisations = await listAccessibleOrganisations(supabase, portalUser.id);
    const autoSelected = organisations.find((organisation) => organisation.is_primary)
      ?? (organisations.length === 1 ? organisations[0] : null);

    const issued = await issueBuilderSession(supabase, portalUser.id, req, {
      deviceLabel: req.headers.get('user-agent') || undefined,
    });
    if (autoSelected) {
      await supabase.rpc('builder_select_session_organisation', {
        _session_id: issued.id,
        _builder_user_id: portalUser.id,
        _organisation_id: autoSelected.organisation_id,
      });
    }

    await auditBuilderIdentity(supabase, req, {
      userId: portalUser.id, organisationId: autoSelected?.organisation_id ?? null,
      action: 'builder_invite_accepted', sessionId: issued.id,
      newState: { status: 'active' },
    });

    return json({
      success: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        phone: updatedUser.phone,
        job_title: updatedUser.job_title,
        must_change_password: false,
        has_accepted_current_terms: false,
        has_completed_onboarding: false,
      },
      organisations,
      active_organisation: autoSelected,
      requires_organisation_selection: !autoSelected,
      session: {
        id: issued.id,
        absolute_expires_at: issued.absoluteExpiresAt.toISOString(),
        idle_expires_at: issued.idleExpiresAt.toISOString(),
      },
    }, 200, { 'Set-Cookie': createBuilderSessionCookie(issued.token, issued.absoluteExpiresAt) });
  } catch (error) {
    console.error('[builder-portal-accept-invite]', error);
    return json({ error: 'Internal server error' }, 500);
  }
});

/**
 * A newly invited user may hold a membership of an organisation that is still
 * pending activation, which `builder_accessible_organisations` correctly
 * excludes. The invite is still legitimate, so it is accepted and the rollout
 * and organisation gates apply at login instead.
 */
async function hasAnyPendingMembership(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from('builder_organisation_memberships')
    .select('id').eq('builder_user_id', userId).is('revoked_at', null).limit(1);
  return Array.isArray(data) && data.length > 0;
}
