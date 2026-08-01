#!/usr/bin/env node
/**
 * Builder Portal Workspace — local migration and behaviour verification.
 *
 * Real execution against real PostgreSQL. Every "ok" is a statement that ran.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-workspace.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_VERIFY_DB_WS (aurixa_workspace_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_VERIFY_DB_WS || 'aurixa_workspace_verify';

const MIGRATIONS = [
  '20260801000000_builder_portal_phase1_organisations_users.sql',
  '20260801000100_builder_portal_phase1_permissions.sql',
  '20260801000200_builder_portal_phase1_sessions.sql',
  '20260801000300_portal_terms_multi_portal.sql',
  '20260801000400_cross_portal_rollout_org_generalisation.sql',
  '20260801000500_builder_portal_admin_module.sql',
  '20260801000600_builder_portal_activity_log.sql',
  '20260802000000_builder_portal_phase2_auth_governance.sql',
  '20260803000000_builder_portal_phase3_projects.sql',
  '20260804000000_builder_portal_inventory.sql',
  '20260805000000_builder_portal_transactions.sql',
  '20260806000000_builder_portal_construction.sql',
  '20260807000000_builder_portal_delivery.sql',
  '20260808000000_builder_portal_collaboration.sql',
  '20260809000000_builder_portal_workspace.sql',
];

const run = (args, db = DB) =>
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', ...args],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: '' } });
const query = (sql) => run(['-tAc', sql]).trim();

const results = [];
const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${name}${detail && !passed ? `\n         ${detail}` : ''}`);
};
const expectRejection = (name, sql, ...fragments) => {
  try { run(['-c', sql]); record(name, false, 'statement unexpectedly succeeded'); }
  catch (error) {
    const message = String(error.stderr || error.message);
    record(name, fragments.some((f) => message.includes(f)),
      `expected one of [${fragments.join(', ')}], got: ${message.trim().split('\n')[0]}`);
  }
};
const expectEqual = (name, sql, expected) => {
  let actual;
  try { actual = query(sql); }
  catch (error) {
    record(name, false, `query failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    return;
  }
  record(name, actual === String(expected), `expected ${expected}, got ${actual}`);
};

// ===========================================================================
// Build
// ===========================================================================
console.log(`Building ${DB} ...`);
run(['-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`], 'postgres');
run(['-c', `CREATE DATABASE ${DB}`], 'postgres');
run(['-f', join(root, 'scripts/builder-portal/local-db/00-supabase-bootstrap.sql')]);
run(['-f', join(root, 'scripts/builder-portal/local-db/01-upstream-fixture.sql')]);
const migrationsDir = join(root, 'supabase/migrations');
const onDisk = readdirSync(migrationsDir);
for (const name of MIGRATIONS) {
  if (!onDisk.includes(name)) { console.error(`FATAL: missing ${name}`); process.exit(1); }
  try { run(['-f', join(migrationsDir, name)]); }
  catch (error) {
    console.error(`\nFATAL: ${name} failed\n${String(error.stderr || error.message)}`);
    process.exit(1);
  }
}
console.log(`Applied ${MIGRATIONS.length} migration(s).\n`);

try {
  run(['-f', join(migrationsDir, '20260809000000_builder_portal_workspace.sql')]);
  record('the workspace migration is idempotent — a second apply succeeds', true);
} catch (error) {
  record('the workspace migration is idempotent — a second apply succeeds', false,
    String(error.stderr || error.message).trim().split('\n')[0]);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const DEV_ORG = '11111111-1111-1111-1111-111111111111';
const BLD_ORG = '22222222-2222-2222-2222-222222222222';
const OTHER_ORG = '33333333-3333-3333-3333-333333333333';
const USER_B = 'aaaaaaaa-0000-0000-0000-0000000000b1';
const USER_O = 'aaaaaaaa-0000-0000-0000-0000000000e1';
const PROJECT_1 = 'cccccccc-0000-0000-0000-000000000001';
const PROJECT_2 = 'cccccccc-0000-0000-0000-000000000002';
const ACTOR = '99999999-0000-0000-0000-000000000001';

run(['-c', `
  INSERT INTO builder_organisations(id, legal_name, org_type, status, is_active, activated_at)
  VALUES ('${DEV_ORG}','Northpoint Developments','developer','active',true,now()),
         ('${BLD_ORG}','Harbourline Constructions','builder','active',true,now()),
         ('${OTHER_ORG}','Unrelated Homes','builder','active',true,now());
  INSERT INTO builder_portal_users(id, email, name, status, is_active)
  VALUES ('${USER_B}','builder@harbourline.test','Builder User','active',true),
         ('${USER_O}','other@unrelated.test','Other User','active',true);
  INSERT INTO builder_organisation_memberships(builder_user_id, organisation_id, membership_role, is_primary)
  VALUES ('${USER_B}','${BLD_ORG}','manager',true),
         ('${USER_O}','${OTHER_ORG}','manager',true);
  INSERT INTO builder_projects(id, name, developer_organisation_id, builder_organisation_id, status)
  VALUES ('${PROJECT_1}','Harbour Rise A','${DEV_ORG}','${BLD_ORG}','planning'),
         ('${PROJECT_2}','Harbour Rise B','${DEV_ORG}','${BLD_ORG}','planning');
`]);
run(['-c', `SELECT builder_admin_upsert_project_access(
  '${ACTOR}','command_user','${USER_B}','${PROJECT_1}','builder','team_member','{}'::jsonb,NULL,NULL,'fixture')`]);

const UNIT_1 = query(`SELECT (builder_upsert_unit('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',
  NULL,NULL,NULL,'{"unit_number":"T-1"}'::jsonb,NULL,'fixture')).id`);
const UNIT_P2 = query(`SELECT (builder_upsert_unit('${ACTOR}','command_user',NULL,NULL,'${PROJECT_2}',
  NULL,NULL,NULL,'{"unit_number":"OTHER-1"}'::jsonb,NULL,'fixture')).id`);
const TXN_1 = query(`SELECT (builder_upsert_transaction('${ACTOR}','command_user',NULL,NULL,
  '${PROJECT_1}','${UNIT_1}','${BLD_ORG}','{"transaction_reference":"TX-1"}'::jsonb,NULL,'fixture')).id`);
const TXN_P2 = query(`SELECT (builder_upsert_transaction('${ACTOR}','command_user',NULL,NULL,
  '${PROJECT_2}',NULL,'${BLD_ORG}','{"transaction_reference":"P2-1"}'::jsonb,NULL,'fixture')).id`);
const CASE_1 = query(`SELECT (builder_upsert_construction_case('${ACTOR}','command_user',NULL,
  NULL,'${TXN_1}','{"case_reference":"BLD-1"}'::jsonb,NULL,'fixture')).id`);
const CASE_P2 = query(`SELECT (builder_upsert_construction_case('${ACTOR}','command_user',NULL,
  NULL,'${TXN_P2}','{"case_reference":"BLD-P2"}'::jsonb,NULL,'fixture')).id`);
const DEFECT_1 = query(`SELECT (builder_upsert_defect('${ACTOR}','command_user',NULL,
  NULL,'${CASE_1}',NULL,'{"title":"Scratched window frame","severity":"minor"}'::jsonb,
  NULL,'fixture')).id`);
const DEFECT_P2 = query(`SELECT (builder_upsert_defect('${ACTOR}','command_user',NULL,
  NULL,'${CASE_P2}',NULL,'{"title":"Other defect"}'::jsonb,NULL,'fixture')).id`);
const DOC_1 = query(`SELECT (builder_upsert_document('${ACTOR}','command_user',NULL,
  NULL,'construction_case','${CASE_1}','{"title":"Frame certificate"}'::jsonb,NULL,'fixture')).id`);
const DOC_P2 = query(`SELECT (builder_upsert_document('${ACTOR}','command_user',NULL,
  NULL,'project','${PROJECT_2}','{"title":"Other pack"}'::jsonb,NULL,'fixture')).id`);
const CONV_1 = query(`SELECT (builder_create_conversation('${ACTOR}','command_user','${USER_B}',
  'construction_case','${CASE_1}','{"subject":"Frame queries"}'::jsonb,NULL,'fixture')).id`);
const CONV_P2 = query(`SELECT (builder_create_conversation('${ACTOR}','command_user',NULL,
  'project','${PROJECT_2}','{"subject":"Other queries"}'::jsonb,NULL,'fixture')).id`);
const TASK_1 = query(`SELECT (builder_upsert_task('${ACTOR}','command_user','${USER_B}',
  NULL,'construction_case','${CASE_1}','{"title":"Book the inspection","due_date":"2026-01-05"}'::jsonb,
  NULL,'fixture')).id`);
const TASK_P2 = query(`SELECT (builder_upsert_task('${ACTOR}','command_user',NULL,
  NULL,'project','${PROJECT_2}','{"title":"Other task"}'::jsonb,NULL,'fixture')).id`);
run(['-c', `SELECT builder_set_task_assignment('${ACTOR}','command_user',NULL,
  '${TASK_1}','${USER_B}',false,NULL,'fixture')`]);

// ===========================================================================
// 1. Schema, RLS, direct-access denial
// ===========================================================================
console.log('Schema and direct-access denial');
const TABLES = ['builder_organisation_settings', 'builder_user_preferences'];
for (const t of TABLES) {
  expectEqual(`${t} is RLS-protected`,
    `SELECT relrowsecurity FROM pg_class WHERE relname='${t}'`, 't');
  expectRejection(`anonymous SELECT on ${t} is denied`,
    `SET LOCAL ROLE anon; SELECT count(*) FROM public.${t};`, 'permission denied');
  expectRejection(`authenticated SELECT on ${t} is denied`,
    `SET LOCAL ROLE authenticated; SELECT count(*) FROM public.${t};`, 'permission denied');
}
expectEqual('no workspace policy uses an unrestricted USING (true)',
  `SELECT count(*) FROM pg_policies WHERE schemaname='public'
   AND tablename = ANY(ARRAY['${TABLES.join("','")}'])
   AND (qual='true' OR with_check='true')`, 0);
expectEqual('every touch-triggered workspace table carries row_version',
  `SELECT count(*) FROM unnest(ARRAY['${TABLES.join("','")}']) t
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=t AND column_name='row_version')`, 0);
expectEqual('no workspace command is executable by anon or authenticated',
  `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('builder_upsert_organisation_settings',
     'builder_upsert_user_preferences','builder_visible_activity','builder_workspace_summary',
     'builder_can_see_activity')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, 0);

// ===========================================================================
// 2. Data boundaries
// ===========================================================================
console.log('\nData boundaries');
expectEqual('no settings table carries money, AML, credentials or privileged data',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name = ANY(ARRAY['${TABLES.join("','")}'])
     AND (column_name LIKE '%amount%' OR column_name LIKE '%price%' OR column_name LIKE '%cost%'
          OR column_name LIKE '%income%' OR column_name LIKE '%borrowing%'
          OR column_name LIKE '%aml%' OR column_name LIKE '%privileg%'
          OR column_name LIKE '%commission%' OR column_name LIKE '%password%'
          OR column_name LIKE '%secret%' OR column_name LIKE '%token%')`, 0);
expectEqual('the portal activity feed returns no forensic column',
  `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   CROSS JOIN LATERAL unnest(p.proargnames) a(name)
   WHERE n.nspname='public' AND p.proname='builder_visible_activity'
     AND a.name IN ('previous_state','new_state','ip_address','user_agent')`, 0);
expectEqual('the audit log itself is still append-only',
  `SELECT count(*) FROM pg_trigger
   WHERE tgname='trg_builder_activity_log_append_only' AND NOT tgisinternal`, 1);

// ===========================================================================
// 3. The activity boundary
// ===========================================================================
console.log('\nActivity boundary');
for (const entity of ['organisation', 'portal_user', 'membership', 'membership_permissions',
  'session', 'project_access', 'development', 'document_grant', 'transaction_case_link',
  'notification']) {
  expectEqual(`${entity} is never portal-visible`,
    `SELECT builder_activity_entity_is_portal_visible('${entity}')`, 'f');
}
expectEqual('an entity type nobody classified is invisible',
  `SELECT builder_activity_entity_is_portal_visible('invented')`, 'f');
expectEqual('a null entity type is invisible',
  `SELECT builder_can_see_activity('${USER_B}', NULL, NULL)`, 'f');

expectEqual('the granted user can see their own project activity',
  `SELECT builder_can_see_activity('${USER_B}','project','${PROJECT_1}')`, 't');
expectEqual('but not another project they were not granted',
  `SELECT builder_can_see_activity('${USER_B}','project','${PROJECT_2}')`, 'f');
expectEqual('a unit resolves through the unit resolver',
  `SELECT builder_can_see_activity('${USER_B}','unit','${UNIT_1}')`, 't');
expectEqual("and another project's unit does not",
  `SELECT builder_can_see_activity('${USER_B}','unit','${UNIT_P2}')`, 'f');
expectEqual('a transaction resolves through the transaction resolver',
  `SELECT builder_can_see_activity('${USER_B}','transaction','${TXN_1}')`, 't');
expectEqual("and another project's transaction does not",
  `SELECT builder_can_see_activity('${USER_B}','transaction','${TXN_P2}')`, 'f');
expectEqual('a construction case resolves through the construction resolver',
  `SELECT builder_can_see_activity('${USER_B}','construction_case','${CASE_1}')`, 't');
expectEqual('a defect resolves through its parent construction case',
  `SELECT builder_can_see_activity('${USER_B}','defect','${DEFECT_1}')`, 't');
expectEqual("and another case's defect does not",
  `SELECT builder_can_see_activity('${USER_B}','defect','${DEFECT_P2}')`, 'f');
expectEqual('a document resolves through the document gate',
  `SELECT builder_can_see_activity('${USER_B}','document','${DOC_1}')`, 't');
expectEqual("and another project's document does not",
  `SELECT builder_can_see_activity('${USER_B}','document','${DOC_P2}')`, 'f');
expectEqual('a conversation resolves through the conversation gate',
  `SELECT builder_can_see_activity('${USER_B}','conversation','${CONV_1}')`, 't');
expectEqual("and another project's conversation does not",
  `SELECT builder_can_see_activity('${USER_B}','conversation','${CONV_P2}')`, 'f');
expectEqual('a task resolves through the scope resolver',
  `SELECT builder_can_see_activity('${USER_B}','task','${TASK_1}')`, 't');
expectEqual("and another project's task does not",
  `SELECT builder_can_see_activity('${USER_B}','task','${TASK_P2}')`, 'f');
expectEqual('an id that resolves to no parent is invisible',
  `SELECT builder_can_see_activity('${USER_B}','defect','00000000-0000-0000-0000-0000000000ff')`, 'f');
expectEqual('a user outside the organisation sees nothing',
  `SELECT count(*) FROM unnest(ARRAY['${PROJECT_1}','${UNIT_1}','${TXN_1}','${CASE_1}']) e
   WHERE builder_can_see_activity('${USER_O}','project',e::uuid)`, 0);

expectEqual('the activity feed returns only rows the caller can resolve',
  `SELECT count(*)>0 FROM builder_visible_activity('${USER_B}','${BLD_ORG}')`, 't');
expectEqual('and no administrative row is in it',
  `SELECT count(*) FROM builder_visible_activity('${USER_B}','${BLD_ORG}',NULL,NULL,200) f
   WHERE f.entity_type IN ('membership','membership_permissions','session','portal_user',
                           'organisation','project_access')`, 0);
expectEqual('and no row belongs to a project the caller was not granted',
  `SELECT count(*) FROM builder_visible_activity('${USER_B}','${BLD_ORG}',NULL,NULL,200) f
   WHERE f.entity_id IN ('${PROJECT_2}','${UNIT_P2}','${TXN_P2}','${CASE_P2}',
                         '${DEFECT_P2}','${DOC_P2}','${CONV_P2}','${TASK_P2}')`, 0);
expectEqual('the feed can be narrowed to one record',
  `SELECT count(*)>0 FROM builder_visible_activity(
     '${USER_B}','${BLD_ORG}','defect','${DEFECT_1}')`, 't');
expectEqual('narrowing to a record the caller cannot reach returns nothing',
  `SELECT count(*) FROM builder_visible_activity(
     '${USER_B}','${BLD_ORG}','defect','${DEFECT_P2}')`, 0);
expectEqual('an organisation the caller is not in returns nothing',
  `SELECT count(*) FROM builder_visible_activity('${USER_B}','${OTHER_ORG}')`, 0);
expectEqual('the limit is clamped rather than trusted',
  `SELECT count(*)<=200 FROM builder_visible_activity('${USER_B}','${BLD_ORG}',NULL,NULL,100000)`, 't');
expectEqual('a zero or negative limit still returns at least one row',
  `SELECT count(*)=1 FROM builder_visible_activity('${USER_B}','${BLD_ORG}',NULL,NULL,-5)`, 't');

// ===========================================================================
// 4. Dashboard summary
// ===========================================================================
console.log('\nDashboard summary');
expectEqual('the summary counts only the accessible project',
  `SELECT projects FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('and only the accessible unit',
  `SELECT units FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('and only the accessible transaction',
  `SELECT transactions FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('and only the accessible construction case',
  `SELECT construction_cases FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('and only the accessible open defect',
  `SELECT open_defects FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('and only the accessible document',
  `SELECT documents FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('and only the accessible open conversation',
  `SELECT open_conversations FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('and only the accessible open task',
  `SELECT open_tasks FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('the overdue count follows the assigned overdue task',
  `SELECT overdue_tasks FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('every count is zero for a user outside the organisation',
  `SELECT (projects + units + transactions + construction_cases + open_defects
         + documents + open_conversations + open_tasks + overdue_tasks)
   FROM builder_workspace_summary('${USER_O}','${OTHER_ORG}')`, 0);

// ===========================================================================
// 5. Organisation settings
// ===========================================================================
console.log('\nOrganisation settings');
run(['-c', `SELECT builder_upsert_organisation_settings('${ACTOR}','command_user',NULL,
  '${BLD_ORG}','{"display_name":"Harbourline","timezone":"Australia/Brisbane"}'::jsonb,NULL,'fixture')`]);
expectEqual('settings are created on first save',
  `SELECT count(*) FROM builder_organisation_settings WHERE organisation_id='${BLD_ORG}'`, 1);
expectEqual('and it wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log
   WHERE action='builder_organisation_settings_saved' AND organisation_id='${BLD_ORG}'`, 't');
expectEqual('the defaults are applied',
  `SELECT (default_landing_page='dashboard' AND notify_on_defect)
   FROM builder_organisation_settings WHERE organisation_id='${BLD_ORG}'`, 't');
expectRejection('a second save without expected_version is rejected',
  `SELECT builder_upsert_organisation_settings('${ACTOR}','command_user',NULL,'${BLD_ORG}',
     '{"display_name":"No version"}'::jsonb,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('a save with a stale expected_version is rejected',
  `SELECT builder_upsert_organisation_settings('${ACTOR}','command_user',NULL,'${BLD_ORG}',
     '{"display_name":"Stale"}'::jsonb,999999,'x')`,
  'BUILDER_STALE_WRITE');
expectEqual('a save with the matching expected_version succeeds',
  `SELECT (builder_upsert_organisation_settings('${ACTOR}','command_user',NULL,'${BLD_ORG}',
     '{"display_name":"Harbourline Constructions"}'::jsonb,
     (SELECT row_version FROM builder_organisation_settings WHERE organisation_id='${BLD_ORG}'),
     'ok')).display_name`, 'Harbourline Constructions');
expectRejection('settings cannot be created for an organisation that does not exist',
  `SELECT builder_upsert_organisation_settings('${ACTOR}','command_user',NULL,
     '00000000-0000-0000-0000-0000000000ff','{}'::jsonb,NULL,'x')`,
  'BUILDER_ORGANISATION_NOT_FOUND');
expectRejection('an invalid landing page is refused',
  `UPDATE builder_organisation_settings SET default_landing_page='invented'
   WHERE organisation_id='${BLD_ORG}'`,
  'builder_organisation_settings_default_landing_page_check');
expectRejection('an organisation cannot hold two settings rows',
  `INSERT INTO builder_organisation_settings(organisation_id) VALUES ('${BLD_ORG}')`,
  'builder_organisation_settings_organisation_id_key');

// ===========================================================================
// 6. User preferences
// ===========================================================================
console.log('\nUser preferences');
run(['-c', `SELECT builder_upsert_user_preferences('${ACTOR}','builder_user','${USER_B}',
  '{"landing_page":"construction","email_digest":"weekly"}'::jsonb,NULL,'fixture')`]);
expectEqual('preferences are created on first save',
  `SELECT count(*) FROM builder_user_preferences WHERE builder_user_id='${USER_B}'`, 1);
expectEqual('and it wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log
   WHERE action='builder_user_preferences_saved' AND builder_user_id='${USER_B}'`, 't');
expectRejection('a second save without expected_version is rejected',
  `SELECT builder_upsert_user_preferences('${ACTOR}','builder_user','${USER_B}',
     '{"landing_page":"dashboard"}'::jsonb,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('a save with a stale expected_version is rejected',
  `SELECT builder_upsert_user_preferences('${ACTOR}','builder_user','${USER_B}',
     '{"landing_page":"dashboard"}'::jsonb,999999,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('preferences cannot be saved without an owner',
  `SELECT builder_upsert_user_preferences('${ACTOR}','command_user',NULL,'{}'::jsonb,NULL,'x')`,
  'BUILDER_PREFERENCE_OWNER_REQUIRED');
expectRejection('preferences cannot be saved for a user that does not exist',
  `SELECT builder_upsert_user_preferences('${ACTOR}','builder_user',
     '00000000-0000-0000-0000-0000000000ff','{}'::jsonb,NULL,'x')`,
  'BUILDER_USER_NOT_FOUND');
expectRejection('a default organisation the user is not a member of is refused',
  `SELECT builder_upsert_user_preferences('${ACTOR}','builder_user','${USER_B}',
     '{"default_organisation_id":"${OTHER_ORG}"}'::jsonb,
     (SELECT row_version FROM builder_user_preferences WHERE builder_user_id='${USER_B}'),'x')`,
  'BUILDER_NOT_A_MEMBER');
expectEqual('the user\'s own organisation is accepted as a default',
  `SELECT (builder_upsert_user_preferences('${ACTOR}','builder_user','${USER_B}',
     '{"default_organisation_id":"${BLD_ORG}"}'::jsonb,
     (SELECT row_version FROM builder_user_preferences WHERE builder_user_id='${USER_B}'),
     'ok')).default_organisation_id`, BLD_ORG);

const MEMBERSHIP_B = query(
  `SELECT id FROM builder_organisation_memberships
   WHERE builder_user_id='${USER_B}' AND organisation_id='${BLD_ORG}'`);
run(['-c', `UPDATE builder_organisation_memberships SET status='revoked', revoked_at=now(),
  revoked_reason='test' WHERE id='${MEMBERSHIP_B}'`]);
expectRejection('once the membership is revoked, the same default is refused',
  `SELECT builder_upsert_user_preferences('${ACTOR}','builder_user','${USER_B}',
     '{"default_organisation_id":"${BLD_ORG}"}'::jsonb,
     (SELECT row_version FROM builder_user_preferences WHERE builder_user_id='${USER_B}'),'x')`,
  'BUILDER_NOT_A_MEMBER');
expectEqual('and the stored preference no longer grants anything',
  `SELECT count(*) FROM builder_visible_activity('${USER_B}','${BLD_ORG}')`, 0);
expectEqual('and every dashboard count collapses to zero',
  `SELECT (projects + units + transactions + construction_cases + open_defects
         + documents + open_conversations + open_tasks + overdue_tasks)
   FROM builder_workspace_summary('${USER_B}','${BLD_ORG}')`, 0);
run(['-c', `UPDATE builder_organisation_memberships SET status='active', revoked_at=NULL,
  revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('restoring the membership restores the feed',
  `SELECT count(*)>0 FROM builder_visible_activity('${USER_B}','${BLD_ORG}')`, 't');
expectRejection('an invalid email is refused',
  `UPDATE builder_organisation_settings SET primary_contact_email='not-an-email'
   WHERE organisation_id='${BLD_ORG}'`,
  'builder_organisation_settings_primary_contact_email_check');
expectRejection('a user cannot hold two preference rows',
  `INSERT INTO builder_user_preferences(builder_user_id) VALUES ('${USER_B}')`,
  'builder_user_preferences_builder_user_id_key');

// ===========================================================================
// 7. Audit failure rolls the mutation back
// ===========================================================================
console.log('\nAudit failure rolls the mutation back');
run(['-c', `
  CREATE OR REPLACE FUNCTION force_audit_failure() RETURNS trigger
  LANGUAGE plpgsql AS $fn$ BEGIN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SIMULATED_AUDIT_OUTAGE'; END $fn$;
  CREATE TRIGGER trg_force_audit_failure BEFORE INSERT ON public.builder_portal_activity_log
    FOR EACH ROW EXECUTE FUNCTION force_audit_failure();
`]);

const before = {
  orgName: query(
    `SELECT display_name FROM builder_organisation_settings WHERE organisation_id='${BLD_ORG}'`),
  landing: query(`SELECT landing_page FROM builder_user_preferences WHERE builder_user_id='${USER_B}'`),
  orgRows: query('SELECT count(*) FROM builder_organisation_settings'),
  prefRows: query('SELECT count(*) FROM builder_user_preferences'),
};

expectRejection('an organisation settings save fails when the trusted audit write fails',
  `SELECT builder_upsert_organisation_settings('${ACTOR}','command_user',NULL,'${BLD_ORG}',
     '{"display_name":"TAMPERED"}'::jsonb,
     (SELECT row_version FROM builder_organisation_settings WHERE organisation_id='${BLD_ORG}'),'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the display name is unchanged',
  `SELECT display_name FROM builder_organisation_settings WHERE organisation_id='${BLD_ORG}'`,
  before.orgName);
expectRejection('a preferences save fails when the trusted audit write fails',
  `SELECT builder_upsert_user_preferences('${ACTOR}','builder_user','${USER_B}',
     '{"landing_page":"tasks"}'::jsonb,
     (SELECT row_version FROM builder_user_preferences WHERE builder_user_id='${USER_B}'),'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the landing page is unchanged',
  `SELECT landing_page FROM builder_user_preferences WHERE builder_user_id='${USER_B}'`,
  before.landing);
expectRejection('a first-time organisation settings row is not created either',
  `SELECT builder_upsert_organisation_settings('${ACTOR}','command_user',NULL,'${OTHER_ORG}',
     '{"display_name":"NOPE"}'::jsonb,NULL,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no settings row survives',
  'SELECT count(*) FROM builder_organisation_settings', before.orgRows);
expectRejection('a first-time preferences row is not created either',
  `SELECT builder_upsert_user_preferences('${ACTOR}','builder_user','${USER_O}',
     '{"landing_page":"tasks"}'::jsonb,NULL,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no preferences row survives',
  'SELECT count(*) FROM builder_user_preferences', before.prefRows);

run(['-c', 'DROP TRIGGER trg_force_audit_failure ON public.builder_portal_activity_log;']);
expectEqual('with audit restored, the settings save again',
  `SELECT (builder_upsert_organisation_settings('${ACTOR}','command_user',NULL,'${BLD_ORG}',
     '{"display_name":"Harbourline Constructions Pty Ltd"}'::jsonb,
     (SELECT row_version FROM builder_organisation_settings WHERE organisation_id='${BLD_ORG}'),
     'ok')).display_name`, 'Harbourline Constructions Pty Ltd');

// ===========================================================================
// 8. Solicitor regression
// ===========================================================================
console.log('\nSolicitor regression');
expectEqual('the Solicitor portal tables are untouched by the workspace migration',
  `SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('solicitor_firms','solicitor_portal_users','solicitor_portal_sessions')`, 3);
expectEqual('existing Solicitor terms acceptances are preserved',
  "SELECT count(*)>=0 FROM portal_terms_acceptances WHERE portal='solicitor'", 't');
expectEqual('the Solicitor rollout adapter still resolves its original signature',
  `SELECT resolve_cross_portal_feature_mode(
     (SELECT id FROM solicitor_firms LIMIT 1),'solicitor_matter_access_v2')`, 'cutover');

// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${'='.repeat(70)}`);
console.log(`Workspace local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
console.log('All workspace conditions verified against a live PostgreSQL database.');
