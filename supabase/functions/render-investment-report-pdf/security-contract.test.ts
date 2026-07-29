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

  it('escapes watermark text before embedding it in the SVG data URI', () => {
    expect(functionSource).toContain(
      'const wmText = esc(String(contact.company_name || brandName || "NPC").toUpperCase());',
    );
    expect(functionSource).toContain('url("${wmSvg}")');
    expect(functionSource).not.toContain("url('${wmSvg}')");
  });
});
