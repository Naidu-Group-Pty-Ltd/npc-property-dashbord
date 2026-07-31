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
  const auth = await verifyAuth(supabase, req.headers, body);
  if (auth.error || !auth.userId) {
    return createForbiddenResponse(auth.error || 'Authentication required', cors, 401);
  }

  // 2. CSRF on every mutation — the staff session is cookie-carried.
  if (!READ_OPERATIONS.has(operation)) {
    const csrf = enforceCsrf(req);
    if (!csrf.ok) return csrfDenied(csrf, cors);
  }

  // 3. Deny-by-default module permission. A missing module registration or a
  //    missing permission row denies.
  const authz = await requireModulePermission(
    supabase, { userId: auth.userId, authMethod: auth.authMethod },
    MODULE_KEY, requiredPermFor(operation),
  );
  if (!authz.ok) {
    return createForbiddenResponse(authz.error || 'Not authorized', cors, 403);
  }

  const actorId = auth.userId;

  /** Re-read a parent server-side. A browser-supplied id is a request, not an authority. */
  const loadOrganisation = async (organisationId: string | null) => {
    if (!organisationId) return null;
    const { data } = await supabase
      .from('builder_organisations').select('id, status, row_version')
      .eq('id', organisationId).maybeSingle();
    return data ?? null;
  };

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
          updated_by: actorId,
        };

        const organisationId = trimmed(body.organisation_id);
        if (!organisationId) {
          // Creation always starts pending_activation. Status is a separate,
          // audited transition — never a field on the create form.
          const { data, error } = await supabase.from('builder_organisations')
            .insert({ ...payload, status: 'pending_activation', is_active: false, created_by: actorId })
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
        const organisationId = trimmed(body.organisation_id);
        const status = trimmed(body.status);
        if (!organisationId) return json({ error: 'organisation_id is required' }, 400, cors);
        if (!status || !ORG_STATUSES.has(status)) {
          return json({ error: 'Unknown organisation status' }, 400, cors);
        }
        const existing = await loadOrganisation(organisationId);
        if (!existing) return json({ error: 'Organisation not found' }, 404, cors);

        const expectedVersion = Number(body.expected_version);
        if (!Number.isFinite(expectedVersion) || existing.row_version !== expectedVersion) {
          return json({
            error: 'This organisation changed since you loaded it. Reload and try again.',
            code: 'stale_write', current_version: existing.row_version,
          }, 409, cors);
        }

        const now = new Date().toISOString();
        const patch: Record<string, unknown> = {
          status,
          is_active: status === 'active',
          updated_by: actorId,
          activated_at: status === 'active' ? now : null,
          suspended_at: status === 'suspended' ? now : null,
          suspension_reason: status === 'suspended' ? trimmed(body.reason) : null,
        };

        const { data, error } = await supabase.from('builder_organisations')
          .update(patch).eq('id', organisationId).eq('row_version', expectedVersion)
          .select(ORG_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Concurrent update detected', code: 'stale_write' }, 409, cors);

        // Deactivating an organisation must not leave usable sessions behind.
        // The database revokes on membership loss; this covers the org-level
        // transition, which membership rows do not observe.
        if (status !== 'active') {
          const { data: members } = await supabase
            .from('builder_organisation_memberships').select('builder_user_id')
            .eq('organisation_id', organisationId).is('revoked_at', null);
          for (const member of members ?? []) {
            await supabase.rpc('builder_revoke_user_sessions', {
              _user_id: member.builder_user_id, _reason: `organisation_${status}`, _except_session_id: null,
            });
          }
        }

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
          invited_by: actorId, invited_at: new Date().toISOString(),
          created_by: actorId,
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
          updated_by: actorId,
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

        const now = new Date().toISOString();
        const { data, error } = await supabase.from('builder_portal_users').update({
          status,
          is_active: status === 'active',
          revoked_at: status === 'revoked' ? now : null,
          revoked_reason: status === 'revoked' ? (trimmed(body.reason) ?? 'revoked by administrator') : null,
          updated_by: actorId,
        }).eq('id', userId).eq('row_version', expectedVersion).select(USER_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Concurrent update detected', code: 'stale_write' }, 409, cors);

        // The database revokes sessions on deactivation; this is belt and braces
        // for the invited -> suspended path, which the trigger does not cover.
        if (status !== 'active') {
          await supabase.rpc('builder_revoke_user_sessions', {
            _user_id: userId, _reason: `user_${status}`, _except_session_id: null,
          });
        }
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

        if (existing) {
          const expectedVersion = Number(body.expected_version);
          if (!Number.isFinite(expectedVersion) || existing.row_version !== expectedVersion) {
            return json({
              error: 'This membership changed since you loaded it. Reload and try again.',
              code: 'stale_write', current_version: existing.row_version,
            }, 409, cors);
          }
          const { data, error } = await supabase.from('builder_organisation_memberships')
            .update({ membership_role: role, is_primary: body.is_primary === true })
            .eq('id', existing.id).eq('row_version', expectedVersion)
            .select(MEMBERSHIP_SELECT).maybeSingle();
          if (error) throw error;
          if (!data) return json({ error: 'Concurrent update detected', code: 'stale_write' }, 409, cors);
          auditRows.push({ action: 'builder_membership_updated', entity_id: existing.id });
          return json({ membership: data }, 200, cors);
        }

        const { data, error } = await supabase.from('builder_organisation_memberships').insert({
          builder_user_id: userId, organisation_id: organisationId,
          membership_role: role, is_primary: body.is_primary === true,
          status: 'active', granted_by: actorId,
        }).select(MEMBERSHIP_SELECT).single();
        if (error) {
          if ((error as any).code === '23505') {
            return json({ error: 'A live membership already exists', code: 'duplicate_membership' }, 409, cors);
          }
          throw error;
        }
        auditRows.push({ action: 'builder_membership_granted', entity_id: data.id });
        return json({ membership: data }, 200, cors);
      }

      case 'revoke_membership': {
        const membershipId = trimmed(body.membership_id);
        if (!membershipId) return json({ error: 'membership_id is required' }, 400, cors);

        const { data, error } = await supabase.from('builder_organisation_memberships')
          .update({
            status: 'revoked', revoked_at: new Date().toISOString(),
            revoked_reason: trimmed(body.reason) ?? 'revoked by administrator',
          })
          .eq('id', membershipId).is('revoked_at', null)
          .select(MEMBERSHIP_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Membership not found or already revoked' }, 409, cors);
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
            membership_id: membershipId, permission_key: key, scope_type: 'organisation',
            view_decision: view, edit_decision: edit, delete_decision: del,
            reason: trimmed(entry?.reason), granted_by: actorId,
          });
        }

        // Replace the organisation-scoped override set atomically enough for an
        // administrative surface: delete then insert, both scoped to this
        // membership. Project scopes are untouched because none can exist yet.
        const { error: delErr } = await supabase.from('builder_membership_permissions')
          .delete().eq('membership_id', membershipId).eq('scope_type', 'organisation');
        if (delErr) throw delErr;
        if (rows.length) {
          const { error: insErr } = await supabase.from('builder_membership_permissions').insert(rows);
          if (insErr) throw insErr;
        }

        auditRows.push({
          action: 'builder_membership_permissions_updated', entity_id: membershipId,
          metadata: { applied: rows.length, rejected_keys: rejected },
        });
        return json({ applied: rows.length, rejected_keys: rejected }, 200, cors);
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
        const userId = trimmed(body.builder_user_id);
        if (!userId) return json({ error: 'builder_user_id is required' }, 400, cors);
        const { data, error } = await supabase.rpc('builder_revoke_user_sessions', {
          _user_id: userId,
          _reason: trimmed(body.reason) ?? 'revoked by administrator',
          _except_session_id: null,
        });
        if (error) throw error;
        auditRows.push({ action: 'builder_sessions_revoked', entity_id: userId, metadata: { revoked: data } });
        return json({ revoked: data ?? 0 }, 200, cors);
      }

      default:
        return json({ error: `Unknown operation: ${operation}` }, 400, cors);
    }
  } catch (error: any) {
    console.error('[builder-portal-admin] operation failed', { operation, message: error?.message });
    return json({ error: error?.message || 'Operation failed' }, 500, cors);
  } finally {
    // Best-effort activity trail. Phase 2 introduces the trusted, fail-closed
    // Builder audit record for high-risk mutations (Phase 0 finding NOCOPY-04);
    // Phase 1 has no such mutation, so this remains observational.
    for (const entry of auditRows) {
      try {
        await supabase.rpc('record_portal_operational_event', {
          _event_name: 'builder_admin_command', _severity: 'info',
          _correlation_id: crypto.randomUUID(), _request_id: null,
          _actor_type: 'command_user', _actor_id: actorId, _portal: 'builder',
          _case_id: null, _matter_id: null, _firm_id: null, _duration_ms: null,
          _success: true, _metadata: entry,
        });
      } catch (auditError) {
        console.error('[builder-portal-admin] operational event failed', auditError);
      }
    }
  }
});
