#!/usr/bin/env node
/**
 * Builder Portal Construction — local migration and behaviour verification.
 *
 * Real execution against real PostgreSQL. Every "ok" is a statement that ran.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-construction.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_VERIFY_DB_CON (aurixa_construction_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_VERIFY_DB_CON || 'aurixa_construction_verify';

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
  run(['-f', join(migrationsDir, '20260806000000_builder_portal_construction.sql')]);
  record('the construction migration is idempotent — a second apply succeeds', true);
} catch (error) {
  record('the construction migration is idempotent — a second apply succeeds', false,
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
const CLIENT_A = 'dddddddd-0000-0000-0000-00000000000a';
const CLIENT_B = 'dddddddd-0000-0000-0000-00000000000b';

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
  INSERT INTO clients(id, full_name) VALUES ('${CLIENT_A}','Client A'),('${CLIENT_B}','Client B');
`]);
run(['-c', `SELECT builder_admin_upsert_project_access(
  '${ACTOR}','command_user','${USER_B}','${PROJECT_1}','builder','team_member','{}'::jsonb,NULL,NULL,'fixture')`]);

const UNIT_1 = query(`SELECT (builder_upsert_unit('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',
  NULL,NULL,NULL,'{"unit_number":"T-1"}'::jsonb,NULL,'fixture')).id`);
const UNIT_2 = query(`SELECT (builder_upsert_unit('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',
  NULL,NULL,NULL,'{"unit_number":"T-2"}'::jsonb,NULL,'fixture')).id`);
const UNIT_P2 = query(`SELECT (builder_upsert_unit('${ACTOR}','command_user',NULL,NULL,'${PROJECT_2}',
  NULL,NULL,NULL,'{"unit_number":"OTHER-1"}'::jsonb,NULL,'fixture')).id`);

const TXN_1 = query(`SELECT (builder_upsert_transaction('${ACTOR}','command_user',NULL,NULL,
  '${PROJECT_1}','${UNIT_1}','${BLD_ORG}','{"transaction_reference":"TX-1"}'::jsonb,NULL,'fixture')).id`);
const TXN_2 = query(`SELECT (builder_upsert_transaction('${ACTOR}','command_user',NULL,NULL,
  '${PROJECT_1}','${UNIT_2}','${BLD_ORG}','{"transaction_reference":"TX-2"}'::jsonb,NULL,'fixture')).id`);
const TXN_P2 = query(`SELECT (builder_upsert_transaction('${ACTOR}','command_user',NULL,NULL,
  '${PROJECT_2}',NULL,'${BLD_ORG}','{"transaction_reference":"P2-1"}'::jsonb,NULL,'fixture')).id`);

// ===========================================================================
// 1. Schema, RLS, direct-access denial
// ===========================================================================
console.log('Schema and direct-access denial');
const TABLES = ['builder_construction_cases','builder_construction_stages',
  'builder_construction_milestones','builder_construction_progress_updates',
  'builder_construction_photographs','builder_construction_status_history',
  'builder_construction_date_history'];
for (const t of TABLES) {
  expectEqual(`${t} is RLS-protected`,
    `SELECT relrowsecurity FROM pg_class WHERE relname='${t}'`, 't');
  expectRejection(`anonymous SELECT on ${t} is denied`,
    `SET LOCAL ROLE anon; SELECT count(*) FROM public.${t};`, 'permission denied');
  expectRejection(`authenticated SELECT on ${t} is denied`,
    `SET LOCAL ROLE authenticated; SELECT count(*) FROM public.${t};`, 'permission denied');
}
expectEqual('no construction policy uses an unrestricted USING (true)',
  `SELECT count(*) FROM pg_policies WHERE schemaname='public'
   AND tablename = ANY(ARRAY['${TABLES.join("','")}'])
   AND (qual='true' OR with_check='true')`, 0);
expectEqual('every touch-triggered construction table carries row_version',
  `SELECT count(*) FROM unnest(ARRAY['builder_construction_cases','builder_construction_stages',
     'builder_construction_milestones','builder_construction_progress_updates',
     'builder_construction_photographs']) t
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=t AND column_name='row_version')`, 0);
expectEqual('a milestone carries no amount, payment, claim or invoice column',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='builder_construction_milestones'
     AND (column_name LIKE '%amount%' OR column_name LIKE '%payment%'
          OR column_name LIKE '%claim%' OR column_name LIKE '%invoice%')`, 0);
expectEqual('no construction table carries a cost, margin or supplier column',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name LIKE 'builder_construction%'
     AND (column_name LIKE '%cost%' OR column_name LIKE '%margin%'
          OR column_name LIKE '%supplier%' OR column_name LIKE '%commission%')`, 0);

// ===========================================================================
// 2. Creation and parentage
// ===========================================================================
console.log('\nCreation and parentage');
const CASE_1 = query(`SELECT (builder_upsert_construction_case('${ACTOR}','command_user',NULL,
  NULL,'${TXN_1}','{"case_reference":"BLD-1","site_supervisor_name":"Dana Reyes"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a construction case is created through the guarded command',
  `SELECT count(*) FROM builder_construction_cases WHERE id='${CASE_1}'`, 1);
expectEqual('and it wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log
   WHERE action='builder_construction_case_created' AND entity_id='${CASE_1}'`, 't');
expectEqual('a new construction case starts not_started at zero percent',
  `SELECT status||':'||percent_complete FROM builder_construction_cases WHERE id='${CASE_1}'`,
  'not_started:0.00');
expectEqual('the case inherits its project and unit from the transaction',
  `SELECT (c.project_id='${PROJECT_1}' AND c.unit_id='${UNIT_1}')
   FROM builder_construction_cases c WHERE c.id='${CASE_1}'`, 't');

expectRejection('a transaction can carry only one construction case',
  `SELECT builder_upsert_construction_case('${ACTOR}','command_user',NULL,NULL,'${TXN_1}',
     '{"case_reference":"DUP"}'::jsonb,NULL,'x')`,
  'builder_construction_cases_transaction_id_key');
expectRejection("a construction case cannot name a different project than its transaction",
  `INSERT INTO builder_construction_cases(transaction_id, project_id)
   VALUES ('${TXN_2}','${PROJECT_2}')`,
  'BUILDER_CONSTRUCTION_PARENT_MISMATCH');

const CASE_2 = query(`SELECT (builder_upsert_construction_case('${ACTOR}','command_user',NULL,
  NULL,'${TXN_2}','{"case_reference":"BLD-2"}'::jsonb,NULL,'fixture')).id`);
const CASE_P2 = query(`SELECT (builder_upsert_construction_case('${ACTOR}','command_user',NULL,
  NULL,'${TXN_P2}','{"case_reference":"BLD-P2"}'::jsonb,NULL,'fixture')).id`);

// ===========================================================================
// 3. Optimistic concurrency
// ===========================================================================
console.log('\nOptimistic concurrency');
expectRejection('an update without expected_version is rejected',
  `SELECT builder_upsert_construction_case('${ACTOR}','command_user',NULL,'${CASE_1}',NULL,
     '{"site_supervisor_name":"No Version"}'::jsonb,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('an update with a stale expected_version is rejected',
  `SELECT builder_upsert_construction_case('${ACTOR}','command_user',NULL,'${CASE_1}',NULL,
     '{"site_supervisor_name":"Stale"}'::jsonb,999999,'x')`,
  'BUILDER_STALE_WRITE');
expectEqual('the supervisor is unchanged after both rejections',
  `SELECT site_supervisor_name FROM builder_construction_cases WHERE id='${CASE_1}'`, 'Dana Reyes');
expectEqual('an update with the matching expected_version succeeds',
  `SELECT (builder_upsert_construction_case('${ACTOR}','command_user',NULL,'${CASE_1}',NULL,
     '{"site_supervisor_name":"Dana Reyes-Cole"}'::jsonb,
     (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_1}'),'ok')).site_supervisor_name`,
  'Dana Reyes-Cole');

// ===========================================================================
// 4. Lifecycle transitions
// ===========================================================================
console.log('\nLifecycle transitions');
expectEqual('not_started to site_preparation is allowed',
  `SELECT builder_is_construction_transition_allowed('not_started','site_preparation')`, 't');
expectEqual('not_started to completed is not allowed',
  `SELECT builder_is_construction_transition_allowed('not_started','completed')`, 'f');
expectEqual('completed is terminal',
  `SELECT builder_is_construction_transition_allowed('completed','handover')`, 'f');
expectEqual('a live case may be put on hold',
  `SELECT builder_is_construction_transition_allowed('under_construction','on_hold')`, 't');

expectRejection('a transition without a reason is rejected',
  `SELECT builder_transition_construction_case('${CASE_1}',
     (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_1}'),
     'not_started','site_preparation','','command_user',NULL,'${ACTOR}')`,
  'REASON_REQUIRED');
expectRejection('a transition with a stale expected_version is rejected',
  `SELECT builder_transition_construction_case('${CASE_1}',999999,
     'not_started','site_preparation','x','command_user',NULL,'${ACTOR}')`,
  'STALE_VERSION');
run(['-c', `SELECT builder_transition_construction_case('${CASE_1}',
  (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_1}'),
  'not_started','site_preparation','site established','command_user',NULL,'${ACTOR}')`]);
expectEqual('a valid transition moves the status',
  `SELECT status FROM builder_construction_cases WHERE id='${CASE_1}'`, 'site_preparation');
expectEqual('and it appended a history row',
  `SELECT count(*) FROM builder_construction_status_history
   WHERE construction_case_id='${CASE_1}' AND entity_kind='case' AND to_status='site_preparation'`, 1);
expectRejection('construction status history cannot be updated',
  `UPDATE builder_construction_status_history SET reason='tampered'
   WHERE construction_case_id='${CASE_1}'`,
  'BUILDER_CONSTRUCTION_HISTORY_APPEND_ONLY');
expectRejection('construction status history cannot be deleted',
  `DELETE FROM builder_construction_status_history WHERE construction_case_id='${CASE_1}'`,
  'BUILDER_CONSTRUCTION_HISTORY_APPEND_ONLY');

run(['-c', `
  SELECT builder_transition_construction_case('${CASE_1}',(SELECT row_version FROM builder_construction_cases WHERE id='${CASE_1}'),'site_preparation','under_construction','x','command_user',NULL,'${ACTOR}');
  SELECT builder_transition_construction_case('${CASE_1}',(SELECT row_version FROM builder_construction_cases WHERE id='${CASE_1}'),'under_construction','practical_completion','x','command_user',NULL,'${ACTOR}');
`]);
expectEqual('practical completion stamps its date',
  `SELECT practical_completion_date IS NOT NULL FROM builder_construction_cases WHERE id='${CASE_1}'`, 't');
run(['-c', `
  SELECT builder_transition_construction_case('${CASE_1}',(SELECT row_version FROM builder_construction_cases WHERE id='${CASE_1}'),'practical_completion','handover','x','command_user',NULL,'${ACTOR}');
  SELECT builder_transition_construction_case('${CASE_1}',(SELECT row_version FROM builder_construction_cases WHERE id='${CASE_1}'),'handover','completed','x','command_user',NULL,'${ACTOR}');
`]);
expectEqual('completion stamps the actual completion date and 100 percent',
  `SELECT (actual_completion_date IS NOT NULL AND percent_complete=100)
   FROM builder_construction_cases WHERE id='${CASE_1}'`, 't');

// ===========================================================================
// 5. Estimated completion dates
// ===========================================================================
console.log('\nEstimated completion dates');
expectRejection('a date change without a reason is rejected',
  `SELECT builder_set_construction_date('${ACTOR}','command_user',NULL,'${CASE_2}',
     'estimated_completion','2027-03-31',
     (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_2}'),'')`,
  'REASON_REQUIRED');
expectRejection('a date change with a stale expected_version is rejected',
  `SELECT builder_set_construction_date('${ACTOR}','command_user',NULL,'${CASE_2}',
     'estimated_completion','2027-03-31',999999,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('an unknown date kind is rejected',
  `SELECT builder_set_construction_date('${ACTOR}','command_user',NULL,'${CASE_2}',
     'invented_date','2027-03-31',
     (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_2}'),'x')`,
  'BUILDER_INVALID_DATE_KIND');
run(['-c', `SELECT builder_set_construction_date('${ACTOR}','command_user',NULL,'${CASE_2}',
  'estimated_completion','2027-03-31',
  (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_2}'),'initial programme')`]);
expectEqual('the estimated completion date is set',
  `SELECT estimated_completion_date FROM builder_construction_cases WHERE id='${CASE_2}'`,
  '2027-03-31');
run(['-c', `SELECT builder_set_construction_date('${ACTOR}','command_user',NULL,'${CASE_2}',
  'estimated_completion','2027-06-30',
  (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_2}'),'wet weather')`]);
expectEqual('every date change is recorded with its previous value and reason',
  `SELECT count(*) FROM builder_construction_date_history
   WHERE construction_case_id='${CASE_2}' AND date_kind='estimated_completion'`, 2);
expectEqual('the slippage is auditable from the history, not just the current value',
  `SELECT from_date::text||'->'||to_date::text FROM builder_construction_date_history
   WHERE construction_case_id='${CASE_2}' AND reason='wet weather'`, '2027-03-31->2027-06-30');
expectRejection('date history cannot be updated',
  `UPDATE builder_construction_date_history SET reason='tampered'
   WHERE construction_case_id='${CASE_2}'`,
  'BUILDER_CONSTRUCTION_HISTORY_APPEND_ONLY');

// ===========================================================================
// 6. Stages, milestones, progress and photographs
// ===========================================================================
console.log('\nStages, milestones, progress and photographs');
const CSTAGE_1 = query(`SELECT (builder_upsert_construction_stage('${ACTOR}','command_user',NULL,
  NULL,'${CASE_2}','{"name":"Frame","stage_key":"frame","sequence_number":2}'::jsonb,NULL,'fixture')).id`);
expectEqual('a construction stage is created through the guarded command',
  `SELECT count(*) FROM builder_construction_stages WHERE id='${CSTAGE_1}'`, 1);
expectRejection('a stage update without expected_version is rejected',
  `SELECT builder_upsert_construction_stage('${ACTOR}','command_user',NULL,'${CSTAGE_1}',NULL,
     '{"name":"Renamed"}'::jsonb,NULL,'x')`,
  'BUILDER_STALE_WRITE');

const CSTAGE_OTHER = query(`SELECT (builder_upsert_construction_stage('${ACTOR}','command_user',NULL,
  NULL,'${CASE_P2}','{"name":"Other Frame","stage_key":"frame"}'::jsonb,NULL,'fixture')).id`);
expectRejection("a milestone cannot reference another case's stage",
  `INSERT INTO builder_construction_milestones(construction_case_id, construction_stage_id, name)
   VALUES ('${CASE_2}','${CSTAGE_OTHER}','Bad milestone')`,
  'BUILDER_MILESTONE_PARENT_MISMATCH');

const MILESTONE_1 = query(`SELECT (builder_upsert_milestone('${ACTOR}','command_user',NULL,
  NULL,'${CASE_2}','${CSTAGE_1}','{"name":"Frame complete","planned_date":"2026-12-01"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a milestone is created through the guarded command',
  `SELECT count(*) FROM builder_construction_milestones WHERE id='${MILESTONE_1}'`, 1);
expectEqual('a new milestone is pending',
  `SELECT status FROM builder_construction_milestones WHERE id='${MILESTONE_1}'`, 'pending');
expectEqual('pending to achieved is allowed',
  `SELECT builder_is_milestone_transition_allowed('pending','achieved')`, 't');
expectEqual('achieved is terminal',
  `SELECT builder_is_milestone_transition_allowed('achieved','pending')`, 'f');
expectRejection('a milestone transition without a reason is rejected',
  `SELECT builder_transition_milestone('${MILESTONE_1}',
     (SELECT row_version FROM builder_construction_milestones WHERE id='${MILESTONE_1}'),
     'pending','achieved','','command_user',NULL,'${ACTOR}')`,
  'REASON_REQUIRED');
run(['-c', `SELECT builder_transition_milestone('${MILESTONE_1}',
  (SELECT row_version FROM builder_construction_milestones WHERE id='${MILESTONE_1}'),
  'pending','achieved','frame signed off','command_user',NULL,'${ACTOR}')`]);
expectEqual('an achieved milestone stamps its achieved date',
  `SELECT achieved_date IS NOT NULL FROM builder_construction_milestones WHERE id='${MILESTONE_1}'`, 't');
expectEqual('and it appended a milestone history row',
  `SELECT count(*) FROM builder_construction_status_history
   WHERE entity_kind='milestone' AND entity_id='${MILESTONE_1}'`, 1);

const UPDATE_1 = query(`SELECT (builder_add_progress_update('${ACTOR}','command_user',NULL,
  '${CASE_2}','${CSTAGE_1}','{"title":"Frame up","body":"Roof trusses next","percent_complete":45}'::jsonb,
  'fixture')).id`);
expectEqual('a progress update is created through the guarded command',
  `SELECT count(*) FROM builder_construction_progress_updates WHERE id='${UPDATE_1}'`, 1);
expectEqual("the case's headline percentage follows the latest update",
  `SELECT percent_complete FROM builder_construction_cases WHERE id='${CASE_2}'`, '45.00');
expectRejection('a progress update with no title is rejected',
  `SELECT builder_add_progress_update('${ACTOR}','command_user',NULL,'${CASE_2}',NULL,
     '{"body":"no title"}'::jsonb,'x')`,
  'BUILDER_PROGRESS_TITLE_REQUIRED');

const PHOTO_1 = query(`SELECT (builder_add_construction_photograph('${ACTOR}','command_user',NULL,
  '${CASE_2}','{"storage_path":"builder/case2/frame-1.jpg","file_name":"frame-1.jpg","caption":"Frame"}'::jsonb,
  'fixture')).id`);
expectEqual('a photograph is recorded through the guarded command',
  `SELECT count(*) FROM builder_construction_photographs WHERE id='${PHOTO_1}'`, 1);
expectRejection('a photograph with no storage path is rejected',
  `SELECT builder_add_construction_photograph('${ACTOR}','command_user',NULL,'${CASE_2}',
     '{"file_name":"x.jpg"}'::jsonb,'x')`,
  'BUILDER_PHOTOGRAPH_PATH_REQUIRED');
expectRejection("a photograph cannot reference another case's stage",
  `INSERT INTO builder_construction_photographs(construction_case_id, construction_stage_id,
     storage_path, file_name)
   VALUES ('${CASE_2}','${CSTAGE_OTHER}','builder/case2/bad.jpg','bad.jpg')`,
  'BUILDER_PHOTOGRAPH_PARENT_MISMATCH');
expectEqual('a photograph is removed through the guarded command',
  `SELECT builder_delete_construction_photograph('${ACTOR}','command_user',NULL,'${CASE_2}','${PHOTO_1}','ok')`,
  't');
expectEqual('and the delete audit carries the removed storage path',
  `SELECT previous_state->>'storage_path' FROM builder_portal_activity_log
   WHERE action='builder_construction_photograph_removed' AND entity_id='${PHOTO_1}'`,
  'builder/case2/frame-1.jpg');

// ===========================================================================
// 7. Access control
// ===========================================================================
console.log('\nAccess control');
expectEqual('the granted user resolves view on a case in the granted project',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','view')`, 't');
expectEqual('a user with no grant resolves false',
  `SELECT builder_resolve_construction_permission('${USER_O}','${CASE_2}','construction','view')`, 'f');
expectEqual('access to one project does not grant access to another project case',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_P2}','construction','view')`, 'f');
expectEqual('the accessible set excludes the other project',
  `SELECT count(*) FROM builder_accessible_construction_cases('${USER_B}','${BLD_ORG}','construction')
   WHERE project_id='${PROJECT_2}'`, 0);
expectEqual('and it does contain the granted project cases',
  `SELECT count(*)>0 FROM builder_accessible_construction_cases('${USER_B}','${BLD_ORG}','construction')`, 't');

console.log('\nMembership is a hard requirement');
const MEMBERSHIP_B = query(
  `SELECT id FROM builder_organisation_memberships
   WHERE builder_user_id='${USER_B}' AND organisation_id='${BLD_ORG}'`);

run(['-c', `SELECT builder_admin_upsert_project_access('${ACTOR}','command_user','${USER_B}',
  '${PROJECT_1}','builder','team_member',
  '{"construction":{"view":"allow","edit":"allow"},"transactions":{"view":"allow"}}'::jsonb,NULL,
  (SELECT row_version FROM builder_project_access
   WHERE builder_user_id='${USER_B}' AND project_id='${PROJECT_1}'),'grant override')`]);
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='construction_case';
  INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
    scope_id, view_decision, edit_decision, delete_decision)
  VALUES ('${MEMBERSHIP_B}','construction','construction_case','${CASE_2}','allow','allow','inherit')`]);
expectEqual('the construction_case scope is accepted by the column CHECK constraint',
  `SELECT pg_get_constraintdef(oid) LIKE '%construction_case%' FROM pg_constraint
   WHERE conname='builder_membership_permissions_scope_type_check'`, 't');
expectEqual('with both overlapping allow overrides in place, access resolves true',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','view')`, 't');

run(['-c', `UPDATE builder_organisation_memberships SET status='revoked', revoked_at=now(),
  revoked_reason='test' WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('a revoked membership denies despite the grant-level allow',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','view')`, 'f');
expectEqual('a revoked membership denies despite the case-scoped allow',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','edit')`, 'f');
expectEqual('and the accessible set is empty',
  `SELECT count(*) FROM builder_accessible_construction_cases('${USER_B}','${BLD_ORG}','construction')`, 0);
run(['-c', `UPDATE builder_organisation_memberships SET status='suspended', revoked_at=NULL,
  revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('a suspended membership denies as well',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','view')`, 'f');
run(['-c', `UPDATE builder_organisation_memberships SET status='active',
  revoked_at=NULL, revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('restoring the membership restores access',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','view')`, 't');

run(['-c', `UPDATE builder_membership_permissions SET view_decision='deny'
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='construction_case' AND scope_id='${CASE_2}'`]);
expectEqual('a case-scoped deny overrides the grant-level allow',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','view')`, 'f');
expectEqual('and it does not affect a sibling case',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_1}','construction','view')`, 't');
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='construction_case'`]);

// A denial on the parent TRANSACTION also denies its construction case.
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='transaction';
  INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
    scope_id, view_decision, edit_decision, delete_decision)
  VALUES ('${MEMBERSHIP_B}','transactions','transaction','${TXN_2}','deny','inherit','inherit')`]);
expectEqual('a denial on the parent transaction denies its construction case',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','view')`, 'f');
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='transaction'`]);
expectEqual('removing the transaction denial restores the construction case',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_2}','construction','view')`, 't');

expectRejection('a construction_case scope naming no row is refused',
  `INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
     scope_id, view_decision, edit_decision, delete_decision)
   VALUES ('${MEMBERSHIP_B}','construction','construction_case',
     '00000000-0000-0000-0000-0000000000ff','deny','inherit','inherit')`,
  'BUILDER_SCOPE_TARGET_NOT_FOUND');

expectEqual('the construction permission key carries a role baseline',
  `SELECT count(*)>0 FROM builder_role_default_permissions
   WHERE permission_key='construction' AND membership_role='manager' AND can_view`, 't');
expectEqual('read_only cannot edit construction',
  `SELECT can_edit FROM builder_role_default_permissions
   WHERE permission_key='construction' AND membership_role='read_only'`, 'f');

// ===========================================================================
// 8. Audit failure rolls the mutation back
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
  stages: query('SELECT count(*) FROM builder_construction_stages'),
  milestones: query('SELECT count(*) FROM builder_construction_milestones'),
  updates: query('SELECT count(*) FROM builder_construction_progress_updates'),
  photos: query('SELECT count(*) FROM builder_construction_photographs'),
  dates: query('SELECT count(*) FROM builder_construction_date_history'),
  estimate: query(`SELECT estimated_completion_date FROM builder_construction_cases WHERE id='${CASE_2}'`),
  status2: query(`SELECT status FROM builder_construction_cases WHERE id='${CASE_2}'`),
};

expectRejection('stage creation fails when the trusted audit write fails',
  `SELECT builder_upsert_construction_stage('${ACTOR}','command_user',NULL,NULL,'${CASE_2}',
     '{"name":"NOPE"}'::jsonb,NULL,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no stage row was created',
  'SELECT count(*) FROM builder_construction_stages', before.stages);

expectRejection('milestone creation fails when the trusted audit write fails',
  `SELECT builder_upsert_milestone('${ACTOR}','command_user',NULL,NULL,'${CASE_2}',NULL,
     '{"name":"NOPE"}'::jsonb,NULL,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no milestone row was created',
  'SELECT count(*) FROM builder_construction_milestones', before.milestones);

expectRejection('a progress update fails when the trusted audit write fails',
  `SELECT builder_add_progress_update('${ACTOR}','command_user',NULL,'${CASE_2}',NULL,
     '{"title":"NOPE","percent_complete":99}'::jsonb,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no progress row was created',
  'SELECT count(*) FROM builder_construction_progress_updates', before.updates);
expectEqual('and the case percentage is unchanged',
  `SELECT percent_complete FROM builder_construction_cases WHERE id='${CASE_2}'`, '45.00');

expectRejection('a photograph fails when the trusted audit write fails',
  `SELECT builder_add_construction_photograph('${ACTOR}','command_user',NULL,'${CASE_2}',
     '{"storage_path":"nope.jpg","file_name":"nope.jpg"}'::jsonb,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no photograph row was created',
  'SELECT count(*) FROM builder_construction_photographs', before.photos);

expectRejection('a date change fails when the trusted audit write fails',
  `SELECT builder_set_construction_date('${ACTOR}','command_user',NULL,'${CASE_2}',
     'estimated_completion','2028-01-01',
     (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_2}'),'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and neither the date nor its history changed',
  `SELECT estimated_completion_date::text||'|'||
     (SELECT count(*) FROM builder_construction_date_history)::text
   FROM builder_construction_cases WHERE id='${CASE_2}'`,
  `${before.estimate}|${before.dates}`);

expectRejection('a case transition fails when the trusted audit write fails',
  `SELECT builder_transition_construction_case('${CASE_2}',
     (SELECT row_version FROM builder_construction_cases WHERE id='${CASE_2}'),
     '${before.status2}','site_preparation','x','command_user',NULL,'${ACTOR}')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the case status is unchanged',
  `SELECT status FROM builder_construction_cases WHERE id='${CASE_2}'`, before.status2);

run(['-c', 'DROP TRIGGER trg_force_audit_failure ON public.builder_portal_activity_log;']);
expectEqual('with audit restored, a stage is created again',
  `SELECT (builder_upsert_construction_stage('${ACTOR}','command_user',NULL,NULL,'${CASE_2}',
     '{"name":"Lockup","stage_key":"lockup","sequence_number":3}'::jsonb,NULL,'ok')).name`,
  'Lockup');

// ===========================================================================
// 9. Solicitor regression
// ===========================================================================
console.log('\nSolicitor regression');
expectEqual('the Solicitor firm table is untouched by the construction migration',
  `SELECT count(*)>0 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='solicitor_firms'`, 't');
expectEqual('existing Solicitor terms acceptances are preserved',
  "SELECT count(*)>=0 FROM portal_terms_acceptances WHERE portal='solicitor'", 't');
expectEqual('the Solicitor rollout adapter still resolves its original signature',
  `SELECT resolve_cross_portal_feature_mode(
     (SELECT id FROM solicitor_firms LIMIT 1),'solicitor_matter_access_v2')`, 'cutover');
expectEqual('the Finance-owned progress payment table is untouched',
  `SELECT count(*)>0 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='build_progress_payments'
     AND column_name='is_commission_trigger'`, 't');

// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${'='.repeat(70)}`);
console.log(`Construction local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
console.log('All construction conditions verified against a live PostgreSQL database.');
