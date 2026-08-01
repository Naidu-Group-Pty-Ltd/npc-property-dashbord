import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — end-to-end delivery tests.
 *
 * Runs against the real built application in a real browser, served by
 * `vite preview`. Nothing is deployed, so every Supabase Edge Function call is
 * intercepted and answered locally. What is verified here is frontend
 * behaviour: that the Delivery surface is reachable from the build programme,
 * that each aggregate renders what the server returned, that a case the server
 * withholds is not reachable, that transitions offered match the database
 * allow-list, and that no Finance payment, receipt or commission appears.
 *
 * The authorization itself is verified against a live PostgreSQL database by
 * `scripts/builder-portal/local-db/verify-delivery.mjs` (115 assertions).
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT_DELIVERY || 4325);
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
  construction: { view: true, edit: true, delete: false },
  variations: { view: true, edit: true, delete: false },
  progress_claims: { view: true, edit: true, delete: false },
  inspections: { view: true, edit: true, delete: false },
  defects: { view: true, edit: true, delete: false },
  handover: { view: true, edit: true, delete: false },
};

const SESSION = {
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
  organisations: [ORGANISATION],
  active_organisation: ORGANISATION,
  requires_organisation_selection: false,
  permissions: PERMISSIONS,
  governance: null,
  previous_seen_at: null,
};

const CASE_ID = 'nnnnnnnn-0000-0000-0000-000000000001';
const PROJECT = { id: 'cccccccc-0000-0000-0000-000000000001', name: 'Harbour Rise Stage A', project_reference: 'HR-A' };

const CONSTRUCTION_CASE = {
  id: CASE_ID,
  transaction_id: 'tttttttt-0000-0000-0000-000000000001',
  project_id: PROJECT.id,
  unit_id: null,
  case_reference: 'BLD-2001',
  status: 'under_construction',
  site_supervisor_name: 'Dana Reyes',
  site_supervisor_email: null,
  site_supervisor_phone: null,
  site_start_date: '2026-04-01',
  estimated_completion_date: '2027-02-28',
  actual_completion_date: null,
  practical_completion_date: null,
  percent_complete: 45,
  shared_summary: null,
  weather_delay_days: 6,
  variation_delay_days: 3,
  row_version: 5,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  builder_notes: null,
};

const VARIATION = {
  id: 'vvvvvvvv-0000-0000-0000-000000000001',
  construction_case_id: CASE_ID,
  variation_number: 'V-1',
  title: 'Upgrade kitchen benchtop',
  description: null,
  origin: 'purchaser',
  status: 'submitted',
  variation_price: 4800,
  time_impact_days: 5,
  submitted_at: '2026-07-01T00:00:00Z',
  decided_at: null,
  row_version: 2,
  created_at: '2026-06-30T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const CLAIM = {
  id: 'pcpcpcpc-0000-0000-0000-000000000001',
  construction_case_id: CASE_ID,
  milestone_id: null,
  claim_number: 'PC-3',
  claimed_amount: 85000,
  status: 'submitted',
  claimed_at: '2026-07-15T00:00:00Z',
  certified_at: null,
  certified_amount: null,
  dispute_reason: null,
  notes: null,
  finance_payment_id: null,
  row_version: 2,
  created_at: '2026-07-15T00:00:00Z',
  updated_at: '2026-07-15T00:00:00Z',
};

const INSPECTION = {
  id: 'iiiiiiii-0000-0000-0000-000000000001',
  construction_case_id: CASE_ID,
  construction_stage_id: null,
  inspection_type: 'frame',
  title: 'Frame inspection',
  status: 'scheduled',
  inspector_name: 'Sam Okoro',
  inspector_organisation: 'Certify Co',
  scheduled_for: '2026-08-20T01:00:00Z',
  performed_at: null,
  outcome_notes: null,
  defect_count: 1,
  is_customer_visible: true,
  row_version: 1,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const DEFECT = {
  id: 'dfdfdfdf-0000-0000-0000-000000000001',
  construction_case_id: CASE_ID,
  inspection_id: INSPECTION.id,
  defect_number: 'D-1',
  title: 'Scratched window frame',
  description: null,
  location: 'Bedroom 2',
  severity: 'minor',
  status: 'open',
  raised_by_type: 'inspector',
  raised_at: '2026-08-02T00:00:00Z',
  due_date: '2026-09-01',
  rectified_at: null,
  verified_at: null,
  is_customer_visible: true,
  row_version: 1,
  created_at: '2026-08-02T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
};

const stubFunctions = async (page: Page, options: { withRecords?: boolean } = {}) => {
  const empty = options.withRecords === false;
  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('builder-portal-verify')) return send(SESSION);

    if (url.includes('builder-portal-construction')) {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.operation === 'get_case') {
        if (payload.construction_case_id !== CASE_ID) {
          return send({ error: 'Construction case not found' }, 404);
        }
        return send({
          success: true,
          construction_case: CONSTRUCTION_CASE,
          project: PROJECT,
          unit: null,
          stages: [], milestones: [], progress_updates: [], photographs: [],
          status_history: [], date_history: [],
          permissions: PERMISSIONS,
        });
      }
      return send({ success: true });
    }

    if (url.includes('builder-portal-delivery')) {
      const payload = JSON.parse(route.request().postData() || '{}');
      switch (payload.operation) {
        case 'list_variations':
          return send({ success: true, records: empty ? [] : [VARIATION] });
        case 'list_claims':
          return send({ success: true, records: empty ? [] : [CLAIM] });
        case 'list_inspections':
          return send({ success: true, records: empty ? [] : [INSPECTION] });
        case 'list_defects':
          return send({ success: true, records: empty ? [] : [DEFECT] });
        case 'get_completion':
          return send({
            success: true,
            practical_completion: empty ? null : {
              id: 'pcpc0000-0000-0000-0000-000000000001',
              construction_case_id: CASE_ID, status: 'notified',
              notified_at: '2026-08-10T00:00:00Z', inspected_at: null, achieved_at: null,
              certificate_reference: 'PC-CERT-1', outstanding_defect_count: 1,
              dispute_reason: null, notes: null, row_version: 2,
              created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z',
            },
            handover: null,
            warranty: null,
            warranty_claims: [],
          });
        case 'delivery_history':
          return send({
            success: true,
            records: empty ? [] : [{
              id: 'hhdd0000-0000-0000-0000-000000000001',
              entity_kind: 'variation', entity_id: VARIATION.id,
              from_status: 'draft', to_status: 'submitted',
              changed_by_type: 'builder_user', reason: 'Sent to the purchaser',
              created_at: '2026-07-01T00:00:00Z',
            }],
          });
        default:
          return send({ success: true });
      }
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

test.describe('Builder Portal delivery', () => {
  test.skip(!HAS_BUILD, 'requires a production build — run `npm run build` first');

  test('delivery is reachable from the build programme', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}`);
    await page.getByRole('link', { name: 'Delivery' }).click();
    await expect(page.getByRole('heading', { name: /Delivery · BLD-2001/ })).toBeVisible();
  });

  test('variations render what the server returned', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await expect(page.getByText('Upgrade kitchen benchtop')).toBeVisible();
    await expect(page.locator('#main-content').getByText('$4,800')).toBeVisible();
  });

  test('an empty server answer renders the empty state, not an error', async ({ page }) => {
    await stubFunctions(page, { withRecords: false });
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await expect(page.getByText('No variations recorded for this build')).toBeVisible();
  });

  test('a construction case the server withholds is not rendered', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/nnnnnnnn-0000-0000-0000-000000000099/delivery`);
    await expect(page.getByRole('link', { name: 'Back to construction' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /BLD-2001/ })).toHaveCount(0);
  });

  test('progress claims show what was claimed, never a payment', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await page.getByRole('tab', { name: 'Progress claims' }).click();
    await expect(page.getByText('PC-3')).toBeVisible();
    await expect(page.locator('#main-content').getByText('$85,000')).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['paid on', 'payment reference', 'remittance', 'commission amount']) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('inspections and defects render what the server returned', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await page.getByRole('tab', { name: 'Inspections' }).click();
    await expect(page.getByText('Frame inspection')).toBeVisible();
    await page.getByRole('tab', { name: 'Defects' }).click();
    await expect(page.getByText('Scratched window frame')).toBeVisible();
    await expect(page.getByText('Bedroom 2')).toBeVisible();
  });

  test('the defect actions offer only server-allowed transitions', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await page.getByRole('tab', { name: 'Defects' }).click();
    // From 'open' the database allows acknowledged, rejected and
    // in_rectification only.
    for (const label of ['Acknowledged', 'Rejected', 'In rectification']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
    for (const label of ['Verified', 'Closed', 'Rectified']) {
      await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    }
  });

  test('the variation actions offer only server-allowed transitions', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    // From 'submitted' the database allows approved, rejected, withdrawn and
    // superseded only.
    for (const label of ['Approved', 'Rejected', 'Withdrawn', 'Superseded']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Submitted' })).toHaveCount(0);
  });

  test('completion shows practical completion, handover and warranty', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await page.getByRole('tab', { name: 'Completion' }).click();
    await expect(page.getByRole('heading', { name: 'Practical completion' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Handover' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Warranty' })).toBeVisible();
    await expect(page.getByText('Status Notified')).toBeVisible();
  });

  test('the delivery history shows the reason for each change', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText('Sent to the purchaser')).toBeVisible();
  });

  test('no delivery data is persisted in the browser', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await expect(page.getByText('Upgrade kitchen benchtop')).toBeVisible();
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(window.localStorage)),
      session: JSON.stringify(Object.entries(window.sessionStorage)),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toContain('Upgrade kitchen benchtop');
    expect(stored.session).not.toContain('Upgrade kitchen benchtop');
    expect(stored.cookie).not.toMatch(/builder_session/i);
  });

  test('the delivery page shows no Finance, cost or commission data', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/construction/${CASE_ID}/delivery`);
    await expect(page.getByText('Upgrade kitchen benchtop')).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    // Labelled values, not prose: the page legitimately SAYS it holds no cost or
    // margin, and that sentence is part of the boundary being asserted.
    for (const forbidden of ['build cost:', 'margin:', 'supplier price', 'contractor price',
      'invoice', 'borrowing capacity', 'serviceability', 'aml']) {
      expect(body).not.toContain(forbidden);
    }
    // And the boundary is stated to the user, not merely honoured silently —
    // on the Variations tab, and again on the Progress claims tab.
    expect(body).toContain('no cost or margin');
    await page.getByRole('tab', { name: 'Progress claims' }).click();
    const claimsBody = (await page.locator('main').innerText()).toLowerCase();
    // The sentence wraps in the rendered card, so whitespace is normalised
    // before matching rather than guessing where the break falls.
    expect(claimsBody.replace(/\s+/g, ' ')).toContain('stay with finance');
  });
});
