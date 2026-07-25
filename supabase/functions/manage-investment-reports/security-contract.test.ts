import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('manage-investment-reports package authorization contract', () => {
  it('requires generated reports edit permission before dispatching package archive actions', () => {
    const permissionGate = functionSource.indexOf("'generated_reports',\n        'can_edit'");
    const actionDispatch = functionSource.indexOf("case 'archivePackage':");

    expect(functionSource).toContain("action === 'archivePackage' || action === 'unarchivePackage'");
    expect(functionSource).toContain('return createForbiddenResponse(');
    expect(permissionGate).toBeGreaterThan(-1);
    expect(actionDispatch).toBeGreaterThan(permissionGate);
  });
});
