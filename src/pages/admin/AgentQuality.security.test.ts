import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const functionSource = readFileSync(
  new URL('../../../supabase/functions/ai-dashboard-agent/index.ts', import.meta.url),
  'utf8',
);

describe('Agent Quality authorization contract', () => {
  it('keeps the admin route behind the superadmin-only module guard', () => {
    expect(appSource).toContain(
      '<Route path="admin/agent-quality" element={<ModuleGuard moduleKey="__superadmin_only__"><AgentQuality /></ModuleGuard>} />',
    );
  });

  it('checks the persisted superadmin role before querying trace logs', () => {
    const traceAction = functionSource.slice(functionSource.indexOf("case 'get-trace-log':"));
    const roleCheck = traceAction.indexOf(".eq('role', 'superadmin')");
    const traceQuery = traceAction.indexOf(".from('agent_action_log')");

    expect(roleCheck).toBeGreaterThan(-1);
    expect(traceAction).toContain("status: 403");
    expect(traceQuery).toBeGreaterThan(roleCheck);
  });
});
