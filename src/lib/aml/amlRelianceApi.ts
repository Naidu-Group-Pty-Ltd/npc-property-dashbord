/**
 * Compliance Passport — staff API for the cross-portal reliance engine
 * (AML/CTF Act 2006 Pt 2 Div 7). Partner organisations never use this
 * client: they redeem a bearer token against `aml-reliance` directly from
 * their own portal integration.
 */
import { invokeAmlFunction } from "./invokeAmlFunction";

const invoke = <T = any>(payload: Record<string, unknown>) =>
  invokeAmlFunction<T>("aml-reliance", payload);

export interface RelianceAgreement {
  id: string;
  partner_org_name: string;
  partner_org_type: "finance" | "builder" | "developer" | "solicitor_conveyancer" | "other";
  partner_abn: string | null;
  agreement_reference: string;
  executed_on: string;
  next_review_due: string;
  last_reviewed_at: string | null;
  scope: string[];
  status: "active" | "suspended" | "terminated";
  notes: string | null;
  created_at: string;
  /** Phase 1–2 additions — null/absent on environments before the migrations. */
  partner_org_id?: string | null;
  eligibility_classification?: "unassessed" | "eligible_reporting_entity" | "eligible_foreign_equivalent" | "not_eligible";
  scope_customer_types?: string[] | null;
  scope_procedures?: string[] | null;
  scope_record_classes?: string[] | null;
  record_availability_sla_hours?: number | null;
  executed_document_reference?: string | null;
  effective_from?: string | null;
  expires_on?: string | null;
  agreement_version?: number;
  current_assessment_id?: string | null;
}

export interface ComplianceAttestation {
  id: string;
  case_id: string;
  version: number;
  payload: Record<string, any>;
  payload_sha256: string;
  issued_by_email: string | null;
  issued_at: string;
  superseded_at: string | null;
}

export interface RelianceGrant {
  id: string;
  agreement_id: string;
  attestation_id: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  reliance_agreements?: { partner_org_name: string; partner_org_type: string; status: string };
}

export interface IndependentAssessment {
  id: string;
  case_id: string;
  assessor_name: string;
  assessor_role: string | null;
  based_on_attestation_sha256: string;
  status: "open" | "satisfied" | "not_satisfied" | "records_requested";
  decision_notes: string | null;
  decided_at: string | null;
  created_at: string;
  reliance_agreements?: { partner_org_name: string };
}

export type PartnerLegalRoute =
  | "reliance" | "outsourced_cdd" | "independent_cdd" | "information_share_only";

export interface PartnerOrganisation {
  id: string;
  tenant_id: string;
  legal_name: string;
  trading_name: string | null;
  abn: string | null;
  registration_reference: string | null;
  registration_country: string;
  organisation_type: RelianceAgreement["partner_org_type"];
  portal_types: string[];
  reporting_entity_classification:
    | "unclassified" | "eligible_relying_reporting_entity" | "eligible_foreign_equivalent"
    | "reporting_entity_no_reliance" | "non_reporting_commercial"
    | "outsourcing_principal" | "service_provider";
  regulator_reference: string | null;
  classification_status: "unclassified" | "pending_review" | "classified" | "suspended";
  classification_evidence_reference: string | null;
  classification_notes: string | null;
  verified_at: string | null;
  status: "active" | "suspended" | "ended";
  created_at: string;
}

export interface PartnerCaseLink {
  id: string;
  case_id: string;
  partner_org_id: string;
  purchase_file_id: string | null;
  legal_matter_id: string | null;
  portal_type: string;
  relationship_role: string;
  legal_route: PartnerLegalRoute;
  purpose: string;
  state: "active" | "suspended" | "ended";
  linked_at: string;
  ended_at: string | null;
  end_reason_code: string | null;
  partner_organisations?: {
    legal_name: string; organisation_type: string;
    classification_status: string; status: string;
  };
}

export interface ArrangementAssessment {
  id: string;
  agreement_id: string;
  assessment_version: number;
  assessed_by_label: string | null;
  assessed_at: string;
  trigger: "initial" | "scheduled" | "significant_change" | "incident" | "other";
  evidence_references: string[];
  findings: string | null;
  decision: "suitable" | "suitable_with_conditions" | "unsuitable";
  conditions: string | null;
  next_due_at: string;
  status: "operative" | "superseded";
  superseded_at: string | null;
}

export interface PartnerRecordsRequest {
  id: string;
  case_id: string;
  partner_case_link_id: string;
  partner_org_id: string;
  requested_record_codes: string[];
  rationale: string;
  scope_evaluation: Array<{ code: string; label: string | null; scope: string }>;
  status: "draft" | "submitted" | "under_review" | "approved" | "partly_approved"
    | "denied" | "delivered" | "expired" | "cancelled";
  requested_at: string;
  requested_by_label: string | null;
  due_at: string | null;
  approved_record_codes: string[];
  denied_record_codes: string[];
  origin_response_message: string | null;
  reviewed_at: string | null;
  partner_organisations?: { legal_name: string; organisation_type: string };
}

export interface PartnerEvidenceDelivery {
  id: string;
  request_id: string;
  record_code: string;
  safe_label: string;
  delivered_version: number;
  delivered_sha256: string | null;
  delivered_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface PartnerOrgNameMapping {
  id: string;
  agreement_id: string;
  original_name: string;
  original_org_type: string;
  original_abn: string | null;
  proposed_partner_org_id: string | null;
  status: "pending" | "mapped" | "rejected";
  mapped_at: string | null;
  note: string | null;
}

export const amlRelianceApi = {
  listAgreements: () =>
    invoke<{ agreements: RelianceAgreement[] }>({ op: "list_agreements" }),
  createAgreement: (params: {
    partner_org_name: string; partner_org_type: RelianceAgreement["partner_org_type"];
    partner_abn?: string; agreement_reference: string;
    executed_on: string; next_review_due: string; notes?: string;
  }) => invoke<{ agreement: RelianceAgreement }>({ op: "create_agreement", ...params }),
  reviewAgreement: (agreement_id: string, next_review_due: string, outcome: "continue" | "suspend" | "terminate") =>
    invoke<{ agreement: RelianceAgreement }>({ op: "review_agreement", agreement_id, next_review_due, outcome }),

  issueAttestation: (case_id: string) =>
    invoke<{ attestation: ComplianceAttestation }>({ op: "issue_attestation", case_id }),
  listAttestations: (case_id: string) =>
    invoke<{ attestations: ComplianceAttestation[] }>({ op: "list_attestations", case_id }),

  /** Returns the raw partner token exactly once. */
  grantAccess: (case_id: string, agreement_id: string) =>
    invoke<{
      grant: { id: string; expires_at: string; attestation_version: number };
      access_token: string; note: string;
    }>({ op: "grant_access", case_id, agreement_id }),
  revokeGrant: (grant_id: string, reason: string) =>
    invoke<{ grant: RelianceGrant }>({ op: "revoke_grant", grant_id, reason }),
  listGrants: (case_id: string) =>
    invoke<{ grants: RelianceGrant[] }>({ op: "list_grants", case_id }),

  listAssessments: (case_id: string) =>
    invoke<{ assessments: IndependentAssessment[] }>({ op: "list_assessments", case_id }),
  listAccessLog: (case_id: string) =>
    invoke<{ access_log: any[] }>({ op: "list_access_log", case_id }),

  /* ── canonical partner identity (Phase 1) ─────────────────────────────── */

  listPartnerOrganisations: () =>
    invoke<{ partner_organisations: PartnerOrganisation[] }>({ op: "list_partner_organisations" }),
  upsertPartnerOrganisation: (params: {
    partner_org_id?: string; legal_name?: string;
    organisation_type?: RelianceAgreement["partner_org_type"];
    trading_name?: string; abn?: string; registration_reference?: string;
    registration_country?: string; portal_types?: string[];
    status?: "active" | "suspended" | "ended";
  }) => invoke<{ partner_organisation: PartnerOrganisation }>({ op: "upsert_partner_organisation", ...params }),
  classifyPartnerOrganisation: (params: {
    partner_org_id: string;
    reporting_entity_classification: PartnerOrganisation["reporting_entity_classification"];
    classification_evidence_reference?: string;
    classification_notes?: string; regulator_reference?: string;
  }) => invoke<{ partner_organisation: PartnerOrganisation }>({ op: "classify_partner_organisation", ...params }),

  listPartnerCaseLinks: (case_id: string) =>
    invoke<{ links: PartnerCaseLink[] }>({ op: "list_partner_case_links", case_id }),
  linkPartnerToCase: (params: {
    case_id: string; partner_org_id: string; portal_type: string;
    relationship_role: string; legal_route: PartnerLegalRoute; purpose: string;
    purchase_file_id?: string; legal_matter_id?: string;
  }) => invoke<{ link: PartnerCaseLink }>({ op: "link_partner_to_case", ...params }),
  setPartnerCaseLinkState: (params: {
    link_id: string; state: "active" | "suspended" | "ended";
    end_reason_code?: "completed" | "withdrawn" | "superseded" | "client_declined" | "other";
  }) => invoke<{ link: PartnerCaseLink }>({ op: "set_partner_case_link_state", ...params }),

  listPartnerMemberships: (partner_org_id: string) =>
    invoke<{ memberships: any[] }>({ op: "list_partner_memberships", partner_org_id }),
  upsertPartnerMembership: (params: {
    partner_org_id: string; portal_type: string;
    portal_user_source: "finance_portal_users" | "builder_portal_users" | "solicitor_portal_users";
    portal_user_id: string; organisation_role?: string;
    compliance_role?: "compliance_officer" | "operations" | "read_only";
    status?: "invited" | "active" | "suspended" | "ended";
  }) => invoke<{ membership: any }>({ op: "upsert_partner_membership", ...params }),

  listPartnerMappings: () =>
    invoke<{ mappings: PartnerOrgNameMapping[] }>({ op: "list_partner_mappings" }),
  resolvePartnerMapping: (params: {
    mapping_id: string; action?: "map" | "reject";
    partner_org_id?: string; note?: string;
  }) => invoke<{ mapping: PartnerOrgNameMapping }>({ op: "resolve_partner_mapping", ...params }),

  /* ── partner workspace: Command Center support (Phase 4) ──────────────── */

  staffListPartnerRecordsRequests: (case_id: string) =>
    invoke<{ requests: PartnerRecordsRequest[]; deliveries: PartnerEvidenceDelivery[] }>(
      { op: "staff_list_partner_records_requests", case_id }),
  reviewPartnerRecordsRequest: (params: {
    request_id: string;
    decision: "under_review" | "approved" | "partly_approved" | "denied";
    approved_record_codes?: string[];
    response_message?: string;
  }) => invoke<{ request: PartnerRecordsRequest }>({ op: "review_partner_records_request", ...params }),
  recordPartnerEvidenceDelivery: (params: {
    request_id: string; record_code: string; safe_label: string;
    delivered_sha256?: string; expires_days?: number;
  }) => invoke<{ delivery: PartnerEvidenceDelivery }>({ op: "record_partner_evidence_delivery", ...params }),

  /* ── arrangement governance (Phase 2) ─────────────────────────────────── */

  listArrangementAssessments: (agreement_id: string) =>
    invoke<{ assessments: ArrangementAssessment[] }>({ op: "list_arrangement_assessments", agreement_id }),
  recordArrangementAssessment: (params: {
    agreement_id: string;
    trigger: ArrangementAssessment["trigger"];
    decision: ArrangementAssessment["decision"];
    next_due_at: string; findings?: string; conditions?: string;
    evidence_references?: string[];
  }) => invoke<{ assessment: ArrangementAssessment }>({ op: "record_arrangement_assessment", ...params }),
  updateAgreementScope: (params: {
    agreement_id: string;
    eligibility_classification?: "unassessed" | "eligible_reporting_entity" | "eligible_foreign_equivalent" | "not_eligible";
    scope_customer_types?: string[]; scope_procedures?: string[];
    scope_record_classes?: string[]; record_availability_sla_hours?: number;
    jurisdiction?: string; cross_border_terms?: string;
    executed_document_reference?: string;
    effective_from?: string; expires_on?: string;
  }) => invoke<{ agreement: RelianceAgreement }>({ op: "update_agreement_scope", ...params }),
};
