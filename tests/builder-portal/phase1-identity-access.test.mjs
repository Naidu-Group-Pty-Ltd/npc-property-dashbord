/**
 * Builder / Developer Portal — Phase 1 contract tests.
 *
 * These are static contract assertions over the migrations, the Edge Function
 * and the frontend wiring. They run with no database and no network, so they
 * gate every CI run.
 *
 * The behavioural half of Phase 1 — deny-by-default resolution, explicit deny
 * priority, session hashing, revocation, expiry, terms ownership, rollout
 * compatibility, anonymous denial — is executed against a live PostgreSQL
 * database by scripts/builder-portal/local-db/verify-phase-1.mjs, which asserts
 * 102 conditions. These tests assert the shape that verification depends on, so
 * a change that would invalidate it fails here first.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const MIGRATIONS = {
  identity: '20260801000000_builder_portal_phase1_organisations_users.sql',
  permissions: '20260801000100_builder_portal_phase1_permissions.sql',
  sessions: '20260801000200_builder_portal_phase1_sessions.sql',
  terms: '20260801000300_portal_terms_multi_portal.sql',
  rollouts: '20260801000400_cross_portal_rollout_org_generalisation.sql',
  adminModule: '20260801000500_builder_portal_admin_module.sql',
  activityLog: '20260801000600_builder_portal_activity_log.sql',
};

const sql = Object.fromEntries(
  Object.entries(MIGRATIONS).map(([key, name]) => [key, read(join('supabase/migrations', name))]),
);
const allPhase1Sql = Object.values(sql).join('\n');
const adminFn = read('supabase/functions/builder-portal-admin/index.ts');

/**
 * Strip comments before asserting "this identifier appears nowhere".
 * Every one of these migrations explains in prose which Phase 0 defect it is
 * correcting, so an un-stripped search matches the explanation rather than the
 * code and reports a defect that does not exist.
 */
const stripSqlComments = (body) => body.replace(/--[^\n]*/g, '');
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const codeOnlySql = stripSqlComments(allPhase1Sql);
const app = read('src/App.tsx');
const adminPage = read('src/pages/admin/BuilderPortalAdmin.tsx');

// ---------------------------------------------------------------------------
// Migration hygiene
// ---------------------------------------------------------------------------

test('every Phase 1 migration exists and is timestamped after the baseline', () => {
  const existing = readdirSync(join(root, 'supabase/migrations'));
  for (const name of Object.values(MIGRATIONS)) {
    assert.ok(existing.includes(name), `missing migration ${name}`);
    const stamp = name.split('_')[0];
    assert.match(stamp, /^\d{14}$/, `${name} is not timestamped`);
    assert.ok(stamp > '20260731005818', `${name} predates the Phase 0 baseline`);
  }
});

test('no Phase 1 migration drops an existing table, column or policy', () => {
  // Destructive DML is judged at MIGRATION time. A scoped DELETE inside a
  // CREATE FUNCTION body is runtime behaviour of a guarded command, not
  // something the migration performs, so function bodies are excluded.
  const withoutFunctionBodies = (body) =>
    body.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g, '');

  for (const [key, body] of Object.entries(sql)) {
    const migrationTime = withoutFunctionBodies(body);
    assert.doesNotMatch(body, /DROP\s+TABLE(?!\s+IF\s+EXISTS\s+_)/i, `${key} drops a table`);
    assert.doesNotMatch(body, /DROP\s+COLUMN/i, `${key} drops a column`);
    assert.doesNotMatch(body, /TRUNCATE/i, `${key} truncates`);
    assert.doesNotMatch(migrationTime, /DELETE\s+FROM\s+public\./i,
      `${key} deletes production rows at migration time`);
  }
});

test('the only runtime DELETE is the scoped permission-override replacement', () => {
  // builder_admin_set_membership_permissions replaces one membership's
  // organisation-scoped overrides. It is scoped to that membership and runs in
  // the same transaction as its audit record, so a failure rolls it back.
  const deletes = [...allPhase1Sql.matchAll(/DELETE FROM public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(deletes, ['builder_membership_permissions']);
  assert.match(sql.activityLog,
    /DELETE FROM public\.builder_membership_permissions\s*\n\s*WHERE membership_id = _membership_id AND scope_type = 'organisation';/);
});

test('the only NOT NULL relaxed is the documented one-way portal terms change', () => {
  const relaxations = allPhase1Sql.match(/ALTER COLUMN \w+ DROP NOT NULL/gi) ?? [];
  assert.equal(relaxations.length, 5, 'unexpected number of NOT NULL relaxations');
  assert.match(sql.terms, /ALTER COLUMN solicitor_user_id DROP NOT NULL/);
  // The four rollout relaxations are firm_id, made optional so a Builder
  // organisation can own the row instead.
  assert.equal((sql.rollouts.match(/ALTER COLUMN firm_id DROP NOT NULL/g) ?? []).length, 4);
});

// ---------------------------------------------------------------------------
// Organisations, users and memberships
// ---------------------------------------------------------------------------

test('builder_organisations supports the four organisation types', () => {
  const constraint = sql.identity.match(/org_type text NOT NULL CHECK \(org_type IN\s*\(([^)]*)\)\)/s);
  assert.ok(constraint, 'org_type CHECK missing');
  const types = constraint[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  assert.deepEqual(types.sort(), ['builder', 'builder_developer', 'developer', 'sales_representative']);
});

test('builder_organisations carries audit metadata and concurrency protection', () => {
  for (const column of ['created_by', 'updated_by', 'row_version', 'created_at', 'updated_at']) {
    assert.ok(sql.identity.includes(column), `builder_organisations missing ${column}`);
  }
  assert.match(sql.identity, /row_version bigint NOT NULL DEFAULT 1/);
  assert.match(sql.identity, /trg_builder_organisations_touch/);
});

test('organisation status and the fast access flag cannot contradict each other', () => {
  assert.match(sql.identity, /builder_organisations_status_active_agree/);
  assert.match(sql.identity, /builder_portal_users_status_active_agree/);
});

test('ABN and ACN are validated and unique when present', () => {
  assert.match(sql.identity, /abn text CHECK \(abn IS NULL OR abn ~ '\^\[0-9\]\{11\}\$'\)/);
  assert.match(sql.identity, /acn text CHECK \(acn IS NULL OR acn ~ '\^\[0-9\]\{9\}\$'\)/);
  assert.match(sql.identity, /CREATE UNIQUE INDEX IF NOT EXISTS builder_organisations_abn_key[\s\S]*?WHERE abn IS NOT NULL/);
});

test('a portal user has no organisation column — membership is the only binding', () => {
  const usersBlock = sql.identity.slice(
    sql.identity.indexOf('CREATE TABLE IF NOT EXISTS public.builder_portal_users'),
    sql.identity.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS builder_portal_users_email_key'),
  );
  assert.ok(!/organisation_id/.test(usersBlock),
    'builder_portal_users carries an organisation column; membership must be the only binding');
});

test('membership roles are broad and stable, and are text with a CHECK not an enum', () => {
  const constraint = sql.identity.match(/membership_role text NOT NULL CHECK \(membership_role IN\s*\(([^)]*)\)\)/s);
  assert.ok(constraint, 'membership_role CHECK missing');
  const roles = constraint[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  assert.deepEqual(roles.sort(), ['administrator', 'manager', 'member', 'owner', 'read_only']);
  assert.doesNotMatch(allPhase1Sql, /CREATE TYPE public\.builder_\w*role/i,
    'a Postgres enum was created for builder roles (Phase 0 MIG-09)');
});

test('job titles are display-only text, not a role enum', () => {
  assert.match(sql.identity, /job_title text/);
  assert.match(sql.identity, /COMMENT ON COLUMN public\.builder_portal_users\.job_title/);
  // The eleven job titles from the Phase 0 assessment must not become database values.
  for (const title of ['development_manager', 'site_supervisor', 'contract_administrator',
    'defects_coordinator', 'customer_service_officer', 'construction_manager']) {
    assert.ok(!allPhase1Sql.includes(`'${title}'`),
      `job title ${title} became a database value; use membership_role plus permissions`);
  }
});

test('one live membership per user and organisation, and one primary per user', () => {
  assert.match(sql.identity, /CREATE UNIQUE INDEX IF NOT EXISTS builder_memberships_live_key[\s\S]*?WHERE revoked_at IS NULL/);
  assert.match(sql.identity, /CREATE UNIQUE INDEX IF NOT EXISTS builder_memberships_one_primary_key[\s\S]*?WHERE is_primary AND revoked_at IS NULL/);
});

// ---------------------------------------------------------------------------
// Permissions — deny by default
// ---------------------------------------------------------------------------

test('there is no default-allow key set anywhere (Phase 0 NOCOPY-01)', () => {
  assert.ok(!/DEFAULT_ALLOW/i.test(codeOnlySql), 'a default-allow key set exists in Phase 1 SQL');
  assert.ok(!/DEFAULT_ALLOW/i.test(stripJsComments(adminFn)), 'the admin function has a default-allow set');
  // The prose in the permissions migration must still name the defect it corrects.
  assert.match(sql.permissions, /NOCOPY-01/);
});

test('the resolver denies unknown and forbidden keys before anything else', () => {
  assert.match(sql.permissions, /IF v_forbidden IS NULL OR v_forbidden THEN\s*\n\s*RETURN false;/);
});

test('the resolver requires an active membership and defaults to false', () => {
  assert.match(sql.permissions, /IF v_membership_id IS NULL THEN\s*\n\s*RETURN false;/);
  assert.match(sql.permissions, /v_baseline := COALESCE\(v_baseline, false\);/);
  assert.match(sql.permissions, /v_baseline boolean := false;/);
});

test('an explicit deny overrides an allow', () => {
  assert.match(sql.permissions, /IF v_override = 'deny' THEN\s*\n\s*RETURN false;/);
});

test('read_only clamps edit and delete after resolution', () => {
  assert.match(sql.permissions, /IF v_role = 'read_only' AND _level <> 'view' THEN\s*\n\s*RETURN false;/);
});

test('membership resolution requires user, organisation and membership all active', () => {
  const fn = sql.permissions.slice(
    sql.permissions.indexOf('CREATE OR REPLACE FUNCTION public.builder_active_membership'),
    sql.permissions.indexOf('COMMENT ON FUNCTION public.builder_active_membership'),
  );
  for (const clause of [
    "m.status = 'active'", 'm.revoked_at IS NULL', 'm.valid_from <= now()',
    'u.is_active', 'u.revoked_at IS NULL', 'o.is_active',
  ]) {
    assert.ok(fn.includes(clause), `builder_active_membership is missing: ${clause}`);
  }
});

test('permission overrides are tri-state, never a boolean matrix', () => {
  for (const column of ['view_decision', 'edit_decision', 'delete_decision']) {
    assert.match(sql.permissions,
      new RegExp(`${column} +text NOT NULL DEFAULT 'inherit' CHECK \\(${column} +IN \\('inherit','allow','deny'\\)\\)`));
  }
});

test('the permission key catalogue is data, not an enum', () => {
  assert.match(sql.permissions, /CREATE TABLE IF NOT EXISTS public\.builder_permission_keys/);
  assert.doesNotMatch(sql.permissions, /CREATE TYPE .*permission/i);
});

test('every forbidden key from the Phase 0 boundary document is catalogued and denied', () => {
  for (const key of ['income', 'expenses', 'assets', 'liabilities', 'employment',
    'borrowing_capacity', 'serviceability', 'commissions', 'aml_restricted', 'smr',
    'mlro', 'legal_privileged', 'conflict_checks', 'finance_private',
    'command_private', 'solicitor_private']) {
    assert.match(sql.permissions, new RegExp(`\\('${key}',[^\\n]*true\\)`),
      `forbidden key ${key} is not catalogued as forbidden`);
  }
});

test('a forbidden key cannot be stored as a grant', () => {
  assert.match(sql.permissions, /BUILDER_FORBIDDEN_PERMISSION_KEY/);
  assert.match(sql.permissions, /trg_builder_role_defaults_guard/);
  assert.match(sql.permissions, /trg_builder_membership_permissions_guard/);
});

test('project-level scope is prepared but not usable in Phase 1', () => {
  assert.match(sql.permissions, /scope_type text NOT NULL DEFAULT 'organisation'\s*\n?\s*CHECK \(scope_type IN \('organisation','development','project','stage','unit'\)\)/);
  assert.match(sql.permissions, /BUILDER_SCOPE_NOT_AVAILABLE/);
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

test('only a SHA-256 hash is storable as a session token', () => {
  assert.match(sql.sessions, /token_hash text NOT NULL CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});

test('no plaintext session token column exists anywhere in Phase 1 (NOCOPY-02)', () => {
  for (const forbidden of ['session_token text', 'raw_token', 'token text']) {
    assert.ok(!allPhase1Sql.includes(forbidden),
      `Phase 1 created a plaintext token column: ${forbidden}`);
  }
});

test('no database API accepts or returns a raw token', () => {
  assert.match(sql.sessions, /BUILDER_SESSION_TOKEN_NOT_HASHED/);
  const resolve = sql.sessions.slice(
    sql.sessions.indexOf('CREATE OR REPLACE FUNCTION public.builder_resolve_session'),
    sql.sessions.indexOf('CREATE OR REPLACE FUNCTION public.builder_revoke_session'),
  );
  assert.match(resolve, /RETURNS TABLE \(session_id uuid, builder_user_id uuid, absolute_expires_at timestamptz\)/);
  assert.ok(!/RETURNS TABLE \([^)]*token/.test(resolve), 'the resolver returns a token column');
});

test('a session can only be issued to a user holding an active membership', () => {
  assert.match(sql.sessions, /BUILDER_SESSION_NOT_PERMITTED/);
  assert.match(sql.sessions, /EXISTS \(SELECT 1 FROM public\.builder_accessible_organisations\(u\.id\)\)/);
});

test('sessions support expiry, revocation and multiple concurrent devices', () => {
  assert.match(sql.sessions, /builder_portal_sessions_expiry_order CHECK \(idle_expires_at <= absolute_expires_at\)/);
  assert.match(sql.sessions, /revoked_at timestamptz/);
  assert.match(sql.sessions, /builder_portal_sessions_live_idx[\s\S]*?WHERE revoked_at IS NULL/);
  assert.match(sql.sessions, /CREATE OR REPLACE FUNCTION public\.builder_revoke_user_sessions/);
});

test('the revoke re-check closes the concurrent-revocation race', () => {
  assert.match(sql.sessions, /WHERE s\.id = v_row\.id AND s\.revoked_at IS NULL/);
});

test('password change and membership loss revoke sessions in the database', () => {
  assert.match(sql.sessions, /trg_builder_user_session_revocation/);
  assert.match(sql.sessions, /trg_builder_membership_session_revocation/);
  assert.match(sql.sessions, /'password_changed'/);
  assert.match(sql.sessions, /'membership_revoked'/);
});

test('builder sessions are separate from solicitor sessions', () => {
  assert.match(sql.sessions, /CREATE TABLE IF NOT EXISTS public\.builder_portal_sessions/);
  // Executable DDL only: `--` comments and COMMENT ON strings are documentation,
  // and the table comment deliberately states the separation from
  // solicitor_portal_sessions. What must not exist is a dependency.
  const sessionDdl = stripSqlComments(sql.sessions).replace(/COMMENT ON[\s\S]*?;/g, '');
  assert.ok(!/solicitor/i.test(sessionDdl),
    'Builder session DDL depends on the solicitor domain');
  assert.match(sql.sessions, /NOCOPY-02/, 'the migration no longer records which defect it corrects');
  assert.match(sql.sessions, /Separate from solicitor_portal_sessions/,
    'the table comment no longer documents the session separation');
});

// ---------------------------------------------------------------------------
// Portal terms
// ---------------------------------------------------------------------------

test('portal terms generalisation orders the NOT NULL drop last', () => {
  const indexOfUnique = sql.terms.indexOf('portal_terms_acceptances_builder_key');
  const indexOfDropNotNull = sql.terms.indexOf('ALTER COLUMN solicitor_user_id DROP NOT NULL');
  assert.ok(indexOfUnique > -1 && indexOfDropNotNull > -1);
  assert.ok(indexOfUnique < indexOfDropNotNull,
    'the replacement uniqueness must exist before the NOT NULL is dropped');
});

test('portal terms ownership is database-enforced with real foreign keys', () => {
  assert.match(sql.terms, /builder_user_id uuid\s*\n?\s*REFERENCES public\.builder_portal_users\(id\) ON DELETE CASCADE/);
  assert.match(sql.terms, /CHECK \(num_nonnulls\(solicitor_user_id, builder_user_id\) = 1\)/);
  assert.match(sql.terms, /portal_terms_acceptances_portal_owner_agree/);
  // A generic user_id column with no foreign key is exactly what ADR 021 rejects.
  assert.ok(!/ADD COLUMN IF NOT EXISTS user_id uuid/.test(sql.terms),
    'an unenforced generic user-id column was introduced');
});

test('one user cannot accept terms belonging to another portal', () => {
  assert.match(sql.terms, /PORTAL_TERMS_PORTAL_MISMATCH/);
  assert.match(sql.terms, /trg_guard_portal_terms_acceptance/);
});

test('uniqueness is preserved per portal user and terms version', () => {
  assert.match(sql.terms, /CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_acceptances_solicitor_key\s*\n\s*ON public\.portal_terms_acceptances\(terms_version_id, solicitor_user_id\)/);
  assert.match(sql.terms, /CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_acceptances_builder_key\s*\n\s*ON public\.portal_terms_acceptances\(terms_version_id, builder_user_id\)/);
});

test('portal terms migration has pre-migration and post-migration checks', () => {
  assert.match(sql.terms, /PRE-MIGRATION FAILURE/);
  assert.match(sql.terms, /POST-MIGRATION FAILURE/);
  assert.match(sql.terms, /_portal_terms_premigration_counts/);
});

// ---------------------------------------------------------------------------
// Rollout controls
// ---------------------------------------------------------------------------

test('the rollout plane is generalised, not duplicated', () => {
  assert.match(sql.rollouts, /builder_organisation_id uuid\s*\n?\s*REFERENCES public\.builder_organisations\(id\)/);
  for (const table of ['builder_rollouts', 'builder_feature_definitions', 'builder_cutover_approvals']) {
    assert.ok(!allPhase1Sql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`),
      `a Builder-only rollout table was created: ${table}`);
  }
});

test('rollout ownership is database-enforced and portal-discriminated', () => {
  assert.match(sql.rollouts, /_owner_agree/);
  assert.match(sql.rollouts, /CHECK \(portal IN \(''solicitor'',''builder''\)\)/);
  assert.match(sql.rollouts, /CROSS_PORTAL_FEATURE_PORTAL_MISMATCH/);
});

test('the solicitor compatibility adapter keeps its original signature', () => {
  assert.match(sql.rollouts,
    /CREATE OR REPLACE FUNCTION public\.resolve_cross_portal_feature_mode\(_firm_id uuid, _feature_key text\)/);
  const solicitorAuth = read('supabase/functions/_shared/solicitorPortalAuth.ts');
  assert.match(solicitorAuth, /resolve_cross_portal_feature_mode/,
    'the Solicitor caller no longer uses the adapter — verify compatibility');
});

test('rollback capability and reconciliation are preserved', () => {
  // The mode CHECK that permits 'rollback' is upstream; Phase 1 must not narrow it.
  assert.doesNotMatch(sql.rollouts, /DROP CONSTRAINT IF EXISTS cross_portal_firm_rollouts_mode_check/,
    'Phase 1 dropped the mode CHECK that carries rollback');
  assert.doesNotMatch(codeOnlySql, /CHECK \(mode IN \((?![^)]*rollback)/,
    'a mode CHECK was redefined without rollback');
  assert.match(sql.rollouts, /CREATE OR REPLACE VIEW public\.cross_portal_rollout_reconciliation/);
  assert.match(sql.rollouts, /portal_mismatch/);
  assert.match(sql.rollouts, /orphaned_owner/);
  assert.match(sql.rollouts, /PRE-MIGRATION FAILURE/);
  assert.match(sql.rollouts, /POST-MIGRATION FAILURE/);
});

// ---------------------------------------------------------------------------
// RLS
// ---------------------------------------------------------------------------

test('every Phase 1 builder table enables RLS', () => {
  const created = [...allPhase1Sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(builder_\w+)/g)]
    .map((match) => match[1]);
  assert.ok(created.length >= 7, `expected at least 7 builder tables, found ${created.length}`);
  for (const table of created) {
    assert.ok(allPhase1Sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
      `RLS not enabled on ${table}`);
  }
});

test('no Phase 1 policy uses an unrestricted USING (true)', () => {
  const policies = allPhase1Sql.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
  assert.ok(policies.length > 0, 'no policies found');
  for (const policy of policies) {
    assert.doesNotMatch(policy, /USING \(true\)/, `unrestricted USING (true) in: ${policy.slice(0, 80)}`);
    assert.match(policy, /TO service_role/, `policy is not service-role scoped: ${policy.slice(0, 80)}`);
  }
});

test('anon and authenticated are revoked from every builder table', () => {
  const created = [...allPhase1Sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(builder_\w+)/g)]
    .map((match) => match[1]);
  for (const table of created) {
    assert.ok(allPhase1Sql.includes(`REVOKE ALL ON public.${table} FROM anon, authenticated`),
      `anon/authenticated not revoked from ${table}`);
  }
});

test('resolver functions are not executable by anon or authenticated', () => {
  for (const fn of ['builder_active_membership', 'builder_accessible_organisations',
    'builder_resolve_permission', 'builder_issue_session', 'builder_resolve_session']) {
    assert.ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`).test(allPhase1Sql),
      `${fn} is not revoked from PUBLIC/anon/authenticated`);
  }
});

// ---------------------------------------------------------------------------
// Internal administration
// ---------------------------------------------------------------------------

test('builder_portal_admin is registered in dashboard_modules', () => {
  assert.match(sql.adminModule, /INSERT INTO public\.dashboard_modules[\s\S]*?'builder_portal_admin'/);
  assert.match(sql.adminModule, /'\/admin\/builder-portal'/);
  assert.match(sql.adminModule, /ON CONFLICT \(module_key\) DO NOTHING/);
});

test('the solicitor_portal_admin registration drift is repaired (NOCOPY-03)', () => {
  assert.match(sql.adminModule, /'solicitor_portal_admin'/);
  assert.match(sql.adminModule, /POST-MIGRATION FAILURE: portal administration module\(s\) not registered/);
});

test('the internal route is guarded by ModuleGuard', () => {
  assert.match(app, /path="admin\/builder-portal" element=\{<ModuleGuard moduleKey="builder_portal_admin">/);
});

test('the external portal is never wired as an internal dashboard module', () => {
  // Phase 2 adds the external /builder tree. What this test protects is the
  // separation, not the absence: the external portal must never appear in the
  // internal navigation surfaces as if it were a dashboard module.
  for (const surface of [
    'src/components/layout/DashboardSidebar.tsx',
    'src/components/layout/MobileSidebar.tsx',
    'src/components/layout/GlobalCommandPalette.tsx',
  ]) {
    const source = read(surface);
    assert.ok(source.includes("'/admin/builder-portal'"), `${surface} lacks the admin entry`);
    assert.ok(source.includes("moduleKey: 'builder_portal_admin'"), `${surface} entry is not module-gated`);
    assert.ok(!/url: ['"]\/builder['"]/.test(source),
      `${surface} links the external portal as an internal module`);
  }
});

// ---------------------------------------------------------------------------
// Admin Edge Function
// ---------------------------------------------------------------------------

test('the admin function enforces auth, module permission and CSRF', () => {
  assert.match(adminFn, /const MODULE_KEY = 'builder_portal_admin'/);
  assert.match(adminFn, /verifyAuth\(/);
  assert.match(adminFn, /requireModulePermission\(/);
  assert.match(adminFn, /enforceCsrf\(req\)/);
});

test('read operations need can_view and mutations need can_edit', () => {
  assert.match(adminFn, /return READ_OPERATIONS\.has\(operation\) \? 'can_view' : 'can_edit'/);
});

test('CSRF is enforced on every mutation', () => {
  assert.match(adminFn, /if \(!READ_OPERATIONS\.has\(operation\)\) \{\s*\n\s*const csrf = enforceCsrf\(req\)/);
});

test('the admin function never reads the Finance-owned builder-named tables', () => {
  for (const table of ['builder_invoices', 'build_progress_payments']) {
    assert.ok(!new RegExp(`from\\(['"]${table}['"]\\)`).test(adminFn),
      `the admin function queries the Finance-owned table ${table}`);
  }
});

test('the admin function strips forbidden permission keys server-side', () => {
  assert.match(adminFn, /\.eq\('is_forbidden', false\)/);
  assert.match(adminFn, /rejected_keys/);
});

test('mutable aggregates use expected_version and return 409 on a stale write', () => {
  assert.match(adminFn, /expected_version/);
  assert.match(adminFn, /code: 'stale_write'/);
  const conflictReturns = adminFn.match(/\}, 409, cors\)/g) ?? [];
  assert.ok(conflictReturns.length >= 6, `expected several 409 paths, found ${conflictReturns.length}`);
});

test('the admin function never selects * and never exposes a session token hash', () => {
  assert.ok(!/\.select\(['"]\*['"]\)/.test(adminFn), 'the admin function selects *');
  const sessionCase = stripJsComments(adminFn.slice(adminFn.indexOf("case 'list_user_sessions'"),
    adminFn.indexOf("case 'revoke_user_sessions'")));
  assert.ok(!sessionCase.includes('token_hash'), 'the session list selects token_hash');
  // The exclusion must remain a documented decision, not an accident.
  assert.match(adminFn, /token_hash is deliberately excluded/);
});

test('the admin function re-reads parents server-side rather than trusting request ids', () => {
  assert.match(adminFn, /const loadOrganisation = async/);
  assert.match(adminFn, /A browser-supplied id is a request, not an authority/);
});

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

test('the admin page routes every call through the guarded Edge Function', () => {
  assert.match(adminPage, /invokeSecureFunction\('builder-portal-admin'/);
  assert.ok(!/from\('builder_/.test(adminPage), 'the admin page queries builder tables directly');
});

test('the admin page respects edit permission rather than only hiding navigation', () => {
  assert.match(adminPage, /useModulePermissions\('builder_portal_admin'\)/);
  assert.match(adminPage, /disabled=\{!canEdit/);
});

test('the admin page uses semantic tokens only', () => {
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(adminPage), 'the admin page hardcodes a hex colour');
  assert.ok(!/\b(bg|text|border)-(red|blue|green|slate|zinc|gray|amber)-\d{2,3}\b/.test(adminPage),
    'the admin page uses a raw Tailwind palette class');
});

// ---------------------------------------------------------------------------
// Phase boundary — no Phase 2 business tables
// ---------------------------------------------------------------------------

test('no Phase 2 business table is introduced', () => {
  for (const table of [
    'builder_developments', 'builder_projects', 'builder_project_stages',
    'builder_project_parties', 'property_units', 'property_reservations',
    'construction_cases', 'builder_transactions', 'builder_variations',
    'builder_progress_claims', 'builder_inspections', 'builder_defects',
    'builder_case_read_model',
  ]) {
    assert.ok(!allPhase1Sql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`),
      `Phase 2 table ${table} was created in Phase 1`);
  }
});

test('transaction_case_links gains no builder slot in Phase 1', () => {
  assert.ok(!allPhase1Sql.includes('builder_transaction_id'),
    'the Phase 2 transaction-case link slot was added in Phase 1');
});

test('the external portal family stops at projects', () => {
  // Phase 1 allowed only the internal admin function; Phase 2 added the external
  // authentication family; Phase 3 adds the project module. Nothing beyond that
  // may appear before its phase.
  const functionDirs = readdirSync(join(root, 'supabase/functions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^builder-/.test(entry.name))
    .map((entry) => entry.name).sort();
  assert.deepEqual(functionDirs, [
    'builder-portal-accept-invite',
    'builder-portal-admin',
    'builder-portal-change-password',
    'builder-portal-forgot-password',
    'builder-portal-invite',
    'builder-portal-login',
    'builder-portal-logout',
    'builder-portal-projects',
    'builder-portal-reset-password',
    'builder-portal-verify',
    'builder-projects-admin',
  ], 'a Builder function outside identity, governance and projects appeared');
});


// ---------------------------------------------------------------------------
// Supabase types
// ---------------------------------------------------------------------------

test('the generated Supabase types cover every Phase 1 builder table', () => {
  const types = read('src/integrations/supabase/types.ts');
  assert.equal((types.match(/BEGIN builder-portal-phase-1/g) ?? []).length, 1,
    'the generated type block is missing or duplicated');
  for (const table of [
    'builder_organisations', 'builder_portal_users', 'builder_organisation_memberships',
    'builder_permission_keys', 'builder_role_default_permissions',
    'builder_membership_permissions', 'builder_portal_sessions',
  ]) {
    assert.ok(types.includes(`      ${table}: {`), `types.ts is missing ${table}`);
  }
  // Nullability must be faithful: a NOT NULL column must not be typed nullable.
  assert.match(types, /builder_portal_sessions: \{\s*\n\s*Row: \{[\s\S]*?token_hash: string\n/);
});

// ---------------------------------------------------------------------------
// Local verification harness
// ---------------------------------------------------------------------------

test('the local verification harness exists and covers the required conditions', () => {
  const verify = read('scripts/builder-portal/local-db/verify-phase-1.mjs');
  for (const condition of [
    'cross-organisation access is denied',
    'an unconfigured key is denied',
    'an explicit membership deny overrides a role-default allow',
    'read_only cannot edit even with an explicit allow',
    'a raw (non-hex) session token is not a storable value',
    'a revoked session no longer resolves',
    'an expired session no longer resolves',
    'a password change revokes every live session',
    'existing solicitor acceptance preserved with its owner',
    'existing rollout rows preserved and still solicitor-owned',
    'builder_portal_admin is registered',
    'anonymous SELECT on ${table} is denied',
    'no Phase 2 business table was introduced',
  ]) {
    assert.ok(verify.includes(condition), `local verification is missing: ${condition}`);
  }
});

test('the Phase 1 migration list in the harness matches the migrations on disk', () => {
  const verify = read('scripts/builder-portal/local-db/verify-phase-1.mjs');
  for (const name of Object.values(MIGRATIONS)) {
    assert.ok(verify.includes(name), `the harness does not apply ${name}`);
  }
});

test('the local harness files are present', () => {
  for (const path of [
    'scripts/builder-portal/local-db/00-supabase-bootstrap.sql',
    'scripts/builder-portal/local-db/01-upstream-fixture.sql',
    'scripts/builder-portal/local-db/reset.mjs',
    'scripts/builder-portal/local-db/verify-phase-1.mjs',
    'scripts/builder-portal/local-db/generate-builder-types.mjs',
  ]) {
    assert.ok(existsSync(join(root, path)), `missing harness file ${path}`);
  }
});

// ---------------------------------------------------------------------------
// Alignment-review corrections P1 – P4
//
// These four defects were found by comparing builder-portal-admin against the
// Solicitor Portal. Each is pinned here so a regression fails before review.
// ---------------------------------------------------------------------------

test('P1: csrfDenied is called with the repository-wide argument order', () => {
  // csrfDenied(corsHeaders, detail). Reversing them spread the CsrfCheckResult
  // into the response headers and dropped Access-Control-Allow-Origin.
  assert.match(adminFn, /csrfDenied\(cors, csrf\)/);
  assert.doesNotMatch(adminFn, /csrfDenied\(csrf, cors\)/);
});

test('P1: the Builder call matches every other csrfDenied call site in the repo', () => {
  const guard = read('supabase/functions/_shared/csrfGuard.ts');
  const signature = /export function csrfDenied\(\s*(\w+): Record<string, string>,\s*(\w+): CsrfCheckResult/.exec(guard);
  assert.ok(signature, 'csrfDenied signature changed — re-verify every call site');
  // First parameter is the CORS headers, second is the check result.
  assert.equal(signature[1], 'cors');
  assert.equal(signature[2], 'detail');
});

test('P2: the service_role identity never reaches a uuid column', () => {
  assert.match(adminFn, /const isServiceRoleActor = auth\.userId === 'service_role'/);
  assert.match(adminFn, /const adminUserId: string \| null = isServiceRoleActor \? null : auth\.userId/);
  // Nothing may write the raw auth.userId into a uuid-bearing field.
  const code = stripJsComments(adminFn);
  for (const column of ['created_by', 'updated_by', 'granted_by', 'invited_by', '_actor_user_id', '_actor_id']) {
    assert.ok(!new RegExp(`${column}:\\s*auth\\.userId`).test(code),
      `${column} is assigned the raw auth.userId, which may be the string service_role`);
    assert.ok(!new RegExp(`${column}:\\s*actorId`).test(code),
      `${column} still uses the pre-correction actorId binding`);
  }
});

test('P2: the permission check still uses the authenticated identity', () => {
  // adminUserId is uuid-safe but null for service-role callers; authorization
  // must keep using auth.userId or an internal call would be denied.
  assert.match(adminFn, /requireModulePermission\(\s*\n?\s*supabase, \{ userId: auth\.userId, authMethod: auth\.authMethod \}/);
});

test('P2: the actor type records service_role instead of coercing it', () => {
  assert.match(adminFn, /const actorType = isServiceRoleActor \? 'service_role' : 'command_user'/);
  assert.match(sql.activityLog, /CHECK \(actor_type IN\s*\n?\s*\('command_user', 'service_role', 'builder_user', 'system'\)\)/);
});

test('P3: authentication failure returns 401 and authorization failure returns 403', () => {
  assert.match(adminFn, /if \(auth\.error \|\| !auth\.userId\) \{\s*\n\s*return json\(\{ error: auth\.error \|\| 'Authentication required' \}, 401, cors\);/);
  assert.match(adminFn, /if \(!authz\.ok\) \{\s*\n\s*return createForbiddenResponse\(authz\.error \|\| 'Not authorized', cors\);/);
});

test('P3: createForbiddenResponse is never passed an unused status argument', () => {
  const auth = read('supabase/functions/_shared/auth.ts');
  // The helper takes (message, corsHeaders) with defaults and hardcodes 403.
  // The default value contains parentheses, so the parameter list is matched
  // up to the closing brace of the declaration rather than with [^)]*.
  const declaration = auth.slice(auth.indexOf('export function createForbiddenResponse'));
  const signature = /^export function createForbiddenResponse\(([\s\S]*?)\): Response \{/.exec(declaration);
  assert.ok(signature, 'createForbiddenResponse signature changed — re-verify callers');
  // Count parameters at bracket depth 0: the types contain commas
  // (Record<string, string>) and the defaults contain parentheses
  // (createCorsHeaders()), so a naive split miscounts.
  let depth = 0;
  let topLevelCommas = 0;
  for (const char of signature[1]) {
    if ('(<[{'.includes(char)) depth += 1;
    else if (')>]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) topLevelCommas += 1;
  }
  assert.equal(topLevelCommas, 1, `expected 2 parameters, found ${topLevelCommas + 1}`);
  assert.match(declaration, /status: 403/);
  assert.ok(!/status\s*[:?]/.test(signature[1]),
    'createForbiddenResponse gained a status parameter — revisit the 401/403 split');
  // Two arguments only; the helper hardcodes 403.
  assert.doesNotMatch(adminFn, /createForbiddenResponse\([^)]*,[^)]*,[^)]*\)/);
});

test('P4: the Builder activity log exists and mirrors the Solicitor shape', () => {
  assert.match(sql.activityLog, /CREATE TABLE IF NOT EXISTS public\.builder_portal_activity_log/);
  for (const column of [
    'actor_user_id', 'actor_type', 'action', 'entity_type', 'entity_id',
    'organisation_id', 'builder_user_id', 'previous_state', 'new_state',
    'reason', 'created_at',
  ]) {
    assert.ok(sql.activityLog.includes(column), `activity log is missing ${column}`);
  }
});

test('P4: the audit writer raises rather than swallowing (NOCOPY-04)', () => {
  const writer = sql.activityLog.slice(
    sql.activityLog.indexOf('CREATE OR REPLACE FUNCTION public.builder_log_activity'),
    sql.activityLog.indexOf('COMMENT ON FUNCTION public.builder_log_activity'));
  assert.match(writer, /BUILDER_AUDIT_WRITE_FAILED/);
  assert.ok(!/EXCEPTION\s+WHEN/i.test(writer),
    'the audit writer swallows exceptions — it must fail closed');
});

test('P4: every access-control mutation has a guarded command', () => {
  for (const command of [
    'builder_admin_upsert_membership', 'builder_admin_revoke_membership',
    'builder_admin_set_user_status', 'builder_admin_set_organisation_status',
    'builder_admin_set_membership_permissions', 'builder_admin_revoke_user_sessions',
  ]) {
    assert.ok(sql.activityLog.includes(`CREATE OR REPLACE FUNCTION public.${command}`),
      `guarded command ${command} is missing`);
    assert.ok(adminFn.includes(`'${command}'`),
      `the admin function does not route through ${command}`);
  }
});

test('P4: each guarded command writes its audit inside its own transaction', () => {
  const commands = sql.activityLog.split(/CREATE OR REPLACE FUNCTION public\.builder_admin_/).slice(1);
  assert.equal(commands.length, 6, `expected 6 guarded commands, found ${commands.length}`);
  for (const command of commands) {
    const name = command.slice(0, command.indexOf('('));
    assert.match(command, /PERFORM public\.builder_log_activity\(/,
      `builder_admin_${name} does not write a trusted audit record`);
    assert.ok(!/EXCEPTION\s+WHEN/i.test(command),
      `builder_admin_${name} swallows an exception — the audit must be able to abort it`);
  }
});

test('P4: the admin function no longer writes access-control changes directly', () => {
  const code = stripJsComments(adminFn);
  // Direct table writes to membership and status columns would bypass the
  // guarded commands and therefore the trusted audit.
  assert.ok(!/from\('builder_organisation_memberships'\)\s*\n?\s*\.(insert|update|delete)/.test(code),
    'membership is still mutated directly, bypassing the guarded command');
  assert.ok(!/from\('builder_membership_permissions'\)\s*\.(insert|delete)/.test(code),
    'permission overrides are still mutated directly, bypassing the guarded command');
});

test('P4: the best-effort operational event is not the only record', () => {
  assert.match(adminFn, /Best-effort operational event, for observability only/);
  assert.match(adminFn, /record_portal_operational_event/);
  // and the trusted path exists alongside it
  assert.match(adminFn, /builder_admin_upsert_membership/);
});

test('P4: the audit trail is append-only', () => {
  assert.match(sql.activityLog, /BUILDER_ACTIVITY_LOG_APPEND_ONLY/);
  assert.match(sql.activityLog, /BEFORE UPDATE OR DELETE ON public\.builder_portal_activity_log/);
});

test('P4: the activity log is RLS-protected like every other builder table', () => {
  assert.match(sql.activityLog, /ALTER TABLE public\.builder_portal_activity_log ENABLE ROW LEVEL SECURITY/);
  assert.match(sql.activityLog, /REVOKE ALL ON public\.builder_portal_activity_log FROM anon, authenticated/);
  assert.doesNotMatch(sql.activityLog, /USING \(true\)/);
});

test('the Edge Function type check is wired and scoped to builder-portal-admin', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['typecheck:builder-edge'], 'typecheck:builder-edge script is missing');
  assert.match(pkg.scripts['typecheck:builder-edge'], /deno check/);
  assert.match(pkg.scripts['typecheck:builder-edge'], /builder-portal-admin/);
  // Scoped deliberately: the other 360 historical Edge Functions are untouched.
  assert.ok(!pkg.scripts['typecheck:builder-edge'].includes('supabase/functions/*'),
    'the type check was widened beyond builder-portal-admin');
  assert.ok(existsSync(join(root, 'supabase/functions/builder-portal-admin/deno.json')));
});

test('the P2/P4 corrections are covered by the live database harness', () => {
  const verify = read('scripts/builder-portal/local-db/verify-phase-1.mjs');
  for (const condition of [
    'a NULL actor grants a membership without 22P02',
    'the literal string service_role is not a storable uuid actor',
    'membership granted writes a trusted audit record',
    'membership role change records previous and new state',
    'permission override change is audited with before and after',
    'membership revocation is audited with its reason',
    'user suspension applies and is audited',
    'organisation suspension applies and is audited',
    'administrative session revocation is audited',
    'a membership grant fails when the trusted audit write fails',
    'and the membership was NOT created — the mutation rolled back with the audit',
    'the audit trail is append-only: rows cannot be updated',
  ]) {
    assert.ok(verify.includes(condition), `live verification is missing: ${condition}`);
  }
});
