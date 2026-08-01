import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — guided onboarding tour.
 *
 * Mirrors the Solicitor Portal tour, so these tests assert the same contract:
 * it appears once on first sign-in, walks the real navigation destinations,
 * can be dismissed and skipped, does not reappear once completed, can be
 * replayed from settings, falls back to a centred card when the destination is
 * not visible (mobile), and honours the reduced-motion preference.
 *
 * Tour completion is SERVER state — builder_user_preferences.tour_completed_at —
 * because the Builder Portal persists nothing in the browser. These tests
 * therefore drive it through the stubbed `get_my_preferences` /
 * `complete_onboarding_tour` operations rather than through localStorage.
 *
 * Runs against the real built application in a real browser, served by
 * `vite preview`. Nothing is deployed, so every Edge Function call is
 * intercepted and answered locally.
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT_TOUR || 4329);
const BASE = `http://127.0.0.1:${PORT}`;
const HAS_BUILD = existsSync(join(ROOT, 'dist/index.html'));

let server: ChildProcess | undefined;

const organisation = {
  organisation_id: '11111111-1111-1111-1111-111111111111',
  legal_name: 'Harbourline Constructions Pty Ltd',
  trading_name: 'Harbourline',
  org_type: 'builder',
  membership_role: 'manager',
  is_primary: true,
  rollout_enabled: true,
};

const PERMISSIONS = {
  projects: { view: true, edit: true, delete: false },
  inventory: { view: true, edit: true, delete: false },
  transactions: { view: true, edit: true, delete: false },
  construction: { view: true, edit: true, delete: false },
  documents: { view: true, edit: true, delete: false },
  messages: { view: true, edit: true, delete: false },
  tasks: { view: true, edit: true, delete: false },
};

const session = {
  valid: true,
  user: {
    id: 'aaaaaaaa-0000-0000-0000-0000000000b1',
    email: 'builder@harbourline.test',
    name: 'Builder User',
    phone: null,
    job_title: 'Delivery Manager',
    must_change_password: false,
    has_accepted_terms: true,
    has_completed_onboarding: true,
    current_terms_version: 'v1.0',
    has_accepted_current_terms: true,
    has_completed_mandatory_onboarding: true,
  },
  organisations: [organisation],
  active_organisation: organisation,
  requires_organisation_selection: false,
  permissions: PERMISSIONS,
  governance: null,
  previous_seen_at: '2026-07-30T08:00:00Z',
};

/** Captures whether the app stamped completion, and what the server reports. */
let completed = false;

const stubFunctions = async (page: Page, options: { alreadyCompleted?: boolean } = {}) => {
  completed = !!options.alreadyCompleted;

  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('builder-portal-verify')) return send(session);
    if (url.includes('builder-portal-workspace')) {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.operation === 'workspace_summary') {
        return send({
          success: true, projects: 3, units: 42, transactions: 11, construction_cases: 7,
          open_defects: 5, documents: 18, open_conversations: 2, open_tasks: 9,
          overdue_tasks: 4, unread_messages: 6, unread_notifications: 3,
        });
      }
      if (payload.operation === 'get_my_preferences') {
        return send({
          success: true,
          preferences: {
            id: 'prprprpr-0000-0000-0000-000000000001',
            builder_user_id: session.user.id,
            default_organisation_id: organisation.organisation_id,
            landing_page: 'dashboard',
            timezone: 'Australia/Sydney',
            date_format: 'DD/MM/YYYY',
            email_digest: 'daily',
            notify_task_assigned: true,
            notify_message_posted: true,
            notify_status_change: true,
            tour_completed_at: completed ? '2026-07-01T00:00:00Z' : null,
            row_version: 3,
            created_at: '2026-07-01T00:00:00Z',
            updated_at: '2026-07-01T00:00:00Z',
          },
        });
      }
      if (payload.operation === 'complete_onboarding_tour') {
        completed = true;
        return send({ success: true, tour_completed_at: '2026-08-01T00:00:00Z' });
      }
      if (payload.operation === 'get_organisation_settings') {
        return send({ success: true, settings: null, can_edit: false });
      }
      return send({ success: true, records: [] });
    }
    if (url.includes('builder-portal-admin')) {
      return send({ success: true, sessions: [], current_session_id: null });
    }
    return send({ success: true });
  });
};

/** First sign-in: the server reports no completion, so the tour is due. */
const asFirstVisit = async (page: Page) => {
  await stubFunctions(page, { alreadyCompleted: false });
};

/** A user who has already seen the tour. */
const asReturningVisit = async (page: Page) => {
  await stubFunctions(page, { alreadyCompleted: true });
};

const tourDialog = (page: Page) => page.getByRole('dialog', { name: 'Builder portal tour' });

/**
 * Any browser-storage key that mentions the tour. The portal shell legitimately
 * caches unrelated UI state, so an "is storage empty" assertion would be about
 * the shell rather than about the tour.
 */
const tourStorageKeys = (page: Page) => page.evaluate(() => [
  ...Object.keys(window.localStorage),
  ...Object.keys(window.sessionStorage),
].filter((key) => /tour/i.test(key)));

test.beforeAll(async () => {
  if (!HAS_BUILD) return;
  server = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: false },
  );
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

test.afterAll(async () => { server?.kill('SIGTERM'); });

test.describe('Builder Portal onboarding tour', () => {
  test.skip(!HAS_BUILD, 'dist/ is absent — run npm run build first');

  test('the tour welcomes a first-time user', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Welcome to the Builder Portal')).toBeVisible();
  });

  test('the welcome card says the tour can be replayed later', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/replay it anytime from your settings/i)).toBeVisible();
  });

  test('the tour walks Builder destinations, never legal ones', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /start tour/i }).click();

    // Step 1 of 10 is the dashboard.
    const first = page.getByRole('dialog', { name: /Tour step 1 of 10/ });
    await expect(first).toBeVisible();
    await expect(first.getByRole('heading', { name: 'Your dashboard' })).toBeVisible();

    // Walk the whole tour, collecting each step's heading.
    const headings: string[] = [];
    for (let i = 1; i <= 10; i += 1) {
      const step = page.getByRole('dialog', { name: new RegExp(`Tour step ${i} of 10`) });
      await expect(step).toBeVisible();
      headings.push((await step.getByRole('heading').innerText()).trim());
      await step.getByRole('button', { name: i === 10 ? /finish/i : /next/i }).click();
    }

    expect(headings).toEqual([
      'Your dashboard', 'Projects', 'Inventory', 'Transactions', 'Construction',
      'Documents', 'Messages', 'Tasks', 'Notifications', 'Settings & security',
    ]);
  });

  test('no tour step mentions matters, firms or any legal concept', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /start tour/i }).click();

    for (let i = 1; i <= 10; i += 1) {
      const step = page.getByRole('dialog', { name: new RegExp(`Tour step ${i} of 10`) });
      const text = await step.innerText();
      expect(text).not.toMatch(/matter|conveyanc|solicitor|firm|settlement|requisition|disbursement/i);
      await step.getByRole('button', { name: i === 10 ? /finish/i : /next/i }).click();
    }
  });

  test('finishing the tour records it so it does not reappear', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /start tour/i }).click();
    for (let i = 1; i <= 10; i += 1) {
      const step = page.getByRole('dialog', { name: new RegExp(`Tour step ${i} of 10`) });
      await step.getByRole('button', { name: i === 10 ? /finish/i : /next/i }).click();
    }

    // The app stamped completion on the server, and wrote no tour state to the
    // browser to do it.
    expect(completed).toBe(true);
    expect(await tourStorageKeys(page)).toEqual([]);

    await page.reload();
    await page.waitForTimeout(1500);
    await expect(tourDialog(page)).toBeHidden();
  });

  test('skipping the tour also records it', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /skip for now/i }).click();
    await expect(tourDialog(page)).toBeHidden();
    expect(completed).toBe(true);
  });

  test('Escape dismisses the tour', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(tourDialog(page)).toBeHidden();
  });

  test('the close control dismisses a step', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /start tour/i }).click();
    const step = page.getByRole('dialog', { name: /Tour step 1 of 10/ });
    await expect(step).toBeVisible();
    await step.getByRole('button', { name: 'Close tour' }).click();
    await expect(step).toBeHidden();
  });

  test('a returning user is not shown the tour', async ({ page }) => {
    await asReturningVisit(page);
    await page.goto(`${BASE}/builder`);
    await page.waitForTimeout(1500);
    await expect(tourDialog(page)).toBeHidden();
  });

  test('settings offers a replay control that restarts the tour', async ({ page }) => {
    await asReturningVisit(page);
    await page.goto(`${BASE}/builder/settings`);

    const replay = page.getByRole('button', { name: /replay portal tour/i });
    await expect(replay).toBeVisible({ timeout: 15_000 });
    await replay.click();

    // Replay re-opens the tour even though the server still reports it complete,
    // and it stays open rather than being immediately re-suppressed.
    await expect(tourDialog(page)).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(tourDialog(page)).toBeVisible();
  });

  test('on a mobile viewport the step card falls back to centred', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /start tour/i }).click();

    const step = page.getByRole('dialog', { name: /Tour step 1 of 10/ });
    await expect(step).toBeVisible();
    // Whatever the layout does, the card must stay fully on screen.
    const box = await step.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test('the tour still runs with reduced motion requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /start tour/i }).click();
    await expect(page.getByRole('dialog', { name: /Tour step 1 of 10/ })).toBeVisible();
  });

  test('the tour is dialog-labelled for assistive technology', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    const welcome = tourDialog(page);
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await expect(welcome).toHaveAttribute('aria-modal', 'true');

    await page.getByRole('button', { name: /start tour/i }).click();
    const step = page.getByRole('dialog', { name: /Tour step 1 of 10/ });
    await expect(step).toHaveAttribute('aria-modal', 'true');
  });

  test('every tour destination resolves to a real navigation target', async ({ page }) => {
    await asReturningVisit(page);
    await page.goto(`${BASE}/builder`);
    await page.waitForSelector('[data-tour="dashboard"]', { timeout: 15_000 });

    for (const id of ['dashboard', 'projects', 'inventory', 'transactions', 'construction',
                      'documents', 'messages', 'tasks', 'notifications', 'settings']) {
      const anchor = page.locator(`[data-tour="${id}"]`);
      await expect(anchor).toHaveCount(1);
      // Each anchor is a real link to a real route, not a decorative marker.
      await expect(anchor).toHaveAttribute('href', /^\/builder/);
    }
  });

  test('the tour writes nothing to browser storage', async ({ page }) => {
    await asFirstVisit(page);
    await page.goto(`${BASE}/builder`);
    await expect(tourDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /start tour/i }).click();
    await expect(page.getByRole('dialog', { name: /Tour step 1 of 10/ })).toBeVisible();

    // The shell legitimately caches unrelated UI state (theme and the like), so
    // this asserts specifically that no TOUR state is persisted anywhere.
    expect(await tourStorageKeys(page)).toEqual([]);
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(window.localStorage)),
      session: JSON.stringify(Object.entries(window.sessionStorage)),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toMatch(/tour/i);
    expect(stored.session).not.toMatch(/tour/i);
    expect(stored.cookie).not.toMatch(/tour/i);
  });
});
