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

describe('render-investment-report-pdf shortcode complexity contract', () => {
  it('bounds attacker-controlled SVG collections before rendering', () => {
    expect(functionSource).toContain('const MAX_WATERFALL_ITEMS = 50;');
    expect(functionSource).toContain('const MAX_HEATMAP_CELLS = 400;');
    expect(functionSource).toContain('const MAX_WHEEL_SCORES = 24;');
    expect(functionSource).toContain('const MAX_COMPLEX_VISUAL_UNITS = 800;');
    expect(functionSource).toContain('if (rawArgs.length > MAX_VISUAL_SHORTCODE_CHARS) return _m;');
    expect(functionSource).toContain('rawGrid.length * cols > MAX_HEATMAP_CELLS');
    expect(functionSource).toContain('if (rawScores.length > MAX_WHEEL_SCORES) return _m;');
    expect(functionSource).toContain('complexVisualUnits + cellCount > MAX_COMPLEX_VISUAL_UNITS');
  });

  it('does not spread an attacker-sized heatmap into Math.min or Math.max', () => {
    expect(functionSource).not.toContain('Math.min(...flat)');
    expect(functionSource).not.toContain('Math.max(...flat)');
  });
});
