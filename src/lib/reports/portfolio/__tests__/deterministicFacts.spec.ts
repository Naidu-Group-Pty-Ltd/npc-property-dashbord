/**
 * The Portfolio figures the record produces, and the ones it refuses to.
 *
 * Every rule here exists because the model was previously asked for these
 * numbers and got them wrong: of the 14 stored reports carrying a rate
 * sensitivity, only 4 had a +1%/+2% pair inside a generous 1.9×–2.2× band, and
 * against the loans themselves the +1% figure was out by $2,137 a month on
 * average and $9,090 at worst.
 *
 * Note what is deliberately NOT asserted anywhere below: that the +2% impact
 * is twice the +1%. That was an audit sanity band, not an invariant — a
 * principal-and-interest payment is convex in the rate. The tests assert the
 * arithmetic, not the ratio.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECTION_SCENARIO,
  PORTFOLIO_GROWTH_ASSUMPTIONS,
  buildProjectionAssumptions,
  impactFor,
  monthlyFromFrequency,
  portfolioRateSensitivity,
  projectPortfolio,
  readLoanFact,
  readProjectionScenario,
  readRepaymentStructure,
  sensitivityUnavailableText,
} from '../deterministicFacts.pure';

// An interest-only loan taken from the shape of a real `client_properties`
// row: balance, rate and repayment type present, no term, no repayment amount.
const IO = (balance: number, rate: number) => ({
  loanRemaining: balance, interestRate: rate, repaymentType: 'interest_only',
  loanRepaymentAmount: null, loanRepaymentFrequency: 'monthly',
});
const PI = (balance: number, rate: number) => ({
  loanRemaining: balance, interestRate: rate, repaymentType: 'principal_and_interest',
  loanRepaymentAmount: null, loanRepaymentFrequency: 'monthly',
});

// ---------------------------------------------------------------------------
// Repayment frequency
// ---------------------------------------------------------------------------

describe('repayment frequency normalisation', () => {
  it('converts every frequency the column accepts to a monthly amount', () => {
    expect(monthlyFromFrequency(1200, 'monthly')).toBe(1200);
    expect(monthlyFromFrequency(300, 'weekly')).toBe(1300);          // 300*52/12
    expect(monthlyFromFrequency(600, 'fortnightly')).toBe(1300);     // 600*26/12
    expect(monthlyFromFrequency(3600, 'quarterly')).toBe(1200);
    expect(monthlyFromFrequency(14_400, 'annually')).toBe(1200);
    expect(monthlyFromFrequency(14_400, 'Yearly')).toBe(1200);
  });

  it('keeps a legitimate zero as zero rather than turning it into unknown', () => {
    // A truthy fallback here would report "no repayment recorded" for a loan
    // whose repayment genuinely is nil. Those are different claims.
    expect(monthlyFromFrequency(0, 'monthly')).toBe(0);
    expect(monthlyFromFrequency('0', 'weekly')).toBe(0);
  });

  it('refuses to convert an amount whose frequency it does not know', () => {
    // Assuming monthly would silently multiply a fortnightly repayment by 1.
    expect(monthlyFromFrequency(1200, 'per moon')).toBeNull();
    expect(monthlyFromFrequency(1200, null)).toBeNull();
    expect(monthlyFromFrequency(1200, '')).toBeNull();
  });

  it('reports an absent amount as absent', () => {
    expect(monthlyFromFrequency(null, 'monthly')).toBeNull();
    expect(monthlyFromFrequency(undefined, 'monthly')).toBeNull();
    expect(monthlyFromFrequency('', 'monthly')).toBeNull();
  });
});

describe('reading a repayment structure', () => {
  it('reads the spellings the column actually holds', () => {
    expect(readRepaymentStructure('interest_only')).toBe('interest_only');
    expect(readRepaymentStructure('principal_and_interest')).toBe('principal_and_interest');
    expect(readRepaymentStructure('Interest Only')).toBe('interest_only');
    expect(readRepaymentStructure('P&I')).toBe('principal_and_interest');
  });

  it('calls anything else unknown rather than guessing', () => {
    for (const v of [null, undefined, '', 'variable', 42, {}]) {
      expect(readRepaymentStructure(v)).toBe('unknown');
    }
  });
});

// ---------------------------------------------------------------------------
// One loan
// ---------------------------------------------------------------------------

describe('reading one loan', () => {
  it('prices an interest-only loan exactly, with no term involved', () => {
    // Verified against production: `monthly_interest_repayment` equals
    // balance × rate ÷ 12 for 20 of 20 interest-only loans.
    const fact = readLoanFact(IO(900_000, 5.9))!;
    expect(fact.modellable).toBe(true);
    expect(fact.monthlyRepayment).toBeCloseTo(900_000 * 0.059 / 12, 2);
    expect(fact.reason).toBeNull();
  });

  it('refuses an amortising loan, because this data model has no loan term', () => {
    const fact = readLoanFact(PI(600_000, 6.5))!;
    expect(fact.modellable).toBe(false);
    expect(fact.reason).toBe('amortising_loan_without_term');
  });

  it('refuses a loan with no rate, and never substitutes a market rate', () => {
    const fact = readLoanFact({ loanRemaining: 500_000, interestRate: null, repaymentType: 'interest_only' })!;
    expect(fact.modellable).toBe(false);
    expect(fact.reason).toBe('missing_interest_rate');
    expect(fact.annualRatePercent).toBeNull();
  });

  it('refuses a loan with no repayment structure rather than assuming one', () => {
    const fact = readLoanFact({ loanRemaining: 100_000, interestRate: 5.9, repaymentType: null })!;
    expect(fact.modellable).toBe(false);
    expect(fact.reason).toBe('missing_repayment_structure');
  });

  it('treats a property with no debt as no loan at all', () => {
    expect(readLoanFact({ loanRemaining: 0, interestRate: 5.9, repaymentType: 'interest_only' })).toBeNull();
    expect(readLoanFact({ loanRemaining: null })).toBeNull();
  });

  it('prefers a recorded repayment over the calculation when one exists', () => {
    // Nothing populates this column today, but an actual repayment is evidence
    // and a formula is a model of it — the preference must be that way round.
    const fact = readLoanFact({
      loanRemaining: 900_000, interestRate: 5.9, repaymentType: 'interest_only',
      loanRepaymentAmount: 5_000, loanRepaymentFrequency: 'monthly',
    })!;
    expect(fact.monthlyRepayment).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Rate sensitivity
// ---------------------------------------------------------------------------

describe('portfolio rate sensitivity', () => {
  it('computes a single interest-only loan exactly', () => {
    const s = portfolioRateSensitivity([IO(900_000, 5.9)]);
    expect(s.available).toBe(true);
    expect(s.currentMonthlyRepayment).toBeCloseTo(4_425, 0);       // 900k × 5.9% / 12
    expect(impactFor(s, 1)).toBeCloseTo(-750, 0);                  // 900k × 1% / 12
    expect(impactFor(s, 2)).toBeCloseTo(-1_500, 0);
  });

  it('states a worsening position as NEGATIVE, always', () => {
    const s = portfolioRateSensitivity([IO(500_000, 6)]);
    expect(impactFor(s, 1)!).toBeLessThan(0);
    expect(impactFor(s, 2)!).toBeLessThan(0);
    // and never the other way round, whatever the balance
    for (const balance of [1_000, 250_000, 5_000_000]) {
      expect(impactFor(portfolioRateSensitivity([IO(balance, 5)]), 1)!).toBeLessThan(0);
    }
  });

  it('aggregates several loans', () => {
    const s = portfolioRateSensitivity([IO(600_000, 5.5), IO(400_000, 6.2), IO(250_000, 5.9)]);
    expect(s.loansCovered).toBe(3);
    expect(s.balanceCovered).toBe(1_250_000);
    // Rounded to cents, as a dollar figure must be — 1,250,000 x 1% / 12.
    expect(impactFor(s, 1)).toBe(-1041.66);
    expect(impactFor(s, 2)).toBe(-2083.33);
  });

  it('is unavailable — not partial — when any loan cannot be modelled', () => {
    // A figure covering three of four loans understates the exposure while
    // sitting beside the portfolio's full debt.
    const s = portfolioRateSensitivity([IO(600_000, 5.5), IO(400_000, 6.2), PI(500_000, 6.5)]);
    expect(s.available).toBe(false);
    expect(s.unavailableReason).toBe('amortising_loan_without_term');
    expect(s.shocks).toEqual([]);
    expect(s.currentMonthlyRepayment).toBeNull();
    expect(impactFor(s, 1)).toBeNull();
  });

  it('is unavailable rather than zero when data is missing', () => {
    for (const loans of [
      [],
      [{ loanRemaining: 500_000, interestRate: null, repaymentType: 'interest_only' }],
      [{ loanRemaining: 500_000, interestRate: 6, repaymentType: null }],
    ]) {
      const s = portfolioRateSensitivity(loans);
      expect(s.available).toBe(false);
      expect(s.currentMonthlyRepayment).toBeNull();
      expect(s.shocks).toHaveLength(0);
      expect(impactFor(s, 1)).toBeNull();
      expect(impactFor(s, 1)).not.toBe(0);
    }
  });

  it('names why, in words a client can act on', () => {
    expect(sensitivityUnavailableText('amortising_loan_without_term')).toMatch(/loan term/i);
    expect(sensitivityUnavailableText('amortising_loan_without_term')).toMatch(/recording the remaining term/i);
    expect(sensitivityUnavailableText('missing_interest_rate')).toMatch(/no interest rate/i);
    expect(sensitivityUnavailableText('no_loans')).toMatch(/no loans/i);
  });

  it('is deterministic — the same loans give the same answer every time', () => {
    const loans = [IO(600_000, 5.5), IO(400_000, 6.2)];
    const a = portfolioRateSensitivity(loans);
    const b = portfolioRateSensitivity(loans);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

describe('projection assumptions', () => {
  it('keeps the three rates the product already used', () => {
    expect(PORTFOLIO_GROWTH_ASSUMPTIONS).toEqual({ conservative: 3.5, moderate: 5, optimistic: 7.5 });
    expect(DEFAULT_PROJECTION_SCENARIO).toBe('moderate');
    expect(readProjectionScenario('conservative')).toBe('conservative');
    expect(readProjectionScenario('optimistic')).toBe('optimistic');
    expect(readProjectionScenario(null)).toBe('moderate');
    expect(readProjectionScenario('wildly optimistic')).toBe('moderate');
  });

  it('states every assumption the arithmetic actually used', () => {
    const a = buildProjectionAssumptions('conservative', 10);
    expect(a.annualCapitalGrowthPercent).toBe(3.5);
    expect(a.horizonYears).toBe(10);
    expect(a.debtTreatment).toBe('held_constant');
    expect(a.cashflowTreatment).toBe('not_projected');
    // What is shown must name the same rate and horizon that were used.
    expect(a.statements.join(' ')).toContain('3.5%');
    expect(a.statements.join(' ')).toContain('10 year');
    expect(a.statements.join(' ')).toMatch(/debt is held/i);
    expect(a.statements.join(' ')).toMatch(/not projected/i);
  });
});

describe('projecting the portfolio', () => {
  it('compounds the value at the named rate over the named horizon', () => {
    const p = projectPortfolio({ currentPortfolioValue: 1_400_000, currentDebt: 200_000, scenario: 'moderate', horizonYears: 10 });
    expect(p.projectedPortfolioValue).toBe(Math.round(1_400_000 * Math.pow(1.05, 10)));
    expect(p.assumptions.annualCapitalGrowthPercent).toBe(5);
  });

  it('reconciles equity exactly against value and the named debt treatment', () => {
    for (const scenario of ['conservative', 'moderate', 'optimistic'] as const) {
      for (const years of [1, 5, 10, 15]) {
        const p = projectPortfolio({ currentPortfolioValue: 980_000, currentDebt: 415_000, scenario, horizonYears: years });
        expect(p.projectedEquity).toBe(p.projectedPortfolioValue! - p.projectedDebt!);
        // `held_constant` means exactly that, and the reader is told so.
        expect(p.projectedDebt).toBe(415_000);
      }
    }
  });

  it('honours a custom horizon', () => {
    expect(projectPortfolio({ currentPortfolioValue: 500_000, currentDebt: 0, horizonYears: 7 }).assumptions.horizonYears).toBe(7);
    expect(projectPortfolio({ currentPortfolioValue: 500_000, currentDebt: 0 }).assumptions.horizonYears).toBe(10);
  });

  it('never projects cashflow, because no rent growth rate is recorded', () => {
    // Capital growth is not rental growth. Using it as a stand-in would
    // manufacture exactly the figure this work removes.
    const p = projectPortfolio({ currentPortfolioValue: 1_000_000, currentDebt: 500_000 });
    expect(p.projectedMonthlyCashflow).toBeNull();
    expect(p.assumptions.cashflowTreatment).toBe('not_projected');
  });

  it('treats zero debt as unencumbered and absent debt as unknown', () => {
    const unencumbered = projectPortfolio({ currentPortfolioValue: 800_000, currentDebt: 0 });
    expect(unencumbered.projectedDebt).toBe(0);
    expect(unencumbered.projectedEquity).toBe(unencumbered.projectedPortfolioValue);

    const unknown = projectPortfolio({ currentPortfolioValue: 800_000, currentDebt: null });
    expect(unknown.projectedDebt).toBeNull();
    expect(unknown.projectedEquity).toBeNull();
  });

  it('is absent, not zero, when the portfolio has no value', () => {
    const p = projectPortfolio({ currentPortfolioValue: null, currentDebt: 100_000 });
    expect(p.projectedPortfolioValue).toBeNull();
    expect(p.projectedEquity).toBeNull();
    // The assumptions still stand, so a reader learns what would have been used.
    expect(p.assumptions.annualCapitalGrowthPercent).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// The trust boundary, asserted against the generator's own source
//
// The architectural claim is that the model is never ASKED for these figures —
// not asked and then checked. That is a property of the prompt schema, so it
// is read from the source rather than inferred from behaviour.
// ---------------------------------------------------------------------------

describe('trust boundary in generate-portfolio-analysis', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../../../supabase/functions/generate-portfolio-analysis/index.ts'),
    'utf8',
  );
  // The JSON shape the model is asked to return, which is the only part of the
  // file where a `"field": number` line is a request TO the model.
  const schema = source.slice(source.indexOf('Format your response as valid JSON'));

  it('asks the model for no deterministic figure', () => {
    for (const field of [
      'currentMonthlyCashflow', 'currentMonthlyRepayment',
      'plusOnePercentImpact', 'plusTwoPercentImpact',
      'projectedPortfolioValue', 'projectedEquity', 'projectedMonthlyCashflow',
      'totalDebtDeployed', 'estimatedCapacity', 'availableCapacity', 'utilisationPercentage',
    ]) {
      expect(schema, `the model is still asked for ${field}`).not.toContain(`"${field}"`);
    }
  });

  it('still asks the model for the two judgements it owns', () => {
    expect(schema).toContain('"healthScore"');
    expect(schema).toContain('"diversificationScore"');
  });

  it('keeps asking for the commentary that explains the calculated figures', () => {
    expect(schema).toContain('"commentary"');
    expect(schema).toContain('"plainEnglishSummary"');
  });

  it('supplies the calculated figures to the model as authoritative', () => {
    expect(source).toContain('deterministicFactsBlock');
    expect(source).toMatch(/THESE ARE AUTHORITATIVE/);
    expect(source).toMatch(/DO NOT RECALCULATE/);
  });

  it('sources the investment cashflow from the portfolio metric, not the model', () => {
    // §6: one authority, and the two can never disagree because there is only
    // one derivation.
    expect(source).toMatch(/currentMonthlyCashflow:\s*portfolioMetrics\.netMonthlyCashflow/);
  });

  it('bounds the two model-authored scores rather than clamping them', () => {
    // Clamping 250 to 100 would publish an excellent rating the model never
    // gave; dropping it is the honest failure.
    expect(source).toMatch(/n >= 0 && n <= 100/);
  });
});
