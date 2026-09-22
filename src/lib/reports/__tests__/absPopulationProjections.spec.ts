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
import {
  ABS_SDMX_CSV_ACCEPT,
  ABS_SDMX_STRUCTURE_ACCEPT,
  isOurRequestFault,
} from '@/lib/reports/../../../supabase/functions/_shared/reports/market/openData/absDataStructure.pure';
import {
  FORWARD_DEMAND_PUBLISHERS,
  assessForwardDemand,
  forwardDemandCoverageNote,
} from '@/lib/reports/../../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure';
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

describe('W3.3’s word is "everywhere"', () => {
  const JURISDICTIONS = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const;

  it('names a publisher and a product for all eight, and reads none of them', () => {
    /*
     * The acceptance is that "no forward projection" is replaced EVERYWHERE
     * rather than in one state. Loading one jurisdiction replaces the sentence
     * for its properties and leaves it standing for the other seven, which is
     * the failure the criterion names in advance.
     */
    for (const j of JURISDICTIONS) {
      const pub = FORWARD_DEMAND_PUBLISHERS[j];
      expect(pub, j).toBeDefined();
      expect(pub.publisher.length, j).toBeGreaterThan(12);
      expect(pub.product.length, j).toBeGreaterThan(8);
      expect(pub.url, j).toMatch(/^https:\/\//);
      // Truthfully false, all eight. The day one is loaded, the flag and the
      // sentence change together rather than one being forgotten.
      expect(pub.ingested, j).toBe(false);
    }
    expect(Object.keys(FORWARD_DEMAND_PUBLISHERS).sort()).toEqual([...JURISDICTIONS].sort());
  });

  it('never says a jurisdiction publishes no projection', () => {
    for (const j of JURISDICTIONS) {
      const note = forwardDemandCoverageNote({ kind: 'not_loaded' }, j);
      expect(note, j).toContain(FORWARD_DEMAND_PUBLISHERS[j].publisher);
      expect(note, j).toContain(FORWARD_DEMAND_PUBLISHERS[j].url);
      expect(note, j).not.toMatch(/publishes no|has no (?:forward |population )?projection/i);
    }
  });

  it('states no grain for a publisher it cannot reach', () => {
    /*
     * An earlier draft carried the finest grain each jurisdiction publishes
     * at. It was removed rather than softened: nothing in this repository can
     * reach these publishers to check it, so a grain here would be a claim
     * about somebody else's product that no gate could verify.
     */
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure.ts',
      ),
      'utf8',
    );
    // The table LITERAL alone. A wider slice runs into the availability type,
    // whose own documentation discusses grain legitimately — and a guard that
    // reads the wrong span is the `limited certificate` bound again.
    const opens = source.indexOf('export const FORWARD_DEMAND_PUBLISHERS');
    const table = source.slice(opens, source.indexOf('\n};', opens));
    expect(table).toContain('NSW:');
    expect(table).not.toMatch(/\bsa[234]\b/i);
    expect(table).not.toMatch(/grain/i);
    expect(table).not.toMatch(/statistical area/i);
  });
});

describe('the five forward-demand readings', () => {
  const readings = [
    { kind: 'projected', grain: 'sa2' },
    { kind: 'coarser_than_area', grain: 'state' },
    { kind: 'grain_not_published', finest: 'state' },
    { kind: 'not_loaded' },
    { kind: 'unavailable', reason: 'HTTP 503' },
  ] as const;

  it('resolves each from what was actually read', () => {
    expect(assessForwardDemand({ grainHeld: 'sa2', finestPublished: 'sa2', loaded: true }).kind)
      .toBe('projected');
    expect(assessForwardDemand({ grainHeld: 'state', finestPublished: 'state', loaded: true }).kind)
      .toBe('coarser_than_area');
    expect(assessForwardDemand({ grainHeld: null, finestPublished: 'state', loaded: true }).kind)
      .toBe('grain_not_published');
    expect(assessForwardDemand({ grainHeld: null, finestPublished: null, loaded: false }).kind)
      .toBe('not_loaded');
    expect(assessForwardDemand({ grainHeld: 'sa2', finestPublished: 'sa2', loaded: true, failure: 'HTTP 503' }).kind)
      .toBe('unavailable');
  });

  it('a failure outranks everything, because a bad read is not a reading', () => {
    // `grainHeld: 'sa2'` and `loaded: true` beside a failure would otherwise
    // print a projection from a retrieval that did not complete.
    const r = assessForwardDemand({ grainHeld: 'sa2', finestPublished: 'sa2', loaded: true, failure: 'timeout' });
    expect(r.kind).toBe('unavailable');
    if (r.kind !== 'unavailable') return;
    expect(r.reason).toBe('timeout');
  });

  it('writes five distinct sentences', () => {
    const notes = readings.map((r) => forwardDemandCoverageNote(r, 'NSW'));
    expect(new Set(notes).size).toBe(5);
  });

  it('separates a caveat on a printed figure from the absence of one', () => {
    /*
     * The two that would otherwise collapse. `coarser_than_area` qualifies a
     * figure that IS printed; `grain_not_published` says none exists for an
     * area this size. Collapsing them either drops a real reading or implies
     * one that was never held.
     */
    const coarse = forwardDemandCoverageNote({ kind: 'coarser_than_area', grain: 'state' }, 'NSW');
    const absent = forwardDemandCoverageNote({ kind: 'grain_not_published', finest: 'state' }, 'NSW');
    expect(coarse).toMatch(/drawn apart/i);
    expect(coarse).toMatch(/region this property sits in/i);
    expect(absent).toMatch(/No population projection is held/i);
    expect(absent).not.toMatch(/drawn apart/i);
  });

  it('every reading carries the sentence, or says why there is no figure', () => {
    for (const r of readings) {
      const note = forwardDemandCoverageNote(r, 'VIC');
      const qualifies = note.includes('not a measurement') || /no projected figure|No population projection is held/i.test(note);
      expect(qualifies, r.kind).toBe(true);
    }
  });

  it('rates nothing, in either direction', () => {
    /*
     * §9's rule and its mirror: an absence may not be rated, and a presence
     * may not be either. This module prints no level and no direction — a
     * projection that "shows strong growth" is a conclusion, not a retrieval.
     */
    const forbidden = /\b(strong|weak|low|high|minimal|negligible|favourable|robust|poor|growing|declining|rising|falling)\b/i;
    for (const j of ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT', 'ZZ']) {
      for (const r of readings) {
        expect(forwardDemandCoverageNote(r, j), `${j}/${r.kind}`).not.toMatch(forbidden);
      }
    }
  });

  it('an unknown jurisdiction states the limit as ours', () => {
    const note = forwardDemandCoverageNote({ kind: 'not_loaded' }, 'ZZ');
    expect(note).toMatch(/limit of this report rather than a finding about the area/i);
  });

  it('states no figure, no year and no rate in any branch', () => {
    for (const j of ['NSW', 'ZZ']) {
      for (const r of readings) {
        const note = forwardDemandCoverageNote(r, j);
        expect(note, r.kind).not.toMatch(/\b(19|20)\d{2}\b/);
        expect(note, r.kind).not.toMatch(/\d+(\.\d+)?\s*%/);
      }
    }
  });
});

describe('the instrument must not fail the way its subject fails', () => {
  it('names one Accept header, because it was typed twice and then wrong', () => {
    /*
     * The first run of the projection probe sent
     * `application/vnd.sdmx.structure+xml;version=1.0` — XML instead of JSON,
     * with no wildcard fallback — took HTTP 406 on every flow, and printed
     * "THE PREMISE DOES NOT HOLD" over `flows read 0`. The approvals probe
     * already carried the working header as a literal, TWICE.
     */
    expect(ABS_SDMX_STRUCTURE_ACCEPT).toContain('application/vnd.sdmx.structure+json');
    expect(ABS_SDMX_STRUCTURE_ACCEPT).toContain('*/*');
    expect(ABS_SDMX_CSV_ACCEPT).toContain('text/csv');

    const probes = ['abs-projection-liveness.ts', 'abs-approvals-liveness.ts'].map((f) =>
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/market', f), 'utf8'));
    for (const source of probes) {
      // No probe may retype either header.
      expect(source).not.toMatch(/Accept:\s*'application\/vnd\.sdmx/);
      expect(source).not.toMatch(/Accept:\s*'text\/csv/);
      expect(source).toContain('ABS_SDMX_STRUCTURE_ACCEPT');
    }
  });

  it('classifies content negotiation as OUR fault, not the publisher’s', () => {
    // 406 is the server saying it cannot serve what we asked for; 415 that it
    // cannot read what we sent. Both are statements about our request.
    expect(isOurRequestFault(406)).toBe(true);
    expect(isOurRequestFault(415)).toBe(true);
    // Everything else stays theirs.
    for (const status of [200, 301, 400, 401, 403, 404, 429, 500, 502, 503, 504]) {
      expect(isOurRequestFault(status), String(status)).toBe(false);
    }
  });

  it('the probe cannot print a verdict over zero measurements', () => {
    /*
     * The second defect of that run, independent of the header: the verdict
     * block reached "THE PREMISE DOES NOT HOLD" with `findings.length === 0`.
     * A conclusion drawn from nothing is worse than no conclusion, so the
     * guard is asserted in the probe's source — it has no exported surface to
     * test, and a defect this shape is what a source scan is for.
     */
    const probe = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/market/abs-projection-liveness.ts'),
      'utf8',
    );
    const verdict = probe.slice(probe.indexOf("h('3 · What W3.3"));
    const guard = verdict.indexOf('findings.length === 0');
    const conclusion = verdict.indexOf('THE PREMISE DOES NOT HOLD');
    expect(guard).toBeGreaterThan(-1);
    expect(conclusion).toBeGreaterThan(-1);
    // The guard has to come FIRST, or it guards nothing.
    expect(guard).toBeLessThan(conclusion);
    expect(verdict.slice(guard, guard + 400)).toContain('ours(');
  });
});
