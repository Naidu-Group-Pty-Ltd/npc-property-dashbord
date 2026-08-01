/**
 * Builder Transactions Admin — Command Centre control plane
 *
 * Mirrors `builder-inventory-admin` and `builder-projects-admin` — which mirror
 * `legal-matters-admin` — for the transaction domain: staff callers are gated
 * deny-by-default on the `builder_portal_admin` module permission (superadmin
 * bypass preserved), and every mutation additionally requires CSRF validation
 * because the staff session is cookie-carried.
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a Builder Portal session cookie (ADR 018).
 *
 * Operations
 *   list_transactions | get_transaction | create_transaction | update_transaction
 *   set_status | list_parties | upsert_party | delete_party | status_history
 *   set_client | link_case | unlink_case | list_client_cases | pipeline
 *
 * Boundary invariants enforced here, not merely documented:
 *   * A project, unit, organisation, client or case id supplied by the browser
 *     is never authority; the module permission is, and every child write is
 *     scoped to a re-read parent.
 *   * Every mutation goes through a guarded database command that writes its
 *     audit row in the SAME transaction (Phase 0 NOCOPY-04).
 *   * expected_version is required on every update: missing is 400, stale 409.
 *   * `builder_invoices` and `build_progress_payments` are Finance-owned and are
 *     never read or written here.
 *   * `list_client_cases` returns case identity only — never the Legal matter's
 *     contents, the Finance file's contents or any client financial position.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  BUILDER_TRANSACTION_COMMAND_CENTRE_SELECT,
  BUILDER_TRANSACTION_PARTY_SELECT,
  BUILDER_TRANSACTION_HISTORY_SELECT,
  BUILDER_PIPELINE_STAGE_SELECT,
  BUILDER_CASE_LINK_SELECT,
  BUILDER_TRANSACTION_STATUSES,
  BUILDER_TRANSACTION_TYPES,
  buildTransactionPayload,
  buildTransactionPartyPayload,
  transactionCommandFailure,
  cleanEnum,
  cleanText,
} from '../_shared/builderTransactions.ts';

const MODULE_KEY = 'builder_portal_admin';

const READ_OPERATIONS = new Set([
  'list_transactions', 'get_transaction', 'list_parties', 'status_history',
  'list_client_cases', 'pipeline',
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

    // 1. Internal authentication. A Builder Portal cookie is not a staff session.
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

    // verifyAuth() returns the literal string 'service_role' for a verified
    // internal call. That is not a uuid (Phase 1 finding P2).
    const isServiceRoleActor = auth.userId === 'service_role';
    const adminUserId: string | null = isServiceRoleActor ? null : auth.userId;
    const actorType = isServiceRoleActor ? 'service_role' : 'command_user';

    const fail = (message: string, fallbackStatus = 400, fallbackError = 'The request failed') => {
      const mapped = transactionCommandFailure(message);
      return mapped
        ? json({ error: mapped.error, code: mapped.code }, mapped.status, cors)
        : json({ error: fallbackError }, fallbackStatus, cors);
    };

    /** Re-read a transaction. The browser's id is a lookup key, never authority. */
    const requireTransaction = async (transactionId: string | null) => {
      if (!transactionId) return null;
      const { data } = await supabase.from('builder_transactions')
        .select(BUILDER_TRANSACTION_COMMAND_CENTRE_SELECT).eq('id', transactionId).maybeSingle();
      return data ?? null;
    };

    /**
     * Read expected_version for an update. Missing is a hard 400: it is never
     * silently replaced with the current database value.
     */
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

    // ───────────────────────── TRANSACTIONS ─────────────────────────
    if (operation === 'list_transactions') {
      const page = Math.max(1, Math.floor(Number(body.page) || 1));
      const pageSize = Math.min(200, Math.max(10, Math.floor(Number(body.page_size) || 50)));
      const from = (page - 1) * pageSize;

      let query = supabase.from('builder_transactions')
        .select(BUILDER_TRANSACTION_COMMAND_CENTRE_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false });

      const projectId = cleanText(body.project_id, 64);
      if (projectId) query = query.eq('project_id', projectId);
      const organisationId = cleanText(body.organisation_id, 64);
      if (organisationId) query = query.eq('organisation_id', organisationId);
      const clientId = cleanText(body.client_id, 64);
      if (clientId) query = query.eq('client_id', clientId);
      const status = cleanEnum(body.status, BUILDER_TRANSACTION_STATUSES);
      if (status) query = query.eq('status', status);
      const search = cleanText(body.search, 120);
      if (search) {
        const escaped = search.replace(/[%_,()]/g, ' ');
        query = query.or(
          `transaction_reference.ilike.%${escaped}%,purchaser_name.ilike.%${escaped}%`);
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

    if (operation === 'get_transaction') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);

      const [{ data: parties }, { data: history }, { data: caseLink }] = await Promise.all([
        supabase.from('builder_transaction_parties').select(BUILDER_TRANSACTION_PARTY_SELECT)
          .eq('transaction_id', transaction.id).order('created_at', { ascending: true }),
        supabase.from('builder_transaction_status_history')
          .select(BUILDER_TRANSACTION_HISTORY_SELECT)
          .eq('transaction_id', transaction.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('transaction_case_links').select(BUILDER_CASE_LINK_SELECT)
          .eq('builder_transaction_id', transaction.id).maybeSingle(),
      ]);

      return json({
        success: true, transaction,
        parties: parties || [], status_history: history || [], case_link: caseLink ?? null,
      }, 200, cors);
    }

    if (operation === 'create_transaction') {
      const projectId = cleanText(body.project_id, 64);
      const organisationId = cleanText(body.organisation_id, 64);
      if (!projectId || !organisationId) {
        return json({ error: 'project_id and organisation_id are required' }, 400, cors);
      }
      // Re-read both parents. Neither id is trusted from the browser; the
      // parentage trigger re-checks the organisation against the project.
      const { data: project } = await supabase.from('builder_projects')
        .select('id, developer_organisation_id, builder_organisation_id')
        .eq('id', projectId).maybeSingle();
      if (!project) return json({ error: 'Project not found' }, 404, cors);
      const { data: organisation } = await supabase.from('builder_organisations')
        .select('id, status').eq('id', organisationId).maybeSingle();
      if (!organisation) return json({ error: 'Organisation not found' }, 404, cors);
      if (organisation.status === 'closed') return json({ error: 'Organisation is closed' }, 409, cors);

      const payload = buildTransactionPayload(body, { isCreate: true, audience: 'command_centre' });

      const { data, error } = await supabase.rpc('builder_upsert_transaction', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _transaction_id: null,
        _project_id: project.id,
        _unit_id: cleanText(body.unit_id, 64),
        _organisation_id: organisation.id,
        _payload: payload,
        _expected_version: null,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The transaction could not be created');
      return json({ success: true, transaction: data }, 200, cors);
    }

    if (operation === 'update_transaction') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const payload = buildTransactionPayload(body, { isCreate: false, audience: 'command_centre' });
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_upsert_transaction', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _transaction_id: transaction.id,
        _project_id: null,
        _unit_id: cleanText(body.unit_id, 64),
        _organisation_id: null,
        _payload: payload,
        _expected_version: version,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The transaction could not be updated');
      return json({ success: true, transaction: data }, 200, cors);
    }

    if (operation === 'set_status') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const next = cleanEnum(body.status, BUILDER_TRANSACTION_STATUSES);
      const reason = cleanText(body.reason, 1000);
      if (!next || !reason) return json({ error: 'status and reason are required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_transition_transaction', {
        _transaction_id: transaction.id,
        _expected_version: version,
        _from: transaction.status,
        _to: next,
        _reason: reason,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _actor_staff_user_id: adminUserId,
      });
      if (error) return fail(String(error.message || ''), 400, 'The status could not be changed');
      return json({ success: true, transaction: data }, 200, cors);
    }

    if (operation === 'status_history') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);
      const { data } = await supabase.from('builder_transaction_status_history')
        .select(BUILDER_TRANSACTION_HISTORY_SELECT)
        .eq('transaction_id', transaction.id).order('created_at', { ascending: false }).limit(200);
      return json({ success: true, records: data || [] }, 200, cors);
    }

    // ───────────────────────── PARTIES ─────────────────────────
    if (operation === 'list_parties') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);
      const { data } = await supabase.from('builder_transaction_parties')
        .select(BUILDER_TRANSACTION_PARTY_SELECT)
        .eq('transaction_id', transaction.id).order('created_at', { ascending: true });
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'upsert_party') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);

      const partyId = cleanText(body.party_id, 64);
      let expectedVersion: number | null = null;
      if (partyId) {
        const version = requireExpectedVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      }
      const payload = buildTransactionPartyPayload(body);
      if (!payload.name) return json({ error: 'Party name is required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_upsert_transaction_party', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _transaction_id: transaction.id,
        _party_id: partyId,
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The party could not be saved');
      return json({ success: true, record: data }, 200, cors);
    }

    if (operation === 'delete_party') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);
      const partyId = cleanText(body.party_id, 64);
      if (!partyId) return json({ error: 'party_id is required' }, 400, cors);

      const { error } = await supabase.rpc('builder_delete_transaction_party', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _transaction_id: transaction.id,
        _party_id: partyId,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The party could not be removed');
      return json({ success: true }, 200, cors);
    }

    // ───────────────────────── CLIENT AND CASE ─────────────────────────
    if (operation === 'set_client') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const { data, error } = await supabase.rpc('builder_set_transaction_client', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _transaction_id: transaction.id,
        _client_id: cleanText(body.client_id, 64),
        _expected_version: version,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The client could not be set');
      return json({ success: true, transaction: data }, 200, cors);
    }

    if (operation === 'list_client_cases') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);
      if (!transaction.client_id) return json({ success: true, records: [] }, 200, cors);

      // Case IDENTITY only. Nothing is read from the Legal matter, the Finance
      // file or the client deal that the case may also link.
      const { data, error } = await supabase.from('transaction_cases')
        .select('id, case_type, shared_lifecycle_status, property_address_normalized, opened_at')
        .eq('client_id', transaction.client_id)
        .order('opened_at', { ascending: false }).limit(50);
      if (error) throw error;
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'link_case') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);
      const caseId = cleanText(body.case_id, 64);
      if (!caseId) return json({ error: 'case_id is required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_link_transaction_to_case', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _transaction_id: transaction.id,
        _case_id: caseId,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The case could not be linked');
      return json({
        success: true,
        case_link: data
          ? { id: data.id, case_id: data.case_id, builder_transaction_id: data.builder_transaction_id,
              link_source: data.link_source, linked_at: data.linked_at }
          : null,
      }, 200, cors);
    }

    if (operation === 'unlink_case') {
      const transaction = await requireTransaction(cleanText(body.transaction_id, 64));
      if (!transaction) return json({ error: 'Transaction not found' }, 404, cors);

      const { error } = await supabase.rpc('builder_unlink_transaction_from_case', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _transaction_id: transaction.id,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The case could not be unlinked');
      return json({ success: true }, 200, cors);
    }

    // ───────────────────────── PIPELINE ─────────────────────────
    if (operation === 'pipeline') {
      const { data: stages } = await supabase.from('builder_transaction_pipeline_stages')
        .select(BUILDER_PIPELINE_STAGE_SELECT).order('stage_order', { ascending: true });

      let query = supabase.from('builder_transactions')
        .select('status').limit(5000);
      const projectId = cleanText(body.project_id, 64);
      if (projectId) query = query.eq('project_id', projectId);
      const transactionType = cleanEnum(body.transaction_type, BUILDER_TRANSACTION_TYPES);
      if (transactionType) query = query.eq('transaction_type', transactionType);
      const { data: rows, error } = await query;
      if (error) throw error;

      const stageForStatus = new Map<string, any>((stages || []).map((s: any) => [s.status, s]));
      const counts = new Map<string, any>();
      for (const stage of stages || []) {
        if (!counts.has(stage.stage_key)) {
          counts.set(stage.stage_key, {
            stage_key: stage.stage_key, stage_label: stage.stage_label,
            stage_order: stage.stage_order, is_terminal: stage.is_terminal, count: 0,
          });
        }
      }
      for (const row of rows || []) {
        const stage = stageForStatus.get(row.status);
        if (stage) counts.get(stage.stage_key).count += 1;
      }

      return json({
        success: true,
        stages: stages || [],
        columns: [...counts.values()].sort((a, b) => a.stage_order - b.stage_order),
      }, 200, cors);
    }

    return json({ error: 'Unknown operation' }, 400, cors);
  } catch (error) {
    console.error('[builder-transactions-admin]', error);
    return json({ error: 'Internal server error' }, 500, cors);
  }
});
