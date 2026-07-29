import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('./BcSegmentEngineAdmin.tsx', import.meta.url), 'utf8');
const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260725000000_restrict_api_health_log_select.sql', import.meta.url),
  'utf8',
);

describe('BC Segment Engine admin authorization contract', () => {
  it('keeps the route behind the superadmin-only module guard', () => {
    expect(appSource).toContain(
      '<Route path="admin/bc-segment-engine" element={<ModuleGuard moduleKey="__superadmin_only__"><BcSegmentEngineAdmin /></ModuleGuard>} />',
    );
  });

  it('does not load admin data for non-superadmins if the page is mounted directly', () => {
    const effectSource = pageSource.slice(pageSource.indexOf('useEffect(() => {'));
    const roleCheck = effectSource.indexOf('if (!isSuperadmin) return;');
    const healthLoad = effectSource.indexOf('loadHealth();');

    expect(roleCheck).toBeGreaterThan(-1);
    expect(healthLoad).toBeGreaterThan(roleCheck);
  });

  it('removes the legacy public health-log read policy', () => {
    expect(migrationSource).toContain(
      'DROP POLICY IF EXISTS "Anyone can view API health logs" ON public.api_health_log;',
    );
  });
});
