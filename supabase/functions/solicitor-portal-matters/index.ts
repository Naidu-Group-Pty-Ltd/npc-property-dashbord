/**
 * Solicitor Portal — Matters (Phase 3)
 *
 * Portal-facing matter workspace. Every operation is scoped by the caller's
 * session, their client assignments AND their firm, then gated on the merged
 * permission matrix. Financial-position and AML-restricted data is never
 * selected here — tri-portal separation is enforced by the shared whitelists.
 *
 * Operations
 *   list_matters | get_matter | update_matter | set_status
 *   list_parties | upsert_party | delete_party
 *   status_history | matter_stats
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders } from "../_shared/auth.ts";
import {
  resolveSolicitorSession,
  resolveClientPermissions,
  listAssignedClientIds,
  logSolicitorActivity,
  requestIp,
  can,
  type PermissionMatrix,
} from "../_shared/solicitorPortalAuth.ts";
import {
  MATTER_SELECT,
  SOLICITOR_MATTER_LIST_SELECT,
  PARTY_SELECT,
  LEGAL_MATTER_STATUSES,
  buildMatterPayload,
  buildPartyPayload,
  cleanEnum,
  cleanText,
  TERMINAL_STATUSES,
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

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (!session.ok || !session.user) {
      return json({ error: session.error || 'Unauthorised' }, session.status || 401);
    }
    const me = session.user;
    const ip = requestIp(req);
    const userAgent = req.headers.get('user-agent');

    const assignedClientIds = await listAssignedClientIds(supabase, me.id);
    if (!assignedClientIds.length && operation !== 'matter_stats') {
      if (operation === 'list_matters') return json({ success: true, records: [] });
    }

    /** Assigned clients for which the merged permission matrix allows matter visibility. */
    const listViewableClientIds = async (): Promise<string[]> => {
      const permissions = await Promise.all(
        assignedClientIds.map(async (clientId) => ({
          clientId,
          matrix: await resolveClientPermissions(supabase, me.id, clientId),
        })),
      );
      return permissions
        .filter(({ matrix }) => can(matrix, 'matters', 'view'))
        .map(({ clientId }) => clientId);
    };

    /** Load a matter and confirm this solicitor may see it. */
    const loadMatter = async (matterId: string): Promise<
      { ok: true; matter: any; perms: PermissionMatrix } | { ok: false; status: number; error: string }
    > => {
      if (!matterId) return { ok: false, status: 400, error: 'matter_id is required' };
      const { data: matter } = await supabase
        .from('legal_matters')
        .select(MATTER_SELECT)
        .eq('id', matterId)
        .maybeSingle();
      if (!matter) return { ok: false, status: 404, error: 'Matter not found' };
      if (matter.firm_id && matter.firm_id !== me.firm_id) {
        return { ok: false, status: 403, error: 'This matter belongs to another practice' };
      }
      if (!matter.client_id || !assignedClientIds.includes(matter.client_id)) {
        return { ok: false, status: 403, error: 'You do not have access to this matter' };
      }
      const perms = await resolveClientPermissions(supabase, me.id, matter.client_id);
      if (!perms || !can(perms, 'matters', 'view')) {
        return { ok: false, status: 403, error: 'You do not have access to this matter' };
      }
      return { ok: true, matter, perms };
    };

    // ───────────────────────── LIST ─────────────────────────
    if (operation === 'list_matters') {
      const viewableClientIds = await listViewableClientIds();
      if (!viewableClientIds.length) return json({ success: true, records: [] });

      let query = supabase
        .from('legal_matters')
        .select(SOLICITOR_MATTER_LIST_SELECT)
        .in('client_id', viewableClientIds)
        .or(`firm_id.is.null,firm_id.eq.${me.firm_id}`)
        .order('settlement_date', { ascending: true, nullsFirst: false })
        .limit(500);

      const status = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      if (status) query = query.eq('status', status);
      if (body.mine_only === true) query = query.eq('assigned_solicitor_user_id', me.id);

      const { data, error } = await query;
      if (error) throw error;

      const rows = data || [];
      const clientIds = Array.from(new Set(rows.map((r: any) => r.client_id).filter(Boolean)));
      const clientMap = new Map<string, string>();
      if (clientIds.length) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname')
          .in('id', clientIds);
        for (const c of clients || []) {
          clientMap.set(c.id, [c.primary_first_name, c.primary_surname].filter(Boolean).join(' '));
        }
      }

      const search = cleanText(body.search, 120)?.toLowerCase();
      const records = rows
        .map((r: any) => ({ ...r, client_name: clientMap.get(r.client_id) ?? null }))
        .filter((r: any) => !search
          || [r.title, r.matter_reference, r.property_address, r.property_suburb, r.client_name]
            .some((v) => v && String(v).toLowerCase().includes(search)));

      return json({ success: true, records });
    }

    // ───────────────────────── DETAIL ─────────────────────────
    if (operation === 'get_matter') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;

      const [{ data: parties }, { data: history }, { data: client }] = await Promise.all([
        can(perms, 'parties', 'view')
          ? supabase.from('legal_matter_parties').select(PARTY_SELECT)
              .eq('legal_matter_id', matter.id).order('created_at', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('legal_matter_status_history')
          .select('id, from_status, to_status, changed_by_type, reason, created_at')
          .eq('legal_matter_id', matter.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('clients').select('id, primary_first_name, primary_surname, primary_email, primary_mobile').eq('id', matter.client_id).maybeSingle(),
      ]);

      // Finance clause visibility only — never the client's financial position.
      let finance_snapshot: Record<string, unknown> | null = null;
      if (matter.purchase_file_id && can(perms, 'finance_status', 'view')) {
        const { data: pf } = await supabase
          .from('purchase_files')
          .select('id, title, finance_status, finance_clause_date, settlement_date, lender')
          .eq('id', matter.purchase_file_id)
          .maybeSingle();
        if (pf) finance_snapshot = pf;
      }

      // Phase 4 — typed critical dates + settlement runway.
      const canDates = can(perms, 'critical_dates', 'view');
      const canRunway = can(perms, 'settlement', 'view');
      const [{ data: criticalDates }, { data: runwayTasks }] = await Promise.all([
        canDates
          ? supabase.from('legal_matter_critical_dates').select(CRITICAL_DATE_SELECT)
              .eq('legal_matter_id', matter.id)
              .order('due_date', { ascending: true, nullsFirst: false })
          : Promise.resolve({ data: [] as any[] }),
        canRunway
          ? supabase.from('legal_matter_settlement_tasks').select(SETTLEMENT_TASK_SELECT)
              .eq('legal_matter_id', matter.id).order('sequence', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
      ]);


      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_viewed',
        client_id: matter.client_id, legal_matter_id: matter.id,
        entity_type: 'legal_matter', entity_id: matter.id, ip_address: ip, user_agent: userAgent,
      });

      return json({
        success: true,
        matter: {
          ...matter,
          client_name: client
            ? [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ')
            : null,
        },
        client: client ?? null,
        parties: parties || [],
        status_history: history || [],
        finance_snapshot,
        critical_dates: criticalDates || [],
        settlement_tasks: runwayTasks || [],
        runway: summariseRunway(
          (criticalDates || []) as any[],
          (runwayTasks || []) as any[],
        ),
        permissions: perms,
      });
    }

    // ───────────────────────── UPDATE ─────────────────────────
    if (operation === 'update_matter') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;
      if (!can(perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to edit this matter' }, 403);
      }

      const payload = buildMatterPayload(body, { isCreate: false });
      delete (payload as any).matter_reference; // reference is Command Centre owned
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400);

      const { data: updated, error } = await supabase
        .from('legal_matters')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', matter.id)
        .select(MATTER_SELECT)
        .maybeSingle();
      if (error) throw error;

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_updated',
        client_id: matter.client_id, legal_matter_id: matter.id,
        entity_type: 'legal_matter', entity_id: matter.id,
        metadata: { fields: Object.keys(payload) }, ip_address: ip, user_agent: userAgent,
      });

      return json({ success: true, matter: updated });
    }

    // ───────────────────────── STATUS ─────────────────────────
    if (operation === 'set_status') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;
      if (!can(perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to change this matter' }, 403);
      }

      const next = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      if (!next) return json({ error: 'A valid status is required' }, 400);
      if (next === matter.status) return json({ success: true, matter });
      if (TERMINAL_STATUSES.has(matter.status)) {
        return json({ error: 'This matter is closed. Contact NPC to reopen it.' }, 400);
      }

      const patch: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
      if (next === 'settled') {
        patch.actual_settlement_date = matter.actual_settlement_date
          || new Date().toISOString().slice(0, 10);
        patch.closed_at = new Date().toISOString();
      }

      const { data: updated, error } = await supabase
        .from('legal_matters').update(patch).eq('id', matter.id)
        .select(MATTER_SELECT).maybeSingle();
      if (error) throw error;

      // Attribute the change the DB trigger just recorded.
      const { data: latest } = await supabase
        .from('legal_matter_status_history')
        .select('id').eq('legal_matter_id', matter.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (latest) {
        await supabase.from('legal_matter_status_history').update({
          changed_by_type: 'solicitor_user',
          changed_by_solicitor_user_id: me.id,
          reason: cleanText(body.reason, 500),
        }).eq('id', latest.id);
      }

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_status_changed',
        client_id: matter.client_id, legal_matter_id: matter.id,
        entity_type: 'legal_matter', entity_id: matter.id,
        metadata: { from: matter.status, to: next }, visible_to_client: true,
        ip_address: ip, user_agent: userAgent,
      });

      return json({ success: true, matter: updated });
    }

    // ───────────────────────── PARTIES ─────────────────────────
    if (operation === 'list_parties') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'parties', 'view')) return json({ error: 'Access denied' }, 403);
      const { data } = await supabase.from('legal_matter_parties').select(PARTY_SELECT)
        .eq('legal_matter_id', res.matter.id).order('created_at', { ascending: true });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_party') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'parties', 'edit')) {
        return json({ error: 'You do not have permission to manage parties' }, 403);
      }
      const payload = buildPartyPayload(body);
      if (!payload.name) return json({ error: 'Party name is required' }, 400);

      let record: any;
      if (body.party_id) {
        const { data, error } = await supabase.from('legal_matter_parties')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', body.party_id).eq('legal_matter_id', res.matter.id)
          .select(PARTY_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Party not found' }, 404);
        record = data;
      } else {
        const { data, error } = await supabase.from('legal_matter_parties')
          .insert({ ...payload, legal_matter_id: res.matter.id })
          .select(PARTY_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      }

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id,
        action: body.party_id ? 'matter_party_updated' : 'matter_party_added',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_party', entity_id: record?.id ?? null,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, record });
    }

    if (operation === 'delete_party') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'parties', 'delete')) {
        return json({ error: 'You do not have permission to remove parties' }, 403);
      }
      const { error } = await supabase.from('legal_matter_parties')
        .delete().eq('id', body.party_id).eq('legal_matter_id', res.matter.id);
      if (error) throw error;

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_party_removed',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_party', entity_id: body.party_id ?? null,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true });
    }

    if (operation === 'status_history') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('legal_matter_status_history')
        .select('id, from_status, to_status, changed_by_type, reason, created_at')
        .eq('legal_matter_id', res.matter.id).order('created_at', { ascending: false }).limit(100);
      return json({ success: true, records: data || [] });
    }

    // ─────────────── CRITICAL DATES (Phase 4) ───────────────
    if (operation === 'list_dates') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'critical_dates', 'view')) return json({ error: 'Access denied' }, 403);
      const { data } = await supabase.from('legal_matter_critical_dates')
        .select(CRITICAL_DATE_SELECT).eq('legal_matter_id', res.matter.id)
        .order('due_date', { ascending: true, nullsFirst: false });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_date') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'critical_dates', 'edit')) {
        return json({ error: 'You do not have permission to manage critical dates' }, 403);
      }
      const isCreate = !body.date_id;
      const payload = buildCriticalDatePayload(body, { isCreate });
      if (isCreate && !payload.label) return json({ error: 'A label is required' }, 400);

      let record: any;
      if (isCreate) {
        const { data, error } = await supabase.from('legal_matter_critical_dates')
          .insert({ ...payload, legal_matter_id: res.matter.id, source: 'manual' })
          .select(CRITICAL_DATE_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data: existing } = await supabase.from('legal_matter_critical_dates')
          .select('id, source, due_date').eq('id', body.date_id)
          .eq('legal_matter_id', res.matter.id).maybeSingle();
        if (!existing) return json({ error: 'Critical date not found' }, 404);
        // Derived rows are owned by the matter fields — the date itself is read-only.
        if (existing.source === 'matter_field') delete (payload as any).due_date;
        const { data, error } = await supabase.from('legal_matter_critical_dates')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select(CRITICAL_DATE_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      }

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id,
        action: isCreate ? 'matter_date_added' : 'matter_date_updated',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_critical_date', entity_id: record?.id ?? null,
        metadata: { label: record?.label ?? null, due_date: record?.due_date ?? null },
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, record });
    }

    if (operation === 'set_date_status') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'critical_dates', 'edit')) {
        return json({ error: 'You do not have permission to manage critical dates' }, 403);
      }
      const status = cleanEnum(body.status, LEGAL_CRITICAL_DATE_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);

      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === 'satisfied') {
        patch.satisfied_at = new Date().toISOString();
        patch.satisfied_by_type = 'solicitor_user';
        patch.satisfied_by_solicitor_user_id = me.id;
      } else {
        patch.satisfied_at = null;
        patch.satisfied_by_type = null;
        patch.satisfied_by_solicitor_user_id = null;
      }

      const { data: record, error } = await supabase.from('legal_matter_critical_dates')
        .update(patch).eq('id', body.date_id).eq('legal_matter_id', res.matter.id)
        .select(CRITICAL_DATE_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Critical date not found' }, 404);

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_date_status_changed',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_critical_date', entity_id: record.id,
        metadata: { status, label: record.label }, visible_to_client: !!record.visible_to_client,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, record });
    }

    if (operation === 'delete_date') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'critical_dates', 'delete')) {
        return json({ error: 'You do not have permission to remove critical dates' }, 403);
      }
      const { data: existing } = await supabase.from('legal_matter_critical_dates')
        .select('id, source').eq('id', body.date_id)
        .eq('legal_matter_id', res.matter.id).maybeSingle();
      if (!existing) return json({ error: 'Critical date not found' }, 404);
      if (existing.source === 'matter_field') {
        return json({ error: 'Contract dates are derived from the matter — clear the date on the matter instead.' }, 400);
      }
      const { error } = await supabase.from('legal_matter_critical_dates')
        .delete().eq('id', existing.id);
      if (error) throw error;

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_date_removed',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_critical_date', entity_id: existing.id,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true });
    }

    // ─────────────── SETTLEMENT RUNWAY (Phase 4) ───────────────
    if (operation === 'list_runway') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'settlement', 'view')) return json({ error: 'Access denied' }, 403);
      const { data } = await supabase.from('legal_matter_settlement_tasks')
        .select(SETTLEMENT_TASK_SELECT).eq('legal_matter_id', res.matter.id)
        .order('sequence', { ascending: true });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'seed_runway') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'settlement', 'edit')) {
        return json({ error: 'You do not have permission to manage the settlement runway' }, 403);
      }
      const { error } = await supabase.rpc('seed_legal_matter_settlement_tasks', {
        _matter_id: res.matter.id,
      });
      if (error) throw error;
      const { data } = await supabase.from('legal_matter_settlement_tasks')
        .select(SETTLEMENT_TASK_SELECT).eq('legal_matter_id', res.matter.id)
        .order('sequence', { ascending: true });

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_runway_seeded',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter', entity_id: res.matter.id,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'update_task') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'settlement', 'edit')) {
        return json({ error: 'You do not have permission to manage the settlement runway' }, 403);
      }
      const payload = buildSettlementTaskPayload(body);
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400);

      if ('status' in payload) {
        const status = cleanEnum(payload.status, LEGAL_SETTLEMENT_TASK_STATUSES, 'not_started');
        if (status === 'complete') {
          payload.completed_at = new Date().toISOString();
          payload.completed_by_type = 'solicitor_user';
          payload.completed_by_solicitor_user_id = me.id;
        } else {
          payload.completed_at = null;
          payload.completed_by_type = null;
          payload.completed_by_solicitor_user_id = null;
        }
        if (status !== 'blocked') payload.blocked_reason = null;
      }

      const { data: record, error } = await supabase.from('legal_matter_settlement_tasks')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', body.task_id).eq('legal_matter_id', res.matter.id)
        .select(SETTLEMENT_TASK_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Settlement task not found' }, 404);

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_runway_task_updated',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_settlement_task', entity_id: record.id,
        metadata: { task_key: record.task_key, status: record.status },
        visible_to_client: false, ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, record });
    }

    // ─────────────── UPCOMING DATES ACROSS THE PRACTICE ───────────────
    if (operation === 'upcoming_dates') {
      if (!assignedClientIds.length) return json({ success: true, records: [] });
      const horizonDays = Math.min(Math.max(Number(body.days) || 30, 1), 120);
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + horizonDays);

      const { data: matters } = await supabase
        .from('legal_matters')
        .select('id, title, property_address, property_suburb, status, client_id, firm_id')
        .in('client_id', assignedClientIds)
        .or(`firm_id.is.null,firm_id.eq.${me.firm_id}`)
        .limit(500);

      const matterMap = new Map<string, any>((matters || []).map((m: any) => [m.id, m]));
      if (!matterMap.size) return json({ success: true, records: [] });

      const { data: dates } = await supabase
        .from('legal_matter_critical_dates')
        .select(CRITICAL_DATE_SELECT)
        .in('legal_matter_id', Array.from(matterMap.keys()))
        .not('due_date', 'is', null)
        .lte('due_date', horizon.toISOString().slice(0, 10))
        .in('status', ['pending', 'at_risk', 'extended', 'missed'])
        .order('due_date', { ascending: true })
        .limit(200);

      const records = (dates || []).map((d: any) => ({
        ...d,
        matter: matterMap.get(d.legal_matter_id) ?? null,
      }));
      return json({ success: true, records });
    }


    // ───────────────────────── STATS ─────────────────────────
    if (operation === 'matter_stats') {
      const viewableClientIds = await listViewableClientIds();
      if (!viewableClientIds.length) {
        return json({ success: true, stats: { total: 0, by_status: {}, settling_30d: 0, at_risk: 0 } });
      }
      const { data } = await supabase
        .from('legal_matters')
        .select('id, status, settlement_date, risk_flag')
        .in('client_id', viewableClientIds)
        .or(`firm_id.is.null,firm_id.eq.${me.firm_id}`);

      const rows = data || [];
      const byStatus: Record<string, number> = {};
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 30);
      let settling = 0;
      let atRisk = 0;
      for (const r of rows) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        if (r.settlement_date) {
          const d = new Date(r.settlement_date);
          if (d >= new Date(new Date().toDateString()) && d <= horizon) settling++;
        }
        if (r.risk_flag) atRisk++;
      }
      return json({
        success: true,
        stats: { total: rows.length, by_status: byStatus, settling_30d: settling, at_risk: atRisk },
      });
    }

    return json({ error: `Unknown operation: ${operation || '(none)'}` }, 400);
  } catch (error: any) {
    console.error('[solicitor-portal-matters] error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
