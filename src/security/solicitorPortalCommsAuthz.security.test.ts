import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/solicitor-portal-comms/index.ts', 'utf8');

describe('solicitor-portal-comms authorization', () => {
  it('limits the global thread list to clients with messages view permission', () => {
    expect(source).toContain(
      'assignedClientIds.map(async (clientId) => {\n' +
      '          const perms = await resolveClientPermissions(supabase, me.id, clientId);',
    );
    expect(source).toContain("can(perms, 'messages', 'view') ? clientId : null");
    expect(source).toContain(".in('client_id', permittedClientIds)");
  });
});
