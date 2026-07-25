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

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token, x-command-centre-session-token',
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

Deno.serve(async (req) => {
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
        if (!canCreate) return jsonResponse({ error: 'Analyst or MLRO role required' }, 403);
        const subject = String(body.subject_display_name ?? '').trim();
        if (!subject) return jsonResponse({ error: 'subject_display_name is required' }, 400);
        const subjectType = ['individual', 'entity', 'trust'].includes(body.subject_type)
          ? body.subject_type : 'individual';
        const risk = RISK_RATINGS.includes(body.risk_rating) ? body.risk_rating : null;

        const ref = await generateCaseReference(admin);
        const { data: created, error } = await admin
          .schema('aml').from('cases').insert({
            case_reference: ref,
            subject_display_name: subject,
            subject_type: subjectType,
            client_id: body.client_id ?? null,
            purchase_file_id: body.purchase_file_id ?? null,
            risk_rating: risk,
            assigned_analyst_id: userId,
            created_by: userId,
            metadata: body.metadata ?? {},
          }).select('*').single();
        if (error) throw error;

        await appendEvent(admin, created.id, 'case_created',
          `Case ${ref} opened for ${subject}`,
          { subject_type: subjectType, initial_risk: risk, notes: body.notes ?? null },
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

        // Verify the client exists and is active before creating an AML case.
        const { data: client, error: clientErr } = await admin
          .from('clients')
          .select('id, is_active')
          .eq('id', clientId)
          .maybeSingle();
        if (clientErr) throw clientErr;
        if (!client) return jsonResponse({ error: 'Client not found' }, 404);
        if (client.is_active !== true) {
          return jsonResponse({ error: 'Client is not active; cannot activate for AML' }, 409);
        }

        // Duplicate-open guard: one open case per client at a time.
        const { data: existing } = await admin
          .schema('aml').from('cases')
          .select('id, case_reference, status')
          .eq('client_id', clientId)
          .not('status', 'in', '("cleared","closed","blocked")')
          .limit(1)
          .maybeSingle();
        if (existing) {
          return jsonResponse({
            error: 'An open AML case already exists for this client',
            case: existing,
          }, 409);
        }

        // Model B guardrail: legal approval + program version.
        let programVersion: string | null = null;
        if (model === 'B') {
          const { data: settings } = await admin
            .schema('aml').from('tenant_settings')
            .select('metadata')
            .maybeSingle();
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
          activated_by: userId,
          activated_by_email: userEmail,
          activated_at: new Date().toISOString(),
        };

        const ref = await generateCaseReference(admin);
        const { data: created, error: createErr } = await admin
          .schema('aml').from('cases').insert({
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
          }).select('*').single();
        if (createErr) throw createErr;

        await appendEvent(admin, created.id, 'case_created',
          `Case ${ref} activated (Model ${model}) for ${displayName}`,
          { activation, client_id: clientId },
          userId, userEmail);

        return jsonResponse({ case: created, activation });
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

        const { data: updated, error: upErr } = await admin.schema('aml').from('cases')
          .update(patch).eq('id', body.case_id).select('*').single();
        if (upErr) throw upErr;

        await appendEvent(admin, body.case_id, 'status_changed',
          `Status ${from} → ${to}${!legal.includes(to) ? ' (MLRO override)' : ''}`,
          { from, to, reason: body.reason ?? null, override: !legal.includes(to) },
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
        const { data, error } = await admin.schema('aml').from('documents')
          .select('*').eq('case_id', body.case_id).neq('status', 'deleted')
          .order('uploaded_at', { ascending: false });
        if (error) throw error;
        return jsonResponse({ documents: data ?? [] });
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
        const { data, error } = await admin.schema('aml').from('client_requests').insert({
          case_id: r.case_id, kind: r.kind, subject: String(r.subject).slice(0, 200),
          message: String(r.message), request_payload: r.request_payload ?? {},
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

      default:
        return jsonResponse({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (err: any) {
    console.error('aml-cases error', err);
    return jsonResponse({ error: err?.message ?? String(err) }, 500);
  }
});
