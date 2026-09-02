/**
 * Pins the investment financial engine's arithmetic — and the repair of the
 * projection fold — against a captured production row.
 *
 * The row (a $1.19M NSW house, weekly rent $739, 20% deposit) is the one the
 * Phase 2 audit measured: its stored 10-year series charged year-1 operating
 * expenses of $59,931 against real annual costs of $21,418, because the old
 * fold summed `Object.values(annualCosts)` — an object that carries its own
 * totals and a percentage beside the line items — so costs were charged
 * roughly three times over (2·totalAnnual + totalExcludingLandTax + percent
 * = $57,736, × that year's 3.8% CPI = $59,930). The headline metrics used a
 * different base again, so one page contradicted itself by $43,885/yr.
 *
 * These tests reconstruct that row from the engine's own primitives (proving
 * the reconstruction IS the production row), then assert the one-cost-base
 * rule: projections, sensitivity and headline cash flow all reconcile, and
 * the only figure allowed a different base is net rental YIELD (land tax out,
 * because it depends on the owner's aggregated holdings — and the reports
 * say so).
 */
import { describe, expect, it } from 'vitest';

import {
  calculateAnnualCosts,
  calculateImpact,
  calculateKeyMetrics,
  calculateMonthlyPayment,
  calculateSensitivityAnalysis,
  cumulativeCashFlow,
  fmtCashFlow,
  generateProjections,
  getInterestRateByLVR,
  impliedOpexFromSeries,
  operatingExpensesFrom,
  seriesLvrPercent,
} from '../../../../supabase/functions/_shared/reports/investment/financialEngine.pure';

/** The captured production inputs (financial_calculations of a live report). */
const ACER = {
  propertyValue: 1_190_000,
  deposit: 238_000,
  weeklyRent: 739,
  state: 'NSW',
  propertyType: 'house' as const,
  loanTerm: 30,
  // What the row stored, for cross-checks:
  stored: {
    totalAnnual: 21_418,
    totalAnnualExcludingLandTax: 14_893,
    monthlyPayment: 6017.287583653029,
    annualNet: -48_672,
    moderateYear1: {
      year: 1,
      cashFlow: -92_557,
      annualRent: 39_581,
      loanBalance: 941_673,
      propertyValue: 1_237_600,
    },
  },
};

const input = {
  propertyValue: ACER.propertyValue,
  deposit: ACER.deposit,
  loanTerm: ACER.loanTerm,
  weeklyRent: ACER.weeklyRent,
  state: ACER.state,
  propertyType: ACER.propertyType,
};

const lvr = ((ACER.propertyValue - ACER.deposit) / ACER.propertyValue) * 100;
// The production run supplied a researched 6.5% rate (the stored monthly
// payment solves to it exactly); the tier table alone would give 6.44%.
const rateInfo = getInterestRateByLVR(lvr, 'investor', 6.5);
const monthlyPayment = calculateMonthlyPayment(
  ACER.propertyValue - ACER.deposit,
  rateInfo.rate / 100 / 12,
  ACER.loanTerm * 12,
);
const annualCosts = calculateAnnualCosts(ACER.propertyValue, ACER.weeklyRent, ACER.state, ACER.propertyType);
const annualRent = ACER.weeklyRent * 52;
const annualLoanPayments = monthlyPayment * 12;

describe('reconstruction is the production row', () => {
  it('reproduces the stored cost totals from the engine primitives', () => {
    expect(annualCosts.totalAnnual).toBe(ACER.stored.totalAnnual);
    expect(annualCosts.totalAnnualExcludingLandTax).toBe(ACER.stored.totalAnnualExcludingLandTax);
    // NSW land tax over the $755k threshold — the number the yield excludes.
    expect(annualCosts.landTax).toBe(6_525);
  });

  it('reproduces the stored monthly payment (provided 6.5% rate)', () => {
    expect(rateInfo.rateType).toBe('user_provided');
    expect(monthlyPayment).toBeCloseTo(ACER.stored.monthlyPayment, 6);
  });
});

describe('operatingExpensesFrom — the one cost base', () => {
  it('returns the footed total, never a fold of the raw object', () => {
    expect(operatingExpensesFrom(annualCosts)).toBe(21_418);
    // What the old fold produced from the same object: every numeric value
    // summed, aggregates and the percentage included.
    const oldFold = Object.values(annualCosts)
      .filter((v): v is number => typeof v === 'number')
      .reduce((sum, v) => sum + v, 0);
    expect(oldFold).toBe(57_736); // 2·totalAnnual + totalExcludingLandTax + 7
    expect(operatingExpensesFrom(annualCosts)).not.toBe(oldFold);
  });

  it('sums the named line items when no footing is stored', () => {
    const { totalAnnual: _t, totalAnnualExcludingLandTax: _x, ...items } = annualCosts;
    expect(operatingExpensesFrom(items)).toBe(21_418);
  });

  it('ignores unknown numeric fields another writer may add (e.g. lettingFees)', () => {
    const { totalAnnual: _t, totalAnnualExcludingLandTax: _x, ...items } = annualCosts;
    expect(operatingExpensesFrom({ ...items, lettingFees: 739 })).toBe(21_418);
  });
});

describe('generateProjections — the repaired series', () => {
  // The stored row used that day's cached CPI path; year 1 was 3.8%. Fixing
  // the CPI here isolates the fold repair from the cache.
  const series = generateProjections(
    { ...input, interestRate: rateInfo.rate },
    monthlyPayment,
    annualCosts,
    0.04,
    0.03,
    0.038,
    [],
  );

  it('charges year-1 operating costs once, CPI-escalated', () => {
    const opex1 = impliedOpexFromSeries(series[0], annualLoanPayments);
    expect(opex1).toBe(Math.round(21_418 * 1.038));
    expect((opex1 ?? 0) / annualCosts.totalAnnual).toBeLessThan(1.1);
  });

  it('year-1 cash flow is the honest figure, not the stored −$92,557', () => {
    const expected = Math.round(annualRent * 1.03 - (21_418 * 1.038 + annualLoanPayments));
    expect(series[0].cashFlow).toBe(expected);
    expect(series[0].cashFlow).toBeGreaterThan(-60_000);
    // The defect this repairs: same inputs used to produce the stored value.
    expect(ACER.stored.moderateYear1.cashFlow).toBe(-92_557);
    expect(series[0].cashFlow - ACER.stored.moderateYear1.cashFlow).toBeGreaterThan(37_000);
  });

  it('the growth legs are untouched by the repair', () => {
    expect(series[0].annualRent).toBe(ACER.stored.moderateYear1.annualRent);
    expect(series[0].propertyValue).toBe(ACER.stored.moderateYear1.propertyValue);
    expect(series[0].loanBalance).toBe(ACER.stored.moderateYear1.loanBalance);
  });

  it('diagnoses the stored row exactly: old fold × that year CPI', () => {
    const storedOpex1 =
      ACER.stored.moderateYear1.annualRent - Math.round(annualLoanPayments) - ACER.stored.moderateYear1.cashFlow;
    // 57,736 × 1.038 — the triple-charge, escalated.
    expect(storedOpex1).toBe(59_931);
    expect(storedOpex1 / annualCosts.totalAnnual).toBeGreaterThan(2);
  });

  it('headline and series reconcile to declared escalation, nothing more', () => {
    const totalUpfront = ACER.deposit + 47_737 + rateInfo.lmiEstimate + 1_500 + 500;
    const metrics = calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, totalUpfront);
    // Year 0 → year 1 moves by one year of rent growth minus one year of CPI
    // on the costs; that is the whole permitted gap.
    const declaredEscalation = Math.round(0.03 * annualRent - 0.038 * annualCosts.totalAnnual);
    expect(series[0].cashFlow - metrics.annualNet).toBe(declaredEscalation);
    expect(Math.abs(series[0].cashFlow - metrics.annualNet)).toBeLessThan(2_000);
  });
});

describe('calculateKeyMetrics — one truth for the headline', () => {
  const totalUpfront = ACER.deposit + 47_737 + rateInfo.lmiEstimate + 1_500 + 500;
  const metrics = calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, totalUpfront);

  it('annual net includes land tax (the projections cost base)', () => {
    expect(metrics.annualNet).toBe(Math.round(annualRent - 21_418 - annualLoanPayments));
    expect(metrics.weeklyNet).toBe(Math.round((annualRent - 21_418 - annualLoanPayments) / 52));
    // The old headline excluded land tax; the difference on this row is the
    // $6,525 the reader could not reconcile.
    expect(ACER.stored.annualNet - metrics.annualNet).toBe(annualCosts.landTax);
  });

  it('net rental yield keeps the owner-independent base (land tax out)', () => {
    // Unchanged from what the production row stored — 1.98% — so the one
    // deliberately different base is stable and stated, not drifting.
    expect(metrics.netRentalYield).toBe(1.98);
  });

  it('cash-on-cash denominator IS the published totalUpfront', () => {
    expect(metrics.totalInvestment).toBe(totalUpfront);
    const netCashFlow = annualRent - 21_418 - annualLoanPayments;
    expect(metrics.cashOnCashReturn).toBe(Math.round((netCashFlow / totalUpfront) * 100 * 100) / 100);
  });

  it('never divides by a zero denominator', () => {
    const m = calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, 0);
    expect(m.cashOnCashReturn).toBe(0);
  });
});

describe('sensitivity — same base as everything else', () => {
  it('impact at the unchanged rate equals the headline annual net', () => {
    const totalUpfront = ACER.deposit + 47_737 + rateInfo.lmiEstimate + 1_500 + 500;
    const metrics = calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, totalUpfront);
    const impact = calculateImpact({ ...input, interestRate: rateInfo.rate }, rateInfo.rate, annualCosts);
    expect(Math.round(impact)).toBe(metrics.annualNet);
  });

  it('rent sensitivity moves off the same base', () => {
    const s = calculateSensitivityAnalysis({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts);
    const base = annualRent - 21_418 - annualLoanPayments;
    expect(s.rentChanges.plus10Percent).toBeCloseTo(base + annualRent * 0.1, 6);
  });
});

describe('series-derived narrative helpers', () => {
  it('fmtCashFlow keeps the sign: parentheses only for losses', () => {
    expect(fmtCashFlow(-5000)).toBe('($5,000)');
    expect(fmtCashFlow(5000)).toBe('$5,000');
    expect(fmtCashFlow(0)).toBe('$0');
    expect(fmtCashFlow(null)).toBe('$0');
    expect(fmtCashFlow(-92_556.6)).toBe('($92,557)');
  });

  it('seriesLvrPercent computes from the balances the row carries', () => {
    expect(seriesLvrPercent(ACER.stored.moderateYear1)).toBe('76.1');
    expect(seriesLvrPercent({ propertyValue: 1_000_000 })).toBe('XX');
    expect(seriesLvrPercent(undefined)).toBe('XX');
  });

  it('impliedOpexFromSeries recovers what a row charged', () => {
    expect(impliedOpexFromSeries(ACER.stored.moderateYear1, Math.round(annualLoanPayments))).toBe(59_931);
    expect(impliedOpexFromSeries(ACER.stored.moderateYear1, 0)).toBeNull();
    expect(impliedOpexFromSeries(undefined, 72_207)).toBeNull();
  });

  it('cumulativeCashFlow tolerates an absent series', () => {
    expect(cumulativeCashFlow(undefined)).toBe(0);
    expect(cumulativeCashFlow([{ cashFlow: -10 }, { cashFlow: 4 }, {}])).toBe(-6);
  });
});
