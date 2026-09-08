/**
 * Stage 4 — what the charts on a rendered page actually say.
 *
 * Found by rendering `6 Acer Court, Bowral NSW 2576` through the production
 * renderer and WeasyPrint 69.0 on 2026-09-07 and reading all fifteen pages,
 * rather than by reading the code. Two of the three would have survived any
 * amount of code review, because both produce a plausible-looking chart.
 *
 *  1. **The bar chart plotted dimensions the engine never scored.** Acer's
 *     `investment_score.breakdown` marks `demand` and `growth`
 *     `excluded: true, hasData: false, weight: 0` — and leaves a placeholder
 *     `score` of **50** sitting in the field regardless. `Score drivers` drew
 *     five bars: risk 60, yield 10, location 65, **demand 50, growth 50**. The
 *     two fabricated bars sit mid-range between the real ones, so nothing about
 *     the chart looks wrong.
 *
 *     Three readers asked this question and only two asked it correctly:
 *     `reportBindingProjection` (`excluded === true || hasData === false`) and
 *     `breakdownEntries` (that, plus a zero-weight test) did; the renderer's
 *     `extractScoreBreakdownItems` asked nothing at all. `dimensionWasScored` is
 *     now the one predicate, exported, and the renderer imports it.
 *
 *  2. **`&` became `&AMP;` on every chart label.** `svgEscape` runs first and
 *     `.toUpperCase()` ran on its output, so the entity's own letters were
 *     uppercased: the Executive Verdict radar read **`&AMP; AMENITY`**. The
 *     Contents page spells the same heading correctly, which is why this
 *     survived — that path decodes.
 *
 *  3. **The radar's longest label was clipped.** Labels anchor at
 *     `cx ± (R + 22)` and ran past the viewBox: `INFRASTRUCTURE & AMENITY`
 *     printed as `ASTRUCTURE`. Fixed by widening the viewBox into a label
 *     gutter and wrapping on a word boundary.
 *
 * The predicate is imported and exercised directly. The two renderer-local
 * fixes are pinned against the function's source, the way
 * `security-contract.test.ts` already pins that file's escaping — the helpers
 * are module-private inside a 5,900-line Deno function that cannot be imported
 * from vitest, and a shared module for two chart-label lines would be a second
 * definition of escaping beside `esc`/`escAttr`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { dimensionWasScored } from '../investment/scoreSections.pure';

const REPO = resolve(__dirname, '../../../..');
const RENDERER = readFileSync(
  resolve(REPO, 'supabase/functions/render-investment-report-pdf/index.ts'),
  'utf8',
);

describe('a dimension the engine did not score is not a bar', () => {
  // Verbatim from `investment_score.breakdown` on 6 Acer Court (2026-09-02).
  const SCORED = { score: 65, weight: 20, hasData: true };
  const EXCLUDED = { score: 50, weight: 0, hasData: false, excluded: true };

  it('accepts a dimension that carried data', () => {
    expect(dimensionWasScored(SCORED)).toBe(true);
  });

  it('refuses the excluded dimension whose placeholder score is 50', () => {
    expect(dimensionWasScored(EXCLUDED)).toBe(false);
  });

  it('refuses on any one of the three signals alone', () => {
    // Each is sufficient. A record carrying only one of them is still a
    // dimension nothing was measured for.
    expect(dimensionWasScored({ score: 50, excluded: true })).toBe(false);
    expect(dimensionWasScored({ score: 50, hasData: false })).toBe(false);
    expect(dimensionWasScored({ score: 50, weight: 0 })).toBe(false);
  });

  it('reads the engine\'s `available` as well as the generator\'s `hasData`', () => {
    expect(dimensionWasScored({ score: 50, available: false })).toBe(false);
    expect(dimensionWasScored({ score: 50, available: true, weight: 15 })).toBe(true);
  });

  it('does not refuse a dimension that merely omits the flags', () => {
    // A weightless breakdown is the older shape and still carries real scores.
    expect(dimensionWasScored({ score: 72 })).toBe(true);
  });

  it('refuses anything that is not a record', () => {
    for (const v of [null, undefined, 50, 'clear', [] as unknown]) {
      expect(dimensionWasScored(v)).toBe(false);
    }
  });

  it('is the predicate the renderer\'s bar chart asks', () => {
    expect(RENDERER).toContain(
      'import { dimensionWasScored } from "../_shared/reports/investment/scoreSections.pure.ts";',
    );
    // Inside `extractScoreBreakdownItems`, which drew the fabricated bars.
    expect(RENDERER).toContain('if (val && typeof val === "object" && !dimensionWasScored(val)) return null;');
  });
});

describe('chart labels are decoded before they are uppercased', () => {
  it('routes label text through the decoding helpers', () => {
    expect(RENDERER).toContain('function decodeHtmlEntities(');
    expect(RENDERER).toContain('function svgLabel(');
    expect(RENDERER).toContain('function svgLabelUpper(');
  });

  it('decodes `&amp;` LAST, so `&amp;lt;` does not become `<`', () => {
    // Order is the whole correctness of an entity decoder. Replacing `&amp;`
    // first turns `&amp;lt;` into `&lt;` into `<`, which is markup the source
    // never contained.
    const body = RENDERER.slice(RENDERER.indexOf('function decodeHtmlEntities('));
    const ampAt = body.indexOf('/&amp;/g');
    const ltAt = body.indexOf('/&lt;/g');
    expect(ltAt).toBeGreaterThanOrEqual(0);
    expect(ampAt).toBeGreaterThan(ltAt);
  });

  it('leaves no chart label uppercasing already-escaped text', () => {
    // The exact shape that produced `&AMP; AMENITY`. `svgEscape(x.toUpperCase())`
    // is fine and still used; `svgEscape(x).toUpperCase()` is the bug — so the
    // check has to know which call the closing paren belongs to, and matches by
    // walking the parens back rather than by a regex that cannot count.
    const offenders: string[] = [];
    for (let at = RENDERER.indexOf('.toUpperCase()'); at !== -1;
         at = RENDERER.indexOf('.toUpperCase()', at + 1)) {
      if (RENDERER[at - 1] !== ')') continue;
      let depth = 0;
      let i = at - 1;
      for (; i >= 0; i -= 1) {
        if (RENDERER[i] === ')') depth += 1;
        else if (RENDERER[i] === '(') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (i > 0 && RENDERER.slice(Math.max(0, i - 9), i) === 'svgEscape') {
        offenders.push(RENDERER.slice(i - 9, at + 14));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('a radar label is drawn in full', () => {
  it('reserves a gutter for the labels either side of the polygon', () => {
    // Labels anchor at `cx ± (R + 22)`. The viewBox was 460 wide with the wheel
    // centred, so the outermost characters fell outside it and WeasyPrint
    // clipped them — `INFRASTRUCTURE & AMENITY` printed as `ASTRUCTURE`.
    expect(RENDERER).toContain('WHEEL_LABEL_CHARS');
    expect(RENDERER).toContain('wheelLabelLines');
  });

  it('wraps on a word boundary rather than mid-word', () => {
    const fn = RENDERER.slice(RENDERER.indexOf('const wheelLabelLines'));
    // Splits into words and refills; never a fixed-width slice.
    expect(fn.slice(0, 600)).toMatch(/split\(\/\\s\+\/\)|split\(" "\)/);
  });
});
