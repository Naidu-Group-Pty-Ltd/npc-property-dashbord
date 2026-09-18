/**
 * Each report owns its question, measured on the RENDERED result.
 *
 * S5/S6 §4: *"Compass owns asset/locality/market evidence/assessment/planning/
 * infrastructure; Financial owns detailed financing/repayments/cash position/
 * projections; Strategic owns verification priorities/suitability/holding/
 * monitoring/exit; Briefing+Snapshot genuinely condensed. Confirm that weekly
 * cash position and detailed modelling have not returned through shared
 * key-figure bindings."*
 *
 * ## Why this is a consumer test
 *
 * `tierContent.pure.ts` is the producer and its table is easy to read
 * correctly and still be wrong about the document, because THREE things decide
 * what a reader sees and only one of them is that table:
 *
 *  1. `reportBindingProjection` — what the templated pages may draw.
 *  2. `sectionRegistry` + `condenseCompose` — what the markdown body carries.
 *  3. the tier's own cover prose (`standfirst`, `companionNote`).
 *
 * Measured 18 Sep 2026 on the retained five-tier set, (1) and (3) agreed and
 * (2) did not: the Briefing withheld 32 modelling bindings, printed
 * *"the financial position in the Financial Analysis Report"* on its cover,
 * and then composed 3,156 characters over 73 table rows of purchase costs,
 * yield, loan structure, repayments, sensitivity and the ten-year series into
 * its body — four of the five chapters byte-identical to the Financial
 * Analysis Report's. That is exactly the `TIER_FRAMEWORK` Decision E defect in
 * the other direction, and no producer test could see it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectInvestmentReport }
  from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { composeCondensedDocument }
  from '../../../../supabase/functions/_shared/reports/investment/condenseCompose.pure';
import { markdownHeadingsForTier }
  from '../../../../supabase/functions/_shared/reports/investment/sectionRegistry.pure';

/** The retained set: one real row per tier, all five from production. */
const FIXTURE: Record<string, string> = {
  compass: '09f8569e-21ca-48b9-a3b9-57f4793d0836',
  financial: 'c21ed1fa-115c-4e8e-8fc3-6b5a0982834f',
  strategic: '2f1f7f6f-d921-4f5c-85ff-36d4ffbdd931',
  briefing: '89b451f6-93d9-4fb5-ba62-c554b1b83e4e',
  snapshot: '8c6edc56-6fce-4613-a3f3-82f3fe3769e2',
};
const row = (tier: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`.verify/fixtures/${FIXTURE[tier]}/report.json`, 'utf8'));

/**
 * The detailed modelling, by binding name. Every one of these is a statement
 * about a PURCHASE rather than about the asset — which is why `purchasePrice`
 * and `weeklyRent` are deliberately absent from the list.
 */
const MODELLING_BINDINGS = [
  'grossYield', 'netYield', 'cashOnCash', 'lvr', 'weeklyNet', 'annualNet',
  'loanAmount', 'weeklyRepayment', 'annualRepayment', 'deposit', 'totalInvestment',
] as const;

/** The three tiers whose content policy withholds the modelling. */
const WITHHOLDING = ['compass', 'strategic', 'briefing'] as const;
/** The two that carry it, and say so on their own covers. */
const CARRYING = ['financial', 'snapshot'] as const;

describe('the weekly cash position has not returned through a shared binding', () => {
  for (const tier of WITHHOLDING) {
    it(`${tier} publishes no modelling binding at all`, () => {
      const p = projectInvestmentReport(row(tier)) as any;
      for (const key of MODELLING_BINDINGS) {
        expect(p.financials[key], `${tier}.financials.${key}`).toBeUndefined();
      }
      // The weekly cash position is the one §4 names, so it is asserted by
      // name as well as by the list above.
      expect(p.financials.weeklyNet).toBeUndefined();
      expect(p.financials.weeklyRepayment).toBeUndefined();
      // Modelled assumptions go with the modelling — a capital-growth rate on
      // a location report is an analysis nobody asked for.
      expect(Object.keys(p.assumptions)).toEqual([]);
      // The ten-year equity chart is modelling by definition.
      expect(p.equitySeries).toEqual([]);
      expect(p.report.drawsFinancialModelling).toBe(false);
    });

    it(`${tier} keeps the price and the rent — an absence is not a blackout`, () => {
      // Withholding the modelling is not withholding the price: the asking
      // price and the indicative rent are facts about the asset the way its
      // land size is, and they stay on every tier.
      const p = projectInvestmentReport(row(tier)) as any;
      expect(typeof p.financials.purchasePrice).toBe('number');
      expect(typeof p.financials.weeklyRent).toBe('number');
      // And the rent states its own basis, so a figure derived from an
      // occupancy assumption the tier does not publish is self-describing.
      expect(String(p.financials.annualRentAtOccupancyLabel)).toMatch(/occupied weeks/);
    });
  }

  for (const tier of CARRYING) {
    it(`${tier} still carries the modelling it exists to carry`, () => {
      const p = projectInvestmentReport(row(tier)) as any;
      expect(p.report.drawsFinancialModelling).toBe(true);
      expect(typeof p.financials.weeklyNet).toBe('number');
      expect(typeof p.financials.lvr).toBe('number');
      expect(Object.keys(p.assumptions).length).toBeGreaterThan(0);
    });
  }
});

describe('the Briefing body carries the assessment, not the modelling', () => {
  const briefingRow = row('briefing') as any;
  const compose = (modelMarkdown: string) => composeCondensedDocument({
    tier: 'briefing',
    modelMarkdown,
    investmentScore: briefingRow.investment_score,
    financialCalculations: briefingRow.financial_calculations,
    parentContent: undefined,
  });
  // Enough of the guide's own headings that the trim keeps the model's work.
  const AUTHORED = ['## Executive Summary\n\nThe verdict.\n',
    '## Location & Demand\n\nWhy here.\n',
    '## Risk Overview\n\nWhat to watch.\n',
    '## Recommendation\n\nProceed to contract review.\n'].join('\n');

  it('declares no financial-modelling section', () => {
    const declared = markdownHeadingsForTier('briefing');
    for (const banned of [
      'Purchase Costs & Annual Holding Cost Breakdown',
      'Rental Assessment, Gross Yield & Net Yield',
      'Loan Structure, Repayments & Cashflow Impact',
      'Sensitivity & Scenario Testing',
      '10-Year Cashflow, Equity & Growth Projection',
    ]) expect(declared, banned).not.toContain(banned);
  });

  it('composes none of them either — measured on the produced markdown', () => {
    const out = compose(AUTHORED);
    // The five chapters used to arrive here from the record regardless of
    // what the model wrote, so asserting the declaration alone would miss it.
    for (const banned of [
      'Purchase Costs & Annual Holding Cost Breakdown',
      'Loan Structure, Repayments & Cashflow Impact',
      '10-Year Cashflow, Equity & Growth Projection',
    ]) expect(out.markdown, banned).not.toContain(banned);
    // And no row of one, in case a heading is ever renamed.
    expect(out.markdown).not.toMatch(/\|\s*Weekly repayment\s*\|/i);
    expect(out.markdown).not.toMatch(/\|\s*Total interest over the term\s*\|/i);
    expect(out.markdown).not.toMatch(/\|\s*Loan-to-value ratio\s*\|/i);
  });

  it('keeps the assessment, which is what a Briefing is for', () => {
    const out = compose(AUTHORED);
    // Removing the modelling must not remove the judgement: the score
    // breakdown and the SWOT are the Briefing's own and are still composed
    // from the record rather than asked of the model.
    expect(out.markdown).toContain('## Investment Score Breakdown');
    expect(out.markdown).toContain('## SWOT Analysis');
    expect(out.markdown).toContain('## Executive Summary');
    expect(out.markdown).toContain('## Recommendation');
  });

  it('the Snapshot keeps its one condensed financial block', () => {
    const snapRow = row('snapshot') as any;
    const out = composeCondensedDocument({
      tier: 'snapshot',
      modelMarkdown: '## Property Summary\n\nA house.\n\n## Key Market Stats\n\n| Metric | Value | Source |\n| --- | --- | --- |\n',
      investmentScore: snapRow.investment_score,
      financialCalculations: snapRow.financial_calculations,
      parentContent: undefined,
    });
    // "Genuinely condensed" is one block, not five chapters — and the
    // Snapshot's own standfirst is "The numbers that matter".
    expect(out.markdown).toContain('## Financial Snapshot');
    expect(out.markdown).not.toContain('10-Year Cashflow, Equity & Growth Projection');
    expect(out.markdown).not.toContain('Sensitivity & Scenario Testing');
  });
});

describe('the covers and the bodies say the same thing', () => {
  it('a tier that names another document for the modelling does not print it', () => {
    // The rule this whole file exists for: a companion note is a promise
    // about what is NOT in this document, and a body that contradicts it is
    // worse than no note at all.
    for (const tier of ['compass', 'strategic', 'briefing'] as const) {
      const p = projectInvestmentReport(row(tier)) as any;
      expect(String(p.report.companionNote), tier)
        .toMatch(/Financial Analysis Report/);
      expect(p.report.drawsFinancialModelling, tier).toBe(false);
    }
  });

  it('each tier\'s standfirst promises what that tier owns', () => {
    const say = (t: string) => String((projectInvestmentReport(row(t)) as any).report.standfirst);
    expect(say('compass')).toMatch(/Where the property is/);
    expect(say('financial')).toMatch(/costs to buy and hold/);
    expect(say('strategic')).toMatch(/verified before contract/);
    expect(say('briefing')).toMatch(/condensed for a decision/);
    expect(say('snapshot')).toMatch(/numbers that matter/);
  });
});
