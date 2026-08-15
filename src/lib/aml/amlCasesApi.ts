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
  /**
   * Present when an open case exists. `get_client_for_activation` carries the
   * id too; the picker's list carries the reference alone, which is all it
   * needs to say WHICH case already covers this client rather than only that
   * one does.
   */
  open_case?: { id?: string; case_reference: string } | null;
}

/** Which slice of the client register the picker is asking for. */
export type AmlClientPickerStatus = "all" | "active" | "inactive";

export interface AmlClientPickerPage {
  clients: AmlActivationClient[];
  /** How many clients matched in total — not how many were returned. */
  total: number;
  has_more: boolean;
  /** True when the server answered a browse rather than a search. */
  browsing: boolean;
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
   *
   * With an empty query this BROWSES the register rather than returning
   * nothing, which is what makes every client the platform already holds
   * available without anybody having to type a name they must already know.
   * Same op, same projection, same permission gate — only the filter differs,
   * so there is no second source of truth about which clients an AML operator
   * may see.
   */
  listClientsForActivation: (opts: {
    query?: string;
    status?: AmlClientPickerStatus;
    limit?: number;
    offset?: number;
  } = {}) =>
    invoke<AmlClientPickerPage>({
      op: "search_clients",
      query: opts.query ?? "",
      status: opts.status ?? "all",
      limit: opts.limit,
      offset: opts.offset,
    }),


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
    /** Canonical action vocabulary (`CLIENT_ACTION_CODES`). The portal only
     *  renders an action button for a code it recognises. */
    action_code?: string;
    /** Whitelisted routing only — `target_step` / `requirement_id` /
     *  `section_code`. Every field is re-validated server-side against the
     *  shared contract's closed vocabularies, so this type is a convenience
     *  and never the guarantee. The portal never accepts a URL. */
    action_target?: { target_step?: string; requirement_id?: string; section_code?: string };
  }) => invoke<{ request: any }>({ op: "create_client_request", request }),
  resolveClientRequest: (request_id: string) =>
    invoke<{ request: any }>({ op: "resolve_client_request", request_id }),

  /* ── Submission review (integration Stage 3/4) ── */
  getSubmissionReview: (case_id: string, version_number?: number) =>
    invoke<AmlSubmissionReview>({ op: "get_submission_review", case_id, version_number }),
  acceptSubmission: (submission_id: string, reason?: string) =>
    invoke<{ submission: any }>({ op: "accept_submission", submission_id, reason }),
  requestSubmissionChanges: (submission_id: string, reason: string, client_message?: string, subject?: string) =>
    invoke<{ submission: any; client_request: any }>({ op: "request_submission_changes", submission_id, reason, client_message, subject }),
  requestSubmissionDocument: (submission_id: string, reason: string, requirement_id?: string, client_message?: string) =>
    invoke<{ submission: any; client_request: any }>({ op: "request_submission_document", submission_id, reason, requirement_id, client_message }),
  requestSubmissionClarification: (submission_id: string, reason: string, client_message?: string) =>
    invoke<{ submission: any; client_request: any }>({ op: "request_submission_clarification", submission_id, reason, client_message }),
  escalateSubmission: (submission_id: string, reason: string) =>
    invoke<{ submission: any }>({ op: "escalate_submission", submission_id, reason }),
  supersedeSubmission: (submission_id: string, reason: string) =>
    invoke<{ submission: any }>({ op: "supersede_submission", submission_id, reason }),

  /* ── Document review with separated reasons (Stage 9/10) ── */
  reviewDocumentV2: (args: {
    document_id: string; decision: "accepted" | "rejected";
    internal_review_note?: string; client_safe_reason_code?: string; client_safe_message?: string;
  }) => invoke<{ document: any; client_request: any }>({ op: "review_document_v2", ...args }),

  /* ── Party reconciliation (Stage 13/14) ── */
  listPartyReconciliation: (case_id: string) =>
    invoke<{ items: AmlReconciliationItem[] }>({ op: "list_party_reconciliation", case_id }),
  resolvePartyReconciliation: (args: {
    item_id: string; resolution: "linked" | "created" | "manual_only" | "rejected" | "superseded" | "conflict";
    rationale: string; party_type?: string; party_id?: string;
  }) => invoke<{ item: AmlReconciliationItem }>({ op: "resolve_party_reconciliation", ...args }),

  /* ── Party verification links (Stage 15) ── */
  listPartyVerificationLinks: (case_id: string) =>
    invoke<{ links: AmlPartyVerificationLink[]; eligible_checks: any[] }>({ op: "list_party_verification_links", case_id }),
  linkPartyVerification: (args: { case_id: string; party_type: string; party_id?: string; verification_check_id: string; relationship?: string }) =>
    invoke<{ link: AmlPartyVerificationLink }>({ op: "link_party_verification", ...args }),
  unlinkPartyVerification: (link_id: string, reason: string) =>
    invoke<{ link: AmlPartyVerificationLink }>({ op: "unlink_party_verification", link_id, reason }),

  /* ── Party-scoped screening (Stage 16) ── */
  listPartyScreening: (case_id: string) =>
    invoke<{ subjects: AmlPartyScreeningSubject[]; case_pep_determination: AmlPepDetermination | null }>({ op: "list_party_screening", case_id }),
  queuePartyScreening: (subject_id: string, freshness_days?: number) =>
    invoke<{ subject: AmlPartyScreeningSubject; skipped?: boolean; code?: string }>({ op: "queue_party_screening", subject_id, freshness_days }),
  // Adjudication resolves the CANONICAL screening match (same semantics as
  // aml-verification resolve_match); the party state is a projection of it.
  adjudicatePartyScreening: (subject_id: string, match_id: string, outcome: "confirmed_match" | "false_positive", note: string) =>
    invoke<{ subject: AmlPartyScreeningSubject; match: AmlScreeningCandidateMatch }>({ op: "adjudicate_party_screening", subject_id, match_id, outcome, note }),
  listPepDeterminations: (case_id: string) =>
    invoke<{ determinations: AmlPepDetermination[] }>({ op: "list_pep_determinations", case_id }),
  recordPepDetermination: (payload: {
    case_id: string; subject_name: string; result: "not_pep" | "pep";
    party_screening_subject_id?: string | null; party_type?: string; party_id?: string;
    pep_type?: "foreign" | "domestic" | "international_organisation";
    pep_relationship?: "self" | "family_member" | "close_associate";
    position_held?: string; jurisdiction?: string; holds_position_currently?: boolean;
    methods: Array<{ source: string; reference?: string; note?: string }>;
    rationale: string; review_months?: number;
  }) =>
    invoke<{ determination: AmlPepDetermination }>({ op: "record_pep_determination", ...payload }),
};

export interface AmlReconciliationItem {
  id: string; declared_role: string; declared_name: string;
  change_kind: string; resolution_status: string;
  resolved_party_type: string | null; resolved_party_id: string | null;
  verification_required: boolean; screening_required: boolean;
  conflicts: any[]; similarity_candidates: Array<{ party_type: string; party_id: string; full_name: string; score: number; requires_confirmation: boolean }>;
  exact_candidate_id: string | null; exact_candidate_type: string | null;
  declared_payload?: Record<string, unknown>;
  resolution_rationale?: string | null;
}

export interface AmlPartyVerificationLink {
  id: string; case_id: string; party_type: string; party_id: string | null;
  verification_check_id: string; relationship: string; authoritative: boolean;
  linked_at: string; unlinked_at: string | null; unlink_reason: string | null;
  metadata?: Record<string, unknown>;
}

export interface AmlScreeningCandidateMatch {
  id: string; screening_check_id: string; match_type: string;
  list_name: string | null; matched_name: string; score: number | null;
  jurisdiction: string | null; status: "open" | "confirmed" | "dismissed" | "escalated";
  details?: Record<string, unknown>;
}

export interface AmlPepDetermination {
  id: string; party_screening_subject_id: string | null; subject_name: string;
  result: "not_pep" | "pep";
  pep_type: "foreign" | "domestic" | "international_organisation" | null;
  pep_relationship: "self" | "family_member" | "close_associate" | null;
  determined_at: string; determined_by_label: string | null;
  review_due_at: string | null; superseded_at: string | null;
}

export interface AmlPartyScreeningSubject {
  id: string; case_id: string; party_type: string; party_id: string | null;
  screened_name: string; required: boolean; state: string;
  last_screened_at: string | null; refresh_due_at: string | null;
  adjudicated_at: string | null; adjudication_note: string | null;
  screening_check_id: string | null; error_category: string | null;
  /** Canonical candidate matches for this subject's screening check (staff-side). */
  matches?: AmlScreeningCandidateMatch[];
  /** Current (non-superseded) PEP determination for this party, if any. */
  pep_determination?: AmlPepDetermination | null;
}

export interface AmlSubmissionReview {
  case: {
    id: string; reference: string; subject: string; status: string;
    case_stage: string | null; client_portal_status: string | null; service_gate_status: string | null;
  };
  submission: {
    id: string; version_number: number; review_status: string; submitted_at: string;
    submitted_by_type: string | null; submitted_by: string | null; review_reason: string | null;
    reviewed_at: string | null; questionnaire_version: string | null; consent_version: string | null;
    applicable_sections: string[]; sections: Array<{ section: string; status?: string; payload?: any }>;
    superseded_at: string | null;
  } | null;
  previous_version: { id: string; version_number: number; submitted_at: string } | null;
  differences: Array<{ section: string; field: string; previous: unknown; current: unknown; kind: string }>;
  differences_material: boolean;
  versions: Array<{ id: string; version_number: number; submitted_at: string; review_status: string }>;
  consent_evidence: Array<{ kind: string; version: string; accepted_at: string; document_hash: string | null }>;
  related_parties: AmlReconciliationItem[];
  requirements: any[];
  documents: any[];
  verification: Array<{
    id: string; party_id: string | null; party_label: string | null; check_type: string;
    status: string; processing_status: string | null; authoritative: boolean | null;
    execution_mode: string | null; attempt_consumed: boolean | null; provider: string | null;
    completed_at: string | null; provider_error_category: string | null;
  }>;
  screening: AmlPartyScreeningSubject[];
  open_requests: any[];
  missing_mandatory: string[];
  risk: { latest_assessment_at: string | null; stale: boolean; stale_reasons: string[] };
  message?: string;
}
