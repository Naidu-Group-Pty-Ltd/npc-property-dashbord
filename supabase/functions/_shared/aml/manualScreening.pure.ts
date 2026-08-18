/**
 * Screening performed by the MLRO instead of by the provider.
 *
 * ── What this is, and the thing it must never become ──────────────────
 * The POLICY decides whether a screening is required. The METHOD decides how
 * a required screening is carried out. They are different questions and this
 * module only answers the second: choosing manual is never an exemption, and
 * nothing here can turn `required` into `not_required`.
 *
 * A manual check is a real `aml.screening_checks` row with real candidates in
 * `aml.screening_matches`, so a manual possible match enters the same
 * reviewer/MLRO adjudication path an automated one does. There is no separate
 * manual-match system to bypass it.
 *
 * ── Why the evidence rules are here and in the database ───────────────
 * "No match" is the claim that a customer does not appear on a list. It is
 * the most consequential thing this feature can record, and the cheapest to
 * record carelessly — a button that writes `clear` with nothing behind it
 * would be indistinguishable, afterwards, from a screening that happened.
 *
 * So a manual no-match must carry who performed it, when, which sources were
 * actually checked, which names were actually searched, and why the
 * conclusion follows. This module refuses without them and the table refuses
 * without them, deliberately twice: the constraint catches a code path that
 * forgets, and this catches it early enough to tell the operator which field
 * is missing.
 */

/** What the MLRO concluded. A closed vocabulary; never free text. */
export const MANUAL_OUTCOMES = [
  "no_match", "possible_match", "confirmed_match", "unable_to_complete",
] as const;
export type ManualOutcome = (typeof MANUAL_OUTCOMES)[number];

/** Why a manual screening could not be concluded. Also closed. */
export const UNABLE_REASONS = [
  "insufficient_identity", "source_unavailable",
  "evidence_inconclusive", "other_documented_reason",
] as const;
export type UnableReason = (typeof UNABLE_REASONS)[number];

export const UNABLE_REASON_TEXT: Record<UnableReason, string> = {
  insufficient_identity:
    "The identity information held is not sufficient to search reliably.",
  source_unavailable:
    "A source that had to be checked could not be reached.",
  evidence_inconclusive:
    "The searches performed did not settle the question either way.",
  other_documented_reason:
    "Another reason, documented in the rationale.",
};

/** The minimum a source entry must say to count as one. */
export interface ManualSource {
  source_type: string;
  source_name: string;
  source_reference?: string | null;
  searched_name?: string | null;
  searched_at?: string | null;
  notes?: string | null;
}

export interface ManualScreeningInput {
  outcome: ManualOutcome;
  sources: ManualSource[];
  searchedNames: string[];
  rationale: string;
  unableReason?: UnableReason | null;
  /** Candidates the MLRO found. Required for a possible/confirmed match. */
  candidates?: Array<{
    matchedName: string;
    listName?: string | null;
    reference?: string | null;
    matchBasis?: string | null;
    jurisdiction?: string | null;
    notes?: string | null;
  }>;
}

export interface ManualScreeningRejection {
  ok: false;
  code:
    | "unknown_outcome" | "sources_required" | "names_required"
    | "rationale_required" | "unable_reason_required"
    | "candidate_required" | "unknown_unable_reason";
  message: string;
}

export interface ManualScreeningPlan {
  ok: true;
  outcome: ManualOutcome;
  /** The canonical `screening_checks.status` this outcome maps onto. */
  checkStatus: "clear" | "matched" | "failed";
  /**
   * The party state this projects to — EXCEPT for a match, where the state is
   * re-derived from the canonical matches by the existing projection, exactly
   * as it is for an automated check.
   */
  subjectState: "completed" | "possible_match" | "confirmed_match" | "error";
  /** Whether this attempt discharges a required screening obligation. */
  satisfiesObligation: boolean;
  /** Match rows to write, in the canonical shape. */
  candidateStatus: "open" | "confirmed" | null;
  normalisedSources: ManualSource[];
  normalisedNames: string[];
  rationale: string;
  unableReason: UnableReason | null;
}

const RATIONALE_MIN = 20;

const cleanText = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** A source with no name is not a source. */
function normaliseSources(sources: ManualSource[] | undefined): ManualSource[] {
  return (sources ?? [])
    .filter((s) => s && cleanText(s.source_name, 200))
    .map((s) => ({
      source_type: cleanText(s.source_type, 60) || "other",
      source_name: cleanText(s.source_name, 200),
      source_reference: cleanText(s.source_reference, 300) || null,
      searched_name: cleanText(s.searched_name, 200) || null,
      searched_at: cleanText(s.searched_at, 40) || null,
      notes: cleanText(s.notes, 1000) || null,
    }))
    .slice(0, 25);
}

const normaliseNames = (names: string[] | undefined): string[] =>
  [...new Set((names ?? []).map((n) => cleanText(n, 200)).filter(Boolean))].slice(0, 50);

/**
 * Decide what a manual submission means, or refuse it with a reason.
 *
 * `unable_to_complete` is the honest failure state and is deliberately NOT
 * held to the evidence bar: it asserts the screening could not be concluded,
 * which is the opposite of a claim about the customer. It carries a reason
 * code instead, and it satisfies nothing — the obligation stays outstanding.
 */
export function planManualScreening(
  input: ManualScreeningInput,
): ManualScreeningPlan | ManualScreeningRejection {
  const outcome = String(input?.outcome ?? "") as ManualOutcome;
  if (!(MANUAL_OUTCOMES as readonly string[]).includes(outcome)) {
    return {
      ok: false, code: "unknown_outcome",
      message: `Outcome must be one of: ${MANUAL_OUTCOMES.join(", ")}.`,
    };
  }

  const rationale = cleanText(input?.rationale);
  const sources = normaliseSources(input?.sources);
  const names = normaliseNames(input?.searchedNames);

  if (outcome === "unable_to_complete") {
    const reason = String(input?.unableReason ?? "") as UnableReason;
    if (!(UNABLE_REASONS as readonly string[]).includes(reason)) {
      return {
        ok: false, code: "unable_reason_required",
        message: `A reason is required, one of: ${UNABLE_REASONS.join(", ")}.`,
      };
    }
    return {
      ok: true, outcome,
      checkStatus: "failed",
      // Not a customer outcome: the work did not conclude, so the subject
      // stays outstanding in the same state a technical failure produces.
      subjectState: "error",
      satisfiesObligation: false,
      candidateStatus: null,
      normalisedSources: sources, normalisedNames: names,
      rationale, unableReason: reason,
    };
  }

  // Everything else is a conclusion ABOUT THE CUSTOMER and must be evidenced.
  if (sources.length === 0) {
    return {
      ok: false, code: "sources_required",
      message: "Record at least one source that was actually checked. A conclusion "
        + "with no source behind it is not a screening.",
    };
  }
  if (names.length === 0) {
    return {
      ok: false, code: "names_required",
      message: "Record at least one name that was actually searched.",
    };
  }
  if (rationale.length < RATIONALE_MIN) {
    return {
      ok: false, code: "rationale_required",
      message: `Record why the conclusion is reasonable (at least ${RATIONALE_MIN} characters).`,
    };
  }

  if (outcome === "no_match") {
    return {
      ok: true, outcome,
      checkStatus: "clear",
      subjectState: "completed",
      // The obligation is discharged: a screening was performed, by a named
      // person, against recorded sources, and concluded.
      satisfiesObligation: true,
      candidateStatus: null,
      normalisedSources: sources, normalisedNames: names,
      rationale, unableReason: null,
    };
  }

  // A match must name what matched. "Possible match" with no candidate is not
  // reviewable and cannot be adjudicated.
  if (!(input.candidates ?? []).some((c) => cleanText(c?.matchedName, 300))) {
    return {
      ok: false, code: "candidate_required",
      message: "Record the listed name that matched, so it can be adjudicated "
        + "through the same workflow an automated candidate uses.",
    };
  }

  return {
    ok: true, outcome,
    checkStatus: "matched",
    subjectState: outcome === "confirmed_match" ? "confirmed_match" : "possible_match",
    /*
     * A finding does not discharge the obligation — it replaces it with an
     * adjudication, and a confirmed match with an escalation. Neither is a
     * completed screening in the sense Stage 5 means.
     */
    satisfiesObligation: false,
    candidateStatus: outcome === "confirmed_match" ? "confirmed" : "open",
    normalisedSources: sources, normalisedNames: names,
    rationale, unableReason: null,
  };
}

/**
 * Whether a manual attempt may be recorded against this subject at all.
 *
 * Mirrors the automated path's own refusals so the two cannot diverge: work
 * already in flight is not replaced, and an unadjudicated finding is resolved
 * rather than screened over.
 */
export function manualScreeningAdmissible(subject: {
  state: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  const state = String(subject?.state ?? "");
  if (["queued", "processing"].includes(state)) {
    return {
      ok: false, code: "already_in_progress",
      message: "An automated screening is already running for this party. Let it "
        + "finish, or release it, before recording a manual result.",
    };
  }
  if (["possible_match", "confirmed_match"].includes(state)) {
    return {
      ok: false, code: "adjudication_required",
      message: "This party has candidate or confirmed matches. Adjudicate them "
        + "before recording a new screening.",
    };
  }
  return { ok: true };
}
