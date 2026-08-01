import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — Phase 3 end-to-end project tests.
 *
 * Runs against the real built application in a real browser, served by
 * `vite preview`. Phase 3 deploys nothing, so every Supabase Edge Function call
 * is intercepted and answered locally. What is verified here is frontend
 * behaviour: that the Projects surface is reachable, that it renders only what
 * the server returned, that a project the server withholds is not reachable, and
 * that no project data is persisted in the browser.
 *
 * The authorization itself is verified against a live PostgreSQL database by
 * `scripts/builder-portal/local-db/verify-phase-3.mjs` (76 assertions). A
 * browser test cannot prove an access rule — only that the client asks the
 * server and renders the answer.
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT_P3 || 4321);
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
  permissions: { projects: { view: true, edit: true, delete: false } },
  governance: null,
  previous_seen_at: null,
};

const VISIBLE_PROJECT = {
  id: 'cccccccc-0000-0000-0000-000000000001',
  development_id: null,
  developer_organisation_id: '22222222-2222-2222-2222-222222222222',
  builder_organisation_id: ORGANISATION.organisation_id,
  project_reference: 'HR-A',
  name: 'Harbour Rise Stage A',
  project_type: 'townhouse',
  status: 'under_construction',
  address_line: '12 Harbour Road',
  suburb: 'Newcastle',
  state: 'NSW',
  postcode: '2300',
  lot_number: null,
  plan_number: null,
  estimated_start_date: '2026-01-15',
  estimated_completion_date: '2026-11-30',
  actual_start_date: null,
  actual_completion_date: null,
  shared_summary: null,
  risk_flag: false,
  risk_notes: null,
  row_version: 3,
  opened_at: '2026-01-01T00:00:00Z',
  closed_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  developer_organisation_name: 'Northpoint',
  builder_organisation_name: 'Harbourline',
};

/**
 * Answer every Edge Function call locally so no request reaches production.
 * The projects function is answered per-operation, exactly as the real one is.
 */
const stubFunctions = async (page: Page, options: { withProjects?: boolean } = {}) => {
  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('builder-portal-verify')) return send(SESSION);

    if (url.includes('builder-portal-projects')) {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.operation === 'list_projects') {
        const records = options.withProjects === false ? [] : [VISIBLE_PROJECT];
        return send({
          success: true,
          records,
          pagination: { page: 1, page_size: 25, total: records.length, total_pages: 1 },
        });
      }
      if (payload.operation === 'get_project') {
        // The server withholds anything not granted — it answers 404 without
        // revealing whether the project exists.
        if (payload.project_id !== VISIBLE_PROJECT.id) {
          return send({ error: 'Project not found' }, 404);
        }
        return send({
          success: true,
          project: VISIBLE_PROJECT,
          developer_organisation: { id: '22222222-2222-2222-2222-222222222222', legal_name: 'Northpoint Developments Pty Ltd', trading_name: 'Northpoint', org_type: 'developer' },
          builder_organisation: { id: ORGANISATION.organisation_id, legal_name: ORGANISATION.legal_name, trading_name: 'Harbourline', org_type: 'builder' },
          development: null,
          parties: [{
            id: 'pppppppp-0000-0000-0000-000000000001',
            project_id: VISIBLE_PROJECT.id,
            role: 'site_supervisor', name: 'Dana Reyes', organisation: 'Harbourline',
            email: 'dana@harbourline.test', phone: null, address: null, reference: null,
            is_primary_contact: true, notes: null,
            created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
          }],
          status_history: [{
            id: 'hhhhhhhh-0000-0000-0000-000000000001',
            from_status: 'approved', to_status: 'under_construction',
            changed_by_type: 'builder_user', reason: 'Site established',
            created_at: '2026-02-01T00:00:00Z',
          }],
          permissions: { projects: { view: true, edit: true, delete: false } },
          access_role: 'team_member',
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

test.describe('Builder Portal projects', () => {
  test.skip(!HAS_BUILD, 'requires a production build — run `npm run build` first');

  test('Projects is an enabled navigation item', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder`);
    const navigation = page.getByRole('navigation', { name: 'Builder portal' });
    await expect(navigation.getByRole('link', { name: 'Projects' })).toBeVisible();
    // The portal is complete, so nothing is a disabled placeholder any more.
    await expect(navigation.getByRole('button')).toHaveCount(0);
  });

  test('the project list renders what the server returned', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/projects`);
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Harbour Rise Stage A/ })).toBeVisible();
    await expect(page.getByText('HR-A · 12 Harbour Road, Newcastle, NSW, 2300')).toBeVisible();
  });

  test('an empty server answer renders the empty state, not an error', async ({ page }) => {
    await stubFunctions(page, { withProjects: false });
    await page.goto(`${BASE}/builder/projects`);
    await expect(page.getByText('No projects to show')).toBeVisible();
    await expect(page.getByText(/confirm your project access/)).toBeVisible();
  });

  test('opening a granted project shows its detail', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/projects/${VISIBLE_PROJECT.id}`);
    await expect(page.getByRole('heading', { name: 'Harbour Rise Stage A' })).toBeVisible();
    // Scoped to the page body: the organisation name also appears in the portal
    // header chrome, which would make an unscoped match ambiguous.
    const main = page.locator('#main-content');
    await expect(main.getByText('Northpoint')).toBeVisible();
    await expect(main.getByText('Harbourline')).toBeVisible();
  });

  test('a project the server withholds is not rendered', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/projects/cccccccc-0000-0000-0000-000000000099`);
    // The failure surface is an alert with a way back — matched by role rather
    // than by a text fragment that spans several nodes.
    await expect(page.getByRole('link', { name: 'Back to projects' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Harbour Rise Stage A' })).toHaveCount(0);
  });

  test('parties and status history come from the server response', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/projects/${VISIBLE_PROJECT.id}`);
    await page.getByRole('tab', { name: 'Parties' }).click();
    await expect(page.getByText('Dana Reyes')).toBeVisible();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText('Site established')).toBeVisible();
  });

  test('no project data is persisted in the browser', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/projects/${VISIBLE_PROJECT.id}`);
    await expect(page.getByRole('heading', { name: 'Harbour Rise Stage A' })).toBeVisible();
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(window.localStorage)),
      session: JSON.stringify(Object.entries(window.sessionStorage)),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toContain('Harbour Rise');
    expect(stored.session).not.toContain('Harbour Rise');
    expect(stored.cookie).not.toMatch(/builder_session/i);
  });

  test('the project detail shows no financial or Finance-owned data', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/projects/${VISIBLE_PROJECT.id}`);
    await expect(page.getByRole('heading', { name: 'Harbour Rise Stage A' })).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['invoice', 'progress payment', 'commission',
      'borrowing capacity', 'serviceability', 'aml']) {
      expect(body).not.toContain(forbidden);
    }
  });
});
