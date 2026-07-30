/**
 * Legal Matters — Command Centre control plane (Solicitor Portal Phase 3)
 *
 * Staff-facing CRUD for `legal_matters`, matter parties and the bidirectional
 * Purchase File / internal Deal links. Gated deny-by-default on the
 * `solicitor_portal_admin` module permission (superadmin bypass preserved).
 *
 * Operations
 *   list_matters | get_matter | create_matter | update_matter | delete_matter
 *   set_status | link_purchase_file | unlink_purchase_file | link_deal | unlink_deal
 *   upsert_party | delete_party | list_for_deal | list_for_client | link_options
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from "../_shared/auth.ts";
import { requireModulePermission, type ModulePerm } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  MATTER_SELECT,
  PARTY_SELECT,
  LEGAL_MATTER_STATUSES,
  buildMatterPayload,
  buildPartyPayload,
  cleanEnum,
  cleanText,
} from "../_shared/legalMatters.ts";
import {
  CRITICAL_DATE_SELECT,
  SETTLEMENT_TASK_SELECT,
  LEGAL_CRITICAL_DATE_STATUSES,
  LEGAL_SETTLEMENT_TASK_STATUSES,
  buildCriticalDatePayload,
  buildSettlementTaskPayload,
  summariseRunway,
} from "../_shared/legalCriticalDates.ts";

const MODULE_KEY = 'solicitor_portal_admin';

const READ_OPS = new Set([
  'list_matters', 'get_matter', 'list_for_deal', 'list_for_client', 'link_options',
  'list_dates', 'list_runway', 'upcoming_dates',
]);
const DELETE_OPS = new Set(['delete_matter', 'delete_party', 'delete_date']);

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

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

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return json({ error: 'Authentication required' }, 401);
    const actor = { userId: auth.userId, authMethod: auth.authMethod };
    const staffUserId = auth.userId === 'service_role' ? null : auth.userId;

    const requiredPerm: ModulePerm = READ_OPS.has(operation)
      ? 'can_view'
      : DELETE_OPS.has(operation) ? 'can_delete' : 'can_edit';

    const gate = await requireModulePermission(supabase, actor, MODULE_KEY, requiredPerm);
    if (!gate.ok) {
      return createForbiddenResponse('Legal matter administration access denied', corsHeaders);
    }

    const logStaff = async (action: string, entry: Record<string, unknown> = {}) => {
      try {
        await supabase.from('solicitor_portal_activity_log').insert({
          actor_type: 'staff', actor_user_id: staffUserId, action, ...entry,
        });
      } catch (e) {
        console.error('[legal-matters-admin] activity log failed:', e);
      }
    };

    const hydrate = async (rows: any[]) => {
      const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter(Boolean)));
      const firmIds = Array.from(new Set(rows.map((r) => r.firm_id).filter(Boolean)));
      const userIds = Array.from(new Set(rows.map((r) => r.assigned_solicitor_user_id).filter(Boolean)));
      const pfIds = Array.from(new Set(rows.map((r) => r.purchase_file_id).filter(Boolean)));

      const [clients, firms, users, files] = await Promise.all([
        clientIds.length ? supabase.from('clients').select('id, primary_first_name, primary_surname').in('id', clientIds) : { data: [] },
        firmIds.length ? supabase.from('solicitor_firms').select('id, name').in('id', firmIds) : { data: [] },
        userIds.length ? supabase.from('solicitor_portal_users').select('id, name, email').in('id', userIds) : { data: [] },
        pfIds.length ? supabase.from('purchase_files').select('id, title, finance_status').in('id', pfIds) : { data: [] },
      ]);

      const cm = new Map((clients.data || []).map((c: any) => [c.id, [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ')]));
      const fm = new Map((firms.data || []).map((f: any) => [f.id, f.name]));
      const um = new Map((users.data || []).map((u: any) => [u.id, u.name || u.email]));
      const pm = new Map((files.data || []).map((p: any) => [p.id, p]));

      return rows.map((r) => ({
        ...r,
        client_name: r.client_id ? cm.get(r.client_id) ?? null : null,
        firm_name: r.firm_id ? fm.get(r.firm_id) ?? null : null,
        solicitor_name: r.assigned_solicitor_user_id ? um.get(r.assigned_solicitor_user_id) ?? null : null,
        purchase_file: r.purchase_file_id ? pm.get(r.purchase_file_id) ?? null : null,
      }));
    };

    // ───────────────────────── READS ─────────────────────────
    if (operation === 'list_matters') {
      let query = supabase.from('legal_matters').select(MATTER_SELECT)
        .order('created_at', { ascending: false }).limit(500);

      const status = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      if (status) query = query.eq('status', status);
      if (body.client_id) query = query.eq('client_id', body.client_id);
      if (body.firm_id) query = query.eq('firm_id', body.firm_id);

      const { data, error } = await query;
      if (error) throw error;

      const records = await hydrate(data || []);
      const search = cleanText(body.search, 120)?.toLowerCase();
      return json({
        success: true,
        records: search
          ? records.filter((r: any) => [r.title, r.matter_reference, r.property_address, r.client_name, r.firm_name]
              .some((v) => v && String(v).toLowerCase().includes(search)))
          : records,
      });
    }

    if (operation === 'get_matter') {
      const { data: matter } = await supabase.from('legal_matters')
        .select(MATTER_SELECT).eq('id', body.matter_id).maybeSingle();
      if (!matter) return json({ error: 'Matter not found' }, 404);

      const [{ data: parties }, { data: history }, { data: dates }, { data: tasks }] = await Promise.all([
        supabase.from('legal_matter_parties').select(PARTY_SELECT)
          .eq('legal_matter_id', matter.id).order('created_at', { ascending: true }),
        supabase.from('legal_matter_status_history')
          .select('id, from_status, to_status, changed_by_type, reason, created_at')
          .eq('legal_matter_id', matter.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('legal_matter_critical_dates').select(CRITICAL_DATE_SELECT)
          .eq('legal_matter_id', matter.id)
          .order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('legal_matter_settlement_tasks').select(SETTLEMENT_TASK_SELECT)
          .eq('legal_matter_id', matter.id).order('sequence', { ascending: true }),
      ]);

      const [hydrated] = await hydrate([matter]);
      return json({
        success: true,
        matter: hydrated,
        parties: parties || [],
        status_history: history || [],
        critical_dates: dates || [],
        settlement_tasks: tasks || [],
        runway: summariseRunway((dates || []) as any[], (tasks || []) as any[]),
      });
    }

    if (operation === 'list_for_deal' || operation === 'list_for_client') {
      const column = operation === 'list_for_deal' ? 'client_deal_id' : 'client_id';
      const value = operation === 'list_for_deal' ? body.client_deal_id : body.client_id;
      if (!value) return json({ error: `${column} is required` }, 400);
      const { data } = await supabase.from('legal_matters').select(MATTER_SELECT)
        .eq(column, value).order('created_at', { ascending: false });
      return json({ success: true, records: await hydrate(data || []) });
    }

    if (operation === 'link_options') {
      const clientId = body.client_id;
      if (!clientId) return json({ error: 'client_id is required' }, 400);
      const [{ data: files }, { data: deals }, { data: firms }, { data: users }] = await Promise.all([
        supabase.from('purchase_files')
          .select('id, title, finance_status, property_address, legal_matter_id')
          .eq('client_id', clientId).is('archived_at', null),
        supabase.from('client_deals')
          .select('id, deal_type, current_stage, property_address').eq('client_id', clientId),
        supabase.from('solicitor_firms').select('id, name').eq('is_active', true).order('name'),
        supabase.from('solicitor_portal_users')
          .select('id, name, email, firm_id').eq('is_active', true).is('revoked_at', null),
      ]);
      return json({
        success: true,
        purchase_files: files || [],
        client_deals: deals || [],
        firms: firms || [],
        solicitors: users || [],
      });
    }

    // ───────────────────────── WRITES ─────────────────────────
    if (operation === 'create_matter') {
      if (!body.client_id) return json({ error: 'A client is required' }, 400);
      const payload = buildMatterPayload(body, { isCreate: true });

      const insert: Record<string, unknown> = {
        ...payload,
        client_id: body.client_id,
        firm_id: body.firm_id ?? null,
        assigned_solicitor_user_id: body.assigned_solicitor_user_id ?? null,
        purchase_file_id: body.purchase_file_id ?? null,
        client_deal_id: body.client_deal_id ?? null,
        status: cleanEnum(body.status, LEGAL_MATTER_STATUSES, 'instructed'),
        created_by: staffUserId,
      };

      const { data, error } = await supabase.from('legal_matters')
        .insert(insert).select(MATTER_SELECT).maybeSingle();
      if (error) throw error;

      await logStaff('matter_created', {
        client_id: body.client_id, legal_matter_id: data?.id ?? null,
        firm_id: body.firm_id ?? null, entity_type: 'legal_matter', entity_id: data?.id ?? null,
      });
      return json({ success: true, matter: data });
    }

    if (operation === 'update_matter') {
      if (!body.matter_id) return json({ error: 'matter_id is required' }, 400);
      const payload = buildMatterPayload(body, { isCreate: false });
      if ('firm_id' in body) payload.firm_id = body.firm_id || null;
      if ('assigned_solicitor_user_id' in body) {
        payload.assigned_solicitor_user_id = body.assigned_solicitor_user_id || null;
      }
      if ('status' in body) {
        const s = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
        if (s) payload.status = s;
      }
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400);

      const { data, error } = await supabase.from('legal_matters')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', body.matter_id).select(MATTER_SELECT).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Matter not found' }, 404);

      await logStaff('matter_updated', {
        client_id: data.client_id, legal_matter_id: data.id,
        entity_type: 'legal_matter', entity_id: data.id,
        metadata: { fields: Object.keys(payload) },
      });
      return json({ success: true, matter: data });
    }

    if (operation === 'set_status') {
      const next = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      if (!body.matter_id || !next) return json({ error: 'matter_id and a valid status are required' }, 400);

      const patch: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
      if (next === 'settled') patch.closed_at = new Date().toISOString();
      if (!['settled', 'terminated', 'post_settlement'].includes(next)) patch.closed_at = null;

      const { data, error } = await supabase.from('legal_matters')
        .update(patch).eq('id', body.matter_id).select(MATTER_SELECT).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Matter not found' }, 404);

      const { data: latest } = await supabase.from('legal_matter_status_history')
        .select('id').eq('legal_matter_id', data.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (latest) {
        await supabase.from('legal_matter_status_history').update({
          changed_by_type: 'staff', changed_by_user_id: staffUserId,
          reason: cleanText(body.reason, 500),
        }).eq('id', latest.id);
      }

      await logStaff('matter_status_changed', {
        client_id: data.client_id, legal_matter_id: data.id,
        entity_type: 'legal_matter', entity_id: data.id, metadata: { to: next },
      });
      return json({ success: true, matter: data });
    }

    if (operation === 'link_purchase_file' || operation === 'unlink_purchase_file') {
      if (!body.matter_id) return json({ error: 'matter_id is required' }, 400);
      const link = operation === 'link_purchase_file';
      if (link && !body.purchase_file_id) return json({ error: 'purchase_file_id is required' }, 400);

      if (link) {
        const { data: pf } = await supabase.from('purchase_files')
          .select('id, client_id, legal_matter_id').eq('id', body.purchase_file_id).maybeSingle();
        if (!pf) return json({ error: 'Purchase file not found' }, 404);
        const { data: matter } = await supabase.from('legal_matters')
          .select('id, client_id').eq('id', body.matter_id).maybeSingle();
        if (!matter) return json({ error: 'Matter not found' }, 404);
        if (pf.client_id !== matter.client_id) {
          return json({ error: 'The purchase file belongs to a different client' }, 400);
        }
        if (pf.legal_matter_id && pf.legal_matter_id !== body.matter_id) {
          return json({ error: 'That purchase file is already linked to another matter' }, 409);
        }
      }

      const { data, error } = await supabase.from('legal_matters')
        .update({ purchase_file_id: link ? body.purchase_file_id : null, updated_at: new Date().toISOString() })
        .eq('id', body.matter_id).select(MATTER_SELECT).maybeSingle();
      if (error) throw error;

      await logStaff(link ? 'matter_purchase_file_linked' : 'matter_purchase_file_unlinked', {
        client_id: data?.client_id ?? null, legal_matter_id: body.matter_id,
        entity_type: 'purchase_file', entity_id: link ? body.purchase_file_id : null,
      });
      return json({ success: true, matter: data });
    }

    if (operation === 'link_deal' || operation === 'unlink_deal') {
      if (!body.matter_id) return json({ error: 'matter_id is required' }, 400);
      const link = operation === 'link_deal';
      if (link && !body.client_deal_id) return json({ error: 'client_deal_id is required' }, 400);

      const { data, error } = await supabase.from('legal_matters')
        .update({ client_deal_id: link ? body.client_deal_id : null, updated_at: new Date().toISOString() })
        .eq('id', body.matter_id).select(MATTER_SELECT).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Matter not found' }, 404);

      await logStaff(link ? 'matter_deal_linked' : 'matter_deal_unlinked', {
        client_id: data.client_id, legal_matter_id: data.id,
        entity_type: 'client_deal', entity_id: link ? body.client_deal_id : null,
      });
      return json({ success: true, matter: data });
    }

    if (operation === 'upsert_party') {
      if (!body.matter_id) return json({ error: 'matter_id is required' }, 400);
      const payload = buildPartyPayload(body);
      if (!payload.name) return json({ error: 'Party name is required' }, 400);

      let record: any;
      if (body.party_id) {
        const { data, error } = await supabase.from('legal_matter_parties')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', body.party_id).eq('legal_matter_id', body.matter_id)
          .select(PARTY_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data, error } = await supabase.from('legal_matter_parties')
          .insert({ ...payload, legal_matter_id: body.matter_id, created_by: staffUserId })
          .select(PARTY_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      }

      await logStaff(body.party_id ? 'matter_party_updated' : 'matter_party_added', {
        legal_matter_id: body.matter_id, entity_type: 'legal_matter_party',
        entity_id: record?.id ?? null,
      });
      return json({ success: true, record });
    }

    if (operation === 'delete_party') {
      if (!body.party_id) return json({ error: 'party_id is required' }, 400);
      const { error } = await supabase.from('legal_matter_parties').delete().eq('id', body.party_id);
      if (error) throw error;
      await logStaff('matter_party_removed', {
        legal_matter_id: body.matter_id ?? null, entity_type: 'legal_matter_party',
        entity_id: body.party_id,
      });
      return json({ success: true });
    }

    if (operation === 'delete_matter') {
      if (!body.matter_id) return json({ error: 'matter_id is required' }, 400);
      const { data: matter } = await supabase.from('legal_matters')
        .select('id, client_id, status').eq('id', body.matter_id).maybeSingle();
      if (!matter) return json({ error: 'Matter not found' }, 404);
      if (matter.status === 'settled') {
        return json({ error: 'Settled matters cannot be deleted — they are part of the audit record.' }, 400);
      }

      const { error } = await supabase.from('legal_matters').delete().eq('id', body.matter_id);
      if (error) throw error;

      await logStaff('matter_deleted', {
        client_id: matter.client_id, entity_type: 'legal_matter', entity_id: matter.id,
      });
      return json({ success: true });
    }

    // ─────────────── CRITICAL DATES (Phase 4) ───────────────
    const requireMatter = async (id: unknown) => {
      const { data } = await supabase.from('legal_matters')
        .select('id, client_id, settlement_date').eq('id', String(id || '')).maybeSingle();
      return data;
    };

    if (operation === 'list_dates') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const { data } = await supabase.from('legal_matter_critical_dates')
        .select(CRITICAL_DATE_SELECT).eq('legal_matter_id', matter.id)
        .order('due_date', { ascending: true, nullsFirst: false });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_date') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const isCreate = !body.date_id;
      const payload = buildCriticalDatePayload(body, { isCreate });
      if (isCreate && !payload.label) return json({ error: 'A label is required' }, 400);

      let record: any;
      if (isCreate) {
        const { data, error } = await supabase.from('legal_matter_critical_dates')
          .insert({ ...payload, legal_matter_id: matter.id, source: 'manual' })
          .select(CRITICAL_DATE_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data: existing } = await supabase.from('legal_matter_critical_dates')
          .select('id, source').eq('id', body.date_id).eq('legal_matter_id', matter.id).maybeSingle();
        if (!existing) return json({ error: 'Critical date not found' }, 404);
        if (existing.source === 'matter_field') delete (payload as any).due_date;
        const { data, error } = await supabase.from('legal_matter_critical_dates')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select(CRITICAL_DATE_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      }

      await logStaff(isCreate ? 'matter_date_added' : 'matter_date_updated', {
        client_id: matter.client_id, entity_type: 'legal_matter_critical_date',
        entity_id: record?.id ?? null,
      });
      return json({ success: true, record });
    }

    if (operation === 'set_date_status') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const status = cleanEnum(body.status, LEGAL_CRITICAL_DATE_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);

      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === 'satisfied') {
        patch.satisfied_at = new Date().toISOString();
        patch.satisfied_by_type = 'staff';
      } else {
        patch.satisfied_at = null;
        patch.satisfied_by_type = null;
      }

      const { data: record, error } = await supabase.from('legal_matter_critical_dates')
        .update(patch).eq('id', body.date_id).eq('legal_matter_id', matter.id)
        .select(CRITICAL_DATE_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Critical date not found' }, 404);

      await logStaff('matter_date_status_changed', {
        client_id: matter.client_id, entity_type: 'legal_matter_critical_date', entity_id: record.id,
      });
      return json({ success: true, record });
    }

    if (operation === 'delete_date') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const { data: existing } = await supabase.from('legal_matter_critical_dates')
        .select('id, source').eq('id', body.date_id).eq('legal_matter_id', matter.id).maybeSingle();
      if (!existing) return json({ error: 'Critical date not found' }, 404);
      if (existing.source === 'matter_field') {
        return json({ error: 'Derived contract dates follow the matter — clear the matter field instead.' }, 400);
      }
      const { error } = await supabase.from('legal_matter_critical_dates').delete().eq('id', existing.id);
      if (error) throw error;

      await logStaff('matter_date_removed', {
        client_id: matter.client_id, entity_type: 'legal_matter_critical_date', entity_id: existing.id,
      });
      return json({ success: true });
    }

    // ─────────────── SETTLEMENT RUNWAY (Phase 4) ───────────────
    if (operation === 'list_runway') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const { data } = await supabase.from('legal_matter_settlement_tasks')
        .select(SETTLEMENT_TASK_SELECT).eq('legal_matter_id', matter.id)
        .order('sequence', { ascending: true });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'seed_runway') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const { error } = await supabase.rpc('seed_legal_matter_settlement_tasks', {
        _matter_id: matter.id,
      });
      if (error) throw error;
      const { data } = await supabase.from('legal_matter_settlement_tasks')
        .select(SETTLEMENT_TASK_SELECT).eq('legal_matter_id', matter.id)
        .order('sequence', { ascending: true });

      await logStaff('matter_runway_seeded', {
        client_id: matter.client_id, entity_type: 'legal_matter', entity_id: matter.id,
      });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'update_task') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const payload = buildSettlementTaskPayload(body);
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400);

      if ('status' in payload) {
        const status = cleanEnum(payload.status, LEGAL_SETTLEMENT_TASK_STATUSES, 'not_started');
        if (status === 'complete') {
          payload.completed_at = new Date().toISOString();
          payload.completed_by_type = 'staff';
        } else {
          payload.completed_at = null;
          payload.completed_by_type = null;
        }
        if (status !== 'blocked') payload.blocked_reason = null;
      }

      const { data: record, error } = await supabase.from('legal_matter_settlement_tasks')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', body.task_id).eq('legal_matter_id', matter.id)
        .select(SETTLEMENT_TASK_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Settlement task not found' }, 404);

      await logStaff('matter_runway_task_updated', {
        client_id: matter.client_id, entity_type: 'legal_matter_settlement_task', entity_id: record.id,
      });
      return json({ success: true, record });
    }

    // ─────────────── UPCOMING DATES (portfolio-wide) ───────────────
    if (operation === 'upcoming_dates') {
      const horizonDays = Math.min(Math.max(Number(body.days) || 30, 1), 120);
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + horizonDays);

      const { data: dates } = await supabase
        .from('legal_matter_critical_dates')
        .select(CRITICAL_DATE_SELECT)
        .not('due_date', 'is', null)
        .lte('due_date', horizon.toISOString().slice(0, 10))
        .in('status', ['pending', 'at_risk', 'extended', 'missed'])
        .order('due_date', { ascending: true })
        .limit(300);

      const matterIds = Array.from(new Set((dates || []).map((d: any) => d.legal_matter_id)));
      const matterMap = new Map<string, any>();
      if (matterIds.length) {
        const { data: matters } = await supabase.from('legal_matters')
          .select('id, title, property_address, property_suburb, status, client_id, firm_id')
          .in('id', matterIds);
        for (const m of matters || []) matterMap.set(m.id, m);
      }

      return json({
        success: true,
        records: (dates || []).map((d: any) => ({ ...d, matter: matterMap.get(d.legal_matter_id) ?? null })),
      });
    }


    return json({ error: `Unknown operation: ${operation || '(none)'}` }, 400);
  } catch (error: any) {
    console.error('[legal-matters-admin] error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
