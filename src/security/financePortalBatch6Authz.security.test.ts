import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/finance-portal-batch6/index.ts', 'utf8');

describe('finance-portal-batch6 purchase-file authorization', () => {
  it('resolves the file assignment and effective purchase-file permission', () => {
    expect(source).toContain(".from('finance_portal_client_assignments')");
    expect(source).toContain(".eq('finance_user_id', portalUser.id)");
    expect(source).toContain(".eq('client_id', file.client_id)");
    expect(source).toContain("'purchase_files',");
    expect(source).toContain('hasFinancePortalPermission(');
  });

  it('requires view permission for reads and edit permission for mutations', () => {
    expect(source.match(/requireFileAccess\(fid, 'view'\)/g)).toHaveLength(2);
    expect(source.match(/requireFileAccess\(fid, 'edit'\)/g)).toHaveLength(3);
    expect(source.match(/requireResourceAccess\([^\n]+, 'edit'\)/g)).toHaveLength(3);
  });
});
