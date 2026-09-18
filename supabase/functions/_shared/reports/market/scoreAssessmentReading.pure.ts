/**
 * The assessment behind a grade, reconstructed from the stored score.
 *
 * ## The defect this exists to end
 *
 * The S1 presentation distinguished three things about 18 Annabelle Crescent:
 * a **measured-criteria score of 40** and its grade **C**, **57% evidence
 * coverage**, and the **issued F** after the nominal-point ceiling. The
 * score-dimension table that replaced the unqualified one-liners lost all
 * three: it printed the stored `weight` values 57/21/21 as "nominal points"
 * and `coverage.weightCovered` as "70% of the score's nominal points", and it
 * showed neither the uncapped grade nor the ceiling that produced the F.
 *
 * Both mistakes are the same mistake — **reading a renormalised figure as a
 * nominal one**:
 *
 * | | Annabelle |
 * | --- | --- |
 * | ORIGINAL nominal weights (`COMPOSITE_WEIGHTS`) | growth .40, location .25, yield .15, demand .15, risk .05 |
 * | measured dimensions | growth, yield, demand — .70 of the nominal weight |
 * | ADJUSTED weights (nominal ÷ .70) | growth .5714, yield .2143, demand .2143 |
 * | what `breakdown[].weight` stores | **57, 21, 21** — the adjusted weights, rounded to whole percent |
 * | contributions at ADJUSTED weight | 32.00 + 4.93 + 2.79 = **39.71** |
 * | composite (rounded ONCE, at the end) | **40** → uncapped grade **C** |
 * | delivered points at NOMINAL weight | 22.40 + 3.45 + 1.95 = **27.80** |
 * | nominal ceiling = grade of the delivered points | **F** |
 * | issued grade | **F** — capped |
 *
 * That also explains the arithmetic the owner caught. Multiplying by the
 * STORED integer weights gives 31.9 + 4.8 + 2.7 = 39.4 against a stated 40,
 * and 44.0 + 11.1 + 7.4 = 62.3 against a stated 63. The engine rounds **once**,
 * on the sum, and its adjusted weights are exact fractions rather than the
 * whole percents the row records. Reconstructing from `COMPOSITE_WEIGHTS`
 * reproduces 39.71 → 40 and 62.86 → 63 exactly.
 *
 * ## What cannot be reconstructed, and is therefore never guessed
 *
 * Two figures the engine computes are **not persisted on the row**:
 *
 *   - **`evidenceCoverage`** — Σ(nominal weight × that dimension's OWN
 *     methodology coverage). It is what S1 reported as 57%, and it is NOT
 *     `coverage.weightCovered` (0.70), which counts a dimension scored on a
 *     third of its inputs as a whole dimension. The per-dimension coverage is
 *     not on the row, so this reading reports it as not retained rather than
 *     substituting the coarser figure.
 *   - **the growth ceiling** — `gradeEligibility`'s A/A+ gates read growth
 *     confidence and growth's own weight coverage, neither of which is stored.
 *     The NOMINAL ceiling is reconstructible and is reported; where the two
 *     differ the growth one binds, so this reading names the nominal ceiling
 *     as a floor on the explanation rather than as the whole of it.
 *
 * `persistedAssessment()` is what closes both, forward-only: the engine has
 * both figures at the moment it grades, and writing them costs nothing.
 *
 * Pure: no fetch, no Deno, no clock. It reads a stored object and arithmetic.
 */

import { COMPOSITE_WEIGHTS, type DimensionKey } from './shadowScorer.pure.ts';
import { gradeFor, GRADE_THRESHOLDS } from './gradeEligibility.pure.ts';

/** `breakdown`'s key for each dimension, and the label a reader meets. */
const DIMENSIONS: ReadonlyArray<{ field: string; key: DimensionKey; label: string }> = [
  { field: 'growthScore', key: 'growth', label: 'Capital growth' },
  { field: 'locationScore', key: 'location', label: 'Location' },
  { field: 'yieldScore', key: 'yield', label: 'Rental yield' },
  { field: 'demandScore', key: 'demand', label: 'Demand' },
  { field: 'riskScore', key: 'risk', label: 'Property risk' },
];

export interface AssessmentDimension {
  key: DimensionKey;
  label: string;
  /** Out of 100 for this dimension, or null where it was not scored. */
  score: number | null;
  /** The dimension's share of the method before any adjustment, 0–1. */
  nominalWeight: number;
  /**
   * `nominalWeight ÷ (the nominal weight of every MEASURED dimension)`, 0–1,
   * exact. The row stores this rounded to a whole percent; the engine used
   * the exact fraction, and the difference is the 0.3 and 0.6 points the
   * displayed contributions were short by.
   */
  adjustedWeight: number;
  /** `score × adjustedWeight` — what this dimension put into the composite. */
  contribution: number | null;
  /** `score × nominalWeight` — what the evidence DELIVERED out of 100. */
  deliveredPoints: number | null;
  /** True where the engine excluded the dimension rather than scoring it low. */
  excluded: boolean;
  /** The engine's own evidence sentence for a measured dimension. */
  evidence: string | null;
  /** Why an excluded dimension was excluded, in a client's terms. */
  exclusionReason: string | null;
  /** What would restore it, where the record names a remedy. */
  exclusionRemedy: string | null;
  /** The engine's named inputs. Technical record only — never a client column. */
  inputs: string[];
}

export interface ScoreAssessmentReading {
  dimensions: AssessmentDimension[];
  /** The nominal weight that was measured at all, 0–1. `coverage.weightCovered`. */
  measuredNominalWeight: number;
  /** How many of the five were scored. */
  dimensionsMeasured: number;
  totalDimensions: number;
  /** Σ contributions, unrounded. */
  compositeExact: number | null;
  /** The engine's composite — `compositeExact` rounded ONCE. */
  compositeScore: number | null;
  /** What the row stores as `totalScore`, for comparison. */
  storedTotal: number | null;
  /** Σ delivered points at nominal weight, unrounded. */
  deliveredPoints: number | null;
  /** The grade the composite alone gives. */
  uncappedGrade: string | null;
  /**
   * The grade the DELIVERED points support. The engine also applies a growth
   * ceiling this reading cannot reconstruct, so the issued grade may be lower
   * than this and never higher.
   */
  nominalCeiling: string | null;
  /** The grade on the record. */
  issuedGrade: string | null;
  /** True where the issued grade is below the uncapped one. */
  capped: boolean;
  /** Reasons the row records for a withheld or capped grade. */
  capReasons: string[];
  /**
   * `evidenceCoverage` where the row retained it, else null — NOT
   * `measuredNominalWeight`, which is a different and coarser measure.
   */
  evidenceCoverage: number | null;
  /** Named so a reader knows the difference between absent and not measured. */
  notRetained: string[];
}

const rec = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null =>
  (typeof v === 'string' && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(text).filter((x): x is string => x !== null) : []);

/**
 * A dimension's exclusion, in terms that are TRUE of the records that carry it.
 *
 * The engine writes `breakdown.locationScore.details` as **"No location inputs
 * could be measured for this property"**, and that sentence is false about
 * every record in this deployment. Measured on the nine stored reports that
 * carry an RF-7.2B acquisition stamp (18 Sep 2026): all nine record
 * `places: complete` and `commute: measured`, six amenity categories answered
 * by the register, a matched address and a subject key — and all nine carry no
 * `walkScore`, no `commute` and no `schools.schoolsWithin3km`. The readings
 * were taken. The Client-Safe Gate then removed exactly those three paths
 * before the object was persisted, the stamp survived the removal untouched,
 * and every resume re-served the stripped copy to the scorer. So the record
 * says the measurement happened and holds nothing left to verify.
 *
 * That is fixed at the cause — the generator keeps the measured enrichment
 * back from the gate, and `assessEnrichmentReuse` refuses an object whose
 * stages ran but whose readings are gone — and the repair reaches a stored
 * report only when it is next generated. Until then the honest sentence is
 * about the RECORD, never about the area: a reader told "no location inputs
 * could be measured" concludes something about Kellyville.
 *
 * Used only as a fallback. Where the row carries its own `notAssessed[key]`
 * that wording wins, because it is the engine's considered client sentence
 * ("Not assessed — the available location information does not meet the
 * current verification standard") rather than the internal one.
 */
const EXCLUSION_REASON: Partial<Record<DimensionKey, string>> = {
  location: 'Location readings were taken for this property and this record no longer carries them in a form '
    + 'this assessment could verify, so the dimension was not scored. It is not a reading about the area.',
  risk: 'No property-specific risk measurement was available when this assessment was made, so there was nothing '
    + 'to score. It is not a low risk reading.',
};

/** The remedy the row records for a dimension, where it records one. */
function remedyFor(gaps: unknown, key: DimensionKey): string | null {
  if (!Array.isArray(gaps)) return null;
  for (const g of gaps) {
    const o = rec(g);
    if (o && text(o.dimension) === key) return text(o.remedy);
  }
  return null;
}

export function readScoreAssessment(storedScore: unknown): ScoreAssessmentReading {
  const s = rec(storedScore) ?? {};
  const breakdown = rec(s.breakdown) ?? {};
  const coverage = rec(s.coverage) ?? {};
  const notAssessed = rec(s.notAssessed) ?? {};
  const assessment = rec(s.assessment);
  // Where the engine ACTUALLY writes its own coverage figure.
  //
  // `PersistedAssessment` below describes an `assessment` block, and nothing in
  // this repository writes one — measured 18 September 2026, `investment_score`
  // carries an `assessment.evidenceCoverage` on **0 of 19** stamped rows and a
  // `v2.evidenceCoverage` on **9**. So the read below always missed, always
  // pushed "this record does not retain it" into `notRetained`, and the
  // Evidence coverage sentence `strategyPositions` guards on
  // (`a.evidenceCoverage !== null`) has never printed on any report — including
  // the nine rows that do retain the figure, under the other key.
  //
  // `assessment` is preferred so a future writer of that block wins; `v2` is
  // where the value lives today. `assessmentReadings.pure.ts` already read the
  // `v2` path, which is how the same record came to be read two ways.
  const v2 = rec(s.v2);

  const raw = DIMENSIONS.map(({ field, key, label }) => {
    const d = rec(breakdown[field]);
    const excluded = !d || d.excluded === true || d.hasData === false;
    return {
      key, label,
      score: excluded ? null : num(d?.score),
      excluded,
      evidence: excluded ? null : text(d?.details),
      // The record's own client sentence first, then the corrected fallback.
      // NEVER `d.details` for an excluded dimension: that is the engine's
      // internal "could not be measured", which this deployment's own
      // evidence contradicts. See EXCLUSION_REASON.
      exclusionReason: excluded
        ? (text(notAssessed[key]) ?? EXCLUSION_REASON[key] ?? null)
        : null,
      exclusionRemedy: excluded ? remedyFor(s.gradeGaps, key) : null,
      inputs: strings(d?.dataPoints),
      nominalWeight: COMPOSITE_WEIGHTS[key],
    };
  });

  const measured = raw.filter((d) => d.score !== null);
  const measuredNominalWeight = measured.reduce((t, d) => t + d.nominalWeight, 0);

  const dimensions: AssessmentDimension[] = raw.map((d) => {
    const adjustedWeight = d.score === null || measuredNominalWeight === 0
      ? 0
      : d.nominalWeight / measuredNominalWeight;
    return {
      ...d,
      adjustedWeight,
      contribution: d.score === null ? null : d.score * adjustedWeight,
      deliveredPoints: d.score === null ? null : d.score * d.nominalWeight,
    };
  });

  const anyMeasured = measured.length > 0;
  const compositeExact = anyMeasured
    ? dimensions.reduce((t, d) => t + (d.contribution ?? 0), 0)
    : null;
  const deliveredPoints = anyMeasured
    ? dimensions.reduce((t, d) => t + (d.deliveredPoints ?? 0), 0)
    : null;
  // Rounded ONCE, on the sum — which is what the engine does and what the
  // per-part rounding got wrong.
  const compositeScore = compositeExact === null ? null : Math.round(compositeExact);
  const issuedGrade = text(s.grade);
  const uncappedGrade = compositeScore === null ? null : gradeFor(compositeScore);
  const nominalCeiling = deliveredPoints === null ? null : gradeFor(deliveredPoints);

  const order = GRADE_THRESHOLDS.map(([, g]) => g).slice().reverse();
  const capped = Boolean(
    issuedGrade && uncappedGrade && order.indexOf(issuedGrade) < order.indexOf(uncappedGrade),
  );

  const notRetained: string[] = [];
  const evidenceCoverage = num(assessment?.evidenceCoverage) ?? num(v2?.evidenceCoverage);
  if (evidenceCoverage === null) {
    notRetained.push(
      'Evidence coverage — the share of the method that actually ran, counting a dimension scored on part of its '
      + 'own inputs as part of a dimension. This record does not retain it. The share of the method that was '
      + 'measured at all is stated instead, and it is a coarser figure.',
    );
  }
  notRetained.push(
    'The growth eligibility ceiling — whether the growth evidence was strong enough to carry an A or A+ — is not '
    + 'retained on this record. The ceiling this assessment states is the one the delivered points support; where '
    + 'the two differ the stricter binds, so the issued grade may be lower than it and never higher.',
  );

  return {
    dimensions,
    measuredNominalWeight: num(coverage.weightCovered) ?? measuredNominalWeight,
    dimensionsMeasured: num(coverage.dimensionsScored) ?? measured.length,
    totalDimensions: num(coverage.totalDimensions) ?? DIMENSIONS.length,
    compositeExact,
    compositeScore,
    storedTotal: num(s.totalScore),
    deliveredPoints,
    uncappedGrade,
    nominalCeiling,
    issuedGrade,
    capped,
    capReasons: Array.isArray(s.gradeGaps)
      ? (s.gradeGaps as unknown[]).flatMap((g) => {
        const o = rec(g);
        const reason = o ? (text(o.reason) ?? text(o.remedy)) : text(g);
        return reason ? [reason] : [];
      })
      : [],
    evidenceCoverage,
    notRetained,
  };
}

/**
 * What the engine should persist so none of this needs reconstructing.
 *
 * Additive, forward-only: a row written before this carries no `assessment`
 * key, `readScoreAssessment` reconstructs what it can and names what it
 * cannot, and no stored row is rewritten.
 */
export interface PersistedAssessment {
  /** Σ(nominal weight × that dimension's own methodology coverage), 0–1. */
  evidenceCoverage: number;
  /** Σ(score × nominal weight) over the full 100. */
  nominalMeasuredScore: number;
  /** The renormalised composite, rounded once. */
  compositeScore: number | null;
  /** The grade the composite alone gives. */
  uncappedGrade: string | null;
  /** The highest grade the evidence supports, after BOTH ceilings. */
  ceiling: string | null;
  capped: boolean;
  capReasons: readonly string[];
  eligibilityVersion: string;
}

/** Two figures to the precision the engine itself uses. */
export function assessmentPrecisionNote(reading: ScoreAssessmentReading): string | null {
  if (reading.compositeExact === null || reading.compositeScore === null) return null;
  return `The composite is rounded once, on the sum: ${reading.compositeExact.toFixed(2)} → `
    + `${reading.compositeScore}. Rounding each contribution first and adding them gives a different answer, and `
    + 'the adjusted weights printed as whole percentages are themselves rounded — the engine multiplies by the '
    + 'exact fractions.';
}
