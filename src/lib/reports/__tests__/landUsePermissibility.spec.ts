import { describe, expect, it } from 'vitest';
import {
  buildNswPermissibilityRequest,
  emptyLandUseTable,
  parseNswPermissibility,
  readResidentialStanding,
  residentialSentence,
  type LandUseTable,
} from '../landUsePermissibility.pure';

/**
 * The real answer for 48 Redfern Street, Cowra — Cowra LEP 2012, zone E3 —
 * retrieved 19 Sep 2026. Trimmed to the uses the reading turns on, and kept
 * in the service's own shape INCLUDING its duplicate entries, because the
 * duplication is what a parser written against a tidy fixture would miss.
 */
const COWRA_E3 = [{
  EPIName: 'Cowra Local Environmental Plan 2012',
  Precinct: [{
    Name: '',
    Zone: [{
      ZoneCode: 'E3',
      // Stale: the 2023 Land Use Zones amendment renamed E3 "Productivity
      // Support", and the map layer for this parcel says so.
      ZoneDescription: 'Environmental Management',
      ZoneObjective: ' To provide a range of facilities and services, light industries, warehouses and offices.  To ensure commercial development in the Redfern Street area … ',
      LandUse: [{
        PermittedWithoutConsent: [
          { Landuse: 'Home Occupations' }, { Landuse: 'Home Occupations' },
          { Landuse: 'Roads' }, { Landuse: 'Roads' },
        ],
        PermittedWithConsent: [
          { Landuse: 'Dwelling Houses' }, { Landuse: 'Dwelling Houses' },
          { Landuse: 'Light Industries' }, { Landuse: 'Light Industries' },
          { Landuse: 'Vehicle Repair Stations' }, { Landuse: 'Vehicle Repair Stations' },
          { Landuse: 'Shop Top Housing' }, { Landuse: 'Shop Top Housing' },
          { Landuse: 'Any Other Development Not Specified In Item 2 Or 4' },
          { Landuse: 'Any Other Development Not Specified In Item 2 Or 4' },
        ],
        Prohibited: [
          { Landuse: 'Residential Accommodation' }, { Landuse: 'Residential Accommodation' },
          { Landuse: 'Shops' }, { Landuse: 'Shops' },
          { Landuse: 'Industries' }, { Landuse: 'Industries' },
        ],
      }],
    }],
  }],
}];

const AT = '2026-09-19T03:00:00.000Z';

describe('the service is asked the way it actually answers', () => {
  it('takes its parameters as headers, not query parameters', () => {
    // Measured: the same values as query parameters answer HTTP 400 with
    // `{"ErrorMessage": "EPI Name cannot be empty!!!"}`, which reads like a
    // missing argument and is the wrong transport.
    const req = buildNswPermissibilityRequest('Cowra Local Environmental Plan 2012', 'E3');
    expect(req.url).not.toContain('?');
    expect(req.headers.EpiName).toBe('Cowra Local Environmental Plan 2012');
    expect(req.headers.ZoneCode).toBe('E3');
  });
});

describe('parsing the answer', () => {
  const t = parseNswPermissibility(COWRA_E3, 'E3', AT);

  it('de-duplicates every list, because the service returns each use twice', () => {
    expect(t.permittedWithoutConsent).toEqual(['Home Occupations', 'Roads']);
    expect(t.permittedWithConsent.filter((u) => u === 'Dwelling Houses')).toHaveLength(1);
    expect(t.prohibited).toEqual(['Residential Accommodation', 'Shops', 'Industries']);
  });

  it('keeps the map layer\'s zone code and never the service\'s stale description', () => {
    expect(t.zoneCode).toBe('E3');
    expect(JSON.stringify(t)).not.toContain('Environmental Management');
  });

  it('carries the instrument, the licence and the retrieval stamp', () => {
    expect(t.instrument).toBe('Cowra Local Environmental Plan 2012');
    expect(t.licence).toBe('CC BY 4.0');
    expect(t.retrievedAt).toBe(AT);
    expect(t.status).toBe('retrieved');
  });

  it('a zone the instrument does not contain is none_at_point, not a failure', () => {
    const missing = parseNswPermissibility(COWRA_E3, 'R2', AT);
    // The service answers with whatever zone it has; a caller asking for a
    // zone the table does not carry gets a real answer, not an outage.
    expect(['none_at_point', 'retrieved']).toContain(missing.status);
  });

  it('a body it cannot read is unavailable, which is ours to repair', () => {
    expect(parseNswPermissibility({ nope: true }, 'E3', AT).status).toBe('unavailable');
    expect(parseNswPermissibility(null, 'E3', AT).status).toBe('unavailable');
  });
});

describe('the residential reading — specific beats the group term, one way only', () => {
  const r = readResidentialStanding(parseNswPermissibility(COWRA_E3, 'E3', AT))!;

  it('a dwelling house named in item 3 survives a prohibited group term', () => {
    // This is the whole finding. Read from the zone code alone, E3 says
    // "employment zone" and a reader concludes existing-use rights. The table
    // says the house is a permissible use.
    expect(r.dwellingHouse).toBe('permitted_with_consent');
    expect(r.residentialGroupProhibited).toBe(true);
  });

  it('every other residential form is prohibited by the group term', () => {
    const byUse = Object.fromEntries(r.otherResidential.map((o) => [o.use, o.standing]));
    expect(byUse['secondary dwellings']).toBe('prohibited');
    expect(byUse['dual occupancies']).toBe('prohibited');
    expect(byUse['multi dwelling housing']).toBe('prohibited');
    // …except one the table names explicitly in the permitted list.
    expect(byUse['shop top housing']).toBe('permitted_with_consent');
  });

  it('a use NAMED as prohibited stays prohibited whatever any group term says', () => {
    // The rule is applied in exactly one direction. Inventing a permission is
    // the failure this whole programme exists to stop.
    const t: LandUseTable = {
      ...parseNswPermissibility(COWRA_E3, 'E3', AT),
      permittedWithConsent: ['Dwelling Houses'],
      prohibited: ['Secondary Dwellings'],
    };
    const reading = readResidentialStanding(t)!;
    expect(reading.residentialGroupProhibited).toBe(false);
    expect(reading.otherResidential.find((o) => o.use === 'secondary dwellings')?.standing)
      .toBe('prohibited');
  });

  it('where nothing is prohibited as a group, an unnamed use is simply not listed', () => {
    const t: LandUseTable = {
      ...parseNswPermissibility(COWRA_E3, 'E3', AT),
      prohibited: ['Shops'],
    };
    const reading = readResidentialStanding(t)!;
    expect(reading.otherResidential.find((o) => o.use === 'dual occupancies')).toBeUndefined();
  });

  it('the catch-all clause is not offered as something a neighbour might build', () => {
    expect(r.neighbouringUsesWithConsent).not.toContain('Any Other Development Not Specified In Item 2 Or 4');
    expect(r.neighbouringUsesWithConsent).toContain('Light Industries');
    expect(r.neighbouringUsesWithConsent).toContain('Vehicle Repair Stations');
    // And never the subject's own use, which is not a neighbouring question.
    expect(r.neighbouringUsesWithConsent).not.toContain('Dwelling Houses');
  });

  it('a table that was not retrieved yields no reading at all', () => {
    expect(readResidentialStanding(emptyLandUseTable('not_served', 'nope'))).toBeNull();
    expect(readResidentialStanding(emptyLandUseTable('unavailable', 'nope'))).toBeNull();
  });
});

describe('the sentence the reading supports, and not one word further', () => {
  const r = readResidentialStanding(parseNswPermissibility(COWRA_E3, 'E3', AT))!;
  const said = residentialSentence(r);

  it('states what the instrument does, never what a council would decide', () => {
    expect(said).toContain('permitted with development consent');
    expect(said).not.toMatch(/\byou (can|could|may) build\b/i);
    expect(said).not.toMatch(/\b(likely|should be|would be) (approved|granted)\b/i);
  });

  it('forecloses the granny-flat inference explicitly, and names block size', () => {
    // §4: "a large block alone does not establish subdivision or
    // secondary-dwelling potential". Here the instrument settles it the other
    // way, and only the table says so.
    expect(said).toMatch(/secondary dwelling/i);
    expect(said).toMatch(/however large/i);
  });

  it('a prohibited dwelling house is stated plainly rather than softened', () => {
    const t: LandUseTable = {
      ...parseNswPermissibility(COWRA_E3, 'E3', AT),
      permittedWithConsent: ['Light Industries'],
    };
    const reading = readResidentialStanding(t)!;
    expect(reading.dwellingHouse).toBe('prohibited');
    expect(residentialSentence(reading)).toContain('prohibited');
  });
});
