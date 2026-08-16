/**
 * AML/CTF Case Engine (Phase 1)
 *
 * Ops:
 *  - list           { status?, risk?, assigned_to_me?, search?, limit?, offset? }
 *  - get            { case_id }
 *  - create         { subject_display_name, subject_type?, client_id?, purchase_file_id?, risk_rating?, notes? }
 *  - update         { case_id, patch: { subject_display_name?, risk_rating?, risk_score?, assigned_analyst_id?, assigned_mlro_id?, metadata? } }
 *  - transition     { case_id, to_status, reason? }
 *  - append_event   { case_id, category, summary, payload? }
 *  - list_events    { case_id, limit? }
 *
 * All writes are appended to `aml.case_events` with a per-case SHA-256 hash chain
 * (prev_hash + row_hash) for tamper-evidence. Reads require any AML role; writes
 * require action-specific analyst/reviewer/mlro authorization. Because this
 * function uses the service role, these checks enforce the underlying RLS role
 * boundaries in code as well.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
import {
  diffSubmissions, submissionDiffIsMaterial,
  CLIENT_SAFE_REJECTION_REASONS, CLIENT_SAFE_REJECTION_COPY, isClientSafeRejectionReason,
} from "../_shared/aml/submissionReview.ts";
import {
  CLIENT_SEARCH_SELECT,
  buildClientSearchOrFilter,
  sanitizeClientSearchQuery,
  selectActivationMatches,
  selectActivationPage,
  tokenizeClientSearch,
  toActivationClientResult,
  isBrowseQuery,
  isClientPickerStatus,
  orderBrowsedClients,
  clampPageSize,
  clampOffset,
  type ClientSearchRow,
  type ClientPickerStatus,
} from "../_shared/aml/clientSearchMatch.pure.ts";
import { sanitiseDocumentName } from "../_shared/aml/documentNaming.pure.ts";
import {
  decideScreeningPolicy,
  deriveMissingScreeningSubjects,
  deriveScreeningNextAction,
  PRIMARY_SUBJECT_PARTY_TYPE,
  SCREENING_POLICY_VERSION,
  SCREENING_STALL_SECONDS,
} from "../_shared/aml/screeningPolicy.pure.ts";
import {
  isPartyScreeningMissing,
  projectPartyScreeningState,
} from "../_shared/aml/partyScreening.pure.ts";

import {
  sanitiseActionCode, sanitiseActionTarget,
} from "../_shared/aml/clientRequestContract.pure.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CASE_STATUSES = [
  'draft', 'kyc_in_progress', 'kyc_complete', 'edd_required',
  'under_review', 'escalated_mlro', 'cleared', 'blocked', 'closed',
] as const;

const RISK_RATINGS = ['low', 'medium', 'high', 'prohibited'] as const;

const EVENT_CATEGORIES = [
  'case_created', 'status_changed', 'risk_rescored', 'document_added',
  'idv_result', 'pep_sanctions_hit', 'edd_note', 'mlro_decision',
  'austrac_report', 'system',
] as const;

const MLRO_ONLY_EVENT_CATEGORIES = new Set<string>(['mlro_decision', 'system']);

// Allowed transitions (defence-in-depth on top of MLRO overrides)
const TRANSITIONS: Record<string, string[]> = {
  draft: ['kyc_in_progress', 'closed'],
  kyc_in_progress: ['kyc_complete', 'edd_required', 'blocked', 'closed'],
  kyc_complete: ['under_review', 'edd_required', 'cleared', 'closed'],
  edd_required: ['under_review', 'escalated_mlro', 'blocked', 'closed'],
  under_review: ['cleared', 'escalated_mlro', 'edd_required', 'blocked', 'closed'],
  escalated_mlro: ['cleared', 'blocked', 'closed'],
  cleared: ['under_review', 'closed'],
  blocked: ['under_review', 'closed'],
  closed: [],
};

// Phase 1 canonical workflow dimensions. The legacy `status` column remains the
// compatibility source of truth; these deterministic maps keep the new
// dimension columns coherent while V2 surfaces still drive `status` only.
// Must stay in sync with src/lib/aml/caseDimensions.ts and the backfill in
// supabase/migrations/20260725153000_aml_case_workflow_dimensions.sql.
const STATUS_TO_STAGE: Record<string, string> = {
  draft: 'draft',
  kyc_in_progress: 'client_in_progress',
  kyc_complete: 'client_submitted',
  edd_required: 'enhanced_cdd',
  under_review: 'staff_review',
  escalated_mlro: 'decision_pending',
  cleared: 'cleared',
  blocked: 'blocked',
  closed: 'closed',
};
const STATUS_TO_CLIENT_PORTAL: Record<string, string> = {
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
// Conservative gate sync for legacy-driven transitions. Explicit gate
// decisions (Phase 8) will supersede this; only `cleared` reads as approved.
const STATUS_TO_SERVICE_GATE: Record<string, string> = {
  draft: 'not_activated',
  kyc_in_progress: 'cdd_incomplete',
  kyc_complete: 'under_review',
  edd_required: 'information_outstanding',
  under_review: 'under_review',
  escalated_mlro: 'under_review',
  cleared: 'approved',
  blocked: 'locked',
  closed: 'terminated',
};

/**
 * True when a write failed only because the Phase 1 dimension columns have not
 * been migrated in this environment yet (edge functions deploy independently
 * of migrations). Callers retry without the new columns so the legacy contract
 * keeps working — fail-open on columns, never on authorization.
 */
function isMissingColumnError(error: any): boolean {
  const msg = String(error?.message ?? '');
  return error?.code === 'PGRST204'
    || /column .* does not exist/i.test(msg)
    || /Could not find the '.*' column/i.test(msg);
}

/**
 * True when an RPC call failed only because the function has not been migrated
 * in this environment yet (edge functions deploy independently of migrations).
 * Same fail-open-on-schema, never-on-authorization posture as
 * isMissingColumnError above.
 */
function isMissingFunctionError(error: any): boolean {
  const msg = String(error?.message ?? '');
  return error?.code === 'PGRST202'
    || /Could not find the function/i.test(msg)
    || /function .* does not exist/i.test(msg);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Make sure everyone this case must screen actually holds a subject row.
 *
 * ── Why this is a repair and not a feature ────────────────────────────
 * `party_screening_subjects` was only ever written when an operator resolved
 * a RELATED-PARTY reconciliation item. The case subject — the customer the
 * case is about — was never enrolled by anything, despite
 * `partyScreening.pure.ts` stating that "the case subject is always
 * assessed". A straightforward individual purchase declares no related
 * parties, so it produced no reconciliation items, no subjects, and a Stage 5
 * with nothing to screen and nothing to press. Measured on this deployment:
 * 0 subjects across every case, including one with three submissions.
 *
 * It runs on READ as well as on sync, and returns only what is missing, so
 * every existing case self-heals the first time somebody opens it. It is
 * idempotent by identity (party type + party id + name), never by a flag.
 *
 * It enrols people. It screens nobody and decides no outcome.
 */
async function ensureScreeningSubjects(
  admin: any,
  caseId: string,
  actorId: string | null,
  actorLabel: string | null,
): Promise<{ subjects: any[]; enrolled: number; personalDetails: Record<string, unknown> | null; hasSubmission: boolean }> {
  const [{ data: caseRow }, { data: submission }, { data: recon }, { data: existing }] =
    await Promise.all([
      admin.schema('aml').from('cases')
        .select('id, subject_display_name').eq('id', caseId).maybeSingle(),
      admin.schema('aml').from('submission_versions')
        .select('snapshot, submitted_at').eq('case_id', caseId).is('superseded_at', null)
        .order('version_number', { ascending: false }).limit(1).maybeSingle(),
      admin.schema('aml').from('party_reconciliation_items').select('*').eq('case_id', caseId),
      admin.schema('aml').from('party_screening_subjects')
        .select('*').eq('case_id', caseId).order('created_at', { ascending: true }),
    ]);

  const sections = (((submission?.snapshot ?? {}) as any).sections ?? []) as any[];
  const sectionPayload = (name: string): Record<string, unknown> | null => {
    const found = sections.find((x: any) => x?.section === name);
    return found?.payload && typeof found.payload === 'object' ? found.payload : null;
  };
  const personalDetails = sectionPayload('personal_details');
  const hasSubmission = Boolean(submission);

  if (!caseRow) return { subjects: existing ?? [], enrolled: 0, personalDetails, hasSubmission };

  const missing = deriveMissingScreeningSubjects({
    subjectDisplayName: caseRow.subject_display_name ?? null,
    personalDetails,
    reconciled: (recon ?? []).map((r: any) => ({
      id: String(r.id),
      declaredName: String(r.declared_name ?? ''),
      declaredRole: String(r.declared_role ?? ''),
      resolvedPartyType: r.resolved_party_type ?? null,
      resolvedPartyId: r.resolved_party_id ?? null,
      screeningRequired: Boolean(r.screening_required),
      resolutionStatus: String(r.resolution_status ?? ''),
      declaredPayload: (r.declared_payload ?? null) as Record<string, unknown> | null,
    })),
    existing: (existing ?? []).map((e: any) => ({
      partyType: String(e.party_type), partyId: e.party_id ?? null,
      screenedName: String(e.screened_name ?? ''),
    })),
  });

  if (missing.length === 0) {
    return { subjects: existing ?? [], enrolled: 0, personalDetails, hasSubmission };
  }

  const { error: insertError } = await admin.schema('aml').from('party_screening_subjects')
    .insert(missing.map((m) => ({
      case_id: caseId,
      party_type: m.partyType,
      party_id: m.partyId,
      reconciliation_item_id: m.reconciliationItemId,
      screened_name: m.screenedName,
      aliases: m.aliases,
      date_of_birth: m.dateOfBirth,
      country: m.country,
      required: true,
      state: 'not_started',
    })));
  // An enrolment failure must not take the read down with it — the caller
  // still gets the subjects that do exist, and the next action reports the
  // shortfall rather than offering a check with nobody to run it on.
  if (insertError) {
    return { subjects: existing ?? [], enrolled: 0, personalDetails, hasSubmission };
  }

  await appendEvent(admin, caseId, 'system',
    `Enrolled ${missing.length} part${missing.length === 1 ? 'y' : 'ies'} for screening`,
    {
      enrolled: missing.map((m) => ({ party_type: m.partyType, name: m.screenedName })),
      reason: 'screening_enrolment',
    },
    actorId, actorLabel);

  const { data: refreshed } = await admin.schema('aml').from('party_screening_subjects')
    .select('*').eq('case_id', caseId).order('created_at', { ascending: true });
  return {
    subjects: refreshed ?? existing ?? [], enrolled: missing.length,
    personalDetails, hasSubmission,
  };
}

async function appendEvent(
  admin: any,
  caseId: string,
  category: string,
  summary: string,
  payload: Record<string, any>,
  actorId: string | null,
  actorLabel: string | null,
) {
  const { data: prev } = await admin
    .schema('aml')
    .from('case_events')
    .select('row_hash, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const canonical = JSON.stringify({
    case_id: caseId,
    category,
    summary,
    payload: payload ?? {},
    actor_id: actorId,
    actor_label: actorLabel,
    prev_hash: prevHash,
    created_at: now,
  });
  const rowHash = await sha256Hex(canonical);

  const { data, error } = await admin
    .schema('aml')
    .from('case_events')
    .insert({
      case_id: caseId,
      category,
      summary,
      payload: payload ?? {},
      actor_id: actorId,
      actor_label: actorLabel,
      prev_hash: prevHash,
      row_hash: rowHash,
      created_at: now,
    })
    .select('id, created_at, category, summary, prev_hash, row_hash')
    .single();

  if (error) throw error;
  return data;
}

async function generateCaseReference(admin: any): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `AML-${year}-`;
  const { count } = await admin
    .schema('aml')
    .from('cases')
    .select('id', { count: 'exact', head: true })
    .ilike('case_reference', `${prefix}%`);
  const seq = String((count ?? 0) + 1).padStart(5, '0');
  return `${prefix}${seq}`;
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return jsonResponse({ error: auth.error || 'Authentication required' }, 401);
    }
    const userId = auth.userId;
    const userEmail = auth.username ?? null;

    // Confirm caller has any AML role
    const { data: hasAny } = await admin.rpc('has_any_aml_role', { _user_id: userId });
    if (!hasAny) return jsonResponse({ error: 'AML role required' }, 403);

    // Load caller's roles for write-gating
    const { data: roleRows } = await admin
      .schema('aml')
      .from('role_assignments')
      .select('role')
      .eq('user_id', userId)
      .is('revoked_at', null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has('analyst') || roles.has('reviewer') || roles.has('mlro');
    const canCreate = roles.has('analyst') || roles.has('mlro');
    const isMlro = roles.has('mlro');

    const op = String(body?.op ?? '');
    if (!op) return jsonResponse({ error: 'op is required' }, 400);

    switch (op) {
      case 'list': {
        const limit = Math.min(Number(body.limit ?? 50), 200);
        const offset = Math.max(Number(body.offset ?? 0), 0);
        let q = admin
          .schema('aml')
          .from('cases')
          .select('*', { count: 'exact' })
          .order('opened_at', { ascending: false })
          .range(offset, offset + limit - 1);
        if (body.status && CASE_STATUSES.includes(body.status)) q = q.eq('status', body.status);
        if (body.risk && RISK_RATINGS.includes(body.risk)) q = q.eq('risk_rating', body.risk);
        if (body.assigned_to_me) q = q.or(`assigned_analyst_id.eq.${userId},assigned_mlro_id.eq.${userId}`);
        if (body.search) {
          const s = String(body.search).replace(/[%,]/g, ' ').trim();
          if (s) q = q.or(`subject_display_name.ilike.%${s}%,case_reference.ilike.%${s}%`);
        }
        const { data, count, error } = await q;
        if (error) throw error;
        return jsonResponse({ cases: data ?? [], total: count ?? 0, limit, offset });
      }

      case 'get': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data: caseRow, error } = await admin
          .schema('aml').from('cases').select('*').eq('id', body.case_id).maybeSingle();
        if (error) throw error;
        if (!caseRow) return jsonResponse({ error: 'Not found' }, 404);
        const { data: events } = await admin
          .schema('aml').from('case_events').select('*')
          .eq('case_id', body.case_id).order('created_at', { ascending: false }).limit(200);
        return jsonResponse({ case: caseRow, events: events ?? [] });
      }

      case 'create': {
        // Phase 3 (directive §10.4) — manual, unlinked case creation is no
        // longer an ordinary production pathway. The only supported route is
        // activate_client (human-confirmed, linked to an active client).
        // `create` remains solely as an authorised exception channel: MLRO
        // only, with a recorded exception category, authority and reason.
        if (!isMlro) {
          return jsonResponse({
            error: 'Manual case creation is restricted. Activate the client from their client record instead; an MLRO can record an authorised exception if this is a migration or remediation case.',
            code: 'manual_creation_restricted',
          }, 403);
        }
        const EXCEPTION_CATEGORIES = [
          'data_migration', 'legacy_remediation', 'regulator_directed', 'approved_testing',
        ];
        const exception = body.exception ?? {};
        const exceptionCategory = String(exception.category ?? '').trim();
        const exceptionReason = String(exception.reason ?? '').trim();
        const exceptionAuthority = String(exception.authority ?? '').trim();
        if (!EXCEPTION_CATEGORIES.includes(exceptionCategory)) {
          return jsonResponse({
            error: 'exception.category is required (data_migration, legacy_remediation, regulator_directed or approved_testing)',
          }, 400);
        }
        if (exceptionReason.length < 10) {
          return jsonResponse({ error: 'exception.reason must be at least 10 characters' }, 400);
        }
        if (!exceptionAuthority) {
          return jsonResponse({ error: 'exception.authority is required (who approved this exception)' }, 400);
        }
        const subject = String(body.subject_display_name ?? '').trim();
        if (!subject) return jsonResponse({ error: 'subject_display_name is required' }, 400);
        const subjectType = ['individual', 'entity', 'trust'].includes(body.subject_type)
          ? body.subject_type : 'individual';
        const risk = RISK_RATINGS.includes(body.risk_rating) ? body.risk_rating : null;
        const exceptionRecord = {
          category: exceptionCategory,
          reason: exceptionReason,
          authority: exceptionAuthority,
          intended_client_id: body.client_id ?? null,
          recorded_by: userId,
          recorded_by_email: userEmail,
          recorded_at: new Date().toISOString(),
        };

        const ref = await generateCaseReference(admin);
        const baseCreate = {
          case_reference: ref,
          subject_display_name: subject,
          subject_type: subjectType,
          client_id: body.client_id ?? null,
          purchase_file_id: body.purchase_file_id ?? null,
          risk_rating: risk,
          assigned_analyst_id: userId,
          created_by: userId,
          metadata: { ...(body.metadata ?? {}), creation_exception: exceptionRecord },
        };
        const createDimensions = {
          case_stage: 'draft',
          client_portal_status: 'not_started',
          finance_portal_status: 'not_requested',
          service_gate_status: 'not_activated',
        };
        let { data: created, error } = await admin
          .schema('aml').from('cases')
          .insert({ ...baseCreate, ...createDimensions }).select('*').single();
        if (error && isMissingColumnError(error)) {
          ({ data: created, error } = await admin
            .schema('aml').from('cases').insert(baseCreate).select('*').single());
        }
        if (error) {
          if (error.code === '23505') {
            return jsonResponse({ error: 'An open AML case already exists for this client' }, 409);
          }
          throw error;
        }

        await appendEvent(admin, created.id, 'case_created',
          `Case ${ref} opened by authorised exception (${exceptionCategory}) for ${subject}`,
          {
            subject_type: subjectType, initial_risk: risk, notes: body.notes ?? null,
            creation_exception: exceptionRecord,
          },
          userId, userEmail);

        return jsonResponse({ case: created });
      }

      case 'activate_client': {
        // Phase 3 — Hybrid Activation Engine (Model A/B).
        //
        // Cases can only be opened for a real active client after a
        // **human-confirmed** activation event (AGENTS.md §2). Marketing
        // leads / imports never reach this path.
        //
        // Model A: designated-service activation — allowed whenever an AML
        //          role holder confirms the trigger.
        // Model B: pre-service / earlier activation — REQUIRES tenant-level
        //          `aml_activation_program.legal_approval === true` and a
        //          non-empty `program_version` string. Otherwise 409.
        if (!canCreate) return jsonResponse({ error: 'Analyst or MLRO role required' }, 403);

        const clientId = String(body.client_id ?? '').trim();
        const displayName = String(body.subject_display_name ?? '').trim();
        const model = String(body.activation_model ?? '').toUpperCase();
        const event = String(body.activation_event ?? '').trim();
        const reason = String(body.reason ?? '').trim();
        const confirmed = Boolean(body.human_confirmed);

        if (!clientId) return jsonResponse({ error: 'client_id is required' }, 400);
        if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
          return jsonResponse({ error: 'client_id must be a UUID' }, 400);
        }
        if (!displayName) return jsonResponse({ error: 'subject_display_name is required' }, 400);
        if (!['A', 'B'].includes(model)) {
          return jsonResponse({ error: 'activation_model must be "A" or "B"' }, 400);
        }
        if (event.length < 3) return jsonResponse({ error: 'activation_event is required' }, 400);
        if (reason.length < 10) {
          return jsonResponse({ error: 'reason must be at least 10 characters' }, 400);
        }
        if (!confirmed) {
          return jsonResponse({ error: 'Human confirmation is required to open an AML case' }, 400);
        }

        // Verify the client exists. An inactive client is NOT rejected here:
        // this human-confirmed form is the sanctioned place an authorised user
        // confirms an existing client is active, so the flip to active happens
        // atomically with case creation below instead of being demanded of
        // some other screen first.
        const { data: client, error: clientErr } = await admin
          .from('clients')
          .select('id, is_active')
          .eq('id', clientId)
          .maybeSingle();
        if (clientErr) throw clientErr;
        if (!client) return jsonResponse({ error: 'Client not found' }, 404);
        const clientWasInactive = client.is_active !== true;

        // Duplicate-open guard: one open case per client at a time.
        const { data: existing } = await admin
          .schema('aml').from('cases')
          .select('*')
          .eq('client_id', clientId)
          .not('status', 'in', '("cleared","closed","blocked")')
          .limit(1)
          .maybeSingle();
        if (existing) {
          const priorActivation = (existing.metadata as any)?.activation ?? {};
          const isSameConfirmedActivation =
            priorActivation.human_confirmed === true
            && String(priorActivation.model ?? '') === model
            && String(priorActivation.event ?? '').trim() === event
            && String(priorActivation.reason ?? '').trim() === reason
            && String(existing.subject_display_name ?? '').trim() === displayName;
          if (isSameConfirmedActivation) {
            return jsonResponse({
              case: existing,
              activation: priorActivation,
              client_activation: { was_inactive: false, marked_active: false },
              client_portal: {
                has_portal_access: false,
                notified: false,
                note: 'This activation had already completed. The existing AML case has been reopened.',
              },
              reconciled: true,
            });
          }
          return jsonResponse({
            error: 'An open AML case already exists for this client',
            case: existing,
          }, 409);
        }

        // Model B guardrail: legal approval + program version.
        let programVersion: string | null = null;
        if (model === 'B') {
          // Surface read errors and tolerate multi-row tables: a silent read
          // failure here previously disabled Model B with a misleading
          // `model_b_not_approved` message.
          const { data: settingsRows, error: settingsErr } = await admin
            .schema('aml').from('tenant_settings')
            .select('metadata')
            .limit(1);
          if (settingsErr) throw settingsErr;
          const settings = (settingsRows ?? [])[0] ?? null;
          const program = ((settings as any)?.metadata ?? {})?.aml_activation_program ?? {};
          if (program?.legal_approval !== true || !String(program?.program_version ?? '').trim()) {
            return jsonResponse({
              error:
                'Model B activation is disabled. An MLRO must record legal approval and a program version in Configuration before Model B can be used.',
              code: 'model_b_not_approved',
            }, 409);
          }
          programVersion = String(program.program_version).trim();
        }

        const activation = {
          model,
          event,
          reason,
          program_version: programVersion,
          human_confirmed: true,
          client_was_inactive: clientWasInactive,
          activated_by: userId,
          activated_by_email: userEmail,
          activated_at: new Date().toISOString(),
        };

        // Phase 1 explicit activation contract (§17). Model labels are
        // preserved in legacy_activation_model; meaning is carried by the
        // explicit timing/agreement/gate fields.
        const dimensionFields: Record<string, any> = {
          case_stage: 'activated',
          client_portal_status: 'not_started',
          finance_portal_status: 'not_requested',
          service_gate_status: 'cdd_incomplete',
          activation_timing: model === 'A' ? 'post_agreement_trigger' : 'conditional_agreement',
          agreement_state: model === 'A' ? 'operative' : 'conditional_executed',
          activation_policy_version: programVersion,
          legacy_activation_model: model,
        };

        const ref = await generateCaseReference(admin);
        const baseInsert = {
          case_reference: ref,
          subject_display_name: displayName,
          subject_type: body.subject_type && ['individual', 'entity', 'trust'].includes(body.subject_type)
            ? body.subject_type : 'individual',
          client_id: clientId,
          purchase_file_id: body.purchase_file_id ?? null,
          risk_rating: null,
          assigned_analyst_id: userId,
          created_by: userId,
          metadata: { activation },
        };
        const activationAuditEvent = {
          category: 'case_created',
          summary: `Case ${ref} activated (Model ${model}) for ${displayName}` +
            (clientWasInactive ? ' — client record marked active' : ''),
          payload: {
            activation,
            client_id: clientId,
            client_activation: {
              was_inactive: clientWasInactive,
              marked_active: clientWasInactive,
            },
            activation_contract: {
              activation_timing: dimensionFields.activation_timing,
              agreement_state: dimensionFields.agreement_state,
              service_gate_status: dimensionFields.service_gate_status,
              activation_policy_version: programVersion,
            },
          },
          actor_id: userId,
          actor_label: userEmail,
        };
        let created: any = null;
        let clientMarkedActive = false;

        if (clientWasInactive) {
          // Atomic path ONLY (Part 5): mark the client active and open the
          // case in ONE database transaction. The RPC locks the client row,
          // flips is_active, inserts the case and rolls the whole thing back
          // on any error — including the duplicate-open unique index, which
          // still surfaces as the same 409 contract.
          //
          // There is deliberately NO non-transactional fallback. A compensated
          // flip/insert/revert sequence can race a concurrent activation into
          // deactivating a client who holds a valid open case, and its revert
          // can itself fail, leaving an active client with no case. If the RPC
          // has not been installed yet, this path fails closed with a clear
          // configuration error and mutates nothing.
          const { data: txResult, error: txErr } = await admin.rpc(
            'aml_activate_client_open_case',
            {
              p_client_id: clientId,
              p_case: {
                ...baseInsert,
                ...dimensionFields,
                activation_audit_event: activationAuditEvent,
              },
            },
          );
          if (txErr) {
            if (isMissingFunctionError(txErr)) {
              // Fail closed: no client update, no case insert, no case event.
              // Deployment order requires the migration installing the RPC to
              // be applied before this function serves inactive activations.
              return jsonResponse({
                error: 'AML client activation is temporarily unavailable because the required database function has not been installed.',
                code: 'aml_activation_rpc_unavailable',
              }, 503);
            }
            if (txErr.code === '23505' || /aml_cases_one_open_per_client|already exists/i.test(String(txErr.message ?? ''))) {
              return jsonResponse({ error: 'An open AML case already exists for this client' }, 409);
            }
            if (txErr.code === 'P0002') return jsonResponse({ error: 'Client not found' }, 404);
            throw txErr;
          }
          created = (txResult as any)?.case ?? null;
          clientMarkedActive = Boolean((txResult as any)?.client_marked_active);
          if (!created) throw new Error('Activation transaction returned no case');
        } else {
          // Already-active client: existing case-creation behaviour unchanged.
          let { data: createdRow, error: createErr } = await admin
            .schema('aml').from('cases')
            .insert({ ...baseInsert, ...dimensionFields }).select('*').single();
          if (createErr && isMissingColumnError(createErr)) {
            ({ data: createdRow, error: createErr } = await admin
              .schema('aml').from('cases').insert(baseInsert).select('*').single());
          }
          if (createErr) {
            // Partial unique index aml_cases_one_open_per_client closes the
            // read-then-write race above; surface it as the same 409 contract.
            if (createErr.code === '23505') {
              return jsonResponse({ error: 'An open AML case already exists for this client' }, 409);
            }
            throw createErr;
          }
          created = createdRow;
        }

        const clientActivation = {
          was_inactive: clientWasInactive,
          marked_active: clientMarkedActive,
        };

        // The inactive-client RPC writes this required event in the SAME
        // transaction as the active flag and case. Already-active clients keep
        // the direct insert path and append their event here.
        if (!clientWasInactive) {
          await appendEvent(
            admin,
            created.id,
            activationAuditEvent.category,
            activationAuditEvent.summary,
            activationAuditEvent.payload,
            userId,
            userEmail,
          );
        }

        // Hand the client the way in. Activation is meaningless to them until
        // something in their portal points at the screening flow, so post a
        // notification carrying the deep link, and report back whether they
        // can actually reach it — a client with no portal login needs an
        // invite, and the operator should learn that here rather than a week
        // later when nothing has been submitted.
        let portalAccess: { has_portal_access: boolean; notified: boolean; note: string };
        const { data: portalUsers } = await admin
          .from('client_portal_users')
          .select('id, status')
          .eq('client_id', clientId)
          .eq('status', 'active')
          .limit(1);
        const hasPortalAccess = (portalUsers ?? []).length > 0;

        let notified = false;
        // Portal-safe by construction (Appendix C.1): reference and next step
        // only — no risk, screening or internal state.
        const { error: notifyErr } = await admin
          .from('client_portal_notifications')
          .insert({
            client_id: clientId,
            title: 'Identity verification required',
            message:
              'Your identity and compliance check is ready to complete. It takes about 10 minutes ' +
              'and covers the consents and documents we are required to collect before we can act for you.',
            type: 'action',
            category: 'document',
            action_url: '/client/aml',
            metadata: { aml_case_reference: created.case_reference, source: 'aml_activation' },
          });
        if (notifyErr) {
          // A failed notification must not roll back a recorded activation —
          // surface it instead so it can be re-sent.
          console.error('aml-cases: portal notification insert failed', notifyErr);
        } else {
          notified = true;
        }

        portalAccess = {
          has_portal_access: hasPortalAccess,
          notified,
          note: hasPortalAccess
            ? 'The client has been notified in their portal with a link to the compliance check.'
            : 'This client has no active portal login yet. Send them a portal invitation so they can complete the compliance check.',
        };

        await appendEvent(admin, created.id, 'system',
          hasPortalAccess
            ? 'Client notified in portal — compliance check available'
            : 'Portal notification queued — client has no active portal login yet',
          { client_portal: portalAccess, action_url: '/client/aml' },
          userId, userEmail);

        return jsonResponse({
          case: created,
          activation,
          client_activation: clientActivation,
          client_portal: portalAccess,
        });
      }

      case 'update': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const patch = body.patch ?? {};
        const allowed: Record<string, any> = {};
        for (const k of ['subject_display_name', 'risk_score', 'assigned_analyst_id', 'assigned_mlro_id', 'metadata']) {
          if (patch[k] !== undefined) allowed[k] = patch[k];
        }
        if (patch.risk_rating !== undefined) {
          if (patch.risk_rating !== null && !RISK_RATINGS.includes(patch.risk_rating)) {
            return jsonResponse({ error: 'Invalid risk_rating' }, 400);
          }
          allowed.risk_rating = patch.risk_rating;
        }
        if (Object.keys(allowed).length === 0) return jsonResponse({ error: 'Empty patch' }, 400);

        const { data: before } = await admin.schema('aml').from('cases')
          .select('risk_rating, risk_score').eq('id', body.case_id).maybeSingle();

        const { data: updated, error } = await admin.schema('aml').from('cases')
          .update(allowed).eq('id', body.case_id).select('*').single();
        if (error) throw error;

        if (patch.risk_rating !== undefined || patch.risk_score !== undefined) {
          await appendEvent(admin, body.case_id, 'risk_rescored',
            `Risk updated → ${updated.risk_rating ?? 'unrated'} (score ${updated.risk_score ?? 'n/a'})`,
            { before, after: { risk_rating: updated.risk_rating, risk_score: updated.risk_score } },
            userId, userEmail);
        }

        return jsonResponse({ case: updated });
      }

      case 'transition': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.case_id || !body.to_status) {
          return jsonResponse({ error: 'case_id and to_status are required' }, 400);
        }
        if (!CASE_STATUSES.includes(body.to_status)) {
          return jsonResponse({ error: 'Invalid to_status' }, 400);
        }
        const { data: caseRow, error: fetchErr } = await admin.schema('aml').from('cases')
          .select('id, status').eq('id', body.case_id).maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!caseRow) return jsonResponse({ error: 'Not found' }, 404);

        const from = caseRow.status;
        const to = body.to_status;
        const legal = TRANSITIONS[from] ?? [];
        if (from === 'escalated_mlro' && !isMlro) {
          return jsonResponse({ error: 'MLRO role required for escalated case decisions' }, 403);
        }
        if (!legal.includes(to) && !isMlro) {
          return jsonResponse({
            error: `Illegal transition ${from} → ${to} (MLRO override required)`,
          }, 400);
        }

        const patch: Record<string, any> = { status: to };
        if (to === 'closed') patch.closed_at = new Date().toISOString();

        // Keep the Phase 1 dimension columns coherent while legacy `status`
        // is still the driver. Gate sync is the conservative legacy mapping;
        // explicit gate decisions (Phase 8) will replace it.
        const dimensionPatch: Record<string, any> = {
          case_stage: STATUS_TO_STAGE[to] ?? null,
          client_portal_status: STATUS_TO_CLIENT_PORTAL[to] ?? null,
          service_gate_status: STATUS_TO_SERVICE_GATE[to] ?? null,
        };

        let { data: updated, error: upErr } = await admin.schema('aml').from('cases')
          .update({ ...patch, ...dimensionPatch }).eq('id', body.case_id).select('*').single();
        if (upErr && isMissingColumnError(upErr)) {
          ({ data: updated, error: upErr } = await admin.schema('aml').from('cases')
            .update(patch).eq('id', body.case_id).select('*').single());
        }
        if (upErr) throw upErr;

        await appendEvent(admin, body.case_id, 'status_changed',
          `Status ${from} → ${to}${!legal.includes(to) ? ' (MLRO override)' : ''}`,
          {
            from, to, reason: body.reason ?? null, override: !legal.includes(to),
            dimensions_synced: dimensionPatch,
          },
          userId, userEmail);

        return jsonResponse({ case: updated });
      }

      case 'append_event': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.case_id || !body.category || !body.summary) {
          return jsonResponse({ error: 'case_id, category, summary required' }, 400);
        }
        if (!EVENT_CATEGORIES.includes(body.category)) {
          return jsonResponse({ error: 'Invalid category' }, 400);
        }
        if (MLRO_ONLY_EVENT_CATEGORIES.has(body.category) && !isMlro) {
          return jsonResponse({ error: 'MLRO role required for this event category' }, 403);
        }
        const ev = await appendEvent(admin, body.case_id, body.category,
          String(body.summary), body.payload ?? {}, userId, userEmail);
        return jsonResponse({ event: ev });
      }

      case 'list_events': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const limit = Math.min(Number(body.limit ?? 200), 500);
        const { data, error } = await admin.schema('aml').from('case_events')
          .select('*').eq('case_id', body.case_id)
          .order('created_at', { ascending: false }).limit(limit);
        if (error) throw error;
        return jsonResponse({ events: data ?? [] });
      }

      case 'consent_status': {
        // Command-centre confirmation that the client accepted the current
        // AUSTRAC-referenced consent set, and exactly which wording they saw.
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data: docs, error: docErr } = await admin.schema('aml').from('consent_documents')
          .select('id, code, version, title, acknowledgement_type, required, sort_order, effective_from')
          .is('retired_at', null)
          .lte('effective_from', new Date().toISOString())
          .order('version', { ascending: false })
          .order('sort_order', { ascending: true });
        if (docErr) return jsonResponse({ error: docErr.message }, 400);
        const currentVersion = (docs ?? [])[0]?.version ?? null;
        const current = (docs ?? []).filter((d: any) => d.version === currentVersion);

        const { data: accepted, error: accErr } = await admin.schema('aml').from('consents')
          .select('kind, version, accepted_at, actor_type, actor_label, document_hash, ip_address')
          .eq('case_id', body.case_id)
          .order('accepted_at', { ascending: true });
        if (accErr) return jsonResponse({ error: accErr.message }, 400);

        const acceptedCurrent = new Map(
          (accepted ?? []).filter((a: any) => a.version === currentVersion)
            .map((a: any) => [a.kind, a]));
        const outstanding = current
          .filter((d: any) => d.required && !acceptedCurrent.has(d.code))
          .map((d: any) => ({ code: d.code, title: d.title }));

        return jsonResponse({
          version: currentVersion,
          satisfied: Boolean(currentVersion) && current.length > 0 && outstanding.length === 0,
          outstanding,
          documents: current.map((d: any) => {
            const a: any = acceptedCurrent.get(d.code);
            return {
              code: d.code, title: d.title, required: d.required,
              acknowledgement_type: d.acknowledgement_type,
              accepted_at: a?.accepted_at ?? null,
              accepted_by: a?.actor_label ?? null,
              actor_type: a?.actor_type ?? null,
              // Ties the acceptance to the exact text presented.
              document_hash: a?.document_hash ?? null,
            };
          }),
          // Superseded acceptances are retained, never overwritten.
          history: (accepted ?? []).filter((a: any) => a.version !== currentVersion),
        });
      }

      case 'search_clients': {
        // Client picker for activation (directive §13.4: no raw-UUID entry).
        //
        // The general client-data broker only returns the full client list to
        // superadmins — a compliance officer who created none of the clients
        // and is assigned to none would see an empty picker. Activation is an
        // AML-role action, so this op provides its own minimal, AML-gated
        // lookup instead of widening that broker.
        //
        // Deliberately narrow: canonical `clients` table only, tokenised name
        // match, capped result set, identification projection only (never
        // financial data). Both ACTIVE and INACTIVE clients are returned and
        // selectable — the activation form is the sanctioned place an
        // authorised user confirms an existing client is active, so inactive
        // records are offered (clearly labelled) instead of hidden behind a
        // "mark them active somewhere else first" dead end. Matching lives in
        // _shared/aml/clientSearchMatch.pure.ts so it is unit-testable.
        // ── BROWSE vs SEARCH ────────────────────────────────────────────
        // This op used to answer `{ clients: [] }` to anything shorter than
        // two characters, so the picker was an empty box until an operator
        // typed a name they had to already know and spell. On this
        // deployment that hid 775 clients — 40 active, 735 inactive — and is
        // why activation felt like it wanted clients re-entered that the
        // platform already held.
        //
        // Browse is the SAME op, projection and permission gate as search;
        // only the database filter differs. A separate "list clients"
        // endpoint would be a second source of truth about which clients an
        // AML operator may see, and the two would drift.
        if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403);
        const q = sanitizeClientSearchQuery(body.query);
        const status: ClientPickerStatus =
          isClientPickerStatus(body.status) ? body.status : 'all';
        const limit = clampPageSize(body.limit);
        const offset = clampOffset(body.offset);
        const browsing = isBrowseQuery(body.query);

        /** Apply the status slice identically to every path. */
        // deno-lint-ignore no-explicit-any
        const withStatus = (qb: any): any => {
          if (status === 'active') return qb.eq('is_active', true);
          // `is_active` is nullable, and a null is not active. Filtering on
          // `eq false` alone would silently drop those rows from the inactive
          // slice — present in neither tab, which reads as a missing client
          // rather than as a filter.
          if (status === 'inactive') return qb.or('is_active.eq.false,is_active.is.null');
          return qb;
        };

        let page: ClientSearchRow[];
        let total: number;

        if (browsing) {
          // Count and page are taken in the database: 775 rows is already
          // past the point where pulling everything to sort it is sensible.
          const countQuery = withStatus(
            admin.from('clients').select('id', { count: 'exact', head: true }));
          const rowsQuery = withStatus(
            admin.from('clients').select(CLIENT_SEARCH_SELECT))
            .order('is_active', { ascending: false })
            .order('primary_surname', { ascending: true })
            .order('primary_first_name', { ascending: true })
            .range(offset, offset + limit - 1);

          const [{ count, error: countErr }, { data: rows, error: rowsErr }] =
            await Promise.all([countQuery, rowsQuery]);
          if (countErr) return jsonResponse({ error: countErr.message }, 400);
          if (rowsErr) return jsonResponse({ error: rowsErr.message }, 400);
          page = orderBrowsedClients((rows ?? []) as ClientSearchRow[]);
          total = count ?? page.length;
        } else {
          const terms = tokenizeClientSearch(q);
          if (terms.length === 0) {
            return jsonResponse({ clients: [], total: 0, has_more: false, browsing });
          }
          // The `or=` pre-filter is deliberately wide; the strict
          // all-tokens-on-one-person rule is applied in memory afterwards,
          // and the page is taken after that rather than before it.
          const { data: candidates, error: searchErr } = await withStatus(
            admin.from('clients').select(CLIENT_SEARCH_SELECT))
            .or(buildClientSearchOrFilter(terms))
            .order('primary_surname', { ascending: true })
            .limit(400);
          if (searchErr) return jsonResponse({ error: searchErr.message }, 400);
          const result = selectActivationPage(
            (candidates ?? []) as ClientSearchRow[], q, limit, offset);
          page = result.rows;
          total = result.total;
        }

        // Flag clients that already hold an open case so the operator does not
        // start a duplicate (the unique index would reject it at 409 anyway).
        const ids = page.map((r) => r.id);
        let openCaseIds = new Set<string>();
        const openCaseRefs = new Map<string, string>();
        if (ids.length > 0) {
          const { data: openCases } = await admin.schema('aml').from('cases')
            .select('client_id, case_reference')
            .in('client_id', ids)
            .not('status', 'in', '("cleared","blocked","closed")');
          for (const c of openCases ?? []) {
            const cid = String((c as any).client_id);
            openCaseIds.add(cid);
            // Naming the case is what turns "you cannot do this" into
            // "here is the case that already covers it".
            if ((c as any).case_reference) {
              openCaseRefs.set(cid, String((c as any).case_reference));
            }
          }
        }

        return jsonResponse({
          clients: page.map((r) => {
            const id = String(r.id);
            const projected = toActivationClientResult(r, openCaseIds.has(id));
            const reference = openCaseRefs.get(id);
            return reference
              ? { ...projected, open_case: { case_reference: reference } }
              : projected;
          }),
          total,
          has_more: offset + page.length < total,
          browsing,
        });
      }

      case 'get_client_for_activation': {
        // Route-based handoff (…/admin/aml/cases?activateClientId=<id>): the
        // browser supplies ONLY the client ID; the display name, contact
        // details and active status are loaded here from the authoritative
        // record, so the URL carries no personal information and cannot
        // misrepresent the client's status.
        if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403);
        const clientId = String(body.client_id ?? '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
          return jsonResponse({ error: 'client_id must be a UUID' }, 400);
        }
        const { data: row, error: rowErr } = await admin
          .from('clients')
          .select(CLIENT_SEARCH_SELECT)
          .eq('id', clientId)
          .maybeSingle();
        if (rowErr) throw rowErr;
        if (!row) return jsonResponse({ error: 'Client not found' }, 404);

        const { data: openCase } = await admin.schema('aml').from('cases')
          .select('id, case_reference, status')
          .eq('client_id', clientId)
          .not('status', 'in', '("cleared","blocked","closed")')
          .limit(1)
          .maybeSingle();

        return jsonResponse({
          client: {
            ...toActivationClientResult(row as unknown as ClientSearchRow, Boolean(openCase)),
            open_case: openCase
              ? { id: openCase.id, case_reference: openCase.case_reference }
              : null,
          },
        });
      }


      case 'client_summary': {
        // Phase 4 — persistent AML summary for the master client record.
        // Read-only; any AML role. Returns the client's current case (open
        // first, else most recent), requirement progress and open-request
        // counts so the Client page can show status without duplicating the
        // case workspace.
        const clientId = String(body.client_id ?? '').trim();
        if (!clientId) return jsonResponse({ error: 'client_id is required' }, 400);
        const { data: caseRows, error: caseErr } = await admin
          .schema('aml').from('cases').select('*')
          .eq('client_id', clientId)
          .order('opened_at', { ascending: false })
          .limit(5);
        if (caseErr) throw caseErr;
        const rows = caseRows ?? [];
        const OPEN_BLOCKING = new Set(['cleared', 'blocked', 'closed']);
        const openCase = rows.find((r: any) => !OPEN_BLOCKING.has(r.status)) ?? null;
        const current = openCase ?? rows[0] ?? null;
        if (!current) {
          return jsonResponse({ case: null, has_open_case: false });
        }
        const [{ data: reqRows }, { data: requestRows }] = await Promise.all([
          admin.schema('aml').from('document_requirements')
            .select('required, status').eq('case_id', current.id),
          admin.schema('aml').from('client_requests')
            .select('id, status').eq('case_id', current.id).in('status', ['open', 'responded']),
        ]);
        const required = (reqRows ?? []).filter((r: any) => r.required);
        const completed = required.filter((r: any) => ['uploaded', 'accepted'].includes(r.status));
        return jsonResponse({
          case: current,
          has_open_case: Boolean(openCase),
          requirement_progress: { completed: completed.length, total: required.length },
          open_client_requests: (requestRows ?? []).length,
        });
      }

      case 'list_requirements': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data, error } = await admin.schema('aml').from('document_requirements')
          .select('*').eq('case_id', body.case_id).order('created_at', { ascending: true });
        if (error) throw error;
        return jsonResponse({ requirements: data ?? [] });
      }

      case 'seed_default_requirements': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const defaults = [
          { code: 'photo_id_primary', label: 'Photo ID — primary (passport or driver licence)', required: true },
          { code: 'photo_id_secondary', label: 'Photo ID — secondary', required: false },
          { code: 'proof_of_address', label: 'Proof of address (utility bill or bank statement < 3 months)', required: true },
          { code: 'source_of_funds', label: 'Source of funds evidence', required: true },
          { code: 'source_of_wealth', label: 'Source of wealth statement', required: false },
        ];
        const rows = defaults.map((d) => ({ ...d, case_id: body.case_id, created_by_type: 'staff', created_by: userId }));
        const { data, error } = await admin.schema('aml').from('document_requirements')
          .upsert(rows, { onConflict: 'case_id,code' }).select('*');
        if (error) throw error;
        await appendEvent(admin, body.case_id, 'document_added',
          `Seeded ${rows.length} default document requirements`,
          { codes: defaults.map((d) => d.code) }, userId, userEmail);
        return jsonResponse({ requirements: data ?? [] });
      }

      case 'upsert_requirement': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const r = body.requirement ?? {};
        if (!r.case_id || !r.code || !r.label) {
          return jsonResponse({ error: 'case_id, code, label required' }, 400);
        }
        const row = {
          case_id: r.case_id, code: String(r.code), label: String(r.label),
          description: r.description ?? null, required: r.required !== false,
          assigned_to_party: r.assigned_to_party ?? null, due_at: r.due_at ?? null,
          metadata: r.metadata ?? {}, created_by_type: 'staff', created_by: userId,
        };
        const { data, error } = await admin.schema('aml').from('document_requirements')
          .upsert(row, { onConflict: 'case_id,code' }).select('*').single();
        if (error) throw error;
        return jsonResponse({ requirement: data });
      }

      case 'list_documents': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        /*
         * The requirement comes back WITH the document.
         *
         * It was always in the row — every client upload carries a correct
         * `requirement_id` — but this op selected `*` and the reviewer got a
         * list of camera filenames with no way to tell a passport from a bank
         * statement without opening each one. The category is read from the
         * requirement and never inferred from a filename: a filename is a
         * claim by whoever uploaded it, a requirement is a record of what was
         * asked for.
         */
        const { data, error } = await admin.schema('aml').from('documents')
          .select('*, requirement:requirement_id (id, code, label, required)')
          .eq('case_id', body.case_id).neq('status', 'deleted')
          .order('uploaded_at', { ascending: false });
        if (error) throw error;
        return jsonResponse({ documents: data ?? [] });
      }

      case 'rename_document': {
        /*
         * Renaming is presentation only. `filename` is never touched — it is
         * the audit record of the bytes the client sent — and no foreign key
         * moves, so the document's case, requirement, client and Passport
         * bindings are exactly what they were.
         */
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.document_id) return jsonResponse({ error: 'document_id is required' }, 400);
        const nextName = sanitiseDocumentName(body.display_name);

        const { data: before, error: beforeErr } = await admin.schema('aml').from('documents')
          .select('id, case_id, filename, display_name')
          .eq('id', String(body.document_id)).maybeSingle();
        if (beforeErr) throw beforeErr;
        if (!before) return jsonResponse({ error: 'Not found' }, 404);

        const { data: doc, error } = await admin.schema('aml').from('documents')
          .update({ display_name: nextName })
          .eq('id', before.id)
          .select('*, requirement:requirement_id (id, code, label, required)')
          .single();
        if (error) throw error;

        // What changed, from what, to what, and by whom — a rename is a
        // compliance-visible edit and leaves the same trail as any other.
        await appendEvent(admin, before.case_id, 'document_added',
          nextName
            ? `Document renamed to "${nextName}"`
            : 'Document name cleared — it now shows its requirement',
          {
            document_id: before.id,
            previous_display_name: before.display_name ?? null,
            new_display_name: nextName,
            // Preserved so the trail always names the file that arrived.
            original_filename: before.filename,
          },
          userId, userEmail);

        return jsonResponse({ document: doc });
      }

      case 'get_document_download_url': {
        if (!body.document_id) return jsonResponse({ error: 'document_id is required' }, 400);
        const { data: doc, error } = await admin.schema('aml').from('documents')
          .select('storage_path, filename').eq('id', body.document_id).maybeSingle();
        if (error) throw error;
        if (!doc) return jsonResponse({ error: 'Not found' }, 404);
        const { data: signed, error: sErr } = await admin.storage.from('aml-documents')
          .createSignedUrl(doc.storage_path, 300, { download: doc.filename });
        if (sErr) throw sErr;
        return jsonResponse({ url: signed.signedUrl, filename: doc.filename });
      }

      case 'review_document': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.document_id || !['accepted','rejected'].includes(body.decision)) {
          return jsonResponse({ error: 'document_id + decision(accepted|rejected) required' }, 400);
        }
        const patch: Record<string, any> = {
          status: body.decision, reviewed_by: userId, reviewed_at: new Date().toISOString(),
        };
        if (body.decision === 'rejected') patch.rejection_reason = body.reason ?? null;
        const { data: doc, error } = await admin.schema('aml').from('documents')
          .update(patch).eq('id', body.document_id).select('*').single();
        if (error) throw error;
        if (doc.requirement_id) {
          await admin.schema('aml').from('document_requirements')
            .update({ status: body.decision === 'accepted' ? 'accepted' : 'rejected' })
            .eq('id', doc.requirement_id);
        }
        await appendEvent(admin, doc.case_id, 'document_added',
          `Document "${doc.filename}" ${body.decision}`,
          { document_id: doc.id, decision: body.decision, reason: body.reason ?? null },
          userId, userEmail);
        return jsonResponse({ document: doc });
      }

      case 'list_submissions': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data, error } = await admin.schema('aml').from('submission_versions')
          .select('*').eq('case_id', body.case_id)
          .order('version_number', { ascending: false });
        if (error) throw error;
        return jsonResponse({ submissions: data ?? [] });
      }

      case 'review_submission': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.submission_id || !['accepted','rejected','changes_requested'].includes(body.decision)) {
          return jsonResponse({ error: 'submission_id + decision required' }, 400);
        }
        const { data: sub, error } = await admin.schema('aml').from('submission_versions')
          .update({
            status: body.decision, reviewer_id: userId,
            reviewer_notes: body.notes ?? null, reviewed_at: new Date().toISOString(),
          }).eq('id', body.submission_id).select('*').single();
        if (error) throw error;
        await appendEvent(admin, sub.case_id, 'edd_note',
          `Submission v${sub.version_number} ${body.decision}`,
          { submission_id: sub.id, decision: body.decision, notes: body.notes ?? null },
          userId, userEmail);
        return jsonResponse({ submission: sub });
      }

      case 'list_client_requests': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data, error } = await admin.schema('aml').from('client_requests')
          .select('*').eq('case_id', body.case_id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return jsonResponse({ requests: data ?? [] });
      }

      case 'create_client_request': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const r = body.request ?? {};
        if (!r.case_id || !r.kind || !r.subject || !r.message) {
          return jsonResponse({ error: 'case_id, kind, subject, message required' }, 400);
        }
        if (!['additional_info','new_document','clarification','re_consent'].includes(r.kind)) {
          return jsonResponse({ error: 'Invalid kind' }, 400);
        }
        // Closed action vocabulary and closed routing, both from the shared
        // contract. An unrecognised code is dropped rather than stored, so the
        // portal can never be handed a route it does not know.
        //
        // `sanitiseActionTarget` also carries `section_code`, which this path
        // used to discard: the portal routes questionnaire amendments by it,
        // so a request created anywhere except Submission Review reached the
        // client with nowhere to go. It is validated against the questionnaire
        // vocabulary rather than merely copied.
        const actionCode = sanitiseActionCode(r.action_code);
        const actionTarget = sanitiseActionTarget(r.action_target);

        // Idempotency: one unresolved request per action on a case. A repeated
        // click (or a double-submit) returns the request that already exists
        // instead of creating a second one the client would see twice.
        if (actionCode) {
          const { data: existing } = await admin.schema('aml').from('client_requests')
            .select('*').eq('case_id', r.case_id).eq('action_code', actionCode)
            .not('status', 'in', '("resolved","cancelled")')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (existing) return jsonResponse({ request: existing, deduplicated: true });
        }

        const { data, error } = await admin.schema('aml').from('client_requests').insert({
          case_id: r.case_id, kind: r.kind, subject: String(r.subject).slice(0, 200),
          message: String(r.message), request_payload: r.request_payload ?? {},
          action_code: actionCode, action_target: actionTarget,
          requested_by: userId, requested_by_label: userEmail,
        }).select('*').single();
        if (error) throw error;
        await appendEvent(admin, r.case_id, 'edd_note',
          `Client request sent: ${data.subject}`,
          { request_id: data.id, kind: data.kind }, userId, userEmail);
        return jsonResponse({ request: data });
      }

      case 'resolve_client_request': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.request_id) return jsonResponse({ error: 'request_id is required' }, 400);
        const { data, error } = await admin.schema('aml').from('client_requests')
          .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: userId })
          .eq('id', body.request_id).select('*').single();
        if (error) throw error;
        return jsonResponse({ request: data });
      }

      /* ═══════════ Submission review (Stage 3) ═══════════ */
      case 'get_submission_review': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const { data: caseRow } = await admin.schema('aml').from('cases')
          .select('*').eq('id', caseId).maybeSingle();
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);

        const { data: versions } = await admin.schema('aml').from('submission_versions')
          .select('*').eq('case_id', caseId).order('version_number', { ascending: false });
        const all = versions ?? [];
        const requested = body.version_number ? Number(body.version_number) : null;
        const current = requested ? all.find((v: any) => v.version_number === requested) : all[0];
        if (!current) {
          return jsonResponse({ submission: null, versions: [], message: 'No client submission yet.' });
        }
        const previous = all.find((v: any) => v.version_number < current.version_number) ?? null;

        const snap = (current.snapshot ?? {}) as any;
        const prevSnap = (previous?.snapshot ?? {}) as any;
        const diff = diffSubmissions(snap.sections ?? [], prevSnap.sections ?? []);

        const [{ data: reqs }, { data: docs }, { data: consents }, { data: recon },
               { data: checks }, { data: screening }, { data: openReqs }, { data: assessment },
               { data: pepDets }] = await Promise.all([
          admin.schema('aml').from('document_requirements').select('*').eq('case_id', caseId),
          admin.schema('aml').from('documents')
            .select('id, requirement_id, filename, mime_type, size_bytes, status, uploaded_at, reviewed_at, client_safe_rejection_reason, internal_review_note, version_number, previous_document_id, replacement_document_id')
            .eq('case_id', caseId).order('uploaded_at', { ascending: false }),
          admin.schema('aml').from('consents').select('kind, version, accepted_at, document_hash').eq('case_id', caseId),
          admin.schema('aml').from('party_reconciliation_items').select('*').eq('case_id', caseId),
          admin.schema('aml').from('verification_checks')
            .select('id, party_id, party_label, check_type, status, processing_status, attempt_consumed, authoritative, execution_mode, provider, completed_at, provider_error_category')
            .eq('case_id', caseId).order('created_at', { ascending: false }),
          admin.schema('aml').from('party_screening_subjects').select('*').eq('case_id', caseId),
          admin.schema('aml').from('client_requests').select('id, kind, subject, status, action_code, created_at')
            .eq('case_id', caseId).in('status', ['open', 'responded']),
          admin.schema('aml').from('risk_assessments').select('id, created_at, rating, score')
            .eq('case_id', caseId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          admin.schema('aml').from('pep_determinations')
            .select('id, determined_at').eq('case_id', caseId),
        ]);

        // Risk staleness: any canonical verification outcome or reconciliation
        // change after the latest assessment makes it stale, with reasons.
        const staleReasons: string[] = [];
        if (assessment?.created_at) {
          const since = new Date(assessment.created_at).getTime();
          if ((checks ?? []).some((c: any) => c.completed_at && new Date(c.completed_at).getTime() > since)) staleReasons.push('verification_changed');
          if ((recon ?? []).some((r: any) => new Date(r.updated_at ?? r.created_at).getTime() > since)) staleReasons.push('party_reconciliation_changed');
          if ((screening ?? []).some((s: any) => s.adjudicated_at && new Date(s.adjudicated_at).getTime() > since)) staleReasons.push('screening_adjudicated');
          if ((pepDets ?? []).some((d: any) => d.determined_at && new Date(d.determined_at).getTime() > since)) staleReasons.push('pep_determination_recorded');
          if (new Date(current.submitted_at).getTime() > since) staleReasons.push('new_submission');
          if (submissionDiffIsMaterial(diff)) staleReasons.push('material_information_changed');
        } else {
          staleReasons.push('no_assessment');
        }

        const missing: string[] = [];
        for (const r of (reqs ?? [])) {
          if (r.required && !['uploaded', 'accepted'].includes(r.status)) missing.push(`document:${r.code}`);
        }
        for (const r of (recon ?? [])) {
          if (r.resolution_status === 'open') missing.push(`party_reconciliation:${r.declared_name}`);
        }
        // Every non-terminal state is outstanding — queued and processing are
        // work not yet done, and a technical error must stay outstanding and
        // retryable, never read as clear. A satisfied screening past its
        // refresh date is outstanding again. (Shared rule: partyScreening.pure.ts.)
        const nowIso = new Date().toISOString();
        for (const s of (screening ?? [])) {
          if (isPartyScreeningMissing(s, nowIso)) missing.push(`screening:${s.screened_name}`);
        }

        return jsonResponse({
          case: {
            id: caseRow.id, reference: caseRow.case_reference, subject: caseRow.subject_display_name,
            status: caseRow.status, case_stage: caseRow.case_stage,
            client_portal_status: caseRow.client_portal_status,
            // Read-only context: acceptance never moves the gate.
            service_gate_status: caseRow.service_gate_status,
          },
          submission: {
            id: current.id, version_number: current.version_number,
            review_status: current.review_status ?? 'submitted',
            submitted_at: current.submitted_at, submitted_by_type: current.submitted_by_type,
            submitted_by: current.submitted_by,
            review_reason: current.review_reason ?? null,
            reviewed_at: current.review_decided_at ?? current.reviewed_at ?? null,
            questionnaire_version: snap.questionnaire_version ?? null,
            consent_version: snap.consent_version ?? null,
            applicable_sections: snap.applicable_sections ?? [],
            sections: snap.sections ?? [],
            superseded_at: current.superseded_at ?? null,
          },
          previous_version: previous ? { id: previous.id, version_number: previous.version_number, submitted_at: previous.submitted_at } : null,
          differences: diff,
          differences_material: submissionDiffIsMaterial(diff),
          versions: all.map((v: any) => ({
            id: v.id, version_number: v.version_number, submitted_at: v.submitted_at,
            review_status: v.review_status ?? 'submitted',
          })),
          consent_evidence: (consents ?? []).map((c: any) => ({
            kind: c.kind, version: c.version, accepted_at: c.accepted_at, document_hash: c.document_hash,
          })),
          related_parties: (recon ?? []).map((r: any) => ({
            id: r.id, declared_role: r.declared_role, declared_name: r.declared_name,
            change_kind: r.change_kind, resolution_status: r.resolution_status,
            resolved_party_type: r.resolved_party_type, resolved_party_id: r.resolved_party_id,
            verification_required: r.verification_required, screening_required: r.screening_required,
            conflicts: r.conflicts ?? [], similarity_candidates: r.similarity_candidates ?? [],
            exact_candidate_id: r.exact_candidate_id, exact_candidate_type: r.exact_candidate_type,
          })),
          requirements: reqs ?? [],
          documents: (docs ?? []).map((d: any) => ({
            ...d,
            // Internal reviewer reasoning is staff-only; auditors and analysts
            // may read it, but it never leaves this staff response.
            internal_review_note: canWrite || roles.has('auditor') ? d.internal_review_note : null,
          })),
          verification: (checks ?? []).map((c: any) => ({
            id: c.id, party_id: c.party_id, party_label: c.party_label, check_type: c.check_type,
            status: c.status, processing_status: c.processing_status,
            authoritative: c.authoritative, execution_mode: c.execution_mode,
            attempt_consumed: c.attempt_consumed, provider: c.provider,
            completed_at: c.completed_at, provider_error_category: c.provider_error_category,
          })),
          screening: screening ?? [],
          open_requests: openReqs ?? [],
          missing_mandatory: missing,
          risk: { latest_assessment_at: assessment?.created_at ?? null, stale: staleReasons.length > 0, stale_reasons: staleReasons },
        });
      }

      case 'accept_submission':
      case 'request_submission_changes':
      case 'request_submission_document':
      case 'request_submission_clarification':
      case 'escalate_submission':
      case 'supersede_submission': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const needsReviewer = op === 'accept_submission' || op === 'escalate_submission';
        if (needsReviewer && !(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        const submissionId = String(body.submission_id ?? '');
        const reason = String(body.reason ?? '').trim();
        if (!submissionId) return jsonResponse({ error: 'submission_id required' }, 400);
        if (op !== 'accept_submission' && reason.length < 10) {
          return jsonResponse({ error: 'A reason of at least 10 characters is required' }, 400);
        }
        const { data: sub } = await admin.schema('aml').from('submission_versions')
          .select('*, cases:case_id(id, status, case_stage)').eq('id', submissionId).maybeSingle();
        if (!sub) return jsonResponse({ error: 'Submission not found' }, 404);
        if (body.case_id && String(body.case_id) !== String(sub.case_id)) {
          return jsonResponse({ error: 'Submission does not belong to that case' }, 403);
        }

        const nextStatus = op === 'accept_submission' ? 'accepted'
          : op === 'escalate_submission' ? 'escalated'
          : op === 'supersede_submission' ? 'superseded'
          : 'changes_requested';

        const patch: Record<string, unknown> = {
          review_status: nextStatus,
          review_decided_by: userId,
          review_decided_at: new Date().toISOString(),
          review_reason: reason || null,
        };
        if (op === 'supersede_submission') {
          patch.superseded_at = new Date().toISOString();
          patch.superseded_reason = reason;
        }
        // The snapshot column is NEVER written here: prior submitted content
        // is immutable by contract.
        const { data: updated, error: upErr } = await admin.schema('aml').from('submission_versions')
          .update(patch).eq('id', submissionId).select('*').single();
        if (upErr) throw upErr;

        // Client-safe workflow state. The service gate is deliberately absent:
        // only an authorised reviewer/MLRO decision moves it, elsewhere.
        const casePatch: Record<string, unknown> = {};
        if (op === 'accept_submission') {
          casePatch.client_portal_status = 'under_review';
          casePatch.case_stage = 'staff_review';
        } else if (op === 'escalate_submission') {
          casePatch.client_portal_status = 'under_review';
        } else if (nextStatus === 'changes_requested') {
          casePatch.client_portal_status = 'additional_info_required';
        }
        if (Object.keys(casePatch).length > 0) {
          const { error: caseErr } = await admin.schema('aml').from('cases').update(casePatch).eq('id', sub.case_id);
          if (caseErr) await admin.schema('aml').from('cases')
            .update({ client_portal_status: casePatch.client_portal_status }).eq('id', sub.case_id);
        }

        // Changes/document/clarification requests create the actionable client
        // request; its trigger writes the notification and outbox event in the
        // same transaction.
        let createdRequest: any = null;
        if (['request_submission_changes', 'request_submission_document', 'request_submission_clarification'].includes(op)) {
          const actionCode = op === 'request_submission_document' ? 'upload_document'
            : op === 'request_submission_clarification' ? 'provide_clarification'
            : 'review_and_submit';
          // Through the same validator as every other request. This path used
          // to take `String(body.section_code)` verbatim — an unvalidated
          // routing value is a routing value the caller chooses.
          const actionTarget = sanitiseActionTarget({
            requirement_id: body.requirement_id,
            section_code: body.section_code,
            target_step: op === 'request_submission_document' ? 'documents' : 'review',
          });
          const { data: reqRow, error: reqErr } = await admin.schema('aml').from('client_requests').insert({
            case_id: sub.case_id,
            kind: op === 'request_submission_document' ? 'new_document'
              : op === 'request_submission_clarification' ? 'clarification' : 'additional_info',
            subject: String(body.subject ?? 'Information needed on your submission').slice(0, 200),
            message: String(body.client_message ?? reason).slice(0, 4000),
            action_code: actionCode,
            action_target: actionTarget,
            requested_by: userId, requested_by_label: userEmail,
          }).select('*').single();
          if (reqErr) throw reqErr;
          createdRequest = reqRow;
        }

        await appendEvent(admin, sub.case_id, 'edd_note',
          `Submission v${sub.version_number} ${nextStatus.replace('_', ' ')}`,
          { submission_id: submissionId, review_status: nextStatus, reason: reason || null,
            client_request_id: createdRequest?.id ?? null,
            service_gate_unchanged: true },
          userId, userEmail);

        return jsonResponse({ submission: updated, client_request: createdRequest });
      }

      /* ═══════════ Document review with dual reasons (Stage 9) ═══════════ */
      case 'review_document_v2': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const documentId = String(body.document_id ?? '');
        const decision = String(body.decision ?? '');
        if (!documentId || !['accepted', 'rejected'].includes(decision)) {
          return jsonResponse({ error: 'document_id and decision (accepted|rejected) required' }, 400);
        }
        const { data: doc } = await admin.schema('aml').from('documents')
          .select('*').eq('id', documentId).maybeSingle();
        if (!doc) return jsonResponse({ error: 'Document not found' }, 404);

        const internalNote = String(body.internal_review_note ?? '').trim();
        const safeReasonCode = String(body.client_safe_reason_code ?? '');
        if (decision === 'rejected') {
          if (!isClientSafeRejectionReason(safeReasonCode)) {
            return jsonResponse({
              error: 'A client-safe rejection reason code is required',
              allowed: CLIENT_SAFE_REJECTION_REASONS,
            }, 400);
          }
          if (internalNote.length < 5) {
            return jsonResponse({ error: 'An internal review reason is required' }, 400);
          }
        }
        const safeCopy = decision === 'rejected'
          ? String(body.client_safe_message ?? CLIENT_SAFE_REJECTION_COPY[safeReasonCode]).slice(0, 500)
          : null;

        const { data: updated, error: docErr } = await admin.schema('aml').from('documents').update({
          status: decision,
          // Legacy column keeps the client-safe text so older readers stay
          // correct; internal reasoning lives only in internal_review_note.
          rejection_reason: safeCopy,
          client_safe_rejection_reason: safeCopy,
          internal_review_note: internalNote || null,
          reviewed_by: userId, reviewed_at: new Date().toISOString(),
        }).eq('id', documentId).select('*').single();
        if (docErr) throw docErr;

        if (doc.requirement_id) {
          await admin.schema('aml').from('document_requirements')
            .update({ status: decision === 'accepted' ? 'accepted' : 'outstanding' })
            .eq('id', doc.requirement_id);
        }

        let createdRequest: any = null;
        if (decision === 'rejected') {
          const { data: reqRow } = await admin.schema('aml').from('client_requests').insert({
            case_id: doc.case_id, kind: 'new_document',
            subject: 'A document needs replacing',
            message: safeCopy ?? 'Please upload a replacement document.',
            action_code: 'upload_document',
            action_target: { requirement_id: doc.requirement_id ?? null, target_step: 'documents' },
            requested_by: userId, requested_by_label: userEmail,
          }).select('*').single();
          createdRequest = reqRow ?? null;
        }

        await appendEvent(admin, doc.case_id, 'system',
          `Document ${decision}: ${doc.filename}`,
          { document_id: documentId, decision, client_safe_reason_code: decision === 'rejected' ? safeReasonCode : null,
            requirement_id: doc.requirement_id ?? null, client_request_id: createdRequest?.id ?? null },
          userId, userEmail);

        return jsonResponse({ document: updated, client_request: createdRequest });
      }

      /* ═══════════ Party reconciliation (Stages 13/14) ═══════════ */
      case 'list_party_reconciliation': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const { data } = await admin.schema('aml').from('party_reconciliation_items')
          .select('*').eq('case_id', caseId).order('created_at', { ascending: true });
        return jsonResponse({ items: data ?? [] });
      }

      case 'resolve_party_reconciliation': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const itemId = String(body.item_id ?? '');
        const resolution = String(body.resolution ?? '');
        const rationale = String(body.rationale ?? '').trim();
        const allowed = ['linked', 'created', 'manual_only', 'rejected', 'superseded', 'conflict'];
        if (!itemId || !allowed.includes(resolution)) {
          return jsonResponse({ error: `item_id and resolution (${allowed.join('|')}) required` }, 400);
        }
        if (rationale.length < 5) return jsonResponse({ error: 'A rationale is required' }, 400);
        const { data: item } = await admin.schema('aml').from('party_reconciliation_items')
          .select('*').eq('id', itemId).maybeSingle();
        if (!item) return jsonResponse({ error: 'Item not found' }, 404);

        let partyType = item.resolved_party_type;
        let partyId = item.resolved_party_id;
        if (resolution === 'linked') {
          partyType = String(body.party_type ?? '');
          partyId = String(body.party_id ?? '');
          if (!partyType || !partyId) return jsonResponse({ error: 'party_type and party_id required to link' }, 400);
          // Cross-case / cross-tenant linking is refused: the canonical party
          // must belong to an entity on THIS case.
          const { data: owner } = await admin.schema('aml')
            .from(partyType === 'beneficial_owner' ? 'beneficial_owners' : 'authorised_representatives')
            .select('id, entity_id, aml_entities:entity_id(case_id)').eq('id', partyId).maybeSingle();
          const ownerCase = (owner as any)?.aml_entities?.case_id ?? null;
          if (!owner || (ownerCase && String(ownerCase) !== String(item.case_id))) {
            return jsonResponse({ error: 'That party does not belong to this case', code: 'cross_case_denied' }, 403);
          }
        }

        const { data: updated, error } = await admin.schema('aml').from('party_reconciliation_items').update({
          resolution_status: resolution,
          resolved_party_type: partyType ?? null,
          resolved_party_id: partyId ?? null,
          resolution_rationale: rationale,
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', itemId).select('*').single();
        if (error) throw error;

        // Field-level provenance for every declared value at resolution time.
        const provenance = Object.entries((item.declared_payload ?? {}) as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
          .slice(0, 40)
          .map(([field, value]) => ({
            case_id: item.case_id, reconciliation_item_id: item.id,
            party_type: partyType ?? null, party_id: partyId ?? null,
            source_submission_id: item.submission_id, source_section: 'related_parties',
            source_field: field, submitted_value: String(value).slice(0, 500),
            canonical_value: resolution === 'linked' || resolution === 'created' ? String(value).slice(0, 500) : null,
            resolution_status: resolution, actor_id: userId, actor_label: userEmail, rationale,
          }));
        if (provenance.length > 0) {
          await admin.schema('aml').from('party_field_provenance').insert(provenance);
        }

        // Screening work follows reconciliation, never precedes it. The
        // subject carries every identifying detail the declaration already
        // holds — matching on a bare display name wastes the matcher's
        // DOB/alias tolerance. Nothing is invented: absent stays absent.
        if (['linked', 'created'].includes(resolution) && item.screening_required) {
          const declared = (item.declared_payload ?? {}) as Record<string, unknown>;
          const declaredDob = typeof declared.date_of_birth === 'string' ? declared.date_of_birth : null;
          const declaredCountry = typeof declared.country === 'string' ? declared.country
            : typeof declared.nationality === 'string' ? declared.nationality : null;
          const declaredAliases = Array.isArray(declared.aliases)
            ? declared.aliases.filter((a) => typeof a === 'string').slice(0, 20)
            : [];
          await admin.schema('aml').from('party_screening_subjects').insert({
            case_id: item.case_id, party_type: partyType ?? item.declared_role,
            party_id: partyId ?? null, reconciliation_item_id: item.id,
            screened_name: item.declared_name, required: true, state: 'not_started',
            aliases: declaredAliases,
            date_of_birth: declaredDob,
            country: declaredCountry,
          });
        }

        await appendEvent(admin, item.case_id, 'system',
          `Party reconciliation ${resolution}: ${item.declared_name}`,
          { reconciliation_item_id: itemId, resolution, party_type: partyType, party_id: partyId },
          userId, userEmail);
        return jsonResponse({ item: updated });
      }

      /* ═══════════ Party verification links (Stage 15) ═══════════ */
      case 'list_party_verification_links': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const [{ data: links }, { data: checks }] = await Promise.all([
          admin.schema('aml').from('party_verification_links')
            .select('*').eq('case_id', caseId).is('unlinked_at', null),
          admin.schema('aml').from('verification_checks')
            .select('id, party_label, check_type, status, authoritative, execution_mode, completed_at')
            .eq('case_id', caseId).order('created_at', { ascending: false }),
        ]);
        return jsonResponse({ links: links ?? [], eligible_checks: (checks ?? []).filter((c: any) => c.authoritative !== false) });
      }

      case 'link_party_verification': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const caseId = String(body.case_id ?? '');
        const partyType = String(body.party_type ?? '');
        const checkId = String(body.verification_check_id ?? '');
        if (!caseId || !partyType || !checkId) {
          return jsonResponse({ error: 'case_id, party_type and verification_check_id required' }, 400);
        }
        const { data: check } = await admin.schema('aml').from('verification_checks')
          .select('id, case_id, status, authoritative, execution_mode, check_type').eq('id', checkId).maybeSingle();
        if (!check) return jsonResponse({ error: 'Verification check not found' }, 404);
        // Cross-case linking is impossible by contract.
        if (String(check.case_id) !== caseId) {
          return jsonResponse({ error: 'That check belongs to a different case', code: 'cross_case_denied' }, 403);
        }
        if (check.execution_mode === 'simulation' || check.authoritative === false) {
          return jsonResponse({ error: 'A simulated or non-authoritative check cannot be evidence', code: 'not_authoritative' }, 409);
        }
        const { data: link, error } = await admin.schema('aml').from('party_verification_links').insert({
          case_id: caseId, party_type: partyType, party_id: body.party_id ? String(body.party_id) : null,
          verification_check_id: checkId, relationship: String(body.relationship ?? 'identity_evidence'),
          authoritative: check.authoritative !== false, linked_by: userId,
          metadata: { check_type: check.check_type, linked_status: check.status },
        }).select('*').single();
        if (error) throw error;
        // Convenience pointer on the canonical party row — derived, never a
        // substitute for the link evidence.
        if (body.party_id && ['beneficial_owner', 'authorised_representative'].includes(partyType)) {
          await admin.schema('aml')
            .from(partyType === 'beneficial_owner' ? 'beneficial_owners' : 'authorised_representatives')
            .update({ verification_check_id: checkId }).eq('id', String(body.party_id));
        }
        await appendEvent(admin, caseId, 'system', 'Party verification evidence linked',
          { party_type: partyType, party_id: body.party_id ?? null, verification_check_id: checkId },
          userId, userEmail);
        return jsonResponse({ link });
      }

      case 'unlink_party_verification': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const linkId = String(body.link_id ?? '');
        const reason = String(body.reason ?? '').trim();
        if (!linkId) return jsonResponse({ error: 'link_id required' }, 400);
        if (reason.length < 5) return jsonResponse({ error: 'An unlink reason is required' }, 400);
        const { data: link, error } = await admin.schema('aml').from('party_verification_links')
          .update({ unlinked_at: new Date().toISOString(), unlink_reason: reason })
          .eq('id', linkId).is('unlinked_at', null).select('*').single();
        if (error) throw error;
        await appendEvent(admin, link.case_id, 'system', 'Party verification evidence unlinked',
          { link_id: linkId, reason }, userId, userEmail);
        return jsonResponse({ link });
      }

      /* ═══════════ Party-scoped screening (Stage 16) ═══════════ */
      /**
       * One idempotent read that answers all of Stage 5.
       *
       * It enrols whoever is missing, works out which scopes are
       * proportionate for this case, records that decision once with the
       * client's own answers attached, and returns the single next action a
       * person actually has to take.
       *
       * It never produces a screening OUTCOME. It does not write "clear", it
       * does not write a PEP result, and it does not advance a stage — the
       * stage is derived from evidence, and completing it is not a
       * service-gate approval.
       */
      case 'sync_screening_stage': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);

        const { data: caseRow } = await admin.schema('aml').from('cases')
          .select('id, status, risk_rating, subject_display_name').eq('id', caseId).maybeSingle();
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);

        const enrol = await ensureScreeningSubjects(admin, caseId, userId, userEmail);

        const [{ data: submission }, { data: determinations }, { data: provider },
               { data: syncs }] = await Promise.all([
          admin.schema('aml').from('submission_versions')
            .select('snapshot').eq('case_id', caseId).is('superseded_at', null)
            .order('version_number', { ascending: false }).limit(1).maybeSingle(),
          admin.schema('aml').from('pep_determinations')
            .select('id, party_screening_subject_id, result, review_due_at, superseded_at')
            .eq('case_id', caseId).is('superseded_at', null),
          // Several tenants may hold a row for this capability; take the one
          // the dispatcher would. maybeSingle() would error on more than one.
          admin.schema('aml').from('provider_configs')
            .select('provider_key, mode, active, priority').eq('capability', 'pep_sanctions')
            .order('priority', { ascending: true }).limit(1),
          admin.schema('aml').from('sanctions_list_syncs')
            .select('list_code, status, entry_count, completed_at, started_at')
            .order('started_at', { ascending: false }).limit(50),
        ]);

        /*
         * How long the oldest unprocessed screening request has been waiting.
         * `queued` only means "running" if something is consuming the queue,
         * and for months nothing was — a request sat with attempts = 0 while
         * the workspace reported the engine was working.
         */
        const { data: pending } = await admin.from('integration_outbox')
          .select('occurred_at')
          .eq('event_type', 'aml.screening.requested')
          .is('processed_at', null)
          .order('occurred_at', { ascending: true }).limit(1);
        const oldestQueued = Array.isArray(pending) ? pending[0] ?? null : null;
        const oldestQueuedSeconds = oldestQueued?.occurred_at
          ? Math.max(0, Math.floor(
            (Date.now() - new Date(oldestQueued.occurred_at).getTime()) / 1000))
          : null;

        const sections = (((submission?.snapshot ?? {}) as any).sections ?? []) as any[];
        const payload = (name: string): Record<string, unknown> =>
          (sections.find((x: any) => x?.section === name)?.payload ?? {}) as Record<string, unknown>;
        const yesNo = (v: unknown) => (v === 'yes' || v === true ? 'yes'
          : v === 'no' || v === false ? 'no' : null) as 'yes' | 'no' | null;

        const personal = payload('personal_details');
        const purchase = payload('purchase_profile');
        const funding = payload('funding');
        const structure = payload('purchasing_structure');

        const nowIso = new Date().toISOString();
        const detBySubject = new Map<string, any>();
        for (const d of determinations ?? []) {
          if (d.party_screening_subject_id) detBySubject.set(String(d.party_screening_subject_id), d);
        }
        const currentDetermination = (subjectId: string) => {
          const d = detBySubject.get(subjectId);
          if (!d || d.superseded_at) return null;
          if (d.review_due_at && String(d.review_due_at) < nowIso) return null;
          return d;
        };

        const required = (enrol.subjects ?? []).filter((s: any) =>
          s.required && s.state !== 'not_required');
        const anyPepFinding = required.some((s: any) =>
          currentDetermination(String(s.id))?.result === 'pep');

        const policy = decideScreeningPolicy({
          answers: {
            pep: yesNo(personal.pep), adverse: yesNo(personal.adverse),
            thirdParty: yesNo(purchase.third_party), overseasFunding: yesNo(funding.overseas),
          },
          entityType: typeof structure.entity_type === 'string' ? structure.entity_type : null,
          riskRating: caseRow.risk_rating ?? null,
          enhancedDueDiligence: caseRow.status === 'edd_required',
          anyPepFinding,
        });

        /*
         * Provider readiness, read the same way the freshness gate enforces
         * it: a live active provider AND a DFAT list loaded with entries.
         * A "successful" sync that published nothing is not a load.
         */
        const dfat = (syncs ?? []).filter((x: any) => x.list_code === 'dfat');
        const dfatLoaded = dfat.some((x: any) => x.status === 'succeeded' && Number(x.entry_count) > 0);
        const providerRow: any = Array.isArray(provider) ? provider[0] ?? null : provider ?? null;
        const providerReady = providerRow !== null && providerRow.active === true &&
          providerRow.mode === 'live' && dfatLoaded;

        const nextAction = deriveScreeningNextAction({
          hasSubmission: enrol.hasSubmission,
          subjectCount: required.length,
          providerReady,
          anyUnscreened: required.some((s: any) =>
            !['completed', 'false_positive', 'confirmed_match', 'queued', 'processing'].includes(s.state)),
          anyProcessing: required.some((s: any) => ['queued', 'processing'].includes(s.state)),
          anyPossibleMatch: required.some((s: any) => s.state === 'possible_match'),
          anyConfirmedMatch: required.some((s: any) => s.state === 'confirmed_match'),
          anyMissingPep: required.some((s: any) => !currentDetermination(String(s.id))),
          pepRoute: policy.pepRoute,
          oldestQueuedSeconds,
        });

        /*
         * Record the scope decision once, with the answers that produced it.
         * Re-recording an unchanged decision on every page load would bury
         * the audit trail, so it is written only when it differs from the
         * last one — which also makes a CHANGE (a new risk rating, a revised
         * answer) visible as its own entry rather than as noise.
         */
        const { data: priorEvents } = await admin.schema('aml').from('case_events')
          .select('payload, created_at').eq('case_id', caseId)
          .order('created_at', { ascending: false }).limit(60);
        const priorDecision = (priorEvents ?? [])
          .map((e: any) => e?.payload)
          .find((p: any) => p?.reason === 'screening_scope_decision');
        const fingerprint = JSON.stringify({
          required: policy.required, evidence: policy.evidence,
          route: policy.pepRoute, version: policy.policyVersion,
        });
        let decisionRecorded = false;
        if (!priorDecision || String(priorDecision.fingerprint ?? '') !== fingerprint) {
          await appendEvent(admin, caseId, 'system',
            policy.notRequired.length > 0
              ? 'Screening scope reduced to sanctions and PEP under AML/CTF policy '
                + policy.policyVersion
              : 'Screening scope: full, under AML/CTF policy ' + policy.policyVersion,
            {
              reason: 'screening_scope_decision',
              fingerprint,
              policy_version: policy.policyVersion,
              required_scopes: policy.required,
              not_required: policy.notRequired,
              triggers: policy.triggers,
              pep_route: policy.pepRoute,
              client_answers: policy.evidence,
            },
            userId, userEmail);
          decisionRecorded = true;
        }

        return jsonResponse({
          enrolled: enrol.enrolled,
          subjects: enrol.subjects,
          policy,
          provider_ready: providerReady,
          next_action: nextAction,
          decision_recorded: decisionRecorded,
        });
      }

      case 'list_party_screening': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        // Enrolment runs on read so every existing case self-heals the first
        // time somebody opens it. Idempotent: it returns only what is missing.
        const enrolment = await ensureScreeningSubjects(admin, caseId, userId, userEmail);
        const [{ data: subjects }, { data: determinations }] = await Promise.all([
          Promise.resolve({ data: enrolment.subjects }),
          admin.schema('aml').from('pep_determinations')
            .select('id, party_screening_subject_id, subject_name, result, pep_type, pep_relationship, determined_at, determined_by_label, review_due_at, superseded_at')
            .eq('case_id', caseId).is('superseded_at', null),
        ]);
        // Staff adjudicate the actual canonical candidates, so the panel
        // needs to show them. Staff-side only — this response never reaches
        // the Client or Finance portals.
        const checkIds = (subjects ?? []).map((s: any) => s.screening_check_id).filter(Boolean);
        let matchesByCheck: Record<string, any[]> = {};
        if (checkIds.length > 0) {
          const { data: matches } = await admin.schema('aml').from('screening_matches')
            .select('id, screening_check_id, match_type, list_name, matched_name, score, jurisdiction, status, details')
            .in('screening_check_id', checkIds).order('score', { ascending: false });
          for (const m of matches ?? []) {
            (matchesByCheck[m.screening_check_id] ??= []).push(m);
          }
        }
        const detBySubject = new Map<string, any>();
        for (const d of determinations ?? []) {
          if (d.party_screening_subject_id) detBySubject.set(String(d.party_screening_subject_id), d);
        }
        const caseLevelPep = (determinations ?? []).find((d: any) => !d.party_screening_subject_id) ?? null;
        return jsonResponse({
          subjects: (subjects ?? []).map((s: any) => ({
            ...s,
            matches: s.screening_check_id ? (matchesByCheck[s.screening_check_id] ?? []) : [],
            pep_determination: detBySubject.get(String(s.id)) ?? null,
          })),
          case_pep_determination: caseLevelPep,
        });
      }

      case 'queue_party_screening': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const subjectId = String(body.subject_id ?? '');
        if (!subjectId) return jsonResponse({ error: 'subject_id required' }, 400);
        const { data: subject } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        if (!subject) return jsonResponse({ error: 'Subject not found' }, 404);
        // Already in flight — the queued event exists; do not emit another.
        if (['queued', 'processing'].includes(subject.state)) {
          return jsonResponse({ skipped: true, code: 'already_in_progress', subject });
        }
        // Candidates must be adjudicated through the canonical matches, not
        // papered over by a re-screen.
        if (['possible_match', 'confirmed_match'].includes(subject.state)) {
          return jsonResponse({
            error: 'This subject has candidate or confirmed matches — adjudicate them before re-screening',
            code: 'adjudication_required',
          }, 409);
        }
        // Freshness window: do not re-screen the same party inside it.
        const freshnessDays = Math.min(Math.max(Number(body.freshness_days ?? 90) || 90, 1), 365);
        if (subject.last_screened_at &&
            Date.now() - new Date(subject.last_screened_at).getTime() < freshnessDays * 864e5 &&
            ['completed', 'false_positive'].includes(subject.state)) {
          return jsonResponse({ skipped: true, code: 'within_freshness_window', subject });
        }
        // The transition to 'queued' emits aml.screening.requested through the
        // transactional outbox trigger; the cross-portal worker executes it
        // against the canonical screening engine.
        const { data: updated, error } = await admin.schema('aml').from('party_screening_subjects')
          .update({ state: 'queued', error_category: null, updated_at: new Date().toISOString() })
          .eq('id', subjectId).select('*').single();
        if (error) throw error;
        await appendEvent(admin, subject.case_id, 'system',
          `Party screening queued: ${subject.screened_name}`,
          { party_screening_subject_id: subjectId }, userId, userEmail);
        return jsonResponse({ subject: updated });
      }

      /**
       * Release a screening request that nothing ever picked up.
       *
       * `queue_party_screening` refuses a subject already `queued` — correctly,
       * because a second provider attempt costs money and can race the first.
       * That refusal assumed the queue was being consumed. It was not: the
       * outbox worker had no cron entry, so a request sat with attempts = 0
       * for ever and the only way out was a database edit.
       *
       * This is bounded and evidence-driven. It refuses unless the subject is
       * genuinely stuck — queued, with no screening check, and with a queue
       * entry older than the stall window — so it can never cancel work that
       * is actually in flight. It retires the dead outbox rows rather than
       * leaving them to be claimed later and race the retry, and it produces
       * no screening outcome.
       */
      case 'retry_stalled_screening': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const subjectId = String(body.subject_id ?? '');
        if (!subjectId) return jsonResponse({ error: 'subject_id required' }, 400);
        const { data: subject } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        if (!subject) return jsonResponse({ error: 'Subject not found' }, 404);
        if (!['queued', 'processing'].includes(subject.state)) {
          return jsonResponse({ skipped: true, code: 'not_queued', subject });
        }
        if (subject.screening_check_id) {
          // A check exists, so the provider was reached. That is in flight or
          // finished, and releasing it would risk a duplicate attempt.
          return jsonResponse({ skipped: true, code: 'check_in_flight', subject });
        }

        const { data: pending } = await admin.from('integration_outbox')
          .select('id, occurred_at')
          .eq('event_type', 'aml.screening.requested')
          .is('processed_at', null)
          .order('occurred_at', { ascending: true });
        const stale = (pending ?? []).filter((e: any) =>
          Date.now() - new Date(e.occurred_at).getTime() >= SCREENING_STALL_SECONDS * 1000);
        if (stale.length === 0) {
          return jsonResponse({ skipped: true, code: 'not_stalled', subject });
        }

        // Retire the dead entries first, so the fresh request cannot race one
        // of them being claimed late.
        await admin.from('integration_outbox')
          .update({
            processed_at: new Date().toISOString(),
            locked_at: null, locked_by: null,
            last_error: 'superseded_by_operator_retry',
          })
          .in('id', stale.map((e: any) => e.id));

        const { data: released, error: releaseError } = await admin.schema('aml')
          .from('party_screening_subjects')
          .update({ state: 'not_started', error_category: null, updated_at: new Date().toISOString() })
          .eq('id', subjectId).select('*').single();
        if (releaseError) throw releaseError;

        await appendEvent(admin, subject.case_id, 'system',
          `Released a stalled screening request: ${subject.screened_name}`,
          {
            reason: 'screening_stall_released',
            party_screening_subject_id: subjectId,
            retired_outbox_events: stale.length,
          },
          userId, userEmail);
        return jsonResponse({ subject: released, retired: stale.length });
      }

      case 'adjudicate_party_screening': {
        if (!(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        // Adjudication happens on the CANONICAL screening match, exactly as
        // aml-verification resolve_match does it — hash-chained resolution
        // row, match status change, then the party state is re-derived from
        // the full canonical match set. Updating party_screening_subjects
        // alone can no longer manufacture or bury a sanctions finding.
        const subjectId = String(body.subject_id ?? '');
        const matchId = String(body.match_id ?? '');
        const outcome = String(body.outcome ?? '');
        const note = String(body.note ?? '').trim();
        if (!subjectId || !['confirmed_match', 'false_positive'].includes(outcome)) {
          return jsonResponse({ error: 'subject_id and outcome (confirmed_match|false_positive) required' }, 400);
        }
        if (!matchId) {
          return jsonResponse({
            error: 'match_id required — party adjudication resolves the canonical screening match, not the projection',
            code: 'canonical_match_required',
          }, 400);
        }
        if (note.length < 5) return jsonResponse({ error: 'An adjudication note is required' }, 400);

        const { data: subject } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        if (!subject) return jsonResponse({ error: 'Subject not found' }, 404);
        if (!subject.screening_check_id) {
          return jsonResponse({
            error: 'No canonical screening exists for this subject yet — run the screening first',
            code: 'no_canonical_screening',
          }, 409);
        }
        const { data: match } = await admin.schema('aml').from('screening_matches')
          .select('*').eq('id', matchId).maybeSingle();
        if (!match) return jsonResponse({ error: 'Match not found' }, 404);
        if (String(match.screening_check_id) !== String(subject.screening_check_id)) {
          return jsonResponse({ error: 'That match does not belong to this subject\'s screening', code: 'cross_check_denied' }, 403);
        }

        const disposition = outcome === 'confirmed_match' ? 'confirmed' : 'dismissed';
        const { data: prevRes } = await admin.schema('aml').from('match_resolutions')
          .select('row_hash').eq('match_id', matchId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        const prevHash = prevRes?.row_hash ?? null;
        const now = new Date().toISOString();
        const resHashInput = JSON.stringify({
          match_id: matchId, case_id: match.case_id, disposition, rationale: note,
          resolved_by: userId, prev_hash: prevHash, created_at: now,
        });
        const resHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(resHashInput));
        const rowHash = Array.from(new Uint8Array(resHashBuf)).map((x) => x.toString(16).padStart(2, '0')).join('');

        const { data: resolution, error: resErr } = await admin.schema('aml').from('match_resolutions').insert({
          match_id: matchId, case_id: match.case_id, disposition, rationale: note,
          resolved_by: userId, resolved_by_label: userEmail,
          prev_hash: prevHash, row_hash: rowHash, created_at: now,
        }).select('*').single();
        if (resErr) throw resErr;
        await admin.schema('aml').from('screening_matches')
          .update({ status: disposition }).eq('id', matchId);

        // Party state is a projection of the canonical match set.
        const { data: allMatches } = await admin.schema('aml').from('screening_matches')
          .select('status').eq('screening_check_id', subject.screening_check_id);
        const projected = projectPartyScreeningState((allMatches ?? []).map((m: any) => m.status));
        const { data: updated, error } = await admin.schema('aml').from('party_screening_subjects').update({
          state: projected, adjudicated_by: userId, adjudicated_at: now,
          adjudication_note: note, updated_at: now,
        }).eq('id', subjectId).select('*').single();
        if (error) throw error;

        await appendEvent(admin, updated.case_id, 'mlro_decision',
          `Party screening match ${match.matched_name} ${disposition} for ${updated.screened_name} → ${projected}`,
          { party_screening_subject_id: subjectId, match_id: matchId, disposition,
            resolution_id: resolution?.id, projected_state: projected }, userId, userEmail);
        return jsonResponse({ subject: updated, match: { ...match, status: disposition }, resolution });
      }

      /* ═══════════ PEP determinations (screening repair) ═══════════ */
      // A determination records who was assessed, the result, how it was
      // reached, by whom, when, and why the conclusion was reasonable —
      // AUSTRAC's "records to show how you've established if a person is a
      // PEP". Staff-side only; never projected to Client or Finance portals.
      case 'list_pep_determinations': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const { data } = await admin.schema('aml').from('pep_determinations')
          .select('*').eq('case_id', caseId).order('determined_at', { ascending: false });
        return jsonResponse({ determinations: data ?? [] });
      }

      case 'record_pep_determination': {
        if (!(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        const caseId = String(body.case_id ?? '');
        const subjectName = String(body.subject_name ?? '').trim();
        const result = String(body.result ?? '');
        const rationale = String(body.rationale ?? '').trim();
        const pepType = body.pep_type ? String(body.pep_type) : null;
        const pepRelationship = body.pep_relationship ? String(body.pep_relationship) : null;
        const methods = Array.isArray(body.methods) ? body.methods : [];
        const partySubjectId = body.party_screening_subject_id ? String(body.party_screening_subject_id) : null;

        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        if (!['not_pep', 'pep'].includes(result)) {
          return jsonResponse({ error: 'result must be not_pep or pep' }, 400);
        }
        if (result === 'pep') {
          if (!['foreign', 'domestic', 'international_organisation'].includes(pepType ?? '')) {
            return jsonResponse({ error: 'pep_type (foreign|domestic|international_organisation) is required for a pep result' }, 400);
          }
          if (!['self', 'family_member', 'close_associate'].includes(pepRelationship ?? '')) {
            return jsonResponse({ error: 'pep_relationship (self|family_member|close_associate) is required for a pep result' }, 400);
          }
        }
        if (rationale.length < 10) {
          return jsonResponse({ error: 'A rationale of at least 10 characters is required — record why the conclusion was reasonable' }, 400);
        }
        // Sources/methods are the evidence trail: at least one, references
        // and metadata only. A "not PEP" with no recorded method is a guess,
        // not a determination.
        const cleanMethods = methods
          .filter((m: any) => m && typeof m === 'object' && typeof m.source === 'string' && m.source.trim())
          .map((m: any) => ({
            source: String(m.source).slice(0, 300),
            reference: typeof m.reference === 'string' ? m.reference.slice(0, 500) : null,
            note: typeof m.note === 'string' ? m.note.slice(0, 500) : null,
          })).slice(0, 20);
        if (cleanMethods.length === 0) {
          return jsonResponse({ error: 'At least one method/source (e.g. list checked, register consulted) is required' }, 400);
        }
        const { data: caseRow } = await admin.schema('aml').from('cases')
          .select('id, tenant_id, subject_display_name').eq('id', caseId).maybeSingle();
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);

        // Subject identity is DERIVED, never asserted: the determination is
        // evidence about a specific person, and a caller-supplied name could
        // attach an assessment of X to the record of Y. The party subject row
        // (or the case subject) is the identity; a mismatched caller name is
        // an error, not an override.
        let derivedName = String(caseRow.subject_display_name ?? '').trim();
        let derivedPartyType: string | null = null;
        let derivedPartyId: string | null = null;
        if (partySubjectId) {
          const { data: partySubject } = await admin.schema('aml').from('party_screening_subjects')
            .select('id, case_id, screened_name, party_type, party_id').eq('id', partySubjectId).maybeSingle();
          if (!partySubject || String(partySubject.case_id) !== caseId) {
            return jsonResponse({ error: 'party_screening_subject_id does not belong to this case' }, 400);
          }
          derivedName = String(partySubject.screened_name ?? '').trim();
          derivedPartyType = partySubject.party_type ?? null;
          derivedPartyId = partySubject.party_id ?? null;
        }
        if (!derivedName) {
          return jsonResponse({ error: 'The subject has no recorded name to determine against' }, 409);
        }
        if (subjectName && subjectName.toLowerCase() !== derivedName.toLowerCase()) {
          return jsonResponse({
            error: `subject_name does not match the recorded subject ("${derivedName}") — the determination is recorded against the canonical identity`,
            code: 'subject_identity_mismatch',
          }, 400);
        }

        const now = new Date().toISOString();
        // Freshness: reconsidered during ongoing CDD. Default review cycle 12
        // months; callers may set an earlier date but never disable review.
        const reviewMonths = Math.min(Math.max(Number(body.review_months ?? 12) || 12, 1), 36);
        const reviewDue = new Date();
        reviewDue.setUTCMonth(reviewDue.getUTCMonth() + reviewMonths);

        // Hash-chain within the case, like match_resolutions.
        const { data: prevDet } = await admin.schema('aml').from('pep_determinations')
          .select('id, row_hash').eq('case_id', caseId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const detHashInput = JSON.stringify({
          case_id: caseId, party_screening_subject_id: partySubjectId, subject_name: derivedName,
          result, pep_type: pepType, pep_relationship: pepRelationship,
          methods: cleanMethods, rationale, determined_by: userId,
          prev_hash: prevDet?.row_hash ?? null, created_at: now,
        });
        const detHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(detHashInput));
        const detRowHash = Array.from(new Uint8Array(detHashBuf)).map((x) => x.toString(16).padStart(2, '0')).join('');

        // Supersession of the prior current determination is NOT done here:
        // the BEFORE INSERT trigger closes it in the same transaction as this
        // insert, and the partial unique index guarantees a single current
        // determination per subject scope even under concurrent writes.
        const { data: determination, error: detErr } = await admin.schema('aml').from('pep_determinations').insert({
          tenant_id: caseRow.tenant_id ?? 'default',
          case_id: caseId,
          party_screening_subject_id: partySubjectId,
          party_type: derivedPartyType,
          party_id: derivedPartyId,
          subject_name: derivedName.slice(0, 300),
          result,
          pep_type: result === 'pep' ? pepType : null,
          pep_relationship: result === 'pep' ? pepRelationship : null,
          position_held: typeof body.position_held === 'string' ? body.position_held.slice(0, 300) : null,
          jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction.slice(0, 100) : null,
          holds_position_currently: typeof body.holds_position_currently === 'boolean'
            ? body.holds_position_currently : null,
          methods: cleanMethods,
          rationale,
          determined_by: userId,
          determined_by_label: userEmail,
          determined_at: now,
          review_due_at: reviewDue.toISOString(),
          prev_hash: prevDet?.row_hash ?? null,
          row_hash: detRowHash,
        }).select('*').single();
        if (detErr) {
          if (String((detErr as any).code) === '23505') {
            return jsonResponse({
              error: 'Another determination for this subject was recorded at the same moment — reload and review it before recording again',
              code: 'concurrent_determination',
            }, 409);
          }
          throw detErr;
        }

        await appendEvent(admin, caseId, result === 'pep' ? 'pep_sanctions_hit' : 'mlro_decision',
          result === 'pep'
            ? `PEP determination recorded for ${derivedName}: ${pepType} PEP (${pepRelationship})`
            : `PEP determination recorded for ${derivedName}: not a PEP`,
          {
            pep_determination_id: determination.id,
            party_screening_subject_id: partySubjectId,
            result, pep_type: result === 'pep' ? pepType : null,
            pep_relationship: result === 'pep' ? pepRelationship : null,
            methods: cleanMethods, review_due_at: determination.review_due_at,
          }, userId, userEmail);

        return jsonResponse({ determination });
      }

      default:
        return jsonResponse({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (err: any) {
    console.error('aml-cases error', err);
    return jsonResponse({ ...internalError(err, 'aml-cases') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
