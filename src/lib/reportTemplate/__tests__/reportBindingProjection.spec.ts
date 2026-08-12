/**
 * The binding projection, measured the only way that means anything: how many
 * of the catalogue's bindings resolve against a row shaped like production.
 *
 * The fixture below is not invented. Its key names, nesting and units are taken
 * from the live `investment_reports` table (1,182 rows) — `property_specs` in
 * snake_case, `financial_calculations` nested under `initialCosts` / `income` /
 * `keyMetrics` / `loanDetails` / `annualCosts` / `assumptions`, and
 * `investment_score.risks` as an array of plain strings. Only the values are
 * synthetic. A fixture written in the catalogue's own vocabulary would pass
 * while production stayed broken, which is exactly how this defect survived.
 */
import { describe, it, expect } from 'vitest';
import {
  projectInvestmentReport,
  applyInvestmentProjection,
} from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';

/** Shaped exactly like a stored row. See the header. */
const ROW = {
  property_address: '14 Marlborough Street, Leichhardt NSW 2040',
  updated_at: '2026-08-02T00:00:00.000Z',
  created_at: '2026-08-01T00:00:00.000Z',
  property_specs: {
    bedrooms: 3, bathrooms: 2, parking: 1,
    land_size_sqm: 412, building_size_sqm: 168,
    property_type: 'House', year_built: 1998,
    zoning: 'R2 Low Density Residential', council_area: 'Inner West',
  },
  financial_calculations: {
    initialCosts: {
      propertyValue: 1290000, stampDuty: 56890, legalFees: 1800,
      inspectionFees: 950, totalUpfront: 1_349_640, deposit: 258000, loanAmount: 1032000,
    },
    income: { weeklyRent: 920 },
    keyMetrics: {
      grossRentalYield: 3.71, netRentalYield: 2.44, cashOnCashReturn: 4.12,
      weeklyNet: -184.5, annualNet: -9594, lvr: 80, totalInvestment: 1349640,
    },
    loanDetails: { loanAmount: 1032000, interestRate: 6.14, monthlyPayment: 6280, weeklyPayment: 1449, lvr: 80 },
    annualCosts: {
      councilRates: 1980, landlordInsurance: 720, propertyManagement: 2392,
      maintenance: 1290, totalAnnual: 8710,
    },
    assumptions: { capitalGrowth: 4.2, cpiGrowth: 2.5, occupancyWeeks: 50 },
    cashFlow: { taxRate: null },
  },
  investment_score: {
    totalScore: 72, grade: 'B+',
    recommendation: 'Proceed to offer at or below $1.29m',
    risks: ['Interest rate exposure at 80% LVR', 'Strata levy uncertainty', 'Single-tenant vacancy risk'],
    strengths: ['Land-led inner-west holding', 'Below suburb median'],
    weaknesses: ['Negative cash flow in years 1-3', 'Dated internals'],
  },
};

/** Resolve `a.b.c` the way the renderer does: every hop must exist. */
function resolves(data: Record<string, any>, path: string): boolean {
  let cur: any = data;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return false;
    if (typeof cur !== 'object') return false;
    if (!(key in cur)) return false;
    cur = cur[key];
  }
  return cur !== undefined && cur !== null && cur !== '';
}

/** Every distinct binding the 50 masters use. */
function catalogueBindings(): string[] {
  const found = new Set<string>();
  for (const t of INVESTMENT_COMPASS_TEMPLATES) {
    for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) found.add(m[1]);
  }
  return [...found].sort();
}

/** The raw context the adapter built before the projection existed. */
function rawContext() {
  const shallow = (o: any) => (o && typeof o === 'object' ? { ...o } : {});
  return {
    report: { id: 'r1', type: 'investment', address: ROW.property_address, generated_at: ROW.updated_at },
    property: shallow(ROW.property_specs),
    financials: shallow(ROW.financial_calculations),
    scores: shallow(ROW.investment_score),
  } as Record<string, any>;
}

describe('the defect this projection fixes', () => {
  it('resolved almost nothing before — one binding in eighty', () => {
    const before = catalogueBindings().filter((b) => resolves(rawContext(), b));
    // `property.zoning` is the single survivor: the one key whose spelling
    // happened to match between the catalogue and the database.
    expect(before).toEqual(['property.zoning']);
  });

  it('names the three causes precisely', () => {
    const raw = rawContext();
    // Case: the database is snake_case.
    expect(resolves(raw, 'property.yearBuilt')).toBe(false);
    expect(resolves(raw, 'property.year_built')).toBe(true);
    // Depth: a shallow spread never flattened a path.
    expect(resolves(raw, 'financials.grossYield')).toBe(false);
    expect(resolves(raw, 'financials.keyMetrics')).toBe(true);
    // Location: the address is published under `report`, not `property`.
    expect(resolves(raw, 'property.address')).toBe(false);
    expect(resolves(raw, 'report.address')).toBe(true);
  });
});

describe('after projection', () => {
  const data = applyInvestmentProjection(rawContext(), ROW);

  it('takes the catalogue from 1 resolved binding to 40', () => {
    const bindings = catalogueBindings();
    const ok = bindings.filter((b) => resolves(data, b));
    expect(bindings).toHaveLength(80);
    expect(ok.length).toBeGreaterThanOrEqual(40);
  });

  it('leaves exactly the bindings that have no source, and no others', () => {
    // The contract, not a ratio. Every entry below was checked against
    // production and has nowhere in the row to come from. If a future change
    // makes one resolve, either it found a real source — delete the line and
    // say where it came from — or it invented a figure, and this test is the
    // thing standing between that invention and a client's report.
    const expectedAbsent = [
      // Photographs: no adapter emits them.
      'property.images.0', 'property.images.1', 'property.images.2',
      'property.images.3', 'property.images.4', 'property.images.5',
      // Organisation, adviser and client identity live outside this row.
      'org.abn', 'org.address', 'org.email', 'org.name', 'org.phone', 'org.website',
      'author.name', 'author.title', 'client.name',
      // location_intelligence carries amenities/commute/schools/transport —
      // no postcode, state, suburb count or market prose.
      'market.conclusion.body', 'market.conclusion.headline', 'market.narrative',
      'market.postcode', 'market.state', 'market.suburbCount',
      // investment_score.risks is an array of plain strings: one field, not three.
      'risks.0.action', 'risks.0.why', 'risks.1.action',
      'risks.1.why', 'risks.2.action', 'risks.2.why',
      'recommendation.rationale',
      // No column, and no safe derivation.
      'assumptions.rentalGrowth', 'assumptions.sellingCosts', 'assumptions.taxRate',
      'financials.breakEvenRent', 'financials.fundingNote', 'financials.loanFees',
      'financials.narrative', 'summary.narrative',
      'property.condition', 'property.rationale', 'property.suburb', 'property.tenancy',
    ].sort();

    const actualAbsent = catalogueBindings().filter((b) => !resolves(data, b)).sort();
    expect(actualAbsent).toEqual(expectedAbsent);
  });

  it('reads the figures a client actually sees', () => {
    expect(data.property.address).toBe('14 Marlborough Street, Leichhardt NSW 2040');
    expect(data.property.type).toBe('House');
    expect(data.property.yearBuilt).toBe(1998);
    expect(data.property.landArea).toBe(412);
    expect(data.property.configuration).toBe('3 bed · 2 bath · 1 car');
    expect(data.financials.purchasePrice).toBe(1290000);
    expect(data.financials.stampDuty).toBe(56890);
    expect(data.financials.weeklyRent).toBe(920);
    expect(data.financials.grossYield).toBe(3.71);
    expect(data.financials.loanAmount).toBe(1032000);
    expect(data.recommendation.headline).toBe('Proceed to offer at or below $1.29m');
    expect(data.risks[0].risk).toBe('Interest rate exposure at 80% LVR');
    expect(data.summary.strength[0]).toBe('Land-led inner-west holding');
    expect(data.summary.watch[0]).toBe('Negative cash flow in years 1-3');
  });

  it('converts units without inventing a model', () => {
    // Weekly is annual/52 — arithmetic, not a forecast.
    expect(data.financials.weeklyRates).toBeCloseTo(1980 / 52, 6);
    expect(data.financials.annualRepayment).toBe(6280 * 12);
    // Annual rent uses the report's OWN occupancy assumption, not a flat 52.
    expect(data.financials.annualRent).toBe(920 * 50);
    expect(data.assumptions.vacancy).toBeCloseTo((2 / 52) * 100, 6);
  });

  it('passes percentages through unscaled, because the filter does not scale', () => {
    // Stored whole-number percent (yield 0-7.51, rate 3.0-6.5 in production) and
    // `percent` formats without multiplying. Scaling here would print 371%.
    expect(data.financials.grossYield).toBe(3.71);
    expect(data.assumptions.interestRate).toBe(6.14);
    expect(data.assumptions.capitalGrowth).toBe(4.2);
  });

  it('leaves the unsourced absent rather than fabricating it', () => {
    // Each of these has no source in the row. A number here would be invented,
    // and an invented figure on a client's financial report is the worst
    // outcome available — worse than a blank line.
    for (const path of [
      'financials.breakEvenRent', 'financials.loanFees', 'financials.narrative',
      'assumptions.rentalGrowth', 'assumptions.sellingCosts', 'assumptions.taxRate',
      'market.postcode', 'market.narrative',
      'property.suburb', 'property.condition', 'property.tenancy',
      'recommendation.rationale', 'risks.0.why', 'risks.0.action',
      'summary.narrative', 'org.name', 'author.name', 'client.name',
    ]) {
      expect(resolves(data, path), `${path} must stay absent`).toBe(false);
    }
  });

  it('never writes an undefined key, so absent means absent', () => {
    const walk = (o: any, at: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        expect(v, `${at}.${k}`).not.toBeUndefined();
        walk(v, `${at}.${k}`);
      }
    };
    walk(projectInvestmentReport(ROW), 'projection');
  });

  it('is additive — the raw vocabulary still resolves', () => {
    expect(resolves(data, 'property.year_built')).toBe(true);
    expect(resolves(data, 'property.property_type')).toBe(true);
    expect(resolves(data, 'financials.keyMetrics')).toBe(true);
    expect(resolves(data, 'report.address')).toBe(true);
  });

  it('survives an empty or partial row without throwing', () => {
    expect(() => projectInvestmentReport({})).not.toThrow();
    const sparse = projectInvestmentReport({ property_address: '1 Test St' });
    expect(sparse.property.address).toBe('1 Test St');
    expect(Object.keys(sparse.financials)).toHaveLength(0);
    expect(sparse.risks).toEqual([]);
  });
});
