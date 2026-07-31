/**
 * Builder / Developer Portal — Phase 0 characterisation of the existing repository.
 *
 * Baseline: a2ec188faa806ff97cb272f7f5a8bcf56b984cb1
 *
 * These tests assert what IS true at the baseline, not what should become true.
 * Two purposes:
 *   1. Prove Phase 0 changed no production behaviour.
 *   2. Pin the Solicitor Portal structure that the Builder Portal reproduces, so
 *      a change to that reference is a visible, deliberate event.
 *
 * Several assertions here are expected to FAIL when a later phase implements the
 * Builder Portal. That is the point: the failure marks the moment the greenfield
 * assumption stops holding, and the test must be updated in that phase's PR.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const app = read('src/App.tsx');
const solicitorAuth = read('supabase/functions/_shared/solicitorPortalAuth.ts');
const solicitorSessions = read('supabase/functions/_shared/solicitorSessions.ts');
const solicitorSessionToken = read('supabase/functions/_shared/solicitorSessionToken.ts');
const solicitorClient = read('src/lib/solicitorPortal.ts');
const solicitorProtectedRoute = read('src/components/solicitor-portal/SolicitorPortalProtectedRoute.tsx');
const solicitorAdminFn = read('supabase/functions/solicitor-portal-admin/index.ts');
const fieldOwnership = read('supabase/functions/_shared/crossPortalFieldOwnership.ts');

const migrationsDir = join(root, 'supabase/migrations');
const migrationNames = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
const migrations = migrationNames.map((name) => readFileSync(join(migrationsDir, name), 'utf8')).join('\n');

const srcFiles = (function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
})(join(root, 'src')).filter((path) => /\.(ts|tsx)$/.test(path));

// ---------------------------------------------------------------------------
// A. The Builder domain is greenfield at this baseline
// ---------------------------------------------------------------------------

test('the /builder route tree is external, not an internal page (updated by Phase 2)', () => {
  // Phase 0 asserted no /builder route existed. Phase 2 adds the external
  // portal, so the assertion is inverted rather than deleted: the tree must now
  // exist AND must remain outside the internal Command Centre shell. The
  // original point of this test — the Builder Portal is not a dashboard page —
  // is what is still being enforced.
  assert.match(app, /path="\/builder\/\*"/, 'the external Builder route tree is missing');
  assert.match(app, /<BuilderPortalAuthProvider>/, 'the Builder auth provider is not mounted');

  const tree = app.slice(app.indexOf('<Route path="/builder/*"'));
  const body = tree.slice(0, tree.indexOf('{/* Internal Dashboard Routes */}'));
  assert.ok(body.length > 0, 'the Builder tree is no longer a sibling of the internal routes');
  assert.ok(!/<ProtectedRoute>/.test(body),
    'the Builder Portal must not be wrapped in the internal ProtectedRoute');
  assert.ok(!/<DashboardLayout/.test(body),
    'the Builder Portal must not be wrapped in the internal DashboardLayout');
});

test('builder_portal_admin is registered and guarded (updated by Phase 1)', () => {
  // Phase 0 asserted this key did not exist. Phase 1 introduced it, so the
  // assertion is inverted here rather than deleted: the key must now be
  // registered in migrations AND enforced at the route, never one without the
  // other. A route guard with no dashboard_modules row denies every
  // non-superadmin user silently (Phase 0 finding NOCOPY-03).
  assert.match(migrations, /INSERT INTO public\.dashboard_modules[\s\S]*?'builder_portal_admin'/);
  assert.match(app, /moduleKey="builder_portal_admin"/);
});

test('the Builder function family is exactly the identity surface (updated by Phase 2)', () => {
  // Phase 0 asserted no builder-portal function existed; Phase 1 allowed one.
  // Phase 2 adds the external authentication family. The list stays exhaustive
  // so a business-domain function cannot appear without this test failing —
  // that is the boundary Phase 0 was protecting.
  const functionDirs = readdirSync(join(root, 'supabase/functions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual(functionDirs.filter((name) => name.startsWith('builder-portal-')).sort(), [
    'builder-portal-accept-invite',
    'builder-portal-admin',
    'builder-portal-change-password',
    'builder-portal-forgot-password',
    'builder-portal-invite',
    'builder-portal-login',
    'builder-portal-logout',
    'builder-portal-reset-password',
    'builder-portal-verify',
  ]);
});

test('only Phase 1 identity tables exist; the Phase 2 domain is still greenfield', () => {
  // Phase 0 asserted the whole Builder domain was absent. Phase 1 adds identity
  // and access only, so the assertion is split: identity must now be present,
  // and the Phase 2 business domain must still be absent.
  const created = new Set(
    [...migrations.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
      .map((match) => match[1].toLowerCase()),
  );
  for (const table of [
    'builder_organisations', 'builder_portal_users', 'builder_organisation_memberships',
    'builder_portal_sessions', 'builder_permission_keys',
    'builder_role_default_permissions', 'builder_membership_permissions',
  ]) {
    assert.ok(created.has(table), `Phase 1 identity table ${table} is missing`);
  }
  for (const table of [
    'builder_developments', 'builder_projects', 'builder_project_stages',
    'builder_project_parties', 'property_units', 'property_reservations',
    'construction_cases', 'builder_transactions', 'builder_variations',
    'builder_progress_claims', 'builder_inspections', 'builder_defects',
    'builder_case_read_model',
  ]) {
    assert.ok(!created.has(table), `Phase 2 domain table ${table} exists before Phase 2`);
  }
});

test('the Finance-owned builder-named tables remain exactly two (updated by Phase 1)', () => {
  // The trap this guards: builder_invoices and build_progress_payments are
  // Finance-owned despite their names. Phase 1 adds its own builder_* tables, so
  // the set is enumerated explicitly and the Finance pair must stay unchanged.
  const created = new Set(
    [...migrations.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
      .map((match) => match[1].toLowerCase()),
  );
  const financeOwned = [...created].filter((name) => name.startsWith('build_') || name === 'builder_invoices').sort();
  assert.deepEqual(financeOwned, ['build_progress_payments', 'builder_invoices']);
});

test('the two builder-named tables are keyed on client_deals, not on any builder identity', () => {
  assert.match(migrations, /CREATE TABLE public\.build_progress_payments[\s\S]{0,200}deal_id uuid NOT NULL REFERENCES public\.client_deals\(id\)/);
  assert.match(migrations, /CREATE TABLE public\.builder_invoices[\s\S]{0,200}deal_id uuid NOT NULL REFERENCES public\.client_deals\(id\)/);
});

test('the two builder-named tables carry commission fields and permissive RLS', () => {
  // Recorded as security risk SEC-06: safe for internal-only tables, unsafe if a
  // Builder portal path ever reads them.
  assert.match(migrations, /is_commission_trigger boolean DEFAULT false/);
  assert.match(migrations, /commission_amount numeric/);
  assert.match(migrations, /Allow all access to builder_invoices for authenticated users/);
});

// ---------------------------------------------------------------------------
// B. Solicitor Portal separation — the structure Builder reproduces
// ---------------------------------------------------------------------------

test('the Solicitor Portal is a route sibling of the internal dashboard', () => {
  const solicitorAt = app.indexOf('path="/solicitor/*"');
  const internalAt = app.indexOf('<DashboardLayout />');
  assert.ok(solicitorAt > -1, 'the /solicitor/* route root is missing');
  assert.ok(internalAt > -1, 'the internal DashboardLayout route is missing');
  assert.ok(solicitorAt < internalAt, 'the Solicitor route is no longer declared outside the dashboard tree');
  // The Solicitor provider wraps the portal; it must not wrap the internal tree.
  assert.match(app, /path="\/solicitor\/\*"\s*element=\{\s*<SolicitorPortalAuthProvider>/);
});

test('the Solicitor Portal uses the three-tier provider/protected/layout nesting', () => {
  assert.match(app, /<SolicitorPortalAuthProvider>/);
  assert.match(app, /<Route element=\{<SolicitorPortalProtectedRoute \/>\}>/);
  assert.match(app, /<Route element=\{<SolicitorPortalLayout \/>\}>/);
});

test('Solicitor public auth routes sit outside the protected route', () => {
  const protectedAt = app.indexOf('<SolicitorPortalProtectedRoute />');
  for (const publicPath of ['path="login"', 'path="accept-invite"', 'path="forgot-password"']) {
    const at = app.indexOf(publicPath, app.indexOf('path="/solicitor/*"'));
    assert.ok(at > -1 && at < protectedAt, `${publicPath} is no longer a public Solicitor route`);
  }
});

test('the Solicitor browser client is cookie-only and holds no readable token', () => {
  assert.match(solicitorClient, /credentials: 'include'/);
  assert.ok(!solicitorClient.includes('localStorage'), 'the Solicitor client reads localStorage');
  assert.ok(!solicitorClient.includes('sessionStorage'), 'the Solicitor client reads sessionStorage');
  assert.ok(!solicitorClient.includes('x-solicitor-session-token'), 'the Solicitor client sends a raw token header');
  assert.ok(!solicitorClient.includes('solicitor_session_token'), 'the Solicitor client sends a raw token body field');
  assert.match(solicitorClient, /'X-Portal-Request': 'solicitor-portal'/);
});

test('the Solicitor session store persists only a hash, with absolute and idle expiry', () => {
  assert.match(solicitorSessions, /hashSessionToken\(token\)/);
  assert.match(solicitorSessions, /token_hash: tokenHash/);
  assert.match(solicitorSessions, /SOLICITOR_SESSION_ABSOLUTE_HOURS = 12/);
  assert.match(solicitorSessions, /SOLICITOR_SESSION_IDLE_MINUTES = 30/);
  assert.match(solicitorSessions, /revoked_at/);
  // The raw token is returned to the caller but never written to the session row.
  assert.ok(!/insert\(\{[\s\S]{0,400}\btoken:/.test(solicitorSessions), 'a raw token is persisted on the session row');
});

test('the Solicitor cookie is __Host-prefixed and origin is validated', () => {
  assert.match(solicitorSessionToken, /__Host-solicitor_session_token/);
  assert.match(solicitorSessionToken, /x-portal-request/);
  assert.match(solicitorSessionToken, /ALLOWED_ORIGINS/);
  assert.match(solicitorSessionToken, /return !!origin &&/, 'a missing Origin is no longer rejected');
});

test('one shared function resolves every Solicitor session and one gate enforces governance', () => {
  assert.match(solicitorAuth, /export async function resolveSolicitorSession/);
  assert.match(solicitorAuth, /export function solicitorGovernanceError/);
  for (const reason of ['password_rotation_required', 'terms_acceptance_required', 'onboarding_required']) {
    assert.ok(solicitorAuth.includes(reason), `governance reason ${reason} is missing`);
  }
});

test('the Solicitor browser route guard mirrors the server governance order', () => {
  const order = ['must_change_password', 'has_accepted_current_terms', 'has_completed_mandatory_onboarding']
    .map((flag) => solicitorProtectedRoute.indexOf(flag));
  assert.ok(order.every((index) => index > -1), 'a governance flag is missing from the route guard');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the route guard governance order changed');
});

// ---------------------------------------------------------------------------
// C. Command Centre administration pattern
// ---------------------------------------------------------------------------

test('the Solicitor admin page is an internal module behind ModuleGuard', () => {
  assert.match(app, /path="admin\/solicitor-portal" element=\{<ModuleGuard moduleKey="solicitor_portal_admin">/);
});

test('the Solicitor admin Edge Function enforces auth, module permission and CSRF', () => {
  assert.match(solicitorAdminFn, /const MODULE_KEY = 'solicitor_portal_admin'/);
  assert.match(solicitorAdminFn, /verifyAuth\(/);
  assert.match(solicitorAdminFn, /requireModulePermission/);
  assert.match(solicitorAdminFn, /enforceCsrf\(/);
});

test('no navigation surface links the external Solicitor Portal as an internal module', () => {
  for (const surface of [
    'src/components/layout/DashboardSidebar.tsx',
    'src/components/layout/MobileSidebar.tsx',
    'src/components/layout/GlobalCommandPalette.tsx',
  ]) {
    const source = read(surface);
    assert.ok(source.includes("'/admin/solicitor-portal'"), `${surface} lost the admin entry`);
    assert.ok(!/url: ['"]\/solicitor['"]/.test(source), `${surface} links the external portal as an internal module`);
  }
});

test('REPAIRED: solicitor_portal_admin is registered in dashboard_modules', () => {
  // Phase 0 recorded this as an open gap (NOCOPY-03 / MIG-10): the key was used
  // by ModuleGuard, three navigation surfaces and three Edge Functions, but no
  // migration created it. Production had the row; the migration corpus did not,
  // so a fresh environment would have denied every non-superadmin user.
  // Phase 1 repaired it with an idempotent insert. The test is inverted here,
  // in the PR that performed the repair, exactly as Phase 0 required.
  assert.match(migrations, /dashboard_modules[\s\S]{0,4000}?'solicitor_portal_admin'/);
  assert.match(migrations, /'finance_portal_admin'/, 'finance_portal_admin registration disappeared');
});

// ---------------------------------------------------------------------------
// D. Shared backbone the Builder Portal will reuse
// ---------------------------------------------------------------------------

test('the transaction case backbone exists with three domain link slots', () => {
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS public\.transaction_case_links/);
  assert.match(migrations, /legal_matter_id uuid UNIQUE REFERENCES public\.legal_matters\(id\)/);
  assert.match(migrations, /purchase_file_id uuid UNIQUE REFERENCES public\.purchase_files\(id\)/);
  assert.match(migrations, /client_deal_id uuid UNIQUE REFERENCES public\.client_deals\(id\)/);
  assert.ok(!migrations.includes('builder_transaction_id'), 'a Builder link slot already exists');
});

test('the cross-client link guard is enforced by a database trigger', () => {
  assert.match(migrations, /guard_transaction_case_links/);
  assert.match(migrations, /CROSS_CLIENT_CASE_LINK/);
  assert.match(migrations, /BEFORE INSERT OR UPDATE OF case_id,legal_matter_id,purchase_file_id,client_deal_id/);
});

test("transaction_cases already permits a 'construction' case type", () => {
  assert.match(migrations, /case_type text NOT NULL DEFAULT 'property_purchase' CHECK\(case_type IN \([^)]*'construction'/);
});

test('the shared services the Builder Portal reuses are present', () => {
  for (const table of [
    'transaction_cases', 'transaction_case_links', 'transaction_case_link_history',
    'transaction_case_reconciliation_issues', 'integration_outbox', 'integration_dead_letters',
    'integration_delivery_attempts', 'projection_checkpoints', 'case_milestones', 'case_tasks',
    'case_task_assignments', 'case_task_status_history', 'case_milestone_conflicts',
    'conversations', 'conversation_participants', 'messages', 'message_attachments',
    'message_receipts', 'notification_preferences', 'notification_deliveries',
    'document_records', 'document_versions', 'document_access_grants',
    'document_processing_jobs', 'document_download_audit', 'portal_terms_versions',
    'portal_terms_acceptances', 'portal_operational_events', 'portal_operational_alerts',
    'cross_portal_feature_definitions', 'cross_portal_firm_rollouts',
  ]) {
    assert.ok(
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`).test(migrations),
      `shared table ${table} is missing`,
    );
  }
});

test('shared concurrency and immutability controls are present', () => {
  assert.match(migrations, /update_case_task_status\(_task_id uuid,_expected_version bigint/);
  assert.match(migrations, /guard_immutable_document_version/);
  assert.match(migrations, /authorize_document_download/);
  assert.match(migrations, /enqueue_integration_event/);
  assert.match(migrations, /record_portal_operational_event/);
  assert.match(migrations, /resolve_cross_portal_feature_mode/);
});

test('the field-ownership module has four portal domains and no Builder rules', () => {
  assert.match(fieldOwnership, /export type PortalDomain = 'command_centre' \| 'client' \| 'finance' \| 'solicitor'/);
  assert.ok(!fieldOwnership.includes("'builder'"), 'a builder domain already exists in the ownership module');
  const ruleCount = (fieldOwnership.match(/\{ field:'/g) || []).length;
  assert.equal(ruleCount, 15, `expected 15 field-ownership rules at baseline, found ${ruleCount}`);
});

test('the four existing case read models exist and no Builder read model does', () => {
  for (const model of [
    'client_case_read_model', 'finance_case_read_model',
    'solicitor_case_read_model', 'command_case_health_read_model',
  ]) {
    assert.ok(migrations.includes(model), `read model ${model} is missing`);
  }
  assert.ok(!migrations.includes('builder_case_read_model'), 'a Builder read model already exists');
});

// ---------------------------------------------------------------------------
// E. Permanent invariants
// ---------------------------------------------------------------------------

test('no browser source reads a service-role credential', () => {
  for (const path of srcFiles) {
    assert.ok(
      !/(VITE_[A-Z0-9_]*SERVICE_ROLE|import\.meta\.env\.[A-Z0-9_]*SERVICE_ROLE|process\.env\.[A-Z0-9_]*SERVICE_ROLE)/i
        .test(readFileSync(path, 'utf8')),
      `browser source reads a service-role credential: ${path.slice(root.length)}`,
    );
  }
});

test('the deny-by-default forbidden-key mechanism the Builder Portal copies is intact', () => {
  assert.match(solicitorAuth, /SOLICITOR_FORBIDDEN_KEYS\.has\(key\)/);
  for (const key of ['borrowing_capacity', 'commissions', 'smr', 'aml_restricted']) {
    assert.ok(solicitorAuth.includes(`'${key}'`), `forbidden key ${key} is no longer centrally denied`);
  }
});

test('KNOWN DEFECT: Solicitor permissions default to allow and OR-merge', () => {
  // Finding NOCOPY-01. Characterised so the Builder Portal is demonstrably not
  // copying it. If this starts failing, the Solicitor defect has been fixed and
  // docs/builder-portal/01-solicitor-portal-assessment.md must be updated.
  assert.match(solicitorAuth, /const DEFAULT_ALLOW_KEYS = new Set<string>\(SOLICITOR_PERMISSION_KEYS\)/);
  assert.match(solicitorAuth, /view: !!\(b\?\.view \|\| c\?\.view\)/);
});

test('KNOWN DEFECT: a legacy raw-token carrier still resolves Solicitor sessions', () => {
  // Finding NOCOPY-02. The Builder Portal must never create this path.
  assert.match(solicitorSessionToken, /x-solicitor-session-token/);
  assert.match(solicitorSessionToken, /source: 'legacy_header'/);
  assert.match(solicitorAuth, /credential\.source !== 'cookie'/);
});
