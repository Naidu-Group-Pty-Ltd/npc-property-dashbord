import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — end-to-end construction tests.
 *
 * Runs against the real built application in a real browser, served by
 * `vite preview`. Nothing is deployed, so every Supabase Edge Function call is
 * intercepted and answered locally. What is verified here is frontend
 * behaviour: that the Construction surface is reachable, that it renders only
 * what the server returned, that a case the server withholds is not reachable,
 * that photographs open through a server-issued link rather than a storage path,
 * that a date change demands a reason, and that no Finance or cost information
 * appears.
 *
 * The authorization itself is verified against a live PostgreSQL database by
 * `scripts/builder-portal/local-db/verify-construction.mjs` (110 assertions).
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT_CONSTRUCTION || 4324);
const BASE = `http://127.0.0.1:${PORT}`;
const HAS_BUILD = existsSync(join(ROOT, 'dist/index.html'));

let server: ChildProcess | undefined;

const ORGANISATION = {
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
  transactions: { view: true, edit: true, delete: false },
  construction: { view: true, edit: true, delete: true },
};

const SESSION = {
  valid: true,
  user: {
    id: 'aaaaaaaa-0000-0000-0000-0000000000b1',
    email: 'builder@harbourline.test',
    name: 'Builder User',
    phone: null,
    job_title: 'Construction Manager',
    must_change_password: false,
    has_accepted_terms: true,
    has_completed_onboarding: true,
    current_terms_version: 'v1.0',
    has_accepted_current_terms: true,
    has_completed_mandatory_onboarding: true,
  },
  organisations: [ORGANISATION],
  active_organisation: ORGANISATION,
  requires_organisation_selection: false,
  permissions: PERMISSIONS,
  governance: null,
  previous_seen_at: null,
};

const PROJECT = {
  id: 'cccccccc-0000-0000-0000-000000000001',
  name: 'Harbour Rise Stage A',
  project_reference: 'HR-A',
};

const VISIBLE_CASE = {
  id: 'nnnnnnnn-0000-0000-0000-000000000001',
  transaction_id: 'tttttttt-0000-0000-0000-000000000001',
  project_id: PROJECT.id,
  unit_id: 'uuuuuuuu-0000-0000-0000-000000000001',
  case_reference: 'BLD-2001',
  status: 'under_construction',
  site_supervisor_name: 'Dana Reyes',
  site_supervisor_email: 'dana@harbourline.test',
  site_supervisor_phone: null,
  site_start_date: '2026-04-01',
  estimated_completion_date: '2027-02-28',
  actual_completion_date: null,
  practical_completion_date: null,
  percent_complete: 45,
  shared_summary: 'Frame complete, lock-up next.',
  weather_delay_days: 6,
  variation_delay_days: 3,
  row_version: 5,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  builder_notes: 'Crane booked for the roof lift.',
};

const stubFunctions = async (
  page: Page, options: { withCases?: boolean } = {},
) => {
  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('builder-portal-verify')) return send(SESSION);

    if (url.includes('builder-portal-projects')) {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.operation === 'list_projects') {
        return send({
          success: true,
          records: [{ ...PROJECT, status: 'under_construction', risk_flag: false }],
          pagination: { page: 1, page_size: 100, total: 1, total_pages: 1 },
        });
      }
      return send({ success: true });
    }

    if (url.includes('builder-portal-construction')) {
      const payload = JSON.parse(route.request().postData() || '{}');

      if (payload.operation === 'list_cases') {
        const records = options.withCases === false ? [] : [VISIBLE_CASE];
        return send({
          success: true,
          records,
          pagination: { page: 1, page_size: 25, total: records.length, total_pages: 1 },
        });
      }

      if (payload.operation === 'construction_stats') {
        return send({
          success: true, total: 1, by_status: { under_construction: 1 },
          average_percent: 45, overdue: 0,
        });
      }

      if (payload.operation === 'photograph_url') {
        // The server issues a short-lived link; the storage path never reaches
        // the browser.
        return send({
          success: true,
          url: 'https://storage.test/signed/abc123?token=short-lived',
          expires_in: 300,
        });
      }

      if (payload.operation === 'get_case') {
        // The server withholds anything not granted — it answers 404 without
        // revealing whether the case exists.
        if (payload.construction_case_id !== VISIBLE_CASE.id) {
          return send({ error: 'Construction case not found' }, 404);
        }
        return send({
          success: true,
          construction_case: VISIBLE_CASE,
          project: PROJECT,
          unit: { id: VISIBLE_CASE.unit_id, unit_number: 'A-101', unit_type: 'townhouse' },
          stages: [{
            id: 'ssssssss-0000-0000-0000-000000000001',
            construction_case_id: VISIBLE_CASE.id,
            name: 'Frame', stage_key: 'frame', sequence_number: 2, status: 'complete',
            planned_start_date: '2026-05-01', planned_end_date: '2026-07-01',
            actual_start_date: '2026-05-03', actual_end_date: '2026-07-10',
            percent_complete: 100, notes: null, row_version: 3,
            created_at: '2026-04-01T00:00:00Z', updated_at: '2026-07-10T00:00:00Z',
          }],
          milestones: [{
            id: 'mmmmmmmm-0000-0000-0000-000000000001',
            construction_case_id: VISIBLE_CASE.id,
            construction_stage_id: 'ssssssss-0000-0000-0000-000000000001',
            name: 'Frame complete', milestone_key: 'frame', status: 'achieved',
            planned_date: '2026-07-01', achieved_date: '2026-07-10',
            is_customer_visible: true, notes: null, row_version: 2,
            created_at: '2026-04-01T00:00:00Z', updated_at: '2026-07-10T00:00:00Z',
          }],
          progress_updates: [{
            id: 'gggggggg-0000-0000-0000-000000000001',
            construction_case_id: VISIBLE_CASE.id,
            construction_stage_id: null,
            title: 'Frame signed off', body: 'Roof trusses arrive next week.',
            percent_complete: 45, update_date: '2026-07-12',
            is_customer_visible: true, created_by_type: 'builder_user',
            row_version: 1, created_at: '2026-07-12T00:00:00Z',
          }],
          photographs: [{
            id: 'hhhhhhhh-0000-0000-0000-00000000000f',
            construction_case_id: VISIBLE_CASE.id,
            progress_update_id: null,
            construction_stage_id: null,
            file_name: 'frame-north.jpg',
            content_type: 'image/jpeg',
            byte_size: 482133,
            caption: 'North elevation frame',
            taken_at: '2026-07-10T02:00:00Z',
            is_customer_visible: true,
            uploaded_by_type: 'builder_user',
            row_version: 1,
            created_at: '2026-07-10T02:05:00Z',
          }],
          status_history: [{
            id: 'yyyyyyyy-0000-0000-0000-000000000001',
            entity_kind: 'case',
            entity_id: VISIBLE_CASE.id,
            from_status: 'site_preparation',
            to_status: 'under_construction',
            changed_by_type: 'builder_user',
            reason: 'Slab poured and cured',
            created_at: '2026-05-01T00:00:00Z',
          }],
          date_history: [{
            id: 'zzzzzzzz-0000-0000-0000-000000000001',
            date_kind: 'estimated_completion',
            from_date: '2026-12-20',
            to_date: '2027-02-28',
            reason: 'Extended wet weather in June',
            changed_by_type: 'builder_user',
            created_at: '2026-07-01T00:00:00Z',
          }],
          permissions: PERMISSIONS,
        });
      }
      return send({ success: true });
    }
    return send({ success: true });
  });
};

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

test.describe('Builder Portal construction', () => {
  test.skip(!HAS_BUILD, 'requires a production build — run `npm run build` first');

  test('Construction is an enabled navigation item', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder`);
    const navigation = page.getByRole('navigation', { name: 'Builder portal' });
    await expect(navigation.getByRole('link', { name: 'Construction' })).toBeVisible();
    // The portal is complete, so nothing is a disabled placeholder any more.
    await expect(navigation.getByRole('button')).toHaveCount(0);
  });

  test('the construction list renders what the server returned', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction`);
    await expect(page.getByRole('heading', { name: 'Construction', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /BLD-2001/ })).toBeVisible();
    await expect(page.locator('#main-content').getByText('45%').first()).toBeVisible();
  });

  test('an empty server answer renders the empty state, not an error', async ({ page }) => {
    await stubFunctions(page, { withCases: false });
    await page.goto(`${BASE}/builder/construction`);
    await expect(page.getByText('No build programmes to show')).toBeVisible();
    await expect(page.getByText(/confirm your construction access/)).toBeVisible();
  });

  test('opening a granted construction case shows its detail', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${VISIBLE_CASE.id}`);
    await expect(page.getByRole('heading', { name: 'BLD-2001' })).toBeVisible();
    const main = page.locator('#main-content');
    await expect(main.getByText('9 days')).toBeVisible();
  });

  test('a construction case the server withholds is not rendered', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/nnnnnnnn-0000-0000-0000-000000000099`);
    await expect(page.getByRole('link', { name: 'Back to construction' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'BLD-2001' })).toHaveCount(0);
  });

  test('stages, milestones and progress come from the server response', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${VISIBLE_CASE.id}`);
    await page.getByRole('tab', { name: 'Stages' }).click();
    await expect(page.getByText('2. Frame')).toBeVisible();
    await page.getByRole('tab', { name: 'Milestones' }).click();
    await expect(page.getByText('Frame complete')).toBeVisible();
    await page.getByRole('tab', { name: 'Progress' }).click();
    await expect(page.getByText('Frame signed off')).toBeVisible();
  });

  test('the date history shows the previous estimate and the reason', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${VISIBLE_CASE.id}`);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText('Extended wet weather in June')).toBeVisible();
    await expect(page.getByText('Slab poured and cured')).toBeVisible();
  });

  test('the status control offers only server-allowed transitions', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${VISIBLE_CASE.id}`);
    await page.getByRole('combobox', { name: 'New status' }).click();
    // From 'under_construction' the database allows practical_completion,
    // on_hold and cancelled only.
    for (const label of ['Practical completion', 'On hold', 'Cancelled']) {
      await expect(page.getByRole('option', { name: label })).toBeVisible();
    }
    for (const label of ['Completed', 'Handover', 'Not started']) {
      await expect(page.getByRole('option', { name: label })).toHaveCount(0);
    }
  });

  test('a photograph opens through a server-issued link, not a storage path', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${VISIBLE_CASE.id}`);
    await page.getByRole('tab', { name: 'Photographs' }).click();
    await expect(page.getByText('frame-north.jpg')).toBeVisible();
    // Nothing is rendered until the server issues the link.
    await expect(page.getByRole('img', { name: 'North elevation frame' })).toHaveCount(0);
    await page.getByRole('button', { name: 'View' }).click();
    const image = page.getByRole('img', { name: 'North elevation frame' });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', /storage\.test\/signed/);
    // And the page never saw a raw storage path.
    const body = await page.locator('main').innerText();
    expect(body).not.toContain('builder/case');
  });

  test('no construction data is persisted in the browser', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${VISIBLE_CASE.id}`);
    await expect(page.getByRole('heading', { name: 'BLD-2001' })).toBeVisible();
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(window.localStorage)),
      session: JSON.stringify(Object.entries(window.sessionStorage)),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toContain('BLD-2001');
    expect(stored.session).not.toContain('BLD-2001');
    expect(stored.local).not.toContain('Dana Reyes');
    expect(stored.cookie).not.toMatch(/builder_session/i);
  });

  test('the construction detail shows no cost, payment or Finance data', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${VISIBLE_CASE.id}`);
    await expect(page.getByRole('heading', { name: 'BLD-2001' })).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['build cost', 'margin', 'supplier', 'contractor price',
      'invoice', 'progress payment', 'commission', 'claim amount',
      'borrowing capacity', 'serviceability', 'aml']) {
      expect(body).not.toContain(forbidden);
    }
  });
});
