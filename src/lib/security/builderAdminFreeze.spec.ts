/**
 * The builder admin plane is FROZEN read-only (extraction plan §7 Phase 6).
 *
 * The Builder / Developer Portal moved to the central Builders Network;
 * `/builder/*` on this workspace redirects there and the builder tables are
 * an archive awaiting Phase 7 decommission. A Command Centre edit made here
 * would fork this copy from the network's record and be silently destroyed
 * at decommission — so every RECORD mutation across the eight builder admin
 * functions is refused server-side, before the operation dispatch, by ONE
 * shared rule. Reads stay (the archive is worth looking at, and Phase 7's
 * export depends on it); the CONTAINMENT acts stay (suspension, membership
 * revocation, session revocation — the prime's builder-portal functions keep
 * answering session cookies until Phase 7 removes them, and removing a
 * ceremony must never remove a control).
 *
 * This spec is the drift guard: hiding buttons is never authorisation, and
 * an admin function that forgets the freeze — or a ninth admin function
 * added without it — is exactly the silent divergence the freeze exists to
 * prevent. It reads the sources rather than trusting this prose.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILDER_ADMIN_CONTAINMENT_OPERATIONS,
  builderAdminFreezeRefusal,
} from '../../../supabase/functions/_shared/builderPortal/adminFreeze';

const ADMIN_FUNCTIONS = [
  'builder-portal-admin',
  'builder-projects-admin',
  'builder-inventory-admin',
  'builder-transactions-admin',
  'builder-construction-admin',
  'builder-delivery-admin',
  'builder-collaboration-admin',
  'builder-workspace-admin',
] as const;

const read = (fn: string) =>
  readFileSync(join(process.cwd(), 'supabase/functions', fn, 'index.ts'), 'utf8');

describe('builder admin freeze — every admin function refuses record mutations', () => {
  it.each(ADMIN_FUNCTIONS)('%s imports the shared rule and applies it before dispatch', (fn) => {
    const source = read(fn);
    expect(source, `${fn} must import the freeze from the one shared module`)
      .toMatch(/import \{ builderAdminFreezeRefusal \} from ['"]\.\.\/_shared\/builderPortal\/adminFreeze\.ts['"]/);

    // The freeze classifies by the SAME set the permission model uses —
    // READ_OPERATIONS — so "read" cannot mean two different things in one
    // function.
    expect(source, `${fn} must hand the freeze its own READ_OPERATIONS verdict`)
      .toContain('builderAdminFreezeRefusal(operation, READ_OPERATIONS.has(operation))');

    // Applied BEFORE the module-permission gate, which itself precedes every
    // operation handler: a frozen mutation never reaches a handler.
    const freezeAt = source.indexOf('builderAdminFreezeRefusal(operation,');
    const authzAt = source.indexOf('const authz = await requireModulePermission(');
    expect(freezeAt, `${fn} must apply the freeze`).toBeGreaterThan(-1);
    expect(authzAt, `${fn} must still gate on module permission`).toBeGreaterThan(-1);
    expect(freezeAt, `${fn} must freeze before dispatch, not inside handlers`)
      .toBeLessThan(authzAt);
  });

  it('the admin family list above IS the admin family on disk', () => {
    // A ninth builder-*-admin function added without the freeze must fail
    // HERE, not ship silently. builder-portal-admin wears the portal prefix
    // but is the Command Centre control plane (ADR 018), hence its place in
    // the family.
    const onDisk = readdirSync(join(process.cwd(), 'supabase/functions'))
      .filter((d) => /^builder-.*-admin$/.test(d) || d === 'builder-portal-admin')
      .sort();
    expect(onDisk).toEqual([...ADMIN_FUNCTIONS].sort());
  });
});

describe('builder admin freeze — the rule itself', () => {
  it('a read is never frozen', () => {
    expect(builderAdminFreezeRefusal('list_organisations', true)).toBeNull();
    expect(builderAdminFreezeRefusal('get_membership_permissions', true)).toBeNull();
  });

  it('a record mutation is refused, and the refusal names where to act', () => {
    for (const op of ['upsert_organisation', 'create_user', 'delete_user',
      'upsert_membership', 'update_membership_permissions', 'upsert_project']) {
      const refusal = builderAdminFreezeRefusal(op, false);
      expect(refusal, op).not.toBeNull();
      expect(refusal?.code).toBe('builder_admin_read_only');
      expect(refusal?.moved_to).toBe('https://builders.aurixasystems.com.au');
      // The message must say what still works — a freeze that reads as a
      // total outage sends an operator hunting for a broken permission.
      expect(refusal?.error).toContain('read-only archive');
    }
  });

  it('containment survives — removing a ceremony must never remove a control', () => {
    expect([...BUILDER_ADMIN_CONTAINMENT_OPERATIONS].sort()).toEqual([
      'revoke_membership',
      'revoke_user_sessions',
      'set_organisation_status',
      'set_user_status',
    ]);
    for (const op of BUILDER_ADMIN_CONTAINMENT_OPERATIONS) {
      expect(builderAdminFreezeRefusal(op, false), op).toBeNull();
    }
  });

  it('every containment operation is a real operation of the portal admin', () => {
    // A containment exemption naming an operation that does not exist is a
    // control that appears to survive and does not — the exact class of
    // silent defect this repository keeps documenting.
    const source = read('builder-portal-admin');
    for (const op of BUILDER_ADMIN_CONTAINMENT_OPERATIONS) {
      expect(source, op).toContain(`case '${op}'`);
    }
  });
});
