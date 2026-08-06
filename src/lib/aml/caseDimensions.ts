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

/**
 * Plain-English labels for the legacy `status` column (Command Centre only).
 * Surfaces must show these, never the raw enum value (e.g. "Onboarding in
 * progress", not `kyc_in_progress`).
 */
export const CASE_STATUS_LABELS: Record<AmlCaseStatus, string> = {
  draft: "Draft",
  kyc_in_progress: "Onboarding in progress",
  kyc_complete: "Submission received",
  edd_required: "Additional information required",
  under_review: "Under review",
  escalated_mlro: "Awaiting decision",
  cleared: "Cleared",
  blocked: "Blocked",
  closed: "Closed",
};

/**
 * Shared badge treatment for risk ratings. Escalates through tone *and*
 * weight rather than four unrelated hues: the two "bad" ratings share the
 * destructive token separated by fill strength, so `prohibited` is
 * unmistakably the loudest pill on any surface. Semantic tokens only.
 */
export const RISK_BADGE_CLASSES = {
  low: "bg-success/20 text-success border-success/40",
  medium: "bg-warning/20 text-warning border-warning/40",
  high: "bg-destructive/15 text-destructive border-destructive/40",
  prohibited: "border-destructive bg-destructive text-destructive-foreground",
} as const;

/** Plain-English labels for the service-gate dimension (Command Centre only). */
export const SERVICE_GATE_LABELS: Record<AmlServiceGateStatus, string> = {
  not_activated: "Not activated",
  cdd_incomplete: "CDD incomplete",
  information_outstanding: "Information outstanding",
  under_review: "Under review",
  conditions_outstanding: "Conditions outstanding",
  approved_with_controls: "Approved with controls",
  approved: "Approved",
  locked: "Locked",
  terminated: "Terminated",
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

/* ------------------------------------------------------------------ */
/* Case progress rail (directive §11.3)                                */
/* ------------------------------------------------------------------ */

export const PROGRESS_RAIL_STEPS = [
  { key: "activated", label: "Activated" },
  { key: "client_invited", label: "Client invited" },
  { key: "information_collection", label: "Information collection" },
  { key: "identity_verification", label: "Identity verification" },
  { key: "screening", label: "Screening" },
  { key: "ownership_control", label: "Ownership & control" },
  { key: "funding_finance", label: "Funding & finance" },
  { key: "risk_assessment", label: "Risk assessment" },
  { key: "review_decision", label: "Review & decision" },
  { key: "service_gate", label: "Service gate" },
  { key: "monitoring", label: "Monitoring" },
  { key: "ongoing_cdd", label: "Ongoing CDD" },
  { key: "relationship_ended", label: "Relationship ended" },
  { key: "retention", label: "Retention" },
] as const;
export type ProgressRailKey = (typeof PROGRESS_RAIL_STEPS)[number]["key"];

export type ProgressRailState =
  | "not_started" | "in_progress" | "complete"
  | "attention_required" | "blocked" | "not_applicable";

/**
 * Derive a coarse rail position from the case stage. Until later phases wire
 * per-step data sources (identity checks, screening runs, funding
 * reconciliation), steps before the current position render complete, the
 * current step in progress, later steps not started. Blocked and
 * enhanced-CDD stages surface as blocked / attention on the active step.
 */
const STAGE_TO_RAIL_INDEX: Record<AmlCaseStage, number> = {
  draft: 0,
  activated: 1,
  awaiting_client: 2,
  client_in_progress: 2,
  client_submitted: 3,
  checks_in_progress: 4,
  staff_review: 8,
  additional_info_required: 2,
  enhanced_cdd: 7,
  decision_pending: 8,
  cleared: 10,
  cleared_with_conditions: 10,
  blocked: 9,
  closed: 12,
};

export function progressRail(row: CaseDimensionSource & { closed_at?: string | null }): Array<{
  key: ProgressRailKey; label: string; state: ProgressRailState;
}> {
  const stage = caseStage(row);
  const current = STAGE_TO_RAIL_INDEX[stage] ?? 0;
  const gate = serviceGateStatus(row);
  return PROGRESS_RAIL_STEPS.map((step, i) => {
    let state: ProgressRailState =
      i < current ? "complete" : i === current ? "in_progress" : "not_started";
    if (i === current && stage === "blocked") state = "blocked";
    if (i === current && (stage === "enhanced_cdd" || stage === "additional_info_required")) {
      state = "attention_required";
    }
    if (step.key === "service_gate") {
      if (gate === "approved" || gate === "approved_with_controls") state = "complete";
      else if (gate === "locked") state = "blocked";
      else if (i < current) state = "in_progress";
    }
    if (step.key === "relationship_ended" && stage !== "closed") state = "not_started";
    if (step.key === "retention") {
      state = stage === "closed" ? "in_progress" : "not_started";
    }
    return { key: step.key, label: step.label, state };
  });
}

/* ------------------------------------------------------------------ */
/* Partner compliance state                                            */
/* ------------------------------------------------------------------ */

/**
 * The sixth canonical dimension: where ONE linked partner organisation
 * stands on this case.
 *
 * It belongs beside the other five because it is the same kind of thing —
 * a workflow state with a single authority — and the authority here is the
 * partner, never us. The Command Centre may *observe* this dimension; no
 * origin action moves it, and it never feeds `service_gate_status` back.
 *
 * Two rules make the label set what it is:
 *
 *  - No state asserts that a partner is compliant. A single origin approval
 *    does not make a downstream organisation compliant, so the terminal
 *    good state is "Partner satisfied" — a statement about the decision
 *    that partner recorded, not about its regulatory position.
 *  - Losing access is not the same as never having had it. `revoked` and
 *    `refresh_required` are distinct from `not_linked`, so a withdrawn
 *    passport can never read as a partner that was simply never connected.
 */
export const PARTNER_COMPLIANCE_STATES = [
  "not_linked",
  "independent_cdd",
  "passport_available",
  "under_partner_review",
  "records_requested",
  "partner_satisfied",
  "refresh_required",
  "revoked",
] as const;
export type AmlPartnerComplianceState = (typeof PARTNER_COMPLIANCE_STATES)[number];

/** Command-Centre labels. Partner-facing surfaces use their own wording. */
export const PARTNER_COMPLIANCE_STATE_LABELS: Record<AmlPartnerComplianceState, string> = {
  not_linked: "Not linked",
  independent_cdd: "Independent CDD",
  passport_available: "Passport available",
  under_partner_review: "Under partner review",
  records_requested: "Records requested",
  partner_satisfied: "Partner satisfied",
  refresh_required: "Refresh required",
  revoked: "Revoked",
};

/** A reliance grant, reduced to the fields this dimension reads. */
export interface PartnerGrantSource {
  revoked_at?: string | null;
  expires_at?: string | null;
  refresh_required_at?: string | null;
}

/**
 * A partner's own recorded determination, reduced to the fields this
 * dimension reads. `status` mirrors `aml.independent_assessments.status`.
 */
export interface PartnerDeterminationSource {
  status?: string | null;
  refresh_required_at?: string | null;
}

function grantExpired(grant: PartnerGrantSource, now: Date): boolean {
  if (!grant.expires_at) return false;
  const at = new Date(grant.expires_at).getTime();
  return Number.isFinite(at) && at < now.getTime();
}

/**
 * Derive one partner's state from the grants and determinations recorded
 * against it. Pure: no clock unless supplied, no I/O, no writes.
 *
 * Precedence is deliberate, and it is "stale first":
 *
 *   1. anything flagged for refresh — a determination pinned to content
 *      that has since changed is not a live determination, and §7.2 treats
 *      a stale passport still reading as current as the severe failure;
 *   2. the partner's own current determination, most settled first;
 *   3. an open determination — they are looking at it;
 *   4. a live grant with nothing decided yet;
 *   5. access that existed and stopped existing;
 *   6. nothing recorded at all.
 *
 * Both `not_satisfied` and `independent_cdd_required` land on
 * `independent_cdd`: the plan pairs them as the single outcome "this
 * partner is not relying on our procedures and will verify separately".
 */
export function partnerComplianceState(input: {
  grants: PartnerGrantSource[];
  determinations: PartnerDeterminationSource[];
  /** The case's current attestation is flagged for refresh. */
  attestationRefreshRequired?: boolean;
  now?: Date;
}): AmlPartnerComplianceState {
  const now = input.now ?? new Date();
  const grants = input.grants ?? [];
  const determinations = input.determinations ?? [];

  const liveGrants = grants.filter(
    (g) => !g.revoked_at && !grantExpired(g, now),
  );
  const decided = determinations.filter(
    (d) => d.status && d.status !== "open",
  );
  const current = decided.filter((d) => !d.refresh_required_at);
  const has = (status: string) => current.some((d) => d.status === status);

  // 1 — stale before anything else.
  const refreshFlagged =
    input.attestationRefreshRequired === true ||
    liveGrants.some((g) => Boolean(g.refresh_required_at)) ||
    (decided.length > 0 && current.length === 0);
  if (refreshFlagged) return "refresh_required";

  // 2 — the partner's own current determination.
  if (has("satisfied")) return "partner_satisfied";
  if (has("records_requested")) return "records_requested";
  if (has("not_satisfied") || has("independent_cdd_required")) return "independent_cdd";

  // 3 / 4 — looking at it, or able to.
  const open = determinations.some((d) => !d.status || d.status === "open");
  if (liveGrants.length > 0) return open ? "under_partner_review" : "passport_available";
  if (open) return "under_partner_review";

  // 5 — access existed and stopped.
  if (grants.some((g) => Boolean(g.revoked_at))) return "revoked";
  if (grants.some((g) => grantExpired(g, now))) return "refresh_required";

  // 6 — nothing recorded.
  return "not_linked";
}

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
