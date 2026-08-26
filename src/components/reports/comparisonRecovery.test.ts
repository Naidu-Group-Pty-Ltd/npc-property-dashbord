/**
 * What the modal does with a stored `property_comparisons` row when the
 * request that produced it timed out client-side.
 *
 * The fixtures mirror the two storage shapes `docs/reports/COMPARISON.md`
 * records: Shape A (structured columns populated) and Shape B (columns NULL,
 * the model's raw text kept whole for salvage). The modal may only adopt
 * Shape A inline; Shape B belongs to the viewer, which knows how to read it —
 * adopting it here would re-create the raw-JSON-as-executive-summary screen
 * the viewer was cured of.
 */
import { describe, expect, it } from 'vitest';
import {
  analysisFromComparisonRow,
  isDisplayableComparisonRow,
  matchesSelectedReportIds,
} from './comparisonRecovery.pure';

const shapeARow = () => ({
  id: 'cmp-1',
  executive_summary: 'Three properties in New South Wales.',
  rankings: [
    { propertyNumber: 1, rank: 1, finalScore: 88.5 },
    { propertyNumber: 2, rank: 2, finalScore: 81.0 },
  ],
  financial_comparison: { bestYield: { propertyNumber: 1, reason: 'yield' } },
  location_comparison: { bestSchools: { propertyNumber: 2, reason: 'schools' } },
  risk_comparison: { lowestRisk: { propertyNumber: 2, reason: 'stable' } },
  investor_matches: [{ propertyNumber: 1, investorTypes: ['Capital Growth Investor'] }],
  red_flags: [{ propertyNumber: 1, concerns: ['vacancy'], severity: 'medium' }],
  recommendations: { bestOverall: { propertyNumber: 1, reason: 'best overall' } },
});

/** Shape B: raw response in executive_summary, every structured column NULL. */
const shapeBRow = () => ({
  id: 'cmp-2',
  executive_summary: '{"executiveSummary": "cut off mid-tok',
  rankings: null,
  financial_comparison: null,
  location_comparison: null,
  risk_comparison: null,
  investor_matches: null,
  red_flags: null,
  recommendations: null,
});

describe('rebuilding the analysis from a stored row', () => {
  it('maps every structured column onto the shape the modal renders', () => {
    const a = analysisFromComparisonRow(shapeARow());
    expect(a.executiveSummary).toContain('New South Wales');
    expect(a.rankings).toHaveLength(2);
    expect(a.financialComparison).toHaveProperty('bestYield');
    expect(a.locationComparison).toHaveProperty('bestSchools');
    expect(a.riskComparison).toHaveProperty('lowestRisk');
    expect(a.investorMatches).toHaveLength(1);
    expect(a.redFlags).toHaveLength(1);
    expect(a.finalRecommendation).toHaveProperty('bestOverall');
  });

  it('reads NULL columns as empty, never as undefined', () => {
    // Every consumer in the modal iterates or destructures these; an undefined
    // where an array belongs is a render crash on a real stored row.
    const a = analysisFromComparisonRow(shapeBRow());
    expect(a.rankings).toEqual([]);
    expect(a.investorMatches).toEqual([]);
    expect(a.redFlags).toEqual([]);
    expect(a.financialComparison).toEqual({});
    expect(a.finalRecommendation).toEqual({});
  });
});

describe('which stored rows the modal may adopt inline', () => {
  it('adopts a row whose ranking makes it a comparison', () => {
    expect(isDisplayableComparisonRow(shapeARow())).toBe(true);
  });

  it('refuses the raw-blob shape — that row belongs to the viewer', () => {
    expect(isDisplayableComparisonRow(shapeBRow())).toBe(false);
  });

  it('refuses a ranking of one, the same floor the producer enforces', () => {
    expect(isDisplayableComparisonRow({ rankings: [{ propertyNumber: 1 }] })).toBe(false);
    expect(isDisplayableComparisonRow(null)).toBe(false);
    expect(isDisplayableComparisonRow(undefined)).toBe(false);
  });
});

describe('matching a stored row to the selected reports', () => {
  it('matches the same ids in any order', () => {
    expect(matchesSelectedReportIds(['b', 'a', 'c'], ['a', 'b', 'c'])).toBe(true);
  });

  it('refuses a subset, a superset and a different set', () => {
    expect(matchesSelectedReportIds(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(matchesSelectedReportIds(['a', 'b', 'c', 'd'], ['a', 'b', 'c'])).toBe(false);
    expect(matchesSelectedReportIds(['a', 'b', 'x'], ['a', 'b', 'c'])).toBe(false);
  });

  it('refuses a row with no report_ids at all', () => {
    expect(matchesSelectedReportIds(null, ['a'])).toBe(false);
    expect(matchesSelectedReportIds(undefined, ['a'])).toBe(false);
    expect(matchesSelectedReportIds('a', ['a'])).toBe(false);
  });
});
