import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wrapInlineInsightParagraphs } from '../../supabase/functions/render-investment-report-pdf/insightSections';

const functionSource = readFileSync(
  join(process.cwd(), 'supabase/functions/render-investment-report-pdf/index.ts'),
  'utf8',
);

const insightOptions = {
  isInsightLabel: (label: string) => label.toLowerCase() === 'what this means',
  escapeLabel: (label: string) => label,
};

describe('render-investment-report-pdf insight wrapping contract', () => {
  it('preserves following narrative blocks in the insight box', () => {
    const html = '<p><strong>What This Means:</strong> first</p>\n<p>second</p><ul><li>third</li></ul><h2>Next</h2>';

    expect(wrapInlineInsightParagraphs(html, insightOptions)).toBe(
      '<div class="insight-box"><div class="insight-label">What This Means</div><p>first</p>\n<p>second</p><ul><li>third</li></ul></div><h2>Next</h2>',
    );
  });

  it('finishes promptly when many paragraphs are followed by an unexpected block', () => {
    const paragraphs = '<p>detail</p>'.repeat(2_000);
    const html = `<p><strong>What This Means:</strong> first</p>${paragraphs}<div>unexpected</div>`;

    const startedAt = performance.now();
    const result = wrapInlineInsightParagraphs(html, insightOptions);

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(result).toEndWith('</div><div>unexpected</div>');
  });
});

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
