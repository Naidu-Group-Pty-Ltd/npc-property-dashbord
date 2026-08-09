/**
 * finance-portal-agreements — the partner side of the Agreement Centre.
 *
 * The Finance Partner Portal's secure agreement room: list what has been
 * issued to this partner, open a version for review, download a reference
 * copy, accept, lodge a structured change request, and execute with a typed
 * electronic signature. The partner NEVER edits the document — the locked
 * legal body is rendered read-only and the only free text they can write is a
 * change-request comment, which lands in the Command Centre as a request, not
 * as an edit.
 *
 * Operations
 *   list                       agreements issued to this partner org
 *   get { id }                 full review payload; records first view
 *   download { id, kind }      signed URL — 'issued' or 'executed' PDF
 *   accept { id }              partner accepts → awaiting signature
 *   request_changes { id, section_key, comment }
 *   sign { id, signatory_name, signatory_title?, legal_entity?, signature_typed }
 *
 * Auth: the finance portal session header (hash-first resolution via
 * `_shared/finance-portal-session.ts`). Every row is scoped to the session's
 * `finance_contact_id` — a partner can never address another org's agreement.
 * Rendering falls back on demand: if issue-time PDF generation was deferred,
 * the first download renders from the FROZEN version row, so the partner gets
 * the document as issued, not as the tenant's brand looks today.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { extractFinanceToken, resolveFinancePartner } from '../_shared/finance-portal-session.ts';
import { recordPartnerAudit } from '../_shared/partnerAudit.ts';
import { insertTargetedNotification } from '../_shared/notify.ts';
import {
  PARTNER_VISIBLE_STATUSES,
  isPartnerVisible,
  agreementTemplate,
  templateKeyForDirection,
  CHANGE_REQUEST_SECTIONS,
} from '../_shared/agreements/index.pure.ts';
import { agreementDownloadFileName } from '../_shared/agreements/documentHtml.pure.ts';
import {
  AGREEMENTS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  executionContextFromSignatures,
  renderAndStoreVersionPdf,
} from '../_shared/agreements/render.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

const TABLE = 'partner_agreements';
const EVENTS_TABLE = 'partner_agreement_events';
const VERSIONS_TABLE = 'partner_agreement_versions';
const CHANGE_REQUESTS_TABLE = 'partner_agreement_change_requests';
const SIGNATURES_TABLE = 'partner_agreement_signatures';

const EXTRA_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-correlation-id, x-finance-session-token, x-session-token';

/** Row fields a partner may see. Everything else stays inside the tenant. */
const PARTNER_ROW_FIELDS = [
  'id', 'direction', 'status', 'version', 'document_version',
  'partner_legal_name', 'partner_trading_name', 'partner_abn', 'partner_acn',
  'partner_acl_number', 'partner_credit_rep_number', 'partner_aggregator',
  'partner_address', 'partner_contact_name', 'partner_contact_email',
  'principal_legal_name', 'principal_trading_name', 'principal_abn', 'principal_acn',
  'principal_licence_number', 'principal_address', 'principal_contact_email',
  'governing_state', 'effective_date', 'termination_notice_days', 'dispute_window_days',
  'executed_under_s127',
  'fee_model', 'fee_amount', 'fee_percentage', 'gst_treatment', 'qualifying_event',
  'payment_business_days', 'invoice_process', 'exclusions', 'duplicate_referral_rule',
  'post_termination_entitlement',
  'upfront_share_pct', 'trail_share_pct', 'commission_basis', 'payment_cycle',
  'cleared_funds_required', 'clawback_treatment', 'clawback_repayment_days',
  'schedule_extras',
  // `voided_at` but never `void_reason`: the partner is entitled to know the
  // document is dead and when, not to read the issuer's internal note about
  // why. `archived_at` is absent for the same reason it does not appear
  // anywhere else here — filing is the issuer's business, not the partner's.
  'issued_at', 'first_viewed_at', 'accepted_at', 'executed_at', 'withdrawn_at', 'voided_at',
  'created_at', 'updated_at',
] as const;

/** Event types a partner's timeline shows. Internal workflow events stay internal. */
const PARTNER_EVENT_TYPES = new Set([
  'issued', 'reissued', 'partner_viewed', 'accepted', 'partner_signed',
  'counter_signed', 'fully_executed', 'withdrawn', 'void', 'changes_requested',
  'change_request_resolved', 'change_request_declined',
]);

const SECTION_KEYS = new Set(CHANGE_REQUEST_SECTIONS.map((section) => section.key));

/**
 * Event types whose summary and payload carry the issuer's internal note.
 *
 * The Command Centre labels that field "recorded in the activity history" and
 * people write things in it they would not say to the counterparty — "duplicate,
 * created in error", "partner failed compliance". The timeline rows go to the
 * partner verbatim, so these two are re-stated in neutral terms and their
 * payload dropped. The partner is told the fact and the date; the reason stays
 * on our side.
 */
const REASON_BEARING_EVENTS: Record<string, string> = {
  withdrawn: 'Agreement withdrawn by the issuing organisation',
  void: 'Agreement voided by the issuing organisation',
};

function partnerEventView(event: Record<string, unknown>) {
  const neutral = REASON_BEARING_EVENTS[String(event.event_type)];
  if (!neutral) return event;
  return { ...event, summary: neutral, payload: {} };
}

function partnerView(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const field of PARTNER_ROW_FIELDS) out[field] = row[field] ?? null;
  const templateKey = templateKeyForDirection(String(row.direction) as never);
  out.template_key = templateKey;
  out.title = agreementTemplate(templateKey).title;
  return out;
}

async function telemetryHash(value: string | null): Promise<string | null> {
  if (!value) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function logEvent(
  supabase: any,
  agreementId: string,
  eventType: string,
  actorLabel: string | null,
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const { error } = await supabase.from(EVENTS_TABLE).insert({
    agreement_id: agreementId,
    event_type: eventType,
    actor_id: null,
    actor_label: actorLabel,
    summary,
    payload,
  });
  if (error) console.error('[finance-portal-agreements] event log failed:', error.message);
  await recordPartnerAudit(supabase, {
    agreement_id: agreementId,
    scope_type: 'agreement',
    scope_id: agreementId,
    actor_id: null,
    actor_label: actorLabel,
    severity: 'info',
    category: 'lifecycle',
    action: `agreement_${eventType}`,
    target_type: 'partner_agreement',
    target_id: agreementId,
    description: summary,
    metadata: payload,
  });
}

async function notifyAgreementsTeam(
  supabase: any,
  title: string,
  message: string,
  agreementId: string,
) {
  await insertTargetedNotification(supabase, {
    moduleKey: 'agreements',
    notification: {
      type: 'partner_agreement_activity',
      title,
      message,
      entity_id: agreementId,
      link: `/partner-agreements/${agreementId}`,
    },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = {
    ...createCorsHeaders(req.headers.get('origin')),
    'Access-Control-Allow-Headers': EXTRA_HEADERS,
  };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const token = extractFinanceToken(req.headers, body);
    const session = await resolveFinancePartner(supabase, token);
    if ('error' in session && session.error) return json({ error: session.error }, session.status ?? 401);
    const portalUser = (session as { portalUser: { id: string; email: string | null } }).portalUser;

    // The session helper's projection does not carry the org link; read it once.
    //
    // `finance_portal_users` has NO `name` column — the partner's display name
    // lives on `finance_agent_contacts`. Selecting a column that does not exist
    // makes PostgREST fail the whole row read, which previously surfaced as
    // "Portal user is not linked to a partner record" for every partner and hid
    // every issued agreement. Read the link here and the label from the contact.
    const { data: userRow, error: userRowError } = await supabase
      .from('finance_portal_users')
      .select('finance_contact_id, email')
      .eq('id', portalUser.id)
      .maybeSingle();
    if (userRowError) {
      console.error('[finance-portal-agreements] portal user read failed:', userRowError.message);
      return json({ error: 'Could not resolve your partner organisation' }, 500);
    }
    const financeContactId = userRow?.finance_contact_id as string | undefined;
    if (!financeContactId) return json({ error: 'Portal user is not linked to a partner record' }, 403);
    const { data: contactRow } = await supabase
      .from('finance_agent_contacts')
      .select('name')
      .eq('id', financeContactId)
      .maybeSingle();
    const actorLabel = (contactRow?.name as string | null)
      || (userRow?.email as string | null)
      || portalUser.email
      || 'Finance partner';

    const operation = typeof body.operation === 'string' ? body.operation : null;

    /** Fetch an agreement THIS partner owns, in a partner-visible status. */
    async function ownAgreement(id: unknown): Promise<Record<string, unknown> | null> {
      if (typeof id !== 'string' || !id) return null;
      const { data } = await supabase.from(TABLE).select('*')
        .eq('id', id)
        .eq('finance_agent_contact_id', financeContactId)
        .maybeSingle();
      if (!data) return null;
      if (!isPartnerVisible(data.status, data.issued_at as string | null)) return null;
      return data;
    }

    // ─── LIST ───────────────────────────────────────────────
    if (operation === 'list' || operation === null) {
      const { data, error } = await supabase.from(TABLE).select('*')
        .eq('finance_agent_contact_id', financeContactId)
        // Both halves of `isPartnerVisible`, as a query: the partner sees what
        // they were actually sent — including that it was later voided — and
        // never an agreement that stayed on our side of the wall.
        .in('status', PARTNER_VISIBLE_STATUSES as unknown as string[])
        .not('issued_at', 'is', null)
        .order('issued_at', { ascending: false, nullsFirst: false });
      if (error) throw error;

      const agreements = (data ?? []).map(partnerView);
      const requiresAttention = agreements.filter((a) =>
        a.status === 'partner_review' || a.status === 'sent_for_signature');
      return json({
        agreements,
        requires_attention: requiresAttention.length,
      });
    }

    // ─── GET (the agreement room payload) ───────────────────
    if (operation === 'get') {
      const agreement = await ownAgreement(body.id);
      if (!agreement) return json({ error: 'Agreement not found' }, 404);
      const id = agreement.id as string;

      // First view is a fact the issuer cares about — record it once.
      if (!agreement.first_viewed_at && agreement.status === 'partner_review') {
        const viewedAt = new Date().toISOString();
        await supabase.from(TABLE).update({ first_viewed_at: viewedAt })
          .eq('id', id).is('first_viewed_at', null);
        await logEvent(supabase, id, 'partner_viewed', actorLabel,
          `Agreement viewed by ${actorLabel}`);
        await notifyAgreementsTeam(supabase, 'Agreement viewed',
          `${agreement.partner_legal_name} has opened the agreement for review.`, id);
        agreement.first_viewed_at = viewedAt;
      }

      const versionId = agreement.issued_version_id as string | null;
      const [versionRes, versionsRes, requestsRes, signaturesRes, eventsRes] = await Promise.all([
        versionId
          ? supabase.from(VERSIONS_TABLE)
            .select('id, version_label, issue_sequence, status, issued_at, field_values, changed_fields, template_key, template_content_hash, executed_at')
            .eq('id', versionId).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from(VERSIONS_TABLE)
          .select('id, version_label, issue_sequence, status, issued_at, changed_fields, executed_at')
          .eq('agreement_id', id).order('issue_sequence', { ascending: false }),
        supabase.from(CHANGE_REQUESTS_TABLE)
          .select('id, section_key, comment, status, resolution_note, resolved_at, created_at')
          .eq('agreement_id', id).order('created_at', { ascending: false }),
        supabase.from(SIGNATURES_TABLE)
          .select('id, version_id, party_role, legal_entity, signatory_name, signatory_title, signature_method, signed_at')
          .eq('agreement_id', id).order('signed_at', { ascending: true }),
        supabase.from(EVENTS_TABLE)
          .select('event_type, actor_label, summary, created_at')
          .eq('agreement_id', id).order('created_at', { ascending: false }).limit(100),
      ]);

      return json({
        agreement: partnerView(agreement),
        current_version: versionRes.data ?? null,
        versions: versionsRes.data ?? [],
        change_requests: requestsRes.data ?? [],
        signatures: signaturesRes.data ?? [],
        events: (eventsRes.data ?? [])
          .filter((event: { event_type: string }) => PARTNER_EVENT_TYPES.has(event.event_type))
          .map(partnerEventView),
      });
    }

    // ─── DOWNLOAD (reference / executed copy) ───────────────
    if (operation === 'download') {
      const agreement = await ownAgreement(body.id);
      if (!agreement) return json({ error: 'Agreement not found' }, 404);
      const id = agreement.id as string;
      const kind = body.kind === 'executed' ? 'executed' : 'issued';

      const versionId = agreement.issued_version_id as string | null;
      if (!versionId) return json({ error: 'No issued version is available yet' }, 404);
      const { data: version } = await supabase.from(VERSIONS_TABLE)
        .select('*').eq('id', versionId).maybeSingle();
      if (!version) return json({ error: 'No issued version is available yet' }, 404);
      if (kind === 'executed' && version.status !== 'executed') {
        return json({ error: 'The agreement has not been fully executed yet' }, 409);
      }

      let path: string | null = kind === 'executed'
        ? version.executed_pdf_storage_path
        : version.pdf_storage_path;

      // Deferred render: generate now from the frozen version row.
      if (!path) {
        const execution = kind === 'executed'
          ? executionContextFromSignatures(
            (await supabase.from(SIGNATURES_TABLE).select('*').eq('version_id', version.id)).data ?? [])
          : null;
        const stored = await renderAndStoreVersionPdf(supabase, supabaseUrl, agreement as never, version, kind, execution);
        path = stored.path;
        await supabase.from(VERSIONS_TABLE)
          .update(kind === 'executed'
            ? { executed_pdf_storage_path: path, executed_pdf_bytes: stored.bytes }
            : { pdf_storage_path: path })
          .eq('id', version.id);
      }

      const fileName = agreementDownloadFileName(
        String(partnerView(agreement).title),
        agreement.partner_legal_name as string,
        version.version_label,
        kind,
      );
      const { data: signed, error: signError } = await supabase.storage
        .from(AGREEMENTS_BUCKET)
        .createSignedUrl(path!, SIGNED_URL_TTL_SECONDS, { download: fileName });
      if (signError || !signed?.signedUrl) {
        throw new Error(`signing failed: ${signError?.message ?? 'no url returned'}`);
      }

      await logEvent(supabase, id, 'partner_downloaded', actorLabel,
        `${kind === 'executed' ? 'Executed copy' : 'Reference copy'} downloaded by ${actorLabel}`,
        { kind, version_label: version.version_label });

      return json({ url: signed.signedUrl, file_name: fileName, expires_in: SIGNED_URL_TTL_SECONDS });
    }

    // ─── ACCEPT ─────────────────────────────────────────────
    if (operation === 'accept') {
      const agreement = await ownAgreement(body.id);
      if (!agreement) return json({ error: 'Agreement not found' }, 404);
      const id = agreement.id as string;
      if (agreement.status !== 'partner_review') {
        return json({ error: 'This agreement is not awaiting your review' }, 409);
      }

      const acceptedAt = new Date().toISOString();
      const { data, error } = await supabase.from(TABLE)
        .update({ status: 'sent_for_signature', accepted_at: acceptedAt })
        .eq('id', id).eq('status', 'partner_review')
        .select().single();
      if (error) throw error;

      await logEvent(supabase, id, 'accepted', actorLabel, `Agreement accepted by ${actorLabel}`);
      await notifyAgreementsTeam(supabase, 'Agreement accepted',
        `${agreement.partner_legal_name} has accepted the agreement and can now sign.`, id);

      return json({ agreement: partnerView(data) });
    }

    // ─── REQUEST CHANGES (structured — never an edit) ───────
    if (operation === 'request_changes') {
      const agreement = await ownAgreement(body.id);
      if (!agreement) return json({ error: 'Agreement not found' }, 404);
      const id = agreement.id as string;
      if (agreement.status !== 'partner_review' && agreement.status !== 'sent_for_signature') {
        return json({ error: 'Changes can only be requested while the agreement is under review' }, 409);
      }

      const sectionKey = typeof body.section_key === 'string' && SECTION_KEYS.has(body.section_key)
        ? body.section_key : 'other';
      const comment = String(body.comment ?? '').trim();
      if (!comment) return json({ error: 'Please describe the change you are requesting' }, 422);
      if (comment.length > 4000) return json({ error: 'Please keep the request under 4000 characters' }, 422);

      const { data: request, error } = await supabase.from(CHANGE_REQUESTS_TABLE).insert({
        agreement_id: id,
        version_id: agreement.issued_version_id ?? null,
        section_key: sectionKey,
        comment,
        requested_by_portal_user_id: portalUser.id,
        requested_by_label: actorLabel,
      }).select().single();
      if (error) throw error;

      if (agreement.status === 'partner_review') {
        await supabase.from(TABLE).update({ status: 'changes_requested' })
          .eq('id', id).eq('status', 'partner_review');
      }

      const sectionLabel = CHANGE_REQUEST_SECTIONS.find((s) => s.key === sectionKey)?.label ?? 'Other';
      await logEvent(supabase, id, 'changes_requested', actorLabel,
        `Changes requested — ${sectionLabel}`, { request_id: request.id, section_key: sectionKey });
      await notifyAgreementsTeam(supabase, 'Changes requested',
        `${agreement.partner_legal_name} has requested changes to the ${sectionLabel}.`, id);

      return json({ change_request: request });
    }

    // ─── SIGN (typed electronic execution) ──────────────────
    if (operation === 'sign') {
      const agreement = await ownAgreement(body.id);
      if (!agreement) return json({ error: 'Agreement not found' }, 404);
      const id = agreement.id as string;
      if (agreement.status !== 'sent_for_signature') {
        return json({ error: 'Accept the agreement before signing it' }, 409);
      }
      const versionId = agreement.issued_version_id as string | null;
      if (!versionId) return json({ error: 'No issued version to sign' }, 409);

      const signatoryName = String(body.signatory_name ?? '').trim();
      const signatureTyped = String(body.signature_typed ?? '').trim();
      if (!signatoryName || !signatureTyped) {
        return json({ error: 'Signatory name and a typed signature are required' }, 422);
      }

      const { error: signatureError } = await supabase.from(SIGNATURES_TABLE).insert({
        agreement_id: id,
        version_id: versionId,
        party_role: 'partner',
        legal_entity: String(body.legal_entity ?? '').trim() || agreement.partner_legal_name,
        signatory_name: signatoryName,
        signatory_title: String(body.signatory_title ?? '').trim() || null,
        signature_typed: signatureTyped,
        signature_method: 'typed_electronic',
        portal_user_id: portalUser.id,
        ip_hash: await telemetryHash(req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')),
        user_agent_hash: await telemetryHash(req.headers.get('user-agent')),
      });
      if (signatureError) {
        if (/duplicate|unique/i.test(signatureError.message)) {
          return json({ error: 'This version has already been signed for your organisation' }, 409);
        }
        throw signatureError;
      }

      const { data, error } = await supabase.from(TABLE)
        .update({ status: 'partially_signed' })
        .eq('id', id).eq('status', 'sent_for_signature')
        .select().single();
      if (error) throw error;

      await logEvent(supabase, id, 'partner_signed', actorLabel,
        `Executed by ${signatoryName} for ${agreement.partner_legal_name}`,
        { signatory_name: signatoryName });
      await notifyAgreementsTeam(supabase, 'Signature completed',
        `${agreement.partner_legal_name} has signed the agreement. Counter-signature required.`, id);

      return json({ agreement: partnerView(data) });
    }

    return json({ error: 'Unknown operation' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[finance-portal-agreements] error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
