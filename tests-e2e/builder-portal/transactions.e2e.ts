import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — end-to-end transaction tests.
 *
 * Runs against the real built application in a real browser, served by
 * `vite preview`. Nothing is deployed, so every Supabase Edge Function call is
 * intercepted and answered locally. What is verified here is frontend
 * behaviour: that the Transactions and Pipeline surfaces are reachable, that
 * they render only what the server returned, that a transaction the server
 * withholds is not reachable, that the pipeline uses the server's stage mapping
 * rather than deriving its own, that no Finance, Legal or client financial
 * information appears, and that nothing is persisted in the browser.
 *
 * The authorization itself is verified against a live PostgreSQL database by
 * `scripts/builder-portal/local-db/verify-transactions.mjs` (111 assertions). A
 * browser test cannot prove an access rule — only that the client asks the
 * server and renders the answer.
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT_TRANSACTIONS || 4323);
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
};

const PERMISSIONS = {
  projects: { view: true, edit: true, delete: false },
  transactions: { view: true, edit: true, delete: true },
};

const SESSION = {
  valid: true,
  user: {
    id: 'aaaaaaaa-0000-0000-0000-0000000000b1',
    email: 'builder@harbourline.test',
    name: 'Builder User',
    phone: null,
    job_title: 'Sales Manager',
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

const VISIBLE_TRANSACTION = {
  id: 'tttttttt-0000-0000-0000-000000000001',
  project_id: PROJECT.id,
  unit_id: 'uuuuuuuu-0000-0000-0000-000000000001',
  organisation_id: ORGANISATION.organisation_id,
  client_id: null,
  transaction_reference: 'TX-1001',
  transaction_type: 'off_the_plan',
  status: 'contract_issued',
  purchaser_name: 'Jordan Vale',
  purchaser_email: 'jordan@example.test',
  purchaser_phone: null,
  contract_price: 895000,
  deposit_amount: 44750,
  deposit_received: true,
  contract_issued_date: '2026-03-10',
  contract_signed_date: null,
  unconditional_date: null,
  sunset_date: '2027-06-30',
  estimated_settlement_date: '2027-01-31',
  actual_settlement_date: null,
  shared_summary: 'Contract issued and awaiting signature.',
  risk_flag: false,
  row_version: 3,
  opened_at: '2026-03-01T00:00:00Z',
  closed_at: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
  builder_notes: 'Purchaser requested a colour selection appointment.',
  risk_notes: null,
};

/** The stage mapping the server owns. The page must not derive its own. */
const PIPELINE_STAGES = [
  { status: 'lead', stage_key: 'enquiry', stage_label: 'Enquiry', stage_order: 1, is_terminal: false },
  { status: 'reserved', stage_key: 'reserved', stage_label: 'Reserved', stage_order: 2, is_terminal: false },
  { status: 'contract_issued', stage_key: 'contract', stage_label: 'Contract', stage_order: 3, is_terminal: false },
  { status: 'contract_signed', stage_key: 'contract', stage_label: 'Contract', stage_order: 3, is_terminal: false },
  { status: 'settled', stage_key: 'settled', stage_label: 'Settled', stage_order: 7, is_terminal: true },
];

const stubFunctions = async (
  page: Page, options: { withTransactions?: boolean; withCaseLink?: boolean } = {},
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

    if (url.includes('builder-portal-transactions')) {
      const payload = JSON.parse(route.request().postData() || '{}');

      if (payload.operation === 'list_transactions') {
        const records = options.withTransactions === false ? [] : [VISIBLE_TRANSACTION];
        return send({
          success: true,
          records,
          pagination: { page: 1, page_size: 25, total: records.length, total_pages: 1 },
        });
      }

      if (payload.operation === 'transaction_stats') {
        return send({
          success: true, total: 1, by_status: { contract_issued: 1 }, at_risk: 0, unlinked: 1,
        });
      }

      if (payload.operation === 'pipeline') {
        return send({
          success: true,
          stages: PIPELINE_STAGES,
          columns: [
            { stage_key: 'enquiry', stage_label: 'Enquiry', stage_order: 1, is_terminal: false, records: [] },
            { stage_key: 'reserved', stage_label: 'Reserved', stage_order: 2, is_terminal: false, records: [] },
            {
              stage_key: 'contract', stage_label: 'Contract', stage_order: 3, is_terminal: false,
              records: [VISIBLE_TRANSACTION],
            },
            { stage_key: 'settled', stage_label: 'Settled', stage_order: 7, is_terminal: true, records: [] },
          ],
        });
      }

      if (payload.operation === 'get_transaction') {
        // The server withholds anything not granted — it answers 404 without
        // revealing whether the transaction exists.
        if (payload.transaction_id !== VISIBLE_TRANSACTION.id) {
          return send({ error: 'Transaction not found' }, 404);
        }
        return send({
          success: true,
          // A linked case implies a client — the database refuses to link a
          // transaction that has none, so the fixture must agree.
          transaction: options.withCaseLink
            ? { ...VISIBLE_TRANSACTION, client_id: 'dddddddd-0000-0000-0000-00000000000a' }
            : VISIBLE_TRANSACTION,
          project: PROJECT,
          unit: {
            id: VISIBLE_TRANSACTION.unit_id, unit_number: 'A-101',
            unit_type: 'townhouse', availability_status: 'contracted',
          },
          parties: [{
            id: 'pppppppp-0000-0000-0000-000000000001',
            transaction_id: VISIBLE_TRANSACTION.id,
            role: 'purchaser_solicitor',
            name: 'Alex Moreau',
            organisation: 'Moreau Legal',
            email: 'alex@moreau.test',
            phone: null,
            reference: null,
            is_primary_contact: false,
            notes: null,
            row_version: 1,
            created_at: '2026-03-02T00:00:00Z',
            updated_at: '2026-03-02T00:00:00Z',
          }],
          status_history: [{
            id: 'hhhhhhhh-0000-0000-0000-000000000001',
            from_status: 'reserved',
            to_status: 'contract_issued',
            changed_by_type: 'builder_user',
            reason: 'Contract sent to the purchaser',
            created_at: '2026-03-10T00:00:00Z',
          }],
          case_link: options.withCaseLink
            ? {
                id: 'llllllll-0000-0000-0000-000000000001',
                case_id: 'eeeeeeee-0000-0000-0000-000000000001',
                builder_transaction_id: VISIBLE_TRANSACTION.id,
                link_source: 'builder_portal',
                linked_at: '2026-03-11T00:00:00Z',
              }
            : null,
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

test.describe('Builder Portal transactions', () => {
  test.skip(!HAS_BUILD, 'requires a production build — run `npm run build` first');

  test('Transactions and Pipeline are enabled navigation items', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder`);
    const navigation = page.getByRole('navigation', { name: 'Builder portal' });
    await expect(navigation.getByRole('link', { name: 'Transactions' })).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Pipeline' })).toBeVisible();
    // The portal is complete, so nothing is a disabled placeholder any more.
    await expect(navigation.getByRole('button')).toHaveCount(0);
  });

  test('the transaction list renders what the server returned', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/transactions`);
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
    await expect(page.getByRole('link', { name: /TX-1001/ })).toBeVisible();
    await expect(page.locator('#main-content').getByText('$895,000')).toBeVisible();
  });

  test('an empty server answer renders the empty state, not an error', async ({ page }) => {
    await stubFunctions(page, { withTransactions: false });
    await page.goto(`${BASE}/builder/transactions`);
    await expect(page.getByText('No transactions to show')).toBeVisible();
    await expect(page.getByText(/confirm your transaction access/)).toBeVisible();
  });

  test('opening a granted transaction shows its detail', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/transactions/${VISIBLE_TRANSACTION.id}`);
    await expect(page.getByRole('heading', { name: 'TX-1001' })).toBeVisible();
    const main = page.locator('#main-content');
    await expect(main.getByText('Jordan Vale').first()).toBeVisible();
    await expect(main.getByText('$895,000')).toBeVisible();
  });

  test('a transaction the server withholds is not rendered', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/transactions/tttttttt-0000-0000-0000-000000000099`);
    await expect(page.getByRole('link', { name: 'Back to transactions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'TX-1001' })).toHaveCount(0);
  });

  test('parties and status history come from the server response', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/transactions/${VISIBLE_TRANSACTION.id}`);
    await page.getByRole('tab', { name: 'Parties' }).click();
    await expect(page.getByText('Alex Moreau')).toBeVisible();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText('Contract sent to the purchaser')).toBeVisible();
  });

  test('the status control offers only server-allowed transitions', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/transactions/${VISIBLE_TRANSACTION.id}`);
    await page.getByRole('combobox', { name: 'New status' }).click();
    // From 'contract_issued' the database allows contract_signed, reserved,
    // cancelled and lapsed only.
    for (const label of ['Contract signed', 'Reserved', 'Cancelled', 'Lapsed']) {
      await expect(page.getByRole('option', { name: label })).toBeVisible();
    }
    for (const label of ['Settled', 'Unconditional', 'Lead']) {
      await expect(page.getByRole('option', { name: label })).toHaveCount(0);
    }
  });

  test('a transaction with no client cannot join a case', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/transactions/${VISIBLE_TRANSACTION.id}`);
    await page.getByRole('tab', { name: 'Case' }).click();
    await expect(page.getByText(/no client yet, so it cannot join a case/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlink' })).toHaveCount(0);
  });

  test('a linked case shows the link without exposing the other domains', async ({ page }) => {
    await stubFunctions(page, { withCaseLink: true });
    await page.goto(`${BASE}/builder/transactions/${VISIBLE_TRANSACTION.id}`);
    await page.getByRole('tab', { name: 'Case' }).click();
    await expect(page.getByText('Linked to a shared case')).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['legal matter', 'purchase file', 'client deal', 'matter reference']) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('the pipeline uses the server stage mapping', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/pipeline`);
    await expect(page.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible();
    // Both contract_issued and contract_signed map to one Contract column, so
    // the column appears exactly once.
    await expect(page.getByRole('heading', { name: 'Contract', exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /TX-1001/ })).toBeVisible();
    await expect(page.getByText('Nothing at this stage').first()).toBeVisible();
  });

  test('no transaction data is persisted in the browser', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/transactions/${VISIBLE_TRANSACTION.id}`);
    await expect(page.getByRole('heading', { name: 'TX-1001' })).toBeVisible();
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(window.localStorage)),
      session: JSON.stringify(Object.entries(window.sessionStorage)),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toContain('TX-1001');
    expect(stored.session).not.toContain('TX-1001');
    expect(stored.local).not.toContain('Jordan Vale');
    expect(stored.cookie).not.toMatch(/builder_session/i);
  });

  test('the transaction detail shows no Finance, Legal or client financial data', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/transactions/${VISIBLE_TRANSACTION.id}`);
    await expect(page.getByRole('heading', { name: 'TX-1001' })).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['build cost', 'margin', 'supplier', 'contractor price',
      'invoice', 'progress payment', 'commission', 'borrowing capacity',
      'serviceability', 'aml', 'legal matter', 'purchase file']) {
      expect(body).not.toContain(forbidden);
    }
  });
});
