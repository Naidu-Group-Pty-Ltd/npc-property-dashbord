import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enforceCsrf } from '../_shared/csrfGuard';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('finance portal session token extraction', () => {
  it('restores a session from the HttpOnly cookie used by finance portal login', () => {
    const headers = new Headers({ cookie: '__Host-session_token=server-valid-token; theme=dark' });

    expect(extractFinanceSessionToken(headers)).toBe('server-valid-token');
  });

  it('accepts the finance-specific cookie name during rollout', () => {
    const headers = new Headers({ cookie: '__Host-finance_session_token=finance%2Ftoken' });

    expect(extractFinanceSessionToken(headers)).toBe('finance/token');
  });

  it('preserves explicit finance header precedence', () => {
    const headers = new Headers({
      cookie: '__Host-session_token=cookie-token',
      'x-finance-session-token': 'header-token',
    });

    expect(extractFinanceSessionToken(headers)).toBe('header-token');
  });

  it('does not expose a session token from the verify response', () => {
    expect(functionSource).not.toMatch(/session_token:\s*sessionToken/);
  });

  it('guards cookie-authenticated mutations against cross-site requests', () => {
    const request = new Request('https://example.test/finance-portal-verify', {
      method: 'POST',
      headers: {
        cookie: '__Host-finance_session_token=server-valid-token',
        origin: 'https://evil.example',
      },
    });

    expect(enforceCsrf(request)).toMatchObject({ ok: false, reason: 'origin_not_allowed' });
    expect(functionSource).toContain("if (action === 'accept_terms' || action === 'complete_onboarding')");
    expect(functionSource).toContain('if (!csrf.ok) return csrfDenied(corsHeaders, csrf);');
  });
});
