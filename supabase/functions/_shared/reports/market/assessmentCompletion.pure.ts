/**
 * The five-dimension completion gate, and the states an assessment moves
 * through on the way to it.
 *
 * ## What this replaces
 *
 * The previous answer to "an F formed on three dimensions of five" was to
 * append a basis clause — *"AVOID … Assessed on 3 of 5 dimensions: capital
 * growth, rental yield and demand."* That is an honest sentence and it is not
 * a gate. The instruction is explicit: **a completed final investment grade
 * issues only when all five dimensions have valid scores under the approved
 * method.** A caveat on a verdict is not a substitute for withholding it.
 *
 * So the letter stops being the product of "enough dimensions" and becomes the
 * product of a COMPLETE assessment, and everything short of that is a named,
 * actionable state rather than a lower grade.
 *
 * ## What it must not do, and does not
 *
 * **It substitutes nothing.** No zero, no neutral default, no invented value
 * stands in for a dimension that was not measured. A dimension is scored or it
 * is not, and an unscored one produces a recovery action rather than a number.
 *
 * **It keeps the intermediate measurements.** Growth, Yield and Demand are
 * measured on both validation properties today; withholding the completed
 * grade does not withhold them. `dimensionStatuses` reports every one, scored
 * or not, which is the same rule the withheld-weight repair answers to: the
 * moment a grade is withheld is exactly the moment a reader most needs to know
 * what WAS measured.
 *
 * **Dimension completion and evidence coverage stay separate.** Five scored
 * dimensions does not mean 100% evidence coverage: a dimension scores on the
 * inputs it could reach, and `evidenceCoverage` discounts each by how much of
 * its own method ran. A test asserts the two can disagree in both directions,
 * because collapsing them is how "complete" comes to mean "we stopped asking".
 *
 * **It does not touch history.** `historical` is a state of its own. A record
 * written before this gate keeps the grade its own run issued, under its own
 * stamp, and is never re-derived — the rule `gradeWasIssued` already follows.
 * Nothing here rewrites a stored row, and a new assessment is produced by the
 * supported regeneration path rather than by reinterpreting an old one.
 *
 * ## The states
 *
 * | state | what it means | who moves it |
 * | --- | --- | --- |
 * | `acquisition` | evidence is still being gathered and attempts remain | system |
 * | `processing` | acquisition finished, the run is scoring | system |
 * | `evidence_required` | attempts are spent and something is still missing | named per dimension |
 * | `completed` | five valid scores; the grade issues | — |
 * | `historical` | written before this gate; preserved as issued | — |
 *
 * `acquisition` and `evidence_required` are deliberately different: the first
 * says the platform is still working and a retry may close it, the second says
 * retrying will not and names who must act. Reporting the second as the first
 * is how a permanently blocked assessment looks like a slow one for ever.
 *
 * ## Bounded retries
 *
 * {@link MAX_ACQUISITION_ATTEMPTS} is a ceiling on automatic re-acquisition,
 * not a target. A dimension whose failure is not retryable — a document
 * nobody has submitted, a method nobody has approved — consumes no attempts at
 * all, because retrying a fetch cannot produce a building inspection.
 */

/** The engine's five dimensions, in the order a reader meets them. */
export const ASSESSMENT_DIMENSIONS = ['growth', 'yield', 'demand', 'location', 'risk'] as const;

export type AssessmentDimension = typeof ASSESSMENT_DIMENSIONS[number];

export const DIMENSION_PROSE: Readonly<Record<AssessmentDimension, string>> = Object.freeze({
  growth: 'capital growth',
  yield: 'rental yield',
  demand: 'demand',
  location: 'location',
  risk: 'property risk',
});

export type AssessmentState =
  | 'acquisition'
  | 'processing'
  | 'evidence_required'
  | 'completed'
  | 'historical';

/** Who can close a gap, and by doing what. */
export type RecoveryActor = 'system' | 'operator' | 'owner' | 'provider';

export interface RecoveryAction {
  readonly actor: RecoveryActor;
  /** The specific act, in words the actor can follow. Never "try again later". */
  readonly action: string;
  /** True only where another automatic acquisition attempt could close it. */
  readonly retryable: boolean;
}

export interface DimensionStatus {
  readonly dimension: AssessmentDimension;
  readonly label: string;
  /** Did this dimension produce a valid score on this run? */
  readonly scored: boolean;
  /** The score, where there is one. Never a substitute value. */
  readonly score: number | null;
  /** Why it did not score, in the run's own words. Null where it did. */
  readonly reason: string | null;
  /** What would close it. Null where nothing is owed. */
  readonly recovery: RecoveryAction | null;
}

export interface AssessmentCompletion {
  readonly version: string;
  readonly state: AssessmentState;
  /** May a COMPLETED final investment grade be issued? */
  readonly mayIssueCompletedGrade: boolean;
  readonly dimensions: readonly DimensionStatus[];
  readonly scoredCount: number;
  readonly totalCount: number;
  /**
   * Evidence coverage, where the run retained it — a DIFFERENT measure from
   * `scoredCount / totalCount`, and never derived from it.
   */
  readonly evidenceCoverage: number | null;
  readonly attemptsUsed: number;
  readonly attemptsRemaining: number;
  /** Everything still owed, most actionable first. */
  readonly outstanding: readonly DimensionStatus[];
  /** One sentence a surface can draw. */
  readonly statement: string;
}

/**
 * The approved contract for a dimension score: a finite number from 0 to 100.
 *
 * `scored: true` alone is a CLAIM, and v1.0.0 trusted it — a dimension
 * reporting `scored: true, score: NaN` (or `Infinity`, `-5`, `150`, or no
 * score at all) counted towards the five and could have issued a completed
 * grade over a value no reader could print. Now the claim and the value must
 * both satisfy the contract before a dimension is complete.
 *
 * Two rules. **A genuine zero is a score** — 0 is inside the contract and a
 * dimension that measured rock bottom is measured. And **an invalid value is
 * never clamped into an apparently valid one**: clamping `150` to `100` or
 * `NaN` to `0` manufactures a measurement nobody took, so the dimension is
 * reported as not complete with the defect named, and the score published for
 * it is null.
 */
export function isValidDimensionScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

export const ASSESSMENT_COMPLETION_VERSION = '1.1.0';

/**
 * How many automatic re-acquisition attempts a run may make.
 *
 * A ceiling, not a target. Only a dimension whose recovery is `retryable`
 * consumes one; a missing document or an unapproved method consumes none,
 * because re-fetching cannot produce either.
 */
export const MAX_ACQUISITION_ATTEMPTS = 3;

export interface CompletionInput {
  /** Per dimension: did it score, what did it score, and why not. */
  readonly dimensions: Readonly<Partial<Record<AssessmentDimension, {
    readonly scored: boolean;
    readonly score?: number | null;
    readonly reason?: string | null;
    readonly recovery?: RecoveryAction | null;
  }>>>;
  /** The run's own evidence coverage where it retained one. Never inferred. */
  readonly evidenceCoverage?: number | null;
  /** Automatic acquisition attempts already spent on this assessment. */
  readonly attemptsUsed?: number;
  /** True while acquisition or scoring is still in flight. */
  readonly inFlight?: 'acquisition' | 'processing' | null;
  /**
   * True for a record written before this gate existed. Such a record keeps
   * the grade its own run issued and is never re-derived here.
   */
  readonly historical?: boolean;
}

/**
 * The default recovery for a dimension the run said nothing about.
 *
 * Deliberately NOT retryable and deliberately not silent: a dimension with no
 * status is a gap in the run's own reporting, and reporting it as "still
 * acquiring" would hide that for ever.
 */
/** An invalid score is a run defect; re-fetching evidence cannot repair it. */
const INVALID_SCORE: RecoveryAction = Object.freeze({
  actor: 'operator',
  action: 'Regenerate the assessment — this run recorded an invalid score for this dimension, '
    + 'so the value on file is a defect of the record and not a measurement.',
  retryable: false,
});

const UNREPORTED: RecoveryAction = Object.freeze({
  actor: 'operator',
  action: 'Regenerate the assessment — this run recorded no outcome for this dimension, so what '
    + 'it would need cannot be derived from the record.',
  retryable: false,
});

export function assessCompletion(input: CompletionInput): AssessmentCompletion {
  const dimensions: DimensionStatus[] = ASSESSMENT_DIMENSIONS.map((dimension) => {
    const d = input.dimensions[dimension];
    if (!d) {
      return {
        dimension,
        label: DIMENSION_PROSE[dimension],
        scored: false,
        score: null,
        reason: 'This run recorded no outcome for this dimension.',
        recovery: UNREPORTED,
      };
    }
    // The claim and the value must BOTH satisfy the contract. `scored: true`
    // beside NaN, Infinity, a negative, a value above 100 or no value at all
    // is a defect of the run's own record, and it completes nothing.
    const valid = d.scored === true && isValidDimensionScore(d.score);
    const invalidClaim = d.scored === true && !valid;
    return {
      dimension,
      label: DIMENSION_PROSE[dimension],
      scored: valid,
      // A score travels only where the dimension validly scored. Nothing
      // substitutes, and nothing is clamped.
      score: valid ? d.score as number : null,
      reason: valid
        ? null
        : invalidClaim
          ? `This run recorded the dimension as scored with an invalid value (${String(d.score)}), `
            + 'which is a defect of the record rather than a measurement.'
          : (d.reason ?? 'Not measured on this run.'),
      recovery: valid ? null : invalidClaim ? INVALID_SCORE : (d.recovery ?? UNREPORTED),
    };
  });

  const scoredCount = dimensions.filter((d) => d.scored).length;
  const totalCount = ASSESSMENT_DIMENSIONS.length;
  const outstanding = dimensions.filter((d) => !d.scored);
  const attemptsUsed = Math.max(0, input.attemptsUsed ?? 0);
  const attemptsRemaining = Math.max(0, MAX_ACQUISITION_ATTEMPTS - attemptsUsed);

  // Only a retryable gap can be waiting on the system. A missing inspection
  // report is not closer to arriving because a fetch is retried.
  const anyRetryable = outstanding.some((d) => d.recovery?.retryable === true);
  const complete = scoredCount === totalCount;

  // `inFlight` is the caller's claim about the CURRENT invocation and must
  // never be persisted: a stored copy of it is exactly the stale flag this
  // guards against. Even taken at its word, `acquisition` is honoured only
  // while attempts remain — a resumed or reopened assessment whose attempts
  // are spent reads `evidence_required` whatever the flag says, so a stale
  // flag cannot leave it acquiring indefinitely.
  const mayStillAcquire = attemptsRemaining > 0
    && (input.inFlight === 'acquisition' || anyRetryable);
  const state: AssessmentState = input.historical === true
    ? 'historical'
    : complete
      ? 'completed'
      : input.inFlight === 'processing'
        ? 'processing'
        : mayStillAcquire
          ? 'acquisition'
          : 'evidence_required';

  return {
    version: ASSESSMENT_COMPLETION_VERSION,
    state,
    // History keeps what its own run decided; this gate never re-issues it.
    mayIssueCompletedGrade: state === 'completed',
    dimensions,
    scoredCount,
    totalCount,
    evidenceCoverage: typeof input.evidenceCoverage === 'number' ? input.evidenceCoverage : null,
    attemptsUsed,
    attemptsRemaining,
    outstanding,
    statement: statementFor(state, scoredCount, totalCount, outstanding, attemptsRemaining),
  };
}

function statementFor(
  state: AssessmentState,
  scored: number,
  total: number,
  outstanding: readonly DimensionStatus[],
  attemptsRemaining: number,
): string {
  const names = outstanding.map((d) => d.label);
  const list = names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0] ?? '';
  switch (state) {
    case 'completed':
      return `All ${total} dimensions are scored, so a completed investment grade is issued.`;
    case 'historical':
      return 'This is a historical assessment. It keeps the grade its own run issued and is not '
        + 're-derived; generate a new assessment for a current one.';
    case 'processing':
      return `Scoring is in progress. ${scored} of ${total} dimensions are measured so far.`;
    case 'acquisition':
      return `Evidence is still being acquired for ${list}. ${scored} of ${total} dimensions are `
        + `measured, and ${attemptsRemaining} automatic attempt(s) remain.`;
    case 'evidence_required':
      return `${scored} of ${total} dimensions are measured. A completed grade is not issued until `
        + `${list} ${outstanding.length === 1 ? 'is' : 'are'} assessed, and each names what would `
        + 'close it.';
  }
}

/**
 * Whether the two coverage measures agree — they need not, and a surface that
 * assumes they do is wrong in both directions.
 *
 * Five scored dimensions with 62% evidence coverage is an ordinary, honest
 * result: every dimension reached a valid score on the inputs available to it,
 * and several ran on part of their own method. Three scored dimensions with
 * 100% coverage of those three is equally ordinary. This exists so the
 * difference is stated rather than inferred.
 */
export function completionDiffersFromCoverage(c: AssessmentCompletion): boolean {
  if (c.evidenceCoverage === null) return false;
  return Math.abs((c.scoredCount / c.totalCount) - c.evidenceCoverage) > 0.001;
}
