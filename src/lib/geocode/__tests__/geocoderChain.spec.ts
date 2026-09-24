/**
 * The chain, driven end to end against the refusal it met on 24 Sep 2026.
 *
 * From 07:51:29 UTC the public Nominatim answered every request from the
 * production egress with HTTP 403. The chain placed `1408/5 SECOND AVE,
 * Blacktown NSW 2148` at the ABS centroid of the suburb and wrote that
 * centroid into `geocode_cache` as the address's permanent answer. These run
 * the real `geocodeAddress` — providers, cache policy, pause and all — against
 * a stubbed network and an in-memory cache, and pin what it does now.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Chain = typeof import('../../../../supabase/functions/_shared/geocode/geocoder.ts');

const NOMINATIM_403 = '<html><body><h1>Access blocked</h1><p>You have been blocked because you have violated the usage policy.</p></body></html>';

const PHOTON_HOUSE = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [150.9075, -33.7685] },
    properties: { type: 'house', housenumber: '5', street: 'Second Avenue', postcode: '2148', district: 'Blacktown', state: 'New South Wales', countrycode: 'AU' },
  }],
};
const PHOTON_NOTHING = { type: 'FeatureCollection', features: [] };

const ABS_BLACKTOWN = {
  features: [{
    attributes: { SAL_CODE_2021: '10433', SAL_NAME_2021: 'Blacktown', STATE_NAME_2021: 'New South Wales' },
    geometry: { rings: [[[150.88, -33.76], [150.93, -33.76], [150.93, -33.79], [150.88, -33.79], [150.88, -33.76]]] },
  }],
};

const NOMINATIM_STREET = [{
  lat: '-33.7690', lon: '150.9068', category: 'highway', type: 'residential', addresstype: 'road',
  display_name: 'Second Avenue, Blacktown, City of Blacktown, New South Wales, 2148, Australia',
  address: { road: 'Second Avenue', suburb: 'Blacktown', state: 'New South Wales', postcode: '2148', 'ISO3166-2-lvl4': 'AU-NSW' },
}];

interface Route { status: number; body: unknown; headers?: Record<string, string> }
type Routes = { nominatim?: Route; photon?: Route; abs?: Route };

let calls: string[] = [];

function stubNetwork(routes: Routes) {
  calls = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    const host = new URL(url).host;
    const which = host.includes('nominatim') ? 'nominatim' : host.includes('photon') ? 'photon' : host.includes('abs.gov.au') ? 'abs' : 'other';
    calls.push(which);
    const route = (routes as Record<string, Route | undefined>)[which];
    if (!route) return new Response('not stubbed', { status: 599 });
    const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status, headers: route.headers });
  });
}

/** An in-memory `geocode_cache` and a shared limiter that always grants. */
function fakeDb(row: Record<string, unknown> | null = null) {
  let stored = row;
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    get stored() { return stored; },
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: stored, error: null }),
        upsert: async (r: Record<string, unknown>) => { writes.push(r); stored = { ...r }; return { error: null }; },
      };
      return q;
    },
    rpc: (name: string) => Promise.resolve(
      name === 'security_consume_rate_limit'
        ? { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }
        : { data: null, error: null },
    ),
  };
}

const cachedLocality = (resolvedAgoMs: number) => ({
  address_key: 'k', query: '1408/5 SECOND AVE, Blacktown NSW 2148',
  lat: -33.7741, lng: 150.9036, precision: 'locality', types: ['locality'],
  provider_precision: 'SAL 10433', suburb: 'Blacktown', state: 'NSW', postcode: '2148',
  lga: null, lga_code: null, matched_address: 'Blacktown, New South Wales',
  provider: 'abs_locality', attribution: 'ABS',
  resolved_at: new Date(Date.now() - resolvedAgoMs).toISOString(),
});

const ASK = { address: '1408/5 SECOND AVE, Blacktown NSW 2148' };
const ENV = (k: string) => (k === 'GEOCODER_PROVIDERS' ? undefined : undefined);

let chain: Chain;
beforeEach(async () => {
  // A fresh module per test: the pause a refusal sets is per isolate, and an
  // isolate is what a fresh import models.
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  chain = await import('../../../../supabase/functions/_shared/geocode/geocoder.ts');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Nominatim refuses; the chain still finds the building', () => {
  it('asks Photon, places the address itself, and remembers it', async () => {
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403 },
      photon: { status: 200, body: PHOTON_HOUSE },
    });
    const db = fakeDb();
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.provider).toBe('photon');
    expect(out.result.precision).toBe('address');
    expect(calls).toEqual(['nominatim', 'photon']);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ provider: 'photon', precision: 'address' });
  });

  it('does not ask Nominatim again while its 403 pause holds — and says why in the log', async () => {
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403, headers: { 'retry-after': '3600' } },
      photon: { status: 200, body: PHOTON_HOUSE },
    });
    const warn = vi.spyOn(console, 'warn');
    await chain.geocodeAddress(fakeDb(), ASK, { env: ENV, feature: 'spec' });
    const words = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(words).toContain('nominatim answered 403 (retry-after 3600)');
    expect(words).toContain('You have been blocked because you have violated the usage policy');
    expect(words).toContain('paused until');

    await chain.geocodeAddress(fakeDb(), { address: '12 Other Street, Blacktown NSW 2148' }, { env: ENV, feature: 'spec' });
    expect(calls.filter((c) => c === 'nominatim')).toHaveLength(1);
  });
});

describe('both street-level providers refuse', () => {
  it('serves the suburb centroid and never remembers it — the rows the outage wrote', async () => {
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403 },
      photon: { status: 403, body: 'blocked' },
      abs: { status: 200, body: ABS_BLACKTOWN },
    });
    const db = fakeDb();
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.precision).toBe('locality');
    expect(out.result.provider).toBe('abs_locality');
    expect(db.writes).toHaveLength(0);
  });

  it('remembers the centroid only where the street-level providers LOOKED and found nothing', async () => {
    stubNetwork({
      nominatim: { status: 200, body: [] },
      photon: { status: 200, body: PHOTON_NOTHING },
      abs: { status: 200, body: ABS_BLACKTOWN },
    });
    const db = fakeDb();
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.result.precision).toBe('locality');
    expect(db.writes).toHaveLength(1);
  });
});

describe('a remembered suburb centroid is provisional', () => {
  it('is replaced by a street answer once the street-level providers answer again', async () => {
    // The row the 24 Sep outage wrote for Blacktown, two hours later.
    stubNetwork({ nominatim: { status: 200, body: NOMINATIM_STREET } });
    const db = fakeDb(cachedLocality(2 * 3_600_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.fromCache).toBe(false);
    expect(out.result.precision).toBe('street');
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ provider: 'nominatim', precision: 'street' });
    // The floor is already in hand: the ABS is not asked for the same centroid again.
    expect(calls).not.toContain('abs');
  });

  it('stands, untouched, while the street-level providers still refuse', async () => {
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403 },
      photon: { status: 403, body: 'blocked' },
    });
    const db = fakeDb(cachedLocality(2 * 3_600_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.fromCache).toBe(true);
    expect(out.ok && out.result.precision).toBe('locality');
    expect(db.writes).toHaveLength(0);
  });

  it('is re-dated when they look again and still find no such street', async () => {
    stubNetwork({
      nominatim: { status: 200, body: [] },
      photon: { status: 200, body: PHOTON_NOTHING },
    });
    const db = fakeDb(cachedLocality(2 * 3_600_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.fromCache).toBe(true);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ precision: 'locality', provider: 'abs_locality' });
  });

  it('is served as it stands while it is under an hour old — nothing is asked', async () => {
    stubNetwork({});
    const db = fakeDb(cachedLocality(10 * 60_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.fromCache).toBe(true);
    expect(calls).toEqual([]);
  });

  it('is never handed to a caller that refuses a suburb-level answer', async () => {
    // The PDF import learns a suburb FROM the geocode; a centroid names only
    // what it was given. It used to receive a cached centroid anyway.
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403 },
      photon: { status: 403, body: 'blocked' },
    });
    const db = fakeDb(cachedLocality(10 * 60_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec', allowLocalityFallback: false });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.providerRefused).toBe(true);
  });
});

describe('a remembered street or address is the answer', () => {
  it('is served with nothing asked', async () => {
    stubNetwork({});
    const db = fakeDb({ ...cachedLocality(30 * 24 * 3_600_000), precision: 'street', provider: 'nominatim', types: ['route'] });
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.fromCache).toBe(true);
    expect(out.ok && out.result.precision).toBe('street');
    expect(calls).toEqual([]);
  });
});
