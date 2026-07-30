import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/solicitor-portal-matters/index.ts', 'utf8');
const upcomingDates = source.slice(
  source.indexOf("if (operation === 'upcoming_dates')"),
  source.indexOf('// ───────────────────────── STATS'),
);

describe('solicitor-portal-matters authorization', () => {
  it('filters upcoming critical dates by each client permission matrix', () => {
    expect(upcomingDates).toContain('resolveClientPermissions(supabase, me.id, clientId)');
    expect(upcomingDates).toContain("can(perms, 'matters', 'view')");
    expect(upcomingDates).toContain("can(perms, 'critical_dates', 'view')");
    expect(upcomingDates).toContain(".in('client_id', permittedClientIds)");

    const permissionCheck = upcomingDates.indexOf("can(perms, 'critical_dates', 'view')");
    expect(permissionCheck).toBeGreaterThan(-1);
    expect(permissionCheck).toBeLessThan(upcomingDates.indexOf(".from('legal_matters')"));
    expect(permissionCheck).toBeLessThan(upcomingDates.indexOf(".from('legal_matter_critical_dates')"));
  });
});
