/**
 * A population projection read from the register, and the one block a report
 * may print from it. Five rules, each one a failure already paid for once.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  OWN_AREA_KINDS,
  PROJECTION_AREA_KINDS,
  PROJECTION_AREA_LABEL,
  projectionColumns,
  projectionDescribesTheArea,
  projectionTableBlock,
  readingFromRows,
  type ProjectionRow,
} from '../../../../supabase/functions/_shared/reports/market/openData/projectionRegister.pure';
import { A_PROJECTION_IS_NOT_A_MEASUREMENT } from '../../../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure';

const row = (over: Partial<ProjectionRow>): ProjectionRow => ({
  state: 'QLD',
  release: 'Queensland Government population projections, 2023 edition',
  series: 'Medium series',
  measure: 'persons',
  area_kind: 'sa2',
  area_code: '310011274',
  area: 'Kelvin Grove - Herston',
  area_token: 'KELVIN GROVE HERSTON',
  year: 2021,
  year_kind: 'projected',
  value: 1000,
  publisher: 'Queensland Government Statistician’s Office',
  source_url: 'https://www.qgso.qld.gov.au/',
  licence: 'CC BY 4.0',
  loaded_at: '2026-09-24T03:00:00.000Z',
  ...over,
});

const series = (name: string, values: Array<[number, number, boolean?]>) =>
  values.map(([year, value, base]) => row({ series: name, year, value, year_kind: base ? 'base' : 'projected' }));

describe('a reading is built from the register, never assumed', () => {
  it('groups one area’s rows into every series the publisher released', () => {
    const r = readingFromRows([
      ...series('Medium series', [[2021, 10_000, true], [2026, 10_800], [2031, 11_500]]),
      ...series('Low series', [[2021, 10_000, true], [2026, 10_400], [2031, 10_700]]),
      ...series('High series', [[2021, 10_000, true], [2026, 11_100], [2031, 12_300]]),
    ]);
    expect(r?.series.map((s) => s.series)).toEqual(['High series', 'Low series', 'Medium series']);
    expect(r?.series[0].points[0]).toEqual({ year: 2021, value: 10_000, base: true });
  });

  it('reads persons only, and one edition — the one that reaches furthest', () => {
    const r = readingFromRows([
      ...series('Medium series', [[2021, 10_000, true], [2046, 14_000]]),
      row({ measure: 'households', year: 2046, value: 6_000 }),
      row({ release: '2018 edition', year: 2041, value: 12_000 }),
    ]);
    expect(r?.release).toBe('Queensland Government population projections, 2023 edition');
    expect(r?.series).toHaveLength(1);
    expect(r?.series[0].points.map((p) => p.year)).toEqual([2021, 2046]);
  });

  it('drops a series that is only a base, and reads nothing from nothing', () => {
    expect(readingFromRows(series('Medium series', [[2021, 10_000, true]]))).toBeNull();
    expect(readingFromRows([])).toBeNull();
  });

  it('carries the newest load as the day the register took it', () => {
    const r = readingFromRows([
      row({ year: 2026, loaded_at: '2026-09-24T03:00:00.000Z' }),
      row({ year: 2031, loaded_at: '2026-09-25T03:00:00.000Z' }),
    ]);
    expect(r?.loadedAt).toBe('2026-09-25T03:00:00.000Z');
  });
});

describe('a region is not an area', () => {
  it('lets only SA2, SA3 and the publisher’s suburb describe the property’s own area', () => {
    expect([...OWN_AREA_KINDS].sort()).toEqual(['sa2', 'sa3', 'suburb']);
    for (const k of PROJECTION_AREA_KINDS) {
      expect(projectionDescribesTheArea(k), k).toBe(OWN_AREA_KINDS.includes(k));
      expect(PROJECTION_AREA_LABEL[k].length, k).toBeGreaterThan(5);
    }
  });

  it('prints a coarser projection under the sentence that says so', () => {
    const r = readingFromRows(series('Band C', [[2021, 90_000, true], [2031, 99_000]])
      .map((x) => ({ ...x, area_kind: 'lga' as const, area: 'City of Stirling' })));
    const block = projectionTableBlock(r!);
    expect(block).toMatch(/a region this property sits in rather than its own area/);
    const own = projectionTableBlock(readingFromRows(series('Band C', [[2021, 9_000, true], [2031, 9_900]]))!);
    expect(own).not.toMatch(/region this property sits in/);
  });
});

describe('the block a report may print', () => {
  const reading = readingFromRows([
    ...series('Medium series', [[2021, 10_000, true], [2026, 10_800], [2031, 11_500], [2036, 12_100], [2041, 12_600], [2046, 13_000]]),
    ...series('Low series', [[2021, 10_000, true], [2026, 10_400], [2031, 10_700], [2036, 10_900], [2041, 11_000], [2046, 11_100]]),
  ])!;

  it('labels the base as the estimate it is, and ends on the publisher’s own horizon', () => {
    const cols = projectionColumns(reading);
    expect(cols).toEqual([2021, 2026, 2031, 2036, 2041, 2046]);
    const block = projectionTableBlock(reading);
    expect(block).toContain('2021 (estimated base)');
    expect(block).toMatch(/do not describe the estimated base as a projection/);
  });

  it('prints every series and prefers none', () => {
    const block = projectionTableBlock(reading);
    expect(block).toContain('| Low series |');
    expect(block).toContain('| Medium series |');
    expect(block).toMatch(/None is preferred here/);
  });

  it('carries provenance with every figure, and the statement that it is not a measurement', () => {
    const block = projectionTableBlock(reading);
    expect(block).toContain('Source: Queensland Government Statistician’s Office, Queensland Government population projections, 2023 edition, CC BY 4.0.');
    expect(block).toContain('Taken into this platform\'s register on 2026-09-24.');
    expect(block).toContain(A_PROJECTION_IS_NOT_A_MEASUREMENT);
    expect(block).toMatch(/State no other projected population, growth rate or horizon/);
  });

  it('writes a gap as a dash, never as a zero', () => {
    const gappy = readingFromRows([
      ...series('A', [[2021, 5_000, true], [2031, 5_500]]),
      ...series('B', [[2021, 5_000, true], [2026, 5_200], [2031, 5_600]]),
    ])!;
    const block = projectionTableBlock(gappy);
    expect(block).toMatch(/\| A \| 5,000 \| — \| 5,500 \|/);
    expect(block).not.toMatch(/\| 0 \|/);
  });

  it('opens no table row with the word the regional block forbids', () => {
    // `absRegionalRealData.spec.ts` refuses a row starting "Project…" in the
    // backward-looking table; this block must not collide with that rule.
    expect(projectionTableBlock(reading)).not.toMatch(/\|\s*[Pp]roject/);
  });
});

describe('the columns a reader can compare with the publisher’s own table', () => {
  it('steps back from the horizon in fives when an annual series allows it', () => {
    const annual = readingFromRows(series('Medium series', [
      [2021, 100, true],
      ...Array.from({ length: 25 }, (_, i) => [2022 + i, 101 + i] as [number, number]),
    ]))!;
    expect(projectionColumns(annual)).toEqual([2021, 2026, 2031, 2036, 2041, 2046]);
  });

  it('keeps the horizon when the years are too many for the columns', () => {
    const long = readingFromRows(series('Band C', [
      [2021, 100, true],
      ...Array.from({ length: 9 }, (_, i) => [2026 + i * 5, 110 + i] as [number, number]),
    ]))!;
    const cols = projectionColumns(long);
    expect(cols.length).toBeLessThanOrEqual(6);
    expect(cols[0]).toBe(2021);
    expect(cols[cols.length - 1]).toBe(2066);
  });

  it('falls back to the years it has when none are five apart', () => {
    const sparse = readingFromRows(series('X', [[2021, 100, true], [2023, 101], [2029, 102]]))!;
    expect(projectionColumns(sparse)).toEqual([2021, 2023, 2029]);
  });
});

describe('nothing here can reach the scorer', () => {
  it('constructs no EvidencePoint and imports none', () => {
    const src = readFileSync('supabase/functions/_shared/reports/market/openData/projectionRegister.pure.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/EvidencePoint/);
    expect(src).not.toMatch(/marketEvidence\.pure/);
  });
});
