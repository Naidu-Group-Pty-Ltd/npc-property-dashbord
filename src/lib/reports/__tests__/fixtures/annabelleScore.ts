/**
 * The stored `investment_scores` object for 18 Annabelle Crescent, verbatim.
 *
 * Read from `investment_reports.investment_score` on report
 * `9bd41c05-7f9b-41e8-819a-a029f4121369` (production project
 * `dduzbchuswwbefdunfct`) on 18 September 2026, trimmed to the keys the
 * readers under test actually name and otherwise unaltered — the integer
 * `weight` values, the `excluded` flags, the engine's own `details` sentences
 * and the `notAssessed` wording are exactly as the row holds them.
 *
 * It is a fixture taken from a row rather than written in the readers'
 * vocabulary on purpose. `TEMPLATE_SELECTION.md` records what the alternative
 * costs: a sample written in the consumer's own terms passes while production
 * is empty, which is how two formats shipped a cover with no title on it.
 *
 * The numbers this record settles, and which the readers must reproduce:
 *
 *   - the stored `weight` 57 / 21 / 21 are the ADJUSTED weights as whole
 *     percentages, not the nominal .40 / .15 / .15;
 *   - contributions at the exact adjusted fractions are 32.00 + 4.93 + 2.79 =
 *     39.71, which rounds ONCE to the stored `totalScore` of 40 → grade C;
 *   - delivered points at the NOMINAL weights are 22.40 + 3.45 + 1.95 = 27.80,
 *     which supports F — the ceiling, and the grade actually issued.
 */
export const ANNABELLE_SCORE = {
  grade: 'F',
  totalScore: 40,
  coverage: {
    partialLabel: 'Partial score: 3 of 5 dimensions',
    cotalityReady: true,
    coverageRatio: 0.6,
    weightCovered: 0.7,
    totalDimensions: 5,
    dataInsufficient: false,
    dimensionsScored: 3,
  },
  breakdown: {
    growthScore: {
      score: 56,
      weight: 57,
      details: 'Five-year capital growth: 6.2% per annum over five years. Three-year against five-year '
        + 'trajectory: three-year rate 4.4% p.a. is 1.8 points behind the five-year rate of 6.2% p.a.. '
        + 'Twelve-month movement: 6.3% over the last twelve months. Consistency of growth: 3 of 3 periods rose, '
        + 'period-to-period spread 5.7 points. Performance against the wider market: -1.4 points against NSW '
        + '(all areas the publisher monitors) over the five-year window',
      hasData: true,
      excluded: false,
      dataPoints: ['longTerm', 'trajectory', 'momentum', 'consistency', 'relative'],
    },
    locationScore: {
      score: 0,
      weight: 0,
      details: 'No location inputs could be measured for this property.',
      hasData: false,
      excluded: true,
      dataPoints: [],
    },
    yieldScore: {
      score: 23,
      weight: 21,
      details: 'Gross yield (on purchase price): 2.97% gross yield on a $1,490,000 purchase price.',
      hasData: true,
      excluded: false,
      dataPoints: ['propertyPrice', 'weeklyRent'],
    },
    demandScore: {
      score: 13,
      weight: 21,
      details: 'Population growth: -0.4% annual population growth in Kellyville - East',
      hasData: true,
      excluded: false,
      dataPoints: ['populationDriver'],
    },
    riskScore: {
      score: 0,
      weight: 0,
      details: 'No property-specific risk measurement is available, so there is nothing to score.',
      hasData: false,
      excluded: true,
      dataPoints: [],
    },
  },
  notAssessed: {
    risk: 'Not assessed — insufficient verified property-risk evidence is available.',
    location: 'Not assessed — the available location information does not meet the current verification standard.',
  },
  gradeGaps: [
    {
      detail: 'No location readings (walk score, commute, schools) were presented for this run.',
      reason: 'Not assessed — the available location information does not meet the current verification standard.',
      remedy: 'Regenerate the report: the location service re-acquires the enrichment with its acquisition stamp '
        + '(RF-7.2B), and stamped, stage-proven readings verify automatically.',
      dimension: 'location',
      withholdsGrade: false,
    },
    {
      detail: 'No property-specific risk measurement is available, so there is nothing to score.',
      reason: 'Not assessed — insufficient verified property-risk evidence is available.',
      remedy: 'Answered property-risk questions from the per-class schema (hazard, planning, condition, strata).',
      dimension: 'risk',
      withholdsGrade: false,
    },
  ],
  v2: { authority: 'v2' },
} as const;
