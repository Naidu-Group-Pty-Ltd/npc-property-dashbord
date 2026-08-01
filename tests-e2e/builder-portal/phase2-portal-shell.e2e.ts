import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — Phase 2 end-to-end shell tests.
 *
 * These run against the real built application in a real browser, served by
 * `vite preview`. They deliberately do NOT require a deployed backend: Phase 2
 * deploys nothing, so every Supabase Edge Function call is intercepted and
 * answered locally. What is being verified is the portal shell, the governance
 * gate's routing decisions and the browser-side security posture — all of which
 * are frontend behaviour.
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 *
 * Run with: npm run test:e2e:builder-portal
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT || 4319);
const BASE = `http://127.0.0.1:${PORT}`;
const HAS_BUILD = existsSync(join(ROOT, 'dist/index.html'));

let server: ChildProcess | undefined;

const FUNCTIONS = '**/functions/v1/**';

/** An unauthenticated verify response, exactly as the Edge Function returns it. */
const NO_SESSION = { valid: false, error: 'Invalid or expired session', code: 'auth_required' };

/**
 * A signed-in user with one outstanding governance stage. `stage` selects which
 * one, so each gate branch can be driven independently.
 */
const sessionFixture = (stage: 'password' | 'organisation' | 'terms' | 'onboarding' | 'clear') => {
  const organisation = {
    organisation_id: '11111111-1111-1111-1111-111111111111',
    legal_name: 'Harbourline Constructions Pty Ltd',
    trading_name: 'Harbourline',
    org_type: 'builder',
    membership_role: 'manager',
    is_primary: true,
    rollout_enabled: true,
  };
  return {
    valid: true,
    user: {
      id: 'aaaaaaaa-0000-0000-0000-00000000000a',
      email: 'multi@harbourline.test',
      name: 'Multi Org',
      phone: null,
      job_title: 'Project Manager',
      must_change_password: stage === 'password',
      has_accepted_terms: stage !== 'terms',
      has_completed_onboarding: stage === 'clear',
      current_terms_version: 'v1.0',
      has_accepted_current_terms: stage !== 'terms',
      has_completed_mandatory_onboarding: stage === 'clear',
    },
    organisations: [organisation],
    active_organisation: stage === 'organisation' ? null : organisation,
    requires_organisation_selection: stage === 'organisation',
    permissions: {},
    governance: null,
    previous_seen_at: null,
  };
};

/** Answer every Edge Function call locally so no request reaches production. */
const stubFunctions = async (page: Page, verifyBody: unknown) => {
  await page.route(FUNCTIONS, async (route) => {
    const url = route.request().url();
    if (url.includes('builder-portal-verify')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(verifyBody) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
};

test.beforeAll(async () => {
  if (!HAS_BUILD) return;
  // Bound explicitly to 127.0.0.1: vite's default binding is IPv6-first, and
  // sandboxed CI containers frequently have no IPv6 stack at all.
  server = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: false },
  );
  // Poll rather than sleep a fixed interval — the preview server is usually
  // ready in well under a second, and a hard wait would be both slower and
  // flakier.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(BASE);
      if (response.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('vite preview did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
});

test.describe('Builder Portal shell', () => {
  test.skip(!HAS_BUILD, 'requires a production build — run `npm run build` first');

  test('an unauthenticated visitor is sent to the Builder sign-in page', async ({ page }) => {
    await stubFunctions(page, NO_SESSION);
    await page.goto(`${BASE}/builder`);
    await expect(page).toHaveURL(/\/builder\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('the sign-in page is the external portal, not the internal dashboard', async ({ page }) => {
    await stubFunctions(page, NO_SESSION);
    await page.goto(`${BASE}/builder/login`);
    await expect(page.getByText('Builder / Developer Portal')).toBeVisible();
    // The internal Command Centre chrome must not be present on any external
    // portal surface.
    await expect(page.getByRole('navigation', { name: 'Builder portal' })).toHaveCount(0);
    await expect(page.locator('[data-sidebar]')).toHaveCount(0);
  });

  test('signing in stores nothing in the browser', async ({ page }) => {
    await stubFunctions(page, NO_SESSION);
    await page.goto(`${BASE}/builder/login`);
    const stored = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
      cookie: document.cookie,
    }));
    // An HttpOnly cookie is invisible to document.cookie by definition, so any
    // Builder session material readable here would be a defect.
    expect(stored.local.filter((key) => /builder/i.test(key))).toEqual([]);
    expect(stored.session.filter((key) => /builder/i.test(key))).toEqual([]);
    expect(stored.cookie).not.toMatch(/builder_session/i);
  });

  test('the password-rotation stage renders its own page instead of looping', async ({ page }) => {
    await stubFunctions(page, sessionFixture('password'));
    await page.goto(`${BASE}/builder`);
    await expect(page).toHaveURL(/\/builder\/change-password$/);
    await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible();
    // The redirect must settle: navigating to the destination directly must not
    // bounce again.
    await page.goto(`${BASE}/builder/change-password`);
    await expect(page).toHaveURL(/\/builder\/change-password$/);
  });

  test('the organisation-selection stage renders its own page', async ({ page }) => {
    await stubFunctions(page, sessionFixture('organisation'));
    await page.goto(`${BASE}/builder`);
    await expect(page).toHaveURL(/\/builder\/select-organisation$/);
    await expect(page.getByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
  });

  test('the terms stage renders its own page', async ({ page }) => {
    await stubFunctions(page, sessionFixture('terms'));
    await page.goto(`${BASE}/builder`);
    await expect(page).toHaveURL(/\/builder\/terms$/);
  });

  test('a fully governed user reaches the portal shell', async ({ page }) => {
    await stubFunctions(page, sessionFixture('clear'));
    await page.goto(`${BASE}/builder`);
    await expect(page).toHaveURL(/\/builder$/);
    await expect(page.getByRole('navigation', { name: 'Builder portal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  });

  test('no navigation item is a disabled placeholder', async ({ page }) => {
    // Phase 2 shipped this navigation with every business item disabled; each
    // became a working link as its module landed. The portal is now complete, so
    // the assertion is the other half of the same rule: nothing is left disabled,
    // and every item is a real link into the portal tree.
    await stubFunctions(page, sessionFixture('clear'));
    await page.goto(`${BASE}/builder`);
    const navigation = page.getByRole('navigation', { name: 'Builder portal' });
    await expect(navigation.getByRole('button')).toHaveCount(0);
    for (const label of ['Dashboard', 'Projects', 'Inventory', 'Transactions', 'Pipeline',
      'Construction', 'Documents', 'Messages', 'Tasks', 'Notifications', 'Settings']) {
      await expect(navigation.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });

  test('the dashboard shows no business or financial data', async ({ page }) => {
    await stubFunctions(page, sessionFixture('clear'));
    await page.goto(`${BASE}/builder`);
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of [
      'invoice', 'progress payment', 'commission', 'borrowing capacity',
      'serviceability', 'aml', 'income', 'liabilit',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('an unknown Builder path returns to the portal entry, not a blank screen', async ({ page }) => {
    await stubFunctions(page, sessionFixture('clear'));
    // Deliberately a path with no route at all — /builder/projects/:projectId
    // became a real route in Phase 3.
    await page.goto(`${BASE}/builder/not-a-real-surface`);
    await expect(page).toHaveURL(/\/builder$/);
  });
});
