import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/solicitor-portal-matters/index.ts'),
  'utf8',
);
const sharedSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/legalMatters.ts'),
  'utf8',
);

describe('solicitor portal matter list security contract', () => {
  it('scopes list and stats queries to clients with matters.view', () => {
    expect(functionSource).toContain("can(matrix, 'matters', 'view')");
    expect(functionSource.match(/\.in\('client_id', viewableClientIds\)/g)).toHaveLength(2);
  });

  it('uses a reduced list projection without staff-only or detail fields', () => {
    expect(functionSource).toContain('.select(SOLICITOR_MATTER_LIST_SELECT)');

    const projection = sharedSource.match(
      /export const SOLICITOR_MATTER_LIST_SELECT = `([\s\S]*?)`;/,
    )?.[1];
    expect(projection).toBeTruthy();
    expect(projection).not.toMatch(
      /internal_notes|risk_notes|shared_summary|purchase_price|deposit_amount|title_reference|pexa_workspace_id/,
    );
  });
});
