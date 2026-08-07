/**
 * Account lockout must stay recoverable.
 *
 * Every sign-in surface in this deployment locks an account for a few minutes
 * after five failed attempts. The lockout is only defensible while the owner
 * can still get back in, and that depends on two properties that are easy to
 * lose independently and were both lost on the Command Centre:
 *
 *   1. A password reset RELEASES the lock. The person resetting is, almost by
 *      definition, the person who just tripped it — they could not sign in, so
 *      they tried until the counter ran out. If the reset writes only
 *      `password_hash`, the new password is refused for the rest of the window
 *      and the reset looks like it silently failed. The four portals cleared
 *      the counters here; `admin-password-reset` did not.
 *
 *   2. A locked account SAYS it is locked. Command Centre answered a locked
 *      account and a wrong password with the same 401 "Invalid username or
 *      password", so the one state a reset cannot fix was indistinguishable
 *      from the one it can — and the owner reset again, and again.
 *
 * Together those two produced an account that could not be recovered by any
 * sequence its owner could perform, while every individual endpoint reported
 * itself working.
 *
 * These are source-level assertions for the same reason as
 * `crossPortalSessionIsolation.test.ts`: the property is entirely decidable
 * from what each function writes and returns, and a live test would need a real
 * mailbox and a real fifteen-minute lockout to prove it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = process.cwd();

/**
 * Source with comments removed — every fix here left a comment naming the
 * defect it replaced, so raw text would match the explanation as readily as
 * the code. `//` preceded by `:` is spared so `https://` specifiers survive.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const fn = (name: string) =>
  stripComments(readFileSync(join(repo, 'supabase/functions', name, 'index.ts'), 'utf8'));

/** Every function that sets a new password from a proof-of-mailbox code. */
const RESET_FUNCTIONS = [
  'admin-password-reset',
  'client-portal-reset-password',
  'finance-portal-reset-password',
  'solicitor-portal-reset-password',
  'builder-portal-reset-password',
] as const;

describe('a password reset releases the sign-in lockout', () => {
  it.each(RESET_FUNCTIONS)('%s clears the lockout when it writes the new hash', (name) => {
    const source = fn(name);

    // Guards the premise: if a rename means this file no longer writes a
    // password hash, the assertions below would pass vacuously.
    expect(source).toContain('password_hash');

    expect(source).toContain('locked_until: null');
    expect(source).toContain('failed_login_attempts: 0');
  });
});

describe('a locked Command Centre account is told that it is locked', () => {
  const login = fn('custom-auth-login-v2');

  it('answers a live lockout distinctly rather than as bad credentials', () => {
    expect(login).toMatch(/status:\s*429/);
    expect(login).toMatch(/locked/i);
  });

  it('does not fold the lockout back into the invalid-credentials branch', () => {
    // The exact shape of the defect: one predicate covering both states, which
    // is what made a lockout unreportable.
    expect(login).not.toMatch(/!isValid\s*\|\|\s*isLocked/);
  });

  it('still counts failures and still locks at the threshold', () => {
    expect(login).toContain('MAX_FAILED_ATTEMPTS');
    expect(login).toContain('LOCKOUT_MINUTES');
    expect(login).toContain('locked_until');
  });

  it('clears the counters on a successful sign-in', () => {
    expect(login).toContain('failed_login_attempts: 0');
    expect(login).toContain('locked_until: null');
  });
});

describe('Command Centre password reset stays reachable without a session', () => {
  /**
   * `reset_password` once called `verifyAuth` first. The only person who ever
   * reaches that action is someone who cannot sign in, so the gate was
   * unsatisfiable rather than strict — both OTP steps passed and the final
   * submit answered 401 on the "Set a new password" card.
   */
  it('does not require an authenticated session to set the new password', () => {
    expect(fn('admin-password-reset')).not.toContain('verifyAuth');
  });

  it('still requires a verified OTP and a strong password', () => {
    const source = fn('admin-password-reset');
    expect(source).toContain('verifyStaffOtp');
    expect(source).toContain('validatePasswordStrength');
    expect(source).toContain('MAX_RESET_ATTEMPTS');
  });
});
