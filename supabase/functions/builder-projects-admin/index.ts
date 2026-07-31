/**
 * Builder Projects Admin — Command Centre control plane (Phase 3)
 *
 * Mirrors `legal-matters-admin` for the project domain, and the matter-access
 * operations of `solicitor-portal-admin` for project access. Staff callers are
 * gated deny-by-default on the `builder_portal_admin` module permission
 * (superadmin bypass preserved), and mutations additionally require CSRF
 * validation because the staff session is cookie-carried.
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a Builder Portal session cookie (ADR 018).
 *
 * Operations
 *   Developments: list_developments | upsert_development
 *   Projects:     list_projects | get_project | create_project | update_project | set_status
 *   Access:       get_project_access | list_project_access_candidates
 *                 upsert_project_access | revoke_project_access
 *
 * Boundary invariants enforced here, not merely documented:
 *   * Organisation and project ids supplied by the browser are never authority;
 *     the module permission is, and every child write is scoped to a re-read
 *     parent.
 *   * Access grants and revocations go through the guarded database commands,
 *     which write their audit row in the SAME transaction — a failed audit
 *     rolls the access change back (Phase 0 NOCOPY-04).
 *   * `builder_invoices` and `build_progress_payments` are Finance-owned and are
 *     never read or written here.
 *   * Mutable aggregates use expected_version; a stale write returns HTTP 409.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  BUILDER_PROJECT_COMMAND_CENTRE_SELECT,
  BUILDER_DEVELOPMENT_SELECT,
  BUILDER_PARTY_SELECT,
  BUILDER_PROJECT_STATUS_HISTORY_SELECT,
  BUILDER_PROJECT_STATUSES,
  BUILDER_PROJECT_TYPES,
  BUILDER_ORGANISATION_SIDES,
  buildProjectPayload,
  buildDevelopmentPayload,
  cleanEnum,
  cleanText,
} from '../_shared/builderProjects.ts';

const MODULE_KEY = 'builder_portal_admin';
const ACCESS_ROLES = new Set(['responsible', 'team_member', 'supervisor', 'read_only']);
const DECISIONS = new Set(['inherit', 'allow', 'deny']);

const READ_OPERATIONS = new Set([
  'list_developments', 'list_projects', 'get_project',
  'get_project_access', 'list_project_access_candidates',
]);

function requiredPermFor(operation: string): ModulePerm {
  return READ_OPERATIONS.has(operation) ? 'can_view' : 'can_edit';
}

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });

/**
 * Strip anything that is not a valid tri-state decision. A caller cannot smuggle
 * an arbitrary shape into the grant's jsonb column, and the database CHECK
 * refuses it as well.
 */
function normalizeTriStateMatrix(value: unknown): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, levels] of Object.entries(value as Record<string, unknown>)) {
    if (!levels || typeof levels !== 'object' || Array.isArray(levels)) continue;
    const entry: Record<string, string> = {};
    for (const level of ['view', 'edit', 'delete'] as const) {
      const decision = (levels as Record<string, unknown>)[level];
      if (typeof decision === 'string' && DECISIONS.has(decision)) entry[level] = decision;
    }
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    // 1. Internal authentication. A Builder Portal cookie is not a staff session
    //    and cannot satisfy this. Authentication failure is 401;
    //    createForbiddenResponse() always returns 403 and is used only for the
    //    authorization failure below — the same split as builder-portal-admin.
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401, cors);
    }

    // 2. Module permission, deny by default.
    const authz = await requireModulePermission(
      supabase, { userId: auth.userId, authMethod: auth.authMethod },
      MODULE_KEY, requiredPermFor(operation),
    );
    if (!authz.ok) {
      return createForbiddenResponse(authz.error || 'Not authorized', cors);
    }

    // verifyAuth() returns the literal string 'service_role' as the identity for
    // a verified internal call. That is not a uuid, so it must never reach a
    // uuid column or a uuid RPC argument (Phase 1 finding P2).
    const isServiceRoleActor = auth.userId === 'service_role';
    const adminUserId: string | null = isServiceRoleActor ? null : auth.userId;
    const actorType = isServiceRoleActor ? 'service_role' : 'command_user';

    // ───────────────────────── DEVELOPMENTS ─────────────────────────
    if (operation === 'list_developments') {
      const organisationId = cleanText(body.developer_organisation_id, 64);
      let query = supabase.from('builder_developments')
        .select(BUILDER_DEVELOPMENT_SELECT).order('created_at', { ascending: false }).limit(500);
      if (organisationId) query = query.eq('developer_organisation_id', organisationId);
      const { data, error } = await query;
      if (error) throw error;
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'upsert_development') {
      const developmentId = cleanText(body.development_id, 64);
      const payload = buildDevelopmentPayload(body);
      const status = 'status' in body
        ? cleanEnum(body.status, ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const)
        : null;
      if ('status' in body && !status) return json({ error: 'Invalid development status' }, 400, cors);

      if (developmentId) {
        const expectedVersion = Number(body.expected_version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return json({ error: 'expected_version is required' }, 400, cors);
        }
        // Guarded command: the write and its trusted audit row share one
        // transaction, so a failed audit rolls the change back.
        const { data, error } = await supabase.rpc('builder_admin_upsert_development', {
          _actor_user_id: adminUserId,
          _actor_type: actorType,
          _development_id: developmentId,
          _developer_organisation_id: null,
          _payload: payload,
          _status: status,
          _expected_version: expectedVersion,
          _reason: cleanText(body.reason, 500),
        });
        if (error) {
          const message = String(error.message || '');
          if (message.includes('BUILDER_STALE_WRITE')) {
            return json({ error: 'This development was changed by another user', code: 'STALE_VERSION' }, 409, cors);
          }
          if (message.includes('BUILDER_DEVELOPMENT_NOT_FOUND')) {
            return json({ error: 'Development not found' }, 404, cors);
          }
          if (message.includes('BUILDER_INVALID_DEVELOPMENT_STATUS')) {
            return json({ error: 'Invalid development status' }, 400, cors);
          }
          throw error;
        }
        return json({ success: true, record: data }, 200, cors);
      }

      const organisationId = cleanText(body.developer_organisation_id, 64);
      if (!organisationId) return json({ error: 'developer_organisation_id is required' }, 400, cors);
      if (!payload.name) return json({ error: 'name is required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_admin_upsert_development', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _development_id: null,
        _developer_organisation_id: organisationId,
        _payload: payload,
        _status: status,
        _expected_version: null,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const message = String(error.message || '');
        if (message.includes('BUILDER_ORG_NOT_FOUND')) return json({ error: 'Organisation not found' }, 404, cors);
        if (message.includes('BUILDER_ORG_CLOSED')) return json({ error: 'Organisation is closed' }, 409, cors);
        throw error;
      }
      return json({ success: true, record: data }, 200, cors);
    }

    // ───────────────────────── PROJECTS ─────────────────────────
    if (operation === 'list_projects') {
      const page = Math.max(1, Math.floor(Number(body.page) || 1));
      const pageSize = Math.min(200, Math.max(10, Math.floor(Number(body.page_size) || 50)));
      const from = (page - 1) * pageSize;

      let query = supabase.from('builder_projects')
        .select(BUILDER_PROJECT_COMMAND_CENTRE_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false });

      const organisationId = cleanText(body.organisation_id, 64);
      if (organisationId) {
        query = query.or(
          `developer_organisation_id.eq.${organisationId},builder_organisation_id.eq.${organisationId}`);
      }
      const developmentId = cleanText(body.development_id, 64);
      if (developmentId) query = query.eq('development_id', developmentId);
      const status = cleanEnum(body.status, BUILDER_PROJECT_STATUSES);
      if (status) query = query.eq('status', status);
      const search = cleanText(body.search, 120);
      if (search) {
        const escaped = search.replace(/[%_,()]/g, ' ');
        query = query.or(
          `name.ilike.%${escaped}%,project_reference.ilike.%${escaped}%,address_line.ilike.%${escaped}%`);
      }

      const { data, error, count } = await query.range(from, from + pageSize - 1);
      if (error) throw error;
      return json({
        success: true,
        records: data || [],
        pagination: {
          page, page_size: pageSize, total: count || 0,
          total_pages: Math.max(1, Math.ceil((count || 0) / pageSize)),
        },
      }, 200, cors);
    }

    if (operation === 'get_project') {
      const projectId = cleanText(body.project_id, 64);
      if (!projectId) return json({ error: 'project_id is required' }, 400, cors);
      const { data: project } = await supabase.from('builder_projects')
        .select(BUILDER_PROJECT_COMMAND_CENTRE_SELECT).eq('id', projectId).maybeSingle();
      if (!project) return json({ error: 'Project not found' }, 404, cors);

      const [{ data: parties }, { data: history }, { data: access }] = await Promise.all([
        supabase.from('builder_project_parties').select(BUILDER_PARTY_SELECT)
          .eq('project_id', projectId).order('created_at', { ascending: true }),
        supabase.from('builder_project_status_history').select(BUILDER_PROJECT_STATUS_HISTORY_SELECT)
          .eq('project_id', projectId).order('created_at', { ascending: false }).limit(100),
        supabase.from('builder_project_access')
          .select(`id, builder_user_id, organisation_id, organisation_side, access_role,
                   permissions, valid_from, valid_until, granted_at, revoked_at,
                   revocation_reason, row_version`)
          .eq('project_id', projectId).order('granted_at', { ascending: false }),
      ]);

      return json({
        success: true, project,
        parties: parties || [], status_history: history || [], access: access || [],
      }, 200, cors);
    }

    if (operation === 'create_project') {
      const developerOrganisationId = cleanText(body.developer_organisation_id, 64);
      const builderOrganisationId = cleanText(body.builder_organisation_id, 64);
      if (!developerOrganisationId && !builderOrganisationId) {
        return json({ error: 'A developer or builder organisation is required' }, 400, cors);
      }
      if (developerOrganisationId && developerOrganisationId === builderOrganisationId) {
        return json({ error: 'The developer and builder organisations must differ' }, 400, cors);
      }

      // Re-read both parents. Neither id is trusted from the browser; the
      // guarded command re-checks organisation status again as a backstop.
      for (const [label, id] of [['developer', developerOrganisationId], ['builder', builderOrganisationId]] as const) {
        if (!id) continue;
        const { data: organisation } = await supabase.from('builder_organisations')
          .select('id, status').eq('id', id).maybeSingle();
        if (!organisation) return json({ error: `The ${label} organisation was not found` }, 404, cors);
        if (organisation.status === 'closed') {
          return json({ error: `The ${label} organisation is closed` }, 409, cors);
        }
      }

      const payload = buildProjectPayload(body, { isCreate: true, audience: 'command_centre' });
      payload.project_type = cleanEnum(body.project_type, BUILDER_PROJECT_TYPES, 'house_and_land');

      // Guarded command: creation and its trusted audit row share one
      // transaction, so a failed audit rolls the creation back.
      const { data, error } = await supabase.rpc('builder_upsert_project', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _project_id: null,
        _payload: payload,
        _developer_organisation_id: developerOrganisationId,
        _builder_organisation_id: builderOrganisationId,
        _development_id: cleanText(body.development_id, 64),
        _expected_version: null,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const message = String(error.message || '');
        if (message.includes('BUILDER_PROJECT_DEVELOPMENT_ORG_MISMATCH')) {
          return json({ error: 'The development belongs to a different developer organisation' }, 409, cors);
        }
        if (message.includes('BUILDER_ORG_CLOSED')) return json({ error: 'An organisation is closed' }, 409, cors);
        if (message.includes('BUILDER_ORGANISATION_REQUIRED')) {
          return json({ error: 'A developer or builder organisation is required' }, 400, cors);
        }
        throw error;
      }
      return json({ success: true, project: data }, 200, cors);
    }

    if (operation === 'update_project') {
      const projectId = cleanText(body.project_id, 64);
      const expectedVersion = Number(body.expected_version);
      if (!projectId) return json({ error: 'project_id is required' }, 400, cors);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return json({ error: 'expected_version is required' }, 400, cors);
      }
      const payload = buildProjectPayload(body, { isCreate: false, audience: 'command_centre' });
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400, cors);

      // Guarded command: the update and its trusted audit row share one
      // transaction, so a failed audit rolls the update back.
      const { data, error } = await supabase.rpc('builder_upsert_project', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _project_id: projectId,
        _payload: payload,
        _developer_organisation_id: null,
        _builder_organisation_id: null,
        _development_id: null,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const message = String(error.message || '');
        if (message.includes('BUILDER_STALE_WRITE')) {
          return json({ error: 'This project was changed by another user', code: 'STALE_VERSION' }, 409, cors);
        }
        if (message.includes('BUILDER_PROJECT_NOT_FOUND')) return json({ error: 'Project not found' }, 404, cors);
        throw error;
      }
      return json({ success: true, project: data }, 200, cors);
    }

    if (operation === 'set_status') {
      const projectId = cleanText(body.project_id, 64);
      const next = cleanEnum(body.status, BUILDER_PROJECT_STATUSES);
      const expectedVersion = Number(body.expected_version);
      const reason = cleanText(body.reason, 1000);
      if (!projectId || !next || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !reason) {
        return json({ error: 'project_id, status, expected_version and reason are required' }, 400, cors);
      }
      const { data: current } = await supabase.from('builder_projects')
        .select('id, status').eq('id', projectId).maybeSingle();
      if (!current) return json({ error: 'Project not found' }, 404, cors);

      const { data, error } = await supabase.rpc('builder_transition_project', {
        _project_id: projectId,
        _expected_version: expectedVersion,
        _from: current.status,
        _to: next,
        _reason: reason,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _actor_staff_user_id: adminUserId,
      });
      if (error) {
        const message = String(error.message || '');
        const conflict = /STALE_VERSION|STALE_STATUS|INVALID_TRANSITION/.test(message);
        return json({
          error: conflict ? 'Stale write or invalid status transition' : 'Unable to change the project status',
          code: message,
        }, conflict ? 409 : 400, cors);
      }
      return json({ success: true, project: data }, 200, cors);
    }

    // ───────────────────────── PROJECT ACCESS ─────────────────────────
    if (operation === 'get_project_access' || operation === 'list_project_access_candidates') {
      const builderUserId = cleanText(body.builder_user_id, 64);
      if (!builderUserId) return json({ error: 'builder_user_id is required' }, 400, cors);

      const { data: portalUser } = await supabase.from('builder_portal_users')
        .select('id, email, name').eq('id', builderUserId).maybeSingle();
      if (!portalUser) return json({ error: 'Builder Portal user not found' }, 404, cors);

      // Every organisation this user actually belongs to, resolved server-side.
      const { data: memberships } = await supabase.from('builder_organisation_memberships')
        .select('organisation_id').eq('builder_user_id', builderUserId)
        .eq('status', 'active').is('revoked_at', null);
      const organisationIds = (memberships || []).map((row: any) => row.organisation_id);

      if (operation === 'list_project_access_candidates') {
        if (!organisationIds.length) return json({ success: true, records: [] }, 200, cors);
        // Only projects reachable through one of the user's own organisations
        // are offerable — a grant through any other organisation is refused by
        // the database trigger anyway.
        const { data: projects } = await supabase.from('builder_projects')
          .select('id, name, project_reference, status, developer_organisation_id, builder_organisation_id')
          .or(organisationIds.map((id: string) =>
            `developer_organisation_id.eq.${id},builder_organisation_id.eq.${id}`).join(','))
          .order('created_at', { ascending: false }).limit(1000);
        const records = (projects || []).map((project: any) => ({
          ...project,
          available_sides: [
            organisationIds.includes(project.developer_organisation_id) ? 'developer' : null,
            organisationIds.includes(project.builder_organisation_id) ? 'builder' : null,
          ].filter(Boolean),
        }));
        return json({ success: true, records }, 200, cors);
      }

      const { data: grants, error } = await supabase.from('builder_project_access')
        .select(`id, project_id, organisation_id, organisation_side, access_role, permissions,
                 valid_from, valid_until, granted_at, revoked_at, revocation_reason, row_version`)
        .eq('builder_user_id', builderUserId).order('granted_at', { ascending: false });
      if (error) throw error;

      const projectIds = Array.from(new Set((grants || []).map((g: any) => g.project_id)));
      const projectMap = new Map<string, any>();
      if (projectIds.length) {
        const { data: projects } = await supabase.from('builder_projects')
          .select('id, name, project_reference, status, developer_organisation_id, builder_organisation_id')
          .in('id', projectIds);
        for (const project of projects || []) projectMap.set(project.id, project);
      }

      return json({
        success: true,
        records: (grants || []).map((grant: any) => ({
          ...grant, project: projectMap.get(grant.project_id) ?? null,
        })),
      }, 200, cors);
    }

    if (operation === 'upsert_project_access') {
      const builderUserId = cleanText(body.builder_user_id, 64);
      const projectId = cleanText(body.project_id, 64);
      const side = cleanEnum(body.organisation_side, BUILDER_ORGANISATION_SIDES);
      const accessRole = String(body.access_role || 'team_member');
      if (!builderUserId || !projectId || !side) {
        return json({ error: 'builder_user_id, project_id and organisation_side are required' }, 400, cors);
      }
      if (!ACCESS_ROLES.has(accessRole)) return json({ error: 'Invalid access_role' }, 400, cors);

      const validUntil = body.valid_until ? new Date(String(body.valid_until)) : null;
      if (validUntil && (!Number.isFinite(validUntil.getTime()) || validUntil <= new Date())) {
        return json({ error: 'valid_until must be a future timestamp' }, 400, cors);
      }

      const { data: existing } = await supabase.from('builder_project_access')
        .select('id').eq('builder_user_id', builderUserId)
        .eq('project_id', projectId).maybeSingle();

      // Updating an existing grant REQUIRES the caller's expected_version.
      // Defaulting to the current row_version would make optimistic concurrency
      // opt-in: a caller who simply omits the field would always win, silently
      // overwriting a concurrent change to an access-control record. A missing
      // version is a 400; a stale one is a 409 from the guarded command below.
      let expectedVersion: number | null = null;
      if (existing) {
        const supplied = Number(body.expected_version);
        if (!Number.isInteger(supplied) || supplied < 1) {
          return json({
            error: 'expected_version is required when updating an existing project access grant',
            code: 'EXPECTED_VERSION_REQUIRED',
          }, 400, cors);
        }
        expectedVersion = supplied;
      }

      // The guarded command re-verifies the organisation side, the membership
      // and the window, and writes its audit row in the same transaction.
      const { data, error } = await supabase.rpc('builder_admin_upsert_project_access', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _builder_user_id: builderUserId,
        _project_id: projectId,
        _organisation_side: side,
        _access_role: accessRole,
        _permissions: normalizeTriStateMatrix(body.permissions),
        _valid_until: validUntil ? validUntil.toISOString() : null,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const message = String(error.message || '');
        if (message.includes('BUILDER_STALE_WRITE')) {
          return json({ error: 'This grant was changed by another user', code: 'STALE_VERSION' }, 409, cors);
        }
        if (message.includes('BUILDER_PROJECT_NOT_FOUND')) {
          return json({ error: 'Project not found' }, 404, cors);
        }
        if (message.includes('BUILDER_PROJECT_SIDE_UNASSIGNED')) {
          return json({ error: 'That side of the project has no organisation assigned' }, 409, cors);
        }
        if (message.includes('BUILDER_PROJECT_ACCESS_NO_MEMBERSHIP')) {
          return json({ error: 'That user holds no active membership of the granting organisation' }, 409, cors);
        }
        if (message.includes('BUILDER_PROJECT_ACCESS_ORG_MISMATCH')) {
          return json({ error: 'The project does not name that organisation on the chosen side' }, 409, cors);
        }
        if (message.includes('BUILDER_INVALID')) return json({ error: 'Invalid grant' }, 400, cors);
        throw error;
      }
      return json({ success: true, record: data }, 200, cors);
    }

    if (operation === 'revoke_project_access') {
      const accessId = cleanText(body.access_id, 64);
      if (!accessId) return json({ error: 'access_id is required' }, 400, cors);
      const expectedVersion = Number(body.expected_version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return json({ error: 'expected_version is required' }, 400, cors);
      }

      const { data, error } = await supabase.rpc('builder_admin_revoke_project_access', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _access_id: accessId,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const message = String(error.message || '');
        if (message.includes('BUILDER_STALE_WRITE')) {
          return json({ error: 'This grant was changed by another user', code: 'STALE_VERSION' }, 409, cors);
        }
        if (message.includes('BUILDER_PROJECT_ACCESS_NOT_FOUND')) {
          return json({ error: 'Project access not found' }, 404, cors);
        }
        if (message.includes('BUILDER_PROJECT_ACCESS_ALREADY_REVOKED')) {
          return json({ error: 'That access was already revoked' }, 409, cors);
        }
        throw error;
      }
      return json({ success: true, record: data }, 200, cors);
    }

    return json({ error: 'Unknown operation' }, 400, cors);
  } catch (error) {
    console.error('[builder-projects-admin]', error);
    return json({ error: 'Internal server error' }, 500, cors);
  }
});
