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

describe('render-investment-report-pdf editorial shortcode escaping contract', () => {
  it.each(['pullquote', 'sidenote'])('escapes %s bodies before inserting them into HTML', (name) => {
    expect(functionSource).toMatch(
      new RegExp(`if \\(name === "${name}"\\)[^\\n]+\\$\\{esc\\(inner\\.replace`),
    );
  });

  it('does not interpolate unescaped editorial text into HTML', () => {
    expect(functionSource).not.toMatch(
      /if \(name === "(?:pullquote|sidenote)"\)[^\n]+\$\{inner\.replace/,
    );
  });
});
