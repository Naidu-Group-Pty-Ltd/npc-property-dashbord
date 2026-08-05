/**
 * The stylesheet is one template literal, so a backtick in a CSS comment ends
 * it.
 *
 * Nothing subtle about the failure — the module stops parsing and every spec
 * that imports it dies at transform time. What makes it worth a guard is how
 * easy it is to reintroduce: the house comment style quotes identifiers in
 * backticks everywhere else in the repo, and inside this one function that is a
 * syntax error rather than a style choice. It has now been made four times.
 *
 * ## Why this is its own file
 *
 * The guard lived in `reportCss.spec.ts`, which imports `buildReportCss`. So on
 * the fourth occurrence the transform failed, the whole spec file died before a
 * test ran, and the guard written to name this exact mistake reported nothing —
 * leaving nineteen unrelated suites failing with a parse error and no clue
 * which line caused it.
 *
 * This file reads the module as **text** and imports nothing from it. It is the
 * one check that has to survive the module being unparseable.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  resolve(__dirname, '../../../../supabase/functions/_shared/reportDesign/css.pure.ts'),
  'utf8',
);

describe('the stylesheet is one template literal', () => {
  it('quotes nothing in backticks inside a CSS comment', () => {
    // The literal runs from the sheet builder to the end of the module.
    const body = SOURCE.slice(SOURCE.indexOf('\nfunction sheet('), SOURCE.length);
    const offenders: Array<{ line: number; text: string }> = [];
    let inComment = false;
    body.split('\n').forEach((line, i) => {
      if (line.includes('/*')) inComment = true;
      if (inComment && line.includes('`')) offenders.push({ line: i, text: line.trim() });
      if (line.includes('*/')) inComment = false;
    });
    expect(
      offenders.map((o) => o.text),
      'a backtick in a CSS comment closes the stylesheet’s template literal',
    ).toEqual([]);
  });
});
