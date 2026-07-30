/**
 * Solicitor Portal — Compliance, Audit & Hardening (Phase 8)
 *
 * Portal-facing compliance control plane. Every operation resolves the caller's
 * session, confirms the matter belongs to their firm AND an assigned client,
 * then gates on the merged permission matrix (`audit` for the trail/export,
 * `matters` for conflict checks and closure).
 *
 * Tri-portal separation: nothing here is reachable from the Client Portal or
 * Finance Portal. Audit rows and conflict-check results never leak restricted
 * financial or AML data.
 *
 * Operations
 *   audit_timeline | audit_verify | audit_record
 *   conflict_list | conflict_run | conflict_clear
 *   closure_state | closure_update | matter_close | matter_reopen
 *   compliance_export | compliance_health
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
  recordLegalAuditEvent,
  verifyLegalAuditChain,
  retentionUntil,
  LEGAL_AUDIT_SELECT,
  LEGAL_RETENTION_CLASSES,
  LEGAL_CLOSURE_CHECKLIST_KEYS,
  type LegalAuditCategory,
} from "../_shared/legalAudit.ts";

const AUDIT_CATEGORIES = new Set<string>([
  'access', 'matter', 'party', 'document', 'search', 'requisition', 'disbursement',
  'critical_date', 'settlement', 'communication', 'intelligence', 'conflict',
  'closure', 'retention', 'export', 'admin',
]);

const CONFLICT_OUTCOMES = new Set(['pending', 'clear', 'potential_conflict', 'conflict', 'waived']);

const text = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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

    const loadMatter = async (matterId: string): Promise<
      { ok: true; matter: any; perms: PermissionMatrix } | { ok: false; status: number; error: string }
    > => {
      if (!matterId) return { ok: false, status: 400, error: 'matter_id is required' };
      const { data: matter } = await supabase
        .from('legal_matters')
        .select(`
          id, matter_reference, title, status, client_id, firm_id, settlement_date,
          actual_settlement_date, closure_status, closure_reason, closure_checklist,
          closed_at, closed_by_type, closed_by_solicitor_user_id, retention_class,
          retention_until, archived_at, conflict_check_status, conflict_checked_at
        `)
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

    const audit = (
      matter: any,
      category: LegalAuditCategory,
      action: string,
      extra: Record<string, unknown> = {},
    ) => recordLegalAuditEvent(supabase, {
      legal_matter_id: matter.id,
      client_id: matter.client_id,
      firm_id: matter.firm_id ?? me.firm_id ?? null,
      actor_type: 'solicitor_user',
      actor_solicitor_user_id: me.id,
      category,
      action,
      ip_address: ip,
      user_agent: userAgent,
      ...extra,
    });

    // ───────────────────── AUDIT TIMELINE ─────────────────────
    if (operation === 'audit_timeline') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'audit', 'view')) {
        return json({ error: 'You do not have access to the audit trail' }, 403);
      }

      let query = supabase
        .from('legal_matter_audit_events')
        .select(LEGAL_AUDIT_SELECT)
        .eq('legal_matter_id', loaded.matter.id)
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(body.limit) || 200, 500));

      const category = text(body.category, 40);
      if (category && AUDIT_CATEGORIES.has(category)) query = query.eq('category', category);
      const severity = text(body.severity, 20);
      if (severity) query = query.eq('severity', severity);

      const { data, error } = await query;
      if (error) throw error;

      const rows = data || [];
      const stats = {
        total: rows.length,
        critical: rows.filter((r: any) => r.severity === 'critical').length,
        warning: rows.filter((r: any) => r.severity === 'warning').length,
        by_category: rows.reduce((acc: Record<string, number>, r: any) => {
          acc[r.category] = (acc[r.category] ?? 0) + 1;
          return acc;
        }, {}),
      };

      return json({ success: true, records: rows, stats });
    }

    if (operation === 'audit_verify') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'audit', 'view')) {
        return json({ error: 'You do not have access to the audit trail' }, 403);
      }
      const verification = await verifyLegalAuditChain(supabase, loaded.matter.id);
      await audit(loaded.matter, 'access', 'audit_chain_verified', {
        severity: verification.verified ? 'info' : 'critical',
        metadata: { verified: verification.verified, checked: verification.checked },
      });
      return json({ success: true, verification });
    }

    /** Allow other portal surfaces to append a scoped audit entry. */
    if (operation === 'audit_record') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      const category = text(body.category, 40) ?? 'access';
      if (!AUDIT_CATEGORIES.has(category)) return json({ error: 'Unsupported audit category' }, 400);
      const action = text(body.action, 120);
      if (!action) return json({ error: 'action is required' }, 400);

      const id = await audit(loaded.matter, category as LegalAuditCategory, action, {
        severity: text(body.severity, 20) ?? 'info',
        target_type: text(body.target_type, 60),
        target_id: text(body.target_id, 64),
        description: text(body.description, 500),
        fields_accessed: Array.isArray(body.fields_accessed)
          ? body.fields_accessed.slice(0, 50).map((f: unknown) => String(f).slice(0, 80))
          : null,
        metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
      });
      return json({ success: true, id });
    }

    // ───────────────────── CONFLICT CHECKS ─────────────────────
    if (operation === 'conflict_list') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      const { data, error } = await supabase
        .from('legal_conflict_checks')
        .select('*')
        .eq('legal_matter_id', loaded.matter.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return json({
        success: true,
        records: data || [],
        conflict_check_status: loaded.matter.conflict_check_status,
        conflict_checked_at: loaded.matter.conflict_checked_at,
      });
    }

    if (operation === 'conflict_run') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to run conflict checks' }, 403);
      }

      // Terms: explicit list plus every party recorded on this matter.
      const explicit = Array.isArray(body.terms)
        ? body.terms.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 25)
        : [];
      const { data: parties } = await supabase
        .from('legal_matter_parties')
        .select('name, organisation, role')
        .eq('legal_matter_id', loaded.matter.id);
      const partyTerms = (parties || [])
        .flatMap((p: any) => [p.name, p.organisation])
        .filter(Boolean)
        .map((s: string) => s.trim());

      const terms = Array.from(new Set([...explicit, ...partyTerms]))
        .filter((t) => t.length >= 3)
        .slice(0, 40);

      const matches: any[] = [];
      if (terms.length) {
        // Search parties only on OTHER matters belonging to clients assigned to
        // this solicitor. The service-role client bypasses RLS, so both firm and
        // client scopes must be applied explicitly before party data is loaded.
        const { data: firmMatters } = await supabase
          .from('legal_matters')
          .select('id, matter_reference, title, status, client_id')
          .eq('firm_id', me.firm_id)
          .in('client_id', assignedClientIds)
          .neq('id', loaded.matter.id)
          .limit(1000);
        const matterMap = new Map((firmMatters || []).map((m: any) => [m.id, m]));
        const matterIds = Array.from(matterMap.keys());

        if (matterIds.length) {
          const orFilter = terms
            .map((t) => `name.ilike.%${t.replace(/[%,()]/g, '')}%,organisation.ilike.%${t.replace(/[%,()]/g, '')}%`)
            .join(',');
          const { data: hits } = await supabase
            .from('legal_matter_parties')
            .select('id, legal_matter_id, name, organisation, role')
            .in('legal_matter_id', matterIds)
            .or(orFilter)
            .limit(200);

          for (const hit of hits || []) {
            const m: any = matterMap.get(hit.legal_matter_id);
            const matchedTerm = terms.find((t) =>
              [hit.name, hit.organisation].some((v) => v && String(v).toLowerCase().includes(t.toLowerCase())));
            matches.push({
              party_id: hit.id,
              party_name: hit.name,
              party_organisation: hit.organisation,
              party_role: hit.role,
              matched_term: matchedTerm ?? null,
              matter_id: hit.legal_matter_id,
              matter_reference: m?.matter_reference ?? null,
              matter_title: m?.title ?? null,
              matter_status: m?.status ?? null,
              same_client: m?.client_id === loaded.matter.client_id,
            });
          }
        }
      }

      const outcome = matches.length === 0 ? 'clear' : 'potential_conflict';
      const { data: inserted, error } = await supabase
        .from('legal_conflict_checks')
        .insert({
          legal_matter_id: loaded.matter.id,
          firm_id: me.firm_id ?? null,
          client_id: loaded.matter.client_id,
          searched_terms: terms,
          outcome,
          matches,
          match_count: matches.length,
          notes: text(body.notes, 2000),
          created_by_type: 'solicitor_user',
          created_by: me.id,
          ...(outcome === 'clear'
            ? { cleared_at: new Date().toISOString(), cleared_by_type: 'solicitor_user', cleared_by_solicitor_user_id: me.id }
            : {}),
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;

      await supabase
        .from('legal_matters')
        .update({ conflict_check_status: outcome, conflict_checked_at: new Date().toISOString() })
        .eq('id', loaded.matter.id);

      await audit(loaded.matter, 'conflict', 'conflict_check_run', {
        severity: matches.length ? 'warning' : 'info',
        target_type: 'legal_conflict_check',
        target_id: inserted?.id ?? null,
        metadata: { outcome, match_count: matches.length, term_count: terms.length },
      });
      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: 'conflict_check_run',
        client_id: loaded.matter.client_id,
        legal_matter_id: loaded.matter.id,
        entity_type: 'legal_conflict_check',
        entity_id: inserted?.id ?? null,
        metadata: { outcome, match_count: matches.length },
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true, record: inserted, outcome, match_count: matches.length });
    }

    if (operation === 'conflict_clear') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to resolve conflict checks' }, 403);
      }
      const checkId = text(body.check_id, 64);
      if (!checkId) return json({ error: 'check_id is required' }, 400);
      const outcome = text(body.outcome, 40) ?? 'clear';
      if (!CONFLICT_OUTCOMES.has(outcome)) return json({ error: 'Unsupported outcome' }, 400);

      const { data: updated, error } = await supabase
        .from('legal_conflict_checks')
        .update({
          outcome,
          notes: text(body.notes, 2000),
          cleared_at: new Date().toISOString(),
          cleared_by_type: 'solicitor_user',
          cleared_by_solicitor_user_id: me.id,
        })
        .eq('id', checkId)
        .eq('legal_matter_id', loaded.matter.id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!updated) return json({ error: 'Conflict check not found' }, 404);

      await supabase
        .from('legal_matters')
        .update({ conflict_check_status: outcome, conflict_checked_at: new Date().toISOString() })
        .eq('id', loaded.matter.id);

      await audit(loaded.matter, 'conflict', 'conflict_check_resolved', {
        severity: outcome === 'conflict' ? 'critical' : 'notice',
        target_type: 'legal_conflict_check',
        target_id: checkId,
        metadata: { outcome },
      });

      return json({ success: true, record: updated });
    }

    // ───────────────────── CLOSURE & RETENTION ─────────────────────
    if (operation === 'closure_state') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);

      const [{ count: openDates }, { count: openTasks }, { count: unpaidDisb }, { count: openReqs }] =
        await Promise.all([
          supabase.from('legal_matter_critical_dates')
            .select('id', { count: 'exact', head: true })
            .eq('legal_matter_id', loaded.matter.id).neq('status', 'satisfied'),
          supabase.from('legal_matter_settlement_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('legal_matter_id', loaded.matter.id).neq('status', 'complete'),
          supabase.from('legal_matter_disbursements')
            .select('id', { count: 'exact', head: true })
            .eq('legal_matter_id', loaded.matter.id).neq('status', 'paid'),
          supabase.from('legal_matter_requisitions')
            .select('id', { count: 'exact', head: true })
            .eq('legal_matter_id', loaded.matter.id).neq('status', 'answered'),
        ]);

      const blockers: Array<{ code: string; label: string; count: number }> = [];
      if ((openTasks ?? 0) > 0) blockers.push({ code: 'settlement_tasks', label: 'Settlement tasks outstanding', count: openTasks ?? 0 });
      if ((openDates ?? 0) > 0) blockers.push({ code: 'critical_dates', label: 'Critical dates unsatisfied', count: openDates ?? 0 });
      if ((unpaidDisb ?? 0) > 0) blockers.push({ code: 'disbursements', label: 'Disbursements unpaid', count: unpaidDisb ?? 0 });
      if ((openReqs ?? 0) > 0) blockers.push({ code: 'requisitions', label: 'Requisitions unanswered', count: openReqs ?? 0 });
      if (loaded.matter.conflict_check_status === 'not_run') {
        blockers.push({ code: 'conflict_check', label: 'Conflict check never run', count: 1 });
      }

      return json({
        success: true,
        closure: {
          closure_status: loaded.matter.closure_status,
          closure_reason: loaded.matter.closure_reason,
          closure_checklist: loaded.matter.closure_checklist ?? {},
          closed_at: loaded.matter.closed_at,
          retention_class: loaded.matter.retention_class,
          retention_until: loaded.matter.retention_until,
          archived_at: loaded.matter.archived_at,
        },
        checklist_keys: LEGAL_CLOSURE_CHECKLIST_KEYS,
        retention_classes: LEGAL_RETENTION_CLASSES,
        blockers,
      });
    }

    if (operation === 'closure_update') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to edit closure details' }, 403);
      }

      const checklist: Record<string, boolean> = { ...(loaded.matter.closure_checklist ?? {}) };
      if (body.checklist && typeof body.checklist === 'object') {
        for (const key of LEGAL_CLOSURE_CHECKLIST_KEYS) {
          if (key in body.checklist) checklist[key] = !!body.checklist[key];
        }
      }
      const patch: Record<string, unknown> = { closure_checklist: checklist };
      const retention = text(body.retention_class, 40);
      if (retention && (LEGAL_RETENTION_CLASSES as readonly string[]).includes(retention)) {
        patch.retention_class = retention;
        patch.retention_until = retentionUntil(
          retention,
          loaded.matter.closed_at ? new Date(loaded.matter.closed_at) : new Date(),
        );
      }
      if (typeof body.closure_reason === 'string') patch.closure_reason = text(body.closure_reason, 1000);

      const { data: updated, error } = await supabase
        .from('legal_matters')
        .update(patch)
        .eq('id', loaded.matter.id)
        .select('closure_status, closure_reason, closure_checklist, closed_at, retention_class, retention_until, archived_at')
        .maybeSingle();
      if (error) throw error;

      await audit(loaded.matter, 'closure', 'closure_details_updated', {
        metadata: { fields: Object.keys(patch) },
      });

      return json({ success: true, closure: updated });
    }

    if (operation === 'matter_close' || operation === 'matter_reopen') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to close or reopen matters' }, 403);
      }

      if (operation === 'matter_reopen') {
        const reason = text(body.reason, 1000);
        if (!reason) return json({ error: 'A reason is required to reopen a matter' }, 400);
        const { data: updated, error } = await supabase
          .from('legal_matters')
          .update({
            closure_status: 'open',
            closure_reason: reason,
            closed_at: null,
            closed_by_type: null,
            closed_by_solicitor_user_id: null,
            archived_at: null,
          })
          .eq('id', loaded.matter.id)
          .select('closure_status, closure_reason, closed_at, retention_class, retention_until, archived_at, closure_checklist')
          .maybeSingle();
        if (error) throw error;
        await audit(loaded.matter, 'closure', 'matter_reopened', {
          severity: 'notice',
          description: reason,
        });
        return json({ success: true, closure: updated });
      }

      const retention = text(body.retention_class, 40) ?? loaded.matter.retention_class ?? 'standard_7y';
      if (!(LEGAL_RETENTION_CLASSES as readonly string[]).includes(retention)) {
        return json({ error: 'Unsupported retention class' }, 400);
      }
      const now = new Date();
      const archive = body.archive === true;

      const { data: updated, error } = await supabase
        .from('legal_matters')
        .update({
          closure_status: archive ? 'archived' : 'closed',
          closure_reason: text(body.reason, 1000) ?? loaded.matter.closure_reason,
          closed_at: now.toISOString(),
          closed_by_type: 'solicitor_user',
          closed_by_solicitor_user_id: me.id,
          retention_class: retention,
          retention_until: retentionUntil(retention, now),
          archived_at: archive ? now.toISOString() : null,
        })
        .eq('id', loaded.matter.id)
        .select('closure_status, closure_reason, closed_at, retention_class, retention_until, archived_at, closure_checklist')
        .maybeSingle();
      if (error) throw error;

      await audit(loaded.matter, 'closure', archive ? 'matter_archived' : 'matter_closed', {
        severity: 'notice',
        metadata: { retention_class: retention, retention_until: updated?.retention_until ?? null },
      });
      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: archive ? 'matter_archived' : 'matter_closed',
        client_id: loaded.matter.client_id,
        legal_matter_id: loaded.matter.id,
        entity_type: 'legal_matter',
        entity_id: loaded.matter.id,
        metadata: { retention_class: retention },
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true, closure: updated });
    }

    // ───────────────────── COMPLIANCE EXPORT ─────────────────────
    if (operation === 'compliance_export') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'audit', 'view')) {
        return json({ error: 'You do not have permission to export the compliance pack' }, 403);
      }

      const matterId = loaded.matter.id;
      const [
        parties, dates, tasks, documents, searches, requisitions, disbursements,
        statusHistory, conflicts, auditEvents,
      ] = await Promise.all([
        supabase.from('legal_matter_parties').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_critical_dates').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_settlement_tasks').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_documents')
          .select('id, category, label, status, owner, file_name, version, uploaded_at, reviewed_at')
          .eq('legal_matter_id', matterId),
        supabase.from('legal_matter_searches').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_requisitions').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_disbursements').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_status_history').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_conflict_checks').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_audit_events').select(LEGAL_AUDIT_SELECT)
          .eq('legal_matter_id', matterId).order('created_at', { ascending: true }).limit(2000),
      ]);

      const verification = await verifyLegalAuditChain(supabase, matterId);

      const sections = {
        matter: loaded.matter,
        parties: parties.data || [],
        critical_dates: dates.data || [],
        settlement_tasks: tasks.data || [],
        documents: documents.data || [],
        searches: searches.data || [],
        requisitions: requisitions.data || [],
        disbursements: disbursements.data || [],
        status_history: statusHistory.data || [],
        conflict_checks: conflicts.data || [],
        audit_events: auditEvents.data || [],
      };
      const section_counts = Object.fromEntries(
        Object.entries(sections).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]),
      );

      const { data: exportRow } = await supabase
        .from('legal_compliance_exports')
        .insert({
          legal_matter_id: matterId,
          firm_id: me.firm_id ?? null,
          client_id: loaded.matter.client_id,
          export_scope: text(body.scope, 40) ?? 'full',
          format: 'json',
          section_counts,
          chain_verified: verification.verified,
          chain_broken_at: verification.broken_at,
          requested_by_type: 'solicitor_user',
          requested_by_solicitor_user_id: me.id,
          ip_address: ip,
        })
        .select('id, created_at')
        .maybeSingle();

      await audit(loaded.matter, 'export', 'compliance_pack_exported', {
        severity: 'notice',
        target_type: 'legal_compliance_export',
        target_id: exportRow?.id ?? null,
        metadata: { section_counts, chain_verified: verification.verified },
      });

      return json({
        success: true,
        export: {
          id: exportRow?.id ?? null,
          generated_at: exportRow?.created_at ?? new Date().toISOString(),
          generated_by: me.name || me.email,
          firm_id: me.firm_id,
          chain_verification: verification,
          section_counts,
          sections,
        },
      });
    }

    // ───────────────────── FIRM COMPLIANCE HEALTH ─────────────────────
    if (operation === 'compliance_health') {
      if (!assignedClientIds.length) {
        return json({ success: true, health: { matters: 0, signals: [] } });
      }
      const { data: matters } = await supabase
        .from('legal_matters')
        .select('id, matter_reference, title, status, closure_status, retention_until, conflict_check_status, settlement_date, actual_settlement_date')
        .in('client_id', assignedClientIds)
        .or(`firm_id.is.null,firm_id.eq.${me.firm_id}`)
        .limit(500);

      const rows = matters || [];
      const today = new Date().toISOString().slice(0, 10);
      const signals = [
        {
          code: 'conflict_not_run',
          label: 'Conflict check never run',
          severity: 'high',
          matters: rows.filter((m: any) => m.conflict_check_status === 'not_run').map((m: any) => m.id),
        },
        {
          code: 'conflict_open',
          label: 'Unresolved conflict flagged',
          severity: 'critical',
          matters: rows.filter((m: any) => ['potential_conflict', 'conflict'].includes(m.conflict_check_status)).map((m: any) => m.id),
        },
        {
          code: 'settled_not_closed',
          label: 'Settled but file not closed',
          severity: 'medium',
          matters: rows.filter((m: any) => m.actual_settlement_date && m.closure_status === 'open').map((m: any) => m.id),
        },
        {
          code: 'retention_expired',
          label: 'Retention period elapsed — review for destruction',
          severity: 'medium',
          matters: rows.filter((m: any) => m.retention_until && m.retention_until < today).map((m: any) => m.id),
        },
      ].filter((s) => s.matters.length > 0);

      return json({
        success: true,
        health: {
          matters: rows.length,
          open: rows.filter((m: any) => m.closure_status === 'open').length,
          closed: rows.filter((m: any) => m.closure_status === 'closed').length,
          archived: rows.filter((m: any) => m.closure_status === 'archived').length,
          conflict_clear: rows.filter((m: any) => m.conflict_check_status === 'clear').length,
          signals,
          index: rows.map((m: any) => ({ id: m.id, matter_reference: m.matter_reference, title: m.title })),
        },
      });
    }

    return json({ error: `Unsupported operation: ${operation}` }, 400);
  } catch (error) {
    console.error('[solicitor-portal-compliance] error:', error);
    return json({ error: (error as Error)?.message || 'Unexpected error' }, 500);
  }
});
