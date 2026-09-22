/**
 * The cover facts strip's value size — the one cover element that had its own
 * density behaviour.
 *
 * `coverCard` drew it as `c.density === 'spacious' ? 14 : 11`, a hand-written
 * two-way branch, while every sibling on that page (the title, the eyebrow,
 * the standfirst, the locations line, the facts LABEL) is routed through
 * `scaleFor` and takes the family's own density factor. So the block carried a
 * second density behaviour, and the two disagreed.
 *
 * Measured over the 50 master/variant combinations the catalogue declares:
 *
 *   compact   14 variants · drew 11pt where the display factor gives 9pt
 *   spacious   8 variants · drew 14pt where it gives 13pt
 *   balanced  28 variants · agreed
 *
 * The compact half is what showed on paper. Every other element on a compact
 * cover shrinks — the title by 18%, the standfirst by 18%, the KPI value by
 * 18% — and the facts did not, so they GREW against their surroundings. At its
 * worst, Institutional Research's compact variants drew an 11pt facts value
 * against an **11.5pt** cover title: 96%, which is no hierarchy at all.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASE_SCALES,
  COVER_FACT_BASE,
  scaleFor,
  type Density,
} from '../../../../scripts/template-library/investmentCompass/family';

const DENSITIES: Density[] = ['compact', 'balanced', 'spacious'];

describe('the cover facts value moves with density', () => {
  /*
   * The whole point: one rule, applied by `scaleFor`, so the cover cannot
   * disagree with its own family about how big things are at this density.
   */
  it('takes the same display factor every other display size takes', () => {
    for (const family of Object.keys(BASE_SCALES)) {
      const balanced = scaleFor(family, 'balanced');
      for (const density of DENSITIES) {
        const s = scaleFor(family, density);
        /*
         * Asserted as a RATIO against the family's own title rather than
         * against a typed number, because the claim is "it moves like its
         * siblings" and a typed number would be a second statement of the
         * factor — the two-ends-drift fault this file exists to close.
         */
        const factsStep = s.coverFact / balanced.coverFact;
        const titleStep = s.coverTitle / balanced.coverTitle;
        expect(factsStep, `${family}/${density}`).toBeCloseTo(titleStep, 1);
      }
    }
  });

  /* Balanced is unchanged, so 28 of the 50 masters are byte-identical. */
  it('reproduces the balanced value the covers have always drawn', () => {
    for (const family of Object.keys(BASE_SCALES)) {
      expect(scaleFor(family, 'balanced').coverFact, family).toBe(COVER_FACT_BASE);
    }
    expect(COVER_FACT_BASE).toBe(11);
  });

  it('shrinks on compact and grows on spacious', () => {
    const f = 'private_banking';
    expect(scaleFor(f, 'compact').coverFact).toBeLessThan(COVER_FACT_BASE);
    expect(scaleFor(f, 'spacious').coverFact).toBeGreaterThan(COVER_FACT_BASE);
  });

  /*
   * It is uniform across the families ON PURPOSE. The approved catalogue
   * source carries no point sizes at all — only preset names — so a
   * per-family number here would be invented, which is W1.4's rule.
   */
  it('is not given the shape of a per-family measurement', () => {
    for (const [family, base] of Object.entries(BASE_SCALES)) {
      expect(base, family).not.toHaveProperty('coverFact');
    }
    const source = readFileSync(
      'scripts/template-library/investmentCompass/source.json', 'utf8');
    /* If the design ever states a size, this assertion is what notices. */
    expect(source).not.toMatch(/"cover_fact|coverFact|facts_size/);
  });

  /*
   * And the cover block reads the scale rather than branching. A source
   * assertion, because the defect was a literal that typechecked perfectly.
   */
  it('is read from the scale by the cover, with no density branch left', () => {
    const src = readFileSync(
      'scripts/template-library/investmentCompass/blocks.ts', 'utf8');
    expect(src).toContain('valueSize: c.scale.coverFact');
    const offending = src.split('\n')
      .filter((line) => /density === 'spacious' \? 14 : 11/.test(line))
      .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line));
    expect(offending, 'the hand-written density branch is back in code').toEqual([]);
  });

  /*
   * The measurement that made this worth doing, reproduced from the source so
   * it cannot rot into a comment nobody checks: on the smallest-display
   * family at compact, the OLD literal was ~96% of the cover title.
   */
  it('reproduces the 96% hierarchy the old literal produced', () => {
    const ir = scaleFor('institutional_research', 'compact');
    expect(ir.coverTitle).toBeCloseTo(11.5, 1);
    expect(11 / ir.coverTitle).toBeGreaterThan(0.9);
    /* And the derived value restores a hierarchy. */
    expect(ir.coverFact / ir.coverTitle).toBeLessThan(0.85);
  });
});
