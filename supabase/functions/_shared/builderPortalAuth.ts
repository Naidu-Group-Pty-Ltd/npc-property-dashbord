/**
 * Builder / Developer Portal — shared session resolution, governance and permissions.
 *
 * Mirrors `_shared/solicitorPortalAuth.ts`: every `builder-portal-*` function
 * funnels through `resolveBuilderSession`, so there is exactly ONE place that
 * decides whether a caller is a valid Builder user and what they may touch.
 * Later phases must not re-implement any of it.
 *
 * Divergences from the Solicitor module, all deliberate:
 *   * Cookie-only. No legacy header or body carrier is accepted.
 *   * Organisation reach is resolved server-side from memberships, never from a
 *     browser-supplied organisation id.
 *   * Permissions come from the Phase 1 deny-by-default
 *     `builder_resolve_permission()`. There is no default-allow key set and no
 *     OR-merge (Phase 0 NOCOPY-01).
 *   * The rollout gate is enforced here, server-side, not in the client.
 */
import { extractBuilderSessionToken, validateBuilderPortalHeaders } from './builderSessionToken.ts';
import { resolveBuilderSessionToken } from './builderSessions.ts';

export const BUILDER_ROLLOUT_FEATURE = 'builder_portal_identity_v1';

/** Rollout modes that permit the external portal to serve an organisation. */
const ROLLOUT_ENABLED_MODES = new Set(['shadow', 'dual_read', 'dual_write', 'cutover']);

export interface BuilderOrganisationSummary {
  organisation_id: string;
  legal_name: string;
  trading_name: string | null;
  org_type: string;
  membership_role: string;
  is_primary: boolean;
  rollout_enabled: boolean;
}

export interface BuilderSessionUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  job_title: string | null;
  status: string;
  must_change_password: boolean;
  /** The stored flag on the row. Mirrors `SolicitorSessionUser.has_accepted_terms`. */
  has_accepted_terms: boolean;
  has_completed_onboarding: boolean;
  last_seen_at: string | null;
  current_terms_version: string | null;
  /** Derived: an acceptance row exists for the CURRENT terms version. */
  has_accepted_current_terms: boolean;
  /** Derived: every mandatory onboarding step is completed. */
  has_completed_mandatory_onboarding: boolean;
}

export interface BuilderSessionResult {
  ok: boolean;
  status: number;
  error?: string;
  code?: string;
  user?: BuilderSessionUser;
  session_id?: string;
  organisations?: BuilderOrganisationSummary[];
  active_organisation?: BuilderOrganisationSummary | null;
}

/**
 * Permission keys the Builder Portal may resolve. Mirrors
 * SOLICITOR_PERMISSION_KEYS. The catalogue itself lives in
 * `builder_permission_keys`; this list is the surface the portal asks about.
 */
export const BUILDER_PERMISSION_KEYS = [
  'organisation', 'org_admin', 'projects', 'inventory', 'pricing', 'reservations',
  'transactions', 'contracts', 'construction', 'variations', 'progress_claims',
  'inspections', 'defects', 'handover', 'documents', 'messages', 'tasks', 'audit',
  'finance_status', 'legal_status', 'settlement_status',
] as const;

/**
 * Keys that are ALWAYS denied to Builder users regardless of any stored grant.
 * Enforced again in the database by `builder_resolve_permission`; duplicated
 * here so a handler that forgets to call the resolver still cannot ask for one.
 */
export const BUILDER_FORBIDDEN_KEYS = new Set<string>([
  'income', 'expenses', 'assets', 'liabilities', 'employment',
  'borrowing_capacity', 'serviceability', 'commissions',
  'aml_restricted', 'smr', 'mlro', 'legal_privileged', 'conflict_checks',
  'finance_private', 'command_private', 'solicitor_private',
  // Named after the Finance-owned tables themselves. `builder_invoices` and
  // `build_progress_payments` carry the "builder" prefix but are Finance data,
  // so a future permission key borrowing the table name is refused here rather
  // than resolving through the normal matrix.
  'builder_invoices', 'build_progress_payments',
]);

const BUILDER_USER_SELECT = `id, email, name, phone, job_title, status, is_active,
  revoked_at, must_change_password, has_accepted_current_terms,
  has_completed_onboarding, last_seen_at`;

/**
 * Resolve the caller's Builder session.
 *
 * Order matters and is the same order the governance gate uses:
 *   1. portal headers and origin
 *   2. cookie present
 *   3. session valid, unexpired, unrevoked (database re-checks user + membership)
 *   4. user active
 *   5. at least one active membership
 *   6. active organisation still reachable
 *   7. rollout enabled for at least one reachable organisation
 *
 * Terms and onboarding are reported but NOT enforced here — handlers call
 * `builderGovernanceError()` so the terms and onboarding endpoints themselves
 * remain reachable while ungoverned.
 */
export async function resolveBuilderSession(
  supabase: any,
  req: Request,
): Promise<BuilderSessionResult> {
  if (!validateBuilderPortalHeaders(req.headers)) {
    return { ok: false, status: 401, error: 'Invalid or expired session', code: 'auth_required' };
  }

  const token = extractBuilderSessionToken(req.headers);
  if (!token) {
    return { ok: false, status: 401, error: 'Invalid or expired session', code: 'auth_required' };
  }

  const resolved = await resolveBuilderSessionToken(supabase, token);
  if (!resolved) {
    return { ok: false, status: 401, error: 'Invalid or expired session', code: 'auth_required' };
  }

  const { data: user, error: userError } = await supabase
    .from('builder_portal_users').select(BUILDER_USER_SELECT)
    .eq('id', resolved.builder_user_id).maybeSingle();

  if (userError || !user) {
    return { ok: false, status: 401, error: 'Invalid or expired session', code: 'auth_required' };
  }
  if (!user.is_active || user.status !== 'active' || user.revoked_at) {
    return {
      ok: false, status: 403, code: 'access_revoked',
      error: 'Your access has been revoked. Please contact your administrator.',
    };
  }

  const organisations = await listAccessibleOrganisations(supabase, user.id);
  if (!organisations.length) {
    return {
      ok: false, status: 403, code: 'no_membership',
      error: 'You do not have an active organisation membership. Please contact your administrator.',
    };
  }

  if (!organisations.some((organisation) => organisation.rollout_enabled)) {
    return {
      ok: false, status: 403, code: 'rollout_disabled',
      error: 'The Builder Portal is not yet enabled for your organisation.',
    };
  }

  const { data: sessionRow } = await supabase
    .from('builder_portal_sessions').select('active_organisation_id')
    .eq('id', resolved.session_id).maybeSingle();

  // A stored selection that is no longer reachable — membership revoked, or the
  // organisation suspended — is dropped rather than honoured.
  const stored = sessionRow?.active_organisation_id ?? null;
  let active = stored
    ? organisations.find((organisation) => organisation.organisation_id === stored) ?? null
    : null;

  // Automatic selection: the primary membership when it is valid and enabled,
  // or the only enabled organisation. Otherwise the caller must choose.
  if (!active) {
    const enabled = organisations.filter((organisation) => organisation.rollout_enabled);
    active = enabled.find((organisation) => organisation.is_primary) ?? (enabled.length === 1 ? enabled[0] : null);
  }

  // Governance is DERIVED here, exactly as `resolveSolicitorSession` derives it:
  // the current terms version is looked up, then an acceptance row for THAT
  // version, and the mandatory onboarding steps are counted. Reading the stored
  // `has_accepted_current_terms` flag instead would leave every existing user
  // showing as accepted the moment a new terms version is published, because
  // nothing clears the flag — acceptance would no longer be version-exact.
  const { data: terms } = await supabase
    .from('portal_terms_versions').select('id, version')
    .eq('portal', 'builder').is('retired_at', null)
    .lte('effective_at', new Date().toISOString())
    .order('effective_at', { ascending: false }).limit(1).maybeSingle();

  const [{ data: acceptance }, { data: onboarding }] = await Promise.all([
    terms
      ? supabase.from('portal_terms_acceptances').select('id')
        .eq('terms_version_id', terms.id).eq('builder_user_id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('builder_onboarding_steps').select('mandatory, completed_at')
      .eq('builder_user_id', user.id),
  ]);
  const mandatorySteps = (onboarding || []).filter((step: any) => step.mandatory);
  const mandatoryComplete = mandatorySteps.length > 0
    && mandatorySteps.every((step: any) => !!step.completed_at);

  return {
    ok: true,
    status: 200,
    session_id: resolved.session_id,
    organisations,
    active_organisation: active,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone ?? null,
      job_title: user.job_title ?? null,
      status: user.status,
      must_change_password: !!user.must_change_password,
      has_accepted_terms: !!user.has_accepted_current_terms,
      has_completed_onboarding: !!user.has_completed_onboarding,
      last_seen_at: user.last_seen_at ?? null,
      current_terms_version: terms?.version ?? null,
      has_accepted_current_terms: !!terms && !!acceptance,
      has_completed_mandatory_onboarding: mandatoryComplete,
    },
  };
}

/**
 * Organisations this user may actually reach, with their rollout state.
 * Derived entirely server-side from `builder_accessible_organisations`, which
 * requires the user, the membership and the organisation all to be active.
 */
export async function listAccessibleOrganisations(
  supabase: any,
  userId: string,
): Promise<BuilderOrganisationSummary[]> {
  const { data: accessible, error } = await supabase.rpc('builder_accessible_organisations', {
    _user_id: userId,
  });
  if (error || !Array.isArray(accessible) || !accessible.length) return [];

  const ids = accessible.map((row: any) => row.organisation_id);
  const [{ data: organisations }, { data: memberships }] = await Promise.all([
    supabase.from('builder_organisations')
      .select('id, legal_name, trading_name, org_type').in('id', ids),
    supabase.from('builder_organisation_memberships')
      .select('organisation_id, is_primary')
      .eq('builder_user_id', userId).is('revoked_at', null).in('organisation_id', ids),
  ]);

  const primaryBy = new Map<string, boolean>(
    (memberships ?? []).map((m: any) => [m.organisation_id, !!m.is_primary]),
  );
  // Explicitly typed: the PostgREST row type erases to `{}`, which silently
  // turns every field read below into a type error the scoped Deno check
  // catches but an untyped Map would hide.
  const detailBy = new Map<string, { legal_name: string; trading_name: string | null; org_type: string }>(
    (organisations ?? []).map((o: any) => [o.id, o]),
  );

  const summaries: BuilderOrganisationSummary[] = [];
  for (const row of accessible) {
    const detail = detailBy.get(row.organisation_id);
    if (!detail) continue;
    summaries.push({
      organisation_id: row.organisation_id,
      legal_name: detail.legal_name,
      trading_name: detail.trading_name ?? null,
      org_type: detail.org_type,
      membership_role: row.membership_role,
      is_primary: primaryBy.get(row.organisation_id) === true,
      rollout_enabled: await isRolloutEnabled(supabase, row.organisation_id),
    });
  }
  return summaries.sort((a, b) => Number(b.is_primary) - Number(a.is_primary)
    || a.legal_name.localeCompare(b.legal_name));
}

/**
 * Server-side rollout gate. Uses the Phase 1 generalised control plane; the
 * Solicitor resolution path is untouched.
 */
export async function isRolloutEnabled(supabase: any, organisationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('resolve_cross_portal_feature_mode_for', {
    _portal: 'builder', _owner_id: organisationId, _feature_key: BUILDER_ROLLOUT_FEATURE,
  });
  if (error) {
    console.error('[builderPortalAuth] rollout resolution failed', error.message);
    return false;
  }
  return ROLLOUT_ENABLED_MODES.has(String(data ?? 'off'));
}

/**
 * The governance gate. Returns a machine-readable reason, or null when the
 * caller may proceed to a protected resource. Browser route guards mirror this
 * order for the journey; THIS is the authorization control.
 */
export function builderGovernanceError(result: BuilderSessionResult): string | null {
  if (!result.user) return 'auth_required';
  if (result.user.must_change_password) return 'password_rotation_required';
  if (!result.active_organisation) return 'organisation_selection_required';
  if (!result.user.has_accepted_current_terms) return 'terms_acceptance_required';
  if (!result.user.has_completed_mandatory_onboarding) return 'onboarding_required';
  return null;
}

/**
 * Deny-by-default permission resolution for one organisation.
 *
 * `organisationId` is verified against the caller's resolved reach before the
 * database is asked, so a forged organisation id can never widen access.
 */
export async function builderCan(
  supabase: any,
  session: BuilderSessionResult,
  organisationId: string,
  permissionKey: string,
  level: 'view' | 'edit' | 'delete' = 'view',
): Promise<boolean> {
  if (BUILDER_FORBIDDEN_KEYS.has(permissionKey)) return false;
  if (!session.ok || !session.user) return false;
  if (!session.organisations?.some((o) => o.organisation_id === organisationId)) return false;

  const { data, error } = await supabase.rpc('builder_resolve_permission', {
    _user_id: session.user.id,
    _org_id: organisationId,
    _permission_key: permissionKey,
    _level: level,
  });
  if (error) {
    console.error('[builderPortalAuth] permission resolution failed', error.message);
    return false;
  }
  return data === true;
}

/**
 * Resolve the full permission matrix for one organisation, for the client to
 * render with. Every key is resolved server-side; the browser receives a
 * result, never a policy it could edit.
 */
export async function builderPermissionMatrix(
  supabase: any,
  session: BuilderSessionResult,
  organisationId: string,
): Promise<Record<string, { view: boolean; edit: boolean; delete: boolean }>> {
  const matrix: Record<string, { view: boolean; edit: boolean; delete: boolean }> = {};
  for (const key of BUILDER_PERMISSION_KEYS) {
    const [view, edit, remove] = await Promise.all([
      builderCan(supabase, session, organisationId, key, 'view'),
      builderCan(supabase, session, organisationId, key, 'edit'),
      builderCan(supabase, session, organisationId, key, 'delete'),
    ]);
    matrix[key] = { view, edit, delete: remove };
  }
  return matrix;
}
