/**
 * QA-18 — a summarising report may not invent or re-estimate a score.
 *
 * The Briefing of 291 Stone Mason Drive rated an "overall investment fit"
 * 68/100 and gave two "scores of 82" that appear nowhere in the record or
 * in the parent document. These pin the guard that removes such claims.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  findScoreClaims,
  recordedScoreValues,
  suppressUnrecordedScores,
  suppressUnrecordedVerdictVisuals,
} from '@/lib/reports/investment/scoreClaims.pure';

const STONE_MASON_SCORE = {
  totalScore: 39,
  grade: 'D',
  breakdown: {
    yieldScore: { score: 30, weight: 33, available: true },
    riskScore: { score: 75, weight: 11, available: true },
    locationScore: { score: 58, weight: 56, available: true },
    // Excluded dimensions carry a placeholder 50 that is not a score.
    growthScore: { score: 50, weight: 0, excluded: true, available: false },
    demandScore: { score: 50, weight: 0, hasData: false },
  },
};

describe('findScoreClaims', () => {
  it('recognises the forms the corpus uses', () => {
    const text = 'Overall fit is rated 68/100. The property has a Metro-linked accessibility score of 82. '
      + 'It scored 75 on risk and is 58 out of 100 for location.';
    expect(findScoreClaims(text).map((c) => c.value)).toEqual([68, 82, 75, 58]);
  });

  it('does not read a percentage, a distance or a price as a score', () => {
    expect(findScoreClaims('Gross yield of 3.6% and a rating of 95% occupancy; 2 km; score of 1,299,000')).toEqual([]);
  });
});

describe('recordedScoreValues', () => {
  it('holds the total and the scored dimensions, never an excluded placeholder', () => {
    expect(recordedScoreValues(STONE_MASON_SCORE).sort((a, b) => a - b)).toEqual([30, 39, 58, 75]);
  });
  it('is empty for no record', () => {
    expect(recordedScoreValues(null)).toEqual([]);
    expect(recordedScoreValues('x')).toEqual([]);
  });
});

describe('suppressUnrecordedScores', () => {
  const recorded = recordedScoreValues(STONE_MASON_SCORE);

  it('removes the sentence that carries an invented score and keeps the rest', () => {
    const md = [
      '## Executive Verdict',
      '',
      'Kellyville is a family suburb with metro access. Overall investment fit is rated 68/100, indicating strong potential. The record grades it D at 39/100.',
      '',
      '- Metro access: the property has a Metro-linked accessibility score of 82.',
      '- Schools: strong government options in the catchment.',
    ].join('\n');
    const { markdown, removed } = suppressUnrecordedScores(md, { recorded });
    expect(markdown).toContain('Kellyville is a family suburb with metro access. The record grades it D at 39/100.');
    expect(markdown).not.toContain('68/100');
    expect(markdown).not.toContain('score of 82');
    expect(markdown).toContain('- Schools: strong government options in the catchment.');
    expect(removed.map((r) => r.value)).toEqual([68, 82]);
  });

  it('keeps a claim the parent document made itself', () => {
    const md = 'The walk score of 62/100 supports car-light living.';
    const parent = 'Walk Score: 62/100 (Somewhat Walkable), measured for the address.';
    expect(suppressUnrecordedScores(md, { recorded, parentText: parent }).markdown).toBe(md);
  });

  it('never edits a table, a directive or a heading', () => {
    const md = [
      '## Score 88/100 Overview',
      '| Dimension | Weight | Score |',
      '| --- | --- | --- |',
      '| Fit | 10% | 88/100 |',
      '{{gauge: 88 | max=100 | label=Fit}}',
    ].join('\n');
    const { markdown, removed } = suppressUnrecordedScores(md, { recorded });
    expect(markdown).toBe(md);
    expect(removed).toEqual([]);
  });

  it('drops a bullet whose only sentence was the claim', () => {
    const md = 'Intro.\n\n- Suburb fit score of 82 for commuter families.\n- Kept.\n';
    const { markdown } = suppressUnrecordedScores(md, { recorded });
    expect(markdown).toBe('Intro.\n\n- Kept.\n');
  });
});

describe('a dial the record cannot back', () => {
  /*
   * 262 Pallas Street, regenerated 17 Sep 2026 on a record that issues no
   * grade. The prose guard above skips any line beginning `{{`, because a
   * directive was assumed to be composed from recorded numbers. Two of these
   * primitives are written by the MODEL:
   *
   *   {{gauge: 85 | Land Appeal | Large block relative to typical suburban lots}}
   *   {{gauge: 82 | Large-block lifestyle appeal | …}}
   *   {{wheel: 25,45,30,40,35 | labels=Environmental,Crime,Planning & overlays,…}}
   *
   * A gauge over 100 draws a verdict band, so "85 · STRONG" reached the page
   * as a measurement of somebody's property.
   */
  const doc = [
    'The land is large for the street.',
    '{{gauge: 85 | Land Appeal | Large block relative to typical suburban lots}}',
    '',
    '{{gauge: 78 | Investment Score | Weighted composite}}',
    '{{wheel: 25,45,30,40,35 | labels=Environmental,Crime,Planning,Supply,Transport | max=100}}',
    '{{bars: Health Care 18.3, Retail 10.4 | max=20 | unit=%}}',
    '{{pictograph: 7/10 | label=Family-oriented appeal}}',
    'Closing line.',
  ].join('\n');

  it('drops a gauge and a wheel the record does not hold, and keeps the one it does', () => {
    const r = suppressUnrecordedVerdictVisuals(doc, { recorded: [78] });
    expect(r.markdown).toContain('{{gauge: 78 | Investment Score | Weighted composite}}');
    expect(r.markdown).not.toContain('Land Appeal');
    expect(r.markdown).not.toContain('{{wheel:');
    expect(r.removed.map((x) => x.kind)).toEqual(['gauge', 'wheel']);
    expect(r.removed[1].values).toEqual([25, 45, 30, 40, 35]);
  });

  it('leaves the data primitives alone', () => {
    // Dropping these on a number-match takes measured series off the page.
    const r = suppressUnrecordedVerdictVisuals(doc, { recorded: [78] });
    expect(r.markdown).toContain('{{bars: Health Care 18.3');
    expect(r.markdown).toContain('{{pictograph: 7/10');
  });

  it('reads the value and never the label, the caption or an option', () => {
    // `max=100` and "seven in ten" are not assertions about a score.
    const kept = suppressUnrecordedVerdictVisuals(
      '{{gauge: 61/100 | Confidence 85 | Around 100 households | max=100}}',
      { recorded: [61] },
    );
    expect(kept.removed).toEqual([]);
    const gone = suppressUnrecordedVerdictVisuals(
      '{{gauge: 61/100 | Confidence | max=100}}',
      { recorded: [85] },
    );
    expect(gone.removed).toHaveLength(1);
    expect(gone.markdown.trim()).toBe('');
  });

  it('leaves a directive with no readable number to another control', () => {
    const r = suppressUnrecordedVerdictVisuals('{{gauge: n/a | Something}}', { recorded: [] });
    expect(r.removed).toEqual([]);
    expect(r.markdown).toContain('{{gauge: n/a');
  });
});

describe('an instruction never occupies a value slot', () => {
  /*
   * The same regeneration printed this, in its own prose, as the property's
   * recorded attribute:
   *
   *   The property type is recorded as **"Not stated in the record — if the
   *   property documents name the dwelling type, use that exact type in every
   *   section, never write 'Residential Property'"**…
   *
   * `propertyTypeLabel` WAS that instruction when nothing resolved, and it was
   * interpolated into `| Property Type | … |` cells and a `- Property Type: …`
   * line. A model handed a value quotes it back.
   */
  const generator = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');

  it('leaves the slot empty and puts the instruction in the rules', () => {
    expect(generator).toMatch(/const propertyTypeLabel = resolvedPropertyType \?\? '';/);
    expect(generator).toMatch(/const propertyTypeRule = resolvedPropertyType/);
    // Every interpolation of the label into a cell or a line is guarded: the
    // raw form and the guarded form occur the same number of times, so none is
    // left bare.
    const rawRow = /\| Property Type \| \$\{propertyTypeLabel\} \|/g;
    const guardedRow = /\$\{propertyTypeLabel \? `\| Property Type \| \$\{propertyTypeLabel\} \|` : ''\}/g;
    expect([...generator.matchAll(rawRow)]).toHaveLength([...generator.matchAll(guardedRow)].length);
    expect([...generator.matchAll(guardedRow)].length).toBeGreaterThan(0);
    expect(generator).toContain("${propertyTypeLabel ? `- Property Type: ${propertyTypeLabel}` : ''}");
    expect(generator, 'an unguarded line would print an empty value slot')
      .not.toMatch(/^- Property Type: \$\{propertyTypeLabel\}$/m);
  });

  it('tells the prompt the type the record holds', () => {
    /*
     * `rawPropertyType` read `propertyDetails?.propertyType` alone. Every
     * Compass report is finished by the resume worker, which calls back with
     * `{reportId, propertyAddress, continueFrom}` and no `propertyDetails` — so
     * on the run that writes the document this was always ''. On 262 Pallas
     * Street the operator had recorded `propertyType: 'house'`, page 3 of the
     * PDF printed it from `property_specs`, and the model was told it was not
     * stated. `sourcePropertyType` is the one answer this module resolves.
     */
    expect(generator).not.toMatch(/const rawPropertyType = propertyDetails\?\.propertyType\?\.toLowerCase\(\)/);
    expect(generator).toMatch(/const rawPropertyType = \(typeof sourcePropertyType === 'string' \? sourcePropertyType : ''\)\.toLowerCase\(\);/);
    // And it is resolved before it is read.
    expect(generator.indexOf('const sourcePropertyType =')).toBeLessThan(generator.indexOf('const rawPropertyType ='));
  });

  it('stops the rent table printing an "X-Bed" placeholder', () => {
    expect(generator, 'X-Bed reached the page beside an instruction-shaped type')
      .not.toContain("${effectiveBeds || 'X'}-Bed");
  });

  it('stops the prompt asking for a rating nobody scored', () => {
    // "Affordability, Suitability, Confidence … MUST use {{gauge}}" is what
    // produced `{{gauge: 85 | Land Appeal}}`.
    expect(generator).not.toMatch(/Investment Score, Affordability, Risk, Suitability, Confidence, and similar 0-100 ratings MUST use/);
    expect(generator).toMatch(/Do NOT mint a rating for appeal, suitability, confidence, affordability/);
  });
});
