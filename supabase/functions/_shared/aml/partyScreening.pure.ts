/**
 * Party screening projection and PEP control rules — pure functions, no I/O.
 *
 * `aml.party_screening_subjects.state` is a PROJECTION of canonical screening
 * evidence (`aml.screening_checks` + `aml.screening_matches`), never a first
 * truth of its own. These functions are the single place that projection and
 * the gate's notion of "outstanding" are defined, so aml-cases, aml-risk,
 * aml-monitoring and the outbox worker cannot drift apart. Imported by the
 * edge functions AND unit-tested directly from vitest.
 */

/** Canonical match statuses (aml.screening_matches.status). */
export type ScreeningMatchStatus = "open" | "confirmed" | "dismissed" | "escalated";

/** party_screening_subjects.state values (see 20260901000000 CHECK). */
export type PartyScreeningState =
  | "not_required" | "not_started" | "queued" | "processing" | "completed"
  | "possible_match" | "confirmed_match" | "false_positive" | "error";

/**
 * Derive the party screening state from the canonical matches of its
 * screening check. Precedence: a confirmed finding outranks anything still
 * open; anything open or escalated outranks a set of dismissals.
 */
export function projectPartyScreeningState(
  matchStatuses: ScreeningMatchStatus[],
): "completed" | "possible_match" | "confirmed_match" | "false_positive" {
  if (matchStatuses.length === 0) return "completed";
  if (matchStatuses.some((s) => s === "confirmed")) return "confirmed_match";
  if (matchStatuses.some((s) => s === "open" || s === "escalated")) return "possible_match";
  return "false_positive";
}

/**
 * States in which required screening work has NOT produced a usable outcome.
 * A technical error stays outstanding — it must never read as clear.
 */
export const SCREENING_INCOMPLETE_STATES: PartyScreeningState[] = [
  "not_started", "queued", "processing", "error",
];

/** Terminal states that satisfy a required screening (subject cleared). */
export const SCREENING_SATISFIED_STATES: PartyScreeningState[] = [
  "completed", "false_positive",
];

export type ScreeningOutstandingReason =
  | "incomplete"        // not_started / queued / processing / error
  | "unresolved"        // candidate matches await human adjudication
  | "confirmed_match"   // adjudicated finding — handled by the mandatory-hold path
  | "stale"             // satisfied once, but past its refresh due date
  | null;               // nothing outstanding

/**
 * Why (if at all) a party screening subject still stands between the case and
 * clearance. `confirmed_match` is reported distinctly: it is not "missing
 * work", it is a finding the risk system consumes as a mandatory hold.
 */
export function partyScreeningOutstanding(
  subject: {
    required: boolean;
    state: string;
    refresh_due_at?: string | null;
  },
  nowIso: string,
): ScreeningOutstandingReason {
  if (!subject.required || subject.state === "not_required") return null;
  if (SCREENING_INCOMPLETE_STATES.includes(subject.state as PartyScreeningState)) {
    return "incomplete";
  }
  if (subject.state === "possible_match") return "unresolved";
  if (subject.state === "confirmed_match") return "confirmed_match";
  if (
    SCREENING_SATISFIED_STATES.includes(subject.state as PartyScreeningState) &&
    subject.refresh_due_at && subject.refresh_due_at < nowIso
  ) {
    return "stale";
  }
  return null;
}

/**
 * The states get_submission_review counts as missing_mandatory. Everything
 * non-terminal is outstanding; stale satisfied screenings are outstanding too.
 */
export function isPartyScreeningMissing(
  subject: { required: boolean; state: string; refresh_due_at?: string | null },
  nowIso: string,
): boolean {
  const reason = partyScreeningOutstanding(subject, nowIso);
  return reason === "incomplete" || reason === "unresolved" || reason === "stale";
}

/** Refresh due date from the last screening and the rescreen interval. */
export function computeRefreshDueAt(lastScreenedAtIso: string, intervalDays: number): string {
  const base = new Date(lastScreenedAtIso).getTime();
  const days = Number.isFinite(intervalDays) && intervalDays > 0 ? intervalDays : 365;
  return new Date(base + days * 24 * 3600 * 1000).toISOString();
}

/* ───────────────────────────── PEP controls ─────────────────────────────── */

export type PepType = "foreign" | "domestic" | "international_organisation";
export type PepRelationship = "self" | "family_member" | "close_associate";

export interface PepDeterminationLike {
  result: "not_pep" | "pep";
  pep_type?: PepType | string | null;
  pep_relationship?: PepRelationship | string | null;
  superseded_at?: string | null;
  review_due_at?: string | null;
}

/**
 * Which extra PEP controls apply, per current AUSTRAC guidance (verified
 * 2026-08 against austrac.gov.au CDD / PEP / senior-manager pages):
 *
 *   - A FOREIGN PEP always requires enhanced CDD — including establishing
 *     source of funds and source of wealth — and senior manager approval to
 *     provide (or continue providing) the designated service.
 *   - A DOMESTIC or INTERNATIONAL ORGANISATION PEP requires the same measures
 *     only where the customer's ML/TF risk is high.
 *   - Being a PEP is NEVER an automatic reason to refuse or exit — the
 *     controls are approvals and diligence, not rejection.
 *
 * Family members and close associates of a PEP carry the PEP's category, so
 * the relationship does not change which controls apply — the type does.
 */
export function pepControlsRequired(
  determination: PepDeterminationLike | null | undefined,
  caseRiskRating: string | null | undefined,
): { eddRequired: boolean; seniorManagerApprovalRequired: boolean } {
  if (!determination || determination.result !== "pep" || determination.superseded_at) {
    return { eddRequired: false, seniorManagerApprovalRequired: false };
  }
  const highRisk = caseRiskRating === "high" || caseRiskRating === "prohibited";
  const applies = determination.pep_type === "foreign" ||
    ((determination.pep_type === "domestic" ||
      determination.pep_type === "international_organisation") && highRisk);
  return { eddRequired: applies, seniorManagerApprovalRequired: applies };
}

/** A determination is current when not superseded and not past review. */
export function pepDeterminationCurrent(
  determination: PepDeterminationLike | null | undefined,
  nowIso: string,
): boolean {
  if (!determination || determination.superseded_at) return false;
  if (determination.review_due_at && determination.review_due_at < nowIso) return false;
  return true;
}

/**
 * Party roles for which a PEP determination is required. This mirrors the
 * program's own identification list (VERIFICATION_REQUIRED_ROLES in
 * submissionReview.ts): the customer, co-purchasers, and the individuals who
 * own or act for an entity customer — the same individuals AUSTRAC's initial
 * CDD guidance says must be assessed for PEP status. The case subject is
 * always assessed; this list covers reconciled related parties.
 */
export const PEP_DETERMINATION_REQUIRED_ROLES = [
  "co_purchaser", "director", "trustee", "beneficial_owner", "authorised_representative",
] as const;

export function pepDeterminationRequiredForRole(partyType: string): boolean {
  return (PEP_DETERMINATION_REQUIRED_ROLES as readonly string[]).includes(partyType);
}

/**
 * Whether the PEP controls are satisfied by evidence LINKED to the current
 * determination. An EDD case completed before the PEP was known never
 * considered it, and an approval granted for an earlier finding does not
 * approve this one — both must postdate the latest current PEP
 * determination. EDD for a PEP is only complete once source of funds AND
 * source of wealth are actually verified on the existing SoF/SoW records.
 */
export function pepEvidenceSatisfied(args: {
  /** determined_at of the latest current (non-superseded) pep finding. */
  latestPepDeterminedAt: string;
  /** completed_at of the newest completed+approved EDD case, if any. */
  eddCompletedAt?: string | null;
  hasVerifiedSourceOfFunds: boolean;
  hasVerifiedSourceOfWealth: boolean;
  /** resolved_at of the newest approved pep_service_approval, if any. */
  approvalResolvedAt?: string | null;
}): { eddComplete: boolean; approvalGranted: boolean } {
  const eddComplete = Boolean(
    args.eddCompletedAt && args.eddCompletedAt >= args.latestPepDeterminedAt &&
    args.hasVerifiedSourceOfFunds && args.hasVerifiedSourceOfWealth,
  );
  const approvalGranted = Boolean(
    args.approvalResolvedAt && args.approvalResolvedAt >= args.latestPepDeterminedAt,
  );
  return { eddComplete, approvalGranted };
}

/* ─────────────────────────── worker claim rules ─────────────────────────── */

export type ScreeningClaimDecision =
  /** Claim and run the screening. */
  | "claim"
  /** Terminal or reset state — a duplicate/stale event; succeed silently. */
  | "obsolete"
  /**
   * Another worker appears to hold it. The event must be RETRIED, not
   * succeeded: succeeding would mark the event processed, and if the holder
   * died the subject would stay 'processing' forever with nothing left to
   * wake it. Retrying lets a later delivery either see the terminal state
   * (holder finished) or reclaim after the staleness window (holder died).
   */
  | "in_flight_retry";

export function screeningClaimDecision(
  subject: { state: string; updated_at?: string | null },
  nowMs: number,
  staleMinutes: number,
): ScreeningClaimDecision {
  if (subject.state === "queued" || subject.state === "error") return "claim";
  if (subject.state === "processing") {
    const updated = subject.updated_at ? new Date(subject.updated_at).getTime() : 0;
    return nowMs - updated >= staleMinutes * 60_000 ? "claim" : "in_flight_retry";
  }
  return "obsolete";
}

/**
 * Stable identity for a screening match within one check, so redelivered
 * events cannot double-insert candidates. The list's own external id wins;
 * a provider that supplies none falls back to what the reviewer sees.
 */
export function matchDedupKey(match: {
  details?: Record<string, unknown> | null;
  matchedName?: string; matched_name?: string;
  listName?: string | null; list_name?: string | null;
}): string {
  const externalId = String((match.details ?? {})["external_id"] ?? "");
  if (externalId) return `ext:${externalId}`;
  const name = match.matchedName ?? match.matched_name ?? "";
  const list = match.listName ?? match.list_name ?? "";
  return `name:${name}|${list}`;
}
