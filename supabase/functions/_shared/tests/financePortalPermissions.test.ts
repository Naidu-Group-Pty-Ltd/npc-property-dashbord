import { describe, expect, it } from 'vitest';

import { hasFinancePortalPermission } from '../finance-portal-permissions.ts';

describe('hasFinancePortalPermission', () => {
  it('rejects a recipient when purchase-file viewing is explicitly denied', () => {
    expect(hasFinancePortalPermission(
      {},
      { purchase_files: { view: false, edit: false } },
      'purchase_files',
      'view',
      true,
    )).toBe(false);
  });

  it('accepts a view grant from either global or client permissions', () => {
    expect(hasFinancePortalPermission(
      { purchase_files: { view: true } },
      { purchase_files: { view: false } },
      'purchase_files',
      'view',
      true,
    )).toBe(true);
    expect(hasFinancePortalPermission(
      { purchase_files: { view: false } },
      { purchase_files: { view: true } },
      'purchase_files',
      'view',
      true,
    )).toBe(true);
  });

  it('preserves legacy default access only when the module is unconfigured', () => {
    expect(hasFinancePortalPermission({}, {}, 'purchase_files', 'view', true)).toBe(true);
    expect(hasFinancePortalPermission({}, {}, 'purchase_files', 'view')).toBe(false);
  });
});
