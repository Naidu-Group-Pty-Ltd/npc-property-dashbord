import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = process.cwd();
const clientSource = readFileSync(join(repo, 'src/lib/solicitorPortal.ts'), 'utf8');
const loginSource = readFileSync(
  join(repo, 'supabase/functions/solicitor-portal-login/index.ts'),
  'utf8',
);
const acceptInviteSource = readFileSync(
  join(repo, 'supabase/functions/solicitor-portal-accept-invite/index.ts'),
  'utf8',
);

describe('solicitor portal session transport', () => {
  it('uses the HttpOnly cookie without exposing or replaying its bearer token', () => {
    expect(clientSource).toContain("credentials: 'include'");
    expect(clientSource).not.toMatch(/(?:local|session)Storage/);
    expect(clientSource).not.toContain('x-solicitor-session-token');
    expect(clientSource).not.toContain('solicitor_session_token');
  });

  it('does not return raw session credentials in authentication responses', () => {
    // The sole remaining occurrence in each function persists the server-side
    // session record; response JSON must never contain a second occurrence.
    expect(loginSource.match(/session_token:\s*sessionToken/g)).toHaveLength(1);
    expect(acceptInviteSource.match(/session_token:\s*sessionToken/g)).toHaveLength(1);
    expect(loginSource).toContain("'Set-Cookie': createSolicitorSessionCookie(sessionToken, expiresAt)");
    expect(acceptInviteSource).toContain("'Set-Cookie': createSolicitorSessionCookie(sessionToken, expiresAt)");
  });
});
