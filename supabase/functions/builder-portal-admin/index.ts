/**
 * Builder / Developer Portal Admin — Command Centre control plane (Phase 1)
 *
 * Every builder-organisation, portal-user and membership administration
 * operation funnels through this one service-role function. Staff callers are
 * gated deny-by-default on the `builder_portal_admin` module permission
 * (superadmin bypass preserved), and mutations additionally require CSRF
 * validation because the staff session is cookie-carried.
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a Builder Portal session cookie. The external
 * `/builder/*` portal is served by a separate `builder-portal-*` family that
 * resolves a builder session and never accepts a staff JWT. No function accepts
 * either (ADR 018).
 *
 * Operations
 *   Organisations: list_organisations | upsert_organisation | set_organisation_status
 *   Users:         list_users | create_user | update_user | set_user_status
 *   Memberships:   list_memberships | upsert_membership | revoke_membership
 *   Permissions:   get_membership_permissions | update_membership_permissions
 *   Sessions:      list_user_sessions | revoke_user_sessions
 *   Reference:     get_permission_catalogue
 *   Release:       list_builder_rollouts | get_builder_readiness |
 *                  get_builder_operational_health | set_builder_rollout |
 *                  record_builder_approval | revoke_builder_approval
 *
 * Boundary invariants enforced here, not merely documented:
 *   * Forbidden permission keys are stripped server-side before any write.
 *   * Organisation ids supplied by the browser are never trusted as authority;
 *     the module permission is the authority and every child write is scoped to
 *     a re-read parent.
 *   * `builder_invoices` and `build_progress_payments` are Finance-owned and are
 *     never read or written here.
 *   * Mutable aggregates use expected_version; a stale write returns HTTP 409.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from "../_shared/auth.ts";
import { requireModulePermission, type ModulePerm } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";

const MODULE_KEY = 'builder_portal_admin';

const ORG_TYPES = new Set(['developer', 'builder', 'builder_developer', 'sales_representative']);
const ORG_STATUSES = new Set(['pending_activation', 'active', 'suspended', 'closed']);
const USER_STATUSES = new Set(['invited', 'active', 'suspended', 'revoked']);
const MEMBERSHIP_ROLES = new Set(['owner', 'administrator', 'manager', 'member', 'read_only']);
const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);
const DECISIONS = new Set(['inherit', 'allow', 'deny']);

const READ_OPERATIONS = new Set([
  'list_organisations', 'list_users', 'list_memberships',
  'get_membership_permissions', 'list_user_sessions', 'get_permission_catalogue',
  // Release control reads. Transitions, approvals and revocations are NOT
  // listed here, so they require can_edit and pass through CSRF.
  'list_builder_rollouts', 'get_builder_readiness', 'get_builder_operational_health',
]);

/** Operations that mutate state require can_edit rather than can_view. */
function requiredPermFor(operation: string): ModulePerm {
  return READ_OPERATIONS.has(operation) ? 'can_view' : 'can_edit';
}

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });

const trimmed = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out.length ? out : null;
};

const digitsOnly = (value: unknown): string | null => {
  const raw = trimmed(value);
  return raw ? raw.replace(/[^0-9]/g, '') || null : null;
};

/** Column allow-lists. No handler ever selects `*`. */
const ORG_SELECT = `id, legal_name, trading_name, org_type, abn, acn, contact_email,
  contact_phone, website, address_line1, address_line2, suburb, state, postcode,
  status, is_active, activated_at, suspended_at, suspension_reason, notes,
  row_version, created_at, updated_at`;

const USER_SELECT = `id, email, name, phone, job_title, status, is_active,
  must_change_password, has_accepted_current_terms, has_completed_onboarding,
  invite_accepted_at, invited_at, last_seen_at, revoked_at, revoked_reason,
  row_version, created_at, updated_at`;

const MEMBERSHIP_SELECT = `id, builder_user_id, organisation_id, membership_role,
  is_primary, status, valid_from, valid_until, revoked_at, revoked_reason,
  row_version, created_at, updated_at`;

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400, cors);
  }

  const operation = trimmed(body?.operation);
  if (!operation) return json({ error: 'operation is required' }, 400, cors);

  // 1. Command Centre session. A Builder Portal cookie is not a staff session
  //    and cannot satisfy this.
  //
  //    P3: authentication failure is 401, not 403. createForbiddenResponse()
  //    takes (message, corsHeaders) and always returns 403, so it is used only
  //    for the authorization failure below — matching solicitor-portal-admin,
  //    which returns json({...}, 401) here and createForbiddenResponse() there.
  const auth = await verifyAuth(supabase, req.headers, body);
  if (auth.error || !auth.userId) {
    return json({ error: auth.error || 'Authentication required' }, 401, cors);
  }

  // 2. CSRF on every mutation — the staff session is cookie-carried.
  //    P1: the established signature is csrfDenied(corsHeaders, csrfResult).
  //    Reversing them spread the CsrfCheckResult into the response headers and
  //    dropped Access-Control-Allow-Origin, so the browser saw a CORS error
  //    instead of the CSRF failure detail.
  if (!READ_OPERATIONS.has(operation)) {
    const csrf = enforceCsrf(req);
    if (!csrf.ok) return csrfDenied(cors, csrf);
  }

  // 3. Deny-by-default module permission. A missing module registration or a
  //    missing permission row denies. Authenticated-but-not-permitted is 403.
  const authz = await requireModulePermission(
    supabase, { userId: auth.userId, authMethod: auth.authMethod },
    MODULE_KEY, requiredPermFor(operation),
  );
  if (!authz.ok) {
    return createForbiddenResponse(authz.error || 'Not authorized', cors);
  }

  // P2: verifyAuth() returns the literal string 'service_role' as the identity
  // for a verified internal call (see _shared/auth.ts). That is not a uuid, so
  // writing it into created_by / updated_by / granted_by / invited_by or into a
  // uuid RPC argument fails with 22P02. Solicitor guards this the same way.
  //
  // auth.userId stays the permission-check identity; adminUserId is the only
  // value that reaches a uuid column.
  const isServiceRoleActor = auth.userId === 'service_role';
  const adminUserId: string | null = isServiceRoleActor ? null : auth.userId;
  const actorType = isServiceRoleActor ? 'service_role' : 'command_user';

  /** Re-read a parent server-side. A browser-supplied id is a request, not an authority. */
  const loadOrganisation = async (organisationId: string | null) => {
    if (!organisationId) return null;
    const { data } = await supabase
      .from('builder_organisations').select('id, status, row_version')
      .eq('id', organisationId).maybeSingle();
    return data ?? null;
  };

  /**
   * P4: access-control mutations run through guarded database commands that
   * write the state change AND the trusted audit record in one transaction. A
   * failed audit write aborts the mutation, so nothing can be reported as
   * successfully completed without evidence (Phase 0 NOCOPY-04).
   *
   * The commands signal failure as PostgreSQL exceptions; this maps them onto
   * the HTTP contract Phase 1 already established.
   */
  const RPC_STATUS: Array<[RegExp, number, string | undefined]> = [
    [/BUILDER_STALE_WRITE/, 409, 'stale_write'],
    [/BUILDER_ORG_CLOSED/, 409, 'organisation_closed'],
    [/BUILDER_USER_REVOKED/, 409, 'user_revoked'],
    [/BUILDER_MEMBERSHIP_NOT_FOUND_OR_REVOKED/, 409, 'membership_not_found'],
    [/BUILDER_ORG_NOT_FOUND/, 404, undefined],
    [/BUILDER_USER_NOT_FOUND/, 404, undefined],
    [/BUILDER_UNKNOWN_USER_STATUS|BUILDER_UNKNOWN_ORG_STATUS/, 400, undefined],
    [/BUILDER_FORBIDDEN_PERMISSION_KEY|BUILDER_UNKNOWN_PERMISSION_KEY/, 400, 'forbidden_permission_key'],
    [/BUILDER_PROJECTION_NOT_WRITABLE/, 400, 'projection_not_writable'],
    [/BUILDER_SCOPE_NOT_AVAILABLE/, 400, 'scope_not_available'],
    [/BUILDER_AUDIT_WRITE_FAILED|BUILDER_ACTIVITY_LOG_APPEND_ONLY/, 500, 'audit_write_failed'],
    // Release control. BUILDER_EXPECTED_VERSION_REQUIRED is 400 (the caller
    // omitted a required field); BUILDER_STALE_WRITE above is 409 (the caller
    // sent a version that is no longer current).
    [/BUILDER_EXPECTED_VERSION_REQUIRED/, 400, 'expected_version_required'],
    [/INVALID_CUTOVER_TRANSITION/, 409, 'invalid_transition'],
    [/CUTOVER_READINESS_FAILED/, 409, 'readiness_failed'],
    [/CUTOVER_REASON_REQUIRED/, 400, 'reason_required'],
    [/CUTOVER_EVIDENCE_REQUIRED/, 400, 'evidence_required'],
    [/CUTOVER_UNKNOWN_APPROVAL_TYPE/, 400, 'unknown_approval_type'],
    [/CUTOVER_ACTOR_REQUIRED/, 400, 'actor_required'],
    [/CUTOVER_APPROVAL_NOT_FOUND/, 404, 'approval_not_found'],
    [/CROSS_PORTAL_FEATURE_NOT_FOUND/, 404, 'feature_not_found'],
    [/CROSS_PORTAL_FEATURE_PORTAL_MISMATCH|CROSS_PORTAL_UNSUPPORTED_PORTAL/, 400, 'feature_portal_mismatch'],
    [/duplicate key value|23505/, 409, 'duplicate'],
  ];

  const rpcFailure = (error: { message?: string; details?: string; code?: string }) => {
    const text = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.code ?? ''}`;
    for (const [pattern, status, code] of RPC_STATUS) {
      if (pattern.test(text)) {
        const currentVersion = /current_version=(\d+)/.exec(text)?.[1];
        return json({
          error: error?.message || 'Operation failed',
          ...(code ? { code } : {}),
          ...(currentVersion ? { current_version: Number(currentVersion) } : {}),
        }, status, cors);
      }
    }
    return json({ error: error?.message || 'Operation failed' }, 500, cors);
  };

  /** Best-effort observability. Never the only record of an access-control change. */
  const auditRows: Array<Record<string, unknown>> = [];

  try {
    switch (operation) {
      // ---------------------------------------------------------------- orgs
      case 'list_organisations': {
        const { data, error } = await supabase
          .from('builder_organisations').select(ORG_SELECT)
          .order('legal_name', { ascending: true });
        if (error) throw error;
        return json({ organisations: data ?? [] }, 200, cors);
      }

      case 'upsert_organisation': {
        const legalName = trimmed(body.legal_name);
        const orgType = trimmed(body.org_type);
        if (!legalName) return json({ error: 'legal_name is required' }, 400, cors);
        if (!orgType || !ORG_TYPES.has(orgType)) {
          return json({ error: 'org_type must be developer, builder, builder_developer or sales_representative' }, 400, cors);
        }
        const state = trimmed(body.state);
        if (state && !AU_STATES.has(state.toUpperCase())) {
          return json({ error: 'state must be an Australian state or territory' }, 400, cors);
        }
        const abn = digitsOnly(body.abn);
        if (abn && !/^[0-9]{11}$/.test(abn)) return json({ error: 'abn must be 11 digits' }, 400, cors);
        const acn = digitsOnly(body.acn);
        if (acn && !/^[0-9]{9}$/.test(acn)) return json({ error: 'acn must be 9 digits' }, 400, cors);

        const payload: Record<string, unknown> = {
          legal_name: legalName,
          trading_name: trimmed(body.trading_name),
          org_type: orgType,
          abn, acn,
          contact_email: trimmed(body.contact_email)?.toLowerCase() ?? null,
          contact_phone: trimmed(body.contact_phone),
          website: trimmed(body.website),
          address_line1: trimmed(body.address_line1),
          address_line2: trimmed(body.address_line2),
          suburb: trimmed(body.suburb),
          state: state ? state.toUpperCase() : null,
          postcode: trimmed(body.postcode),
          notes: trimmed(body.notes),
          updated_by: adminUserId,
        };

        const organisationId = trimmed(body.organisation_id);
        if (!organisationId) {
          // Creation always starts pending_activation. Status is a separate,
          // audited transition — never a field on the create form.
          const { data, error } = await supabase.from('builder_organisations')
            .insert({ ...payload, status: 'pending_activation', is_active: false, created_by: adminUserId })
            .select(ORG_SELECT).single();
          if (error) throw error;
          auditRows.push({ action: 'builder_organisation_created', entity_id: data.id });
          return json({ organisation: data }, 200, cors);
        }

        const existing = await loadOrganisation(organisationId);
        if (!existing) return json({ error: 'Organisation not found' }, 404, cors);

        const expectedVersion = Number(body.expected_version);
        if (!Number.isFinite(expectedVersion)) {
          return json({ error: 'expected_version is required' }, 400, cors);
        }
        if (existing.row_version !== expectedVersion) {
          return json({
            error: 'This organisation changed since you loaded it. Reload and try again.',
            code: 'stale_write', current_version: existing.row_version,
          }, 409, cors);
        }

        const { data, error } = await supabase.from('builder_organisations')
          .update(payload).eq('id', organisationId).eq('row_version', expectedVersion)
          .select(ORG_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) {
          return json({ error: 'Concurrent update detected', code: 'stale_write' }, 409, cors);
        }
        auditRows.push({ action: 'builder_organisation_updated', entity_id: organisationId });
        return json({ organisation: data }, 200, cors);
      }

      case 'set_organisation_status': {
        // Access-control mutation: guarded command, trusted audit, one
        // transaction. Session revocation for the organisation's members
        // happens inside the same transaction.
        const organisationId = trimmed(body.organisation_id);
        const status = trimmed(body.status);
        if (!organisationId) return json({ error: 'organisation_id is required' }, 400, cors);
        if (!status || !ORG_STATUSES.has(status)) {
          return json({ error: 'Unknown organisation status' }, 400, cors);
        }
        const expectedVersion = Number(body.expected_version);
        if (!Number.isFinite(expectedVersion)) {
          return json({ error: 'expected_version is required' }, 400, cors);
        }

        const { data, error } = await supabase.rpc('builder_admin_set_organisation_status', {
          _actor_user_id: adminUserId,
          _actor_type: actorType,
          _organisation_id: organisationId,
          _status: status,
          _expected_version: expectedVersion,
          _reason: trimmed(body.reason),
        });
        if (error) return rpcFailure(error);

        auditRows.push({ action: `builder_organisation_${status}`, entity_id: organisationId });
        return json({ organisation: data }, 200, cors);
      }

      // --------------------------------------------------------------- users
      case 'list_users': {
        // An organisation filter narrows the result; it never widens it, and it
        // is applied through the membership table rather than trusted directly.
        const organisationId = trimmed(body.organisation_id);
        if (organisationId) {
          const { data: memberships, error: mErr } = await supabase
            .from('builder_organisation_memberships').select('builder_user_id')
            .eq('organisation_id', organisationId).is('revoked_at', null);
          if (mErr) throw mErr;
          const ids = (memberships ?? []).map((m: any) => m.builder_user_id);
          if (!ids.length) return json({ users: [] }, 200, cors);
          const { data, error } = await supabase.from('builder_portal_users')
            .select(USER_SELECT).in('id', ids).order('name');
          if (error) throw error;
          return json({ users: data ?? [] }, 200, cors);
        }
        const { data, error } = await supabase.from('builder_portal_users')
          .select(USER_SELECT).order('name');
        if (error) throw error;
        return json({ users: data ?? [] }, 200, cors);
      }

      case 'create_user': {
        const email = trimmed(body.email)?.toLowerCase();
        const name = trimmed(body.name);
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return json({ error: 'A valid email is required' }, 400, cors);
        }
        if (!name) return json({ error: 'name is required' }, 400, cors);

        const { data, error } = await supabase.from('builder_portal_users').insert({
          email, name,
          phone: trimmed(body.phone),
          job_title: trimmed(body.job_title),
          status: 'invited', is_active: false,
          must_change_password: true,
          invited_by: adminUserId, invited_at: new Date().toISOString(),
          created_by: adminUserId,
        }).select(USER_SELECT).single();
        if (error) {
          if ((error as any).code === '23505') {
            return json({ error: 'A portal user with that email already exists' }, 409, cors);
          }
          throw error;
        }
        auditRows.push({ action: 'builder_user_created', entity_id: data.id });
        return json({ user: data }, 200, cors);
      }

      case 'update_user': {
        const userId = trimmed(body.builder_user_id);
        if (!userId) return json({ error: 'builder_user_id is required' }, 400, cors);

        const { data: existing } = await supabase.from('builder_portal_users')
          .select('id, row_version').eq('id', userId).maybeSingle();
        if (!existing) return json({ error: 'User not found' }, 404, cors);

        const expectedVersion = Number(body.expected_version);
        if (!Number.isFinite(expectedVersion) || existing.row_version !== expectedVersion) {
          return json({
            error: 'This user changed since you loaded them. Reload and try again.',
            code: 'stale_write', current_version: existing.row_version,
          }, 409, cors);
        }

        const { data, error } = await supabase.from('builder_portal_users').update({
          name: trimmed(body.name) ?? undefined,
          phone: trimmed(body.phone),
          job_title: trimmed(body.job_title),
          updated_by: adminUserId,
        }).eq('id', userId).eq('row_version', expectedVersion).select(USER_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Concurrent update detected', code: 'stale_write' }, 409, cors);
        auditRows.push({ action: 'builder_user_updated', entity_id: userId });
        return json({ user: data }, 200, cors);
      }

      case 'set_user_status': {
        const userId = trimmed(body.builder_user_id);
        const status = trimmed(body.status);
        if (!userId) return json({ error: 'builder_user_id is required' }, 400, cors);
        if (!status || !USER_STATUSES.has(status)) {
          return json({ error: 'Unknown user status' }, 400, cors);
        }

        const { data: existing } = await supabase.from('builder_portal_users')
          .select('id, row_version').eq('id', userId).maybeSingle();
        if (!existing) return json({ error: 'User not found' }, 404, cors);

        const expectedVersion = Number(body.expected_version);
        if (!Number.isFinite(expectedVersion) || existing.row_version !== expectedVersion) {
          return json({
            error: 'This user changed since you loaded them. Reload and try again.',
            code: 'stale_write', current_version: existing.row_version,
          }, 409, cors);
        }

        const { data, error } = await supabase.rpc('builder_admin_set_user_status', {
          _actor_user_id: adminUserId,
          _actor_type: actorType,
          _builder_user_id: userId,
          _status: status,
          _expected_version: expectedVersion,
          _reason: trimmed(body.reason),
        });
        if (error) return rpcFailure(error);

        auditRows.push({ action: `builder_user_${status}`, entity_id: userId });
        return json({ user: data }, 200, cors);
      }

      // --------------------------------------------------------- memberships
      case 'list_memberships': {
        const organisationId = trimmed(body.organisation_id);
        const userId = trimmed(body.builder_user_id);
        let queryBuilder = supabase.from('builder_organisation_memberships').select(MEMBERSHIP_SELECT);
        if (organisationId) queryBuilder = queryBuilder.eq('organisation_id', organisationId);
        if (userId) queryBuilder = queryBuilder.eq('builder_user_id', userId);
        const { data, error } = await queryBuilder.order('created_at', { ascending: false });
        if (error) throw error;
        return json({ memberships: data ?? [] }, 200, cors);
      }

      case 'upsert_membership': {
        const userId = trimmed(body.builder_user_id);
        const organisationId = trimmed(body.organisation_id);
        const role = trimmed(body.membership_role);
        if (!userId || !organisationId) {
          return json({ error: 'builder_user_id and organisation_id are required' }, 400, cors);
        }
        if (!role || !MEMBERSHIP_ROLES.has(role)) {
          return json({ error: 'membership_role must be owner, administrator, manager, member or read_only' }, 400, cors);
        }

        // Both parents are re-read server-side before the child write.
        const organisation = await loadOrganisation(organisationId);
        if (!organisation) return json({ error: 'Organisation not found' }, 404, cors);
        if (organisation.status === 'closed') {
          return json({ error: 'Cannot grant membership of a closed organisation', code: 'organisation_closed' }, 409, cors);
        }
        const { data: user } = await supabase.from('builder_portal_users')
          .select('id, status').eq('id', userId).maybeSingle();
        if (!user) return json({ error: 'User not found' }, 404, cors);
        if (user.status === 'revoked') {
          return json({ error: 'Cannot grant membership to a revoked user', code: 'user_revoked' }, 409, cors);
        }

        const { data: existing } = await supabase.from('builder_organisation_memberships')
          .select('id, row_version').eq('builder_user_id', userId)
          .eq('organisation_id', organisationId).is('revoked_at', null).maybeSingle();

        const expectedVersion = existing ? Number(body.expected_version) : null;
        if (existing && !Number.isFinite(expectedVersion as number)) {
          return json({
            error: 'This membership changed since you loaded it. Reload and try again.',
            code: 'stale_write', current_version: existing.row_version,
          }, 409, cors);
        }

        // Access-control mutation: the grant or role change and its trusted
        // audit record commit together, or neither commits.
        const { data, error } = await supabase.rpc('builder_admin_upsert_membership', {
          _actor_user_id: adminUserId,
          _actor_type: actorType,
          _builder_user_id: userId,
          _organisation_id: organisationId,
          _membership_role: role,
          _is_primary: body.is_primary === true,
          _expected_version: expectedVersion,
          _reason: trimmed(body.reason),
        });
        if (error) return rpcFailure(error);

        auditRows.push({
          action: existing ? 'builder_membership_role_changed' : 'builder_membership_granted',
          entity_id: (data as any)?.id ?? null,
        });
        return json({ membership: data }, 200, cors);
      }

      case 'revoke_membership': {
        const membershipId = trimmed(body.membership_id);
        if (!membershipId) return json({ error: 'membership_id is required' }, 400, cors);

        // Access-control mutation: revocation and its trusted audit record
        // commit together. The Phase 1 trigger that ends the user's sessions
        // when their last membership goes fires inside the same transaction.
        const { data, error } = await supabase.rpc('builder_admin_revoke_membership', {
          _actor_user_id: adminUserId,
          _actor_type: actorType,
          _membership_id: membershipId,
          _reason: trimmed(body.reason),
        });
        if (error) return rpcFailure(error);

        auditRows.push({ action: 'builder_membership_revoked', entity_id: membershipId });
        return json({ membership: data }, 200, cors);
      }

      // -------------------------------------------------------- permissions
      case 'get_permission_catalogue': {
        const [{ data: keys, error: kErr }, { data: defaults, error: dErr }] = await Promise.all([
          supabase.from('builder_permission_keys')
            .select('permission_key, description, key_kind, is_forbidden')
            .eq('is_forbidden', false).order('permission_key'),
          supabase.from('builder_role_default_permissions')
            .select('membership_role, permission_key, can_view, can_edit, can_delete'),
        ]);
        if (kErr) throw kErr;
        if (dErr) throw dErr;
        return json({ permission_keys: keys ?? [], role_defaults: defaults ?? [] }, 200, cors);
      }

      case 'get_membership_permissions': {
        const membershipId = trimmed(body.membership_id);
        if (!membershipId) return json({ error: 'membership_id is required' }, 400, cors);
        const { data, error } = await supabase.from('builder_membership_permissions')
          .select('permission_key, scope_type, view_decision, edit_decision, delete_decision, reason')
          .eq('membership_id', membershipId).eq('scope_type', 'organisation');
        if (error) throw error;
        return json({ overrides: data ?? [] }, 200, cors);
      }

      case 'update_membership_permissions': {
        const membershipId = trimmed(body.membership_id);
        if (!membershipId) return json({ error: 'membership_id is required' }, 400, cors);

        const { data: membership } = await supabase.from('builder_organisation_memberships')
          .select('id').eq('id', membershipId).is('revoked_at', null).maybeSingle();
        if (!membership) return json({ error: 'Membership not found or revoked' }, 404, cors);

        // Forbidden keys are stripped here as well as denied in the resolver and
        // rejected by the database trigger. Three independent layers, because a
        // single layer is a single point of failure.
        const { data: allowedKeys, error: kErr } = await supabase
          .from('builder_permission_keys').select('permission_key, key_kind')
          .eq('is_forbidden', false);
        if (kErr) throw kErr;
        const allowed = new Map((allowedKeys ?? []).map((k: any) => [k.permission_key, k.key_kind]));

        const incoming = Array.isArray(body.overrides) ? body.overrides : [];
        const rows: Array<Record<string, unknown>> = [];
        const rejected: string[] = [];

        for (const entry of incoming) {
          const key = trimmed(entry?.permission_key);
          if (!key || !allowed.has(key)) { if (key) rejected.push(key); continue; }
          const view = DECISIONS.has(entry?.view_decision) ? entry.view_decision : 'inherit';
          let edit = DECISIONS.has(entry?.edit_decision) ? entry.edit_decision : 'inherit';
          let del = DECISIONS.has(entry?.delete_decision) ? entry.delete_decision : 'inherit';
          // Inbound projections are read-only regardless of what was submitted.
          if (allowed.get(key) === 'inbound_projection') { edit = 'inherit'; del = 'inherit'; }
          if (view === 'inherit' && edit === 'inherit' && del === 'inherit') continue;
          rows.push({
            permission_key: key,
            view_decision: view, edit_decision: edit, delete_decision: del,
            reason: trimmed(entry?.reason),
          });
        }

        // Access-control mutation: the guarded command replaces the
        // organisation-scoped override set and writes the before/after audit
        // record in one transaction. Project scopes are untouched because none
        // can exist yet.
        const { data: applied, error } = await supabase.rpc('builder_admin_set_membership_permissions', {
          _actor_user_id: adminUserId,
          _actor_type: actorType,
          _membership_id: membershipId,
          _overrides: rows,
          _reason: trimmed(body.reason),
        });
        if (error) return rpcFailure(error);

        auditRows.push({
          action: 'builder_membership_permissions_changed', entity_id: membershipId,
          metadata: { applied, rejected_keys: rejected },
        });
        return json({ applied: applied ?? 0, rejected_keys: rejected }, 200, cors);
      }

      // ------------------------------------------------------------ sessions
      case 'list_user_sessions': {
        const userId = trimmed(body.builder_user_id);
        if (!userId) return json({ error: 'builder_user_id is required' }, 400, cors);
        // token_hash is deliberately excluded: an administrator has no reason to
        // see it, and a leaked hash is a replayable credential.
        const { data, error } = await supabase.from('builder_portal_sessions')
          .select('id, created_at, last_used_at, absolute_expires_at, idle_expires_at, revoked_at, revoked_reason, device_label')
          .eq('builder_user_id', userId).order('last_used_at', { ascending: false }).limit(50);
        if (error) throw error;
        return json({ sessions: data ?? [] }, 200, cors);
      }

      case 'revoke_user_sessions': {
        // Access-control mutation: revocation and its trusted audit record
        // commit together.
        const userId = trimmed(body.builder_user_id);
        if (!userId) return json({ error: 'builder_user_id is required' }, 400, cors);
        const { data, error } = await supabase.rpc('builder_admin_revoke_user_sessions', {
          _actor_user_id: adminUserId,
          _actor_type: actorType,
          _builder_user_id: userId,
          _reason: trimmed(body.reason),
        });
        if (error) return rpcFailure(error);
        auditRows.push({ action: 'builder_sessions_revoked', entity_id: userId, metadata: { revoked: data } });
        return json({ revoked: data ?? 0 }, 200, cors);
      }

      // =====================================================================
      // Release control plane
      //
      // The Builder rollout is organisation-scoped and is the only thing that
      // opens the external portal, so every transition here is an access-control
      // mutation: it runs through a guarded database command that writes state,
      // history and trusted audit in ONE transaction.
      //
      // The browser never writes cross_portal_* directly — those tables are
      // revoked from anon and authenticated, and this function is the only
      // service-role path to them. legal-matters-admin is never called from the
      // Builder surface.
      // =====================================================================
      case 'list_builder_rollouts': {
        // Builder and shared definitions only. A Solicitor feature must not be
        // listable, let alone transitionable, from the Builder surface.
        const organisationId = trimmed(body.organisation_id);
        const [definitions, rollouts, history, approvals] = await Promise.all([
          supabase.from('cross_portal_feature_definitions')
            .select('feature_key, description, default_mode, legacy_removal_target, minimum_stable_days, portal, legacy_comparison_applicable, runtime_consumed, not_applicable_reason')
            .in('portal', ['builder', 'shared']).order('feature_key'),
          organisationId
            ? supabase.from('cross_portal_firm_rollouts')
                .select('id, feature_key, mode, reason, changed_at, changed_by, stable_since, row_version')
                .eq('portal', 'builder').eq('builder_organisation_id', organisationId)
            : Promise.resolve({ data: [], error: null }),
          organisationId
            ? supabase.from('cross_portal_rollout_history')
                .select('id, feature_key, from_mode, to_mode, reason, changed_by, changed_at')
                .eq('portal', 'builder').eq('builder_organisation_id', organisationId)
                .order('changed_at', { ascending: false }).limit(100)
            : Promise.resolve({ data: [], error: null }),
          organisationId
            ? supabase.from('cross_portal_cutover_approvals')
                .select('id, feature_key, approval_type, evidence_reference, approved_by, approved_at, revoked_at, revoked_by, revoke_reason')
                .eq('portal', 'builder').eq('builder_organisation_id', organisationId)
                .order('approved_at', { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);
        for (const result of [definitions, rollouts, history, approvals]) {
          if (result.error) throw result.error;
        }
        return json({
          definitions: definitions.data ?? [],
          rollouts: rollouts.data ?? [],
          history: history.data ?? [],
          approvals: approvals.data ?? [],
        }, 200, cors);
      }

      case 'get_builder_readiness': {
        const organisationId = trimmed(body.organisation_id);
        const featureKey = trimmed(body.feature_key);
        if (!organisationId || !featureKey) {
          return json({ error: 'organisation_id and feature_key are required' }, 400, cors);
        }
        const { data, error } = await supabase.rpc('get_builder_cutover_readiness', {
          _organisation_id: organisationId, _feature_key: featureKey,
        });
        if (error) return rpcFailure(error);
        return json({ readiness: data }, 200, cors);
      }

      case 'get_builder_operational_health': {
        const { data, error } = await supabase.rpc('get_builder_operational_health', {
          _organisation_id: trimmed(body.organisation_id),
        });
        if (error) return rpcFailure(error);
        return json({ health: data }, 200, cors);
      }

      case 'set_builder_rollout': {
        const organisationId = trimmed(body.organisation_id);
        const featureKey = trimmed(body.feature_key);
        const mode = trimmed(body.mode);
        const reason = trimmed(body.reason);
        if (!organisationId || !featureKey || !mode) {
          return json({ error: 'organisation_id, feature_key and mode are required' }, 400, cors);
        }
        if (!reason) {
          return json({ error: 'A rollout reason is required', code: 'reason_required' }, 400, cors);
        }

        // The organisation is re-read server-side. A browser-supplied id is a
        // request, not an authority.
        const organisation = await loadOrganisation(organisationId);
        if (!organisation) return json({ error: 'Organisation not found' }, 404, cors);

        // expected_version is required whenever a rollout row already exists.
        // The command enforces this too; sending it as a number here keeps the
        // 400/409 contract identical to every other mutable aggregate.
        const rawVersion = body.expected_version;
        const expectedVersion = rawVersion === undefined || rawVersion === null
          ? null : Number(rawVersion);
        if (expectedVersion !== null && !Number.isFinite(expectedVersion)) {
          return json({ error: 'expected_version must be a number' }, 400, cors);
        }

        const { data, error } = await supabase.rpc('set_cross_portal_rollout_for', {
          _portal: 'builder',
          _owner_id: organisationId,
          _feature_key: featureKey,
          _to_mode: mode,
          _reason: reason,
          _actor_id: adminUserId,
          _actor_type: actorType,
          _expected_version: expectedVersion,
        });
        if (error) return rpcFailure(error);
        auditRows.push({
          action: `builder_rollout_${mode}`, entity_id: organisationId,
          metadata: { feature_key: featureKey, mode },
        });
        return json({ rollout: data }, 200, cors);
      }

      case 'record_builder_approval': {
        const organisationId = trimmed(body.organisation_id);
        const featureKey = trimmed(body.feature_key);
        const approvalType = trimmed(body.approval_type);
        const evidence = trimmed(body.evidence_reference);
        if (!organisationId || !featureKey || !approvalType) {
          return json({ error: 'organisation_id, feature_key and approval_type are required' }, 400, cors);
        }
        if (!evidence) {
          return json({ error: 'An evidence reference is required', code: 'evidence_required' }, 400, cors);
        }
        const { data, error } = await supabase.rpc('record_cross_portal_approval_for', {
          _portal: 'builder', _owner_id: organisationId, _feature_key: featureKey,
          _approval_type: approvalType, _evidence_reference: evidence,
          _actor_id: adminUserId, _actor_type: actorType,
        });
        if (error) return rpcFailure(error);
        auditRows.push({
          action: 'builder_rollout_approval_recorded', entity_id: organisationId,
          metadata: { feature_key: featureKey, approval_type: approvalType },
        });
        return json({ approval: data }, 200, cors);
      }

      case 'revoke_builder_approval': {
        const organisationId = trimmed(body.organisation_id);
        const featureKey = trimmed(body.feature_key);
        const approvalType = trimmed(body.approval_type);
        const reason = trimmed(body.reason);
        if (!organisationId || !featureKey || !approvalType) {
          return json({ error: 'organisation_id, feature_key and approval_type are required' }, 400, cors);
        }
        if (!reason) {
          return json({ error: 'A revocation reason is required', code: 'reason_required' }, 400, cors);
        }
        const { data, error } = await supabase.rpc('revoke_cross_portal_approval_for', {
          _portal: 'builder', _owner_id: organisationId, _feature_key: featureKey,
          _approval_type: approvalType, _reason: reason,
          _actor_id: adminUserId, _actor_type: actorType,
        });
        if (error) return rpcFailure(error);
        auditRows.push({
          action: 'builder_rollout_approval_revoked', entity_id: organisationId,
          metadata: { feature_key: featureKey, approval_type: approvalType },
        });
        return json({ approval: data }, 200, cors);
      }

      default:
        return json({ error: `Unknown operation: ${operation}` }, 400, cors);
    }
  } catch (error: any) {
    console.error('[builder-portal-admin] operation failed', { operation, message: error?.message });
    return json({ error: error?.message || 'Operation failed' }, 500, cors);
  } finally {
    // Best-effort operational event, for observability only. Access-control
    // mutations already wrote a trusted, fail-closed record to
    // builder_portal_activity_log inside their own transaction, so a failure
    // here loses a metric, never the audit trail (Phase 0 NOCOPY-04).
    for (const entry of auditRows) {
      try {
        await supabase.rpc('record_portal_operational_event', {
          _event_name: 'builder_admin_command', _severity: 'info',
          _correlation_id: crypto.randomUUID(), _request_id: null,
          _actor_type: actorType, _actor_id: adminUserId, _portal: 'builder',
          _case_id: null, _matter_id: null, _firm_id: null, _duration_ms: null,
          _success: true, _metadata: entry,
        });
      } catch (auditError) {
        console.error('[builder-portal-admin] operational event failed', auditError);
      }
    }
  }
});
