/**
 * Client Portal → AML/CTF onboarding API.
 * Uses the portal session token (localStorage 'portal_session_token').
 */
const SUPABASE_URL = 'https://dduzbchuswwbefdunfct.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';
const PORTAL_SESSION_KEY = 'portal_session_token';

function token(): string | null {
  try { return localStorage.getItem(PORTAL_SESSION_KEY); } catch { return null; }
}

async function call<T = any>(op: string, payload: Record<string, any> = {}): Promise<T> {
  const t = token();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/aml-client-portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...(t ? { 'x-portal-session-token': t } : {}),
    },
    body: JSON.stringify({ op, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as T;
}

export type AmlSection =
  | 'purchasing_structure' | 'personal_details' | 'purchase_profile' | 'funding'
  // Phase 5 — conditional sections; the server decides which apply per case.
  | 'entity_details' | 'related_parties';

export interface AmlPortalOverview {
  case: {
    id: string; reference: string; subject: string;
    opened_at: string;
    /** Portal-safe status token (Phase 1 contract) — never the internal case state. */
    status: string; portal_status?: string;
    status_label: string;
    status_tone: 'neutral'|'progress'|'positive'|'caution';
  } | null;
  message?: string;
  /** Phase 5 — versioned conditional engine metadata (server-driven). */
  questionnaire_version?: string;
  structure_type?: string | null;
  sections?: { section: AmlSection; status: string; updated_at: string | null }[];
  requirements?: any[];
  requirement_progress?: { completed: number; total: number };
  open_requests?: any[];
  recent_submissions?: any[];
}

export const amlPortalApi = {
  overview: (case_id?: string) => call<AmlPortalOverview>('overview', { case_id }),
  getQuestionnaire: (case_id: string, section: AmlSection) =>
    call<{ response: any }>('get_questionnaire', { case_id, section }),
  saveQuestionnaire: (case_id: string, section: AmlSection, payload: Record<string, any>, submit = false) =>
    call<{ response: any }>('save_questionnaire', { case_id, section, payload, submit }),
  recordConsent: (case_id: string, kind: string, version: string, payload: Record<string, any> = {}) =>
    call<{ consent: any }>('record_consent', { case_id, kind, version, payload }),
  listRequirements: (case_id: string) => call<{ requirements: any[] }>('list_requirements', { case_id }),
  requestUploadUrl: (case_id: string, params: {
    filename: string; mime_type: string; size_bytes: number; requirement_id?: string | null;
  }) => call<{ upload_url: string; token: string; path: string }>('request_upload_url', { case_id, ...params }),
  confirmUpload: (case_id: string, params: {
    storage_path: string; filename: string; mime_type: string; size_bytes: number;
    requirement_id?: string | null; checksum?: string;
  }) => call<{ document: any }>('confirm_upload', { case_id, ...params }),
  listDocuments: (case_id: string) => call<{ documents: any[] }>('list_documents', { case_id }),
  listRequests: (case_id: string) => call<{ requests: any[] }>('list_client_requests', { case_id }),
  respondRequest: (request_id: string, response_payload: Record<string, any>) =>
    call<{ request: any }>('respond_client_request', { request_id, response_payload }),
  submitForReview: (case_id: string) => call<{ submission: any }>('submit_for_review', { case_id }),
};

/** Upload a File via signed URL then confirm on the server. */
export async function uploadAmlDocument(caseId: string, file: File, requirementId: string | null = null) {
  const meta = await amlPortalApi.requestUploadUrl(caseId, {
    filename: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size,
    requirement_id: requirementId,
  });
  const put = await fetch(meta.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
  return amlPortalApi.confirmUpload(caseId, {
    storage_path: meta.path, filename: file.name,
    mime_type: file.type || 'application/octet-stream', size_bytes: file.size,
    requirement_id: requirementId,
  });
}
