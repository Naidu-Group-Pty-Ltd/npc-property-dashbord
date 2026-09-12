/**
 * TWO TABS, ONE COOKIE — a write landing in the wrong builder organisation.
 *
 * REPORTED AND CONFIRMED 12 SEPTEMBER 2026. A stock list uploaded from a page
 * headed "Kopi Jantan Builders" was filed under Bob The Builder. Read out of
 * `builder_portal_activity_log`:
 *
 *     01:19:04  Kopi Jantan session (…bupathy3@)  last used
 *     01:21:28  Bob login            (…bupathy03@)
 *     01:22:32  builder_stock_upload_started  ->  Bob The Builder
 *
 * and again at 04:38:36 / 04:38:47, where BOTH accounts logged in from the
 * same browser eleven seconds apart.
 *
 * THE SERVER WAS NOT WRONG. Every builder-portal query narrows to the
 * session's organisation, the accessible set comes from a SECURITY DEFINER
 * function scoped to the user, all four stock tables are RLS service-role only
 * and both buckets are private — `builderStockTenantIsolation.test.ts` holds
 * that side, and it still holds. The upload was attributed to Bob because the
 * request carried BOB'S COOKIE.
 *
 * THE CAUSE IS THAT ONE ORIGIN HAS ONE SESSION COOKIE.
 * `__Host-builder_session_token` is a single fixed name, and the `__Host-`
 * prefix pins it to Path=/ with no Domain, so there is exactly one per origin.
 * Signing into a second builder account REPLACES the first tab's token. That
 * tab is never told: `useBuilderPortalAuth` ran `checkSession()` on mount and
 * listened for nothing, so its React state, its cached identity and its
 * sidebar all still said Kopi Jantan while `credentials: 'include'` sent Bob.
 *
 * The purge in `builderPortalTenantCache.test.ts` fixes "sign out, sign in as
 * somebody else, SAME tab". It cannot see this, because the stale tab never
 * asks again.
 *
 * Two halves, both pinned below. The tab learns that it changed identity, and
 * the write says which organisation it thinks it is for so the server can
 * refuse rather than file it under whoever the cookie now names.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const HOOK    = read('src/hooks/useBuilderPortalAuth.tsx');
const ACTING  = read('src/lib/builderActingOrganisation.ts');
const QUERIES = read('src/lib/builderStockQueries.ts');
const SERVER  = read('supabase/functions/builder-portal-stock/index.ts');

describe('a stale tab finds out that it is no longer who it thinks it is', () => {
  it('re-checks the session when another tab writes the identity stamp', () => {
    expect(HOOK).toMatch(/addEventListener\(\s*'storage'/);
    expect(HOOK).toContain('BUILDER_IDENTITY_STAMP_KEY');
  });

  /*
   * `storage` fires only in OTHER tabs, so it misses a second login made in
   * THIS one, and it misses a tab that was backgrounded when the stamp moved.
   * Focus and visibility are the moment a person returns to a tab they left
   * open — which is when they reach for the button.
   */
  it('and when the tab is focused or made visible again', () => {
    expect(HOOK).toMatch(/addEventListener\(\s*'focus'/);
    expect(HOOK).toMatch(/addEventListener\(\s*'visibilitychange'/);
  });

  it('writes the stamp so the other tabs get that event at all', () => {
    expect(HOOK).toMatch(/localStorage\.setItem\(\s*BUILDER_IDENTITY_STAMP_KEY/);
  });

  /*
   * A portal that cannot write a stamp must still work: storage throws in a
   * private window. The focus listener covers that case on its own.
   */
  it('survives storage being unavailable', () => {
    const block = HOOK.slice(HOOK.indexOf('localStorage.setItem'));
    expect(block.slice(0, 200)).toMatch(/catch/);
  });
});

describe('a write says which organisation the page was showing', () => {
  /*
   * MUST be a module-level variable, never localStorage. localStorage is
   * shared across tabs, so a stale tab would read the identity the NEW login
   * wrote, agree with the hijacked cookie, and the guard would pass — which
   * is precisely the defect.
   */
  it('holds the acting organisation per tab, not in shared storage', () => {
    expect(ACTING).toMatch(/let actingOrganisationId: string \| null = null;/);
    const region = ACTING.slice(ACTING.indexOf('actingOrganisationId'));
    expect(region).not.toMatch(/localStorage|sessionStorage/);
  });

  it('the auth hook publishes it whenever it learns the active organisation', () => {
    expect(HOOK).toMatch(/setActingOrganisation\(data\.active_organisation\?\.organisation_id \?\? null\)/);
  });

  it('and clears it when the session is cleared', () => {
    expect(HOOK).toMatch(/setActingOrganisation\(null\)/);
  });

  /*
   * Both call sites, or the unguarded one is the way through. `invoke` and
   * `invokeBounded` are the only two places this module reaches the function.
   */
  it('stamps every builder-portal-stock call, not just one path', () => {
    const calls = [...QUERIES.matchAll(/invokeBuilderFunction<T>\('builder-portal-stock',\s*([A-Za-z(]+)/g)]
      .map((m) => m[1]);
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.startsWith('withActingOrganisation'))).toBe(true);
  });
});

describe('the server refuses a write whose organisation is not the one on screen', () => {
  it('compares the declared organisation against the session-held one', () => {
    expect(SERVER).toContain('const expectedOrganisationId = cleanText(body.expected_organisation_id, 64);');
    expect(SERVER).toMatch(/expectedOrganisationId !== activeOrganisationId/);
  });

  it('answers 409 with a code the client can act on', () => {
    expect(SERVER).toContain("code: 'organisation_context_changed'");
    expect(SERVER).toMatch(/\}, 409\);/);
  });

  /*
   * THE DIRECTION MATTERS. The declared id may only ever REFUSE. If it could
   * select the organisation, a forged `expected_organisation_id` would be the
   * cross-tenant read this whole file exists to prevent — so the scope still
   * comes from `session.active_organisation` and nothing else.
   */
  it('never lets the declared id widen or select the scope', () => {
    expect(SERVER).toContain(
      'const activeOrganisationId = session.active_organisation?.organisation_id ?? null;');
    const guard = SERVER.slice(SERVER.indexOf('const expectedOrganisationId'));
    const body = guard.slice(0, guard.indexOf('}, 409);'));
    expect(body).not.toMatch(/activeOrganisationId\s*=/);
  });

  /*
   * Absent must stay harmless: an older client, or a tab that has not resolved
   * its session yet, must not start failing.
   */
  it('does nothing when the client did not declare one', () => {
    expect(SERVER).toMatch(/if \(expectedOrganisationId && expectedOrganisationId !== activeOrganisationId\)/);
  });
});
