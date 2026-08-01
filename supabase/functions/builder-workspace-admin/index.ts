/**
 * Builder Workspace Admin — Command Centre control plane
 *
 * Mirrors `builder-collaboration-admin` for the workspace domain: staff callers
 * are gated deny-by-default on the `builder_portal_admin` module permission
 * (superadmin bypass preserved), and every mutation additionally requires CSRF
 * validation because the staff session is cookie-carried.
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a Builder Portal session cookie (ADR 018).
 *
 * The internal activity view is deliberately DIFFERENT from the portal's. Staff
 * reviewing the Builder Portal need the full audit trail — including membership,
 * permission and session administration, and the before/after states. That is
 * exactly what a portal user must never see, so the two read through different
 * paths: the portal calls `builder_visible_activity`, and this function reads
 * the log directly behind the module permission.
 *
 * Operations
 *   workspace_summary | activity_history
 *   get_organisation_settings | save_organisation_settings
 *   get_user_preferences
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  BUILDER_ORGANISATION_SETTINGS_SELECT,
  BUILDER_USER_PREFERENCES_SELECT,
  buildOrganisationSettingsPayload,
  workspaceCommandFailure,
  cleanLimit,
  cleanText,
} from '../_shared/builderWorkspace.ts';

const MODULE_KEY = 'builder_portal_admin';

/** The internal audit projection. Still explicit — never `select('*')`. */
const ADMIN_ACTIVITY_SELECT = `
  id, action, entity_type, entity_id, organisation_id, builder_user_id,
  actor_user_id, actor_type, previous_state, new_state, reason, created_at
`;

const READ_OPERATIONS = new Set([
  'workspace_summary', 'activity_history',
  'get_organisation_settings', 'get_user_preferences',
]);

function requiredPermFor(operation: string): ModulePerm {
  return READ_OPERATIONS.has(operation) ? 'can_view' : 'can_edit';
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    // 1. Internal authentication. A Builder Portal cookie is not a staff session.
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    // 2. Module permission, deny by default.
    const authz = await requireModulePermission(
      supabase, { userId: auth.userId, authMethod: auth.authMethod },
      MODULE_KEY, requiredPermFor(operation),
    );
    if (!authz.ok) {
      return createForbiddenResponse(authz.error || 'Not authorized', corsHeaders);
    }

    // verifyAuth() returns the literal string 'service_role' for a verified
    // internal call. That is not a uuid (Phase 1 finding P2).
    const isServiceRoleActor = auth.userId === 'service_role';
    const adminUserId: string | null = isServiceRoleActor ? null : auth.userId;
    const actorType = isServiceRoleActor ? 'service_role' : 'command_user';

    /**
     * Re-read the organisation the browser named. The id is a lookup key, never
     * authority — the module permission is what authorises a staff caller — but
     * the organisation must exist before anything is read or written for it.
     */
    const loadOrganisation = async (): Promise<
      { ok: true; organisationId: string } | { ok: false; status: number; error: string }
    > => {
      const organisationId = cleanText(body.organisation_id, 64);
      if (!organisationId) return { ok: false, status: 400, error: 'organisation_id is required' };
      const { data } = await supabase.from('builder_organisations')
        .select('id').eq('id', organisationId).maybeSingle();
      if (!data) return { ok: false, status: 404, error: 'Organisation not found' };
      return { ok: true, organisationId: data.id };
    };

    const fail = (message: string, fallbackStatus = 400, fallbackError = 'The request failed') => {
      const mapped = workspaceCommandFailure(message);
      return mapped
        ? json({ error: mapped.error, code: mapped.code }, mapped.status)
        : json({ error: fallbackError }, fallbackStatus);
    };

    /**
     * Read expected_version for an update. Missing is a hard 400: it is never
     * silently replaced with the current database value.
     */
    const requireVersion = (): number | { error: Response } => {
      const supplied = Number(body.expected_version);
      if (!Number.isInteger(supplied) || supplied < 1) {
        return {
          error: json({
            error: 'expected_version is required when updating an existing record',
            code: 'EXPECTED_VERSION_REQUIRED',
          }, 400),
        };
      }
      return supplied;
    };

    // ───────────────────────── DASHBOARD ─────────────────────────
    if (operation === 'workspace_summary') {
      const res = await loadOrganisation();
      if (!res.ok) return json({ error: res.error }, res.status);

      // The staff view counts what EXISTS in the organisation, which is a
      // different question from what one portal user may see. It is answered
      // from the tables directly rather than the accessible-set functions,
      // because there is no portal user to resolve against.
      const { data: projects } = await supabase.from('builder_projects')
        .select('id')
        .or(`developer_organisation_id.eq.${res.organisationId},builder_organisation_id.eq.${res.organisationId}`)
        .limit(2000);
      const projectIds = (projects || []).map((p: any) => p.id);

      if (!projectIds.length) {
        return json({
          success: true, projects: 0, units: 0, transactions: 0, construction_cases: 0,
          open_defects: 0, documents: 0, open_conversations: 0, open_tasks: 0, overdue_tasks: 0,
        });
      }

      const [{ data: units }, { data: transactions }, { data: cases }] = await Promise.all([
        supabase.from('builder_units').select('id').in('project_id', projectIds).limit(5000),
        supabase.from('builder_transactions').select('id').in('project_id', projectIds).limit(5000),
        supabase.from('builder_construction_cases').select('id').in('project_id', projectIds).limit(5000),
      ]);
      const caseIds = (cases || []).map((c: any) => c.id);

      const today = new Date().toISOString().slice(0, 10);
      const [{ data: defects }, { data: documents }, { data: conversations }, { data: tasks }] =
        await Promise.all([
          caseIds.length
            ? supabase.from('builder_defects').select('status').in('construction_case_id', caseIds).limit(5000)
            : Promise.resolve({ data: [] as any[] }),
          supabase.from('builder_documents').select('id')
            .eq('organisation_id', res.organisationId).limit(5000),
          supabase.from('builder_conversations').select('status')
            .eq('organisation_id', res.organisationId).limit(5000),
          supabase.from('builder_tasks').select('status, due_date')
            .eq('organisation_id', res.organisationId).limit(5000),
        ]);

      const openTasks = (tasks || []).filter(
        (t: any) => !['done', 'cancelled'].includes(t.status));
      return json({
        success: true,
        projects: projectIds.length,
        units: (units || []).length,
        transactions: (transactions || []).length,
        construction_cases: caseIds.length,
        open_defects: (defects || []).filter(
          (d: any) => !['closed', 'rejected', 'verified'].includes(d.status)).length,
        documents: (documents || []).length,
        open_conversations: (conversations || []).filter((c: any) => c.status === 'open').length,
        open_tasks: openTasks.length,
        overdue_tasks: openTasks.filter((t: any) => t.due_date && t.due_date < today).length,
      });
    }

    // ───────────────────────── ACTIVITY ─────────────────────────
    if (operation === 'activity_history') {
      const res = await loadOrganisation();
      if (!res.ok) return json({ error: res.error }, res.status);

      // The FULL audit trail, including identity and administration. This is the
      // internal surface; the portal reads a narrowed feed instead.
      let request = supabase.from('builder_portal_activity_log')
        .select(ADMIN_ACTIVITY_SELECT)
        .eq('organisation_id', res.organisationId)
        .order('created_at', { ascending: false })
        .limit(cleanLimit(body.limit, 100, 200));

      const entityType = cleanText(body.entity_type, 60);
      if (entityType) request = request.eq('entity_type', entityType);
      const entityId = cleanText(body.entity_id, 64);
      if (entityId) request = request.eq('entity_id', entityId);
      const action = cleanText(body.action, 120);
      if (action) request = request.eq('action', action);

      const { data, error } = await request;
      if (error) throw error;
      return json({ success: true, records: data || [] });
    }

    // ───────────────────────── ORGANISATION SETTINGS ─────────────────────────
    if (operation === 'get_organisation_settings') {
      const res = await loadOrganisation();
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('builder_organisation_settings')
        .select(BUILDER_ORGANISATION_SETTINGS_SELECT)
        .eq('organisation_id', res.organisationId).maybeSingle();
      return json({ success: true, settings: data ?? null });
    }

    if (operation === 'save_organisation_settings') {
      const res = await loadOrganisation();
      if (!res.ok) return json({ error: res.error }, res.status);

      const { data: existing } = await supabase.from('builder_organisation_settings')
        .select('id').eq('organisation_id', res.organisationId).maybeSingle();

      let expectedVersion: number | null = null;
      if (existing) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      }

      const { data, error } = await supabase.rpc('builder_upsert_organisation_settings', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _organisation_id: res.organisationId,
        _payload: buildOrganisationSettingsPayload(body),
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The settings could not be saved');
      return json({ success: true, record: data });
    }

    // ───────────────────────── USER SETTINGS ─────────────────────────
    if (operation === 'get_user_preferences') {
      // Read-only for staff. A portal user's own preferences are theirs to
      // change; there is deliberately no admin write path for them.
      const builderUserId = cleanText(body.builder_user_id, 64);
      if (!builderUserId) return json({ error: 'builder_user_id is required' }, 400);
      const { data } = await supabase.from('builder_user_preferences')
        .select(BUILDER_USER_PREFERENCES_SELECT)
        .eq('builder_user_id', builderUserId).maybeSingle();
      return json({ success: true, preferences: data ?? null });
    }

    return json({ error: 'Unknown operation' }, 400);
  } catch (error) {
    console.error('[builder-workspace-admin]', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
