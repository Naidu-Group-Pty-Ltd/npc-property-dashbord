import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';

/**
 * Builder / Developer Portal — end-to-end collaboration tests.
 *
 * Runs against the real built application in a real browser, served by
 * `vite preview`. Nothing is deployed, so every Supabase Edge Function call is
 * intercepted and answered locally. What is verified here is frontend
 * behaviour: that documents, messages, tasks and notifications are reachable
 * from the navigation, that each surface renders what the server returned, that
 * a scope the server withholds shows the permission-denied state rather than
 * data, that a task change carries the loaded version, and that no storage path
 * or Finance/Client/AML field appears anywhere.
 *
 * The authorization itself is verified against a live PostgreSQL database by
 * `scripts/builder-portal/local-db/verify-collaboration.mjs` (184 assertions).
 *
 * Skipped when `dist/` is absent. Build first with `npm run build`.
 */
const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.BUILDER_E2E_PORT_COLLAB || 4326);
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
  transactions: { view: true, edit: true, delete: false },
  construction: { view: true, edit: true, delete: false },
  documents: { view: true, edit: true, delete: false },
  messages: { view: true, edit: true, delete: false },
  tasks: { view: true, edit: true, delete: false },
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

const PROJECT_ID = 'cccccccc-0000-0000-0000-000000000001';
const WITHHELD_PROJECT_ID = 'cccccccc-0000-0000-0000-000000000099';
const DOCUMENT_ID = 'dodododo-0000-0000-0000-000000000001';
const CONVERSATION_ID = 'cvcvcvcv-0000-0000-0000-000000000001';
const TASK_ID = 'tktktktk-0000-0000-0000-000000000001';

const PROJECTS = [
  { id: PROJECT_ID, name: 'Harbour Rise Stage A', project_reference: 'HR-A', status: 'in_delivery' },
  { id: WITHHELD_PROJECT_ID, name: 'Restricted Project', project_reference: 'RP-1', status: 'planning' },
];

const DOCUMENT = {
  id: DOCUMENT_ID,
  scope_type: 'project',
  scope_id: PROJECT_ID,
  title: 'Frame certificate',
  description: 'Issued after the frame inspection',
  document_type: 'certificate',
  status: 'active',
  current_version_id: 'veveveve-0000-0000-0000-000000000002',
  is_customer_visible: false,
  row_version: 3,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
};

const VERSIONS = [
  {
    id: 'veveveve-0000-0000-0000-000000000002',
    document_id: DOCUMENT_ID,
    version_number: 2,
    file_name: 'frame-cert-v2.pdf',
    content_type: 'application/pdf',
    byte_size: 254_000,
    checksum: null,
    change_note: 'Reissued with the corrected lot number',
    uploaded_by_type: 'builder_user',
    uploaded_by_builder_user_id: SESSION.user.id,
    created_at: '2026-07-20T00:00:00Z',
  },
  {
    id: 'veveveve-0000-0000-0000-000000000001',
    document_id: DOCUMENT_ID,
    version_number: 1,
    file_name: 'frame-cert-v1.pdf',
    content_type: 'application/pdf',
    byte_size: 251_000,
    checksum: null,
    change_note: 'First issue',
    uploaded_by_type: 'builder_user',
    uploaded_by_builder_user_id: SESSION.user.id,
    created_at: '2026-07-01T00:00:00Z',
  },
];

const CONVERSATION = {
  id: CONVERSATION_ID,
  scope_type: 'project',
  scope_id: PROJECT_ID,
  subject: 'Frame stage queries',
  status: 'open',
  last_message_at: '2026-07-22T09:00:00Z',
  message_count: 2,
  row_version: 4,
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-22T09:00:00Z',
};

const MESSAGES = [
  {
    id: 'msmsmsms-0000-0000-0000-000000000001',
    conversation_id: CONVERSATION_ID,
    body: 'Frame inspection is booked for Tuesday.',
    author_type: 'builder_user',
    author_builder_user_id: SESSION.user.id,
    author_display_name: 'Builder User',
    created_at: '2026-07-20T10:00:00Z',
  },
  {
    id: 'msmsmsms-0000-0000-0000-000000000002',
    conversation_id: CONVERSATION_ID,
    body: 'Confirmed with the certifier.',
    author_type: 'builder_user',
    author_builder_user_id: 'aaaaaaaa-0000-0000-0000-0000000000c1',
    author_display_name: 'Colleague User',
    created_at: '2026-07-22T09:00:00Z',
  },
];

const TASK = {
  id: TASK_ID,
  scope_type: 'project',
  scope_id: PROJECT_ID,
  title: 'Book the frame inspection',
  description: 'Coordinate with the certifier',
  status: 'open',
  priority: 'high',
  due_date: '2026-01-05',
  completed_at: null,
  created_by_builder_user_id: SESSION.user.id,
  row_version: 2,
  created_at: '2025-12-01T00:00:00Z',
  updated_at: '2025-12-01T00:00:00Z',
};

const NOTIFICATIONS = [
  {
    id: 'nfnfnfnf-0000-0000-0000-000000000001',
    notification_type: 'task_assigned',
    title: 'You were assigned a task',
    body: 'Book the frame inspection',
    scope_type: 'project',
    scope_id: PROJECT_ID,
    entity_kind: 'task',
    entity_id: TASK_ID,
    read_at: null,
    created_at: '2026-07-22T10:00:00Z',
  },
  {
    id: 'nfnfnfnf-0000-0000-0000-000000000002',
    notification_type: 'general',
    title: 'Site meeting moved',
    body: 'Now Thursday',
    scope_type: null,
    scope_id: null,
    entity_kind: null,
    entity_id: null,
    read_at: '2026-07-21T10:00:00Z',
    created_at: '2026-07-21T09:00:00Z',
  },
];

/** Captures the last upsert_task body so the version contract can be asserted. */
let lastTaskWrite: Record<string, unknown> | null = null;

const stubFunctions = async (
  page: Page, options: { withRecords?: boolean; denyScope?: boolean } = {},
) => {
  const empty = options.withRecords === false;
  lastTaskWrite = null;

  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('builder-portal-verify')) return send(SESSION);

    if (url.includes('builder-portal-projects')) {
      return send({
        success: true, records: PROJECTS,
        pagination: { page: 1, page_size: 100, total: PROJECTS.length, total_pages: 1 },
      });
    }

    if (url.includes('builder-portal-collaboration')) {
      const payload = JSON.parse(route.request().postData() || '{}');

      // A scope the server withholds answers 403 exactly as the Edge Function
      // does when the resolver denies an edit-level request.
      const scopedOperations = new Set([
        'list_documents', 'list_conversations', 'list_tasks',
      ]);
      if (scopedOperations.has(payload.operation)
        && (options.denyScope || payload.scope_id === WITHHELD_PROJECT_ID)) {
        return send({ error: 'You do not have permission to change this' }, 403);
      }

      switch (payload.operation) {
        case 'list_documents':
          return send({ success: true, records: empty ? [] : [DOCUMENT] });
        case 'get_document':
          return send({
            success: true, document: DOCUMENT,
            versions: VERSIONS, grants: [], permissions: PERMISSIONS,
          });
        case 'document_url':
          return send({
            success: true, url: `${BASE}/signed/frame-cert.pdf`,
            file_name: 'frame-cert-v2.pdf', expires_in: 300,
          });
        case 'list_conversations':
          return send({ success: true, records: empty ? [] : [CONVERSATION] });
        case 'get_conversation':
          return send({
            success: true, conversation: CONVERSATION,
            participants: [], messages: MESSAGES, permissions: PERMISSIONS,
          });
        case 'list_tasks':
          return send({
            success: true,
            records: empty ? [] : [TASK],
            assignments: [],
          });
        case 'my_tasks':
          return send({ success: true, records: empty ? [] : [TASK] });
        case 'upsert_task':
          lastTaskWrite = payload;
          return send({ success: true, record: { ...TASK, status: payload.status } });
        case 'list_notifications':
          return send({ success: true, records: empty ? [] : NOTIFICATIONS });
        case 'mark_notifications_read':
          return send({ success: true, marked_read: 1 });
        case 'unread_counts':
          return send({
            success: true, unread_messages: 2, unread_notifications: 1, overdue_tasks: 1,
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

test.describe('Builder Portal collaboration', () => {
  test.skip(!HAS_BUILD, 'requires a production build — run `npm run build` first');

  test('every collaboration surface is reachable from the navigation', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder`);
    for (const [label, heading] of [
      ['Documents', 'Documents'], ['Messages', 'Messages'],
      ['Tasks', 'Tasks'], ['Notifications', 'Notifications'],
    ]) {
      await page.getByRole('link', { name: label, exact: true }).first().click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
  });

  test('no navigation item is rendered as unavailable', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder`);
    await expect(page.getByText('becomes available in a later phase')).toHaveCount(0);
    await expect(page.locator('nav button[aria-disabled="true"]')).toHaveCount(0);
  });

  test('documents render what the server returned, with their versions', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/documents?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await expect(page.getByText('Frame certificate')).toBeVisible();
    await expect(page.getByText('Issued after the frame inspection')).toBeVisible();
    await page.getByRole('button', { name: /Frame certificate/ }).click();
    await expect(page.getByText('frame-cert-v2.pdf')).toBeVisible();
    await expect(page.getByText('frame-cert-v1.pdf')).toBeVisible();
    await expect(page.getByText('Reissued with the corrected lot number')).toBeVisible();
  });

  test('a document surfaces no storage path anywhere in the page', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/documents?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await page.getByRole('button', { name: /Frame certificate/ }).click();
    await expect(page.getByText('frame-cert-v2.pdf')).toBeVisible();
    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['storage_path', 'documents/', 'supabase.co/storage', 'signed?token']) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('an empty server answer renders the empty state, not an error', async ({ page }) => {
    await stubFunctions(page, { withRecords: false });
    await page.goto(`${BASE}/builder/documents?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await expect(page.getByText('No documents on this record yet')).toBeVisible();
  });

  test('a scope the server withholds shows permission denied, never data', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(
      `${BASE}/builder/documents?project=${WITHHELD_PROJECT_ID}&scope=project&scopeId=${WITHHELD_PROJECT_ID}`);
    await expect(page.getByText('You do not have access to these documents')).toBeVisible();
    await expect(page.getByText('Frame certificate')).toHaveCount(0);
  });

  test('conversations render their messages in order', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/messages?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await page.getByRole('button', { name: /Frame stage queries/ }).click();
    await expect(page.getByText('Frame inspection is booked for Tuesday.')).toBeVisible();
    await expect(page.getByText('Confirmed with the certifier.')).toBeVisible();
    const body = await page.locator('main').innerText();
    expect(body.indexOf('Frame inspection is booked'))
      .toBeLessThan(body.indexOf('Confirmed with the certifier'));
  });

  test('a message offers no edit or delete control, because neither exists', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/messages?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await page.getByRole('button', { name: /Frame stage queries/ }).click();
    await expect(page.getByText('Confirmed with the certifier.')).toBeVisible();
    for (const label of ['Edit message', 'Delete message', 'Edit', 'Delete']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('a conversation with no selection renders the empty state', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/messages?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await expect(page.getByText('Nothing selected')).toBeVisible();
  });

  test('tasks show what is assigned to me and flag what is overdue', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/tasks?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await expect(page.getByText('Book the frame inspection')).toBeVisible();
    await expect(page.getByLabel('Overdue').first()).toBeVisible();
  });

  test('a task status change carries the version the page loaded', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/tasks?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await expect(page.getByText('Book the frame inspection')).toBeVisible();
    await page.getByLabel('Change status of Book the frame inspection').first().click();
    await page.getByRole('option', { name: 'In progress' }).click();
    await expect.poll(() => lastTaskWrite?.expected_version).toBe(TASK.row_version);
    expect(lastTaskWrite?.task_id).toBe(TASK_ID);
    expect(lastTaskWrite?.status).toBe('in_progress');
  });

  test('notifications render as pointers and can be marked read', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/notifications`);
    await expect(page.getByText('You were assigned a task')).toBeVisible();
    await expect(page.getByText('Site meeting moved')).toBeVisible();
    // Only the unread one offers the control.
    await expect(page.getByRole('button', { name: 'Mark read' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Mark read' }).click();
    await expect(page.getByRole('button', { name: 'Mark all read' })).toBeVisible();
  });

  test('no collaboration data is persisted in the browser', async ({ page }) => {
    await stubFunctions(page);
    await page.goto(`${BASE}/builder/messages?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`);
    await page.getByRole('button', { name: /Frame stage queries/ }).click();
    await expect(page.getByText('Confirmed with the certifier.')).toBeVisible();
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(window.localStorage)),
      session: JSON.stringify(Object.entries(window.sessionStorage)),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toContain('Confirmed with the certifier');
    expect(stored.session).not.toContain('Confirmed with the certifier');
    expect(stored.cookie).not.toMatch(/builder_session/i);
  });

  test('no collaboration page shows Client, Finance, Solicitor or AML data', async ({ page }) => {
    await stubFunctions(page);
    for (const path of ['documents', 'messages', 'tasks', 'notifications']) {
      const query = path === 'notifications'
        ? '' : `?project=${PROJECT_ID}&scope=project&scopeId=${PROJECT_ID}`;
      await page.goto(`${BASE}/builder/${path}${query}`);
      await expect(page.getByRole('heading', { name: /./ }).first()).toBeVisible();
      const body = (await page.locator('main').innerText()).toLowerCase();
      for (const forbidden of ['commission', 'borrowing capacity', 'serviceability',
        'aml', 'trust account', 'settlement funds', 'legal matter', 'privileged']) {
        expect(body, `${path} surfaced ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
