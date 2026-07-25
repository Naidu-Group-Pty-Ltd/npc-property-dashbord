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
 *   - record_consent               { case_id, kind, version, payload? }
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-portal-session-token, x-session-token',
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

const SECTIONS = ['purchasing_structure', 'personal_details', 'purchase_profile', 'funding'] as const;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sanitiseFilename(name: string): string {
  return String(name || 'upload').replace(/[^\w.\-]+/g, '_').slice(0, 180);
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

    const { data: session } = await admin
      .from('client_portal_sessions')
      .select('user_id, expires_at, client_portal_users:user_id(id, client_id, email, full_name, status)')
      .eq('session_token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    const portalUser = (session as any)?.client_portal_users;
    if (!portalUser || portalUser.status !== 'active') {
      return jsonResponse({ error: 'Invalid or expired session' }, 401);
    }
    const clientId: string = portalUser.client_id;
    const portalUserId: string = portalUser.id;
    const actorLabel: string = portalUser.full_name || portalUser.email || 'client-portal';

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
        if (!c) return jsonResponse({ case: null, message: 'No AML onboarding case yet.' });
        const [{ data: sections }, { data: requirements }, { data: openRequests }, { data: submissions }] = await Promise.all([
          admin.schema('aml').from('questionnaire_responses')
            .select('section,status,updated_at').eq('case_id', c.id),
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
        const portalStatus = portalStatusFor(c);
        const presentation = PORTAL_STATUS_PRESENTATION[portalStatus] ?? { label: 'In progress', tone: 'progress' as const };
        return jsonResponse({
          case: {
            id: c.id, reference: c.case_reference, subject: c.subject_display_name,
            opened_at: c.opened_at,
            // Portal-safe dimension token — internal case state is not shipped.
            status: portalStatus, portal_status: portalStatus,
            status_label: presentation.label, status_tone: presentation.tone,
          },
          sections: SECTIONS.map((s) => ({
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
          })),
          recent_submissions: submissions ?? [],
        });
      }

      case 'get_questionnaire': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        if (!SECTIONS.includes(body.section)) return jsonResponse({ error: 'Invalid section' }, 400);
        const { data } = await admin.schema('aml').from('questionnaire_responses')
          .select('*').eq('case_id', c.id).eq('section', body.section).maybeSingle();
        return jsonResponse({ response: data ?? null });
      }

      case 'save_questionnaire': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        if (!SECTIONS.includes(body.section)) return jsonResponse({ error: 'Invalid section' }, 400);
        const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
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

      case 'record_consent': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        if (!body.kind || !body.version) return jsonResponse({ error: 'kind + version required' }, 400);
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
        const ua = req.headers.get('user-agent') ?? null;
        const { data, error } = await admin.schema('aml').from('consents').insert({
          case_id: c.id, kind: String(body.kind).slice(0, 80), version: String(body.version).slice(0, 40),
          actor_type: 'client', actor_id: portalUserId, actor_label: actorLabel,
          ip_address: ip, user_agent: ua, payload: body.payload ?? {},
        }).select('*').single();
        if (error) throw error;
        return jsonResponse({ consent: data });
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
        const { data, error } = await admin.schema('aml').from('client_requests').update({
          status: 'responded', responded_at: new Date().toISOString(),
          responded_by: portalUserId, response_payload: body.response_payload ?? {},
        }).eq('id', body.request_id).select('*').single();
        if (error) throw error;
        return jsonResponse({ request: data });
      }

      case 'submit_for_review': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const [{ data: sections }, { data: reqs }, { data: docs }, { data: consents }] = await Promise.all([
          admin.schema('aml').from('questionnaire_responses').select('*').eq('case_id', c.id),
          admin.schema('aml').from('document_requirements').select('*').eq('case_id', c.id),
          admin.schema('aml').from('documents').select('*').eq('case_id', c.id).neq('status', 'deleted'),
          admin.schema('aml').from('consents').select('kind, version, accepted_at').eq('case_id', c.id),
        ]);
        const missingRequired = (reqs ?? []).filter((r: any) => r.required && !['uploaded','accepted'].includes(r.status));
        if (missingRequired.length > 0) {
          return jsonResponse({
            error: 'Cannot submit — required documents missing',
            missing: missingRequired.map((r: any) => ({ code: r.code, label: r.label })),
          }, 400);
        }
        const { data: lastSub } = await admin.schema('aml').from('submission_versions')
          .select('version_number').eq('case_id', c.id).order('version_number', { ascending: false }).limit(1);
        const nextVersion = ((lastSub ?? [])[0]?.version_number ?? 0) + 1;
        const snapshot = {
          case: { id: c.id, reference: c.case_reference, subject: c.subject_display_name },
          sections: sections ?? [], requirements: reqs ?? [], documents: docs ?? [], consents: consents ?? [],
          submitted_by: { id: portalUserId, label: actorLabel },
        };
        const { data: sub, error } = await admin.schema('aml').from('submission_versions').insert({
          case_id: c.id, version_number: nextVersion, snapshot,
          submitted_by_type: 'client', submitted_by: portalUserId,
        }).select('*').single();
        if (error) throw error;
        // Push case status forward (draft → kyc_in_progress → kyc_complete for review).
        if (['draft','kyc_in_progress'].includes(c.status)) {
          await admin.schema('aml').from('cases').update({ status: 'kyc_complete' }).eq('id', c.id);
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
