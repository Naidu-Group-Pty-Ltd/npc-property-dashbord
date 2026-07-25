/**
 * Canonical AML workflow-status dimensions (Phase 1 contracts).
 *
 * The legacy `aml.case_status` enum compresses KYC progress, review state,
 * escalation and final outcomes into a single field. These contracts split the
 * case into the separate dimensions required by the tri-portal directive §16:
 *
 *   - case_stage            internal operational stage (Command Centre)
 *   - client_portal_status  what the client is told / asked to do
 *   - finance_portal_status what the finance partner is told / asked to do
 *   - service_gate_status   whether the designated service may proceed
 *   - risk rating           unchanged — `aml.risk_rating` stays authoritative
 *
 * The service gate is decided explicitly; it must never be inferred solely
 * from case stage or risk rating. The legacy `status` column remains the
 * compatibility source of truth until the cutover phase; the helpers below
 * derive dimension values for rows the migration has not yet backfilled.
 */

export const CASE_STAGES = [
  "draft",
  "activated",
  "awaiting_client",
  "client_in_progress",
  "client_submitted",
  "staff_review",
  "checks_in_progress",
  "additional_info_required",
  "decision_pending",
  "cleared",
  "cleared_with_conditions",
  "enhanced_cdd",
  "blocked",
  "closed",
] as const;
export type AmlCaseStage = (typeof CASE_STAGES)[number];

export const CLIENT_PORTAL_STATUSES = [
  "not_started",
  "action_required",
  "in_progress",
  "submitted",
  "under_review",
  "additional_info_required",
  "complete",
  "contact_adviser",
] as const;
export type AmlClientPortalStatus = (typeof CLIENT_PORTAL_STATUSES)[number];

export const FINANCE_PORTAL_STATUSES = [
  "not_requested",
  "information_required",
  "submitted",
  "clarification_required",
  "under_review",
  "accepted",
  "no_further_action",
] as const;
export type AmlFinancePortalStatus = (typeof FINANCE_PORTAL_STATUSES)[number];

export const SERVICE_GATE_STATUSES = [
  "not_activated",
  "cdd_incomplete",
  "information_outstanding",
  "under_review",
  "conditions_outstanding",
  "approved_with_controls",
  "approved",
  "locked",
  "terminated",
] as const;
export type AmlServiceGateStatus = (typeof SERVICE_GATE_STATUSES)[number];

export const ACTIVATION_TIMINGS = [
  "pre_agreement",
  "conditional_agreement",
  "post_agreement_trigger",
  "legacy_unclassified",
] as const;
export type AmlActivationTiming = (typeof ACTIVATION_TIMINGS)[number];

export const AGREEMENT_STATES = [
  "not_executed",
  "conditional_executed",
  "operative",
  "terminated",
] as const;
export type AmlAgreementState = (typeof AGREEMENT_STATES)[number];

/** Finance-safe readiness values (Appendix C.2). */
export const SERVICE_READINESS = ["service_not_ready", "service_ready"] as const;
export type AmlServiceReadiness = (typeof SERVICE_READINESS)[number];

import type { AmlCaseStatus } from "./amlCasesApi";

/**
 * Deterministic legacy → stage mapping used by the backfill migration and by
 * runtime fallbacks for rows created before the migration was applied.
 * Must stay byte-identical to the SQL CASE expression in
 * `supabase/migrations/*_aml_case_workflow_dimensions.sql`.
 */
export const LEGACY_STATUS_TO_STAGE: Record<AmlCaseStatus, AmlCaseStage> = {
  draft: "draft",
  kyc_in_progress: "client_in_progress",
  kyc_complete: "client_submitted",
  edd_required: "enhanced_cdd",
  under_review: "staff_review",
  escalated_mlro: "decision_pending",
  cleared: "cleared",
  blocked: "blocked",
  closed: "closed",
};

export const LEGACY_STATUS_TO_CLIENT_PORTAL: Record<AmlCaseStatus, AmlClientPortalStatus> = {
  draft: "not_started",
  kyc_in_progress: "in_progress",
  kyc_complete: "submitted",
  edd_required: "additional_info_required",
  under_review: "under_review",
  escalated_mlro: "under_review",
  cleared: "complete",
  blocked: "contact_adviser",
  closed: "complete",
};

/**
 * Legacy → service gate. Deliberately conservative: only `cleared` maps to an
 * approved gate; everything else remains ungated pending explicit decisions.
 */
export const LEGACY_STATUS_TO_SERVICE_GATE: Record<AmlCaseStatus, AmlServiceGateStatus> = {
  draft: "not_activated",
  kyc_in_progress: "cdd_incomplete",
  kyc_complete: "under_review",
  edd_required: "information_outstanding",
  under_review: "under_review",
  escalated_mlro: "under_review",
  cleared: "approved",
  blocked: "locked",
  closed: "terminated",
};

/** Minimal shape needed to derive dimensions from a case row. */
export interface CaseDimensionSource {
  status: AmlCaseStatus;
  case_stage?: string | null;
  client_portal_status?: string | null;
  finance_portal_status?: string | null;
  service_gate_status?: string | null;
}

function pick<T extends string>(candidate: string | null | undefined, allowed: readonly T[]): T | null {
  return candidate && (allowed as readonly string[]).includes(candidate) ? (candidate as T) : null;
}

/** Effective stage: explicit column when present and valid, else legacy mapping. */
export function caseStage(row: CaseDimensionSource): AmlCaseStage {
  return pick(row.case_stage, CASE_STAGES) ?? LEGACY_STATUS_TO_STAGE[row.status] ?? "draft";
}

export function clientPortalStatus(row: CaseDimensionSource): AmlClientPortalStatus {
  return (
    pick(row.client_portal_status, CLIENT_PORTAL_STATUSES) ??
    LEGACY_STATUS_TO_CLIENT_PORTAL[row.status] ??
    "in_progress"
  );
}

export function financePortalStatus(row: CaseDimensionSource): AmlFinancePortalStatus {
  return pick(row.finance_portal_status, FINANCE_PORTAL_STATUSES) ?? "not_requested";
}

export function serviceGateStatus(row: CaseDimensionSource): AmlServiceGateStatus {
  return (
    pick(row.service_gate_status, SERVICE_GATE_STATUSES) ??
    LEGACY_STATUS_TO_SERVICE_GATE[row.status] ??
    "not_activated"
  );
}

/**
 * Finance-safe readiness. Only an explicit approved gate reads as ready —
 * never derived from risk rating (which must not reach finance surfaces).
 */
export function serviceReadiness(gate: AmlServiceGateStatus): AmlServiceReadiness {
  return gate === "approved" || gate === "approved_with_controls"
    ? "service_ready"
    : "service_not_ready";
}

/** Plain-English labels for the internal case stage (Command Centre only). */
export const CASE_STAGE_LABELS: Record<AmlCaseStage, string> = {
  draft: "Draft",
  activated: "Activated",
  awaiting_client: "Awaiting client",
  client_in_progress: "Client in progress",
  client_submitted: "Client submitted",
  staff_review: "Staff review",
  checks_in_progress: "Checks in progress",
  additional_info_required: "Additional information required",
  decision_pending: "Decision pending",
  cleared: "Cleared",
  cleared_with_conditions: "Cleared with conditions",
  enhanced_cdd: "Enhanced CDD",
  blocked: "Blocked",
  closed: "Closed",
};

/** Plain-English labels for the client-portal dimension (client-safe). */
export const CLIENT_PORTAL_STATUS_LABELS: Record<AmlClientPortalStatus, string> = {
  not_started: "Not started",
  action_required: "Action required",
  in_progress: "In progress",
  submitted: "Submitted",
  under_review: "Under review",
  additional_info_required: "Additional information required",
  complete: "Complete",
  contact_adviser: "Please contact your adviser",
};

/** Plain-English labels for the finance-portal dimension (finance-safe). */
export const FINANCE_PORTAL_STATUS_LABELS: Record<AmlFinancePortalStatus, string> = {
  not_requested: "Not requested",
  information_required: "Information required",
  submitted: "Submitted",
  clarification_required: "Clarification required",
  under_review: "Under review",
  accepted: "Accepted",
  no_further_action: "No further action",
};

/** Explicit activation fields written at activation time (Phase 1 contract). */
export interface ActivationContract {
  activation_timing: AmlActivationTiming;
  agreement_state: AmlAgreementState;
  activation_policy_version: string | null;
  legacy_activation_model: "A" | "B" | null;
}

/**
 * Model → explicit-field mapping used at activation time. Model labels are
 * preserved in `legacy_activation_model`; meaning is carried by the explicit
 * fields (directive §17 — do not merely reverse labels).
 *
 *  - Model A ("designated service triggered"): the agreement/service trigger
 *    has already occurred → post-agreement activation, operative agreement.
 *  - Model B ("pre-service"): compliance runs under a conditional agreement
 *    before the designated service is unlocked.
 */
export function activationContractForModel(
  model: "A" | "B",
  programVersion: string | null,
): ActivationContract {
  return model === "A"
    ? {
        activation_timing: "post_agreement_trigger",
        agreement_state: "operative",
        activation_policy_version: programVersion,
        legacy_activation_model: "A",
      }
    : {
        activation_timing: "conditional_agreement",
        agreement_state: "conditional_executed",
        activation_policy_version: programVersion,
        legacy_activation_model: "B",
      };
}
