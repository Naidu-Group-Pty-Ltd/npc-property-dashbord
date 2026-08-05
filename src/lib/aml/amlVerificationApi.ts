import { invokeAmlFunction } from "./invokeAmlFunction";

export type IdvStatus = "pending" | "in_progress" | "verified" | "failed" | "expired" | "manual_review" | "cancelled";
export type ScreeningStatus = "pending" | "in_progress" | "clear" | "matched" | "review" | "failed" | "cancelled";
export type MatchStatus = "open" | "confirmed" | "dismissed" | "escalated";
export type MatchType = "pep" | "sanctions" | "adverse_media" | "watchlist" | "other";
export type ScreeningScope = "pep" | "sanctions" | "adverse_media" | "watchlist";

export interface IdentityCheck {
  id: string; case_id: string; subject_label: string; provider: string;
  provider_reference: string | null; method: string; status: IdvStatus;
  overall_score: number | null; result_payload: any; requested_at: string;
  completed_at: string | null; mc_job_id: string | null; mc_tokens_committed: number | null;
  /** Present once the execution-mode migration is applied. */
  execution_mode?: "live" | "simulation";
  authoritative?: boolean;
  environment?: string | null;
}

export type ProviderReadinessState =
  | "ready_live" | "simulator_non_production" | "not_configured"
  | "misconfigured" | "unavailable" | "unknown";

export interface CapabilityReadiness {
  capability: string;
  configured_provider: string | null;
  mode: "simulator" | "live";
  adapter_wired: boolean;
  secrets_present: Record<string, boolean>;
  last_health: { at: string | null; status: string | null; message: string | null } | null;
  state: ProviderReadinessState;
}

export interface ProviderReadiness {
  environment: string;
  simulator_blocked: boolean;
  note: string;
  idv: CapabilityReadiness;
  screening: CapabilityReadiness;
}

export interface ScreeningCheck {
  id: string; case_id: string; subject_label: string; subject_type: string;
  provider: string; provider_reference: string | null; scope: string[];
  status: ScreeningStatus; result_summary: any; requested_at: string;
  completed_at: string | null; mc_job_id: string | null; mc_tokens_committed: number | null;
}

export interface ScreeningMatch {
  id: string; screening_check_id: string; case_id: string; match_type: MatchType;
  list_name: string | null; matched_name: string; score: number | null;
  jurisdiction: string | null; details: any; status: MatchStatus;
  created_at: string; updated_at: string;
}

async function invoke<T = any>(payload: Record<string, unknown>): Promise<T> {
  return invokeAmlFunction<T>("aml-verification", payload);
}

export const amlVerificationApi = {
  providerReadiness: () => invoke<ProviderReadiness>({ op: "provider_readiness" }),
  initiateIdv: (case_id: string, method?: string, metadata?: Record<string, any>) =>
    invoke<{ identity_check: IdentityCheck; result: any }>({ op: "initiate_idv", case_id, method, metadata }),
  getIdv: (id: string) => invoke<{ identity_check: IdentityCheck; documents: any[] }>({ op: "get_idv", id }),
  listIdv: (case_id?: string, status?: IdvStatus) =>
    invoke<{ identity_checks: IdentityCheck[] }>({ op: "list_idv", case_id, status }),
  cancelIdv: (id: string) => invoke<{ identity_check: IdentityCheck }>({ op: "cancel_idv", id }),

  runScreening: (case_id: string, scope?: ScreeningScope[], metadata?: Record<string, any>) =>
    invoke<{ screening_check: ScreeningCheck; result: any }>({ op: "run_screening", case_id, scope, metadata }),
  listScreening: (case_id?: string, status?: ScreeningStatus) =>
    invoke<{ screening_checks: ScreeningCheck[] }>({ op: "list_screening", case_id, status }),
  getScreening: (id: string) => invoke<{ screening_check: ScreeningCheck; matches: ScreeningMatch[] }>({ op: "get_screening", id }),

  listMatches: (params: { case_id?: string; status?: MatchStatus } = {}) =>
    invoke<{ matches: ScreeningMatch[] }>({ op: "list_matches", ...params }),
  resolveMatch: (match_id: string, disposition: "confirmed" | "dismissed" | "escalated", rationale: string) =>
    invoke<{ resolution: any; match: ScreeningMatch }>({ op: "resolve_match", match_id, disposition, rationale }),

  /* ── self-hosted verification (zero-cost stack) ────────────────────────── */

  listVerificationChecks: (case_id: string) =>
    invoke<{ checks: AmlVerificationCheck[]; max_attempts: number }>(
      { op: "list_verification_checks", case_id }),

  /** Adjudicate a pending portal submission through the self-hosted service. */
  runVerification: (check_id: string) =>
    invoke<{ check: AmlVerificationCheck }>({ op: "run_verification", check_id }),

  recordDocumentSighting: (params: {
    case_id: string; party_id?: string | null; party_label: string;
    document_type: string; sighting_kind: "original" | "certified_copy";
    certifier_name?: string; certifier_capacity?: string; notes: string;
  }) => invoke<{ check: AmlVerificationCheck }>({ op: "record_document_sighting", ...params }),

  /** Returns a 120-second URL and writes an entry to the biometric access log. */
  getBiometricUrl: (check_id: string, reason: string) =>
    invoke<{ url: string; expires_in_seconds: number }>(
      { op: "get_biometric_url", check_id, reason }),

  listBiometricAccess: (case_id: string) =>
    invoke<{ access_log: AmlBiometricAccessEntry[] }>({ op: "list_biometric_access", case_id }),

  sanctionsListStatus: () =>
    invoke<{ syncs: AmlSanctionsSync[]; entry_count: number }>({ op: "sanctions_list_status" }),
};

export type AmlVerificationStatusValue =
  | "pending" | "in_progress" | "passed" | "failed" | "referred" | "exhausted" | "abandoned";

export interface AmlVerificationCheck {
  id: string;
  case_id: string;
  party_id: string | null;
  party_label: string;
  check_type: "electronic_idv" | "document_sighting" | "dvs" | "screening";
  attempt_number: number;
  status: AmlVerificationStatusValue;
  provider: string | null;
  provider_reference: string | null;
  outcome_detail: Record<string, any>;
  failure_reason: string | null;
  biometric_kind: string | null;
  /** The storage path itself is never sent to the browser. */
  has_biometric?: boolean;
  verified_by: string | null;
  verified_by_type: string | null;
  requested_at: string;
  completed_at: string | null;
}

export interface AmlBiometricAccessEntry {
  id: string;
  verification_check_id: string;
  actor_label: string | null;
  action: string;
  reason: string | null;
  created_at: string;
}

export interface AmlSanctionsSync {
  id: string;
  list_code: string;
  source_url: string;
  entry_count: number;
  status: string;
  error_detail: string | null;
  started_at: string;
  completed_at: string | null;
}
