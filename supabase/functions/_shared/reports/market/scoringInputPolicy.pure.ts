/**
 * The forward-only scoring policy — what may reach a client's overall grade.
 *
 * ## What this closes
 *
 * Two measured findings sit behind this module, both on the live corpus of
 * 1,006 scored reports:
 *
 * **The grade was never evidenced** (`SCORING_ACCURACY_ZERO_COST_CLOSEOUT.md`).
 * Growth scored exactly 50 on 1,005 of 1,006 reports and Demand likewise, with
 * `hasData: false` on all 1,006 — so 55% of every grade issued was a constant.
 *
 * **The inputs that did report data cannot be trusted**
 * (`SCORING_INPUT_INTEGRITY_CLOSEOUT.md`). Location's three inputs are a
 * per-state template, a fabricated commute (mean 10,125 minutes, non-NSW
 * reports routed to Sydney) and a school count at its ceiling on 851 of 1,114.
 * Trusted Location coverage is **0 of 1,006**.
 *
 * The scoring service already knew how to withhold a headline —
 * `dataInsufficient` suppresses `totalScore` below three measured dimensions —
 * and the path had simply never fired, because a dimension computed from
 * defaults still reported `hasData: true`. **This module makes `hasData`
 * honest.** Nothing else in the scorer changes.
 *
 * ## Two independent rules, and why both are needed
 *
 * **Trust** asks whether the number is believable. **Ownership** asks whether
 * it belongs to the dimension reading it. They are different questions and an
 * input can fail either:
 *
 *   * a walk score is the right input for Location and is not believable;
 *   * a buyer's LVR is perfectly believable and is not a fact about the
 *     property at all.
 *
 * Ownership mirrors `dimensionOwnership.pure.ts` — the matrix Risk Model D is
 * built on — in this service's own input vocabulary. Buyer leverage and buyer
 * cash flow are owned by `finance` and forbidden to every dimension, which is
 * why V1's Risk (40% leverage, 30% serviceability) has no admissible input
 * left and stops scoring.
 *
 * ## Forward-only by construction
 *
 * This decides what a NEW scoring run may count. It reads no stored row and
 * writes none, so no historical report is touched, nothing is migrated and
 * nothing is recomputed. A stored score stays exactly as it was issued.
 *
 * ## Reversible by construction
 *
 * An input in a verification-requiring class becomes admissible the moment a
 * caller **declares it verified** (`verifiedInputs`). Nothing declares one
 * today, so today nothing in those classes scores — and when a genuine walk
 * score from a resolved coordinate or a licensed suburb series lands, the
 * caller names it and the dimension opens by itself. That is the same
 * evidence-opens-the-gate shape as Risk Model D's variant D2: no later code
 * change is required for the good case.
 */

/** Bumped whenever a class or a rule changes. Stamped on every new score. */
export const SCORING_INPUT_POLICY_VERSION = '1.0.0';

/**
 * How an input earns its place in a score.
 *
 * `operator_entered` is admissible as supplied because a person typed it about
 * THIS property for THIS report; it is the only class that needs no external
 * verification. The other two are inadmissible until declared verified, and
 * they are kept apart because the remedy differs: one needs the measurement
 * repaired, the other needs the evidence acquired.
 */
export type InputClass = 'operator_entered' | 'requires_repair' | 'requires_evidence';

/**
 * Every input the property scorer reads, by class.
 *
 * An input absent from this map is unknown to the policy and is refused —
 * failing closed, so adding an input to the scorer without classifying it
 * cannot silently widen what counts.
 */
export const INPUT_CLASSES: Readonly<Record<string, InputClass>> = {
  // Supplied by a person about this property.
  propertyPrice: 'operator_entered',
  weeklyRent: 'operator_entered',
  cashFlow: 'operator_entered',
  lvr: 'operator_entered',
  // Measured, but measured wrongly — see the integrity closeout.
  walkScore: 'requires_repair',
  commuteTimeCBD: 'requires_repair',
  schoolsNearby: 'requires_repair',
  // Suburb-level market evidence the deployment does not hold.
  priceGrowth1Year: 'requires_evidence',
  priceGrowth3Year: 'requires_evidence',
  populationGrowth: 'requires_evidence',
  vacancyRate: 'requires_evidence',
  daysOnMarket: 'requires_evidence',
  medianSuburbPrice: 'requires_evidence',
  unemploymentRate: 'requires_evidence',
};

export type ScoredDimension = 'yield' | 'growth' | 'location' | 'demand' | 'risk';

/**
 * Which dimension owns each input.
 *
 * `finance` is not a dimension: it is the buyer's own position, reported
 * beside the score and never inside it (`financeSuitability.pure.ts`). 1 Boxer
 * Drive carries two same-day reports at the same price and different leverage;
 * under the old model that was 12.8 points of Risk for a number an operator
 * typed.
 */
export const INPUT_OWNER: Readonly<Record<string, ScoredDimension | 'finance'>> = {
  propertyPrice: 'yield',
  weeklyRent: 'yield',
  cashFlow: 'finance',
  lvr: 'finance',
  walkScore: 'location',
  commuteTimeCBD: 'location',
  schoolsNearby: 'location',
  priceGrowth1Year: 'growth',
  priceGrowth3Year: 'growth',
  populationGrowth: 'demand',
  vacancyRate: 'demand',
  daysOnMarket: 'demand',
  medianSuburbPrice: 'demand',
  unemploymentRate: 'demand',
};

/** Why one input was refused, in terms an engineer can act on. */
export interface InputRuling {
  input: string;
  admitted: boolean;
  /** Set only when refused. */
  reason: 'unclassified' | 'not_owned_by_dimension' | 'awaiting_repair' | 'awaiting_evidence' | null;
}

/**
 * Rule on one input for one dimension.
 *
 * Ownership is checked first: an input the dimension does not own is refused
 * whatever its trust class, because a believable number in the wrong place is
 * the double-count this programme removed.
 */
export function ruleOn(
  dimension: ScoredDimension,
  input: string,
  verifiedInputs: readonly string[],
): InputRuling {
  const cls = INPUT_CLASSES[input];
  if (!cls) return { input, admitted: false, reason: 'unclassified' };
  if (INPUT_OWNER[input] !== dimension) {
    return { input, admitted: false, reason: 'not_owned_by_dimension' };
  }
  if (cls === 'operator_entered' || verifiedInputs.includes(input)) {
    return { input, admitted: true, reason: null };
  }
  return {
    input,
    admitted: false,
    reason: cls === 'requires_repair' ? 'awaiting_repair' : 'awaiting_evidence',
  };
}

/** The inputs a dimension may actually count, from those the record presented. */
export function admissibleInputs(
  dimension: ScoredDimension,
  presented: readonly string[],
  verifiedInputs: readonly string[] = [],
): string[] {
  return presented.filter((i) => ruleOn(dimension, i, verifiedInputs).admitted);
}

// ---------------------------------------------------------------------------
// What a client is told
// ---------------------------------------------------------------------------

/**
 * The client-facing statement when no overall grade may be issued.
 *
 * Factual, neutral and non-alarming on purpose: an absent grade is a statement
 * about OUR evidence, never about the property. Nothing here uses the word
 * "untrusted", "gate", "dimension" or any other term from this codebase.
 */
export const OVERALL_GRADE_UNAVAILABLE = {
  heading: 'Overall Investment Grade',
  value: 'Not available — insufficient verified evidence',
  explanation:
    'An overall investment grade is only issued when sufficient verified property '
    + 'evidence is available. Available measured analysis is shown below.',
} as const;

/**
 * Why one dimension was not assessed, in the client's words.
 *
 * One sentence each, naming what is missing rather than what the system did.
 */
export const NOT_ASSESSED_REASON: Readonly<Record<ScoredDimension, string>> = {
  growth: 'Not assessed — verified suburb-level growth evidence is currently unavailable.',
  demand: 'Not assessed — sufficient verified demand evidence is currently unavailable.',
  location:
    'Not assessed — the available location information does not meet the current '
    + 'verification standard.',
  risk: 'Not assessed — insufficient verified property-risk evidence is available.',
  yield: 'Not assessed — a verified purchase price and weekly rent are required.',
} as const;

/** The label a dimension carries where it did score. */
export const ASSESSED_LABEL = 'Measured' as const;

// ---------------------------------------------------------------------------
// The stamp a new score carries
// ---------------------------------------------------------------------------

/**
 * What a new score records about how it was decided.
 *
 * Deliberately small — five fields the Reporting Fact Contract can adopt
 * unchanged. `gradeIssued` is stored rather than re-derived because "was a
 * grade published" is a question about this run, and answering it later by
 * re-reading a score is how two surfaces come to disagree.
 */
export interface ScoringPolicyStamp {
  scoringSystem: 'investment-scoring-service';
  inputPolicyVersion: string;
  /** True only when the run published an overall grade. */
  gradeIssued: boolean;
  eligibility: 'issued' | 'insufficient_verified_evidence';
  /** Dimensions that counted, after the policy. */
  measuredDimensions: ScoredDimension[];
  evaluatedAt: string;
}

export function policyStamp(
  measuredDimensions: ScoredDimension[],
  gradeIssued: boolean,
  now: Date,
): ScoringPolicyStamp {
  return {
    scoringSystem: 'investment-scoring-service',
    inputPolicyVersion: SCORING_INPUT_POLICY_VERSION,
    gradeIssued,
    eligibility: gradeIssued ? 'issued' : 'insufficient_verified_evidence',
    measuredDimensions,
    evaluatedAt: now.toISOString(),
  };
}
