import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'supabase/functions/finance-portal-client-comms/index.ts'),
  'utf8',
);

describe('finance portal unified client communications authorization contract', () => {
  it('requires client assignment and effective message permissions before list and send', () => {
    expect(source).toContain(".from('finance_portal_client_assignments')");
    expect(source).toContain(".eq('finance_user_id', partner.id)");
    expect(source).toContain("hasFinancePortalPermission(partner.global_permissions, assignment.permissions, 'messages', action, true)");
    expect(source).toContain("authorizeClientMessages(supabase, partner, clientId, 'view', body.purchase_file_id)");
    expect(source).toContain("authorizeClientMessages(supabase, partner, client_id, 'edit', purchase_file_id)");
  });

  it('binds a supplied purchase file to the authorized client', () => {
    expect(source).toContain(".from('purchase_files')");
    expect(source).toContain(".eq('client_id', clientId)");
    expect(source).toContain('purchase_file_client_mismatch');
  });
});
