import { describe, expect, it } from 'vitest';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken';

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
});
