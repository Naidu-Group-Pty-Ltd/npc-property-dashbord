import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { hasFinancePortalPermission } from '../../_shared/finance-portal-permissions.ts';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('finance portal cross-client inbox permissions', () => {
  it('does not let messages access imply notes or contacts access', () => {
    const globalPermissions = {};
    const assignmentPermissions = {
      messages: { view: true },
      notes: { view: false },
      contacts: { view: false },
    };

    expect(hasFinancePortalPermission(globalPermissions, assignmentPermissions, 'messages', 'view', true)).toBe(true);
    expect(hasFinancePortalPermission(globalPermissions, assignmentPermissions, 'notes', 'view')).toBe(false);
    expect(hasFinancePortalPermission(globalPermissions, assignmentPermissions, 'contacts', 'view')).toBe(false);
  });

  it('scopes protected inbox queries to their independently authorized clients', () => {
    expect(source).toContain("hasFinancePortalPermission(partner.global_permissions, a.permissions, 'notes', 'view')");
    expect(source).toContain("hasFinancePortalPermission(partner.global_permissions, a.permissions, 'contacts', 'view')");
    expect(source).toContain(".in('client_id', noteClientIds)");
    expect(source).toContain(".in('id', contactClientIds)");
    expect(source).not.toContain("secondary_email, secondary_mobile, last_note_at");
  });
});
