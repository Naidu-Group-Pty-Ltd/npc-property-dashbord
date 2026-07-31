import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { recordPartnerAudit } from '../_shared/partnerAudit.ts';


const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TABLE = 'partner_agreements';
const EVENTS_TABLE = 'partner_agreement_events';

const DIRECTIONS = new Set(['inbound_property_referral', 'outbound_finance_referral']);
const STATUSES = new Set([
  'draft', 'pending_review', 'sent_for_signature', 'partially_signed',
  'active', 'terminated', 'superseded', 'void',
]);

/** Status transitions permitted by the agreement engine. */
const TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_review', 'sent_for_signature', 'void'],
  pending_review: ['draft', 'sent_for_signature', 'void'],
  sent_for_signature: ['partially_signed', 'active', 'draft', 'void'],
  partially_signed: ['active', 'void'],
  active: ['terminated', 'superseded'],
  terminated: [],
  superseded: [],
  void: [],
};

/** Columns a caller may write. Anything else is ignored (never trusted from the client). */
const WRITABLE_FIELDS = [
  'direction', 'document_version', 'finance_agent_contact_id',
  'partner_legal_name', 'partner_trading_name', 'partner_abn', 'partner_acn',
  'partner_acl_number', 'partner_credit_rep_number', 'partner_aggregator',
  'partner_address', 'partner_contact_name', 'partner_contact_email',
  'partner_contact_phone', 'partner_notice_email',
  'principal_legal_name', 'principal_trading_name', 'principal_abn', 'principal_acn',
  'principal_licence_number', 'principal_address', 'principal_contact_name',
  'principal_contact_email', 'principal_notice_email',
  'governing_state', 'effective_date', 'termination_date', 'termination_notice_days',
  'dispute_window_days', 'records_retention_years', 'executed_under_s127',
  'fee_model', 'fee_amount', 'fee_percentage', 'gst_treatment', 'qualifying_event',
  'payment_business_days', 'invoice_process', 'exclusions', 'duplicate_referral_rule',
  'fee_cap', 'fee_minimum', 'post_termination_entitlement',
  'upfront_share_pct', 'trail_share_pct', 'commission_basis', 'payment_cycle',
  'cleared_funds_required', 'clawback_treatment', 'clawback_repayment_days',
  'includes_refinance_topup', 'schedule_extras',
  'template_id', 'sent_via', 'notes',
] as const;

const NUMERIC_FIELDS = new Set([
  'fee_amount', 'fee_percentage', 'fee_cap', 'fee_minimum',
  'upfront_share_pct', 'trail_share_pct',
]);
const INT_FIELDS = new Set([
  'payment_business_days', 'termination_notice_days', 'dispute_window_days',
  'records_retention_years', 'clawback_repayment_days',
]);
const DATE_FIELDS = new Set(['effective_date', 'termination_date']);

function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE_FIELDS) {
    if (!(key in input)) continue;
    let value = input[key as string];
    if (value === '' || value === undefined) value = null;
    if (value !== null && NUMERIC_FIELDS.has(key)) {
      const n = Number(value);
      value = Number.isFinite(n) ? n : null;
    }
    if (value !== null && INT_FIELDS.has(key)) {
      const n = parseInt(String(value), 10);
      value = Number.isFinite(n) ? n : null;
    }
    if (value !== null && DATE_FIELDS.has(key)) {
      value = String(value).slice(0, 10);
    }
    out[key] = value;
  }
  return out;
}

function json(body: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function logEvent(
  supabase: any,
  agreementId: string,
  eventType: string,
  actorId: string | null,
  actorLabel: string | null,
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const { error } = await supabase.from(EVENTS_TABLE).insert({
    agreement_id: agreementId,
    event_type: eventType,
    actor_id: actorId,
    actor_label: actorLabel,
    summary,
    payload,
  });
  if (error) console.error('[partner-agreements] event log failed:', error.message);

  // Phase 6 — mirror into the tamper-evident compliance chain.
  await recordPartnerAudit(supabase, {
    agreement_id: agreementId,
    scope_type: 'agreement',
    scope_id: agreementId,
    actor_id: actorId,
    actor_label: actorLabel,
    severity: eventType === 'terminated' || eventType === 'void' ? 'critical' : 'info',
    category: 'lifecycle',
    action: `agreement_${eventType}`,
    target_type: 'partner_agreement',
    target_id: agreementId,
    description: summary,
    metadata: payload,
  });
}


Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();

    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) {
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }
    const actorId = authResult.userId ?? null;
    const actorLabel = authResult.username ?? null;

    const { action } = body;

    // ─── LIST ───────────────────────────────────────────────
    if (action === 'list') {
      let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false });
      if (body.direction && DIRECTIONS.has(body.direction)) query = query.eq('direction', body.direction);
      if (body.status && STATUSES.has(body.status)) query = query.eq('status', body.status);
      if (body.finance_agent_contact_id) query = query.eq('finance_agent_contact_id', body.finance_agent_contact_id);

      const { data, error } = await query;
      if (error) throw error;
      return json({ agreements: data ?? [] }, corsHeaders);
    }

    // ─── GET (with event history + version chain) ───────────
    if (action === 'get') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);

      const { data: agreement, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!agreement) return json({ error: 'not_found' }, corsHeaders, 404);

      const { data: events } = await supabase
        .from(EVENTS_TABLE)
        .select('*')
        .eq('agreement_id', id)
        .order('created_at', { ascending: false })
        .limit(200);

      // Version chain: everything that shares the root of this agreement.
      const { data: versions } = await supabase
        .from(TABLE)
        .select('id, version, status, effective_date, created_at, supersedes_agreement_id')
        .or(`id.eq.${id},supersedes_agreement_id.eq.${id}`)
        .order('version', { ascending: false });

      return json({ agreement, events: events ?? [], versions: versions ?? [] }, corsHeaders);
    }

    // ─── PARTNER PICKER (finance partner contacts) ──────────
    if (action === 'list_partners') {
      const { data, error } = await supabase
        .from('finance_agent_contacts')
        .select('id, company_name, contact_name, email, phone, abn, gst_registered, default_commission_rate_pct, default_commission_basis')
        .order('company_name', { ascending: true });
      if (error) throw error;
      return json({ partners: data ?? [] }, corsHeaders);
    }

    // ─── CREATE ─────────────────────────────────────────────
    if (action === 'create') {
      const payload = sanitize(body);
      if (!payload.direction || !DIRECTIONS.has(String(payload.direction))) {
        return json({ error: 'direction_invalid' }, corsHeaders, 400);
      }
      if (!payload.partner_legal_name) {
        return json({ error: 'partner_legal_name_required' }, corsHeaders, 400);
      }

      const { data, error } = await supabase
        .from(TABLE)
        .insert({ ...payload, status: 'draft', version: 1, created_by: actorId, updated_by: actorId })
        .select()
        .single();
      if (error) throw error;

      await logEvent(supabase, data.id, 'created', actorId, actorLabel,
        `Draft agreement created (${data.direction})`, { direction: data.direction });

      return json({ agreement: data }, corsHeaders);
    }

    // ─── UPDATE (draft-stage editing + schedule editing) ────
    if (action === 'update') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);

      const { data: existing, error: fetchErr } = await supabase
        .from(TABLE).select('*').eq('id', id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      if (['terminated', 'superseded', 'void'].includes(existing.status)) {
        return json({ error: 'agreement_locked', message: 'Terminated, superseded and void agreements are immutable. Create a new version instead.' }, corsHeaders, 409);
      }
      if (existing.status === 'active') {
        return json({ error: 'agreement_active', message: 'Active agreements cannot be edited in place. Create a new version to vary the terms.' }, corsHeaders, 409);
      }

      const payload = sanitize(body);
      delete payload.direction; // direction is immutable once created
      const changedKeys = Object.keys(payload).filter((k) => String(existing[k] ?? '') !== String(payload[k] ?? ''));

      const { data, error } = await supabase
        .from(TABLE)
        .update({ ...payload, updated_by: actorId })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      if (changedKeys.length > 0) {
        await logEvent(supabase, id, 'updated', actorId, actorLabel,
          `Updated ${changedKeys.length} field(s)`, { fields: changedKeys });
      }

      return json({ agreement: data }, corsHeaders);
    }

    // ─── TRANSITION STATUS ──────────────────────────────────
    if (action === 'transition') {
      const { id, status: nextStatus, reason } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      if (!STATUSES.has(nextStatus)) return json({ error: 'status_invalid' }, corsHeaders, 400);

      const { data: existing, error: fetchErr } = await supabase
        .from(TABLE).select('*').eq('id', id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      const allowed = TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        return json({
          error: 'transition_not_allowed',
          message: `Cannot move an agreement from "${existing.status}" to "${nextStatus}".`,
        }, corsHeaders, 409);
      }

      // Activation gate — a live agreement must carry executable commercial terms.
      if (nextStatus === 'active') {
        const missing: string[] = [];
        if (!existing.effective_date) missing.push('Effective date');
        if (!existing.governing_state) missing.push('Governing state');
        if (!existing.qualifying_event) missing.push('Qualifying event');
        if (!existing.gst_treatment) missing.push('GST treatment');
        if (existing.direction === 'inbound_property_referral') {
          if (!existing.fee_model) missing.push('Remuneration model');
          if (existing.fee_model === 'fixed_fee' && existing.fee_amount == null) missing.push('Fee amount');
          if (existing.fee_model === 'percentage_of_fee' && existing.fee_percentage == null) missing.push('Fee percentage');
        } else {
          if (existing.upfront_share_pct == null) missing.push('Upfront commission share');
          if (!existing.commission_basis) missing.push('Commission basis');
        }
        if (missing.length > 0) {
          return json({ error: 'schedule_incomplete', message: `Complete the commercial schedule first: ${missing.join(', ')}.`, missing }, corsHeaders, 422);
        }
      }

      const patch: Record<string, unknown> = { status: nextStatus, updated_by: actorId };
      if (nextStatus === 'active') patch.activated_at = new Date().toISOString();
      if (nextStatus === 'sent_for_signature') patch.docusign_sent_at = new Date().toISOString();
      if (nextStatus === 'terminated') {
        patch.terminated_at = new Date().toISOString();
        patch.termination_reason = reason ?? null;
        patch.termination_date = body.termination_date ?? new Date().toISOString().slice(0, 10);
      }
      if (nextStatus === 'void') patch.termination_reason = reason ?? null;

      const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
      if (error) throw error;

      await logEvent(supabase, id, `status_${nextStatus}`, actorId, actorLabel,
        `Status changed ${existing.status} → ${nextStatus}`, { from: existing.status, to: nextStatus, reason: reason ?? null });

      return json({ agreement: data }, corsHeaders);
    }

    // ─── NEW VERSION (vary an active agreement) ─────────────
    if (action === 'new_version') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);

      const { data: existing, error: fetchErr } = await supabase
        .from(TABLE).select('*').eq('id', id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      const clone: Record<string, unknown> = { ...existing };
      for (const key of [
        'id', 'created_at', 'updated_at', 'activated_at', 'terminated_at', 'termination_reason',
        'docusign_envelope_id', 'docusign_status', 'docusign_sent_at', 'docusign_signed_at',
        'pdf_storage_path', 'signed_pdf_storage_path',
      ]) delete clone[key];

      clone.status = 'draft';
      clone.version = (existing.version ?? 1) + 1;
      clone.supersedes_agreement_id = existing.id;
      clone.created_by = actorId;
      clone.updated_by = actorId;

      const { data, error } = await supabase.from(TABLE).insert(clone).select().single();
      if (error) throw error;

      await logEvent(supabase, data.id, 'version_created', actorId, actorLabel,
        `Version ${data.version} drafted from version ${existing.version}`, { supersedes: existing.id });
      await logEvent(supabase, existing.id, 'version_superseded_pending', actorId, actorLabel,
        `Version ${data.version} drafted`, { successor: data.id });

      return json({ agreement: data }, corsHeaders);
    }

    // ─── DELETE DRAFT ───────────────────────────────────────
    if (action === 'delete_draft') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);

      const { data: existing } = await supabase.from(TABLE).select('id, status').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (existing.status !== 'draft') {
        return json({ error: 'only_drafts_deletable' }, corsHeaders, 409);
      }

      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) throw error;
      return json({ success: true }, corsHeaders);
    }

    // ─── RESOLVE EFFECTIVE SCHEDULE (used by commission engine) ──
    if (action === 'effective_schedule') {
      const { finance_agent_contact_id, direction } = body;
      if (!finance_agent_contact_id) return json({ error: 'finance_agent_contact_id_required' }, corsHeaders, 400);

      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('finance_agent_contact_id', finance_agent_contact_id)
        .eq('direction', direction && DIRECTIONS.has(direction) ? direction : 'outbound_finance_referral')
        .eq('status', 'active')
        .order('version', { ascending: false })
        .limit(1);
      if (error) throw error;

      return json({ agreement: data?.[0] ?? null }, corsHeaders);
    }

    return json({ error: 'unknown_action' }, corsHeaders, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('[manage-partner-agreements] error:', message);
    return json({ error: message }, corsHeaders, 500);
  }
});
