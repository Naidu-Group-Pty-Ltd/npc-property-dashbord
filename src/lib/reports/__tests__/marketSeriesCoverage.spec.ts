/**
 * What the market series guard can actually read, per directive kind.
 *
 * `CHART_IS_A_CLAIM` promises that "a series of growth rates, medians, rents,
 * vacancy figures or sale counts may contain only values from the table
 * above". `suppressUnevidencedMarketSeries` is the guarantee behind that
 * sentence, and it re-parses the directive grammar privately: it reads a
 * `spark=` / `values=` / `data=` / `series=` option, and a bare head only when
 * the head is entirely numeric.
 *
 * Measured by execution, that left NINE of twelve production forms unread —
 * including `bars` with head pairs, which is the first example in the
 * grammar's own documentation. The heatmap is closed (it is the growth grid
 * that printed `0` for a ten-year CAGR nothing measured, and a grid is
 * unambiguously magnitudes in the table's units).
 *
 * The other eight stay open, and this file is where that is recorded, because
 * a blind spot written into a document is one nobody re-reads. It fails if
 * coverage changes in either direction — closing one of them should be a
 * deliberate act with this list edited, not a silent widening of what gets
 * removed from a client's report.
 */
import { describe, it, expect } from 'vitest';
import { suppressUnevidencedMarketSeries } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure.ts';

/** One fact: a ten-year CAGR of 8.6%. Every case plots it beside a 3.9 it does not state. */
const facts = { rows: [
  { label: 'Price growth, 10 years (compound annual)', value: '8.6%' },
] } as never;

const FORMS: ReadonlyArray<{ name: string; directive: string; read: boolean }> = [
  { name: 'bars (spark option)', read: true,
    directive: '{{bars: Price growth | spark=8.6,3.9}}' },
  { name: 'wheel (numeric head)', read: true,
    directive: '{{wheel: 8.6,3.9 | labels=Growth,Vacancy | title=Market growth}}' },
  { name: 'margin (spark option)', read: true,
    directive: '{{margin: Price growth | spark=8.6,3.9 | note=Ten-year}}' },
  { name: 'heatmap (grid head)', read: true,
    directive: '{{heatmap: 8.6,3.9 / 2.0,1.0 | rows=House,Unit | cols=10yr,5yr | title=Price growth}}' },

  // Still unread. Each carries the same unstated 3.9.
  { name: 'bars (head pairs)', read: false,
    directive: '{{bars: Price growth 10yr 8.6, Price growth 5yr 3.9 | max=100}}' },
  { name: 'donut', read: false,
    directive: '{{donut: Growth 8.6, Other 3.9 | title=Price growth mix}}' },
  { name: 'tiles', read: false,
    directive: '{{tiles: Price growth 8.6 int=0.9, Vacancy 3.9 int=0.2 | title=Market}}' },
  { name: 'waterfall', read: false,
    directive: '{{waterfall: Median price +3.9, Growth =8.6 | title=Price growth}}' },
  { name: 'gauge', read: false,
    directive: '{{gauge: 3.9 | Price growth | Ten-year compound}}' },
  { name: 'pictograph', read: false,
    directive: '{{pictograph: 3/10 | label=Price growth share}}' },
  { name: 'quadrant', read: false,
    directive: '{{quadrant: 8.6,3.9 "Price growth" | xlabel=Median price}}' },
  { name: 'timeline', read: false,
    directive: '{{timeline: 2024 "Median price 3.9", 2025 "Growth 8.6" | title=Price growth}}' },
];

describe('the market series guard, per directive kind', () => {
  for (const form of FORMS) {
    it(`${form.read ? 'judges' : 'does NOT yet judge'} ${form.name}`, () => {
      const { removed } = suppressUnevidencedMarketSeries(form.directive, facts);
      expect(removed.length > 0, form.directive).toBe(form.read);
    });
  }

  it('four of twelve forms are judged, and the list is explicit', () => {
    expect(FORMS.filter((f) => f.read).map((f) => f.name)).toEqual([
      'bars (spark option)',
      'wheel (numeric head)',
      'margin (spark option)',
      'heatmap (grid head)',
    ]);
  });
});

describe('the heatmap grid', () => {
  it('removes a grid carrying a figure the table does not state', () => {
    const { removed, markdown } = suppressUnevidencedMarketSeries(
      '{{heatmap: 8.6,0 / 8.6,8.6 | rows=House,Unit | cols=10yr,5yr | title=Price growth}}',
      facts,
    );
    expect(removed).toHaveLength(1);
    expect(removed[0].kind).toBe('heatmap');
    expect(removed[0].values).toContain(0);
    expect(markdown.trim()).toBe('');
  });

  it('keeps a grid every cell of which the table states', () => {
    const line = '{{heatmap: 8.6,8.6 / 8.6,8.6 | rows=House,Unit | cols=10yr,5yr | title=Price growth}}';
    const { removed, markdown } = suppressUnevidencedMarketSeries(line, facts);
    expect(removed).toHaveLength(0);
    expect(markdown).toBe(line);
  });

  it('leaves a grid alone when no word makes it a market chart', () => {
    const line = '{{heatmap: 3,4 / 2,3 | rows=Bushfire,Flood | cols=Likelihood,Impact}}';
    const { removed, markdown } = suppressUnevidencedMarketSeries(line, facts);
    expect(removed).toHaveLength(0);
    expect(markdown).toBe(line);
  });

  it('a grid head is never mistaken for a title', () => {
    // `8.6,3.9 / 2.0,1.0` carries no word, so this changed no verdict — but a
    // string read as a value list in one place and a title in another is how
    // two readings of one grammar come to disagree.
    const line = '{{heatmap: 8.6,3.9 / 2.0,1.0 | rows=A,B | cols=X,Y}}';
    expect(suppressUnevidencedMarketSeries(line, facts).removed).toHaveLength(0);
  });

  it('is byte-identical on a document that draws no chart at all', () => {
    const prose = 'The ten-year compound annual growth rate is 8.6%.\n\nNo chart here.';
    expect(suppressUnevidencedMarketSeries(prose, facts).markdown).toBe(prose);
  });
});
