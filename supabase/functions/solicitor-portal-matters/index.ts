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
  PARTY_SELECT,
  LEGAL_MATTER_STATUSES,
  buildMatterPayload,
  buildPartyPayload,
  cleanEnum,
  cleanText,
  TERMINAL_STATUSES,
} from "../_shared/legalMatters.ts";

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
      let query = supabase
        .from('legal_matters')
        .select(MATTER_SELECT)
        .in('client_id', assignedClientIds)
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
          .select('id, name')
          .in('id', clientIds);
        for (const c of clients || []) clientMap.set(c.id, c.name);
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
        supabase.from('clients').select('id, name, email, phone').eq('id', matter.client_id).maybeSingle(),
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

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_viewed',
        client_id: matter.client_id, legal_matter_id: matter.id,
        entity_type: 'legal_matter', entity_id: matter.id, ip_address: ip, user_agent: userAgent,
      });

      return json({
        success: true,
        matter: { ...matter, client_name: client?.name ?? null },
        client: client ?? null,
        parties: parties || [],
        status_history: history || [],
        finance_snapshot,
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

    // ───────────────────────── STATS ─────────────────────────
    if (operation === 'matter_stats') {
      if (!assignedClientIds.length) {
        return json({ success: true, stats: { total: 0, by_status: {}, settling_30d: 0, at_risk: 0 } });
      }
      const { data } = await supabase
        .from('legal_matters')
        .select('id, status, settlement_date, risk_flag')
        .in('client_id', assignedClientIds)
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
