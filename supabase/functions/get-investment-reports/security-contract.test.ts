import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('get-investment-reports authorization contract', () => {
  it('requires report view permission before dispatching service-role reads', () => {
    const permissionGate = functionSource.indexOf('const permission = await requireModulePermission(');
    const singleRead = functionSource.indexOf('// Single report fetch', permissionGate);
    const multipleRead = functionSource.indexOf('// Multiple reports fetch by IDs', permissionGate);
    const listRead = functionSource.indexOf('// List mode - fetch reports with filters', permissionGate);

    expect(functionSource).toContain("table === 'generated_reports' ? 'generated_reports' : 'reports'");
    expect(functionSource).toContain("'can_view'");
    expect(functionSource).toContain('return createForbiddenResponse(');
    expect(permissionGate).toBeGreaterThan(-1);
    expect(singleRead).toBeGreaterThan(permissionGate);
    expect(multipleRead).toBeGreaterThan(permissionGate);
    expect(listRead).toBeGreaterThan(permissionGate);
  });
});
