import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlCaseStatus =
  | "draft" | "kyc_in_progress" | "kyc_complete" | "edd_required"
  | "under_review" | "escalated_mlro" | "cleared" | "blocked" | "closed";

export type AmlRiskRating = "low" | "medium" | "high" | "prohibited";

export type AmlEventCategory =
  | "case_created" | "status_changed" | "risk_rescored" | "document_added"
  | "idv_result" | "pep_sanctions_hit" | "edd_note" | "mlro_decision"
  | "austrac_report" | "system";

export interface AmlCase {
  id: string;
  case_reference: string;
  client_id: string | null;
  purchase_file_id: string | null;
  subject_type: string;
  subject_display_name: string;
  status: AmlCaseStatus;
  risk_rating: AmlRiskRating | null;
  risk_score: number | null;
  assigned_analyst_id: string | null;
  assigned_mlro_id: string | null;
  opened_at: string;
  closed_at: string | null;
  metadata: Record<string, any>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Phase 1 canonical workflow dimensions (nullable until the
  // workflow-dimension migration has been applied and rows backfilled).
  // Derive effective values via src/lib/aml/caseDimensions.ts helpers.
  case_stage?: string | null;
  client_portal_status?: string | null;
  finance_portal_status?: string | null;
  service_gate_status?: string | null;
  service_gate_effective_at?: string | null;
  service_gate_policy_version?: string | null;
  activation_timing?: string | null;
  agreement_state?: string | null;
  activation_policy_version?: string | null;
  legacy_activation_model?: "A" | "B" | null;
  migration_classification?: string | null;
}

export interface AmlCaseEvent {
  id: string;
  case_id: string;
  category: AmlEventCategory;
  summary: string;
  payload: Record<string, any>;
  actor_id: string | null;
  actor_label: string | null;
  prev_hash: string | null;
  row_hash: string | null;
  created_at: string;
}

/**
 * Activation picker projection — identification only, never financial data.
 * Inactive clients are returned and selectable: the activation form is where
 * an authorised user confirms an existing client is active.
 */
export interface AmlActivationClient {
  id: string;
  label: string;
  email: string | null;
  mobile: string | null;
  is_active: boolean;
  has_open_case: boolean;
  /** Present on `get_client_for_activation` when an open case exists. */
  open_case?: { id: string; case_reference: string } | null;
}

async function invoke<T = any>(payload: Record<string, any>): Promise<T> {
  return invokeAmlFunction<T>("aml-cases", payload);
}

export const amlCasesApi = {
  list: (params: {
    status?: AmlCaseStatus; risk?: AmlRiskRating; assigned_to_me?: boolean;
    search?: string; limit?: number; offset?: number;
  } = {}) => invoke<{ cases: AmlCase[]; total: number }>({ op: "list", ...params }),

  get: (case_id: string) =>
    invoke<{ case: AmlCase; events: AmlCaseEvent[] }>({ op: "get", case_id }),

  /**
   * Authorised-exception case creation (directive §10.4). Not an ordinary
   * production pathway: MLRO only, and the server requires a recorded
   * exception category, authority and reason. Normal cases are opened via
   * activateClient from the client record.
   */
  create: (params: {
    subject_display_name: string; subject_type?: "individual" | "entity" | "trust";
    client_id?: string; purchase_file_id?: string; risk_rating?: AmlRiskRating; notes?: string;
    exception: {
      category: "data_migration" | "legacy_remediation" | "regulator_directed" | "approved_testing";
      reason: string;
      authority: string;
    };
  }) => invoke<{ case: AmlCase }>({ op: "create", ...params }),

  /**
   * Phase 3 — Hybrid Activation Engine.
   *
   * Opens a case for a **real active client** after a human-confirmed
   * activation event. Model B additionally requires tenant-level legal
   * approval + a program version (enforced server-side).
   */
  activateClient: (params: {
    client_id: string;
    subject_display_name: string;
    subject_type?: "individual" | "entity" | "trust";
    activation_model: "A" | "B";
    activation_event: string;
    reason: string;
    human_confirmed: true;
    purchase_file_id?: string;
  }) => invoke<{
    case: AmlCase;
    activation: Record<string, any>;
    /** Whether this activation flipped an inactive client to active (Part 5). */
    client_activation?: { was_inactive: boolean; marked_active: boolean };
    /** Whether the client can actually reach the screening link we just posted. */
    client_portal?: { has_portal_access: boolean; notified: boolean; note: string };
  }>({ op: "activate_client", ...params }),

  update: (case_id: string, patch: Partial<AmlCase>) =>
    invoke<{ case: AmlCase }>({ op: "update", case_id, patch }),

  transition: (case_id: string, to_status: AmlCaseStatus, reason?: string) =>
    invoke<{ case: AmlCase }>({ op: "transition", case_id, to_status, reason }),

  appendEvent: (case_id: string, category: AmlEventCategory, summary: string, payload: Record<string, any> = {}) =>
    invoke<{ event: AmlCaseEvent }>({ op: "append_event", case_id, category, summary, payload }),

  listEvents: (case_id: string, limit = 200) =>
    invoke<{ events: AmlCaseEvent[] }>({ op: "list_events", case_id, limit }),

  /** Phase 4 — persistent AML summary for the master client record. */
  /** Command-centre view of the client's AUSTRAC consent acceptances. */
  consentStatus: (case_id: string) =>
    invoke<{
      version: string | null;
      satisfied: boolean;
      outstanding: Array<{ code: string; title: string }>;
      documents: Array<{
        code: string; title: string; required: boolean;
        acknowledgement_type: "consent" | "notice";
        accepted_at: string | null; accepted_by: string | null;
        actor_type: string | null; document_hash: string | null;
      }>;
      history: Array<{ kind: string; version: string; accepted_at: string }>;
    }>({ op: "consent_status", case_id }),

  /**
   * Activation client picker — AML-role-gated (§13.4). Tokenised full-name
   * search over the canonical `clients` table; returns active AND inactive
   * clients (inactive ones are activated through the confirmation form).
   */
  searchClients: (query: string) =>
    invoke<{ clients: AmlActivationClient[] }>({ op: "search_clients", query }),

  /**
   * Route-based activation handoff: load and validate the exact client by ID.
   * The browser is never trusted for the client's name or active status —
   * both come from the authoritative record via this call.
   */
  getClientForActivation: (client_id: string) =>
    invoke<{ client: AmlActivationClient }>({ op: "get_client_for_activation", client_id }),


  clientSummary: (client_id: string) =>
    invoke<{
      case: AmlCase | null;
      has_open_case: boolean;
      requirement_progress?: { completed: number; total: number };
      open_client_requests?: number;
    }>({ op: "client_summary", client_id }),

  // Staff-side wrappers for existing case-scoped server ops (requirements,
  // documents, submissions, client requests) used by the full-page workspace.
  listRequirements: (case_id: string) =>
    invoke<{ requirements: any[] }>({ op: "list_requirements", case_id }),
  seedDefaultRequirements: (case_id: string) =>
    invoke<{ requirements: any[] }>({ op: "seed_default_requirements", case_id }),
  listDocuments: (case_id: string) =>
    invoke<{ documents: any[] }>({ op: "list_documents", case_id }),
  getDocumentDownloadUrl: (document_id: string) =>
    invoke<{ url: string; filename: string }>({ op: "get_document_download_url", document_id }),
  reviewDocument: (document_id: string, decision: "accepted" | "rejected", reason?: string) =>
    invoke<{ document: any }>({ op: "review_document", document_id, decision, reason }),
  listSubmissions: (case_id: string) =>
    invoke<{ submissions: any[] }>({ op: "list_submissions", case_id }),
  reviewSubmission: (submission_id: string, decision: "accepted" | "rejected" | "changes_requested", notes?: string) =>
    invoke<{ submission: any }>({ op: "review_submission", submission_id, decision, notes }),
  listClientRequests: (case_id: string) =>
    invoke<{ requests: any[] }>({ op: "list_client_requests", case_id }),
  createClientRequest: (request: {
    case_id: string;
    kind: "additional_info" | "new_document" | "clarification" | "re_consent";
    subject: string;
    message: string;
    request_payload?: Record<string, any>;
  }) => invoke<{ request: any }>({ op: "create_client_request", request }),
  resolveClientRequest: (request_id: string) =>
    invoke<{ request: any }>({ op: "resolve_client_request", request_id }),
};
