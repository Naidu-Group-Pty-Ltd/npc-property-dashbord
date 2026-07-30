import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const brokerSource = readFileSync(
  'supabase/functions/get-client-data/index.ts',
  'utf8',
);
const triggerFix = readFileSync(
  'supabase/migrations/20260730130000_fix_legal_matter_purchase_file_sync.sql',
  'utf8',
);

describe('get-client-data legal matter boundary', () => {
  it('uses a server-owned purchase-file projection without relationship embeds', () => {
    const projection = brokerSource.match(
      /const SAFE_PURCHASE_FILES_SELECT\s*=\s*\n?\s*'([^']+)'/,
    )?.[1];

    expect(projection).toBeTruthy();
    expect(projection).not.toMatch(/[()!]/);
    expect(brokerSource).toContain("targetTable === 'purchase_files'");
    expect(brokerSource).toContain('? SAFE_PURCHASE_FILES_SELECT');
  });

  it('scopes service-role purchase-file reads to accessible clients', () => {
    expect(brokerSource).toContain("targetTable === 'purchase_files' && !await canAccessAllClients");
    expect(brokerSource).toContain("query = query.in('client_id'");
  });

  it('guards every OLD field access from INSERT trigger executions', () => {
    expect(triggerFix).not.toContain('COALESCE(OLD.');
    const updateGuard = triggerFix.indexOf("IF TG_OP = 'UPDATE' THEN");
    expect(updateGuard).toBeGreaterThan(-1);
    expect(triggerFix.indexOf('OLD.purchase_file_id')).toBeGreaterThan(updateGuard);
    expect(triggerFix.indexOf('OLD.legal_matter_id')).toBeGreaterThan(updateGuard);
    expect(triggerFix.match(/OLD\./g)).toHaveLength(2);
  });
});
