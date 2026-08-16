/**
 * A label is a promise that a figure follows it — the Investment Compass half.
 *
 * `liveCashFlowLabels.spec.ts` is the same rule on the 10 Year Cash Flow. This
 * one covers the two defects a render of the stored report `1be16c4a`
 * (93 Bimbadeen Avenue, Banora Point, 15 Aug 2026) showed on the page:
 *
 *  - the property table printed **eight labels and one value**. Six of its rows
 *    were ruled, striped and empty. That is not one unlucky record: counted
 *    over the whole `investment_reports` table on 2026-08-16, `year_built`,
 *    `zoning` and `council_area` are null on **every one of the 1,187 rows**,
 *    and land and building size are null on every one of them too;
 *  - and the two dimensions a reader of a property report looks for first were
 *    *in the record all along*, one column over under different names —
 *    `financial_calculations.propertySpecs.landSizeSqm` and `buildSizeSqm`, on
 *    114 rows each. `projectInvestmentReport` read only `property_specs`, so
 *    `property.landArea` could not resolve on any report ever generated.
 *
 * The tests render the real masters against the real stored shape, because the
 * fixture is what hid this: `SAMPLE_REPORT_DATA` fills every one of these
 * fields, so a check against it passes while production prints blank rows.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { applyInvestmentProjection } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';

/**
 * The stored row, verbatim from production, trimmed to the columns this page
 * reads. `property_specs` carries all nine keys and eight nulls — which is why
 * nothing ever looked wrong from the code's side.
 */
const STORED = {
  id: '1be16c4a-d1c3-4833-9ae1-1352c937ce52',
  property_address: '93 Bimbadeen Avenue, Banora Point NSW 2486, Australia',
  updated_at: '2026-08-16T05:26:44.437715+00:00',
  created_at: '2026-08-15T16:17:47.004853+00:00',
  property_specs: {
    zoning: null,
    parking: null,
    bedrooms: null,
    bathrooms: null,
    year_built: null,
    council_area: null,
    land_size_sqm: null,
    property_type: 'Residential Property',
    building_size_sqm: null,
  },
  financial_calculations: {
    income: { annualRent: 67600, weeklyRent: 1300 },
    keyMetrics: { lvr: 80, annualNet: -36258, weeklyNet: -697, netRentalYield: 3.48, grossRentalYield: 4.83 },
    annualCosts: { councilRates: 2200, landlordInsurance: 2800, propertyManagement: 4732, maintenance: 2500 },
    assumptions: { cpiGrowth: 4, capitalGrowth: 10, occupancyWeeks: 50 },
    loanDetails: { loanAmount: 1120000, interestRate: 6.5, monthlyPayment: 7079.161863121212 },
    initialCosts: { deposit: 280000, stampDuty: 58287, legalFees: 1800, totalUpfront: 340287, propertyValue: 1400000, inspectionFees: 500 },
    // The spelling that exists. Not `building_size_sqm`, not `buildingSizeSqm`.
    propertySpecs: { landSizeSqm: 2131, buildSizeSqm: 161 },
    projections: {
      moderate: [
        { year: 1, equity: 348150 }, { year: 2, equity: 419330 }, { year: 3, equity: 493680 },
        { year: 4, equity: 571349 }, { year: 5, equity: 652491 }, { year: 6, equity: 737271 },
        { year: 7, equity: 825857 }, { year: 8, equity: 918430 }, { year: 9, equity: 1015178 },
        { year: 10, equity: 1116298 },
      ],
    },
  },
  investment_score: {
    grade: 'C+',
    totalScore: 56,
    risks: ['Significant negative cash flow requiring ongoing funding'],
    strengths: ['High walkability score enhancing liveability'],
    // Empty on 313 of the 1,187 stored reports.
    weaknesses: [],
    recommendation: 'HOLD - Above average investment with some positive indicators, monitor closely',
    breakdown: {
      riskScore: { score: 60, weight: 11, details: 'Moderate LVR (70-80%).', hasData: true, excluded: false },
      yieldScore: { score: 50, weight: 33, details: 'Good yield (4-5%)', hasData: true, excluded: false },
      demandScore: { score: 50, weight: 0, details: '', hasData: false, excluded: true },
      growthScore: { score: 50, weight: 0, details: '', hasData: false, excluded: true },
      locationScore: { score: 58, weight: 56, details: 'Excellent walkability (90+).', hasData: true, excluded: false },
    },
  },
  report_content: '## Executive Verdict\n\nHold, on the land component.\n',
} as const;

/** The same row as an intake that filled every field would have written it. */
const COMPLETE = {
  ...STORED,
  property_specs: {
    zoning: 'R2 Low Density Residential',
    parking: 2,
    bedrooms: 4,
    bathrooms: 2,
    year_built: 1998,
    council_area: 'Tweed Shire',
    land_size_sqm: 2131,
    property_type: 'House',
    building_size_sqm: 161,
  },
};

function render(row: unknown): string {
  const data = applyInvestmentProjection({ report: {}, brand: {} } as Record<string, unknown>, row as never);
  // The spacious variants are the ones that give the property its own page; one
  // of each arrangement is enough for a binding question.
  const masters = INVESTMENT_COMPASS_TEMPLATES.filter((t) => /-(01|03)-/.test(String((t as { slug?: string }).slug ?? '')));
  return masters.map((t) => renderTemplateToHtml((t as { schema: never }).schema, { data }).html).join('\n');
}

describe('the Investment Compass property table against the stored record', () => {
  const html = render(STORED);

  it('keeps the rows the record can fill', () => {
    // The guard against a careless conditional: `property.type` resolves on
    // 1,059 of the 1,187 rows and is the row the whole page is about.
    expect(html).toContain('Property type');
    expect(html).toContain('Residential Property');
    expect(html).toContain('93 Bimbadeen Avenue, Banora Point NSW 2486, Australia');
  });

  it('prints land and building area, which no report had ever shown', () => {
    // Both come from the finance run. Before the projection took that fallback
    // these two rows were empty on every report in the corpus.
    expect(html).toContain('Land area');
    expect(html).toContain('2,131 m²');
    expect(html).toContain('Building area');
    expect(html).toContain('161 m²');
  });

  it('drops the labels the record cannot answer', () => {
    // Matched as a whole table cell rather than as a substring: the cash-flow
    // page carries a legitimate "Council and water rates" row, and a bare
    // `not.toContain('Council')` fails on it.
    for (const label of ['Year built', 'Zoning', 'Council', 'Configuration']) {
      expect(html, `${label} has no value on this record and must not be printed`).not.toContain(`>${label}</td>`);
    }
  });

  it('drops a strengths/considerations column with nothing in it', () => {
    // `weaknesses` is empty here, as it is on 313 stored reports.
    expect(html).toContain('High walkability score enhancing liveability');
    expect(html).not.toContain('Considerations');
  });
});

describe('the same masters against a record that fills every field', () => {
  const html = render(COMPLETE);

  it('prints every row, so the guard is about the data and not about the page', () => {
    for (const label of ['Address', 'Property type', 'Configuration', 'Land area', 'Year built', 'Zoning', 'Council', 'Building area']) {
      expect(html, `${label} is held by this record and must be printed`).toContain(`>${label}</td>`);
    }
    expect(html).toContain('4 bed · 2 bath · 2 car');
    expect(html).toContain('Tweed Shire');
    expect(html).toContain('1998');
  });
});

describe('the ten-year equity chart', () => {
  const html = render(STORED);

  it('labels the y axis, which carried no value of any kind', () => {
    // Three dashed gridlines at 25/50/75% with nothing against them was the
    // whole axis. A reader could not tell $1.1m from $100k.
    expect(html).toContain('$1.1m');
    expect(html).toContain('$0');
    expect(html).toContain('Equity');
  });

  it('sets the first and last x labels inside the plot', () => {
    // Both ends were `text-anchor:middle` on a point at the edge of the
    // viewBox, so "Yr 1" printed as "1" and "Yr 10" printed as "Yr".
    expect(html).toContain('text-anchor="start"');
    expect(html).toContain('text-anchor="end"');
  });
});
