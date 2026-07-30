/**
 * Partner Referral Register — Phase 2
 *
 * One engine, two directions:
 *   • inbound_property_referral  — finance partner refers a client to NPC (property strategy)
 *   • outbound_finance_referral  — NPC refers a client to a finance partner (credit assistance)
 *
 * Dual auth:
 *   • Command Centre staff  → verifyAuth (full record, internal notes, eligibility, conversion)
 *   • Finance partner portal → x-finance-session-token (boundary-projected record only)
 *
 * Information boundary (both agreement templates, cl. 3):
 *   partner-facing payloads carry name + contact + general purpose + approved milestone only.
 *   Internal notes, eligibility reasoning and conversion links are never projected outward.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { extractFinanceToken, resolveFinancePartner } from '../_shared/finance-portal-session.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TABLE = 'partner_referrals';
const EVENTS_TABLE = 'partner_referral_events';

const DIRECTIONS = new Set(['inbound_property_referral', 'outbound_finance_referral']);

/** Status vocabularies differ per direction. */
const STATUS_FLOW: Record<string, Record<string, string[]>> = {
  inbound_property_referral: {
    draft: ['submitted', 'withdrawn'],
    submitted: ['accepted', 'declined', 'withdrawn'],
    accepted: ['contacted', 'declined', 'withdrawn'],
    contacted: ['engaged', 'declined', 'withdrawn'],
    engaged: ['contracted', 'withdrawn'],
    contracted: ['settled', 'withdrawn'],
    settled: [],
    declined: [],
    withdrawn: [],
  },
  outbound_finance_referral: {
    draft: ['submitted', 'withdrawn'],
    submitted: ['accepted', 'declined', 'withdrawn'],
    accepted: ['contacted', 'declined', 'withdrawn'],
    contacted: ['application', 'declined', 'withdrawn'],
    application: ['approved', 'declined', 'withdrawn'],
    approved: ['settled', 'withdrawn'],
    settled: [],
    declined: [],
    withdrawn: [],
  },
};

/** Milestones a partner may set themselves (cl. 3 — approved high-level updates only). */
const PARTNER_SETTABLE_STATUS = new Set(['accepted', 'contacted', 'application', 'approved', 'settled', 'declined']);

const WRITABLE_FIELDS = [
  'direction', 'agreement_id', 'finance_agent_contact_id',
  'referring_entity_name', 'referring_individual_name', 'referring_individual_crn',
  'referring_contact_email', 'referring_contact_phone',
  'client_first_name', 'client_surname', 'client_email', 'client_phone',
  'general_purpose', 'preferred_contact_method', 'preferred_contact_time',
  'consent_obtained', 'consent_method', 'consent_artefact_path',
  'benefit_disclosed', 'prior_client_check',
  'assigned_consultant_id', 'assigned_consultant_name',
  'assigned_finance_user_id', 'assigned_loan_writer_name',
  'commercial_eligibility', 'eligibility_reason', 'estimated_value',
  'internal_notes', 'shared_notes',
] as const;

const BOOL_FIELDS = new Set(['consent_obtained', 'benefit_disclosed']);
const NUMERIC_FIELDS = new Set(['estimated_value']);

/** Fields visible to a finance partner over the portal transport. */
const PARTNER_PROJECTION = [
  'id', 'reference', 'direction', 'status', 'status_reason',
  'client_first_name', 'client_surname', 'client_email', 'client_phone',
  'general_purpose', 'preferred_contact_method', 'preferred_contact_time',
  'consent_obtained', 'consent_obtained_at', 'benefit_disclosed',
  'assigned_loan_writer_name', 'assigned_finance_user_id',
  'referring_entity_name', 'referring_individual_name',
  'shared_notes', 'submitted_at', 'accepted_at', 'completed_at',
  'agreement_id', 'created_at', 'updated_at',
];

function projectForPartner(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of PARTNER_PROJECTION) out[key] = row[key] ?? null;
  return out;
}

function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE_FIELDS) {
    if (!(key in input)) continue;
    let value = input[key as string];
    if (value === '' || value === undefined) value = null;
    if (BOOL_FIELDS.has(key)) value = value === true || value === 'true';
    if (value !== null && NUMERIC_FIELDS.has(key)) {
      const n = Number(value);
      value = Number.isFinite(n) ? n : null;
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
  referralId: string,
  eventType: string,
  actor: { id: string | null; label: string | null; surface: string },
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const { error } = await supabase.from(EVENTS_TABLE).insert({
    referral_id: referralId,
    event_type: eventType,
    actor_id: actor.id,
    actor_label: actor.label,
    actor_surface: actor.surface,
    summary,
    payload,
  });
  if (error) console.error('[partner-referrals] event log failed:', error.message);
}

/** Human reference: RIP-20260730-0007 / ROF-… */
async function nextReference(supabase: any, direction: string): Promise<string> {
  const prefix = direction === 'inbound_property_referral' ? 'RIP' : 'ROF';
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { count } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('direction', direction);
  const seq = String((count ?? 0) + 1).padStart(4, '0');
  return `${prefix}-${day}-${seq}`;
}

/** Duplicate / prior-client detection against existing referrals and clients. */
async function priorClientCheck(
  supabase: any,
  params: { email?: string | null; phone?: string | null; excludeId?: string | null },
): Promise<{ result: 'new' | 'existing' | 'duplicate'; matches: Record<string, unknown>[] }> {
  const email = params.email?.trim().toLowerCase() || null;
  const phone = params.phone?.replace(/\D/g, '') || null;
  if (!email && !phone) return { result: 'new', matches: [] };

  const matches: Record<string, unknown>[] = [];

  if (email) {
    let q = supabase
      .from(TABLE)
      .select('id, reference, direction, status, client_first_name, client_surname, created_at')
      .ilike('client_email', email)
      .limit(10);
    if (params.excludeId) q = q.neq('id', params.excludeId);
    const { data } = await q;
    for (const row of data ?? []) matches.push({ ...row, match_type: 'referral', matched_on: 'email' });
  }

  let clientMatch = false;
  if (email) {
    const { data } = await supabase
      .from('clients')
      .select('id, primary_first_name, primary_surname, primary_email')
      .ilike('primary_email', email)
      .limit(5);
    if ((data ?? []).length > 0) {
      clientMatch = true;
      for (const row of data ?? []) matches.push({ ...row, match_type: 'client', matched_on: 'email' });
    }
  }

  if (matches.some((m) => m.match_type === 'referral')) return { result: 'duplicate', matches };
  if (clientMatch) return { result: 'existing', matches };
  return { result: 'new', matches };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = {
    ...createCorsHeaders(origin),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-correlation-id, x-finance-session-token, x-session-token',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { action } = body ?? {};

    const financeToken = extractFinanceToken(req.headers, body);

    // ───────────────────────────────────────────────────────
    // FINANCE PARTNER SURFACE (boundary-projected)
    // ───────────────────────────────────────────────────────
    if (financeToken) {
      const resolved = await resolveFinancePartner(supabase, financeToken);
      if ((resolved as any).error) {
        return json({ error: (resolved as any).error }, corsHeaders, (resolved as any).status ?? 401);
      }
      const portalUser = (resolved as any).portalUser;
      const actor = { id: portalUser.id, label: portalUser.full_name ?? portalUser.email, surface: 'finance_portal' };

      // Partner scope: referrals assigned to this portal user, or raised by them.
      const scope = (q: any) =>
        q.or(`assigned_finance_user_id.eq.${portalUser.id},created_by.eq.${portalUser.id}`);

      if (action === 'partner_list') {
        let q = supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(500);
        q = scope(q);
        if (body.direction && DIRECTIONS.has(body.direction)) q = q.eq('direction', body.direction);
        if (body.status) q = q.eq('status', body.status);
        const { data, error } = await q;
        if (error) throw error;
        return json({ referrals: (data ?? []).map(projectForPartner) }, corsHeaders);
      }

      if (action === 'partner_get') {
        const { id } = body;
        if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
        const { data } = await scope(supabase.from(TABLE).select('*').eq('id', id)).maybeSingle();
        if (!data) return json({ error: 'not_found' }, corsHeaders, 404);
        const { data: events } = await supabase
          .from(EVENTS_TABLE)
          .select('id, event_type, summary, created_at, actor_surface')
          .eq('referral_id', id)
          .order('created_at', { ascending: false })
          .limit(100);
        return json({ referral: projectForPartner(data), events: events ?? [] }, corsHeaders);
      }

      // Partner status update — clamped to approved milestones only.
      if (action === 'partner_update_status') {
        const { id, status: nextStatus, reason } = body;
        if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
        if (!PARTNER_SETTABLE_STATUS.has(nextStatus)) {
          return json({ error: 'status_not_permitted' }, corsHeaders, 403);
        }
        const { data: existing } = await scope(supabase.from(TABLE).select('*').eq('id', id)).maybeSingle();
        if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

        const allowed = STATUS_FLOW[existing.direction]?.[existing.status] ?? [];
        if (!allowed.includes(nextStatus)) {
          return json({
            error: 'transition_not_allowed',
            message: `Cannot move a referral from "${existing.status}" to "${nextStatus}".`,
          }, corsHeaders, 409);
        }

        const patch: Record<string, unknown> = { status: nextStatus, status_reason: reason ?? null, updated_by: portalUser.id };
        if (nextStatus === 'accepted') patch.accepted_at = new Date().toISOString();
        if (nextStatus === 'declined') patch.declined_at = new Date().toISOString();
        if (nextStatus === 'settled') patch.completed_at = new Date().toISOString();

        const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
        if (error) throw error;
        await logEvent(supabase, id, `status_${nextStatus}`, actor,
          `Partner moved referral ${existing.status} → ${nextStatus}`, { from: existing.status, to: nextStatus });
        return json({ referral: projectForPartner(data) }, corsHeaders);
      }

      if (action === 'partner_add_note') {
        const { id, note } = body;
        if (!id || !note) return json({ error: 'id_and_note_required' }, corsHeaders, 400);
        const { data: existing } = await scope(supabase.from(TABLE).select('id').eq('id', id)).maybeSingle();
        if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
        await logEvent(supabase, id, 'note', actor, String(note).slice(0, 2000));
        return json({ success: true }, corsHeaders);
      }

      return json({ error: 'unknown_action' }, corsHeaders, 400);
    }

    // ───────────────────────────────────────────────────────
    // COMMAND CENTRE SURFACE
    // ───────────────────────────────────────────────────────
    const csrf = enforceCsrf(req);
    if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) return createUnauthorizedResponse(authResult.error, corsHeaders);
    const actorId = authResult.userId ?? null;
    const actor = { id: actorId, label: authResult.username ?? null, surface: 'command_centre' };

    if (action === 'list') {
      let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(1000);
      if (body.direction && DIRECTIONS.has(body.direction)) query = query.eq('direction', body.direction);
      if (body.status) query = query.eq('status', body.status);
      if (body.agreement_id) query = query.eq('agreement_id', body.agreement_id);
      if (body.finance_agent_contact_id) query = query.eq('finance_agent_contact_id', body.finance_agent_contact_id);
      if (body.commercial_eligibility) query = query.eq('commercial_eligibility', body.commercial_eligibility);
      const { data, error } = await query;
      if (error) throw error;
      return json({ referrals: data ?? [] }, corsHeaders);
    }

    if (action === 'get') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: referral, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!referral) return json({ error: 'not_found' }, corsHeaders, 404);

      const { data: events } = await supabase
        .from(EVENTS_TABLE).select('*').eq('referral_id', id)
        .order('created_at', { ascending: false }).limit(200);

      let agreement: Record<string, unknown> | null = null;
      if (referral.agreement_id) {
        const { data } = await supabase
          .from('partner_agreements')
          .select('id, direction, status, version, partner_legal_name, fee_model, fee_amount, fee_percentage, gst_treatment, qualifying_event, upfront_share_pct, trail_share_pct, commission_basis, duplicate_referral_rule, exclusions')
          .eq('id', referral.agreement_id).maybeSingle();
        agreement = data ?? null;
      }

      return json({ referral, events: events ?? [], agreement }, corsHeaders);
    }

    if (action === 'create') {
      const payload = sanitize(body);
      const direction = String(payload.direction ?? '');
      if (!DIRECTIONS.has(direction)) return json({ error: 'direction_invalid' }, corsHeaders, 400);
      if (!payload.client_first_name) return json({ error: 'client_first_name_required' }, corsHeaders, 400);

      // Snapshot the live agreement version so commercial terms are provable later.
      let agreementVersion: number | null = null;
      if (payload.agreement_id) {
        const { data: agr } = await supabase
          .from('partner_agreements').select('id, version, status, direction')
          .eq('id', payload.agreement_id).maybeSingle();
        if (!agr) return json({ error: 'agreement_not_found' }, corsHeaders, 404);
        if (agr.direction !== direction) return json({ error: 'agreement_direction_mismatch' }, corsHeaders, 409);
        agreementVersion = agr.version ?? null;
      }

      const check = await priorClientCheck(supabase, {
        email: payload.client_email as string | null,
        phone: payload.client_phone as string | null,
      });

      const reference = await nextReference(supabase, direction);
      const insert: Record<string, unknown> = {
        ...payload,
        reference,
        agreement_version: agreementVersion,
        prior_client_check: payload.prior_client_check ?? check.result,
        status: 'draft',
        created_by: actorId,
        updated_by: actorId,
      };
      if (insert.consent_obtained === true) insert.consent_obtained_at = new Date().toISOString();
      if (insert.benefit_disclosed === true) insert.benefit_disclosed_at = new Date().toISOString();

      const { data, error } = await supabase.from(TABLE).insert(insert).select().single();
      if (error) throw error;

      await logEvent(supabase, data.id, 'created', actor,
        `Referral ${reference} registered (${direction})`, { direction, prior_client_check: check.result });
      if (check.result === 'duplicate') {
        await logEvent(supabase, data.id, 'duplicate_flagged', actor,
          'Potential duplicate referral detected on client contact details', { matches: check.matches });
      }

      return json({ referral: data, duplicate_matches: check.matches }, corsHeaders);
    }

    if (action === 'update') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);

      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (['settled', 'declined', 'withdrawn'].includes(existing.status)) {
        return json({ error: 'referral_closed', message: 'Closed referrals are read-only.' }, corsHeaders, 409);
      }

      const payload = sanitize(body);
      delete payload.direction; // immutable

      if (payload.consent_obtained === true && !existing.consent_obtained) {
        payload.consent_obtained_at = new Date().toISOString();
      }
      if (payload.benefit_disclosed === true && !existing.benefit_disclosed) {
        payload.benefit_disclosed_at = new Date().toISOString();
      }

      const changedKeys = Object.keys(payload).filter(
        (k) => String(existing[k] ?? '') !== String(payload[k] ?? ''),
      );

      const { data, error } = await supabase
        .from(TABLE).update({ ...payload, updated_by: actorId }).eq('id', id).select().single();
      if (error) throw error;

      if (changedKeys.length > 0) {
        await logEvent(supabase, id, 'updated', actor, `Updated ${changedKeys.length} field(s)`, { fields: changedKeys });
      }
      return json({ referral: data }, corsHeaders);
    }

    if (action === 'transition') {
      const { id, status: nextStatus, reason } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);

      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      const allowed = STATUS_FLOW[existing.direction]?.[existing.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        return json({
          error: 'transition_not_allowed',
          message: `Cannot move a referral from "${existing.status}" to "${nextStatus}".`,
        }, corsHeaders, 409);
      }

      // Submission gate — consent + benefit disclosure before any client data leaves NPC.
      if (nextStatus === 'submitted') {
        const missing: string[] = [];
        if (!existing.consent_obtained) missing.push('Client consent');
        if (!existing.benefit_disclosed) missing.push('Benefit disclosure');
        if (!existing.general_purpose) missing.push('General purpose of referral');
        if (!existing.client_email && !existing.client_phone) missing.push('Client contact detail');
        if (existing.prior_client_check === 'unchecked') missing.push('Prior-client check');
        if (missing.length > 0) {
          return json({
            error: 'submission_gate',
            message: `Complete the compliance gate before submitting: ${missing.join(', ')}.`,
            missing,
          }, corsHeaders, 422);
        }
      }

      const patch: Record<string, unknown> = { status: nextStatus, status_reason: reason ?? null, updated_by: actorId };
      const now = new Date().toISOString();
      if (nextStatus === 'submitted') patch.submitted_at = now;
      if (nextStatus === 'accepted') patch.accepted_at = now;
      if (nextStatus === 'declined') patch.declined_at = now;
      if (nextStatus === 'settled') patch.completed_at = now;

      const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
      if (error) throw error;

      await logEvent(supabase, id, `status_${nextStatus}`, actor,
        `Status changed ${existing.status} → ${nextStatus}`, { from: existing.status, to: nextStatus, reason: reason ?? null });
      return json({ referral: data }, corsHeaders);
    }

    /** Commercial eligibility decision (Annexure A — office use only). */
    if (action === 'set_eligibility') {
      const { id, commercial_eligibility, eligibility_reason } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      if (!['pending', 'eligible', 'not_eligible'].includes(commercial_eligibility)) {
        return json({ error: 'eligibility_invalid' }, corsHeaders, 400);
      }
      const { data, error } = await supabase
        .from(TABLE)
        .update({ commercial_eligibility, eligibility_reason: eligibility_reason ?? null, updated_by: actorId })
        .eq('id', id).select().single();
      if (error) throw error;
      await logEvent(supabase, id, 'eligibility_set', actor,
        `Commercial eligibility set to ${commercial_eligibility}`, { eligibility_reason: eligibility_reason ?? null });
      return json({ referral: data }, corsHeaders);
    }

    /** Re-run the duplicate / prior-client check on demand. */
    if (action === 'run_prior_client_check') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      const check = await priorClientCheck(supabase, {
        email: existing.client_email, phone: existing.client_phone, excludeId: id,
      });
      const { data, error } = await supabase
        .from(TABLE).update({ prior_client_check: check.result, updated_by: actorId })
        .eq('id', id).select().single();
      if (error) throw error;
      await logEvent(supabase, id, 'prior_client_check', actor,
        `Prior-client check: ${check.result}`, { matches: check.matches });
      return json({ referral: data, matches: check.matches }, corsHeaders);
    }

    /** Link the referral to an existing client / purchase file / deal. */
    if (action === 'link_records') {
      const { id, client_id, purchase_file_id, client_deal_id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const patch: Record<string, unknown> = { updated_by: actorId };
      if ('client_id' in body) patch.client_id = client_id || null;
      if ('purchase_file_id' in body) patch.purchase_file_id = purchase_file_id || null;
      if ('client_deal_id' in body) patch.client_deal_id = client_deal_id || null;

      const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
      if (error) throw error;
      await logEvent(supabase, id, 'records_linked', actor, 'Referral linked to internal records', patch);
      return json({ referral: data }, corsHeaders);
    }

    /** Convert an accepted referral into a client record. */
    if (action === 'convert_to_client') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (existing.client_id) return json({ error: 'already_converted', client_id: existing.client_id }, corsHeaders, 409);
      if (!existing.consent_obtained) {
        return json({ error: 'consent_required', message: 'Client consent must be recorded before conversion.' }, corsHeaders, 422);
      }
      if (!['accepted', 'contacted', 'engaged', 'application', 'approved', 'contracted'].includes(existing.status)) {
        return json({ error: 'status_invalid', message: 'Accept the referral before converting it.' }, corsHeaders, 409);
      }

      const { data: client, error } = await supabase
        .from('clients')
        .insert({
          primary_first_name: existing.client_first_name,
          primary_surname: existing.client_surname,
          primary_email: existing.client_email,
          primary_phone: existing.client_phone,
          lead_source: existing.direction === 'inbound_property_referral' ? 'Finance partner referral' : 'Partner referral',
          notes: existing.general_purpose,
        })
        .select('id')
        .single();
      if (error) throw error;

      const { data, error: updErr } = await supabase
        .from(TABLE).update({ client_id: client.id, updated_by: actorId }).eq('id', id).select().single();
      if (updErr) throw updErr;

      await logEvent(supabase, id, 'converted_to_client', actor, 'Referral converted to a client record', { client_id: client.id });
      return json({ referral: data, client_id: client.id }, corsHeaders);
    }

    if (action === 'add_note') {
      const { id, note } = body;
      if (!id || !note) return json({ error: 'id_and_note_required' }, corsHeaders, 400);
      await logEvent(supabase, id, 'note', actor, String(note).slice(0, 2000));
      return json({ success: true }, corsHeaders);
    }

    if (action === 'delete_draft') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(TABLE).select('id, status').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (existing.status !== 'draft') return json({ error: 'only_drafts_deletable' }, corsHeaders, 409);
      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) throw error;
      return json({ success: true }, corsHeaders);
    }

    /** Active agreements available to attach a referral to. */
    if (action === 'list_active_agreements') {
      let q = supabase
        .from('partner_agreements')
        .select('id, direction, version, partner_legal_name, finance_agent_contact_id, status, effective_date')
        .eq('status', 'active')
        .order('partner_legal_name', { ascending: true });
      if (body.direction && DIRECTIONS.has(body.direction)) q = q.eq('direction', body.direction);
      const { data, error } = await q;
      if (error) throw error;
      return json({ agreements: data ?? [] }, corsHeaders);
    }

    /** Finance portal users, for assigning an outbound referral to a loan writer. */
    if (action === 'list_finance_users') {
      const { data, error } = await supabase
        .from('finance_portal_users')
        .select('id, email, full_name, company_name, is_active')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return json({ users: data ?? [] }, corsHeaders);
    }

    return json({ error: 'unknown_action' }, corsHeaders, 400);
  } catch (error) {
    console.error('[manage-partner-referrals] error:', error);
    return json({ error: 'internal_error', message: (error as Error).message }, corsHeaders, 500);
  }
});
