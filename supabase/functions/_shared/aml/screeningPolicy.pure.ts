/**
 * Who Stage 5 screens, what it screens them for, and what a person still has
 * to do about it. Server-side and authoritative.
 *
 * ── The defect this exists to fix ─────────────────────────────────────
 * `party_screening_subjects` was written in exactly ONE place: when an
 * operator resolved a related-party reconciliation item. Nothing ever
 * enrolled the CASE SUBJECT — the customer the case is about.
 *
 * `partyScreening.pure.ts` states the intent it never implemented:
 *
 *   "The case subject is always assessed; this list covers reconciled
 *    related parties."
 *
 * So a straightforward individual purchase — no co-purchasers, no gift
 * donors, nothing to reconcile — produced zero reconciliation items, zero
 * screening subjects, and a Stage 5 with nothing to run and nothing to
 * press. Measured across production: 0 subjects on all 6 cases, including
 * one with three submitted questionnaires.
 *
 * The operator's reading of that screen — "this client must not need
 * screening" — was reasonable and wrong. Nobody had been enrolled.
 *
 * ── What this module decides, and what it refuses to ──────────────────
 * It decides two things and persists neither (the caller does):
 *
 *   1. WHO must be enrolled. The case subject always; reconciled related
 *      parties in the roles the program identifies.
 *
 *   2. WHICH scopes are proportionate. Adverse media and internal
 *      watchlists are risk-based and may be stood down against a recorded
 *      basis. **Sanctions and PEP never can.** They are mandatory
 *      determinations that get ESTABLISHED, not skipped, and no answer,
 *      rating or profile removes them.
 *
 * It refuses to decide a screening OUTCOME. Nothing here produces "clear",
 * "no match" or a PEP result. Those come from the provider and from a
 * recorded determination, and a fabricated one is the most dangerous thing
 * this platform could emit.
 */

/** Party types the program screens, beyond the case subject itself. */
export const SCREENED_RELATED_ROLES = [
  "co_purchaser", "director", "trustee", "beneficial_owner", "authorised_representative",
] as const;

/** The case subject's own party type. Always enrolled, always required. */
export const PRIMARY_SUBJECT_PARTY_TYPE = "primary_subject";

export type ScreeningScopeKey = "sanctions" | "pep" | "adverse_media" | "watchlist";

/** Never stood down by any input. See the header. */
export const MANDATORY_SCOPES: readonly ScreeningScopeKey[] = ["sanctions", "pep"] as const;
/** The only scopes a risk policy may conclude are not proportionate. */
export const RISK_BASED_SCOPES: readonly ScreeningScopeKey[] = ["adverse_media", "watchlist"] as const;

/**
 * Bump when the rule below changes meaning. It is stamped on every recorded
 * decision so an audit can tell which policy produced which outcome, and so
 * a re-evaluation under a new rule is visibly a new decision rather than a
 * silent overwrite.
 */
export const SCREENING_POLICY_VERSION = "2026.08-1";

export interface ScreeningAnswers {
  pep: "yes" | "no" | null;
  adverse: "yes" | "no" | null;
  thirdParty: "yes" | "no" | null;
  overseasFunding: "yes" | "no" | null;
}

export interface ScreeningPolicyInput {
  answers: ScreeningAnswers | null;
  entityType: string | null;
  riskRating: string | null;
  enhancedDueDiligence: boolean;
  /** Any party on the case already determined to be a PEP. */
  anyPepFinding: boolean;
}

export interface ScreeningPolicyDecision {
  /** Scopes this case must complete. Always contains sanctions and pep. */
  required: ScreeningScopeKey[];
  /** Risk-based scopes the policy concluded are not proportionate. */
  notRequired: Array<{ scope: ScreeningScopeKey; basis: string }>;
  /** Why the risk-based scopes ARE required, when they are. */
  triggers: string[];
  /**
   * Whether the client's declaration is complete enough to support the
   * low-risk PEP determination route. It selects a ROUTE. It is never the
   * determination and never a waiver.
   */
  pepRoute: "declaration_supported" | "manual_review";
  /** The answers this decision was made on, verbatim, for the audit trail. */
  evidence: Record<string, string>;
  policyVersion: string;
  /** One sentence an operator and an auditor can both read. */
  summary: string;
}

const answered = (v: unknown): v is "yes" | "no" => v === "yes" || v === "no";

/** An entity customer is anything that is not a natural person. */
function isIndividual(entityType: string | null): boolean {
  const t = String(entityType ?? "").trim().toLowerCase();
  return t === "individual" || t === "individuals" || t === "sole" || t === "natural_person";
}

/**
 * Risk evidence that makes broader adverse-media research proportionate.
 *
 * The customer's own declaration is ONE input and never the only one — a
 * customer cannot know what has been reported about them, and a customer
 * with something to hide is exactly the one who answers "no".
 */
export function adverseMediaTriggers(input: ScreeningPolicyInput): string[] {
  const out: string[] = [];
  const risk = String(input.riskRating ?? "").trim().toLowerCase();
  if (risk === "high" || risk === "prohibited") out.push(`the case is rated ${risk} risk`);
  if (input.enhancedDueDiligence) out.push("the case is in enhanced due diligence");
  if (input.anyPepFinding) out.push("a party to this case is a politically exposed person");
  if (input.entityType && !isIndividual(input.entityType)) {
    out.push(`the customer is a ${String(input.entityType).toLowerCase()} rather than an individual`);
  }
  if (input.answers?.overseasFunding === "yes") out.push("funds are coming from overseas");
  if (input.answers?.thirdParty === "yes") out.push("a third party is involved in the purchase");
  if (input.answers?.adverse === "yes") out.push("the customer disclosed adverse media");
  return out;
}

export function decideScreeningPolicy(input: ScreeningPolicyInput): ScreeningPolicyDecision {
  const a = input.answers;
  // Every risk input must have been READ. "The client did not say" and "the
  // client said no" are different facts and only the second is evidence, so
  // a partly-answered questionnaire stands nothing down.
  const answersComplete = Boolean(a) &&
    answered(a?.pep) && answered(a?.adverse) &&
    answered(a?.thirdParty) && answered(a?.overseasFunding);

  const triggers = adverseMediaTriggers(input);
  const required: ScreeningScopeKey[] = ["sanctions", "pep"];
  const notRequired: ScreeningPolicyDecision["notRequired"] = [];

  if (!answersComplete) {
    // Unknown risk evidence is not a low-risk profile.
    required.push("adverse_media", "watchlist");
  } else if (triggers.length > 0) {
    required.push("adverse_media", "watchlist");
  } else {
    const basis =
      "Not triggered for this profile under AML/CTF policy " +
      `${SCREENING_POLICY_VERSION}: the customer is an individual, the case is not ` +
      "rated high or prohibited risk and is not in enhanced due diligence, no PEP " +
      "finding applies to any party, and the client declared no overseas funding, " +
      "no third-party involvement and no adverse media.";
    notRequired.push({ scope: "adverse_media", basis }, { scope: "watchlist", basis });
  }

  const evidence: Record<string, string> = {
    "personal_details.pep": String(a?.pep ?? "not answered"),
    "personal_details.adverse": String(a?.adverse ?? "not answered"),
    "purchase_profile.third_party": String(a?.thirdParty ?? "not answered"),
    "funding.overseas": String(a?.overseasFunding ?? "not answered"),
    "purchasing_structure.entity_type": String(input.entityType ?? "not answered"),
    "case.risk_rating": String(input.riskRating ?? "unrated"),
    "case.enhanced_due_diligence": input.enhancedDueDiligence ? "yes" : "no",
  };

  /*
   * The declaration route is available only when the client answered the PEP
   * question "no" AND nothing on the case contradicts a low-risk profile.
   * It selects how the determination may be reached — never whether one is
   * needed.
   */
  const pepRoute: ScreeningPolicyDecision["pepRoute"] =
    answersComplete && a?.pep === "no" && triggers.length === 0
      ? "declaration_supported"
      : "manual_review";

  return {
    required, notRequired, triggers, pepRoute, evidence,
    policyVersion: SCREENING_POLICY_VERSION,
    summary: notRequired.length > 0
      ? "Reduced scope: sanctions and PEP only. Adverse media and internal watchlist " +
        "research are not proportionate for this profile."
      : !answersComplete
        ? "Full scope: the client's risk answers are incomplete, so no control can be stood down."
        : `Full scope: ${triggers.join(", and ")}.`,
  };
}

/* ─────────────────────────── Enrolment ──────────────────────────────── */

export interface EnrolmentCandidate {
  partyType: string;
  partyId: string | null;
  reconciliationItemId: string | null;
  screenedName: string;
  aliases: string[];
  dateOfBirth: string | null;
  country: string | null;
}

export interface EnrolmentInput {
  subjectDisplayName: string | null;
  /** `personal_details` payload from the latest submission, if any. */
  personalDetails: Record<string, unknown> | null;
  /**
   * Previous names and alternative spellings the client disclosed in the
   * Australian Sanctions & Compliance Screening section.
   *
   * This is the whole point of asking them: an undisclosed former name is a
   * real screening gap, and a list is only as good as the names put to it.
   * They enrich the subject's `aliases`, which the matcher indexes — they do
   * not change WHETHER the subject is screened.
   */
  declaredAliases?: string[] | null;
  /** Resolved reconciliation items that require screening. */
  reconciled: Array<{
    id: string; declaredName: string; declaredRole: string;
    resolvedPartyType: string | null; resolvedPartyId: string | null;
    screeningRequired: boolean; resolutionStatus: string;
    declaredPayload: Record<string, unknown> | null;
  }>;
  /** Subjects that already exist, so this can be run repeatedly. */
  existing: Array<{ partyType: string; partyId: string | null; screenedName: string }>;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** A YYYY-MM-DD date or nothing. A malformed date is worse than none. */
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Identity keys compare case-insensitively on the pair that must be unique. */
const key = (partyType: string, partyId: string | null, name: string) =>
  `${partyType}::${partyId ?? ""}::${name.trim().toLowerCase()}`;

/**
 * Who should hold a `party_screening_subjects` row for this case.
 *
 * Returns only what is MISSING, so the caller can run it on every read
 * without writing a duplicate. It never returns a subject with no name: a
 * screening subject without an identity cannot be screened, and enrolling an
 * empty name would create a permanently unresolvable row.
 */
export function deriveMissingScreeningSubjects(input: EnrolmentInput): EnrolmentCandidate[] {
  const have = new Set(input.existing.map((e) => key(e.partyType, e.partyId, e.screenedName)));
  const out: EnrolmentCandidate[] = [];
  const add = (c: EnrolmentCandidate) => {
    const k = key(c.partyType, c.partyId, c.screenedName);
    if (have.has(k)) return;
    have.add(k);
    out.push(c);
  };

  /*
   * The case subject. This is the row that was never created, and it is
   * created from the case's own record rather than from the questionnaire,
   * because the customer exists whether or not they have submitted anything.
   * The questionnaire only enriches it — a DOB and citizenship the matcher
   * can use instead of a bare display name.
   */
  const pd = input.personalDetails ?? {};
  const subjectName = str(input.subjectDisplayName) ?? str(pd.full_name);
  if (subjectName) {
    add({
      partyType: PRIMARY_SUBJECT_PARTY_TYPE,
      partyId: null,
      reconciliationItemId: null,
      screenedName: subjectName,
      aliases: [...new Set([
        ...(Array.isArray(pd.aliases)
          ? (pd.aliases as unknown[]).filter((x): x is string => typeof x === "string")
          : []),
        ...(input.declaredAliases ?? []).filter((x) => typeof x === "string" && x.trim()),
      ].map((a) => a.trim()).filter(Boolean))].slice(0, 25),
      dateOfBirth: isoDate(pd.dob) ?? isoDate(pd.date_of_birth),
      country: str(pd.citizenship) ?? str(pd.nationality) ?? str(pd.country),
    });
  }

  /*
   * Reconciled related parties, in the roles the program identifies. This
   * repeats what the reconciliation handler already does on resolution — on
   * purpose, so a case whose parties were resolved before this shipped, or
   * whose insert failed, self-heals rather than staying silently unscreened.
   */
  for (const item of input.reconciled) {
    if (!item.screeningRequired) continue;
    if (!["linked", "created"].includes(item.resolutionStatus)) continue;
    const partyType = str(item.resolvedPartyType) ?? str(item.declaredRole);
    if (!partyType) continue;
    const name = str(item.declaredName);
    if (!name) continue;
    const declared = item.declaredPayload ?? {};
    add({
      partyType,
      partyId: str(item.resolvedPartyId),
      reconciliationItemId: item.id,
      screenedName: name,
      aliases: Array.isArray(declared.aliases)
        ? (declared.aliases as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20)
        : [],
      dateOfBirth: isoDate(declared.date_of_birth) ?? isoDate(declared.dob),
      country: str(declared.country) ?? str(declared.nationality),
    });
  }

  return out;
}

/* ────────────────────── What a person must do next ──────────────────── */

export type ScreeningNextActionKey =
  | "none"
  | "await_submission"
  | "fix_provider"
  | "enrol_subjects"
  | "run_screening"
  | "adjudicate_match"
  | "record_pep"
  | "await_provider_result"
  | "screening_stalled"
  | "escalate";

/**
 * How long a queued request may sit before "running" stops being true.
 *
 * The worker sweeps every minute and caps each pass at 25 events, so a
 * request that is genuinely in flight clears well inside this. Past it, the
 * honest reading is that nothing picked it up — which is exactly what
 * happened in production for an unbounded time, while the screen said the
 * engine was working.
 */
export const SCREENING_STALL_SECONDS = 300;

export interface ScreeningNextAction {
  key: ScreeningNextActionKey;
  /** The button an operator presses, or null when there is nothing to press. */
  label: string | null;
  headline: string;
  detail: string;
  owner: "system" | "analyst" | "reviewer" | "administrator" | "client" | "none";
}

/**
 * What a technical screening failure means, in words an operator can act on.
 *
 * `error_category` is recorded by the screening consumer when a check cannot
 * complete. Rendering the raw category ("list_data_unavailable") tells nobody
 * anything; naming the cause and the owner is what turns a dead end into a
 * next step.
 */
export const SCREENING_ERROR_DETAIL: Record<string, string> = {
  list_data_unavailable:
    "The sanctions list has never been loaded, or is older than the freshness " +
    "window, so a check would be screening against nothing. Load the DFAT " +
    "Consolidated List in AML › Verification. No client action is required.",
  provider_not_configured:
    "No screening provider is configured for this tenant. An administrator " +
    "must configure one in AML › Configuration › Providers.",
  provider_misconfigured:
    "The screening provider is configured but cannot execute — in production " +
    "that usually means it is still in simulator mode. An administrator must " +
    "finish configuring it as live.",
  timeout:
    "The screening provider did not answer in time. Re-running is safe and " +
    "consumes no attempt.",
  provider_unavailable:
    "The screening provider could not be reached. Re-running is safe and " +
    "consumes no attempt.",
};

export interface NextActionInput {
  hasSubmission: boolean;
  subjectCount: number;
  providerReady: boolean;
  /** Aggregate over required subjects. */
  anyUnscreened: boolean;
  anyProcessing: boolean;
  anyPossibleMatch: boolean;
  anyConfirmedMatch: boolean;
  anyMissingPep: boolean;
  pepRoute: ScreeningPolicyDecision["pepRoute"];
  /** `error_category` from the most relevant failed subject, if any. */
  errorCategory?: string | null;
  /**
   * Age of the oldest UNPROCESSED queue entry for this case, in seconds.
   * `null` when nothing is queued or the queue could not be read — and an
   * unread queue is never reported as stalled.
   */
  oldestQueuedSeconds?: number | null;
}

/**
 * Exactly one next action, chosen by what actually blocks the stage.
 *
 * The order is the order a case moves through, most-blocking first, so an
 * operator is never shown a step whose prerequisite is unmet — which is what
 * "Run screening" did when there was nobody enrolled to screen.
 */
export function deriveScreeningNextAction(input: NextActionInput): ScreeningNextAction {
  if (input.anyPossibleMatch) {
    return {
      key: "adjudicate_match", label: "Adjudicate matches",
      headline: "A possible match needs adjudication",
      detail: "Screening returned a candidate. Confirm it is the screened person, or " +
        "dismiss it as a false positive with a written rationale.",
      owner: "reviewer",
    };
  }
  if (input.anyConfirmedMatch) {
    return {
      key: "escalate", label: "Open the case record",
      headline: "A confirmed match is recorded",
      detail: "This case must be escalated to the AML/CTF Compliance Officer. It must " +
        "not proceed to service on this stage's completion.",
      owner: "reviewer",
    };
  }
  if (input.subjectCount === 0) {
    return input.hasSubmission
      ? {
        key: "enrol_subjects", label: "Prepare screening",
        headline: "Nobody is enrolled for screening yet",
        detail: "The customer and any related parties must be enrolled before the " +
          "checks can run. This is prepared automatically — no client action is required.",
        owner: "system",
      }
      : {
        key: "await_submission", label: null,
        headline: "Waiting on the client's questionnaire",
        detail: "Screening is prepared from the submitted questionnaire. Nothing can be " +
          "enrolled until the client submits it.",
        owner: "client",
      };
  }
  if (!input.providerReady && input.anyUnscreened) {
    return {
      key: "fix_provider", label: "Open screening configuration",
      headline: "Screening cannot run yet",
      detail: "The screening provider and its sanctions data must be restored before " +
        "any check can execute. No client action is required.",
      owner: "administrator",
    };
  }
  if (input.anyProcessing) {
    const age = input.oldestQueuedSeconds;
    // "Running" is a claim about something happening. Past the stall window
    // it is not true, and saying it anyway is how an operator waits for ever.
    if (typeof age === "number" && age >= SCREENING_STALL_SECONDS) {
      return {
        key: "screening_stalled", label: "Retry screening",
        headline: "Screening has not started",
        detail: `The request has been queued for ${Math.floor(age / 60)} minutes and ` +
          "nothing has picked it up. The screening worker is not consuming the queue. " +
          "Retrying is safe — a request already in flight is refused rather than " +
          "sent twice.",
        owner: "administrator",
      };
    }
    return {
      key: "await_provider_result", label: null,
      headline: "Screening is running",
      detail: "The screening engine is checking the enrolled parties against the " +
        "official lists. Candidates come back for adjudication.",
      owner: "system",
    };
  }
  if (input.errorCategory) {
    // A technical failure leaves the subject outstanding — it never reads as
    // clear — so it is named, owned, and given the step that clears it.
    const detail = SCREENING_ERROR_DETAIL[input.errorCategory]
      ?? "The check could not complete. An error is never a clear result.";
    return {
      key: "fix_provider",
      label: input.errorCategory === "list_data_unavailable"
        || input.errorCategory === "provider_not_configured"
        || input.errorCategory === "provider_misconfigured"
        ? "Open screening configuration"
        : "Retry screening",
      headline: "Screening could not complete",
      detail,
      owner: input.errorCategory === "timeout" || input.errorCategory === "provider_unavailable"
        ? "analyst" : "administrator",
    };
  }
  if (input.anyUnscreened) {
    return {
      key: "run_screening", label: "Run screening",
      headline: "Ready to screen",
      detail: "Every enrolled party is checked against the required sanctions lists.",
      owner: "analyst",
    };
  }
  if (input.anyMissingPep) {
    return input.pepRoute === "declaration_supported"
      ? {
        key: "record_pep", label: "Record PEP determinations",
        headline: "PEP determinations outstanding",
        detail: "The client's declaration supports the low-risk determination route, so " +
          "the sources and rationale are prefilled. A determination is still recorded " +
          "against each party — the declaration is evidence, not the determination.",
        owner: "reviewer",
      }
      : {
        key: "record_pep", label: "Record PEP determinations",
        headline: "PEP determinations outstanding",
        detail: "This case does not qualify for the declaration-supported route. Each " +
          "party needs a determination reached on its own evidence.",
        owner: "reviewer",
      };
  }
  return {
    key: "none", label: null,
    headline: "Stage 5 complete",
    detail: "Every required determination is recorded. Completing this stage is not a " +
      "service-gate decision and does not itself approve the case.",
    owner: "none",
  };
}

/* ─────────────────── Self-healing: what may auto-run ─────────────────── */

export interface RecoveryCandidate {
  id: string;
  state: string;
  screeningCheckId: string | null;
  updatedAt: string | null;
  required: boolean;
}

/**
 * Which subjects the stage may run WITHOUT anybody pressing anything.
 *
 * A queued request that nothing consumed used to sit until an operator
 * noticed. Measured on one production case: 130 minutes, and the only way out
 * was a human. That is a dead end dressed as a status.
 *
 * Deliberately bounded to two situations, because "run screening
 * automatically" must never become "run the provider on every page load":
 *
 *   NEVER ATTEMPTED  `not_started` with no check. Nothing has been spent, so
 *                    starting it costs one attempt and removes a click the
 *                    operator should never have needed.
 *
 *   STALLED          queued or processing past the stall window with no
 *                    check. The queue did not consume it, so releasing and
 *                    running it is RECOVERY, not a second attempt.
 *
 * `error` is excluded on purpose. The consumer claims `queued` and `error`
 * alike, so auto-running a failed subject would re-run the provider on every
 * page view — a retry loop, paid for per view. A failure keeps its explicit
 * Retry, which is a person deciding to spend another attempt.
 *
 * A subject that already holds a check is never auto-run: that check is
 * either in flight or finished, and re-running it would duplicate a
 * completed execution.
 */
export function recoverableSubjects(
  subjects: RecoveryCandidate[],
  nowMs: number,
  stallSeconds: number = SCREENING_STALL_SECONDS,
): RecoveryCandidate[] {
  const cutoff = nowMs - stallSeconds * 1000;
  return subjects.filter((s) => {
    if (!s.required) return false;
    if (s.screeningCheckId) return false;
    if (s.state === "not_started") return true;
    if (s.state !== "queued" && s.state !== "processing") return false;
    const at = Date.parse(String(s.updatedAt ?? ""));
    return Number.isFinite(at) && at <= cutoff;
  });
}
