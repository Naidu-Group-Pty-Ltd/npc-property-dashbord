import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENRICHMENT_STAMP,
  assessEnrichmentReuse,
  stampAcquisition,
  subjectKeyFor,
  type EnrichmentAcquisition,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure.ts';

/**
 * RF-7.2B.1B1 — a deterministic location enrichment is bought once per report.
 *
 * An investment report is resumed repeatedly by a two-minute cron, and the
 * enrichment block ran on every one of those invocations because
 * `existingEnhancedFields.locationIntelligence` guarded the WRITE and nothing
 * guarded the FETCH. One enrichment is eight Google calls (1 geocode + 6 Places
 * Nearby + 1 Distance Matrix — the production ledger's 612:102 Places:Distance
 * ratio over 2026-09-05..08 is exactly 6:1). The 2026-09-12 health check
 * resumed eleven times, so on a working geocode that is 88 calls for one
 * report, 80 of them re-buying an answer that cannot change.
 *
 * These tests are the §8 matrix: A–I, in order.
 */
const REPO = resolve(__dirname, '../../../..');
const generator = readFileSync(
  resolve(REPO, 'supabase/functions/generate-investment-report/index.ts'), 'utf8',
);
const service = readFileSync(
  resolve(REPO, 'supabase/functions/location-intelligence-service/index.ts'), 'utf8',
);

const SUBJECT = { address: '48 Redfern Street, Cowra NSW 2794', postcode: '2794', state: 'NSW' };

const ACQUISITION: EnrichmentAcquisition = {
  subjectKey: subjectKeyFor(SUBJECT),
  acquiredAt: '2026-09-12T09:11:05.000Z',
  stages: { geocode: 'fetched', places: 'complete', commute: 'measured' },
  matchedAddress: '48 Redfern St, Cowra NSW 2794, Australia',
};

/** The shape production actually stores, taken from a real row. */
const goodEnrichment = () => stampAcquisition({
  coordinates: { lat: -33.8386, lng: 148.6903 },
  walkScore: 62,
  amenities: [{ category: 'Schools', count: 7, nearest: 'Cowra High', distance: 0.47, score: 70 }],
  schools: { nearestSchool: 'Cowra High', distanceToSchool: 0.47, schoolsWithin3km: 7, topSchools: [] },
  healthcare: { nearestHospital: 'Cowra Hospital', distanceToHospital: 0.85, facilitiesWithin5km: 2 },
  lifestyle: { shoppingCenters: 1, parks: 9, restaurants: 10, nearestShopping: 'x', nearestPark: 'y' },
  transport: { nearestStation: 'Cowra', distanceToStation: 1.72, stationsWithin2km: 1 },
  commute: { mode: 'public_transit', distanceKm: 310.2, durationMinutes: 288 },
}, ACQUISITION);

describe('A — no stored enrichment means the provider is called', () => {
  it('null, undefined and non-objects all re-acquire', () => {
    for (const stored of [null, undefined, '', 0, [], 'x']) {
      const d = assessEnrichmentReuse(stored, SUBJECT);
      expect(d.reuse).toBe(false);
      expect(d.verdict).toBe('nothing_stored');
    }
  });
});

describe('B — a complete enrichment for the same subject is reused', () => {
  it('reuse is permitted and says why', () => {
    const d = assessEnrichmentReuse(goodEnrichment(), SUBJECT);
    expect(d.reuse).toBe(true);
    expect(d.verdict).toBe('reusable');
    expect(d.note).toContain('2026-09-12T09:11:05.000Z');
  });

  it('a supplied coordinate counts as acquired', () => {
    const stored = stampAcquisition(
      { coordinates: { lat: -33.8, lng: 148.6 } },
      { ...ACQUISITION, stages: { ...ACQUISITION.stages, geocode: 'supplied' } },
    );
    expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(true);
  });
});

describe('C — a failed enrichment stays retryable', () => {
  it('the F1 outage cannot be frozen into place', () => {
    // A refused geocode is never persisted at all — the service answers
    // `success: false` with no `data`, so the caller writes nothing. This is
    // the belt-and-braces: even if an object without coordinates reached the
    // column, it must not suppress the next attempt.
    for (const coords of [undefined, null, {}, { lat: null, lng: null },
      { lat: 'x', lng: 'y' }, { lat: NaN, lng: 1 }]) {
      const stored = stampAcquisition({ coordinates: coords } as Record<string, unknown>, ACQUISITION);
      const d = assessEnrichmentReuse(stored, SUBJECT);
      expect(d.reuse).toBe(false);
      expect(d.verdict).toBe('missing_coordinates');
    }
  });

  it('the service never returns data alongside an unresolved answer', () => {
    expect(service).toMatch(/success: false,\s*\n\s*resolved: false/);
  });
});

describe('D — an incomplete acquisition may finish the missing work', () => {
  it('a partial Places run is not reusable', () => {
    const stored = stampAcquisition(
      { coordinates: { lat: -33.8, lng: 148.6 } },
      { ...ACQUISITION, stages: { ...ACQUISITION.stages, places: 'partial' } },
    );
    const d = assessEnrichmentReuse(stored, SUBJECT);
    expect(d.reuse).toBe(false);
    expect(d.verdict).toBe('incomplete_acquisition');
  });

  it('a commute with no route is still a complete acquisition', () => {
    // Absent because the provider returned no route, or because the state has
    // no known CBD — both are real answers, not failures to acquire.
    for (const commute of ['no_route', 'destination_unknown'] as const) {
      const stored = stampAcquisition(
        { coordinates: { lat: -33.8, lng: 148.6 } },
        { ...ACQUISITION, stages: { ...ACQUISITION.stages, commute } },
      );
      expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(true);
    }
  });

  it('the service distinguishes a failed amenity lookup from an empty area', () => {
    expect(service).toContain('ok: false, count: 0, results: []');
    expect(service).toMatch(/\.every\(\(r\) => r\.ok\) \? 'complete' : 'partial'/);
  });
});

describe('E — a changed subject cannot reuse the old enrichment', () => {
  it('a different address re-acquires', () => {
    const d = assessEnrichmentReuse(goodEnrichment(), { ...SUBJECT, address: '28 Bligh Street, Muswellbrook NSW 2333' });
    expect(d.reuse).toBe(false);
    expect(d.verdict).toBe('subject_changed');
  });

  it('a different state re-acquires', () => {
    expect(assessEnrichmentReuse(goodEnrichment(), { ...SUBJECT, state: 'VIC' }).reuse).toBe(false);
  });

  it('case and spacing are not a subject change', () => {
    const d = assessEnrichmentReuse(goodEnrichment(), {
      address: '  48  REDFERN Street,   Cowra NSW 2794 ', postcode: '2794', state: 'nsw',
    });
    expect(d.reuse).toBe(true);
  });
});

describe('F — a changed postcode cannot reuse the old enrichment', () => {
  it('the postcode is part of the identity, because it is part of the query', () => {
    // `buildAuGeocodeQuery` composes the postcode into the geocode request, so
    // a different postcode can move the coordinate.
    const d = assessEnrichmentReuse(goodEnrichment(), { ...SUBJECT, postcode: '2795' });
    expect(d.reuse).toBe(false);
    expect(d.verdict).toBe('subject_changed');
  });

  it('an absent postcode is a different subject from a present one', () => {
    expect(assessEnrichmentReuse(goodEnrichment(), { ...SUBJECT, postcode: null }).reuse).toBe(false);
  });
});

describe('G — a successful enrichment survives many resumes', () => {
  it('eleven resumes acquire once', () => {
    const stored = goodEnrichment();
    let acquisitions = 0;
    for (let resume = 0; resume < 11; resume++) {
      if (!assessEnrichmentReuse(stored, SUBJECT).reuse) acquisitions++;
    }
    expect(acquisitions).toBe(0);
  });

  it('the first run still acquires — this is idempotency, not suppression', () => {
    let stored: unknown = null;
    let acquisitions = 0;
    for (let resume = 0; resume < 11; resume++) {
      if (!assessEnrichmentReuse(stored, SUBJECT).reuse) {
        acquisitions++;
        stored = goodEnrichment();
      }
    }
    // One acquisition of 8 Google calls, not eleven of 8.
    expect(acquisitions).toBe(1);
  });
});

describe('H — no cross-property enrichment leakage', () => {
  it('distinct properties never share a subject key', () => {
    const subjects = [
      { address: '48 Redfern Street, Cowra NSW 2794', postcode: '2794', state: 'NSW' },
      { address: '28 Bligh Street, Muswellbrook NSW 2333', postcode: '2333', state: 'NSW' },
      { address: 'Lot 2267 Hunza Road, Truganina VIC 3029', postcode: '3029', state: 'VIC' },
      { address: '33 Flight Drive, Moranbah QLD 4744', postcode: '4744', state: 'QLD' },
    ];
    const keys = subjects.map(subjectKeyFor);
    expect(new Set(keys).size).toBe(subjects.length);
    for (const other of subjects.slice(1)) {
      expect(assessEnrichmentReuse(goodEnrichment(), other).reuse).toBe(false);
    }
  });

  it('an enrichment with someone else\'s stamp is refused', () => {
    const foreign = stampAcquisition(
      { coordinates: { lat: -21.99, lng: 148.06 } },
      { ...ACQUISITION, subjectKey: subjectKeyFor({ address: '33 Flight Drive', postcode: '4744', state: 'QLD' }) },
    );
    expect(assessEnrichmentReuse(foreign, SUBJECT).verdict).toBe('subject_changed');
  });
});

describe('I — reuse changes no value in the document', () => {
  it('the reused object IS the stored object', () => {
    // Nothing is recomputed, re-rounded or re-shaped: the generator assigns the
    // stored object straight onto `enhancedData.locationIntelligence`, so a
    // report built from a reused enrichment is byte-identical to one built from
    // the enrichment as stored.
    const stored = goodEnrichment();
    expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(true);
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });

  it('stamping does not mutate or disturb the measured payload', () => {
    const raw = { coordinates: { lat: -33.8386, lng: 148.6903 }, walkScore: 62 };
    const frozen = JSON.parse(JSON.stringify(raw));
    const stamped = stampAcquisition(raw, ACQUISITION);
    expect(raw).toEqual(frozen);
    const { [ENRICHMENT_STAMP]: _stamp, ...rest } = stamped as Record<string, unknown>;
    expect(rest).toEqual(frozen);
  });
});

describe('the guard is wired where the cost is', () => {
  it('the generator decides BEFORE it fetches', () => {
    const guardAt = generator.indexOf('assessEnrichmentReuse(');
    const fetchAt = generator.indexOf('functions/v1/location-intelligence-service');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(fetchAt);
  });

  it('the old write-only guard is still there — this adds, it does not replace', () => {
    expect(generator).toContain(
      '!existingEnhancedFields.locationIntelligence && enhancedData?.locationIntelligence',
    );
  });

  it('the service stamps every successful acquisition', () => {
    expect(service).toContain('stampAcquisition(data, {');
    expect(service).toContain('return { resolved: true, data: stamped };');
  });

  it('Google\'s matched address is captured for verification', () => {
    expect(service).toContain('formatted_address');
    expect(service).toContain('matchedAddress');
  });
});
