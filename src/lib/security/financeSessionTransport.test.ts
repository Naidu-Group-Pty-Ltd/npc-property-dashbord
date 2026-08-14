/**
 * The Finance Portal's session must be readable where it actually lives.
 *
 * ## The production failure
 *
 * WP-11B/C moved the portal's session into an HttpOnly
 * `__Host-finance_session_token` cookie and deliberately stopped mirroring it
 * into localStorage — the client keeps an in-memory copy only, and that does
 * not survive a page load. `finance-portal-verify` and `finance-portal-logout`
 * were moved onto a cookie-aware reader. The ~26 data functions were not.
 *
 * So from the second page view onwards the browser sent no header and no body
 * token, only the cookie, and every data call was answered
 * `401 Session token required`. Measured on `finance-portal-agreements`:
 * request body 20 bytes (`{"operation":"list"}` — no token fields), response
 * 54 bytes, a valid unexpired cookie on the request. Reproduced exactly by
 * curl: no credential at all and a cookie-only credential produce a
 * byte-identical 401, while a header credential produces a different one.
 *
 * The partner's agreements page therefore rendered "No agreements yet" for an
 * agreement that had been issued and delivered, while the Command Centre
 * correctly showed "Delivery confirmed" from the single call that ran in the
 * tab which still had the token in memory. The portal looked signed in
 * throughout, because the session CHECK read the cookie and the data calls did
 * not.
 *
 * These tests pin the transport itself. The per-function sweep is enforced
 * separately and mechanically by
 * `scripts/security/check-finance-session-transport.mjs`, because a local
 * six-line `extractToken` reading two headers looks perfectly reasonable in
 * review — it is only wrong in the context of where the session lives.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractFinanceCredential,
  extractFinanceSessionToken,
} from '../../../supabase/functions/_shared/financeSessionToken.ts';

const COOKIE = '__Host-finance_session_token';
const TOKEN = '19d9bcea-6042-4c1f-9f2a-000000000000';

function repoFile(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

describe('reading the credential', () => {
  it('reads the session cookie — the whole bug in one assertion', () => {
    const headers = new Headers({ cookie: `${COOKIE}=${TOKEN}` });
    expect(extractFinanceSessionToken(headers)).toBe(TOKEN);
    expect(extractFinanceCredential(headers)).toEqual({ token: TOKEN, source: 'cookie' });
  });

  it('url-decodes a cookie value', () => {
    const headers = new Headers({ cookie: `${COOKIE}=finance%2Ftoken` });
    expect(extractFinanceSessionToken(headers)).toBe('finance/token');
  });

  it('finds the cookie among others', () => {
    const headers = new Headers({ cookie: `theme=dark; ${COOKIE}=${TOKEN}; tz=AEST` });
    expect(extractFinanceCredential(headers).token).toBe(TOKEN);
  });

  it('still prefers the header, so the previously working path is unchanged', () => {
    const headers = new Headers({
      'x-finance-session-token': 'from-header',
      cookie: `${COOKIE}=${TOKEN}`,
    });
    expect(extractFinanceCredential(headers)).toEqual({ token: 'from-header', source: 'header' });
  });

  it('still reads the body, below the header and above the cookie', () => {
    const headers = new Headers({ cookie: `${COOKIE}=${TOKEN}` });
    expect(extractFinanceCredential(headers, { finance_session_token: 'from-body' }))
      .toEqual({ token: 'from-body', source: 'body' });
  });

  it('reports nothing when there is nothing', () => {
    expect(extractFinanceCredential(new Headers())).toEqual({ token: null, source: 'none' });
  });

  it('never accepts the Command Centre cookie as a finance credential', () => {
    // A staff cookie must not be offered as a partner credential, and a
    // partner session must not be resolvable from one.
    const headers = new Headers({ cookie: '__Host-session_token=staff-session-token' });
    expect(extractFinanceSessionToken(headers)).toBeNull();
    expect(extractFinanceCredential(headers).source).toBe('none');
  });

  it('agrees with itself', () => {
    for (const headers of [
      new Headers({ cookie: `${COOKIE}=${TOKEN}` }),
      new Headers({ 'x-finance-session-token': TOKEN }),
      new Headers({ 'x-session-token': TOKEN }),
      new Headers(),
    ]) {
      expect(extractFinanceCredential(headers).token).toBe(extractFinanceSessionToken(headers));
    }
  });
});

describe('the shared resolver is the only implementation', () => {
  it('finance-portal-session delegates rather than re-reading headers', () => {
    const src = repoFile('supabase', 'functions', '_shared', 'finance-portal-session.ts');
    expect(src).toContain('extractFinanceSessionToken(headers');
    // The four-`??` body that could not see a cookie must not come back.
    expect(src).not.toMatch(/return headers\.get\('x-finance-session-token'\)\s*\n\s*\|\|/);
  });

  it('the agreements function resolves a credential, not a bare token', () => {
    const src = repoFile('supabase', 'functions', 'finance-portal-agreements', 'index.ts');
    expect(src).toContain('extractFinanceCredential(req.headers, body)');
    expect(src).toContain('resolveFinancePartner(supabase, credential.token)');
  });
});

describe('honouring a cookie means guarding against CSRF', () => {
  const src = repoFile('supabase', 'functions', 'finance-portal-agreements', 'index.ts');

  it('applies the CSRF guard when the credential came from the cookie', () => {
    // The cookie is SameSite=None — it must be, the portal and the functions
    // are different origins — so the browser attaches it to cross-site
    // requests. Honouring it without this would let an attacker's page drive
    // `accept` or `sign` from a signed-in partner's browser.
    expect(src).toContain("credential.source === 'cookie'");
    expect(src).toContain('enforceCsrf(req)');
    expect(src).toContain('csrfDenied(corsHeaders, csrf)');
  });

  it('does not apply it to header auth', () => {
    // A cross-site page cannot set a custom header, so there is no ambient
    // authority to defend against — and guarding it would break non-browser
    // callers for nothing. Same rule csrfGuard.ts states for itself.
    const guard = src.split("credential.source === 'cookie'")[1]?.split('}')[0] ?? '';
    expect(guard).toContain('enforceCsrf');
    expect(src.indexOf("credential.source === 'cookie'")).toBeLessThan(src.indexOf('enforceCsrf(req)'));
  });
});

describe('the sweep is enforced mechanically', () => {
  it('ships a guard, and the security suite runs it', () => {
    const pkg = JSON.parse(repoFile('package.json'));
    expect(pkg.scripts['security:finance-session-transport']).toContain(
      'check-finance-session-transport.mjs',
    );
    expect(pkg.scripts['security:test']).toContain('security:finance-session-transport');
  });

  it('keeps the unconverted set as a baseline that can only shrink', () => {
    const guard = repoFile('scripts', 'security', 'check-finance-session-transport.mjs');
    expect(guard).toContain('const BASELINE');
    // Both directions: a new offender fails, and a fixed one must be removed
    // from the baseline rather than left to rot as a false record.
    expect(guard).toContain('regressions.length > 0');
    expect(guard).toContain('fixed.length > 0');
  });
});
