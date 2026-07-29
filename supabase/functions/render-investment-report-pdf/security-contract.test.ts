import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('render-investment-report-pdf authorization contract', () => {
  it('authorizes object access before loading report content', () => {
    const authResult = functionSource.indexOf('const { error: authError, userId, authMethod }');
    const accessLookup = functionSource.indexOf('.select("generated_by, client_property_id")', authResult);
    const ownershipCheck = functionSource.indexOf('reportAccess?.generated_by === userId', accessLookup);
    const clientOwnershipCheck = functionSource.indexOf('.eq("created_by", userId)', ownershipCheck);
    const denial = functionSource.indexOf('if (!canAccessReport)', clientOwnershipCheck);
    const contentLookup = functionSource.indexOf('"id, property_address, report_content', denial);

    expect(functionSource).toContain('authMethod !== "service_role"');
    expect(authResult).toBeGreaterThan(-1);
    expect(accessLookup).toBeGreaterThan(authResult);
    expect(ownershipCheck).toBeGreaterThan(accessLookup);
    expect(clientOwnershipCheck).toBeGreaterThan(ownershipCheck);
    expect(denial).toBeGreaterThan(clientOwnershipCheck);
    expect(contentLookup).toBeGreaterThan(denial);
  });

  it('escapes quotes before interpolating metadata into HTML attributes', () => {
    expect(functionSource).toContain('.replace(/"/g, "&quot;")');
    expect(functionSource).toContain(".replace(/'/g, \"&#39;\")");
    expect(functionSource).toContain('content="${esc(docAuthor)}"');
    expect(functionSource).toContain('content="${esc(docKeywords)}"');
  });
});
