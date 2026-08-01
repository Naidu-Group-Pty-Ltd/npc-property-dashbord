/**
 * Builder Construction Admin — Command Centre control plane
 *
 * Mirrors `builder-transactions-admin` for the construction domain: staff
 * callers are gated deny-by-default on the `builder_portal_admin` module
 * permission (superadmin bypass preserved), and every mutation additionally
 * requires CSRF validation because the staff session is cookie-carried.
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a Builder Portal session cookie (ADR 018).
 *
 * Operations
 *   list_cases | get_case | create_case | update_case | set_status | set_date
 *   list_stages | upsert_stage
 *   list_milestones | upsert_milestone | set_milestone_status
 *   list_progress | add_progress
 *   list_photographs | delete_photograph
 *   status_history | date_history
 *
 * Boundary invariants enforced here, not merely documented:
 *   * A transaction, case, stage or milestone id supplied by the browser is
 *     never authority; the module permission is, and every child write is scoped
 *     to a re-read parent.
 *   * Every mutation goes through a guarded database command that writes its
 *     audit row in the SAME transaction (Phase 0 NOCOPY-04).
 *   * expected_version is required on every update: missing is 400, stale 409.
 *   * `builder_invoices` and `build_progress_payments` are Finance-owned and are
 *     never read or written here; a milestone is a programme event, not a
 *     payment trigger.
 *   * Photograph storage paths never leave the server.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  BUILDER_CONSTRUCTION_COMMAND_CENTRE_SELECT,
  BUILDER_CONSTRUCTION_STAGE_SELECT,
  BUILDER_MILESTONE_SELECT,
  BUILDER_PROGRESS_UPDATE_SELECT,
  BUILDER_PHOTOGRAPH_SELECT,
  BUILDER_CONSTRUCTION_HISTORY_SELECT,
  BUILDER_CONSTRUCTION_DATE_HISTORY_SELECT,
  BUILDER_CONSTRUCTION_STATUSES,
  BUILDER_MILESTONE_STATUSES,
  BUILDER_CONSTRUCTION_DATE_KINDS,
  buildConstructionCasePayload,
  buildConstructionStagePayload,
  buildMilestonePayload,
  buildProgressUpdatePayload,
  constructionCommandFailure,
  cleanDate,
  cleanEnum,
  cleanText,
} from '../_shared/builderConstruction.ts';

const MODULE_KEY = 'builder_portal_admin';

const READ_OPERATIONS = new Set([
  'list_cases', 'get_case', 'list_stages', 'list_milestones',
  'list_progress', 'list_photographs', 'status_history', 'date_history',
]);

function requiredPermFor(operation: string): ModulePerm {
  return READ_OPERATIONS.has(operation) ? 'can_view' : 'can_edit';
}

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });

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

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401, cors);
    }

    const authz = await requireModulePermission(
      supabase, { userId: auth.userId, authMethod: auth.authMethod },
      MODULE_KEY, requiredPermFor(operation),
    );
    if (!authz.ok) {
      return createForbiddenResponse(authz.error || 'Not authorized', cors);
    }

    // verifyAuth() returns the literal string 'service_role' for a verified
    // internal call. That is not a uuid (Phase 1 finding P2).
    const isServiceRoleActor = auth.userId === 'service_role';
    const adminUserId: string | null = isServiceRoleActor ? null : auth.userId;
    const actorType = isServiceRoleActor ? 'service_role' : 'command_user';

    const fail = (message: string, fallbackStatus = 400, fallbackError = 'The request failed') => {
      const mapped = constructionCommandFailure(message);
      return mapped
        ? json({ error: mapped.error, code: mapped.code }, mapped.status, cors)
        : json({ error: fallbackError }, fallbackStatus, cors);
    };

    /** Re-read a case. The browser's id is a lookup key, never authority. */
    const requireCase = async (caseId: string | null) => {
      if (!caseId) return null;
      const { data } = await supabase.from('builder_construction_cases')
        .select(BUILDER_CONSTRUCTION_COMMAND_CENTRE_SELECT).eq('id', caseId).maybeSingle();
      return data ?? null;
    };

    const requireExpectedVersion = (): number | { error: Response } => {
      const supplied = Number(body.expected_version);
      if (!Number.isInteger(supplied) || supplied < 1) {
        return {
          error: json({
            error: 'expected_version is required when updating an existing record',
            code: 'EXPECTED_VERSION_REQUIRED',
          }, 400, cors),
        };
      }
      return supplied;
    };

    // ───────────────────────── CASES ─────────────────────────
    if (operation === 'list_cases') {
      const page = Math.max(1, Math.floor(Number(body.page) || 1));
      const pageSize = Math.min(200, Math.max(10, Math.floor(Number(body.page_size) || 50)));
      const from = (page - 1) * pageSize;

      let query = supabase.from('builder_construction_cases')
        .select(BUILDER_CONSTRUCTION_COMMAND_CENTRE_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false });

      const projectId = cleanText(body.project_id, 64);
      if (projectId) query = query.eq('project_id', projectId);
      const transactionId = cleanText(body.transaction_id, 64);
      if (transactionId) query = query.eq('transaction_id', transactionId);
      const status = cleanEnum(body.status, BUILDER_CONSTRUCTION_STATUSES);
      if (status) query = query.eq('status', status);

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

    if (operation === 'get_case') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);

      const [{ data: stages }, { data: milestones }, { data: updates },
        { data: photographs }, { data: history }, { data: dates }] = await Promise.all([
        supabase.from('builder_construction_stages').select(BUILDER_CONSTRUCTION_STAGE_SELECT)
          .eq('construction_case_id', record.id).order('sequence_number', { ascending: true }),
        supabase.from('builder_construction_milestones').select(BUILDER_MILESTONE_SELECT)
          .eq('construction_case_id', record.id).order('planned_date', { ascending: true, nullsFirst: false }),
        supabase.from('builder_construction_progress_updates').select(BUILDER_PROGRESS_UPDATE_SELECT)
          .eq('construction_case_id', record.id).order('update_date', { ascending: false }).limit(100),
        supabase.from('builder_construction_photographs').select(BUILDER_PHOTOGRAPH_SELECT)
          .eq('construction_case_id', record.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('builder_construction_status_history').select(BUILDER_CONSTRUCTION_HISTORY_SELECT)
          .eq('construction_case_id', record.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('builder_construction_date_history').select(BUILDER_CONSTRUCTION_DATE_HISTORY_SELECT)
          .eq('construction_case_id', record.id).order('created_at', { ascending: false }).limit(200),
      ]);

      return json({
        success: true, construction_case: record,
        stages: stages || [], milestones: milestones || [],
        progress_updates: updates || [],
        // The storage path never leaves the server.
        photographs: (photographs || []).map(({ storage_path: _p, ...rest }: any) => rest),
        status_history: history || [], date_history: dates || [],
      }, 200, cors);
    }

    if (operation === 'create_case') {
      const transactionId = cleanText(body.transaction_id, 64);
      if (!transactionId) return json({ error: 'transaction_id is required' }, 400, cors);
      // Re-read the parent. The trigger re-checks project and unit agreement.
      const { data: transaction } = await supabase.from('builder_transactions')
        .select('id, project_id, unit_id').eq('id', transactionId).maybeSingle();
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);

      const payload = buildConstructionCasePayload(body, { audience: 'command_centre' });

      const { data, error } = await supabase.rpc('builder_upsert_construction_case', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _construction_case_id: null,
        _transaction_id: transaction.id,
        _payload: payload,
        _expected_version: null,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The construction case could not be created');
      return json({ success: true, construction_case: data }, 200, cors);
    }

    if (operation === 'update_case') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const payload = buildConstructionCasePayload(body, { audience: 'command_centre' });
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_upsert_construction_case', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _construction_case_id: record.id,
        _transaction_id: null,
        _payload: payload,
        _expected_version: version,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The construction case could not be updated');
      return json({ success: true, construction_case: data }, 200, cors);
    }

    if (operation === 'set_status') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const next = cleanEnum(body.status, BUILDER_CONSTRUCTION_STATUSES);
      const reason = cleanText(body.reason, 1000);
      if (!next || !reason) return json({ error: 'status and reason are required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_transition_construction_case', {
        _construction_case_id: record.id,
        _expected_version: version,
        _from: record.status,
        _to: next,
        _reason: reason,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _actor_staff_user_id: adminUserId,
      });
      if (error) return fail(String(error.message || ''), 400, 'The status could not be changed');
      return json({ success: true, construction_case: data }, 200, cors);
    }

    if (operation === 'set_date') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const dateKind = cleanEnum(body.date_kind, BUILDER_CONSTRUCTION_DATE_KINDS);
      const reason = cleanText(body.reason, 1000);
      if (!dateKind || !reason) return json({ error: 'date_kind and reason are required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_set_construction_date', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _construction_case_id: record.id,
        _date_kind: dateKind,
        _new_date: cleanDate(body.new_date),
        _expected_version: version,
        _reason: reason,
      });
      if (error) return fail(String(error.message || ''), 400, 'The date could not be changed');
      return json({ success: true, construction_case: data }, 200, cors);
    }

    // ───────────────────────── STAGES ─────────────────────────
    if (operation === 'list_stages') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const { data } = await supabase.from('builder_construction_stages')
        .select(BUILDER_CONSTRUCTION_STAGE_SELECT)
        .eq('construction_case_id', record.id).order('sequence_number', { ascending: true });
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'upsert_stage') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);

      const stageId = cleanText(body.stage_id, 64);
      let expectedVersion: number | null = null;
      if (stageId) {
        const version = requireExpectedVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      }
      const payload = buildConstructionStagePayload(body);
      if (!stageId && !payload.name) return json({ error: 'A stage name is required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_upsert_construction_stage', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _stage_id: stageId,
        _construction_case_id: stageId ? null : record.id,
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The stage could not be saved');
      return json({ success: true, record: data }, 200, cors);
    }

    // ───────────────────────── MILESTONES ─────────────────────────
    if (operation === 'list_milestones') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const { data } = await supabase.from('builder_construction_milestones')
        .select(BUILDER_MILESTONE_SELECT)
        .eq('construction_case_id', record.id)
        .order('planned_date', { ascending: true, nullsFirst: false });
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'upsert_milestone') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);

      const milestoneId = cleanText(body.milestone_id, 64);
      let expectedVersion: number | null = null;
      if (milestoneId) {
        const version = requireExpectedVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      }
      const payload = buildMilestonePayload(body);
      if (!milestoneId && !payload.name) {
        return json({ error: 'A milestone name is required' }, 400, cors);
      }

      const { data, error } = await supabase.rpc('builder_upsert_milestone', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _milestone_id: milestoneId,
        _construction_case_id: milestoneId ? null : record.id,
        _construction_stage_id: cleanText(body.construction_stage_id, 64),
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The milestone could not be saved');
      return json({ success: true, record: data }, 200, cors);
    }

    if (operation === 'set_milestone_status') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const milestoneId = cleanText(body.milestone_id, 64);
      if (!milestoneId) return json({ error: 'milestone_id is required' }, 400, cors);
      const { data: milestone } = await supabase.from('builder_construction_milestones')
        .select('id, status').eq('id', milestoneId)
        .eq('construction_case_id', record.id).maybeSingle();
      if (!milestone) return json({ error: 'Milestone not found' }, 404, cors);

      const next = cleanEnum(body.status, BUILDER_MILESTONE_STATUSES);
      const reason = cleanText(body.reason, 1000);
      if (!next || !reason) return json({ error: 'status and reason are required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_transition_milestone', {
        _milestone_id: milestone.id,
        _expected_version: version,
        _from: milestone.status,
        _to: next,
        _reason: reason,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _actor_staff_user_id: adminUserId,
      });
      if (error) return fail(String(error.message || ''), 400, 'The milestone could not be changed');
      return json({ success: true, milestone: data }, 200, cors);
    }

    // ───────────────────────── PROGRESS AND PHOTOGRAPHS ─────────────────────────
    if (operation === 'list_progress') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const { data } = await supabase.from('builder_construction_progress_updates')
        .select(BUILDER_PROGRESS_UPDATE_SELECT)
        .eq('construction_case_id', record.id)
        .order('update_date', { ascending: false }).limit(200);
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'add_progress') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const payload = buildProgressUpdatePayload(body);
      if (!payload.title) return json({ error: 'A title is required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_add_progress_update', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _construction_case_id: record.id,
        _construction_stage_id: cleanText(body.construction_stage_id, 64),
        _payload: payload,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The update could not be added');
      return json({ success: true, record: data }, 200, cors);
    }

    if (operation === 'list_photographs') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const { data } = await supabase.from('builder_construction_photographs')
        .select(BUILDER_PHOTOGRAPH_SELECT)
        .eq('construction_case_id', record.id)
        .order('created_at', { ascending: false }).limit(200);
      return json({
        success: true,
        records: (data || []).map(({ storage_path: _p, ...rest }: any) => rest),
      }, 200, cors);
    }

    if (operation === 'delete_photograph') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      const photographId = cleanText(body.photograph_id, 64);
      if (!photographId) return json({ error: 'photograph_id is required' }, 400, cors);

      const { error } = await supabase.rpc('builder_delete_construction_photograph', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _construction_case_id: record.id,
        _photograph_id: photographId,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The photograph could not be removed');
      return json({ success: true }, 200, cors);
    }

    // ───────────────────────── HISTORY ─────────────────────────
    if (operation === 'status_history' || operation === 'date_history') {
      const record = await requireCase(cleanText(body.construction_case_id, 64));
      if (!record) return json({ error: 'Construction case not found' }, 404, cors);
      // Written out per table rather than through a computed table name: the
      // generated Supabase types cannot resolve a union of table names.
      const rows = operation === 'status_history'
        ? await supabase.from('builder_construction_status_history')
          .select(BUILDER_CONSTRUCTION_HISTORY_SELECT)
          .eq('construction_case_id', record.id)
          .order('created_at', { ascending: false }).limit(500)
        : await supabase.from('builder_construction_date_history')
          .select(BUILDER_CONSTRUCTION_DATE_HISTORY_SELECT)
          .eq('construction_case_id', record.id)
          .order('created_at', { ascending: false }).limit(500);
      if (rows.error) throw rows.error;
      return json({ success: true, records: rows.data || [] }, 200, cors);
    }

    return json({ error: 'Unknown operation' }, 400, cors);
  } catch (error) {
    console.error('[builder-construction-admin]', error);
    return json({ error: 'Internal server error' }, 500, cors);
  }
});
