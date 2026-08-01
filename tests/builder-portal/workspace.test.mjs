/**
 * Builder / Developer Portal — Workspace contract tests.
 *
 * Static contract assertions over the workspace migration, the two new Edge
 * Functions, the shared domain modules and the frontend wiring.
 *
 * The behavioural half — the activity boundary, dashboard counts built only
 * from accessible sets, membership as the hard gate, fail-closed auditing and
 * stale-write rejection — is executed against a live PostgreSQL database by
 * `scripts/builder-portal/local-db/verify-workspace.mjs` (95 assertions).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const MIGRATION = '20260809000000_builder_portal_workspace.sql';

const stripSqlComments = (body) => body.replace(/--[^\n]*/g, '');
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const migrationCode = stripSqlComments(read(join('supabase/migrations', MIGRATION)));
const portalCode = stripJsComments(read('supabase/functions/builder-portal-workspace/index.ts'));
const adminCode = stripJsComments(read('supabase/functions/builder-workspace-admin/index.ts'));
const sharedDomainCode = stripJsComments(read('supabase/functions/_shared/builderWorkspace.ts'));

const app = read('src/App.tsx');
const layout = read('src/components/builder-portal/BuilderPortalLayout.tsx');
const queries = stripJsComments(read('src/lib/builderQueries.ts'));
const domain = stripJsComments(read('src/lib/builderWorkspace.ts'));
const dashboardPage = stripJsComments(read('src/pages/builder/BuilderDashboard.tsx'));
const activityPage = stripJsComments(read('src/pages/builder/BuilderActivity.tsx'));
const settingsPage = stripJsComments(read('src/pages/builder/BuilderSettings.tsx'));
const preferencesCard = stripJsComments(
  read('src/components/builder-portal/BuilderPreferencesCard.tsx'));
const organisationCard = stripJsComments(
  read('src/components/builder-portal/BuilderOrganisationSettingsCard.tsx'));
const adminPanel = stripJsComments(
  read('src/components/admin/builder-portal/AdminBuilderWorkspacePanel.tsx'));
const configToml = read('supabase/config.toml');
const registry = JSON.parse(read('supabase/functions-registry/SECURITY_REGISTRY.json'));
const packageJson = JSON.parse(read('package.json'));

const TABLES = ['builder_organisation_settings', 'builder_user_preferences'];

const GUARDED_COMMANDS = [
  'builder_upsert_organisation_settings', 'builder_upsert_user_preferences',
];

/** Entity types a portal user must NEVER see in the activity feed. */
const ADMINISTRATIVE_ENTITIES = [
  'organisation', 'portal_user', 'membership', 'membership_permissions', 'session',
  'project_access', 'development', 'document_grant', 'transaction_case_link', 'notification',
];

const FORENSIC_FIELDS = ['previous_state', 'new_state', 'ip_address', 'user_agent'];

const PORTAL_SURFACES = [
  ['dashboard', dashboardPage], ['activity', activityPage],
  ['preferences card', preferencesCard], ['organisation card', organisationCard],
];

// ---------------------------------------------------------------------------
// Migration structure
// ---------------------------------------------------------------------------

test('the workspace migration exists and is timestamped after Collaboration', () => {
  assert.ok(readdirSync(join(root, 'supabase/migrations')).includes(MIGRATION));
  assert.ok(MIGRATION.split('_')[0] > '20260808000000');
});

test('the workspace migration drops no table, column, schema or type', () => {
  const destructive = migrationCode.match(/DROP\s+(TABLE|COLUMN|SCHEMA|TYPE)\b/gi) || [];
  assert.deepEqual(destructive, []);
});

test('every workspace table is created idempotently and RLS-protected', () => {
  for (const table of TABLES) {
    assert.match(migrationCode, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
      `${table} is not created idempotently`);
  }
  assert.match(migrationCode, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
  assert.match(migrationCode, /POST-MIGRATION FAILURE: RLS not enabled on/);
});

test('no workspace policy is written with an unrestricted USING (true)', () => {
  assert.doesNotMatch(migrationCode, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(migrationCode, /WITH CHECK\s*\(\s*true\s*\)/i);
});

test('every workspace table is revoked from anon and authenticated', () => {
  assert.match(migrationCode, /REVOKE ALL ON public\.%I FROM anon, authenticated/);
  for (const table of TABLES) {
    assert.ok(migrationCode.includes(`'${table}'`), `${table} is missing from the grant loop`);
  }
});

test('every workspace function is revoked from PUBLIC, anon and authenticated', () => {
  assert.match(migrationCode,
    /REVOKE ALL ON FUNCTION public\.%I\(%s\) FROM PUBLIC, anon, authenticated/);
  for (const fn of [...GUARDED_COMMANDS, 'builder_visible_activity', 'builder_workspace_summary',
    'builder_can_see_activity']) {
    assert.ok(migrationCode.includes(`'${fn}'`), `${fn} is missing from the revoke loop`);
  }
});

test('every table carrying the shared touch trigger also carries row_version', () => {
  for (const table of TABLES) {
    const definition = migrationCode.slice(
      migrationCode.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`));
    const body = definition.slice(0, definition.indexOf('\n);'));
    assert.match(body, /row_version bigint NOT NULL DEFAULT 1/,
      `${table} carries the touch trigger without row_version`);
  }
  assert.match(migrationCode,
    /POST-MIGRATION FAILURE: touch-triggered table\(s\) without row_version/);
});

test('one settings row per organisation and one preferences row per user', () => {
  const org = migrationCode.slice(
    migrationCode.indexOf('CREATE TABLE IF NOT EXISTS public.builder_organisation_settings'));
  assert.match(org.slice(0, org.indexOf('\n);')), /organisation_id uuid NOT NULL UNIQUE/);
  const user = migrationCode.slice(
    migrationCode.indexOf('CREATE TABLE IF NOT EXISTS public.builder_user_preferences'));
  assert.match(user.slice(0, user.indexOf('\n);')), /builder_user_id uuid NOT NULL UNIQUE/);
});

// ---------------------------------------------------------------------------
// The activity boundary
// ---------------------------------------------------------------------------

test('identity and administration are outside the portal-visible entity list', () => {
  const fn = migrationCode.slice(
    migrationCode.indexOf('FUNCTION public.builder_activity_entity_is_portal_visible'));
  const body = fn.slice(0, fn.indexOf('$$;'));
  for (const entity of ADMINISTRATIVE_ENTITIES) {
    assert.ok(!new RegExp(`'${entity}'`).test(body),
      `${entity} is inside the portal-visible entity list`);
  }
  // It is an allow-list, so an unclassified type is invisible by construction.
  assert.match(body, /SELECT _entity_type IN \(/);
  assert.match(migrationCode,
    /POST-MIGRATION FAILURE: administrative entity type\(s\) are portal-visible/);
});

test('the visibility check runs the allow-list before anything else', () => {
  const fn = migrationCode.slice(migrationCode.indexOf('FUNCTION public.builder_can_see_activity'));
  const body = fn.slice(0, fn.indexOf('END $$'));
  const gate = body.indexOf('builder_activity_entity_is_portal_visible');
  const firstResolver = body.indexOf('builder_resolve_');
  assert.ok(gate > -1, 'the allow-list is never consulted');
  assert.ok(gate < firstResolver, 'a resolver runs before the allow-list');
  assert.match(body, /IF _entity_type IS NULL OR _entity_id IS NULL THEN RETURN false; END IF;/);
  assert.match(body, /ELSE\s*\n\s*RETURN false;/, 'an unhandled entity type must not fall open');
});

test('every visible entity type resolves through the resolver that governs it', () => {
  const fn = migrationCode.slice(migrationCode.indexOf('FUNCTION public.builder_can_see_activity'));
  const body = fn.slice(0, fn.indexOf('END $$'));
  for (const [entity, resolver] of [
    ['project', 'builder_resolve_project_permission'],
    ['unit', 'builder_resolve_unit_permission'],
    ['transaction', 'builder_resolve_transaction_permission'],
    ['construction_case', 'builder_resolve_construction_permission'],
    ['document', 'builder_can_see_document'],
    ['conversation', 'builder_can_see_conversation'],
    ['task', 'builder_resolve_scope_permission'],
  ]) {
    assert.ok(body.includes(`_entity_type = '${entity}'`),
      `${entity} has no branch in the activity visibility check`);
    assert.ok(body.includes(resolver), `${entity} does not resolve through ${resolver}`);
  }
  // Construction children fall through to the construction resolver.
  assert.match(body,
    /RETURN v_parent IS NOT NULL\s*\n\s*AND public\.builder_resolve_construction_permission\(/);
});

test('the portal feed filters every row and omits the forensic fields', () => {
  const fn = migrationCode.slice(migrationCode.indexOf('FUNCTION public.builder_visible_activity'));
  const body = fn.slice(0, fn.indexOf('$$;'));
  assert.match(body, /AND public\.builder_can_see_activity\(_user_id, l\.entity_type, l\.entity_id\)/);
  assert.match(body, /WHERE l\.organisation_id = _organisation_id/);
  for (const field of FORENSIC_FIELDS) {
    assert.ok(!body.includes(field),
      `the portal activity feed returns ${field}, which belongs to the Command Centre`);
  }
  assert.match(body, /LIMIT LEAST\(GREATEST\(COALESCE\(_limit, 100\), 1\), 200\)/,
    'the limit is trusted rather than clamped');
  assert.match(migrationCode,
    /POST-MIGRATION FAILURE: the portal activity feed exposes forensic field\(s\)/);
});

test('the portal function and the admin function read activity through different paths', () => {
  // Staff need the full trail; a portal user must never have it. The two must
  // not share a reader, or narrowing one would silently narrow both.
  assert.ok(portalCode.includes('builder_visible_activity'),
    'the portal function does not use the narrowed feed');
  assert.ok(!portalCode.includes('builder_portal_activity_log'),
    'the portal function reads the raw audit log');
  assert.ok(adminCode.includes('builder_portal_activity_log'),
    'the admin function does not read the full audit log');
  assert.ok(!adminCode.includes('builder_visible_activity'),
    'the internal surface reads the narrowed portal feed');
});

test('the frontend models no forensic field', () => {
  const entry = domain.slice(domain.indexOf('interface BuilderActivityEntry'));
  const body = entry.slice(0, entry.indexOf('\n}'));
  for (const field of FORENSIC_FIELDS) {
    assert.ok(!body.includes(field), `the activity entry models ${field}`);
  }
  for (const [name, code] of PORTAL_SURFACES) {
    for (const field of FORENSIC_FIELDS) {
      assert.ok(!code.includes(field), `the ${name} surface reads ${field}`);
    }
  }
});

test('the portal activity filter is restricted to portal-visible entity types', () => {
  const block = portalCode.slice(portalCode.indexOf("operation === 'activity_history'"));
  const body = block.slice(0, block.indexOf('\n    // ─'));
  assert.match(body, /cleanEnum\(body\.entity_type, BUILDER_ACTIVITY_ENTITY_TYPES\)/);
  assert.match(body, /return json\(\{ error: 'That record type has no activity history' \}, 400\)/);
  const list = sharedDomainCode.slice(
    sharedDomainCode.indexOf('BUILDER_ACTIVITY_ENTITY_TYPES'));
  const listBody = list.slice(0, list.indexOf('] as const;'));
  for (const entity of ADMINISTRATIVE_ENTITIES) {
    assert.ok(!new RegExp(`'${entity}'`).test(listBody),
      `${entity} is offered as an activity filter`);
  }
});

// ---------------------------------------------------------------------------
// The dashboard boundary
// ---------------------------------------------------------------------------

test('every dashboard count is built from an accessible set', () => {
  const fn = migrationCode.slice(migrationCode.indexOf('FUNCTION public.builder_workspace_summary'));
  const body = fn.slice(0, fn.indexOf('$$;'));
  for (const accessor of ['builder_accessible_projects', 'builder_accessible_units',
    'builder_accessible_transactions', 'builder_accessible_construction_cases',
    'builder_accessible_documents', 'builder_accessible_conversations',
    'builder_accessible_tasks', 'builder_unread_counts']) {
    assert.ok(body.includes(accessor), `the summary does not use ${accessor}`);
  }
  // The derived counts hang off those sets rather than scanning a table freely.
  assert.match(body, /WHERE x\.construction_case_id IN \(SELECT construction_case_id FROM c\)/);
  assert.match(body, /WHERE x\.id IN \(SELECT conversation_id FROM v\)/);
  assert.match(body, /WHERE x\.id IN \(SELECT task_id FROM k\)/);
});

test('the summary carries no money, client position or commission', () => {
  const fn = migrationCode.slice(migrationCode.indexOf('FUNCTION public.builder_workspace_summary'));
  const body = fn.slice(0, fn.indexOf('$$;'));
  for (const forbidden of ['amount', 'price', 'value', 'commission', 'income', 'invoice']) {
    assert.ok(!new RegExp(`\\b\\w*${forbidden}\\w*\\b`, 'i').test(body),
      `the dashboard summary exposes ${forbidden}`);
  }
});

test('no settings table carries money, AML, credentials or privileged data', () => {
  assert.match(migrationCode,
    /POST-MIGRATION FAILURE: a settings table carries restricted data/);
  for (const table of TABLES) {
    const definition = migrationCode.slice(
      migrationCode.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`));
    const body = definition.slice(0, definition.indexOf('\n);'));
    for (const forbidden of ['amount', 'price', 'cost', 'income', 'borrowing', 'aml',
      'privileg', 'commission', 'password', 'secret', 'token']) {
      assert.ok(!new RegExp(`\\b\\w*${forbidden}\\w*\\s+(numeric|boolean|text|timestamptz)`, 'i').test(body),
        `${table} carries a ${forbidden} column`);
    }
  }
});

test('neither workspace function reads a table it does not own', () => {
  for (const [name, code] of [['portal', portalCode], ['admin', adminCode]]) {
    for (const table of ['build_progress_payments', 'builder_invoices', 'client_financials',
      'client_deals', 'clients', 'legal_matters', 'purchase_files', 'solicitor_',
      'aml_', 'commission']) {
      assert.ok(!code.includes(table),
        `the ${name} workspace function references ${table}, which it does not own`);
    }
  }
});

test('neither workspace function uses select("*")', () => {
  for (const [name, code] of [['portal', portalCode], ['admin', adminCode]]) {
    assert.doesNotMatch(code, /\.select\(\s*['"`]\*/,
      `the ${name} workspace function uses an unrestricted select`);
  }
});

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

test('the portal function resolves its session from the cookie and gates governance', () => {
  assert.ok(portalCode.includes('resolveBuilderSession'));
  assert.ok(portalCode.includes('builderGovernanceError'));
  assert.ok(portalCode.includes('enforceCsrf'));
  assert.ok(!portalCode.includes('verifyAuth'),
    'the portal function must not accept a Command Centre staff session');
});

test('the portal function never trusts a browser-supplied organisation or user id', () => {
  assert.match(portalCode, /session\.active_organisation\?\.organisation_id/);
  assert.ok(!/body\.organisation_id/.test(portalCode),
    'the portal function reads an organisation id from the request');
  assert.ok(!/body\.builder_user_id/.test(portalCode),
    'the portal function reads a user id from the request');
  // Every read and write is pinned to the session's own identity.
  assert.match(portalCode, /_user_id: me\.id/);
  assert.match(portalCode, /eq\('builder_user_id', me\.id\)/);
  assert.match(portalCode, /_actor_builder_user_id: me\.id,/);
});

test('organisation settings require an owner or administrator role from the session', () => {
  const block = portalCode.slice(portalCode.indexOf("operation === 'save_organisation_settings'"));
  const body = block.slice(0, block.indexOf('\n      if (error) return fail'));
  assert.match(body, /if \(!\['owner', 'administrator'\]\.includes\(membershipRole\)\)/);
  assert.match(body, /return json\(\{ error: 'You do not have permission to change organisation settings' \}, 403\)/);
  assert.match(portalCode, /const membershipRole = session\.active_organisation\?\.membership_role/,
    'the role is not taken from the verified session');
});

test('a default organisation preference is validated against a live membership', () => {
  const fn = migrationCode.slice(
    migrationCode.indexOf('FUNCTION public.builder_upsert_user_preferences'));
  const body = fn.slice(0, fn.indexOf('END $$'));
  assert.match(body, /builder_active_membership\(\s*\n?\s*_actor_builder_user_id, v_default_org\)/);
  assert.match(body, /BUILDER_NOT_A_MEMBER/);
  // The owner is the actor, never a payload field.
  assert.ok(!body.includes("_payload->>'builder_user_id'"),
    'a caller can name whose preferences are written');
  assert.match(body, /IF _actor_builder_user_id IS NULL THEN[\s\S]{0,160}?BUILDER_PREFERENCE_OWNER_REQUIRED/);
});

test('there is no admin write path for a portal user\'s own preferences', () => {
  assert.ok(adminCode.includes("operation === 'get_user_preferences'"));
  assert.ok(!adminCode.includes("operation === 'save_user_preferences'"),
    'the internal surface can overwrite a portal user\'s own preferences');
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

test('every guarded command writes its audit row in its own transaction', () => {
  for (const fn of GUARDED_COMMANDS) {
    const definition = migrationCode.slice(migrationCode.indexOf(`FUNCTION public.${fn}`));
    const body = definition.slice(0, definition.indexOf('END $$'));
    assert.match(body, /PERFORM public\.builder_log_activity\(/,
      `${fn} does not write a trusted audit row in its own transaction`);
  }
});

test('no workspace Edge Function mutates a domain table directly', () => {
  for (const [name, code] of [['portal', portalCode], ['admin', adminCode]]) {
    for (const verb of ['insert', 'update', 'delete', 'upsert']) {
      assert.doesNotMatch(code, new RegExp(`\\.${verb}\\(`),
        `the ${name} workspace function calls .${verb}() instead of a guarded command`);
    }
  }
});

test('both settings rows enforce expected_version atomically', () => {
  for (const fn of GUARDED_COMMANDS) {
    const definition = migrationCode.slice(migrationCode.indexOf(`FUNCTION public.${fn}`));
    const body = definition.slice(0, definition.indexOf('END $$'));
    assert.match(body, /_expected_version IS NULL OR v_existing\.row_version <> _expected_version/,
      `${fn} does not reject a missing or stale expected_version atomically`);
    assert.match(body, /FOR UPDATE/, `${fn} does not take a row lock`);
  }
});

test('a missing expected_version is a 400, never the current database value', () => {
  for (const [name, code] of [['portal', portalCode], ['admin', adminCode]]) {
    assert.ok(code.includes('EXPECTED_VERSION_REQUIRED'),
      `the ${name} workspace function does not reject a missing expected_version`);
    assert.ok(!/expected_version:\s*(record|existing|current|settings)\.row_version/.test(code),
      `the ${name} workspace function substitutes the current version for a missing one`);
  }
});

test('every error code the migration raises is mapped by the shared failure table', () => {
  const raised = new Set(
    (migrationCode.match(/MESSAGE='([A-Z_]+)'/g) || []).map((m) => m.slice(9, -1)));
  for (const code of raised) {
    assert.ok(sharedDomainCode.includes(`'${code}'`),
      `${code} is raised by the migration but not mapped to an HTTP status`);
  }
});

test('the activity log entity list covers every type the Builder modules write', () => {
  const check = migrationCode.slice(
    migrationCode.indexOf('ADD CONSTRAINT builder_portal_activity_log_entity_type_check'));
  const body = check.slice(0, check.indexOf('));'));
  for (const entity of ['document', 'conversation', 'message', 'task', 'task_assignment',
    'notification', 'organisation_settings', 'user_preferences', 'variation', 'defect']) {
    assert.ok(body.includes(`'${entity}'`),
      `${entity} is written by a Builder command but not accepted by the audit log`);
  }
});

// ---------------------------------------------------------------------------
// Edge Function contracts
// ---------------------------------------------------------------------------

test('the admin function requires internal auth, the module permission and CSRF', () => {
  assert.ok(adminCode.includes('verifyAuth'));
  assert.ok(adminCode.includes('requireModulePermission'));
  assert.ok(adminCode.includes('enforceCsrf'));
  assert.match(adminCode, /const MODULE_KEY = 'builder_portal_admin'/);
  assert.ok(!adminCode.includes('resolveBuilderSession'),
    'the admin function must not accept a Builder Portal session cookie');
});

test('the admin function never passes the service_role literal to a uuid argument', () => {
  assert.match(adminCode, /auth\.userId === 'service_role'/);
  assert.match(adminCode, /isServiceRoleActor \? null : auth\.userId/);
});

test('read operations require can_view and mutations require can_edit', () => {
  assert.match(adminCode, /READ_OPERATIONS\.has\(operation\) \? 'can_view' : 'can_edit'/);
  const readSet = adminCode.slice(adminCode.indexOf('const READ_OPERATIONS'),
    adminCode.indexOf('function requiredPermFor'));
  assert.ok(!readSet.includes("'save_organisation_settings'"),
    'save_organisation_settings is wrongly classified as a read operation');
});

test('the per-user portal views are portal-only', () => {
  for (const operation of ['get_my_preferences', 'save_my_preferences']) {
    assert.ok(portalCode.includes(`operation === '${operation}'`),
      `the portal function is missing ${operation}`);
    assert.ok(!adminCode.includes(`operation === '${operation}'`),
      `the internal surface must not carry the per-user operation ${operation}`);
  }
});

test('both functions are registered with the correct JWT posture', () => {
  assert.match(configToml, /\[functions\.builder-portal-workspace\]\s*\nverify_jwt = false/);
  assert.match(configToml, /\[functions\.builder-workspace-admin\]\s*\nverify_jwt = true/);
  assert.equal(registry.functions['builder-portal-workspace'].exposure_class,
    'portal-authenticated');
  assert.equal(registry.functions['builder-workspace-admin'].exposure_class, 'module-gated');
});

test('both functions are covered by the Deno type check', () => {
  const script = packageJson.scripts['typecheck:builder-edge'];
  assert.ok(script.includes('builder-portal-workspace/index.ts'));
  assert.ok(script.includes('builder-workspace-admin/index.ts'));
});

// ---------------------------------------------------------------------------
// Frontend wiring
// ---------------------------------------------------------------------------

test('the activity route is inside the Builder portal tree', () => {
  const builderTree = app.slice(app.indexOf('<Route path="/builder/*"'));
  assert.ok(builderTree.includes('<Route path="activity" element={<BuilderActivity />} />'));
});

test('the whole navigation is enabled and Activity is part of it', () => {
  assert.ok(!layout.includes('available: false'),
    'a completed module is still rendered as unavailable');
  assert.ok(layout.includes("label: 'Activity'"), 'Activity is missing from the navigation');
});

test('the browser never reaches the database directly', () => {
  for (const [name, code] of [['queries', queries], ['admin panel', adminPanel],
    ['settings page', settingsPage], ...PORTAL_SURFACES]) {
    assert.ok(!code.includes('supabase.from('),
      `the ${name} module queries the database directly instead of an Edge Function`);
  }
  assert.ok(queries.includes("invoke('builder-portal-workspace'"));
  assert.ok(adminPanel.includes("'builder-workspace-admin'"));
});

test('workspace queries do not retry a 4xx answer', () => {
  for (const hook of ['useBuilderWorkspaceSummary', 'useBuilderActivity',
    'useBuilderOrganisationSettings', 'useBuilderMyPreferences']) {
    const definition = queries.slice(queries.indexOf(`function ${hook}(`));
    const body = definition.slice(0, definition.indexOf('\n}\n'));
    assert.match(body, /retry: retryBuilderQuery/, `${hook} does not use the shared retry policy`);
  }
});

test('every settings save carries the version the form loaded', () => {
  for (const [name, code] of [['preferences', preferencesCard], ['organisation', organisationCard]]) {
    const block = code.slice(code.indexOf('const save = async'));
    const body = block.slice(0, block.indexOf('\n  };'));
    assert.match(body, /expected_version: (preferences|settings)\?\.row_version,/,
      `the ${name} form does not send the loaded version`);
  }
  const adminBlock = adminPanel.slice(adminPanel.indexOf('const saveSettings'));
  const adminBody = adminBlock.slice(0, adminBlock.indexOf('\n  };'));
  assert.match(adminBody, /expected_version: settings\?\.row_version,/);
  assert.match(adminBody, /if \(!reason \|\| !reason\.trim\(\)\) return;/);
});

test('the preferences form sends no user id and the organisation form no organisation id', () => {
  assert.ok(!preferencesCard.includes('builder_user_id'),
    'the preferences form names whose preferences are saved');
  assert.ok(!organisationCard.includes('organisation_id'),
    'the organisation form names which organisation is saved');
});

test('the organisation form treats can_edit as a hint, not the control', () => {
  assert.ok(organisationCard.includes('can_edit'),
    'the organisation form ignores the server hint entirely');
  assert.match(organisationCard,
    /Only an owner or administrator of this organisation can change these\./,
    'the form gives no reason when it is read-only');
  // And the server-side check is what actually refuses.
  assert.ok(portalCode.includes("'You do not have permission to change organisation settings'"));
});

test('every portal surface renders loading, empty and error states', () => {
  for (const [name, code] of PORTAL_SURFACES) {
    assert.ok(/\bisLoading\b/.test(code), `${name} has no loading state`);
    assert.ok(/\bisError\b/.test(code), `${name} has no error state`);
  }
  for (const [name, code] of [['dashboard', dashboardPage], ['activity', activityPage]]) {
    assert.ok(code.includes('border-dashed'), `${name} has no empty state`);
  }
});

test('the dashboard explains that a zero is a permission answer, not a fact', () => {
  assert.match(dashboardPage,
    /A zero means nothing you can see,\s*\n?\s*not necessarily nothing at all\./);
});

test('the activity page says administrative changes are not shown', () => {
  assert.match(activityPage,
    /Administrative changes — memberships, permissions and sessions — are not shown here\./);
});

test('no workspace surface exposes a Finance, Client or AML field', () => {
  for (const [name, code] of [['domain', domain], ['admin panel', adminPanel], ...PORTAL_SURFACES]) {
    assert.doesNotMatch(code,
      /\b(paid_at|payment_reference|receipt_(date|amount|reference)|commission_(amount|rate)|aml_\w+|client_income|borrowing_\w+|password|secret)\b/i,
      `the ${name} module surfaces a field it does not own`);
  }
});

test('the local-database verification script is wired into package.json', () => {
  assert.equal(packageJson.scripts['builder:db:verify:workspace'],
    'node scripts/builder-portal/local-db/verify-workspace.mjs');
});
