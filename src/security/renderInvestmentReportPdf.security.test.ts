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
      'const centerSub = svgEscape(opts.centerSub ?? segments[0]?.label ?? "");',
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
