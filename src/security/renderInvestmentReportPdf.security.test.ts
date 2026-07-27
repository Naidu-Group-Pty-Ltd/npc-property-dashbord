import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(
  join(process.cwd(), 'supabase/functions/render-investment-report-pdf/index.ts'),
  'utf8',
);

describe('render-investment-report-pdf SVG escaping contract', () => {
  it('escapes explicit donut center subtitles before inserting them into SVG', () => {
    expect(functionSource).toContain(
      'const centerSub = svgEscape((opts.centerSub ?? segments[0]?.label ?? "").toUpperCase());',
    );
    expect(functionSource).not.toContain(
      'const centerSub = opts.centerSub ?? svgEscape(',
    );
  });
});

describe('render-investment-report-pdf CSS escaping contract', () => {
  it('escapes CSS string delimiters in generated margin-box content', () => {
    expect(functionSource).toContain('.replace(/\\\\/g, "\\\\\\\\")');
    expect(functionSource).toContain('.replace(/\\r\\n|\\r|\\n|\\f/g, "\\\\A ")');
    expect(functionSource).not.toMatch(/content:\s*"\$\{esc\((?:address|brandName)\)\}"/);
    expect(functionSource.match(/content:\s*"\$\{cssString\((?:address|brandName)\)\}"/g)).toHaveLength(5);
  });
});
