/**
 * Client Portal → AML/CTF onboarding API.
 *
 * The session rides the `x-portal-session-token` header, carrying the in-memory
 * token that `client-portal-verify` repopulates from the HttpOnly cookie on each
 * load. This used to read the token straight out of `localStorage`, where it
 * survived restarts and was readable by any script. See src/lib/portalSession.ts.
 */
import { portalSessionBodyFields, portalSessionHeaders } from '@/lib/portalSession';
import type { IdentityDocumentChoice } from '@/lib/aml/identityDocuments';

const SUPABASE_URL = 'https://dduzbchuswwbefdunfct.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';

async function call<T = any>(op: string, payload: Record<string, any> = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/aml-client-portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...portalSessionHeaders(),
    },
    // NOT `credentials: 'include'`: `aml-client-portal` answers with a wildcard
    // `Access-Control-Allow-Origin`, which is invalid for a credentialed request
    // — the browser would block the response. The session rides the
    // `x-portal-session-token` header instead.
    body: JSON.stringify({ op, ...payload, ...portalSessionBodyFields() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server's `code` is the machine-readable half of the refusal
    // (`manual_verification_required`, `attempts_exhausted`, …). Dropping it
    // left callers matching on prose, so a provider-readiness refusal was
    // indistinguishable from a capture failure and the client was told to try
    // again against a provider that could never serve them.
    const err = new Error(json?.error || `HTTP ${res.status}`) as Error & {
      code?: string; status?: number;
    };
    err.code = typeof json?.code === 'string' ? json.code : undefined;
    err.status = res.status;
    throw err;
  }
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
  /** Server-owned consent gate — the stepper mirrors this, never a local flag. */
  consent?: AmlConsentState;
}

/** Acceptance state for the current AUSTRAC-referenced consent catalogue. */
export interface AmlConsentState {
  version: string | null;
  satisfied: boolean;
  outstanding: string[];
  required_count?: number;
}

/** Portal-safe verification view — deliberately carries no score or threshold. */
export interface AmlVerificationParty {
  party_id: string | null;
  label: string;
  status: 'not_started' | 'in_review' | 'verified' | 'action_required' | 'contact_adviser';
  attempts_used: number;
  attempts_remaining: number;
  can_attempt: boolean;
  /**
   * The last capture could not be examined — no face found, or too blurred.
   * It consumed no attempt, and the client needs to be asked for a new photo
   * rather than left waiting on a review that is not happening.
   */
  retake_required?: boolean;
  /**
   * A secure identity check is already open for this party, server-side.
   *
   * Survives a page refresh, which nothing in the browser does: the window
   * handle and the session URL are gone the moment the page reloads, so
   * without this the client is offered "Start" while their verification
   * window is still open behind the browser.
   *
   * A boolean and nothing else — no session, no URL, no provider — so it can
   * change which sentence is shown and nothing more. It is NOT a status:
   * an open check is neither a pass nor a failure.
   */
  verification_in_progress?: boolean;
}

export interface AmlVerificationStatus {
  enabled: boolean;
  max_attempts: number;
  biometric_consent_accepted: boolean;
  /**
   * Whether electronic capture may proceed at all. The server has always sent
   * this and the step ignored it, so a client whose case had no live provider
   * was offered "Start", allowed to photograph their face, and refused at the
   * upload URL. Client-safe by construction — never a provider name.
   */
  availability?: 'available' | 'temporarily_unavailable' | 'manual_verification_required';
  /**
   * Which verification experience to render, decided server-side.
   *
   * `capture` — NPC's own camera flow, uploading to NPC storage.
   * `hosted`  — the provider runs the capture on its own UI, embedded here.
   *
   * Deliberately two words and no more. The portal never learns which provider
   * is configured, and cannot ask for one: sending a provider name from the
   * browser would be a client selecting its own authority. Absent on an older
   * server, which is why it defaults to `capture` at every read site.
   */
  provider_flow?: 'capture' | 'hosted';
  parties: AmlVerificationParty[];
}

export interface AmlConsentDocument {
  code: string;
  title: string;
  summary: string;
  body: string;
  /** `consent` must be agreed to; `notice` must be acknowledged as read. */
  acknowledgement_type: 'consent' | 'notice';
  statutory_basis: string[];
  reference_links: { label: string; url: string }[];
  required: boolean;
  accepted_at: string | null;
}

export const amlPortalApi = {
  overview: (case_id?: string) => call<AmlPortalOverview>('overview', { case_id }),
  getQuestionnaire: (case_id: string, section: AmlSection) =>
    call<{ response: any }>('get_questionnaire', { case_id, section }),
  saveQuestionnaire: (case_id: string, section: AmlSection, payload: Record<string, any>, submit = false) =>
    call<{ response: any }>('save_questionnaire', { case_id, section, payload, submit }),
  /** Identity-verification state per party (portal-safe: no scores). */
  verificationStatus: (case_id: string) =>
    call<AmlVerificationStatus>('verification_status', { case_id }),
  /** Signed upload URL. Selfies are routed to the biometrics bucket. */
  requestVerificationUpload: (case_id: string, kind: 'document' | 'selfie') =>
    call<{ upload_url: string; token: string; path: string; bucket: string }>(
      'request_verification_upload_url', { case_id, kind }),
  /**
   * Open (or resume) a provider-hosted verification session.
   *
   * Returns a URL and nothing else. There is no session token to hold, no
   * provider name, and no configuration — and completing the flow in that
   * window does NOT mark anybody verified. The identity outcome arrives on a
   * signed server-to-server webhook; this call only opens the door.
   *
   * `document_type` is the one thing the browser declares, and it declares an
   * INTENT: it narrows the document picker the client is shown and nothing
   * else. The server matches it against a closed list and refuses anything
   * else — it cannot name a provider, a workflow, an environment or a country,
   * and no value of it can reach an identity outcome.
   */
  startHostedVerification: (case_id: string, params: {
    party_id?: string | null; party_label?: string;
    document_type?: IdentityDocumentChoice;
  }) => call<{
    started: boolean; resumed?: boolean;
    verification_url?: string; message: string; code?: string;
  }>('start_hosted_verification', { case_id, ...params }),
  submitVerification: (case_id: string, params: {
    party_id?: string | null; party_label?: string;
    document_storage_path: string; selfie_storage_path: string;
  }) => call<{
    submitted: boolean; attempt_number: number; attempts_remaining: number;
    status: string; message: string;
  }>('submit_verification', { case_id, ...params }),

  /** Current consent catalogue + what this case has already accepted. */
  getConsents: (case_id: string) =>
    call<AmlConsentState & { documents: AmlConsentDocument[] }>('get_consents', { case_id }),
  /** `version` is optional — the server pins the acceptance to the live revision. */
  recordConsent: (case_id: string, kind: string, version?: string, payload: Record<string, any> = {}) =>
    call<{ consent: any; consent_state: AmlConsentState }>(
      'record_consent', { case_id, kind, version, payload, accepted: true }),
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
