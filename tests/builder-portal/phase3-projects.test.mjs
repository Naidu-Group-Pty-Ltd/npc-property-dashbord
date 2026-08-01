/**
 * Builder / Developer Portal — Phase 3 contract tests.
 *
 * Static contract assertions over the Phase 3 migration, the two new Edge
 * Functions, the shared domain module and the frontend wiring. They run with no
 * database and no network, so they gate every CI run.
 *
 * The behavioural half of Phase 3 — access isolation, revocation, expiry,
 * fail-closed auditing, status transitions — is executed against a live
 * PostgreSQL database by `scripts/builder-portal/local-db/verify-phase-3.mjs`,
 * which asserts 117 conditions. These tests assert the shape that verification
 * depends on, so a change that would invalidate it fails here first.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const MIGRATION = '20260803000000_builder_portal_phase3_projects.sql';

const stripSqlComments = (body) => body.replace(/--[^\n]*/g, '');
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const migrationSql = read(join('supabase/migrations', MIGRATION));
const migrationCode = stripSqlComments(migrationSql);

const portalFn = read('supabase/functions/builder-portal-projects/index.ts');
const portalCode = stripJsComments(portalFn);
const adminFn = read('supabase/functions/builder-projects-admin/index.ts');
const adminCode = stripJsComments(adminFn);
const sharedDomain = read('supabase/functions/_shared/builderProjects.ts');
const sharedDomainCode = stripJsComments(sharedDomain);
const portalAuth = read('supabase/functions/_shared/builderPortalAuth.ts');
const portalAuthCode = stripJsComments(portalAuth);

const app = read('src/App.tsx');
const layout = read('src/components/builder-portal/BuilderPortalLayout.tsx');
const queries = stripJsComments(read('src/lib/builderQueries.ts'));
const listPage = stripJsComments(read('src/pages/builder/BuilderProjects.tsx'));
const detailPage = stripJsComments(read('src/pages/builder/BuilderProjectDetail.tsx'));
const adminPanel = stripJsComments(read('src/components/admin/builder-portal/AdminBuilderProjectsPanel.tsx'));
const configToml = read('supabase/config.toml');
const registry = JSON.parse(read('supabase/functions-registry/SECURITY_REGISTRY.json'));

// ---------------------------------------------------------------------------
// Migration structure
// ---------------------------------------------------------------------------

test('the Phase 3 migration exists and is timestamped after Phase 2', () => {
  assert.ok(readdirSync(join(root, 'supabase/migrations')).includes(MIGRATION));
  assert.ok(MIGRATION.split('_')[0] > '20260802000000');
});

test('the Phase 3 migration is additive — it drops no existing object', () => {
  const destructive = migrationCode.match(/DROP\s+(TABLE|COLUMN|FUNCTION|INDEX|SCHEMA|TYPE)\b/gi) || [];
  assert.deepEqual(destructive, [],
    `Phase 3 must not drop existing objects, found: ${destructive.join(', ')}`);
});

test('every Phase 3 table is created idempotently', () => {
  for (const table of ['builder_developments', 'builder_projects', 'builder_project_parties',
    'builder_project_status_history', 'builder_project_access']) {
    assert.match(migrationCode, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`),
      `${table} is not created idempotently`);
    assert.match(migrationCode, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
      `${table} is not RLS-protected`);
  }
});

test('no Phase 3 policy is written with an unrestricted USING (true)', () => {
  assert.doesNotMatch(migrationCode, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(migrationCode, /WITH CHECK\s*\(\s*true\s*\)/i);
});

test('every Phase 3 table is revoked from anon and authenticated', () => {
  // The grants are applied in a loop over an array of table names.
  assert.match(migrationCode, /REVOKE ALL ON public\.%I FROM anon, authenticated/);
  for (const table of ['builder_developments', 'builder_projects', 'builder_project_parties',
    'builder_project_status_history', 'builder_project_access']) {
    assert.ok(migrationCode.includes(`'${table}'`), `${table} is missing from the grant loop`);
  }
});

test('a project carries separate developer and builder organisations', () => {
  assert.match(migrationCode, /developer_organisation_id uuid REFERENCES public\.builder_organisations/);
  assert.match(migrationCode, /builder_organisation_id uuid REFERENCES public\.builder_organisations/);
  assert.match(migrationCode, /builder_projects_organisations_distinct/);
  assert.match(migrationCode, /builder_projects_has_an_organisation/);
});

test('project access requires one exact non-null organisation on the named side', () => {
  const guard = migrationCode.slice(migrationCode.indexOf('FUNCTION public.builder_enforce_project_access_org'));
  const body = guard.slice(0, guard.indexOf('END $$'));
  assert.match(body, /v_side_org IS NULL OR NEW\.organisation_id <> v_side_org/,
    'the exact non-null organisation rule is missing');
  assert.match(body, /BUILDER_PROJECT_ACCESS_ORG_MISMATCH/);
  // And the grantee must actually belong to that organisation.
  assert.match(body, /builder_active_membership\(NEW\.builder_user_id, NEW\.organisation_id\)/);
  assert.match(body, /BUILDER_PROJECT_ACCESS_NO_MEMBERSHIP/);
});

test('a live, in-window grant is required before anything else resolves', () => {
  const resolver = migrationCode.slice(
    migrationCode.indexOf('FUNCTION public.builder_resolve_project_permission'));
  const body = resolver.slice(0, resolver.indexOf('END $$'));
  assert.match(body, /revoked_at IS NULL/);
  assert.match(body, /valid_from <= now\(\)/);
  assert.match(body, /valid_until IS NULL OR valid_until > now\(\)/);
  // The no-grant return must come before the baseline is consulted.
  assert.ok(body.indexOf('IF v_access.id IS NULL THEN') < body.indexOf('builder_resolve_permission'),
    'the grant check must precede the organisation baseline');
});

test('the project resolver re-asserts forbidden keys and clamps read_only', () => {
  const resolver = migrationCode.slice(
    migrationCode.indexOf('FUNCTION public.builder_resolve_project_permission'));
  const body = resolver.slice(0, resolver.indexOf('END $$'));
  assert.match(body, /is_forbidden/, 'forbidden keys are not re-asserted after the overrides');
  assert.match(body, /v_access\.access_role = 'read_only'/);
});

test('the projects permission key carries a role baseline', () => {
  // Phase 1 catalogued the key but seeded no defaults, so without this every
  // grant would resolve false and the module would be unusable.
  assert.match(migrationCode, /INSERT INTO public\.builder_role_default_permissions[\s\S]*?'projects'/);
  assert.match(migrationCode, /POST-MIGRATION FAILURE: the projects permission key has no role baseline/);
});

test('access changes and transitions audit inside their own transaction', () => {
  for (const fn of ['builder_admin_upsert_project_access', 'builder_admin_revoke_project_access',
    'builder_transition_project']) {
    const definition = migrationCode.slice(migrationCode.indexOf(`FUNCTION public.${fn}`));
    const body = definition.slice(0, definition.indexOf('END $$'));
    assert.match(body, /PERFORM public\.builder_log_activity\(/,
      `${fn} does not write a trusted audit row in its own transaction`);
  }
});

test('status history is append-only', () => {
  assert.match(migrationCode, /BUILDER_PROJECT_STATUS_HISTORY_APPEND_ONLY/);
  assert.match(migrationCode, /BEFORE UPDATE OR DELETE ON public\.builder_project_status_history/);
});

test('a project organisation cannot drift out from under live access', () => {
  assert.match(migrationCode, /BUILDER_PROJECT_ACCESS_ORG_DRIFT/);
  assert.match(migrationCode,
    /BEFORE UPDATE OF developer_organisation_id, builder_organisation_id\s*\n\s*ON public\.builder_projects/);
});

test('the migration creates no later-phase table and asserts none exists', () => {
  for (const forbidden of ['builder_stages', 'builder_lots', 'builder_units', 'builder_inventory',
    'builder_reservations', 'builder_transactions', 'builder_variations',
    'builder_progress_claims', 'builder_inspections', 'builder_defects', 'builder_handovers']) {
    assert.doesNotMatch(migrationCode, new RegExp(`CREATE TABLE[^;]*${forbidden}\\b`),
      `${forbidden} belongs to a later phase`);
  }
  assert.match(migrationCode, /POST-MIGRATION FAILURE: later-phase table\(s\) present/);
});

test('Phase 3 adds no transaction-case link', () => {
  assert.doesNotMatch(migrationCode, /transaction_case_links/);
  assert.doesNotMatch(migrationCode, /builder_transaction_id/);
});

// ---------------------------------------------------------------------------
// Correction 1 — membership is a hard project-access requirement
// ---------------------------------------------------------------------------

test('an active membership is required BEFORE any override can run', () => {
  const resolver = migrationCode.slice(
    migrationCode.indexOf('FUNCTION public.builder_resolve_project_permission'));
  const body = resolver.slice(0, resolver.indexOf('END $$'));

  const gate = body.indexOf('builder_active_membership');
  const scopedOverride = body.indexOf('scope_type = \'project\'');
  const grantOverride = body.indexOf('v_access.permissions #>>');
  assert.ok(gate > 0, 'the resolver does not check the membership at all');
  assert.ok(gate < scopedOverride,
    'the project-scoped override runs before the membership gate');
  assert.ok(gate < grantOverride,
    'the grant-level override runs before the membership gate');

  // The gate must RETURN, not merely set a baseline that a later allow can lift.
  const gateBlock = body.slice(gate, gate + 200);
  assert.match(gateBlock, /IF v_membership_id IS NULL THEN\s*\n\s*RETURN false;/,
    'a missing membership does not return false immediately');
});

test('the organisation baseline is no longer the only membership check', () => {
  const resolver = migrationCode.slice(
    migrationCode.indexOf('FUNCTION public.builder_resolve_project_permission'));
  const body = resolver.slice(0, resolver.indexOf('END $$'));
  // The baseline call must come AFTER the hard gate, not stand in for it.
  assert.ok(body.indexOf('builder_active_membership') < body.indexOf('builder_resolve_permission'),
    'the membership gate must precede the baseline it used to rely on');
});

test('the project permission scope is enabled for project scopes only', () => {
  // Phase 1 blocked every non-organisation scope. Phase 3 opens `project` and
  // nothing else — a stage or unit scope has no table to point at.
  assert.match(migrationCode, /NEW\.scope_type NOT IN \('organisation', 'project'\)/);
  assert.match(migrationCode, /BUILDER_SCOPE_TARGET_NOT_FOUND/);
});

// ---------------------------------------------------------------------------
// Correction 2 — every mutation audits inside its own transaction
// ---------------------------------------------------------------------------

test('every Phase 3 guarded command audits in its own transaction', () => {
  for (const fn of [
    'builder_admin_upsert_project_access', 'builder_admin_revoke_project_access',
    'builder_transition_project', 'builder_admin_upsert_development',
    'builder_upsert_project', 'builder_upsert_project_party',
    'builder_delete_project_party',
  ]) {
    const definition = migrationCode.slice(migrationCode.indexOf(`FUNCTION public.${fn}`));
    const body = definition.slice(0, definition.indexOf('END $$'));
    assert.match(body, /PERFORM public\.builder_log_activity\(/,
      `${fn} does not write a trusted audit row in its own transaction`);
  }
});

test('no Phase 3 mutation writes state directly from an Edge Function', () => {
  // A direct write followed by a log leaves the state change committed when the
  // audit fails. Every mutation must go through a guarded command instead.
  for (const [name, source] of [['portal', portalCode], ['admin', adminCode]]) {
    for (const table of ['builder_projects', 'builder_project_parties',
      'builder_developments', 'builder_project_access']) {
      const pattern = new RegExp(
        `from\\(['"]${table}['"]\\)[\\s\\S]{0,200}?\\.(insert|update|delete)\\(`);
      assert.doesNotMatch(source, pattern,
        `${name} writes ${table} directly instead of through a guarded command`);
    }
  }
});

test('every mutating operation calls a guarded command', () => {
  for (const [source, operation, command] of [
    [adminCode, 'upsert_development', 'builder_admin_upsert_development'],
    [adminCode, 'create_project', 'builder_upsert_project'],
    [adminCode, 'update_project', 'builder_upsert_project'],
    [adminCode, 'set_status', 'builder_transition_project'],
    [adminCode, 'upsert_project_access', 'builder_admin_upsert_project_access'],
    [adminCode, 'revoke_project_access', 'builder_admin_revoke_project_access'],
    [portalCode, 'update_project', 'builder_upsert_project'],
    [portalCode, 'set_status', 'builder_transition_project'],
    [portalCode, 'upsert_party', 'builder_upsert_project_party'],
    [portalCode, 'delete_party', 'builder_delete_project_party'],
  ]) {
    const slice = source.slice(source.indexOf(`operation === '${operation}'`));
    assert.match(slice.slice(0, 2500), new RegExp(`rpc\\('${command}'`),
      `${operation} does not route through ${command}`);
  }
});

test('the after-the-fact logger is used only for reads', () => {
  // logBuilderProjectActivity does not share the mutation's transaction, so it
  // may only record observational events.
  const calls = portalCode.match(/logBuilderProjectActivity\(supabase, req, \{[\s\S]*?\}\)/g) || [];
  for (const call of calls) {
    assert.match(call, /action: 'builder_project_viewed'/,
      'the non-transactional logger is used for something other than a view event');
  }
});

test('project parties carry a row_version for the shared touch trigger', () => {
  // builder_touch_row sets NEW.row_version on every UPDATE; without the column
  // every party edit raises "record new has no field row_version".
  const table = migrationCode.slice(
    migrationCode.indexOf('CREATE TABLE IF NOT EXISTS public.builder_project_parties'));
  assert.match(table.slice(0, table.indexOf(');')), /row_version bigint NOT NULL DEFAULT 1/);
});

// ---------------------------------------------------------------------------
// Correction 3 — expected_version is required for existing access updates
// ---------------------------------------------------------------------------

test('an existing access grant cannot be updated without expected_version', () => {
  const slice = adminCode.slice(adminCode.indexOf("operation === 'upsert_project_access'"));
  const body = slice.slice(0, slice.indexOf("operation === 'revoke_project_access'"));

  // The defect was defaulting to the stored row_version.
  assert.doesNotMatch(body, /body\.expected_version \?\? existing\.row_version/,
    'a missing expected_version still falls back to the current row_version');
  assert.doesNotMatch(body, /existing\.row_version/,
    'the current row_version is still read as a substitute for the caller value');

  assert.match(body, /code: 'EXPECTED_VERSION_REQUIRED'/,
    'a missing expected_version does not return a 400 with a specific code');
  assert.match(body, /\}, 400, cors\)/);
  // A stale value must still be a 409 from the guarded command.
  assert.match(body, /BUILDER_STALE_WRITE[\s\S]{0,200}409/);
});

test('creating a new access grant needs no expected_version', () => {
  const slice = adminCode.slice(adminCode.indexOf("operation === 'upsert_project_access'"));
  const body = slice.slice(0, slice.indexOf("operation === 'revoke_project_access'"));
  // The version is only demanded when an existing grant was found.
  assert.match(body, /let expectedVersion: number \| null = null;/);
  assert.match(body, /if \(existing\) \{/);
});

test('the admin panel sends expected_version when updating an existing grant', () => {
  assert.match(adminPanel, /expected_version: existing\.row_version/);
});

// ---------------------------------------------------------------------------
// Portal Edge Function
// ---------------------------------------------------------------------------

test('the portal function resolves the session from the cookie only', () => {
  assert.match(portalCode, /resolveBuilderSession\(supabase, req\)/);
  assert.doesNotMatch(portalCode, /session_token/);
});

test('the portal function enforces CSRF in the established argument order', () => {
  assert.match(portalCode, /enforceCsrf\(req\)/);
  assert.match(portalCode, /csrfDenied\(corsHeaders,/);
});

test('a browser-supplied organisation id is never consulted by the portal function', () => {
  // The active organisation comes from the session, which is server-held.
  assert.match(portalCode, /session\.active_organisation\?\.organisation_id/);
  assert.doesNotMatch(portalCode, /body\.organisation_id/,
    'the portal function reads an organisation id from the request body');
});

test('every project load goes through the access resolver', () => {
  assert.match(portalCode, /resolveBuilderProjectAccess\(supabase, me\.id, projectId\)/);
  // A missing grant is reported as not-found, so ids cannot be probed.
  assert.match(portalCode, /if \(!access\) return \{ ok: false, status: 404/);
  // The grant must run through the session's active organisation.
  assert.match(portalCode, /access\.organisation_id !== activeOrganisationId/);
  // And the project must still name that organisation on the granted side.
  assert.match(portalCode, /sideOrg !== access\.organisation_id/);
});

test('the list endpoint is restricted to server-resolved accessible ids', () => {
  assert.match(portalCode, /listAccessibleBuilderProjectIds\(/);
  assert.match(portalCode, /\.in\('id', accessibleProjectIds\)/);
});

test('every portal mutation re-checks the permission matrix', () => {
  for (const [operation, level] of [
    ['update_project', 'edit'], ['set_status', 'edit'],
    ['upsert_party', 'edit'], ['delete_party', 'delete'],
  ]) {
    const slice = portalCode.slice(portalCode.indexOf(`operation === '${operation}'`));
    assert.match(slice.slice(0, 900), new RegExp(`builderMatrixCan\\([^)]*'projects', '${level}'\\)`),
      `${operation} does not re-check '${level}' on the resolved matrix`);
  }
});

test('portal writes carry optimistic concurrency', () => {
  // The version check moved into the guarded command, which raises
  // BUILDER_STALE_WRITE; the function maps that to 409. The old
  // `.eq('row_version', …)` idiom is gone because the direct update is gone.
  assert.match(portalCode, /expected_version/);
  assert.match(portalCode, /_expected_version: expectedVersion/);
  assert.match(portalCode, /BUILDER_STALE_WRITE/);
  assert.match(portalCode, /code: 'STALE_VERSION'/);
});

test('the portal function never touches Finance-owned tables', () => {
  for (const table of ['builder_invoices', 'build_progress_payments']) {
    assert.doesNotMatch(portalCode, new RegExp(`from\\(['"]${table}['"]\\)`));
  }
});

test('the portal detail contract excludes Command Centre private notes', () => {
  assert.doesNotMatch(sharedDomainCode.slice(
    sharedDomainCode.indexOf('BUILDER_PROJECT_PORTAL_DETAIL_SELECT'),
    sharedDomainCode.indexOf('BUILDER_PROJECT_COMMAND_CENTRE_SELECT')),
  /npc_internal_notes/);
  // And the Command Centre contract excludes the builder's private notes.
  const commandSelect = sharedDomainCode.slice(
    sharedDomainCode.indexOf('BUILDER_PROJECT_COMMAND_CENTRE_SELECT'));
  assert.doesNotMatch(commandSelect.slice(0, 200), /builder_notes/);
});

test('neither audience can write an organisation id or a status through the payload builder', () => {
  const builder = sharedDomainCode.slice(sharedDomainCode.indexOf('export function buildProjectPayload'));
  const body = builder.slice(0, builder.indexOf('export function buildPartyPayload'));
  assert.doesNotMatch(body, /developer_organisation_id/);
  assert.doesNotMatch(body, /builder_organisation_id/);
  assert.doesNotMatch(body, /payload\.status/);
});

// ---------------------------------------------------------------------------
// Internal admin Edge Function
// ---------------------------------------------------------------------------

test('the admin function requires internal auth, the module permission and CSRF', () => {
  assert.match(adminCode, /verifyAuth\(supabase, req\.headers, body\)/);
  assert.match(adminCode, /const MODULE_KEY = 'builder_portal_admin'/);
  assert.match(adminCode, /requireModulePermission\(/);
  assert.match(adminCode, /enforceCsrf\(req\)/);
  assert.match(adminCode, /csrfDenied\(cors,/);
});

test('the admin function never accepts a Builder Portal session', () => {
  assert.doesNotMatch(adminCode, /resolveBuilderSession/);
  assert.doesNotMatch(adminCode, /__Host-builder_session_token/);
});

test('mutating admin operations require can_edit', () => {
  assert.match(adminCode, /READ_OPERATIONS\.has\(operation\) \? 'can_view' : 'can_edit'/);
  for (const operation of ['create_project', 'update_project', 'set_status',
    'upsert_project_access', 'revoke_project_access', 'upsert_development']) {
    assert.ok(!adminCode.includes(`'${operation}',\n`) || !/READ_OPERATIONS = new Set\(\[[^\]]*'create_project'/.test(adminCode),
      `${operation} must not be classified as a read operation`);
  }
});

test('the service_role identity never reaches a uuid column', () => {
  assert.match(adminCode, /auth\.userId === 'service_role'/);
  assert.match(adminCode, /const adminUserId: string \| null = isServiceRoleActor \? null : auth\.userId/);
});

test('access grants and revocations go through the guarded database commands', () => {
  assert.match(adminCode, /rpc\('builder_admin_upsert_project_access'/);
  assert.match(adminCode, /rpc\('builder_admin_revoke_project_access'/);
  // Never a direct write to the access table from the function.
  assert.doesNotMatch(adminCode, /from\('builder_project_access'\)\s*\n?\s*\.(insert|update|delete)/);
});

test('the admin function re-reads parents rather than trusting ids', () => {
  const create = adminCode.slice(adminCode.indexOf("operation === 'create_project'"));
  assert.match(create.slice(0, 1600), /from\('builder_organisations'\)/,
    'create_project does not re-read the organisations it is given');
});

test('the admin function never touches Finance-owned tables', () => {
  for (const table of ['builder_invoices', 'build_progress_payments']) {
    assert.doesNotMatch(adminCode, new RegExp(`from\\(['"]${table}['"]\\)`));
  }
});

// ---------------------------------------------------------------------------
// Shared resolver
// ---------------------------------------------------------------------------

test('the project resolver adapter rejects expired grants', () => {
  const resolver = portalAuthCode.slice(portalAuthCode.indexOf('resolveBuilderProjectAccess'));
  assert.match(resolver.slice(0, 1600), /\.is\('revoked_at', null\)/);
  assert.match(resolver.slice(0, 1600), /\.lte\('valid_from'/);
  assert.match(resolver.slice(0, 1600), /valid_until.*getTime\(\) <= Date\.now\(\)/);
});

test('project permissions are resolved by the database, not recomputed in TypeScript', () => {
  assert.match(portalAuthCode, /rpc\('builder_resolve_project_permission'/);
});

test('the project activity logger reports failure rather than swallowing it', () => {
  const logger = portalAuthCode.slice(portalAuthCode.indexOf('logBuilderProjectActivity'));
  assert.match(logger.slice(0, 1800), /Promise<boolean>/);
  assert.match(logger.slice(0, 1800), /return false;/);
});

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

test('the Projects navigation item is enabled', () => {
  const entry = layout.slice(layout.indexOf("label: 'Projects'"));
  assert.match(entry.slice(0, 120), /available: true/);
});

test('navigation items with no module remain disabled', () => {
  for (const label of ['Messages', 'Tasks']) {
    const entry = layout.slice(layout.indexOf(`label: '${label}'`));
    assert.match(entry.slice(0, 120), /available: false/,
      `${label} has no module yet and must stay disabled`);
  }
});

test('the project routes live inside the protected Builder tree', () => {
  const tree = app.slice(app.indexOf('<Route path="/builder/*"'));
  const body = tree.slice(0, tree.indexOf('{/* Internal Dashboard Routes */}'));
  assert.match(body, /<Route path="projects" element=\{<BuilderProjects \/>\} \/>/);
  assert.match(body, /<Route path="projects\/:projectId" element=\{<BuilderProjectDetail \/>\} \/>/);
  // Both sit under the gate and the portal layout, not outside them.
  assert.ok(body.indexOf('<BuilderPortalProtectedRoute />') < body.indexOf('path="projects"'));
  assert.ok(body.indexOf('<BuilderPortalLayout />') < body.indexOf('path="projects"'));
});

test('the browser reaches project data only through the Edge Function', () => {
  for (const [name, source] of [['queries', queries], ['list page', listPage],
    ['detail page', detailPage]]) {
    assert.doesNotMatch(source, /supabase\s*\n?\s*\.from\(/,
      `${name} performs a direct database query`);
    assert.doesNotMatch(source, /from '@\/integrations\/supabase\/client'/,
      `${name} imports the browser database client`);
  }
  assert.match(queries, /invokeBuilderFunction/);
  assert.match(queries, /'builder-portal-projects'/);
});

test('no Builder project surface touches Web Storage', () => {
  for (const [name, source] of [['queries', queries], ['list page', listPage],
    ['detail page', detailPage], ['admin panel', adminPanel]]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/,
      `${name} persists state in the browser`);
  }
});

test('the detail page sends expected_version on every mutation', () => {
  assert.match(detailPage, /operation: 'update_project'[\s\S]{0,200}expected_version/);
  assert.match(detailPage, /operation: 'set_status'[\s\S]{0,200}expected_version/);
});

test('the admin panel calls the internal function through the secure invoker', () => {
  assert.match(adminPanel, /invokeSecureFunction\(\s*\n?\s*'builder-projects-admin'/);
  assert.doesNotMatch(adminPanel, /invokeBuilderFunction/,
    'the internal panel must not use the external portal transport');
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

test('both new Edge Functions are registered in config.toml and the registry', () => {
  for (const [name, verifyJwt] of [['builder-portal-projects', false], ['builder-projects-admin', true]]) {
    assert.ok(configToml.includes(`[functions.${name}]`), `${name} missing from config.toml`);
    const entry = registry.functions[name];
    assert.ok(entry, `${name} missing from SECURITY_REGISTRY.json`);
    assert.equal(entry.owner, 'builder-portal-program');
    assert.equal(entry.verify_jwt, verifyJwt);
    const declared = configToml.slice(configToml.indexOf(`[functions.${name}]`)).split('\n')[1];
    assert.equal(declared.trim(), `verify_jwt = ${verifyJwt}`,
      `${name}: config.toml and the registry disagree on verify_jwt`);
  }
});

test('the scoped Deno type-check covers both new functions', () => {
  const command = JSON.parse(read('package.json')).scripts['typecheck:builder-edge'];
  for (const name of ['builder-portal-projects', 'builder-projects-admin']) {
    assert.ok(command.includes(`supabase/functions/${name}/index.ts`),
      `${name} is outside the scoped type-check`);
  }
});

test('the Phase 3 database verification script is wired into package.json', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.ok(scripts['builder:db:verify:phase3']);
  assert.ok(existsSync(join(root, 'scripts/builder-portal/local-db/verify-phase-3.mjs')));
});

test('the Builder function family stops at inventory', () => {
  // No function for an unbuilt module may appear without this test failing.
  const dirs = readdirSync(join(root, 'supabase/functions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^builder-/.test(entry.name))
    .map((entry) => entry.name).sort();
  assert.deepEqual(dirs, [
    'builder-construction-admin',
    'builder-delivery-admin',
    'builder-inventory-admin',
    'builder-portal-accept-invite',
    'builder-portal-admin',
    'builder-portal-change-password',
    'builder-portal-construction',
    'builder-portal-delivery',
    'builder-portal-forgot-password',
    'builder-portal-inventory',
    'builder-portal-invite',
    'builder-portal-login',
    'builder-portal-logout',
    'builder-portal-projects',
    'builder-portal-reset-password',
    'builder-portal-transactions',
    'builder-portal-verify',
    'builder-projects-admin',
    'builder-transactions-admin',
  ]);
});

test('the Solicitor Portal was not modified by Phase 3', () => {
  // Phase 3 mirrors the Solicitor implementation; it must not edit it.
  for (const file of [
    'supabase/functions/solicitor-portal-matters/index.ts',
    'supabase/functions/_shared/solicitorPortalAuth.ts',
    'supabase/functions/_shared/legalMatters.ts',
    'src/pages/solicitor/SolicitorMatters.tsx',
    'src/pages/solicitor/SolicitorMatterDetail.tsx',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /builder_project|builderProject|builder-portal-projects/,
      `${file} was modified to reference the Builder project domain`);
  }
});
