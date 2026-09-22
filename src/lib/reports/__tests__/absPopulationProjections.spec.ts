/**
 * W3.3 — forward demand, and the premise that had never been checked.
 *
 * Every fixture here is an ASGS-shaped codelist written to the ABS's own
 * conventions. The Bureau's own bytes are verified separately and from CI by
 * `scripts/market/abs-projection-liveness.ts`, because this egress answers
 * 403 to CONNECT for `data.api.abs.gov.au` — which is why a fixture suite
 * alone is never the verification here, only the shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  A_PROJECTION_IS_NOT_A_MEASUREMENT,
  AREA_GRAINS,
  CENTRAL_SERIES_PATTERN,
  ESTIMATE_NAME_PATTERN,
  GRAIN_PRESENCE_FLOOR,
  PROJECTION_GRAIN_LABEL,
  PROJECTION_GRAIN_ORDER,
  PROJECTION_NAME_PATTERN,
  classifyRegionCodes,
  describesTheArea,
  finestPublishedGrain,
  grainOfRegionCode,
  readProjectionStructure,
  surveyPopulationFlows,
  type ProjectionGrain,
} from '@/lib/reports/../../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure';
import type {
  DataStructure,
  StructureDimension,
} from '@/lib/reports/../../../supabase/functions/_shared/reports/market/openData/absDataStructure.pure';

function dim(id: string, codes: string[], opts: { position?: number; isTime?: boolean; names?: string[] } = {}): StructureDimension {
  return {
    id,
    position: opts.position ?? 1,
    isTime: opts.isTime ?? false,
    codes: codes.map((c, i) => ({ id: c, name: opts.names?.[i] ?? `Area ${c}` })),
  };
}

/** n distinct SA2 codes — nine digits, as the ABS publishes them. */
const sa2Codes = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => String(101021007 + i));
const sa3Codes = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => String(10102 + i));
const STATES = ['1', '2', '3', '4', '5', '6', '7', '8'];

describe('the shape of a region code is the grain', () => {
  it('reads each ASGS level from its own fixed width', () => {
    expect(grainOfRegionCode('101021007')).toBe('sa2');
    expect(grainOfRegionCode('10102')).toBe('sa3');
    expect(grainOfRegionCode('101')).toBe('sa4');
    expect(grainOfRegionCode('1')).toBe('state');
    expect(grainOfRegionCode('AUS')).toBe('national');
    expect(grainOfRegionCode('0')).toBe('national');
  });

  it('tells an LGA from an SA3 by the DIMENSION, because the codes are alike', () => {
    // Both are five digits. Nothing in the code itself distinguishes them, so
    // guessing from the code would file every council area as a group of
    // suburbs — a finer grain than the publisher offered.
    expect(grainOfRegionCode('10102')).toBe('sa3');
    expect(grainOfRegionCode('10102', true)).toBe('lga');
  });

  it('refuses a blank rather than parsing it, because Number("") is 0', () => {
    /*
     * The urban-centre register paid for this one: a feature with no point
     * parsed as (0, 0) and was stopped only by the continent bounds. Here a
     * blank that parsed would classify as `national`, which is a real grain
     * and would be filed as coverage.
     */
    expect(grainOfRegionCode('')).toBeNull();
    expect(grainOfRegionCode('   ')).toBeNull();
    expect(grainOfRegionCode('  1  ')).toBe('state');
  });

  it('places nothing it does not recognise', () => {
    expect(grainOfRegionCode('TOT')).toBeNull();
    expect(grainOfRegionCode('9')).toBeNull();
    expect(grainOfRegionCode('12')).toBeNull();
  });
});

describe('the census answers the premise', () => {
  it('counts a codelist by grain and reports what it could not place', () => {
    const census = classifyRegionCodes(dim('REGION', [...sa2Codes(3), ...STATES, 'AUS', 'TOT']));
    expect(census.counts.sa2).toBe(3);
    expect(census.counts.state).toBe(8);
    expect(census.counts.national).toBe(1);
    expect(census.unplaced).toEqual(['TOT']);
    expect(census.dimensionId).toBe('REGION');
  });

  it('a single stray SA2 is not SA2 coverage', () => {
    /*
     * The floor is what stops W3.3's premise being answered `yes` off one row
     * in somebody's codelist. Australia has ~2,500 SA2s; a flow holding three
     * is not publishing them.
     */
    const census = classifyRegionCodes(dim('REGION', [...sa2Codes(3), ...STATES, 'AUS']));
    expect(finestPublishedGrain(census)).toBe('state');
    expect(census.counts.sa2).toBe(3);
  });

  it('and a real SA2 codelist is', () => {
    const census = classifyRegionCodes(dim('REGION', [...sa2Codes(GRAIN_PRESENCE_FLOOR), ...STATES]));
    expect(finestPublishedGrain(census)).toBe('sa2');
  });

  it('prefers the finest grain that cleared the floor', () => {
    const census = classifyRegionCodes(dim('REGION', [...sa3Codes(40), ...STATES, 'AUS']));
    expect(finestPublishedGrain(census)).toBe('sa3');
  });

  it('answers null where nothing cleared it', () => {
    expect(finestPublishedGrain(classifyRegionCodes(dim('REGION', ['TOT', 'XX'])))).toBeNull();
  });

  it('every grain in the order has a label a reader can use', () => {
    for (const grain of PROJECTION_GRAIN_ORDER) {
      expect(PROJECTION_GRAIN_LABEL[grain as ProjectionGrain], grain).toBeTruthy();
      // Database vocabulary never reaches the reader — partnerRoster's rule.
      expect(PROJECTION_GRAIN_LABEL[grain as ProjectionGrain], grain).not.toMatch(/_/);
    }
  });
});

describe('an estimate is refused, and named', () => {
  const flows = [
    { agency: 'ABS', id: 'POP_PROJ', version: '1.0.0', name: 'Population Projections, Australia' },
    { agency: 'ABS', id: 'ERP_ASGS', version: '1.0.0', name: 'Regional Population by SA2' },
    { agency: 'ABS', id: 'ERP_Q', version: '1.0.0', name: 'National, state and territory population' },
    { agency: 'ABS', id: 'BA_SA2', version: '2.0.0', name: 'Building Approvals by SA2' },
  ];

  it('admits a projection and refuses an estimate, keeping both visible', () => {
    const surveyed = surveyPopulationFlows(flows);
    expect(surveyed.map((s) => [s.entry.id, s.kind])).toEqual([
      ['POP_PROJ', 'projection'],
      ['ERP_ASGS', 'estimate'],
      ['ERP_Q', 'estimate'],
    ]);
  });

  it('an estimate wins a tie, because history under a forward heading is the worst outcome', () => {
    const surveyed = surveyPopulationFlows([{
      agency: 'ABS', id: 'X', version: '1.0.0',
      name: 'Population Projections — Estimated Resident Population base',
    }]);
    expect(surveyed[0].kind).toBe('estimate');
  });

  it('the two rules cannot both be satisfied by a clean projection title', () => {
    // A title the ABS actually uses must be admissible, or the refusal rule
    // has swallowed the subject.
    expect(PROJECTION_NAME_PATTERN.test('Population Projections, Australia')).toBe(true);
    expect(ESTIMATE_NAME_PATTERN.test('Population Projections, Australia')).toBe(false);
  });

  it('ignores a flow that is about neither', () => {
    expect(surveyPopulationFlows([{ agency: 'ABS', id: 'CPI', version: '1.0.0', name: 'Consumer Price Index' }]))
      .toEqual([]);
  });
});

describe('the assumption set is the publisher’s, chosen by name', () => {
  const structure = (series: StructureDimension | null): DataStructure => ({
    dimensions: [
      dim('REGION', [...STATES, 'AUS'], { position: 1 }),
      ...(series ? [series] : []),
      dim('TIME_PERIOD', [], { position: 9, isTime: true }),
    ],
  });

  it('matches the central series by its name, never by its position', () => {
    /*
     * A codelist's ORDER is not a ranking and its ids are shorthand. Taking
     * the first code would adopt whichever scenario the Bureau happened to
     * list first — an assumption set nobody chose.
     */
    const reading = readProjectionStructure(structure(dim('PROJECTION_SERIES', ['A', 'B', 'C'], {
      position: 2,
      names: ['High series', 'Medium series', 'Low series'],
    })));
    expect(reading.centralSeries?.id).toBe('B');
    expect(reading.hasSpread).toBe(true);
    expect(reading.seriesNames).toEqual(['High series', 'Medium series', 'Low series']);
  });

  it('leaves the central series UNMATCHED rather than defaulting to the first code', () => {
    const reading = readProjectionStructure(structure(dim('SCENARIO', ['X', 'Y'], {
      position: 2,
      names: ['Scenario one', 'Scenario two'],
    })));
    expect(reading.centralSeries).toBeNull();
    expect(reading.seriesDimensionId).toBe('SCENARIO');
  });

  it('a spread needs BOTH ends, not merely more than one series', () => {
    const reading = readProjectionStructure(structure(dim('SERIES', ['A', 'B'], {
      position: 2,
      names: ['High series', 'Medium series'],
    })));
    expect(reading.hasSpread).toBe(false);
  });

  it('reads the region census and the finest grain off the same structure', () => {
    const reading = readProjectionStructure(structure(null));
    expect(reading.region?.dimensionId).toBe('REGION');
    expect(reading.finestGrain).toBe('state');
    expect(reading.seriesDimensionId).toBeNull();
  });

  it('excludes the time dimension from the geography search', () => {
    const reading = readProjectionStructure(structure(null));
    expect(reading.dimensions.find((d) => d.isTime)?.id).toBe('TIME_PERIOD');
    expect(reading.region?.dimensionId).not.toBe('TIME_PERIOD');
  });

  it('answers null for a structure naming no geography it knows', () => {
    const reading = readProjectionStructure({ dimensions: [dim('MEASURE', ['1'])] });
    expect(reading.region).toBeNull();
    expect(reading.finestGrain).toBeNull();
  });

  it('the central pattern accepts the forms a publisher actually writes', () => {
    for (const name of ['Medium series', 'Series B', 'Central scenario', 'Main projection', 'Principal series']) {
      expect(CENTRAL_SERIES_PATTERN.test(name), name).toBe(true);
    }
  });
});

describe('a projection about a region is not a projection about the area', () => {
  it('only a suburb or a group of suburbs describes the property’s area', () => {
    /*
     * `MARKET_FIGURES_IN_THE_REPORT.md`'s rule applied to a forecast: a
     * benchmark is drawn apart, because a state figure beside a suburb one
     * reads as the suburb's.
     */
    expect(AREA_GRAINS).toEqual(['sa2', 'sa3']);
    expect(describesTheArea('sa2')).toBe(true);
    expect(describesTheArea('sa3')).toBe(true);
    expect(describesTheArea('sa4')).toBe(false);
    expect(describesTheArea('gccsa')).toBe(false);
    expect(describesTheArea('state')).toBe(false);
    expect(describesTheArea('national')).toBe(false);
  });
});

describe('a projection is not a measurement, and the type says so', () => {
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure.ts',
    ),
    'utf8',
  );

  it('never imports or constructs an EvidencePoint', () => {
    /*
     * `EvidencePoint.value`'s own documentation is "The measurement. A zero
     * here is a measured zero", every consumer of it feeds the scorer, and
     * `EvidenceProvider` is a closed union of measurement providers. Handing
     * a modelled forecast that type is how a forecast comes to be scored as a
     * measurement, so the module is asserted unable to produce one.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/EvidencePoint/);
    expect(code).not.toMatch(/marketEvidence\.pure/);
  });

  it('carries the sentence that travels with every projected figure', () => {
    expect(A_PROJECTION_IS_NOT_A_MEASUREMENT).toMatch(/assumption set/i);
    expect(A_PROJECTION_IS_NOT_A_MEASUREMENT).toMatch(/not a measurement/i);
    // It must not promise the future either way.
    expect(A_PROJECTION_IS_NOT_A_MEASUREMENT).toMatch(/not a forecast of what will occur/i);
  });

  it('states no growth rate, no year and no population anywhere in the module', () => {
    // The `planningControlGuide` rule: a guide explains a control and carries
    // no figure, which is what lets it be written in advance and stay true.
    const prose = source.match(/'[^']{20,}'/g) ?? [];
    for (const line of prose) {
      expect(line, line).not.toMatch(/\b(19|20)\d{2}\b/);
      expect(line, line).not.toMatch(/\d+(\.\d+)?\s*%/);
    }
  });
});
