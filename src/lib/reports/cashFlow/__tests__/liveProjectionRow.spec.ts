/**
 * The reviewed series reaches the template, honestly labelled.
 *
 * ## The defect this guards against returning
 *
 * The 10 Year Cash Flow's contract puts the arithmetic in the browser, so the
 * template adapter — which reads the stored record — could apply a chosen
 * template only when the screen happened to equal the store. On this format
 * that is the exception: the modal recomputes ten years live. So a person
 * chose a template, the picker said the choice was kept, and every download
 * quietly came out of the standard composer. The bridge under test is what
 * closes that gap; these specs pin the three rules its header states.
 */
import { describe, expect, it } from 'vitest';
import {
  applyLiveCashFlowProjection,
  wireAsProjectionRow,
  wireYearsAsStoredSeries,
} from '../liveProjectionRow';
import type { WireProjection } from '../requestCashFlowPdf';

const year = (n: number, over: Partial<Record<string, number>> = {}) => ({
  year: n,
  calendarYear: 2026 + n,
  propertyValue: 800_000 + n * 40_000,
  loanBalance: 640_000,
  rentalIncome: 31_200 + n * 900,
  grossYield: 3.9,
  netYield: 3.1,
  expenses: 6_200,
  interestRate: 6.1,
  interest: 39_040,
  principal: 0,
  preTaxAnnual: -9_000 + n * 800,
  afterTaxAnnual: -4_200 + n * 700,
  depreciation: 8_000,
  taxRefund: 4_800,
  landTax: 900,
  capitalGrowth: 5,
  cpiGrowth: 3,
  ...over,
});

const wire = (over: Partial<WireProjection> = {}): WireProjection => ({
  acquisition: {
    purchasePrice: 800_000, marketValue: 830_000, deposit: 160_000,
    loanAmount: 640_000, loanTermYears: 30, interestRate: 6.1,
    loanType: 'interest_only', weeklyRent: 600, costs: [],
  },
  years: Array.from({ length: 10 }, (_, i) => year(i + 1)),
  assumptions: [{ label: 'Capital growth', value: '5% per year' }],
  notes: [],
  ...over,
} as WireProjection);

describe('the stored-series mapping', () => {
  it('carries the five drawn fields, in the stored vocabulary', () => {
    const series = wireYearsAsStoredSeries(wire())!;
    expect(series).toHaveLength(10);
    expect(series[0].year).toBe(1);
    expect(series[0].propertyValue).toBe(840_000);
    expect(series[0].loanBalance).toBe(640_000);
    expect(series[0].annualRent).toBe(32_100);
  });

  it('leads with the composer’s headline figure — after tax', () => {
    // The composer's opening sentence is the after-tax weekly position; a
    // templated document of the same projection must lead with the same
    // number, not the pre-tax one beside it.
    const series = wireYearsAsStoredSeries(wire())!;
    expect(series[0].cashFlow).toBe(-3_500);
    expect(series[0].cashFlow).not.toBe(-8_200);
  });

  it('derives equity and the running total the way the stored series does', () => {
    const series = wireYearsAsStoredSeries(wire())!;
    expect(series[0].equity).toBe(840_000 - 640_000);
    expect(series[1].cumulativeCashFlow).toBe(series[0].cashFlow as number + (series[1].cashFlow as number));
  });

  it('refuses a series any year of which is not whole enough to draw', () => {
    // An unresolved binding renders as the empty string — a half-shaped series
    // would print blank cells in a client's table, so it must not reach one.
    const missing = wire();
    (missing.years[4] as Record<string, unknown>).afterTaxAnnual = undefined;
    expect(wireYearsAsStoredSeries(missing)).toBeNull();
    expect(wireYearsAsStoredSeries(wire({ years: [] }))).toBeNull();
  });
});

describe('the pseudo-row and its projection', () => {
  it('is a row the format’s one producer can read', () => {
    const row = wireAsProjectionRow(wire(), { reportId: 'rep-1', propertyAddress: '1 Test St' })!;
    const data: Record<string, any> = {};
    applyLiveCashFlowProjection(data, row);
    expect(data.cashflow.years).toHaveLength(10);
    expect(data.cashflow.termYears).toBe(10);
    expect(data.cashflow.outcome.cashFlow).toBe(2_800);
  });

  it('never claims a scenario the series does not satisfy', () => {
    // The carrier key is a vehicle, not a label. "Moderate" printed over an
    // adviser-overridden series is a claim about assumptions nobody made.
    const row = wireAsProjectionRow(wire(), { reportId: 'rep-1' })!;
    const data: Record<string, any> = {};
    applyLiveCashFlowProjection(data, row);
    expect(data.cashflow.scenario).toBe('reviewed');
    expect(data.cashflow.scenarioLabel).toBe('Adviser-reviewed');
    // And the stored three-way comparison blocks are withheld: a comparison of
    // one hand-shaped column would be a claim wearing a chart's clothes.
    expect(data.cashflow.scenarios).toBeUndefined();
    expect(data.cashflow.scenarioBasis).toBeUndefined();
  });

  it('keeps `basis` — rates read off the series are observations, not claims', () => {
    const row = wireAsProjectionRow(wire(), { reportId: 'rep-1' })!;
    const data: Record<string, any> = {};
    applyLiveCashFlowProjection(data, row);
    expect(data.cashflow.basis?.capitalGrowth).toBeGreaterThan(0);
  });

  it('refuses the whole row when the series refuses', () => {
    expect(wireAsProjectionRow(wire({ years: [] }), { reportId: 'rep-1' })).toBeNull();
  });
});
