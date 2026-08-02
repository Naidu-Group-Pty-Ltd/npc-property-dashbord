import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Specificity guard for the listings map marker styles.
 *
 * Leaflet ships `.leaflet-marker-icon { display: block }`, and `leaflet.css` is
 * pulled in by the lazily-imported map chunk — so it lands *after* the app
 * stylesheet. A bare `.listing-pin` therefore ties on specificity and loses,
 * which is why the marker roots are scoped under `.listings-map`.
 *
 * That scoping has a consequence which is easy to get wrong and invisible in a
 * type check: once the base rule is `.listings-map .listing-pin` (0,2,0), an
 * unscoped `.listing-pin--top` (0,1,0) no longer overrides the custom
 * properties it sets. Every pin silently falls back to the default brand colour
 * and the price bands stop existing on the map — while the legend swatches,
 * which use different classes, keep showing four distinct colours.
 *
 * These assertions are on the stylesheet text because that is where the bug
 * lives; nothing in the component tree can express it.
 */

const CSS = readFileSync(join(process.cwd(), 'src/styles/primitives.css'), 'utf8');

/** Every selector in the file that starts a rule block, normalised. */
function selectorsFor(className: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`^([^{}\\n]*\\.${className}[^{}\\n]*)\\{`, 'gm');
  for (const match of CSS.matchAll(pattern)) {
    for (const selector of match[1].split(',')) {
      const trimmed = selector.trim();
      if (trimmed) found.push(trimmed);
    }
  }
  return found;
}

const TIERS = ['unknown', 'low', 'mid', 'high', 'top'] as const;

describe('listings map marker specificity', () => {
  it('scopes the marker roots so Leaflet cannot take their display back', () => {
    for (const root of ['listing-pin', 'listings-cluster', 'listings-locator']) {
      const base = selectorsFor(root).filter((s) => s.endsWith(`.${root}`));
      expect(base.length, `${root} should declare a base rule`).toBeGreaterThan(0);
      for (const selector of base) {
        expect(selector, `${selector} must be scoped under .listings-map`).toContain(
          '.listings-map ',
        );
      }
    }
  });

  it('scopes every price-band modifier to match its base rule', () => {
    for (const tier of TIERS) {
      const selectors = selectorsFor(`listing-pin--${tier}`);
      expect(selectors.length, `listing-pin--${tier} should exist`).toBeGreaterThan(0);
      for (const selector of selectors) {
        expect(
          selector,
          `${selector} would lose to ".listings-map .listing-pin" and the band would not apply`,
        ).toContain('.listings-map');
      }
    }
  });

  it('gives every price band its own colour', () => {
    const values = TIERS.map((tier) => {
      const block = CSS.match(
        new RegExp(`\\.listing-pin--${tier}\\s*\\{([^}]*)\\}`),
      )?.[1];
      return block?.match(/--pin-bg:\s*([^;]+);/)?.[1]?.trim() ?? null;
    });
    expect(values.every(Boolean), 'every band must set --pin-bg').toBe(true);
    expect(new Set(values).size, `bands collide: ${values.join(', ')}`).toBe(TIERS.length);
  });

  it('keeps the brand out of the price ramp', () => {
    // `--primary` is retuned per tenant, so it can land on top of a fixed band
    // colour — in this palette's dark theme it is byte-identical to --warning.
    // An ordered scale has to be built from Category B tokens only.
    for (const tier of TIERS) {
      const block = CSS.match(new RegExp(`\\.listing-pin--${tier}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(block, `${tier} must not use the tenant brand`).not.toMatch(/--pin-bg:\s*hsl\(var\(--primary\)\)/);
    }
  });
});
