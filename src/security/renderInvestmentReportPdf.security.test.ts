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

  it('authorizes report access before reading with the service-role client', () => {
    const permissionGate = functionSource.indexOf('const permission = await requireModulePermission(');
    const reportRead = functionSource.indexOf('.from("investment_reports")', permissionGate);

    expect(functionSource).toContain('if (auth.error || !auth.userId)');
    expect(functionSource).toContain('{ userId: auth.userId, authMethod: auth.authMethod }');
    expect(functionSource).toContain('"reports",\n      "can_view"');
    expect(functionSource).toContain('return createForbiddenResponse(');
    expect(permissionGate).toBeGreaterThan(-1);
    expect(reportRead).toBeGreaterThan(permissionGate);
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

describe('render-investment-report-pdf contact link security contract', () => {
  it('escapes quotes before inserting contact values into href attributes', () => {
    expect(functionSource).toContain('.replace(/"/g, "&quot;")');
    expect(functionSource).toContain(".replace(/'/g, \"&#39;\")");
    expect(functionSource).toContain('href="mailto:${escAttr(v)}"');
    expect(functionSource).toContain('href="${escAttr(href)}"');
    expect(functionSource).not.toContain('href="${esc(href)}"');
  });

  it('only linkifies valid HTTP(S) website URLs without credentials', () => {
    expect(functionSource).toContain('const href = websiteHref(v);');
    expect(functionSource).toContain('["http:", "https:"]');
    expect(functionSource).toContain('!url.hostname || url.username || url.password');
    expect(functionSource).toContain(': esc(v);');
  });
});
