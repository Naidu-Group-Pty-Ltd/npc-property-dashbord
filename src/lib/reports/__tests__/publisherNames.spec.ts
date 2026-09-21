/**
 * A database key is never the name of a publisher.
 *
 * Page 36 of the Investment Compass delivered for 9 Hollow Street, Golden
 * Square on 21 Sep 2026 printed, in the column headed *Where it is published*:
 *
 *   | The market's median sale price and its growth | vic_vpsr_suburb | … |
 *   | The one-year growth rate                      | vic_vpsr_suburb | … |
 *
 * directly beside a row that reads "Vicmap Planning — plan_zone
 * (opendata.maps.vic.gov.au WFS)" and gets it right.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { providerName } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';

const UNION_SOURCE = 'supabase/functions/_shared/reports/market/marketEvidence.pure.ts';

/**
 * Every member of `EvidenceProvider`, read out of the type itself.
 *
 * There is no runtime list to import, and writing one here would be a second
 * copy that drifts — the same reason the router's CI test reads the router's
 * source rather than a list beside it.
 */
function providersInTheUnion(): string[] {
  const src = readFileSync(UNION_SOURCE, 'utf8');
  const at = src.indexOf('export type EvidenceProvider =');
  expect(at).toBeGreaterThan(-1);
  const body = src.slice(at, src.indexOf(';', at));
  return [...new Set([...body.matchAll(/\|\s*'([a-z0-9_]+)'/g)].map((m) => m[1]))];
}

/** `vic_vpsr_suburb` — an identifier, not a name. */
const LOOKS_LIKE_A_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

describe('every provider has a name a reader can use', () => {
  const providers = providersInTheUnion();

  it('reads a real union', () => {
    expect(providers.length).toBeGreaterThanOrEqual(14);
    // The two that shipped without one.
    expect(providers).toContain('vic_vpsr_suburb');
    expect(providers).toContain('sa_lsg_suburb');
  });

  it.each(providersInTheUnion())('%s renders as a name, never as the key', (p) => {
    const name = providerName(p as never);
    expect(name).not.toBe(p);
    expect(name).not.toMatch(LOOKS_LIKE_A_KEY);
    expect(name).not.toContain('_');
    expect(name.length).toBeGreaterThan(3);
  });

  it('names the two archived suburb series after their publishers', () => {
    expect(providerName('vic_vpsr_suburb' as never)).toContain('Valuer-General');
    expect(providerName('sa_lsg_suburb' as never)).toContain('Land Services SA');
  });
});

describe('the fallback names the absence rather than the key', () => {
  it('never prints an identifier it was not given a name for', () => {
    // A provider read back from the database is a string, not the union, so
    // the runtime guard has to hold even though the compiler now refuses a
    // missing entry at the call site.
    expect(providerName('some_new_registry' as never)).toBe('Publisher not recorded');
    expect(providerName('' as never)).toBe('Publisher not recorded');
  });

  it('passes through something that is already a name', () => {
    expect(providerName('Bendigo Council' as never)).toBe('Bendigo Council');
  });
});
