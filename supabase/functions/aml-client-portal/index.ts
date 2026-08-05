/**
 * AML/CTF Client Portal (Phase 3)
 *
 * Client-facing onboarding surface. Authenticates via `x-portal-session-token`
 * against `client_portal_sessions` and only ever operates on AML cases whose
 * `client_id` matches the signed-in portal user.
 *
 * Ops:
 *   - overview                     { case_id? }         → landing payload
 *   - get_questionnaire            { case_id, section } → current draft
 *   - save_questionnaire           { case_id, section, payload, submit? }
 *   - get_consents                 { case_id }          → current AUSTRAC-referenced catalogue + acceptance state
 *   - record_consent               { case_id, kind, version?, payload? }
 *   - list_requirements            { case_id }
 *   - request_upload_url           { case_id, requirement_id?, filename, mime_type, size_bytes }
 *   - confirm_upload               { case_id, requirement_id?, storage_path, filename, mime_type, size_bytes, checksum? }
 *   - list_documents               { case_id }
 *   - list_client_requests         { case_id }
 *   - respond_client_request       { request_id, response_payload }
 *   - submit_for_review            { case_id }         → creates submission_versions row
 *
 * Client statuses returned are sanitised — no risk score, no screening results,
 * no MLRO commentary. Only completion + acceptance state.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { validateQuestionnaireSection } from "./questionnaireValidation.ts";
import {
  getIdvProvider,
  resolveTenantProvider,
  ProviderResolutionError,
} from "../_shared/aml/providers/index.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Phase 1 portal-safe contract (directive Appendix C.1). Internal case state
// never reaches the wire: the case is presented through the client-portal
// dimension only. Legacy statuses map onto that dimension for rows created
// before the workflow-dimension migration (mirror of
// src/lib/aml/caseDimensions.ts — keep in sync).
const PORTAL_STATUSES = [
  'not_started', 'action_required', 'in_progress', 'submitted', 'under_review',
  'additional_info_required', 'complete', 'contact_adviser',
] as const;

const LEGACY_TO_PORTAL_STATUS: Record<string, string> = {
  draft: 'not_started',
  kyc_in_progress: 'in_progress',
  kyc_complete: 'submitted',
  edd_required: 'additional_info_required',
  under_review: 'under_review',
  escalated_mlro: 'under_review',
  cleared: 'complete',
  blocked: 'contact_adviser',
  closed: 'complete',
};

const PORTAL_STATUS_PRESENTATION: Record<string, { label: string; tone: 'neutral'|'progress'|'positive'|'caution' }> = {
  not_started:              { label: 'Not started',                     tone: 'neutral'  },
  action_required:          { label: 'Action required',                 tone: 'caution'  },
  in_progress:              { label: 'In progress',                     tone: 'progress' },
  submitted:                { label: 'Received — under review',         tone: 'progress' },
  under_review:             { label: 'Under review',                    tone: 'progress' },
  additional_info_required: { label: 'Additional information required', tone: 'caution'  },
  complete:                 { label: 'Complete',                        tone: 'positive' },
  contact_adviser:          { label: 'Please contact your adviser',     tone: 'caution'  },
};

function portalStatusFor(caseRow: any): string {
  const explicit = caseRow?.client_portal_status;
  if (typeof explicit === 'string' && (PORTAL_STATUSES as readonly string[]).includes(explicit)) {
    return explicit;
  }
  return LEGACY_TO_PORTAL_STATUS[caseRow?.status] ?? 'in_progress';
}

// Phase 5 — versioned conditional questionnaire engine (directive §14.2).
// The section list is SERVER-DRIVEN: `overview` computes the applicable
// sections for this case from the declared purchasing structure and funding
// sources, and the portal renders whatever the server returns. Existing
// version-1 submissions (the four base sections) remain valid unchanged.
const QUESTIONNAIRE_VERSION = '2';

const BASE_SECTIONS = ['purchasing_structure', 'personal_details', 'purchase_profile', 'funding'] as const;
const CONDITIONAL_SECTIONS = ['entity_details', 'related_parties'] as const;
const ALL_SECTIONS: readonly string[] = [...BASE_SECTIONS, ...CONDITIONAL_SECTIONS];

const ENTITY_STRUCTURES = new Set(['Company', 'Trust', 'SMSF', 'Partnership']);
const MULTI_PARTY_STRUCTURES = new Set(['Joint', 'Company', 'Trust', 'SMSF', 'Partnership']);

/**
 * Compute the ordered applicable sections for a case from its questionnaire
 * payloads. Sections already answered but no longer applicable (e.g. the
 * client switches structure from Company to Individual) are retained in
 * storage — never deleted — but drop out of the active checklist.
 */
function applicableSections(
  structurePayload: Record<string, unknown> | null,
  fundingPayload: Record<string, unknown> | null,
): string[] {
  const entityType = String(structurePayload?.entity_type ?? '');
  const fundingSources = Array.isArray(fundingPayload?.sources)
    ? (fundingPayload!.sources as unknown[]).map((s) => String(s))
    : [];
  const giftFunded = fundingSources.includes('Gift');

  const out: string[] = ['purchasing_structure', 'personal_details'];
  if (ENTITY_STRUCTURES.has(entityType)) out.push('entity_details');
  if (MULTI_PARTY_STRUCTURES.has(entityType) || giftFunded) out.push('related_parties');
  out.push('purchase_profile', 'funding');
  return out;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sanitiseFilename(name: string): string {
  return String(name || 'upload').replace(/[^\w.\-]+/g, '_').slice(0, 180);
}

/* ───────────────────────── Consent (AUSTRAC-referenced) ─────────────────────
 * Consent used to be three hard-coded checkboxes gated by localStorage, which
 * is not evidence: nothing recorded what the client was actually shown, and
 * the gate could be stepped around client-side. The catalogue in
 * aml.consent_documents is now the single source of truth, and the gate below
 * is enforced on the server for every op that collects client data.
 *
 * If the catalogue table is unreachable we FAIL CLOSED — a portal that
 * silently collects identity data without a recorded consent is worse than
 * one that is briefly unavailable.
 * ------------------------------------------------------------------------- */

type ConsentDocument = {
  id: string;
  code: string;
  version: string;
  acknowledgement_type: 'consent' | 'notice';
  title: string;
  summary: string;
  body: string;
  statutory_basis: string[];
  reference_links: Array<{ label: string; url: string }>;
  required: boolean;
  sort_order: number;
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Text the acceptance hash is taken over — the exact wording presented. */
function consentCanonicalText(doc: ConsentDocument): string {
  return [doc.code, doc.version, doc.title, doc.summary, doc.body,
    (doc.statutory_basis ?? []).join('|')].join('\n');
}

/** Current (non-retired, in-force) catalogue, ordered for presentation. */
async function loadConsentCatalogue(admin: any): Promise<{ version: string | null; documents: ConsentDocument[] }> {
  const { data, error } = await admin.schema('aml').from('consent_documents')
    .select('*')
    .is('retired_at', null)
    .lte('effective_from', new Date().toISOString())
    .order('version', { ascending: false })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as ConsentDocument[];
  if (rows.length === 0) return { version: null, documents: [] };
  // Highest in-force version wins; a partially-published newer version never
  // mixes with an older one.
  const version = rows[0].version;
  return {
    version,
    documents: rows.filter((r) => r.version === version)
      .sort((a, b) => a.sort_order - b.sort_order),
  };
}

type ConsentState = {
  version: string | null;
  documents: ConsentDocument[];
  accepted: Array<{ code: string; version: string; accepted_at: string }>;
  outstanding: string[];
  satisfied: boolean;
};

async function loadConsentState(admin: any, caseId: string): Promise<ConsentState> {
  const { version, documents } = await loadConsentCatalogue(admin);
  const { data: rows, error } = await admin.schema('aml').from('consents')
    .select('kind, version, accepted_at').eq('case_id', caseId);
  if (error) throw error;
  const accepted = (rows ?? []).map((r: any) => ({
    code: String(r.kind), version: String(r.version), accepted_at: r.accepted_at,
  }));
  // Acceptance is version-specific: republishing the catalogue re-asks.
  const acceptedCurrent = new Set(
    accepted.filter((a) => a.version === version).map((a) => a.code));
  const outstanding = documents
    .filter((d) => d.required && !acceptedCurrent.has(d.code))
    .map((d) => d.code);
  return {
    version, documents, accepted, outstanding,
    // No published catalogue → nothing can be satisfied. Fail closed.
    satisfied: Boolean(version) && documents.length > 0 && outstanding.length === 0,
  };
}

/* ─────────────────────────── identity verification ──────────────────────── */

/** Owner decision of 2026-07-28: one attempt plus two retries. */
const MAX_VERIFICATION_ATTEMPTS = 3;

/** Closed client-action vocabulary (Stage 12) — mirrored by the CHECK
 * constraint in 20260831000100. Anything else projects as null. */
const CLIENT_ACTION_CODES = [
  'complete_identity_verification', 'upload_document', 'update_questionnaire_section',
  'review_consent', 'provide_clarification', 'review_and_submit',
];

/**
 * Stage 22 — server-derived journey. The portal renders exactly what this
 * returns; no completion claim is computed client-side. "Verified" appears
 * only when every applicable party holds an authoritative electronic result
 * or an accepted staff sighting — never from case status alone. Completion
 * wording stays restrained: reuse claims belong to the passport/consent
 * machinery, not this journey.
 */
function buildJourney(args: {
  consentSatisfied: boolean;
  activeSections: string[];
  sectionMap: Map<string, any>;
  requirements: any[];
  parties: Array<{ status: string; can_attempt: boolean }>;
  submissions: any[];
  openRequestCount: number;
  portalStatus: string;
}) {
  const sectionsDone = args.activeSections.every((sec) =>
    ['submitted', 'accepted', 'complete'].includes(args.sectionMap.get(sec)?.status ?? ''));
  const requiredReqs = args.requirements.filter((r: any) => r.required);
  const docsDone = requiredReqs.length > 0 &&
    requiredReqs.every((r: any) => ['uploaded', 'accepted'].includes(r.status));
  const partiesResolved = args.parties.length > 0 &&
    args.parties.every((pt) => pt.status === 'verified');
  const verificationInFlight = args.parties.some((pt) => pt.status === 'in_review');
  const submitted = (args.submissions ?? []).length > 0;
  const complete = args.portalStatus === 'complete';

  const step = (
    key: string, status: 'complete' | 'in_progress' | 'action_required' | 'not_started' | 'blocked',
    label: string, description: string, target: string, completedAt: string | null = null,
  ) => ({
    step: key, status, action_required: status === 'action_required',
    safe_label: label, safe_description: description, target_step: target,
    completed_at: completedAt,
  });

  return [
    step('consent', args.consentSatisfied ? 'complete' : 'action_required',
      'Consents', args.consentSatisfied
        ? 'You have accepted the current consents.'
        : 'Please review and accept the consents to continue.', 'consent'),
    step('questionnaire', sectionsDone ? 'complete' : args.consentSatisfied ? 'action_required' : 'blocked',
      'Your information', sectionsDone
        ? 'All required sections are submitted.'
        : 'Some sections still need to be completed.', 'questionnaire'),
    step('documents', docsDone ? 'complete' : requiredReqs.length === 0 ? 'not_started' : 'action_required',
      'Documents', docsDone
        ? 'All requested documents are uploaded.'
        : 'Some requested documents are outstanding.', 'documents'),
    step('verification',
      partiesResolved ? 'complete' : verificationInFlight ? 'in_progress' : 'action_required',
      'Identity verification',
      partiesResolved
        ? 'You are verified.'
        : verificationInFlight
          ? 'We are checking your identity documents.'
          : 'Identity verification is still to be completed.', 'verify'),
    step('submission', submitted ? 'complete' : 'not_started',
      'Review and submit', submitted
        ? 'Your information has been submitted for review.'
        : 'Submit your onboarding once everything above is complete.', 'review'),
    step('review',
      complete ? 'complete' : args.openRequestCount > 0 ? 'action_required' : submitted ? 'in_progress' : 'not_started',
      complete ? 'Complete' : 'Adviser review',
      complete
        ? 'Your onboarding is complete.'
        : args.openRequestCount > 0
          ? 'Your adviser has asked for something — see your requests.'
          : 'Your adviser is reviewing your information.', 'review'),
  ];
}

/**
 * Attempts already CONSUMED by this party on the electronic path.
 *
 * The truth is aml.verification_attempts_used(): only rows whose provider
 * examination produced an authoritative outcome (attempt_consumed) count —
 * outages, unusable captures, worker retries and simulations never do.
 * MAX(attempt_number) is kept solely as the legacy fallback for a database
 * that has not applied 20260831000000 yet, where every historical row
 * implied a consumed attempt by construction.
 */
async function verificationAttemptsUsed(
  admin: any, caseId: string, partyId: string | null,
): Promise<number> {
  const { data: counted, error: rpcError } = await admin.schema('aml')
    .rpc('verification_attempts_used', { p_case_id: caseId, p_party_id: partyId });
  if (!rpcError && typeof counted === 'number') return counted;

  let q = admin.schema('aml').from('verification_checks')
    .select('attempt_number')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv');
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q.order('attempt_number', { ascending: false }).limit(1);
  if (error) throw error;
  return Number((data ?? [])[0]?.attempt_number ?? 0);
}

/**
 * An in-flight electronic check for this party (submitted/queued/processing/
 * retry_scheduled). A second submission while one is processing would burn
 * provider work and confuse the journey — the portal refuses it safely.
 */
async function activeProcessingCheck(
  admin: any, caseId: string, partyId: string | null,
): Promise<{ id: string; processing_status: string } | null> {
  let q = admin.schema('aml').from('verification_checks')
    .select('id, processing_status')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv')
    .in('processing_status', ['submitted', 'queued', 'processing', 'retry_scheduled']);
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q.limit(1);
  if (error) {
    // Legacy schema without processing_status: nothing can be "in flight".
    if (/processing_status/i.test(error.message ?? '')) return null;
    throw error;
  }
  return (data ?? [])[0] ?? null;
}

/**
 * Client-safe electronic-IDV availability. Internal readiness (provider keys,
 * environment classification, secret presence) NEVER crosses this boundary —
 * the portal learns only whether capture may proceed.
 */
async function clientSafeIdvAvailability(admin: any): Promise<'available' | 'temporarily_unavailable' | 'manual_verification_required'> {
  try {
    const resolved = await resolveTenantProvider(admin, 'default', 'idv');
    getIdvProvider({ resolved, admin });
    return 'available';
  } catch (err: any) {
    if (err instanceof ProviderResolutionError) {
      // Not configured / simulator blocked → the adviser will arrange manual
      // sighting; transient misconfiguration reads as temporary.
      return err.code === 'provider_misconfigured'
        ? 'temporarily_unavailable'
        : 'manual_verification_required';
    }
    return 'temporarily_unavailable';
  }
}


/**
 * Stable per-party identifier derived from the case and the declared name.
 *
 * Parties the CLIENT declared live in their questionnaire, not in the staff
 * ownership model, so they have no database id of their own. A deterministic
 * uuid keeps the attempt ceiling enforceable per party across requests
 * without inventing a row the client can see.
 */
async function derivedPartyId(caseId: string, name: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`${caseId}|${name.trim().toLowerCase()}`));
  const h = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3 | 0x8).toString(16)) + h.slice(17, 20), h.slice(20, 32)].join('-');
}

/**
 * Parties the client still has to verify: themselves, plus anyone they
 * declared in the related-parties section of their own questionnaire.
 *
 * The staff ownership model is deliberately NOT read here. Beneficial-owner
 * records carry internal analysis (control assessments, screening state), and
 * the portal boundary is drawn at the table rather than per-field so that it
 * cannot be eroded one column at a time. Everything below comes from what the
 * client typed themselves.
 */
async function verificationParties(admin: any, caseId: string) {
  const { data: caseRow } = await admin.schema('aml').from('cases')
    .select('subject_display_name').eq('id', caseId).maybeSingle();

  const { data: sections } = await admin.schema('aml').from('questionnaire_responses')
    .select('section, payload').eq('case_id', caseId).eq('section', 'related_parties');

  const declared: string[] = [];
  const payload = (sections ?? [])[0]?.payload ?? {};
  for (const entry of (Array.isArray(payload?.parties) ? payload.parties : [])) {
    const name = String((entry as any)?.full_name ?? (entry as any)?.name ?? '').trim();
    if (name) declared.push(name.slice(0, 200));
  }

  const { data: checks } = await admin.schema('aml').from('verification_checks')
    .select('party_id, attempt_number, status, check_type')
    .eq('case_id', caseId);

  const targets: Array<{ id: string | null; label: string }> = [
    { id: null, label: String(caseRow?.subject_display_name ?? 'You') },
  ];
  for (const name of declared) {
    targets.push({ id: await derivedPartyId(caseId, name), label: name });
  }

  // Internal states collapse to what the client can act on. No score, no
  // threshold, no reason for a referral (Appendix C.1).
  const CLIENT_VISIBLE: Record<string, string> = {
    passed: 'verified',
    failed: 'action_required',
    referred: 'in_review',
    exhausted: 'contact_adviser',
    pending: 'in_review',
    in_progress: 'in_review',
    abandoned: 'not_started',
  };

  return targets.map((t) => {
    const mine = (checks ?? []).filter((c: any) =>
      (t.id === null ? c.party_id === null : String(c.party_id) === t.id));
    const electronic = mine.filter((c: any) => c.check_type === 'electronic_idv');
    const used = electronic.reduce((max: number, c: any) =>
      Math.max(max, Number(c.attempt_number ?? 0)), 0);
    // A staff document sighting settles the party regardless of attempts.
    const sighted = mine.some((c: any) => c.check_type === 'document_sighting' && c.status === 'passed');
    const latest = mine.slice().sort((a: any, b: any) =>
      Number(b.attempt_number ?? 0) - Number(a.attempt_number ?? 0))[0];

    const rawStatus = sighted ? 'passed' : (latest?.status ?? 'not_started');
    return {
      party_id: t.id,
      label: t.label,
      status: CLIENT_VISIBLE[rawStatus] ?? 'not_started',
      attempts_used: used,
      attempts_remaining: Math.max(0, MAX_VERIFICATION_ATTEMPTS - used),
      can_attempt: !sighted && used < MAX_VERIFICATION_ATTEMPTS && rawStatus !== 'passed',
    };
  });
}

function consentRequiredResponse(state: ConsentState) {
  return jsonResponse({
    error: state.version
      ? 'Please review and accept the consents and disclosures before continuing.'
      : 'Consents and disclosures are being updated. Please try again shortly or contact your adviser.',
    code: 'consent_required',
    consent: {
      version: state.version,
      outstanding: state.outstanding,
      satisfied: state.satisfied,
    },
  }, 403);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const token = req.headers.get('x-portal-session-token') ||
      body?.portal_session_token || req.headers.get('x-session-token') ||
      body?.session_token;
    if (!token) return jsonResponse({ error: 'Portal session token required' }, 401);

    // Session lookup mirrors get-portal-client-data (the proven production
    // contract): select ONLY columns that exist on client_portal_users in
    // every environment. This function once embedded a `full_name` column the
    // production table does not have; PostgREST rejected the whole select,
    // the error object was discarded, and every op answered 401 — which the
    // portal then rendered as "no case yet". Never widen this select without
    // checking the deployed schema, and never discard the error.
    const { data: session, error: sessionError } = await admin
      .from('client_portal_sessions')
      .select('user_id, expires_at, revoked_at, client_portal_users:user_id(id, client_id, email, status)')
      .eq('session_token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (sessionError) {
      console.error('aml-client-portal session lookup failed', sessionError.message);
      return jsonResponse({
        error: 'We could not confirm your session. Please sign in again.',
        code: 'portal_session_lookup_failed',
      }, 401);
    }

    const portalUser = (session as any)?.client_portal_users;
    if (!portalUser || portalUser.status !== 'active' || (session as any)?.revoked_at) {
      return jsonResponse({
        error: 'Invalid or expired session',
        code: 'portal_session_invalid',
      }, 401);
    }
    const clientId: string = portalUser.client_id;
    const portalUserId: string = portalUser.id;
    const actorLabel: string = portalUser.email || 'client-portal';

    const op = String(body?.op ?? '');
    if (!op) return jsonResponse({ error: 'op is required' }, 400);

    // Resolve target case scoped to this client.
    async function resolveCase(caseId?: string) {
      let q = admin.schema('aml').from('cases').select('*').eq('client_id', clientId);
      if (caseId) q = q.eq('id', caseId);
      const { data, error } = await q.order('opened_at', { ascending: false }).limit(1);
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    }

    switch (op) {
      case 'overview': {
        const c = await resolveCase(body.case_id);
        // The portal renders this string verbatim, so it must be the copy a
        // client should read — not an API status line. "No AML onboarding case
        // yet." rendered as the whole empty state and read like something had
        // gone wrong; the reassuring sentence lives here rather than in the SPA
        // so every consumer (portal, mobile) shows the same words.
        if (!c) {
          return jsonResponse({
            case: null,
            message:
              'Your adviser hasn’t opened an identity and compliance case for you yet. '
              + 'You’ll be notified when it’s ready — there is nothing for you to do now.',
          });
        }
        const [{ data: sections }, { data: requirements }, { data: openRequests }, { data: submissions }] = await Promise.all([
          admin.schema('aml').from('questionnaire_responses')
            .select('section,status,updated_at,payload').eq('case_id', c.id),
          admin.schema('aml').from('document_requirements')
            .select('*').eq('case_id', c.id).order('created_at', { ascending: true }),
          admin.schema('aml').from('client_requests')
            .select('*').eq('case_id', c.id).in('status', ['open','responded'])
            .order('created_at', { ascending: false }),
          admin.schema('aml').from('submission_versions')
            .select('version_number,status,submitted_at,reviewed_at')
            .eq('case_id', c.id).order('version_number', { ascending: false }).limit(3),
        ]);
        const reqs = requirements ?? [];
        const totalReq = reqs.filter((r: any) => r.required).length;
        const completedReq = reqs.filter((r: any) => r.required && ['uploaded','accepted'].includes(r.status)).length;
        const sectionMap = new Map((sections ?? []).map((s: any) => [s.section, s]));
        const active = applicableSections(
          sectionMap.get('purchasing_structure')?.payload ?? null,
          sectionMap.get('funding')?.payload ?? null,
        );
        const portalStatus = portalStatusFor(c);
        const presentation = PORTAL_STATUS_PRESENTATION[portalStatus] ?? { label: 'In progress', tone: 'progress' as const };
        // Server-owned consent state — the portal stepper mirrors this rather
        // than trusting a browser-local flag.
        const consentState = await loadConsentState(admin, c.id);
        return jsonResponse({
          case: {
            id: c.id, reference: c.case_reference, subject: c.subject_display_name,
            opened_at: c.opened_at,
            // Portal-safe dimension token — internal case state is not shipped.
            status: portalStatus, portal_status: portalStatus,
            status_label: presentation.label, status_tone: presentation.tone,
          },
          questionnaire_version: QUESTIONNAIRE_VERSION,
          consent: {
            version: consentState.version,
            satisfied: consentState.satisfied,
            outstanding: consentState.outstanding,
            required_count: consentState.documents.filter((d) => d.required).length,
          },
          structure_type: String(sectionMap.get('purchasing_structure')?.payload?.entity_type ?? '') || null,
          sections: active.map((s) => ({
            section: s, status: sectionMap.get(s)?.status ?? 'not_started',
            updated_at: sectionMap.get(s)?.updated_at ?? null,
          })),
          requirements: reqs.map((r: any) => ({
            id: r.id, code: r.code, label: r.label, description: r.description,
            required: r.required, status: r.status, due_at: r.due_at, assigned_to_party: r.assigned_to_party,
          })),
          requirement_progress: { completed: completedReq, total: totalReq },
          open_requests: (openRequests ?? []).map((r: any) => ({
            id: r.id, kind: r.kind, subject: r.subject, message: r.message,
            status: r.status, created_at: r.created_at,
            // Closed action vocabulary only — anything uncatalogued projects
            // as null, and routing fields are the safe whitelisted subset.
            // Arbitrary URLs from request payloads never reach the client.
            action_code: CLIENT_ACTION_CODES.includes(String(r.action_code ?? '')) ? r.action_code : null,
            action_target: {
              target_step: typeof r.action_target?.target_step === 'string' ? r.action_target.target_step.slice(0, 60) : null,
              requirement_id: typeof r.action_target?.requirement_id === 'string' ? r.action_target.requirement_id : null,
              section_code: typeof r.action_target?.section_code === 'string' ? r.action_target.section_code.slice(0, 60) : null,
            },
            due_at: r.due_at ?? null,
          })),
          recent_submissions: submissions ?? [],
          journey: buildJourney({
            consentSatisfied: consentState.satisfied,
            activeSections: active,
            sectionMap,
            requirements: reqs,
            parties: await verificationParties(admin, c.id),
            submissions: submissions ?? [],
            openRequestCount: (openRequests ?? []).length,
            portalStatus,
          }),
        });
      }

      case 'get_questionnaire': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        if (!ALL_SECTIONS.includes(body.section)) return jsonResponse({ error: 'Invalid section' }, 400);
        const { data } = await admin.schema('aml').from('questionnaire_responses')
          .select('*').eq('case_id', c.id).eq('section', body.section).maybeSingle();
        return jsonResponse({ response: data ?? null });
      }

      case 'save_questionnaire': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        // Consent precedes collection (Privacy Act 1988, APP 3/5). Enforced
        // here, not only in the UI stepper.
        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);
        // Validated against the full catalogue (not the currently-applicable
        // subset) so an in-flight save is never rejected by a concurrent
        // structure change; superseded answers are retained, never deleted.
        if (!ALL_SECTIONS.includes(body.section)) return jsonResponse({ error: 'Invalid section' }, 400);
        const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? body.payload
          : {};
        if (body.submit) {
          const { data: structureResponse } = body.section === 'entity_details'
            ? await admin.schema('aml').from('questionnaire_responses')
              .select('payload').eq('case_id', c.id).eq('section', 'purchasing_structure').maybeSingle()
            : { data: null };
          const invalidFields = validateQuestionnaireSection(
            body.section,
            payload,
            structureResponse?.payload,
          );
          if (invalidFields.length > 0) {
            return jsonResponse({
              error: 'Cannot submit — section contains invalid or missing fields',
              invalid_fields: invalidFields,
            }, 400);
          }
        }
        const row: Record<string, any> = {
          case_id: c.id, section: body.section, payload,
          status: body.submit ? 'submitted' : 'draft',
          submitted_at: body.submit ? new Date().toISOString() : null,
          submitted_by_type: 'client', submitted_by: portalUserId,
        };
        const { data, error } = await admin.schema('aml').from('questionnaire_responses')
          .upsert(row, { onConflict: 'case_id,section' }).select('*').single();
        if (error) throw error;
        return jsonResponse({ response: data });
      }

      case 'get_consents': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const state = await loadConsentState(admin, c.id);
        const acceptedAt = new Map(
          state.accepted.filter((a) => a.version === state.version).map((a) => [a.code, a.accepted_at]));
        return jsonResponse({
          version: state.version,
          satisfied: state.satisfied,
          outstanding: state.outstanding,
          documents: state.documents.map((d) => ({
            code: d.code,
            title: d.title,
            summary: d.summary,
            body: d.body,
            acknowledgement_type: d.acknowledgement_type,
            statutory_basis: d.statutory_basis ?? [],
            reference_links: d.reference_links ?? [],
            required: d.required,
            accepted_at: acceptedAt.get(d.code) ?? null,
          })),
        });
      }

      case 'record_consent': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const code = String(body.kind ?? body.code ?? '').trim();
        if (!code) return jsonResponse({ error: 'kind is required' }, 400);
        if (body.accepted === false) {
          return jsonResponse({ error: 'Acceptance is required to record a consent' }, 400);
        }

        // The acceptance must name a document that is actually published and
        // current — otherwise the record could not be tied back to wording.
        const { version, documents } = await loadConsentCatalogue(admin);
        const doc = documents.find((d) => d.code === code);
        if (!doc) {
          return jsonResponse({
            error: 'Unknown or superseded consent document', code: 'consent_document_unknown',
            current_version: version,
          }, 400);
        }
        if (body.version && String(body.version) !== doc.version) {
          return jsonResponse({
            error: 'This consent has been updated. Please reload and review the current wording.',
            code: 'consent_version_stale', current_version: doc.version,
          }, 409);
        }

        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
        const ua = req.headers.get('user-agent') ?? null;
        // Hash of the exact text presented, so the acceptance stays meaningful
        // even if the catalogue row is later corrected or retired.
        const documentHash = await sha256Hex(consentCanonicalText(doc));
        const row = {
          case_id: c.id, kind: doc.code, version: doc.version,
          actor_type: 'client', actor_id: portalUserId, actor_label: actorLabel,
          ip_address: ip, user_agent: ua,
          document_id: doc.id, document_hash: documentHash,
          payload: {
            ...(body.payload && typeof body.payload === 'object' ? body.payload : {}),
            acknowledgement_type: doc.acknowledgement_type,
            title: doc.title,
            statutory_basis: doc.statutory_basis ?? [],
          },
        };
        let { data, error } = await admin.schema('aml').from('consents')
          .upsert(row, { onConflict: 'case_id,kind,version' }).select('*').single();
        if (error && /document_id|document_hash|no unique|constraint/i.test(error.message ?? '')) {
          // Catalogue migration not applied yet — record the acceptance rather
          // than losing it, and let the state read decide the gate.
          const { document_id: _d, document_hash: _h, ...legacy } = row as any;
          ({ data, error } = await admin.schema('aml').from('consents')
            .insert(legacy).select('*').single());
        }
        if (error) throw error;

        const state = await loadConsentState(admin, c.id);
        return jsonResponse({
          consent: data,
          consent_state: {
            version: state.version, satisfied: state.satisfied, outstanding: state.outstanding,
          },
        });
      }

      case 'verification_status': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ parties: [], enabled: false });
        const consentState = await loadConsentState(admin, c.id);
        const parties = await verificationParties(admin, c.id);
        // Client-safe availability only — never provider names, environment
        // classification, secret presence or internal health detail.
        const availability = await clientSafeIdvAvailability(admin);
        return jsonResponse({
          enabled: true,
          availability,
          max_attempts: MAX_VERIFICATION_ATTEMPTS,
          // The biometric consent is separate (APP 3.3) and is what unlocks
          // the facial check specifically.
          biometric_consent_accepted: !consentState.outstanding.includes('biometric_collection')
            && consentState.documents.some((d) => d.code === 'biometric_collection'),
          parties,
        });
      }

      case 'submit_verification': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);

        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);

        const partyId = body.party_id ? String(body.party_id) : null;
        const partyLabel = String(body.party_label ?? c.subject_display_name ?? 'Customer').slice(0, 200);

        // Attempt ceiling is the database's job too, but check here so the
        // client gets a clear message rather than a constraint violation.
        const used = await verificationAttemptsUsed(admin, c.id, partyId);
        if (used >= MAX_VERIFICATION_ATTEMPTS) {
          return jsonResponse({
            error: 'You have used all available attempts. A member of our team will contact you to complete verification another way.',
            code: 'attempts_exhausted',
            attempts_used: used,
            max_attempts: MAX_VERIFICATION_ATTEMPTS,
          }, 409);
        }

        // The biometric consent must be recorded BEFORE a face is captured —
        // consent after collection is not consent (APP 3.3).
        const { data: bioConsent } = await admin.schema('aml').from('consents')
          .select('id, version').eq('case_id', c.id).eq('kind', 'biometric_collection')
          .order('accepted_at', { ascending: false }).limit(1).maybeSingle();
        if (!bioConsent) {
          return jsonResponse({
            error: 'Please accept the facial verification consent before continuing.',
            code: 'biometric_consent_required',
          }, 403);
        }

        const documentPath = String(body.document_storage_path ?? '').trim();
        const selfiePath = String(body.selfie_storage_path ?? '').trim();
        if (!documentPath || !selfiePath) {
          return jsonResponse({ error: 'document_storage_path and selfie_storage_path are required' }, 400);
        }
        // Both objects must live under this case's prefix — a client must not
        // be able to name someone else's upload.
        for (const [label, p] of [['document', documentPath], ['selfie', selfiePath]] as const) {
          if (!p.startsWith(`${c.id}/`)) {
            return jsonResponse({ error: `Invalid ${label} path` }, 400);
          }
        }

        // Live-provider readiness gates the SUBMISSION, not just the UI: a
        // capture must never sit against a provider that cannot examine it.
        const availability = await clientSafeIdvAvailability(admin);
        if (availability !== 'available') {
          return jsonResponse({
            error: availability === 'manual_verification_required'
              ? 'Electronic verification is not available for your case. Your adviser will arrange verification another way.'
              : 'Verification is temporarily unavailable. Please try again shortly — nothing has been used up.',
            code: availability,
          }, 409);
        }

        // One in-flight check per party: a duplicate submission neither
        // creates a second row nor calls the provider twice.
        const active = await activeProcessingCheck(admin, c.id, partyId);
        if (active) {
          return jsonResponse({
            submitted: true,
            status: 'processing',
            code: 'already_processing',
            message: 'Your verification is already being checked. We will update you shortly.',
          });
        }

        // Stable per-capture idempotency: resubmitting the SAME captures
        // collapses onto one row (unique index), while a new capture pair is
        // a genuinely new submission.
        const idempotencyKey = 'portal-idv-' + await sha256Hex(`${c.id}|${partyId ?? 'subject'}|${documentPath}|${selfiePath}`);

        const baseRow = {
          case_id: c.id,
          party_id: partyId,
          party_label: partyLabel,
          check_type: 'electronic_idv',
          attempt_number: used + 1,
          status: 'pending',
          provider: 'selfhosted',
          biometric_kind: 'face_image',
          biometric_storage_path: selfiePath,
          biometric_captured_at: new Date().toISOString(),
          biometric_consent_id: bioConsent.id,
          document_reference: documentPath,
          outcome_detail: { submitted_from: 'client_portal' },
        };
        // Canonical-model columns stamped at creation; the AFTER-trigger from
        // 20260831000100 emits aml.verification.requested in the same
        // transaction, and the worker takes it from there. Legacy-schema
        // retry keeps the portal working before the migration is applied.
        let { data: created, error: insErr } = await admin.schema('aml')
          .from('verification_checks').insert({
            ...baseRow,
            processing_status: 'queued',
            capture_sequence: used + 1,
            attempt_consumed: false,
            execution_mode: 'live',
            idempotency_key: idempotencyKey,
          }).select('*').single();
        if (insErr && /processing_status|capture_sequence|attempt_consumed|execution_mode|idempotency_key/i.test(insErr.message ?? '')) {
          ({ data: created, error: insErr } = await admin.schema('aml')
            .from('verification_checks').insert(baseRow).select('*').single());
        }
        if (insErr) {
          if (insErr.code === '23514') {
            return jsonResponse({
              error: 'You have used all available attempts.', code: 'attempts_exhausted',
            }, 409);
          }
          if (insErr.code === '23505') {
            // Same captures already submitted — idempotent success.
            return jsonResponse({
              submitted: true, status: 'processing', code: 'already_processing',
              message: 'Your verification is already being checked. We will update you shortly.',
            });
          }
          throw insErr;
        }

        // Adjudication happens staff-side. The portal deliberately does not
        // learn the score, the threshold, or why a check was referred —
        // that is internal AML information (Appendix C.1). Attempts shown
        // are CONSUMED attempts: a technical failure will not move them.
        return jsonResponse({
          submitted: true,
          attempt_number: created.attempt_number,
          attempts_remaining: MAX_VERIFICATION_ATTEMPTS - used,
          status: 'processing',
          message: 'Thank you. We are checking your identity documents and will be in touch if anything else is needed.',
        });
      }

      case 'request_verification_upload_url': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);

        const kind = String(body.kind ?? '');
        if (!['document', 'selfie'].includes(kind)) {
          return jsonResponse({ error: 'kind must be "document" or "selfie"' }, 400);
        }
        // A biometric is only ever COLLECTED when a live provider can examine
        // it, attempts remain, and nothing is already processing. Collecting
        // a face against a dead provider would be collection without purpose
        // (APP 3) — the gate sits on the upload URL, before any capture UI.
        if (kind === 'selfie') {
          const availability = await clientSafeIdvAvailability(admin);
          if (availability !== 'available') {
            return jsonResponse({
              error: availability === 'manual_verification_required'
                ? 'Electronic verification is not available for your case. Your adviser will arrange verification another way.'
                : 'Verification is temporarily unavailable. Please try again shortly.',
              code: availability,
            }, 409);
          }
          const uploadPartyId = body.party_id ? String(body.party_id) : null;
          const used = await verificationAttemptsUsed(admin, c.id, uploadPartyId);
          if (used >= MAX_VERIFICATION_ATTEMPTS) {
            return jsonResponse({
              error: 'You have used all available attempts. A member of our team will contact you.',
              code: 'attempts_exhausted',
            }, 409);
          }
          const active = await activeProcessingCheck(admin, c.id, uploadPartyId);
          if (active) {
            return jsonResponse({
              error: 'Your previous submission is still being checked.',
              code: 'already_processing',
            }, 409);
          }
        }
        // Selfies go to the biometrics bucket, never to aml-documents: the
        // tighter access policy and the access log both hang off that bucket.
        const bucket = kind === 'selfie' ? 'aml-biometrics' : 'aml-documents';
        const key = `${c.id}/${kind}-${crypto.randomUUID()}.jpg`;
        const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(key);
        if (error) throw error;
        return jsonResponse({
          upload_url: data.signedUrl, token: data.token, path: key, bucket,
        });
      }

      case 'list_requirements': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ requirements: [] });
        const { data } = await admin.schema('aml').from('document_requirements')
          .select('*').eq('case_id', c.id).order('created_at', { ascending: true });
        return jsonResponse({ requirements: data ?? [] });
      }

      case 'request_upload_url': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const uploadConsent = await loadConsentState(admin, c.id);
        if (!uploadConsent.satisfied) return consentRequiredResponse(uploadConsent);
        const filename = sanitiseFilename(body.filename);
        const mime = String(body.mime_type ?? 'application/octet-stream');
        const size = Number(body.size_bytes ?? 0);
        if (!filename) return jsonResponse({ error: 'filename required' }, 400);
        if (size > MAX_UPLOAD_BYTES) return jsonResponse({ error: 'File exceeds 25 MB limit' }, 413);
        const key = `${c.id}/${crypto.randomUUID()}-${filename}`;
        const { data, error } = await admin.storage.from('aml-documents')
          .createSignedUploadUrl(key);
        if (error) throw error;
        return jsonResponse({
          upload_url: data.signedUrl, token: data.token, path: key,
          filename, mime_type: mime, size_bytes: size,
        });
      }

      case 'confirm_upload': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const confirmConsent = await loadConsentState(admin, c.id);
        if (!confirmConsent.satisfied) return consentRequiredResponse(confirmConsent);
        if (!body.storage_path || !body.filename) return jsonResponse({ error: 'storage_path + filename required' }, 400);
        const storagePath = String(body.storage_path);
        const pathParts = storagePath.split('/');
        if (pathParts.length !== 2 || pathParts[0] !== c.id || !pathParts[1]) {
          return jsonResponse({ error: 'Invalid path' }, 400);
        }
        const objectName = pathParts[1];
        const { data: storedObjects, error: storageError } = await admin.storage
          .from('aml-documents')
          .list(c.id, { search: objectName, limit: 100 });
        if (storageError) throw storageError;
        if (!(storedObjects ?? []).some((object) => object.name === objectName && object.id)) {
          return jsonResponse({ error: 'Uploaded file not found' }, 400);
        }
        let reqId: string | null = body.requirement_id ?? null;
        if (reqId) {
          const { data: rr } = await admin.schema('aml').from('document_requirements')
            .select('id, case_id').eq('id', reqId).maybeSingle();
          if (!rr || rr.case_id !== c.id) reqId = null;
        }
        const { data: doc, error } = await admin.schema('aml').from('documents').insert({
          case_id: c.id, requirement_id: reqId,
          filename: sanitiseFilename(body.filename),
          storage_path: storagePath,
          mime_type: body.mime_type ?? null, size_bytes: body.size_bytes ?? null,
          checksum: body.checksum ?? null,
          uploaded_by_type: 'client', uploaded_by: portalUserId,
        }).select('*').single();
        if (error) throw error;
        if (reqId) {
          await admin.schema('aml').from('document_requirements')
            .update({ status: 'uploaded' }).eq('id', reqId);
        }
        return jsonResponse({ document: doc });
      }

      case 'list_documents': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ documents: [] });
        const { data } = await admin.schema('aml').from('documents')
          .select('id, requirement_id, filename, mime_type, size_bytes, status, uploaded_at, rejection_reason')
          .eq('case_id', c.id).neq('status', 'deleted')
          .order('uploaded_at', { ascending: false });
        return jsonResponse({ documents: data ?? [] });
      }

      case 'list_client_requests': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ requests: [] });
        const { data } = await admin.schema('aml').from('client_requests')
          .select('id, kind, subject, message, status, created_at, responded_at, response_payload')
          .eq('case_id', c.id).order('created_at', { ascending: false });
        return jsonResponse({ requests: data ?? [] });
      }

      case 'respond_client_request': {
        if (!body.request_id) return jsonResponse({ error: 'request_id required' }, 400);
        const { data: rr } = await admin.schema('aml').from('client_requests')
          .select('*, cases:case_id(client_id)').eq('id', body.request_id).maybeSingle();
        if (!rr || (rr as any).cases?.client_id !== clientId) return jsonResponse({ error: 'Not found' }, 404);
        // Versioned response contract (v1): one shape both sides read.
        // Historical free-form payloads stay readable staff-side through the
        // compatibility projection; new writes are always v1.
        const raw = body.response_payload && typeof body.response_payload === 'object' && !Array.isArray(body.response_payload)
          ? body.response_payload : {};
        const responsePayload = {
          version: 1,
          text: String(raw.text ?? raw.message ?? '').slice(0, 4000),
          attachments: Array.isArray(raw.attachments)
            ? raw.attachments.filter((a: unknown) => typeof a === 'string').slice(0, 10)
            : [],
          completed_action: CLIENT_ACTION_CODES.includes(String(raw.completed_action ?? ''))
            ? raw.completed_action : null,
          submitted_at: new Date().toISOString(),
        };
        if (!responsePayload.text && responsePayload.attachments.length === 0 && !responsePayload.completed_action) {
          return jsonResponse({ error: 'A response needs text, an attachment reference or a completed action.' }, 400);
        }
        const { data, error } = await admin.schema('aml').from('client_requests').update({
          status: 'responded', responded_at: new Date().toISOString(),
          responded_by: portalUserId, response_payload: responsePayload,
          response_version: 1,
        }).eq('id', body.request_id).select('*').single();
        if (error) throw error;
        return jsonResponse({ request: data });
      }

      case 'submit_for_review': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const submitConsent = await loadConsentState(admin, c.id);
        if (!submitConsent.satisfied) return consentRequiredResponse(submitConsent);
        const [{ data: sections }, { data: reqs }, { data: docs }, { data: consents }] = await Promise.all([
          admin.schema('aml').from('questionnaire_responses').select('*').eq('case_id', c.id),
          admin.schema('aml').from('document_requirements').select('*').eq('case_id', c.id),
          admin.schema('aml').from('documents').select('*').eq('case_id', c.id).neq('status', 'deleted'),
          admin.schema('aml').from('consents')
            .select('kind, version, accepted_at, document_hash').eq('case_id', c.id),
        ]);
        const missingRequired = (reqs ?? []).filter((r: any) => r.required && !['uploaded','accepted'].includes(r.status));
        if (missingRequired.length > 0) {
          return jsonResponse({
            error: 'Cannot submit — required documents missing',
            missing: missingRequired.map((r: any) => ({ code: r.code, label: r.label })),
          }, 400);
        }
        // Phase 5: every currently-applicable section must be submitted before
        // the client can finalise (the checklist itself is conditional).
        const bySection = new Map((sections ?? []).map((s: any) => [s.section, s]));
        const active = applicableSections(
          bySection.get('purchasing_structure')?.payload ?? null,
          bySection.get('funding')?.payload ?? null,
        );
        const missingSections = active.filter((s) => {
          const response = bySection.get(s);
          return !['submitted', 'accepted', 'complete'].includes(response?.status ?? '') ||
            validateQuestionnaireSection(
              s,
              response?.payload,
              bySection.get('purchasing_structure')?.payload,
            ).length > 0;
        });
        if (missingSections.length > 0) {
          return jsonResponse({
            error: 'Cannot submit — some sections are incomplete',
            missing_sections: missingSections,
          }, 400);
        }
        const { data: lastSub } = await admin.schema('aml').from('submission_versions')
          .select('version_number').eq('case_id', c.id).order('version_number', { ascending: false }).limit(1);
        const nextVersion = ((lastSub ?? [])[0]?.version_number ?? 0) + 1;
        const snapshot = {
          case: { id: c.id, reference: c.case_reference, subject: c.subject_display_name },
          questionnaire_version: QUESTIONNAIRE_VERSION,
          consent_version: submitConsent.version,
          applicable_sections: active,
          sections: sections ?? [], requirements: reqs ?? [], documents: docs ?? [], consents: consents ?? [],
          submitted_by: { id: portalUserId, label: actorLabel },
        };
        const { data: sub, error } = await admin.schema('aml').from('submission_versions').insert({
          case_id: c.id, version_number: nextVersion, snapshot,
          submitted_by_type: 'client', submitted_by: portalUserId,
        }).select('*').single();
        if (error) throw error;
        // Push case status forward (draft → kyc_in_progress → kyc_complete for
        // review) and keep the Phase 1 dimension columns coherent; retry
        // without them when the workflow-dimension migration is not applied.
        if (['draft','kyc_in_progress'].includes(c.status)) {
          const { error: upErr } = await admin.schema('aml').from('cases')
            .update({ status: 'kyc_complete', case_stage: 'client_submitted', client_portal_status: 'submitted' })
            .eq('id', c.id);
          if (upErr) {
            await admin.schema('aml').from('cases').update({ status: 'kyc_complete' }).eq('id', c.id);
          }
        }
        return jsonResponse({ submission: sub, next_version: nextVersion });
      }

      default:
        return jsonResponse({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (err: any) {
    console.error('aml-client-portal error', err);
    return jsonResponse({ error: err?.message ?? String(err) }, 500);
  }
});
