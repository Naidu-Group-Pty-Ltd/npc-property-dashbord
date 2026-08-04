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
};
