/**
 * A live web search is not a retrieval — for crime and climate too.
 *
 * Two contradictions inside one document, the Investment Compass delivered for
 * 9 Hollow Street, Golden Square on 21 Sep 2026, read off the PDF.
 *
 * CRIME. Page 20: "the latest violent-crime rate per 100,000 residents is
 * lower than the Greater Bendigo benchmark", "using Crime Statistics Agency
 * Victoria data", another tool "summarises Golden Square's crime exposure as
 * moderate", the suburb "recorded 522 crimes in a recent year". Pages 24, 25
 * and 26 say four times that no recorded-crime register is integrated and that
 * "no crime counts, rates or safety scores are held".
 *
 * CLIMATE. Pages 8 and 28 state annual rainfall of 511.3 mm from the SILO grid
 * cell with its 1991–2020 window named. Page 19 states "about 420–430 mm" and
 * names no source.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CLIMATE_WEB_SEARCH_RULE,
  CRIME_WEB_SEARCH_RULE,
  webSearchIsNotARetrieval,
} from '../../../../supabase/functions/_shared/reports/registerAuthority.pure';
import { crimeStatBlocks } from '../../../../supabase/functions/_shared/reports/crimePromptBlocks.pure';
import { climateStatBlocks } from '../../../../supabase/functions/_shared/reports/climatePromptBlocks.pure';

describe('the clause reaches both registers, held and absent', () => {
  it('is on the crime block when nothing is integrated', () => {
    // The state the delivered document was in.
    expect(crimeStatBlocks({})).toContain(CRIME_WEB_SEARCH_RULE);
    expect(crimeStatBlocks({ crimeStatistics: {} })).toContain(CRIME_WEB_SEARCH_RULE);
  });

  it('is on the crime block when a register DID answer', () => {
    // A web figure must not be mixed with register figures either — page 20
    // compared an unheld rate against an LGA benchmark.
    const held = crimeStatBlocks({
      crimeStatistics: {
        totalLast12Months: 522, area: 'Golden Square', areaKind: 'suburb',
        source: 'Crime Statistics Agency Victoria', referencePeriod: 'year to December 2025',
      },
    });
    expect(held).toContain('522');
    expect(held).toContain(CRIME_WEB_SEARCH_RULE);
  });

  it('is on the climate block, held and absent', () => {
    expect(climateStatBlocks({})).toContain(CLIMATE_WEB_SEARCH_RULE);
    const held = climateStatBlocks({
      climate: { annualRainfallMm: 511.3, normalPeriod: '1991–2020' },
    } as never);
    expect(held).toContain(CLIMATE_WEB_SEARCH_RULE);
  });
});

describe('what the clause says, and what it is careful not to say', () => {
  const rule = CRIME_WEB_SEARCH_RULE;

  it('names the kinds of page a model actually finds', () => {
    for (const kind of ['community report', 'news page', 'listing portal', 'government media release']) {
      expect(rule).toContain(kind);
    }
  });

  it('refuses the figure, the rate, the ranking and the attribution', () => {
    // Every one of these is something page 20 did.
    for (const refused of ['a figure', 'a rate', 'a ranking', 'attributed to an agency this report did not ask']) {
      expect(rule).toContain(refused);
    }
    expect(rule).toMatch(/low \/ moderate \/ average/);
    expect(rule).toMatch(/used to compare this area with another/);
  });

  it('permits the qualitative discussion, because a bare prohibition is routed around', () => {
    // `rentalEvidence`'s rule: a prohibition with no permitted action is one a
    // model routes around.
    expect(rule).toContain('qualitatively is fine');
    expect(rule).toContain('naming none is the correct answer');
  });

  it('is one sentence pattern, parameterised — never two copies', () => {
    expect(CRIME_WEB_SEARCH_RULE).toBe(webSearchIsNotARetrieval('crime', 'the recorded-crime register'));
    expect(CLIMATE_WEB_SEARCH_RULE)
      .toBe(webSearchIsNotARetrieval('climate', 'a measured reading at this property'));
    // The two differ only in what they name.
    expect(CRIME_WEB_SEARCH_RULE.replace(/crime/g, 'X').replace(/the recorded-X register/, 'R'))
      .toBe(CLIMATE_WEB_SEARCH_RULE.replace(/climate/g, 'X').replace(/a measured reading at this property/, 'R'));
  });

  it('neither block composes its own copy of the wording', () => {
    // Two copies of one rule is how the two come to disagree.
    for (const f of [
      'supabase/functions/_shared/reports/crimePromptBlocks.pure.ts',
      'supabase/functions/_shared/reports/climatePromptBlocks.pure.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/_WEB_SEARCH_RULE/);
      expect(src).not.toMatch(/is not a retrieval/i);
    }
  });
});

describe('the prohibitions it sits beside are untouched', () => {
  it('keeps the crime block’s own refusals', () => {
    const absent = crimeStatBlocks({});
    expect(absent).toContain('do NOT print a crime table, a safety score, a rating or an estimated rate');
    expect(absent).toContain('No recorded-crime register is integrated');
  });

  it('keeps the climate block’s own refusals', () => {
    const absent = climateStatBlocks({});
    expect(absent).toContain('do NOT print a climate table, name a climate zone, or rate any hazard');
  });
});
