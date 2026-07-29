import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('finance portal batch 6 object authorization', () => {
  it('requires a dedicated non-public secret for reminder cron calls', () => {
    expect(source).toContain("Deno.env.get('FINANCE_PORTAL_CRON_SECRET')");
    expect(source).toContain("req.headers.get('x-cron-secret')");
    expect(source).toContain('constantTimeEqual(configured, presented)');
    expect(source).not.toContain("Deno.env.get('SUPABASE_ANON_KEY')");
  });

  it('checks effective permissions for file and document operations', () => {
    expect(source).toContain("portalUser.global_permissions, 'purchase_files', action");
    expect(source).toContain("'document_requirement_instances', id, 'edit', 'documents'");
  });

  it('authorizes replacement booking associations before updating', () => {
    const update = source.slice(
      source.indexOf("if (operation === 'bookings_update')"),
      source.indexOf("if (operation === 'bookings_cancel')"),
    );
    expect(update).toContain('requireBookingAssociationAccess(purchaseFileId, clientId)');
    expect(update.indexOf('requireBookingAssociationAccess')).toBeLessThan(update.indexOf('.update({ ...patch'));
  });
});
