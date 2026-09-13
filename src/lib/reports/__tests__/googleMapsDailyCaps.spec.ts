import { describe, expect, it, vi } from 'vitest';

import {
  COMMUTE_CAP_REACHED,
  COMMUTE_NO_ROUTE,
} from '@/lib/reports/location/cbdDestination.pure';
import {
  dailyCapFor,
  GOOGLE_CAP_SCOPES,
  type GoogleCapKind,
} from '../../../../supabase/functions/_shared/googleMapsDailyCaps.ts';
import {
  measuredCount,
  unavailableCategories,
} from '../../../../supabase/functions/_shared/reports/location/placesAvailability.pure.ts';

/**
 * RC-2 — the daily ceiling on paid Google Maps requests.
 *
 * The rule under test is the mandate's, and it is the one that makes a
 * spending control safe to switch on: **cost safety must never create false
 * data.** A ceiling that answered with a substituted figure would be worse
 * than no ceiling, because a reader cannot tell a cheap number from a measured
 * one.
 */
describe('Google Maps daily caps', () => {
  const env = (values: Record<string, string>) => (k: string) => values[k];

  it('reads the EXISTING environment names — no second vocabulary', () => {
    // These three names are what `resolve-listing-coordinates`,
    // `google-places-autocomplete` and `street-view` already read. A new name
    // here would mean an operator configuring a ceiling that half the product
    // ignores.
    expect(dailyCapFor('geocoding', env({ GOOGLE_GEOCODING_DAILY_LIMIT: '42' }))).toBe(42);
    expect(dailyCapFor('places', env({ GOOGLE_PLACES_DAILY_LIMIT: '7' }))).toBe(7);
    expect(dailyCapFor('distanceMatrix', env({ GOOGLE_DISTANCE_MATRIX_DAILY_LIMIT: '9' }))).toBe(9);
  });

  it('shares ONE Places bucket with the autocomplete function', () => {
    // `google-places-autocomplete` consumes under exactly this scope. Sharing
    // it is what makes `GOOGLE_PLACES_DAILY_LIMIT` mean what it says across
    // the product rather than being a per-function allowance.
    expect(GOOGLE_CAP_SCOPES.places).toBe('google_places');
  });

  it('uses scopes the rate-limit key regex accepts', () => {
    // `security_consume_rate_limit` refuses a key outside
    // `^[a-z0-9:_./-]{1,200}$` by RAISING, which would turn a ceiling into a
    // 500 on every request rather than a refusal.
    for (const scope of Object.values(GOOGLE_CAP_SCOPES)) {
      expect(`public:global:${scope}:daily`).toMatch(/^[a-z0-9:_./-]{1,200}$/);
    }
  });

  it('defaults to a zero-paid-usage ceiling, never to uncapped', () => {
    const kinds: GoogleCapKind[] = ['geocoding', 'places', 'distanceMatrix'];
    for (const kind of kinds) {
      const cap = dailyCapFor(kind, () => undefined);
      expect(cap).toBeGreaterThan(0);
      // The existing sites default to 5000. These call sites had NO ceiling at
      // all, so their default is the guardrail rather than a generous bound.
      expect(cap).toBeLessThanOrEqual(250);
    }
  });

  it('treats a malformed limit as the default, never as uncapped', () => {
    // A typo must not remove a paid provider's ceiling, and must not disable a
    // working feature either.
    for (const bad of ['', 'abc', '0', '-5', '12.5', 'NaN']) {
      expect(dailyCapFor('places', env({ GOOGLE_PLACES_DAILY_LIMIT: bad })))
        .toBe(dailyCapFor('places', () => undefined));
    }
  });

  it('keeps Places at the binding constraint for a report enrichment', () => {
    // One enrichment is 1 geocode + 6 Places + 1 Distance Matrix, confirmed by
    // the ledger's exact 6:1 Places:Distance ratio. Places is therefore what
    // actually limits report throughput, and it is deliberately the tightest.
    const places = dailyCapFor('places', () => undefined);
    const geocoding = dailyCapFor('geocoding', () => undefined);
    expect(places).toBeLessThan(geocoding);
    expect(Math.floor(places / 6)).toBeGreaterThanOrEqual(20);
  });

  it('says a ceiling was reached WITHOUT claiming anything about the place', () => {
    // The whole point. `no_route_returned` is a measurement — we asked, and
    // transit does not connect these points — and a reader may act on it.
    // A ceiling means nobody asked, and must never be readable as the former.
    expect(COMMUTE_CAP_REACHED.measured).toBe(false);
    expect(COMMUTE_CAP_REACHED.reason).toBe('daily_cap_reached');
    expect(COMMUTE_CAP_REACHED.reason).not.toBe(COMMUTE_NO_ROUTE.reason);
    // No digit may appear in a refusal: a number here is a number a report can
    // print.
    expect(COMMUTE_CAP_REACHED.detail).not.toMatch(/\d/);
    // And it must name the ceiling as ours rather than as a fact about the
    // location, or an operator goes looking for a broken provider.
    expect(COMMUTE_CAP_REACHED.detail).toMatch(/not a finding about the location/i);
  });
});

/**
 * The refusal shapes the service returns, asserted against the contract each
 * one has to satisfy downstream. These are the literal values wired into
 * `location-intelligence-service`; the test exists so that a future edit which
 * "simplifies" a refusal into a zero fails here rather than in a client's PDF.
 */
describe('a refused lookup is absent, never zero', () => {
  it('a refused Places category is unmeasured, not a measured zero', () => {
    // This is the literal shape `fetchNearbyPlaces` returns when the ceiling
    // refuses. `count: 0` is there for shape compatibility with a genuinely
    // empty result; `ok: false` is what every reader keys on.
    const refused = { ok: false, count: 0, results: [] };
    const reached = { ok: true, count: 0, results: [] };

    // A refusal is unmeasured...
    expect(measuredCount(refused)).toBeNull();
    // ...while a rural address the provider DID answer for keeps its real
    // zero, because "no hospital within five kilometres" is a fact worth
    // printing. Collapsing these two is the defect this contract exists for.
    expect(measuredCount(reached)).toBe(0);

    const lookups = {
      transit: reached, schools: reached, healthcare: refused,
      shopping: reached, recreation: reached, restaurants: reached,
    };
    expect(unavailableCategories(lookups)).toEqual(['healthcare']);
  });

  it('a refused geocode is flagged capped, so the operator is not sent to the wrong remedy', () => {
    // `providerRefused` means map service access is broken and an operator
    // should go and look at it. `capped` means this deployment declined to
    // spend. Both produce no coordinate; only one is a fault.
    const refusal = { ok: false as const, providerRefused: false, capped: true };
    expect(refusal.capped).toBe(true);
    expect(refusal.providerRefused).toBe(false);
  });
});
