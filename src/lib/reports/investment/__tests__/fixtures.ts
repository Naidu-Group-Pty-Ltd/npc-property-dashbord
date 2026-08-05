/**
 * An investment report row, of the shape the corpus actually holds.
 *
 * This format is the largest in the programme — a 36-section prose skeleton
 * with up to sixteen infographics attached to it by section number — and until
 * this file existed it was the only one of the ten with no fixture at all. Its
 * archetype's page band was pinned from ad-hoc renders during the migration and
 * then nothing in the repo could reproduce them, which meant five chart
 * primitives (`renderScoreWheel`, `renderMicroMap`, `renderSeriesFan`,
 * `renderTiles`, `renderNamedChart`) existed for a document nothing constructed.
 *
 * Everything here is fictional. The *shapes* are taken from the record —
 * `payload.pure.ts` documents the column-by-column counts they were measured
 * from — because a fixture that does not match the payload's real branch
 * structure tests the fixture rather than the format.
 *
 * Two facts about the corpus decide what the variants below are for:
 *
 * - **Only 15% of rows carry any financial modelling.** `withoutFinancials()`
 *   is therefore the *ordinary* report, not the degenerate one, and the
 *   document has to say so on the page rather than printing an empty axis.
 * - **Every score ever recorded falls between 38 and 68**, and 979 of 1,176
 *   rows have one at all. `withoutScore()` is the other common shortfall.
 */

/** Fixed instants. Nothing in this programme has a clock. */
export const PREPARED_ON = '2026-08-02T00:00:00.000Z';
export const GENERATED_AT = '2026-07-28T04:15:00.000Z';

export const REPORT_ID = '7f3c1d2e-9a4b-4c1e-8f6a-2b5d9e0c7a41';
export const ADDRESS = '18 Marlowe Parade, Kirribeck NSW 2287';

/** One paragraph of body prose, long enough to set a measure and wrap. */
const para = (seed: number): string => {
  const clauses = [
    'the catchment has absorbed new stock without a measurable rise in days on market',
    'rents cleared the suburb median at each of the last four renewals',
    'the vacancy rate has held under one per cent for six consecutive quarters',
    'approvals lodged in the twelve months to June are down on the prior year',
    'the two nearest comparable sales settled above the guide',
    'infrastructure funded in the last state budget lands inside the five-year horizon',
  ];
  const picked = [0, 1, 2].map((i) => clauses[(seed + i) % clauses.length]);
  return `On the evidence available, ${picked[0]}. That matters here because ${picked[1]}, `
    + `and the same records show ${picked[2]}. None of this is a forecast; it is what the `
    + 'sources listed at the back of this report contained on the date it was generated.';
};

/** The 36-section prose skeleton, as the model writes it. */
const SECTION_TITLES: ReadonlyArray<[number, string]> = [
  [1, 'Location Overview'],
  [2, 'Suburb Profile'],
  [3, 'Historical Price Growth'],
  [4, 'Historical Rent Growth'],
  [5, 'Current Market Performance'],
  [6, 'Demographics'],
  [7, 'Employment & Industry'],
  [8, 'Transport & Access'],
  [9, 'Schools & Education'],
  [10, 'Healthcare'],
  [11, 'Retail & Lifestyle'],
  [12, 'Amenity Summary'],
  [13, 'Planning & Zoning'],
  [14, 'Development Pipeline'],
  [15, 'Supply & Demand'],
  [16, 'Rental Market'],
  [17, 'Owner-Occupier Market'],
  [18, 'Comparable Sales'],
  [19, 'Economic Context'],
  [20, 'Base Assumptions'],
  [21, 'Yield Calculations'],
  [22, 'Annual Holding Costs'],
  [23, 'Loan Structure'],
  [24, 'Sensitivity Analysis'],
  [25, 'Property Value Projections'],
  [26, 'Rental Income Projections'],
  [27, 'Cumulative Cashflow Projections ($)'],
  [28, 'Loan-to-Value Over Time'],
  [29, 'Investment Score'],
  [30, 'Score Breakdown'],
  [31, 'Strengths, Weaknesses, Opportunities & Risks'],
  [32, 'Risk Register'],
  [33, 'Exit Considerations'],
  [34, 'Tax & Structuring Notes'],
  [35, 'Recommended Next Steps'],
  [36, 'Demographic & Economic Data'],
];

/**
 * The prose column.
 *
 * Carries the two furniture blocks the document prints itself — 761 rows in the
 * corpus do — so `stripFurniture` has something real to remove and the closing
 * page cannot end up printed twice.
 */
export function reportContent(sections = SECTION_TITLES.length): string {
  const body = SECTION_TITLES.slice(0, sections).map(([n, title]) => {
    const extra = n === 21 || n === 31 || n === 35
      ? `\n\n- ${para(n + 1).slice(0, 90)}\n- ${para(n + 2).slice(0, 90)}\n- ${para(n + 3).slice(0, 90)}`
      : '';
    const table = n === 18
      ? '\n\n| Address | Sold | Price |\n| --- | --- | ---: |\n'
        + '| 4 Marlowe Parade | Mar 2026 | $902,000 |\n'
        + '| 21 Cardigan Street | Feb 2026 | $874,500 |\n'
        + '| 9 Marlowe Parade | Dec 2025 | $918,000 |'
      : '';
    return `# ${n}. ${title}\n\n${para(n)}\n\n${para(n + 3)}${extra}${table}`;
  }).join('\n\n');

  return `# REPORT TITLE\n\nInvestment Location & Property Fit — ${ADDRESS}\n\n${body}\n\n`
    + '## ⚖️ PROFESSIONAL DISCLAIMER\n\nThis document is general information only and does '
    + 'not constitute personal advice. It must be read with the disclosures at the back.\n\n'
    + '## 📞 CONTACT US\n\nCall the office on 00 0000 0000 or reply to the email this '
    + 'report arrived with.\n';
}

const SOURCES = [
  'Australian Bureau of Statistics — Census of Population and Housing, 2021',
  'Australian Bureau of Statistics — Building Approvals, monthly series',
  'Reserve Bank of Australia — Statement on Monetary Policy, May 2026',
  'NSW Valuer General — Land Value Summary, 2026',
  'Kirribeck City Council — Local Environmental Plan, consolidated 2025',
  'Transport for NSW — Patronage by station, quarterly release',
  'Department of Education — School enrolment and catchment data, 2026',
  'CoreLogic — Suburb median and days-on-market series, June 2026',
];

/** `sources_content` is a text column, one source per line, in the corpus. */
export const sourcesContent = SOURCES.map((s, i) => `${i + 1}. ${s}`).join('\n');

const PROPERTY_SPECS = {
  property_type: 'House',
  bedrooms: 4,
  bathrooms: 2,
  parking: 2,
  land_size_sqm: 612,
  building_size_sqm: 198,
  year_built: 2004,
  zoning: 'R2 Low Density',
  council_area: 'Kirribeck City Council',
};

/** Inside the observed 38-68 band. A score outside it would be fiction. */
const INVESTMENT_SCORE = {
  totalScore: 61,
  grade: 'C+',
  recommendation:
    'Suitable as a yield holding for an investor with a five-to-seven year horizon and '
    + 'the capacity to absorb a rate rise of one per cent without refinancing.',
  breakdown: {
    locationScore: 68,
    yieldScore: 57,
    growthScore: 62,
    demandScore: 71,
    riskScore: 49,
  },
  strengths: [
    'Vacancy under one per cent across six quarters.',
    'Four-bedroom stock is under-supplied in the catchment.',
    'Two primary schools and one high school inside the catchment.',
    'Rail access within nine hundred metres.',
  ],
  weaknesses: [
    'Land value has outrun rent for three consecutive years.',
    'The building is twenty-two years old and has not been renovated.',
    'Insurance has risen at each of the last three renewals.',
  ],
  opportunities: [
    'A dual-occupancy application is permissible under the current LEP.',
    'The station upgrade is funded and scheduled inside the horizon.',
    'A cosmetic renovation would lift rent to the top of the range.',
  ],
  risks: [
    'A further rate rise would move this holding to negative cash flow.',
    'Two hundred and forty dwellings are approved within two kilometres.',
    'The catchment is exposed to a single major employer.',
  ],
};

const LOCATION_INTELLIGENCE = {
  walkScore: 63,
  coordinates: { lat: -32.9241, lng: 151.7008 },
  schools: { schoolsWithin3km: 7 },
  transport: { stopsWithin1km: 12, score: 74 },
  healthcare: { facilitiesWithin5km: 9, score: 68 },
  lifestyle: { venuesWithin2km: 31, score: 71 },
  amenities: [
    ...Array.from({ length: 6 }, () => ({ type: 'Cafe' })),
    ...Array.from({ length: 4 }, () => ({ type: 'Supermarket' })),
    ...Array.from({ length: 3 }, () => ({ type: 'Park' })),
    ...Array.from({ length: 2 }, () => ({ type: 'Gym' })),
  ],
};

const DEMOGRAPHICS = {
  population: { total: 18_420, growth: 1.8, density: 1_240 },
  income: { medianAge: 36, medianHouseholdIncome: 98_600, unemploymentRate: 4.1 },
  housing: { medianRent: 640, ownerOccupierRate: 58.2, renterRate: 38.4, housingStress: 12.7 },
};

const ECONOMIC_DATA = {
  cashRate: 3.85,
  inflation: 2.9,
  indicators: {
    gdpGrowth: 2.1,
    unemploymentRate: 4.3,
    participationRate: 66.8,
    creditGrowth: 5.2,
    housePriceGrowth: 4.6,
  },
};

/** Ten years of one scenario. */
const series = (growth: number, rentGrowth: number, base: number) =>
  Array.from({ length: 10 }, (_, i) => ({
    year: i + 1,
    propertyValue: Math.round(890_000 * (1 + growth) ** (i + 1)),
    annualRent: Math.round(33_280 * (1 + rentGrowth) ** (i + 1)),
    cumulativeCashFlow: Math.round(base * (i + 1) + 320 * (i + 1) ** 2),
  }));

export const PROJECTIONS = {
  conservative: series(0.025, 0.02, -6_400),
  moderate: series(0.045, 0.03, -4_100),
  optimistic: series(0.065, 0.04, -1_800),
};

const FINANCIAL_CALCULATIONS = {
  keyMetrics: {
    grossRentalYield: 3.74,
    netRentalYield: 2.41,
    cashOnCashReturn: -2.9,
    lvr: 80,
    totalInvestment: 231_400,
    annualNet: -6_720,
    weeklyNet: -129,
  },
  loanDetails: { loanAmount: 712_000, interestRate: 6.15, monthlyPayment: 4_337, lvr: 80 },
  income: { annualRent: 33_280 },
  annualCosts: {
    councilRates: 2_480,
    waterRates: 1_140,
    landlordInsurance: 1_980,
    propertyManagement: 2_330,
    maintenance: 2_670,
    strataFees: 0,
    landTax: 1_620,
    lettingFees: 640,
  },
  sensitivityAnalysis: {
    interestRateChanges: {
      minus1Percent: 400,
      plus1Percent: -13_840,
      plus2Percent: -20_960,
    },
    rentChanges: {
      minus10Percent: -10_048,
      plus5Percent: -5_056,
      plus10Percent: -3_392,
    },
  },
  projections: PROJECTIONS,
};

export interface RowOverrides {
  [key: string]: unknown;
}

/**
 * The complete row: prose, every structured column, and a financial model.
 *
 * This is the 15% case, and the one that exercises every chart. It is the
 * fixture that gets rendered and looked at.
 */
export function reportRow(over: RowOverrides = {}): Record<string, unknown> {
  return {
    id: REPORT_ID,
    status: 'completed',
    property_address: ADDRESS,
    report_content: reportContent(),
    sources_content: sourcesContent,
    report_scope: 'full',
    report_tier: 'premium',
    report_variant: 'standard',
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
    property_specs: PROPERTY_SPECS,
    investment_score: INVESTMENT_SCORE,
    location_intelligence: LOCATION_INTELLIGENCE,
    demographics_data: DEMOGRAPHICS,
    economic_data: ECONOMIC_DATA,
    financial_calculations: FINANCIAL_CALCULATIONS,
    ...over,
  };
}

/** The ordinary report: 85% of the corpus carries no financial model. */
export const withoutFinancials = (over: RowOverrides = {}) =>
  reportRow({ financial_calculations: null, ...over });

/** 197 rows were never scored. */
export const withoutScore = (over: RowOverrides = {}) =>
  reportRow({ investment_score: null, ...over });

/** A location-only report: no prose past the locality work, and no money. */
export const locationOnly = (over: RowOverrides = {}) =>
  reportRow({
    report_scope: 'location_only',
    report_content: reportContent(12),
    financial_calculations: null,
    ...over,
  });

/** The smallest thing this format will still typeset. */
export const minimal = (over: RowOverrides = {}) => ({
  id: REPORT_ID,
  status: 'completed',
  property_address: ADDRESS,
  report_content: `# 1. Location Overview\n\n${para(1)}\n\n${para(4)}`,
  created_at: GENERATED_AT,
  property_specs: PROPERTY_SPECS,
  ...over,
});
