import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — end-to-end inventory tests.
 *
 * Runs against the real built application in a real browser, served by
 * `vite preview`. Nothing is deployed, so every Supabase Edge Function call is
 * intercepted and answered locally. What is verified here is frontend
 * behaviour: that the Inventory surface is reachable, that it renders only what
 * the server returned, that a unit the server withholds is not reachable, that
 * no internal commercial figure is displayed, and that no unit data is persisted
 * in the browser.
 *
 * The authorization itself is verified against a live PostgreSQL database by
 * `scripts/builder-portal/local-db/verify-inventory.mjs` (136 assertions). A
 * browser test cannot prove an access rule — only that the client asks the
 * server and renders the answer.
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT_INVENTORY || 4322);
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
  inventory: { view: true, edit: true, delete: false },
  pricing: { view: true, edit: true, delete: false },
  reservations: { view: true, edit: true, delete: false },
};

/** A fully governed session, so the gate lets the portal render. */
const SESSION = {
  valid: true,
  user: {
    id: 'aaaaaaaa-0000-0000-0000-0000000000b1',
    email: 'builder@harbourline.test',
    name: 'Builder User',
    phone: null,
    job_title: 'Project Manager',
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

const VISIBLE_UNIT = {
  id: 'uuuuuuuu-0000-0000-0000-000000000001',
  project_id: PROJECT.id,
  stage_id: 'ssssssss-0000-0000-0000-000000000001',
  building_id: null,
  lot_id: null,
  unit_number: 'A-101',
  unit_type: 'townhouse',
  bedrooms: 3,
  bathrooms: 2,
  car_spaces: 1,
  internal_area_sqm: 142.5,
  external_area_sqm: 18,
  level_number: 1,
  aspect: 'NE',
  availability_status: 'available',
  release_status: 'released',
  released_at: '2026-03-01T00:00:00Z',
  estimated_completion_date: '2026-11-30',
  description: 'North-east facing townhouse with a courtyard.',
  row_version: 4,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  list_price: 895000,
  price_basis: 'fixed',
};

/**
 * Answer every Edge Function call locally so no request reaches production.
 * The inventory function is answered per-operation, exactly as the real one is.
 */
const stubFunctions = async (page: Page, options: { withUnits?: boolean } = {}) => {
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

    if (url.includes('builder-portal-inventory')) {
      const payload = JSON.parse(route.request().postData() || '{}');

      if (payload.operation === 'list_units') {
        const records = options.withUnits === false ? [] : [VISIBLE_UNIT];
        return send({
          success: true,
          records,
          pagination: { page: 1, page_size: 25, total: records.length, total_pages: 1 },
        });
      }

      if (payload.operation === 'inventory_stats') {
        return send({
          success: true,
          total: 1,
          by_availability: { available: 1 },
          by_release: { released: 1 },
          released: 1,
        });
      }

      if (payload.operation === 'get_unit') {
        // The server withholds anything not granted — it answers 404 without
        // revealing whether the unit exists.
        if (payload.unit_id !== VISIBLE_UNIT.id) {
          return send({ error: 'Unit not found' }, 404);
        }
        return send({
          success: true,
          unit: VISIBLE_UNIT,
          project: PROJECT,
          current_price: {
            id: 'pppppppp-0000-0000-0000-000000000001',
            unit_id: VISIBLE_UNIT.id,
            list_price: 895000,
            price_basis: 'fixed',
            effective_from: '2026-03-01T00:00:00Z',
            effective_to: null,
            is_current: true,
            reason: 'Initial release price',
            row_version: 1,
            created_at: '2026-03-01T00:00:00Z',
          },
          status_history: [{
            id: 'hhhhhhhh-0000-0000-0000-000000000001',
            status_kind: 'release',
            from_status: 'coming_soon',
            to_status: 'released',
            changed_by_type: 'builder_user',
            reason: 'Stage A released to market',
            created_at: '2026-03-01T00:00:00Z',
          }],
          holds: [],
          reservations: [{
            id: 'rrrrrrrr-0000-0000-0000-000000000001',
            unit_id: VISIBLE_UNIT.id,
            organisation_id: ORGANISATION.organisation_id,
            reservation_reference: 'RES-0001',
            purchaser_name: 'Jordan Vale',
            purchaser_email: 'jordan@example.test',
            purchaser_phone: null,
            reserved_by_builder_user_id: null,
            reservation_fee: 5000,
            reserved_at: '2026-03-05T00:00:00Z',
            expires_at: '2026-04-05T00:00:00Z',
            status: 'active',
            cancelled_reason: null,
            row_version: 1,
            created_at: '2026-03-05T00:00:00Z',
            updated_at: '2026-03-05T00:00:00Z',
          }],
          allocations: [],
          stage: {
            id: VISIBLE_UNIT.stage_id,
            project_id: PROJECT.id,
            name: 'Stage A',
            stage_number: 'A',
            description: null,
            status: 'under_construction',
            estimated_completion_date: '2026-11-30',
            actual_completion_date: null,
            row_version: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          building: null,
          lot: null,
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

test.describe('Builder Portal inventory', () => {
  test.skip(!HAS_BUILD, 'requires a production build — run `npm run build` first');

  test('Inventory is an enabled navigation item', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder`);
    const navigation = page.getByRole('navigation', { name: 'Builder portal' });
    await expect(navigation.getByRole('link', { name: 'Inventory' })).toBeVisible();
    // The portal is complete, so nothing is a disabled placeholder any more.
    await expect(navigation.getByRole('button')).toHaveCount(0);
  });

  test('the unit list renders what the server returned', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/inventory`);
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    await expect(page.getByRole('link', { name: /A-101/ })).toBeVisible();
    await expect(page.locator('#main-content').getByText('$895,000')).toBeVisible();
  });

  test('an empty server answer renders the empty state, not an error', async ({ page }) => {
    await stubFunctions(page, { withUnits: false });
    await page.goto(`${BASE}/builder/inventory`);
    await expect(page.getByText('No units to show')).toBeVisible();
    await expect(page.getByText(/confirm your inventory access/)).toBeVisible();
  });

  test('opening a granted unit shows its detail', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/inventory/${VISIBLE_UNIT.id}`);
    await expect(page.getByRole('heading', { name: 'Unit A-101' })).toBeVisible();
    const main = page.locator('#main-content');
    // Exact, because the page description also carries the project name
    // "Harbour Rise Stage A".
    await expect(main.getByText('Stage A', { exact: true })).toBeVisible();
    await expect(main.getByText('$895,000')).toBeVisible();
  });

  test('a unit the server withholds is not rendered', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/inventory/uuuuuuuu-0000-0000-0000-000000000099`);
    await expect(page.getByRole('link', { name: 'Back to inventory' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unit A-101' })).toHaveCount(0);
  });

  test('reservations and status history come from the server response', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/inventory/${VISIBLE_UNIT.id}`);
    await page.getByRole('tab', { name: 'Commercial' }).click();
    await expect(page.getByText('Jordan Vale')).toBeVisible();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText('Stage A released to market')).toBeVisible();
  });

  test('the availability control offers only server-allowed transitions', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/inventory/${VISIBLE_UNIT.id}`);
    await page.getByRole('combobox', { name: 'New status' }).click();
    // From 'available' the database allows on_hold, reserved and withdrawn only.
    for (const label of ['On hold', 'Reserved', 'Withdrawn']) {
      await expect(page.getByRole('option', { name: label })).toBeVisible();
    }
    for (const label of ['Contracted', 'Settled', 'Available']) {
      await expect(page.getByRole('option', { name: label })).toHaveCount(0);
    }
  });

  test('no unit data is persisted in the browser', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/inventory/${VISIBLE_UNIT.id}`);
    await expect(page.getByRole('heading', { name: 'Unit A-101' })).toBeVisible();
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(window.localStorage)),
      session: JSON.stringify(Object.entries(window.sessionStorage)),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toContain('A-101');
    expect(stored.session).not.toContain('A-101');
    expect(stored.local).not.toContain('Jordan Vale');
    expect(stored.cookie).not.toMatch(/builder_session/i);
  });

  test('the unit detail shows no cost, margin or Finance-owned data', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/inventory/${VISIBLE_UNIT.id}`);
    await expect(page.getByRole('heading', { name: 'Unit A-101' })).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['build cost', 'margin', 'supplier', 'contractor price',
      'invoice', 'progress payment', 'commission', 'borrowing capacity',
      'serviceability', 'aml']) {
      expect(body).not.toContain(forbidden);
    }
  });
});
