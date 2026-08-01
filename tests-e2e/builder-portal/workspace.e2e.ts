import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — end-to-end workspace tests.
 *
 * Runs against the real built application in a real browser, served by
 * `vite preview`. Nothing is deployed, so every Supabase Edge Function call is
 * intercepted and answered locally. What is verified here is frontend
 * behaviour: that the dashboard renders the server's cross-module counts, that
 * the activity feed shows what changed without any forensic field, that
 * organisation settings are read-only for a member who is not an owner or
 * administrator, that both settings forms send the version they loaded, and
 * that nothing on any of these surfaces carries Finance, Client or AML data.
 *
 * The authorization itself is verified against a live PostgreSQL database by
 * `scripts/builder-portal/local-db/verify-workspace.mjs` (95 assertions).
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT_WORKSPACE || 4327);
const BASE = `http://127.0.0.1:${PORT}`;
const HAS_BUILD = existsSync(join(ROOT, 'dist/index.html'));

let server: ChildProcess | undefined;

const organisation = (role: string) => ({
  organisation_id: '11111111-1111-1111-1111-111111111111',
  legal_name: 'Harbourline Constructions Pty Ltd',
  trading_name: 'Harbourline',
  org_type: 'builder',
  membership_role: role,
  is_primary: true,
});

const PERMISSIONS = {
  projects: { view: true, edit: true, delete: false },
  inventory: { view: true, edit: true, delete: false },
  transactions: { view: true, edit: true, delete: false },
  construction: { view: true, edit: true, delete: false },
  documents: { view: true, edit: true, delete: false },
  messages: { view: true, edit: true, delete: false },
  tasks: { view: true, edit: true, delete: false },
};

const session = (role: string) => ({
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
  organisations: [organisation(role)],
  active_organisation: organisation(role),
  requires_organisation_selection: false,
  permissions: PERMISSIONS,
  governance: null,
  previous_seen_at: '2026-07-30T08:00:00Z',
});

const SUMMARY = {
  success: true,
  projects: 3, units: 42, transactions: 11, construction_cases: 7,
  open_defects: 5, documents: 18, open_conversations: 2,
  open_tasks: 9, overdue_tasks: 4,
  unread_messages: 6, unread_notifications: 3,
};

const ACTIVITY = [
  {
    id: 'acacacac-0000-0000-0000-000000000001',
    action: 'builder_defect_created',
    entity_type: 'defect',
    entity_id: 'dfdfdfdf-0000-0000-0000-000000000001',
    actor_type: 'builder_user',
    reason: 'Raised at the frame inspection',
    created_at: '2026-07-31T09:00:00Z',
  },
  {
    id: 'acacacac-0000-0000-0000-000000000002',
    action: 'builder_document_version_added',
    entity_type: 'document_version',
    entity_id: 'veveveve-0000-0000-0000-000000000002',
    actor_type: 'command_user',
    reason: null,
    created_at: '2026-07-30T14:00:00Z',
  },
];

const SETTINGS = {
  id: 'stststst-0000-0000-0000-000000000001',
  organisation_id: organisation('manager').organisation_id,
  display_name: 'Harbourline',
  primary_contact_name: 'Dana Reyes',
  primary_contact_email: 'site@harbourline.test',
  primary_contact_phone: '02 0000 0000',
  timezone: 'Australia/Brisbane',
  default_landing_page: 'construction',
  notify_on_defect: true,
  notify_on_inspection: true,
  notify_on_variation: false,
  notify_on_message: true,
  notify_on_task: true,
  row_version: 4,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-25T00:00:00Z',
};

const PREFERENCES = {
  id: 'prprprpr-0000-0000-0000-000000000001',
  builder_user_id: session('manager').user.id,
  default_organisation_id: organisation('manager').organisation_id,
  landing_page: 'tasks',
  timezone: 'Australia/Sydney',
  date_format: 'DD/MM/YYYY',
  email_digest: 'weekly',
  notify_task_assigned: true,
  notify_message_posted: false,
  notify_status_change: true,
  row_version: 6,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
};

/** Captures the last save so the version and identity contracts can be asserted. */
let lastSave: Record<string, unknown> | null = null;

const stubFunctions = async (
  page: Page,
  options: { role?: string; withRecords?: boolean; failSummary?: boolean } = {},
) => {
  const role = options.role ?? 'manager';
  const empty = options.withRecords === false;
  lastSave = null;

  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('builder-portal-verify')) return send(session(role));

    if (url.includes('builder-portal-workspace')) {
      const payload = JSON.parse(route.request().postData() || '{}');
      switch (payload.operation) {
        case 'workspace_summary':
          if (options.failSummary) return send({ error: 'Internal server error' }, 500);
          return send(empty
            ? {
              success: true, projects: 0, units: 0, transactions: 0, construction_cases: 0,
              open_defects: 0, documents: 0, open_conversations: 0, open_tasks: 0,
              overdue_tasks: 0, unread_messages: 0, unread_notifications: 0,
            }
            : SUMMARY);
        case 'activity_history':
          return send({ success: true, records: empty ? [] : ACTIVITY });
        case 'get_organisation_settings':
          return send({
            success: true,
            settings: SETTINGS,
            can_edit: ['owner', 'administrator'].includes(role),
          });
        case 'save_organisation_settings':
          lastSave = payload;
          return send({ success: true, record: SETTINGS });
        case 'get_my_preferences':
          return send({ success: true, preferences: PREFERENCES });
        case 'save_my_preferences':
          lastSave = payload;
          return send({ success: true, record: PREFERENCES });
        default:
          return send({ success: true });
      }
    }

    if (url.includes('builder-portal-sessions') || url.includes('builder-portal-admin')) {
      return send({ success: true, sessions: [], current_session_id: null });
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

test.describe('Builder Portal workspace', () => {
  test.skip(!HAS_BUILD, 'requires a production build — run `npm run build` first');

  test('the dashboard renders the cross-module summary the server returned', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder`);
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    const main = page.locator('main');
    for (const [label, value] of [
      ['Projects', '3'], ['Units', '42'], ['Transactions', '11'], ['Builds', '7'],
      ['Documents', '18'], ['Open tasks', '9'],
    ]) {
      const tile = main.getByRole('link', { name: new RegExp(`${label}\\s*${value}`) });
      await expect(tile.first()).toBeVisible();
    }
  });

  test('the dashboard says a zero is a permission answer, not a fact', async ({ page }) => {
    await stubFunctions(page, { withRecords: false });
    await page.goto(`${BASE}/builder`);
    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ').toLowerCase();
    expect(body).toContain('a zero means nothing you can see');
  });

  test('a failed summary shows the error state, not a page of zeroes', async ({ page }) => {
    await stubFunctions(page, { failSummary: true });
    await page.goto(`${BASE}/builder`);
    await expect(page.getByText('Your summary could not be loaded')).toBeVisible();
  });

  test('the dashboard surfaces what needs attention', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder`);
    const alert = page.getByRole('alert').first();
    await expect(alert).toContainText('5 open defects');
    await expect(alert).toContainText('4 overdue tasks');
    await expect(alert).toContainText('6 unread messages');
  });

  test('activity renders what changed, with the reason', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/activity`);
    await expect(page.getByText('Defect created')).toBeVisible();
    await expect(page.getByText('Raised at the frame inspection')).toBeVisible();
    await expect(page.getByText('Document version added')).toBeVisible();
  });

  test('activity carries no before/after state and no request metadata', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/activity`);
    await expect(page.getByText('Defect created')).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['previous_state', 'new_state', 'ip address', 'user agent',
      'user_agent', 'ip_address']) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('activity states that administrative changes are not shown', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/activity`);
    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ').toLowerCase();
    expect(body).toContain('memberships, permissions and sessions — are not shown here');
  });

  test('the activity filter offers no administrative record type', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/activity`);
    await page.getByLabel('Filter by record type').click();
    const options = await page.getByRole('option').allInnerTexts();
    const joined = options.join(' | ').toLowerCase();
    for (const forbidden of ['membership', 'permission', 'session', 'portal user',
      'organisation', 'project access']) {
      expect(joined).not.toContain(forbidden);
    }
    expect(joined).toContain('defect');
  });

  test('an empty activity answer renders the empty state, not an error', async ({ page }) => {
    await stubFunctions(page, { withRecords: false });
    await page.goto(`${BASE}/builder/activity`);
    await expect(page.getByText('Nothing to show')).toBeVisible();
  });

  test('a member sees organisation settings read-only, with the reason', async ({ page }) => {
    await stubFunctions(page, { role: 'member' });
    await page.goto(`${BASE}/builder/settings`);
    await expect(page.getByText(
      'Only an owner or administrator of this organisation can change these.')).toBeVisible();
    await expect(page.getByLabel('Display name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save organisation settings' })).toHaveCount(0);
  });

  test('an administrator can save organisation settings with the loaded version', async ({ page }) => {
    await stubFunctions(page, { role: 'administrator' });
    await page.goto(`${BASE}/builder/settings`);
    const displayName = page.getByLabel('Display name');
    await expect(displayName).toBeEnabled();
    await displayName.fill('Harbourline Constructions');
    await page.getByRole('button', { name: 'Save organisation settings' }).click();
    await expect.poll(() => lastSave?.operation).toBe('save_organisation_settings');
    expect(lastSave?.expected_version).toBe(SETTINGS.row_version);
    expect(lastSave?.display_name).toBe('Harbourline Constructions');
    // The organisation is the session's — the form never names one.
    expect(lastSave).not.toHaveProperty('organisation_id');
  });

  test('a user saves their own preferences without naming themselves', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/settings`);
    await expect(page.getByLabel('Open the portal on')).toBeVisible();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect.poll(() => lastSave?.operation).toBe('save_my_preferences');
    expect(lastSave?.expected_version).toBe(PREFERENCES.row_version);
    expect(lastSave).not.toHaveProperty('builder_user_id');
  });

  test('the preferences form loads what the server returned', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/settings`);
    await expect(page.getByLabel('Open the portal on')).toContainText('Tasks');
    await expect(page.getByLabel('Email digest')).toContainText('Weekly');
  });

  test('no workspace data is persisted in the browser', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/activity`);
    await expect(page.getByText('Raised at the frame inspection')).toBeVisible();
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(window.localStorage)),
      session: JSON.stringify(Object.entries(window.sessionStorage)),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toContain('Raised at the frame inspection');
    expect(stored.session).not.toContain('Raised at the frame inspection');
    expect(stored.cookie).not.toMatch(/builder_session/i);
  });

  test('no workspace surface shows Client, Finance, Solicitor or AML data', async ({ page }) => {
    await stubFunctions(page);
    for (const path of ['', '/activity', '/settings']) {
      await page.goto(`${BASE}/builder${path}`);
      await expect(page.getByRole('heading').first()).toBeVisible();
      const body = (await page.locator('main').innerText()).toLowerCase();
      for (const forbidden of ['commission', 'borrowing capacity', 'serviceability',
        'aml', 'trust account', 'settlement funds', 'legal matter', 'privileged',
        'invoice', 'progress payment']) {
        expect(body, `${path || '/builder'} surfaced ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
