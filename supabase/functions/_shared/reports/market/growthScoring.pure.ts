/**
 * ME-3 — the deterministic Capital Growth methodology.
 *
 * Reads {@link MarketEvidence} and nothing else. No provider names, no HTTP, no
 * model. Given the same evidence it returns the same score, and every component
 * of that score can be shown to a client beside the number it came from.
 *
 * ## What this exists to fix
 *
 * V1 pinned Growth at a placeholder 50 on 975 of 992 reports (§46). The ABS
 * backtest then showed that simply feeding it *regional* growth is not the
 * answer either: growth is 40% of the composite and every property in a state
 * receives the identical regional figure, so the within-state spread was 9-25
 * points against a 55-point between-state swing — the median Perth property
 * became an A+ and no Sydney property could reach A (§48).
 *
 * So a Growth score has to answer two questions, not one:
 *
 *   1. **How strongly has this suburb and dwelling type actually performed?**
 *   2. **How does that compare with the wider market it sits in?**
 *
 * The second is what stops "Perth is strong, therefore every Perth property is
 * exceptional", and equally what lets an outstanding Sydney suburb score highly
 * while NSW as a whole is flat.
 *
 * ## The five components
 *
 * | component | weight | why |
 * | --- | ---: | --- |
 * | long-term (5yr CAGR) | 0.35 | the most authoritative single reading |
 * | medium-term (3yr CAGR) | 0.25 | confirms the long run is not one old spike |
 * | momentum (1yr) | 0.10 | deliberately small — one strong year must not dominate |
 * | consistency | 0.15 | +20/−10/flat is not the same as steady compounding |
 * | relative to benchmark | 0.15 | the suburb's performance net of its market |
 *
 * Weights are renormalised across the components that could actually be
 * computed. That is arithmetic, not judgement, and it is precisely why
 * {@link scoreGrowth} returns a **confidence** alongside the score: thin
 * evidence renormalised to 100% is still thin evidence, and the eligibility
 * rule — not the score — is what refuses it an A+.
 *
 * ## Three rules
 *
 * **Missing is missing.** A component with no evidence is excluded, never
 * scored 0 and never scored 50. The one place 50 appears is
 * {@link scoreRelative} at a spread of exactly zero — and there it is a
 * *measurement*, meaning "performed precisely in line with its benchmark",
 * which is a real finding rather than an absent one.
 *
 * **A benchmark is context, never the score.** The relative component carries
 * 0.15. A property cannot ride its region to a high Growth score, because the
 * other 0.85 is the suburb's own measured performance.
 *
 * **Longer horizons outrank shorter ones.** 5yr and 3yr together carry 0.60
 * against momentum's 0.10, so a single exceptional twelve months moves the
 * score by a few points rather than transforming it.
 */

import {
  type EvidencePoint,
  type MarketEvidence,
  levelRank,
  licensingOf,
} from './marketEvidence.pure.ts';

/** Bumped whenever a weight, anchor or rule changes. Persisted with the score. */
export const GROWTH_METHODOLOGY_VERSION = '3.0.0';

export const GROWTH_WEIGHTS = {
  longTerm: 0.35,
  mediumTerm: 0.25,
  momentum: 0.10,
  consistency: 0.15,
  relative: 0.15,
} as const;

export type GrowthComponentKey = keyof typeof GROWTH_WEIGHTS;

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Piecewise-linear interpolation over `[input, score]` anchors.
 *
 * Anchors rather than bands, because a band puts a cliff between 5.99% and
 * 6.00% growth that no property owner could be shown a reason for.
 */
export function interpolate(value: number, anchors: ReadonlyArray<readonly [number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x1, y1] = anchors[i - 1];
    const [x2, y2] = anchors[i];
    if (value <= x2) return y1 + ((value - x1) / (x2 - x1)) * (y2 - y1);
  }
  return last[1];
}

/**
 * Compound annual growth, in per cent per annum.
 *
 * Measured against the ABS `RES_DWELL` series on 2026-09-08: across the fifteen
 * Australian regions the ten-year house figure spans 0.55% to 9.47% p.a. and
 * the five-year
 * −0.44% to 13.52%. The anchors below are set against that observed range, so
 * 6% p.a. is a genuinely good long-run result rather than a generous one, and
 * 100 needs sustained double-digit compounding.
 */
export const LONG_TERM_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-4, 0], [-1, 8], [0, 15], [2, 30], [4, 48], [6, 65], [8, 79], [10, 89], [13, 96], [16, 100],
];

/** Three-year CAGR. Slightly more forgiving: a shorter window is noisier. */
export const MEDIUM_TERM_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-6, 0], [-2, 10], [0, 18], [3, 35], [6, 55], [9, 72], [12, 85], [16, 95], [20, 100],
];

/** One year. Wide, because a single year swings hard in both directions. */
export const MOMENTUM_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-10, 0], [-4, 12], [0, 25], [3, 42], [6, 58], [10, 74], [15, 88], [22, 100],
];

/**
 * Performance relative to the wider market, in percentage points per annum.
 *
 * Zero scores 50 and that is a MEASUREMENT: it says the suburb tracked its
 * benchmark exactly. Everywhere else in this programme a 50 is a placeholder
 * to be removed; here it is the honest reading of a real comparison, which is
 * why it is stated rather than avoided.
 */
export const RELATIVE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-6, 0], [-4, 10], [-2, 28], [0, 50], [2, 70], [4, 85], [6, 94], [9, 100],
];

export interface GrowthComponent {
  key: GrowthComponentKey;
  /** 0-100 for this component alone. */
  score: number;
  /** The measurement it was computed from, in its own units. */
  input: number;
  unit: 'percent_per_annum' | 'percent' | 'ratio';
  /** Human sentence a report can print verbatim. */
  detail: string;
  /** Where the measurement came from, for the evidence trail. */
  evidence: EvidencePoint<unknown> | null;
}

/** Score the five-year compound annual rate. */
export function scoreLongTerm(ev: MarketEvidence): GrowthComponent | null {
  const p = ev.growth5YearCagr;
  if (!p) return null;
  return {
    key: 'longTerm',
    score: clamp(interpolate(p.value, LONG_TERM_ANCHORS)),
    input: p.value,
    unit: 'percent_per_annum',
    detail: `${p.value.toFixed(1)}% per annum over five years`,
    evidence: p,
  };
}

/** Score the three-year compound annual rate. */
export function scoreMediumTerm(ev: MarketEvidence): GrowthComponent | null {
  const p = ev.growth3YearCagr;
  if (!p) return null;
  return {
    key: 'mediumTerm',
    score: clamp(interpolate(p.value, MEDIUM_TERM_ANCHORS)),
    input: p.value,
    unit: 'percent_per_annum',
    detail: `${p.value.toFixed(1)}% per annum over three years`,
    evidence: p,
  };
}

/** Score the most recent twelve months. Deliberately the smallest weight. */
export function scoreMomentum(ev: MarketEvidence): GrowthComponent | null {
  const p = ev.growth1Year;
  if (!p) return null;
  return {
    key: 'momentum',
    score: clamp(interpolate(p.value, MOMENTUM_ANCHORS)),
    input: p.value,
    unit: 'percent',
    detail: `${p.value.toFixed(1)}% over the last twelve months`,
    evidence: p,
  };
}

/**
 * Reward sustained performance and penalise a sawtooth.
 *
 * Computed from the stored price series rather than from the CAGRs, because a
 * CAGR is blind to the path: +20% then −10% then flat compounds to roughly the
 * same place as three steady years, and they are not the same investment.
 *
 * Two halves, equally weighted: the share of periods that rose, and a
 * volatility term that falls as the spread of period returns widens. Needs at
 * least three period-over-period changes to mean anything.
 */
export function scoreConsistency(ev: MarketEvidence): GrowthComponent | null {
  const series = ev.priceSeries?.value;
  if (!series || series.length < 4) return null;

  const returns: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1].value;
    if (prev > 0) returns.push((series[i].value / prev - 1) * 100);
  }
  if (returns.length < 3) return null;

  const positiveShare = returns.filter((r) => r > 0).length / returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);

  // A steady series has a small spread relative to its own step size. 0 points
  // of deviation is perfect; 8 points a period is thoroughly erratic.
  const steadiness = clamp(100 - (stdev / 8) * 100);
  const score = clamp(positiveShare * 100 * 0.5 + steadiness * 0.5);

  return {
    key: 'consistency',
    score,
    input: positiveShare,
    unit: 'ratio',
    detail:
      `${returns.filter((r) => r > 0).length} of ${returns.length} periods rose, ` +
      `period-to-period spread ${stdev.toFixed(1)} points`,
    evidence: ev.priceSeries ?? null,
  };
}

/**
 * How far the subject out- or under-performed its benchmark, per annum.
 *
 * Prefers the horizon both sides can supply, longest first — comparing a
 * five-year subject figure with a one-year benchmark would measure the
 * calendar rather than the suburb.
 */
export function scoreRelative(ev: MarketEvidence): GrowthComponent | null {
  const pairs: ReadonlyArray<readonly [EvidencePoint | undefined, EvidencePoint | undefined, string]> = [
    [ev.growth5YearCagr, ev.benchmarkGrowth5YearCagr, 'five-year'],
    [ev.growth3YearCagr, ev.benchmarkGrowth3YearCagr, 'three-year'],
    [ev.growth1Year, ev.benchmarkGrowth1Year, 'twelve-month'],
  ];
  for (const [subject, benchmark, horizon] of pairs) {
    if (!subject || !benchmark) continue;
    const spread = subject.value - benchmark.value;
    return {
      key: 'relative',
      score: clamp(interpolate(spread, RELATIVE_ANCHORS)),
      input: spread,
      unit: 'percent_per_annum',
      detail:
        `${spread >= 0 ? '+' : ''}${spread.toFixed(1)} points against ${benchmark.areaName} ` +
        `over the ${horizon} window`,
      evidence: benchmark,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Evidence confidence — a separate question from performance
// ---------------------------------------------------------------------------

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface GrowthConfidence {
  /** 0-100. */
  score: number;
  band: ConfidenceBand;
  /** Every factor, so a report can say why confidence is what it is. */
  factors: ReadonlyArray<{ key: string; score: number; weight: number; detail: string }>;
}

export const CONFIDENCE_WEIGHTS = {
  geography: 0.30,
  dwellingType: 0.20,
  sample: 0.20,
  history: 0.20,
  freshness: 0.10,
} as const;

/** Quarters since `asOf`, or null when the period cannot be parsed. */
export function quartersSince(asOf: string, now: Date): number | null {
  const q = /^(\d{4})-Q([1-4])$/.exec(asOf);
  if (q) {
    const year = Number(q[1]);
    const quarter = Number(q[2]);
    const nowQ = Math.floor(now.getUTCMonth() / 3) + 1;
    return (now.getUTCFullYear() - year) * 4 + (nowQ - quarter);
  }
  const d = Date.parse(asOf);
  if (Number.isNaN(d)) return null;
  return Math.floor((now.getTime() - d) / (1000 * 60 * 60 * 24 * 91.31));
}

/**
 * How much the Growth score can be relied upon.
 *
 * Deliberately separate from the score. A suburb can have genuinely excellent
 * measured performance on eleven sales and four quarters of history: the
 * performance is real and the confidence is not, and collapsing the two into
 * one number destroys exactly the distinction a client challenge turns on.
 */
export function growthConfidence(
  ev: MarketEvidence,
  components: ReadonlyArray<GrowthComponent>,
  now: Date = new Date(),
): GrowthConfidence {
  const points = components.map((c) => c.evidence).filter((p): p is EvidencePoint<unknown> => p !== null);
  const factors: Array<{ key: string; score: number; weight: number; detail: string }> = [];

  // Geography — suburb is what the score claims to be about.
  const finest = points.length
    ? points.reduce((best, p) => (levelRank(p.level) < levelRank(best.level) ? p : best))
    : null;
  const geoScore = !finest
    ? 0
    : finest.level === 'property' || finest.level === 'suburb'
      ? 100
      : finest.level === 'postcode'
        ? 80
        : finest.level === 'lga' || finest.level === 'sa3'
          ? 55
          : finest.level === 'gccsa'
            ? 25
            : 10;
  factors.push({
    key: 'geography', score: geoScore, weight: CONFIDENCE_WEIGHTS.geography,
    detail: finest ? `finest evidence at ${finest.level} level (${finest.areaName})` : 'no evidence',
  });

  // Dwelling type — a house scored on all-dwellings data is a weaker claim.
  const matched = points.filter((p) => p.dwellingTypeMatched).length;
  const dwellingScore = points.length ? (matched / points.length) * 100 : 0;
  factors.push({
    key: 'dwellingType', score: dwellingScore, weight: CONFIDENCE_WEIGHTS.dwellingType,
    detail: `${matched} of ${points.length} measures matched the dwelling type`,
  });

  // Sample — transactions behind the medians.
  const samples = points.map((p) => p.sampleSize).filter((n): n is number => typeof n === 'number');
  const bestSample = samples.length ? Math.max(...samples) : null;
  const sampleScore = bestSample === null
    ? 30 // unstated is not zero: many publishers simply do not print a count.
    : clamp(interpolate(bestSample, [[0, 0], [10, 25], [25, 50], [60, 75], [120, 90], [250, 100]]));
  factors.push({
    key: 'sample', score: sampleScore, weight: CONFIDENCE_WEIGHTS.sample,
    detail: bestSample === null ? 'transaction count not published' : `${bestSample} transactions`,
  });

  // History — how many periods, and how many horizons were computable.
  const periods = Math.max(
    ev.priceSeries?.value.length ?? 0,
    ...points.map((p) => p.periodsAvailable ?? 0),
  );
  const horizons = [ev.growth1Year, ev.growth3YearCagr, ev.growth5YearCagr].filter(Boolean).length;
  const historyScore = clamp(
    interpolate(periods, [[0, 0], [4, 25], [8, 45], [12, 65], [20, 85], [40, 100]]) * 0.6
      + (horizons / 3) * 100 * 0.4,
  );
  factors.push({
    key: 'history', score: historyScore, weight: CONFIDENCE_WEIGHTS.history,
    detail: `${periods} periods, ${horizons} of 3 growth horizons computable`,
  });

  // Freshness — the period the SOURCE describes, never when it was fetched.
  const ages = points.map((p) => quartersSince(p.asOf, now)).filter((n): n is number => n !== null);
  const newest = ages.length ? Math.min(...ages) : null;
  const freshScore = newest === null
    ? 40
    : clamp(interpolate(newest, [[0, 100], [2, 90], [4, 70], [8, 40], [12, 15], [20, 0]]));
  factors.push({
    key: 'freshness', score: freshScore, weight: CONFIDENCE_WEIGHTS.freshness,
    detail: newest === null ? 'as-of date not parseable' : `newest evidence ${newest} quarter(s) old`,
  });

  const score = clamp(factors.reduce((sum, f) => sum + f.score * f.weight, 0));
  const band: ConfidenceBand = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { score: Math.round(score), band, factors };
}

// ---------------------------------------------------------------------------
// The Growth result
// ---------------------------------------------------------------------------

export interface GrowthResult {
  methodologyVersion: string;
  /** 0-100, or null when nothing could be computed. Never a placeholder. */
  score: number | null;
  confidence: GrowthConfidence;
  components: ReadonlyArray<GrowthComponent & { weight: number }>;
  /** Components that could not be computed, named so a report can say so. */
  missing: ReadonlyArray<GrowthComponentKey>;
  /** Share of the nominal weight that was actually measured. */
  weightCovered: number;
  /** True when no measure may be shown to a client (licensing). */
  renderRestricted: boolean;
}

/**
 * The deterministic Growth score.
 *
 * Returns `null` rather than a number when nothing could be measured — a
 * missing Growth score is a fact the report states, not a zero it prints.
 */
export function scoreGrowth(ev: MarketEvidence, now: Date = new Date()): GrowthResult {
  const built = [
    scoreLongTerm(ev),
    scoreMediumTerm(ev),
    scoreMomentum(ev),
    scoreConsistency(ev),
    scoreRelative(ev),
  ].filter((c): c is GrowthComponent => c !== null);

  const present = new Set(built.map((c) => c.key));
  const missing = (Object.keys(GROWTH_WEIGHTS) as GrowthComponentKey[]).filter((k) => !present.has(k));

  const weightCovered = built.reduce((s, c) => s + GROWTH_WEIGHTS[c.key], 0);
  const score = weightCovered > 0
    ? Math.round(built.reduce((s, c) => s + c.score * (GROWTH_WEIGHTS[c.key] / weightCovered), 0))
    : null;

  const points = built.map((c) => c.evidence).filter((p): p is EvidencePoint<unknown> => p !== null);
  const renderRestricted = points.length > 0
    && points.every((p) => licensingOf(p) === 'unverified' || licensingOf(p) === 'internal_only');

  return {
    methodologyVersion: GROWTH_METHODOLOGY_VERSION,
    score,
    confidence: growthConfidence(ev, built, now),
    components: built.map((c) => ({ ...c, weight: GROWTH_WEIGHTS[c.key] })),
    missing,
    weightCovered: Number(weightCovered.toFixed(3)),
    renderRestricted,
  };
}
