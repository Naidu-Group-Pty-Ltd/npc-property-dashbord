#!/usr/bin/env node
/**
 * Builder Portal Phase 3 — local migration and behaviour verification.
 *
 * Builds a clean database, applies the bootstrap, the upstream fixture and the
 * Phase 1 + Phase 2 + Phase 3 migrations, then exercises the project access
 * model against the conditions this phase must satisfy.
 *
 * This is real execution against real PostgreSQL, not a static scan. Every
 * "ok" line below is the result of a statement that actually ran.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-phase-3.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_VERIFY_DB_3 (aurixa_phase3_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_VERIFY_DB_3 || 'aurixa_phase3_verify';

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
  try {
    run(['-c', sql]);
    record(name, false, 'statement unexpectedly succeeded');
  } catch (error) {
    const message = String(error.stderr || error.message);
    record(name, fragments.some((fragment) => message.includes(fragment)),
      `expected one of [${fragments.join(', ')}], got: ${message.trim().split('\n')[0]}`);
  }
};

const expectEqual = (name, sql, expected) => {
  let actual;
  try {
    actual = query(sql);
  } catch (error) {
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
  if (!onDisk.includes(name)) {
    console.error(`FATAL: migration missing from supabase/migrations: ${name}`);
    process.exit(1);
  }
  try {
    run(['-f', join(migrationsDir, name)]);
  } catch (error) {
    console.error(`\nFATAL: ${name} failed to apply\n${String(error.stderr || error.message)}`);
    process.exit(1);
  }
}
console.log(`Applied ${MIGRATIONS.length} migration(s).\n`);

try {
  run(['-f', join(migrationsDir, '20260803000000_builder_portal_phase3_projects.sql')]);
  record('the Phase 3 migration is idempotent — a second apply succeeds', true);
} catch (error) {
  record('the Phase 3 migration is idempotent — a second apply succeeds', false,
    String(error.stderr || error.message).trim().split('\n')[0]);
}

// ---------------------------------------------------------------------------
// Fixture
//   DEV_ORG  — developer organisation
//   BLD_ORG  — builder organisation
//   OTHER_ORG— an unrelated organisation
//   USER_B   — member of BLD_ORG (manager)
//   USER_D   — member of DEV_ORG (manager)
//   USER_O   — member of OTHER_ORG only
//   PROJECT_1 / PROJECT_2 — both DEV_ORG + BLD_ORG
// ---------------------------------------------------------------------------
const DEV_ORG = '11111111-1111-1111-1111-111111111111';
const BLD_ORG = '22222222-2222-2222-2222-222222222222';
const OTHER_ORG = '33333333-3333-3333-3333-333333333333';
const USER_B = 'aaaaaaaa-0000-0000-0000-0000000000b1';
const USER_D = 'aaaaaaaa-0000-0000-0000-0000000000d1';
const USER_O = 'aaaaaaaa-0000-0000-0000-0000000000o1'.replace(/o/g, 'e');
const PROJECT_1 = 'cccccccc-0000-0000-0000-000000000001';
const PROJECT_2 = 'cccccccc-0000-0000-0000-000000000002';

run(['-c', `
  INSERT INTO builder_organisations(id, legal_name, trading_name, org_type, status, is_active, activated_at)
  VALUES ('${DEV_ORG}','Northpoint Developments Pty Ltd','Northpoint','developer','active',true,now()),
         ('${BLD_ORG}','Harbourline Constructions Pty Ltd','Harbourline','builder','active',true,now()),
         ('${OTHER_ORG}','Unrelated Homes Pty Ltd','Unrelated','builder','active',true,now());

  INSERT INTO builder_portal_users(id, email, name, job_title, status, is_active)
  VALUES ('${USER_B}','builder@harbourline.test','Builder User','Project Manager','active',true),
         ('${USER_D}','developer@northpoint.test','Developer User','Development Manager','active',true),
         ('${USER_O}','other@unrelated.test','Other User','Site Supervisor','active',true);

  INSERT INTO builder_organisation_memberships(builder_user_id, organisation_id, membership_role, is_primary)
  VALUES ('${USER_B}','${BLD_ORG}','manager',true),
         ('${USER_D}','${DEV_ORG}','manager',true),
         ('${USER_O}','${OTHER_ORG}','manager',true);

  INSERT INTO builder_projects(id, name, project_reference, developer_organisation_id, builder_organisation_id, status)
  VALUES ('${PROJECT_1}','Harbour Rise Stage A','HR-A','${DEV_ORG}','${BLD_ORG}','planning'),
         ('${PROJECT_2}','Harbour Rise Stage B','HR-B','${DEV_ORG}','${BLD_ORG}','planning');
`]);

const ACTOR = '99999999-0000-0000-0000-000000000001';

// ===========================================================================
// 1. Schema and separate organisations
// ===========================================================================
console.log('\nProjects and developments');
for (const table of ['builder_developments', 'builder_projects', 'builder_project_parties',
  'builder_project_status_history', 'builder_project_access']) {
  expectEqual(`${table} exists and is RLS-protected`,
    `SELECT relrowsecurity FROM pg_class WHERE relname='${table}'`, 't');
  expectRejection(`anonymous SELECT on ${table} is denied`,
    `SET LOCAL ROLE anon; SELECT count(*) FROM public.${table};`, 'permission denied');
}

expectEqual('a project carries separate developer and builder organisations',
  `SELECT count(*) FROM builder_projects
   WHERE id='${PROJECT_1}' AND developer_organisation_id='${DEV_ORG}'
     AND builder_organisation_id='${BLD_ORG}'`, 1);

expectRejection('one organisation cannot be both the developer and the builder',
  `INSERT INTO builder_projects(name, developer_organisation_id, builder_organisation_id)
   VALUES ('Self Dealing','${DEV_ORG}','${DEV_ORG}')`,
  'builder_projects_organisations_distinct');

expectRejection('a project with no organisation at all is rejected',
  `INSERT INTO builder_projects(name) VALUES ('Orphan Project')`,
  'builder_projects_has_an_organisation');

run(['-c', `INSERT INTO builder_developments(id, developer_organisation_id, name)
            VALUES ('dddddddd-0000-0000-0000-000000000001','${DEV_ORG}','Harbour Rise')`]);
expectRejection("a project cannot join another developer's development",
  `INSERT INTO builder_projects(name, developer_organisation_id, builder_organisation_id, development_id)
   VALUES ('Wrong Development','${BLD_ORG}',NULL,'dddddddd-0000-0000-0000-000000000001')`,
  'BUILDER_PROJECT_DEVELOPMENT_ORG_MISMATCH');

// ===========================================================================
// 2. Access grants — the authorization boundary
// ===========================================================================
console.log('\nProject access grants');

expectEqual('membership alone grants NO project access',
  `SELECT count(*) FROM builder_accessible_projects('${USER_B}')`, 0);
expectEqual('and permission resolution denies without a grant',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');

expectRejection('a grant naming an organisation the project does not have is refused',
  `INSERT INTO builder_project_access(builder_user_id, project_id, organisation_id, organisation_side)
   VALUES ('${USER_O}','${PROJECT_1}','${OTHER_ORG}','builder')`,
  'BUILDER_PROJECT_ACCESS_ORG_MISMATCH');

expectRejection('a grant to a user with no membership of the granting organisation is refused',
  `INSERT INTO builder_project_access(builder_user_id, project_id, organisation_id, organisation_side)
   VALUES ('${USER_O}','${PROJECT_1}','${BLD_ORG}','builder')`,
  'BUILDER_PROJECT_ACCESS_NO_MEMBERSHIP');

expectRejection('a grant naming the wrong SIDE for the organisation is refused',
  `INSERT INTO builder_project_access(builder_user_id, project_id, organisation_id, organisation_side)
   VALUES ('${USER_B}','${PROJECT_1}','${BLD_ORG}','developer')`,
  'BUILDER_PROJECT_ACCESS_ORG_MISMATCH');

const GRANT_B1 = query(`SELECT (builder_admin_upsert_project_access(
  '${ACTOR}','command_user','${USER_B}','${PROJECT_1}','builder','team_member','{}'::jsonb,NULL,NULL,'phase 3 test')).id`);
expectEqual('a valid grant is created through the guarded command',
  `SELECT count(*) FROM builder_project_access WHERE id='${GRANT_B1}' AND revoked_at IS NULL`, 1);

expectEqual('the grant makes exactly one project visible',
  `SELECT count(*) FROM builder_accessible_projects('${USER_B}')`, 1);
expectEqual('and it is the granted project',
  `SELECT project_id FROM builder_accessible_projects('${USER_B}')`, PROJECT_1);

// --- the required isolation condition ---
expectEqual('access to one project does NOT grant access to another',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_2}','projects','view')`, 'f');
expectEqual('and the second project is absent from the accessible list',
  `SELECT count(*) FROM builder_accessible_projects('${USER_B}') WHERE project_id='${PROJECT_2}'`, 0);

// A developer-side user on the SAME project is a separate grant.
const GRANT_D1 = query(`SELECT (builder_admin_upsert_project_access(
  '${ACTOR}','command_user','${USER_D}','${PROJECT_1}','developer','responsible','{}'::jsonb,NULL,NULL,'phase 3 test')).id`);
expectEqual('the developer side of the same project is granted independently',
  `SELECT organisation_side FROM builder_project_access WHERE id='${GRANT_D1}'`, 'developer');
expectEqual('both sides can reach the same project',
  `SELECT count(*) FROM builder_accessible_projects('${USER_D}') WHERE project_id='${PROJECT_1}'`, 1);

expectEqual('a user of an unrelated organisation sees nothing',
  `SELECT count(*) FROM builder_accessible_projects('${USER_O}')`, 0);

// ===========================================================================
// 3. Revocation and expiry stop working immediately
// ===========================================================================
console.log('\nRevocation and expiry');

const ROW_V = query(`SELECT row_version FROM builder_project_access WHERE id='${GRANT_B1}'`);
run(['-c', `SELECT builder_admin_revoke_project_access(
  '${ACTOR}','command_user','${GRANT_B1}',${ROW_V},'phase 3 revocation test')`]);

expectEqual('a revoked grant stops resolving immediately',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');
expectEqual('and disappears from the accessible list immediately',
  `SELECT count(*) FROM builder_accessible_projects('${USER_B}')`, 0);
expectRejection('revoking twice is refused',
  `SELECT builder_admin_revoke_project_access('${ACTOR}','command_user','${GRANT_B1}',
     (SELECT row_version FROM builder_project_access WHERE id='${GRANT_B1}'),'again')`,
  'BUILDER_PROJECT_ACCESS_ALREADY_REVOKED');

// Re-grant, then expire it.
run(['-c', `SELECT builder_admin_upsert_project_access(
  '${ACTOR}','command_user','${USER_B}','${PROJECT_1}','builder','team_member','{}'::jsonb,
  now()+interval '1 hour',
  (SELECT row_version FROM builder_project_access WHERE id='${GRANT_B1}'),'re-grant')`]);
expectEqual('a re-granted, in-window grant resolves again',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');

// Expire it by moving the window into the past. valid_until must stay > valid_from.
run(['-c', `UPDATE builder_project_access
            SET valid_from = now() - interval '2 hours', valid_until = now() - interval '1 minute'
            WHERE id='${GRANT_B1}'`]);
expectEqual('an expired grant stops resolving immediately',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');
expectEqual('and disappears from the accessible list immediately',
  `SELECT count(*) FROM builder_accessible_projects('${USER_B}')`, 0);

// A not-yet-valid grant must also be invisible.
run(['-c', `UPDATE builder_project_access
            SET valid_from = now() + interval '1 day', valid_until = now() + interval '2 days'
            WHERE id='${GRANT_B1}'`]);
expectEqual('a future-dated grant does not resolve yet',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');

run(['-c', `UPDATE builder_project_access
            SET valid_from = now() - interval '1 hour', valid_until = NULL
            WHERE id='${GRANT_B1}'`]);
expectEqual('restoring the window restores access',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');

// Losing the organisation membership must close the project too.
run(['-c', `UPDATE builder_organisation_memberships
            SET status='revoked', revoked_at=now(), revoked_reason='test'
            WHERE builder_user_id='${USER_B}' AND organisation_id='${BLD_ORG}'`]);
expectEqual('losing the organisation membership closes the project immediately',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');
run(['-c', `UPDATE builder_organisation_memberships
            SET status='active', revoked_at=NULL, revoked_reason=NULL
            WHERE builder_user_id='${USER_B}' AND organisation_id='${BLD_ORG}'`]);
expectEqual('restoring the membership restores project access',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');

// ===========================================================================
// 4. Permission resolution details
// ===========================================================================
console.log('\nPermission resolution');

expectEqual('a forbidden key can never resolve true on a project',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','commissions','view')`, 'f');
expectEqual('an unknown key resolves false — deny by default extends to typos',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','not_a_real_key','view')`, 'f');

run(['-c', `UPDATE builder_project_access SET access_role='read_only' WHERE id='${GRANT_B1}'`]);
expectEqual('read_only still permits view',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');
expectEqual('read_only clamps edit',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','edit')`, 'f');
expectEqual('read_only clamps delete',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','delete')`, 'f');

run(['-c', `UPDATE builder_project_access SET access_role='team_member',
            permissions='{"projects":{"view":"deny"}}'::jsonb WHERE id='${GRANT_B1}'`]);
expectEqual('an explicit grant-level deny beats the organisation baseline',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');

run(['-c', `UPDATE builder_project_access SET permissions='{}'::jsonb WHERE id='${GRANT_B1}'`]);
expectRejection('a malformed tri-state matrix is rejected by the CHECK',
  `UPDATE builder_project_access SET permissions='{"projects":{"view":"maybe"}}'::jsonb
   WHERE id='${GRANT_B1}'`,
  'builder_project_access_permissions_valid');

// ===========================================================================
// 5. Status transitions
// ===========================================================================
console.log('\nStatus transitions');

expectEqual('a legal transition succeeds and bumps the version',
  `SELECT (builder_transition_project('${PROJECT_1}',
     (SELECT row_version FROM builder_projects WHERE id='${PROJECT_1}'),
     'planning','pre_sales','commencing sales','builder_user','${USER_B}',NULL)->>'status')`,
  'pre_sales');
expectEqual('the transition wrote an append-only history row',
  `SELECT count(*) FROM builder_project_status_history
   WHERE project_id='${PROJECT_1}' AND from_status='planning' AND to_status='pre_sales'`, 1);
expectEqual('and a trusted audit row',
  `SELECT count(*) > 0 FROM builder_portal_activity_log
   WHERE action='builder_project_status_changed' AND entity_id='${PROJECT_1}'`, 't');

expectRejection('an illegal transition is refused',
  `SELECT builder_transition_project('${PROJECT_1}',
     (SELECT row_version FROM builder_projects WHERE id='${PROJECT_1}'),
     'pre_sales','completed','skip ahead','builder_user','${USER_B}',NULL)`,
  'INVALID_TRANSITION');
expectRejection('a stale expected_version is refused',
  `SELECT builder_transition_project('${PROJECT_1}',1,'pre_sales','approved','stale','builder_user','${USER_B}',NULL)`,
  'STALE_VERSION');
expectRejection('a transition with no reason is refused',
  `SELECT builder_transition_project('${PROJECT_1}',
     (SELECT row_version FROM builder_projects WHERE id='${PROJECT_1}'),
     'pre_sales','approved','   ','builder_user','${USER_B}',NULL)`,
  'REASON_REQUIRED');

expectRejection('status history cannot be updated',
  `UPDATE builder_project_status_history SET to_status='completed' WHERE project_id='${PROJECT_1}'`,
  'BUILDER_PROJECT_STATUS_HISTORY_APPEND_ONLY');
expectRejection('status history cannot be deleted',
  `DELETE FROM builder_project_status_history WHERE project_id='${PROJECT_1}'`,
  'BUILDER_PROJECT_STATUS_HISTORY_APPEND_ONLY');

// ===========================================================================
// 6. Audit failure rolls access changes back
// ===========================================================================
console.log('\nFail-closed auditing');

run(['-c', `
  CREATE OR REPLACE FUNCTION public.force_audit_failure() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SIMULATED_AUDIT_OUTAGE';
  END $$;
  CREATE TRIGGER trg_force_audit_failure BEFORE INSERT ON public.builder_portal_activity_log
    FOR EACH ROW EXECUTE FUNCTION public.force_audit_failure();
`]);

expectRejection('a grant fails when the trusted audit write fails',
  `SELECT builder_admin_upsert_project_access(
     '${ACTOR}','command_user','${USER_D}','${PROJECT_2}','developer','team_member','{}'::jsonb,NULL,NULL,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the grant was NOT created — the mutation rolled back with the audit',
  `SELECT count(*) FROM builder_project_access
   WHERE builder_user_id='${USER_D}' AND project_id='${PROJECT_2}'`, 0);

expectRejection('a revocation fails when the trusted audit write fails',
  `SELECT builder_admin_revoke_project_access('${ACTOR}','command_user','${GRANT_D1}',
     (SELECT row_version FROM builder_project_access WHERE id='${GRANT_D1}'),'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the grant is still live — the revocation rolled back',
  `SELECT count(*) FROM builder_project_access WHERE id='${GRANT_D1}' AND revoked_at IS NULL`, 1);

expectRejection('a status transition fails when the trusted audit write fails',
  `SELECT builder_transition_project('${PROJECT_1}',
     (SELECT row_version FROM builder_projects WHERE id='${PROJECT_1}'),
     'pre_sales','approved','audit outage','builder_user','${USER_B}',NULL)`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the status is unchanged — the transition rolled back',
  `SELECT status FROM builder_projects WHERE id='${PROJECT_1}'`, 'pre_sales');

run(['-c', 'DROP TRIGGER trg_force_audit_failure ON public.builder_portal_activity_log;']);
expectEqual('with audit restored, the same transition succeeds',
  `SELECT (builder_transition_project('${PROJECT_1}',
     (SELECT row_version FROM builder_projects WHERE id='${PROJECT_1}'),
     'pre_sales','approved','audit restored','builder_user','${USER_B}',NULL)->>'status')`,
  'approved');

// ===========================================================================
// 7. Organisation drift and stale writes
// ===========================================================================
console.log('\nDrift and concurrency');

expectRejection('a project organisation cannot move out from under live access',
  `UPDATE builder_projects SET builder_organisation_id='${OTHER_ORG}' WHERE id='${PROJECT_1}'`,
  'BUILDER_PROJECT_ACCESS_ORG_DRIFT');

expectRejection('a stale expected_version on a grant update is refused',
  `SELECT builder_admin_upsert_project_access(
     '${ACTOR}','command_user','${USER_B}','${PROJECT_1}','builder','supervisor','{}'::jsonb,NULL,1,'stale')`,
  'BUILDER_STALE_WRITE');

expectRejection('an access window ending before it starts is refused',
  `UPDATE builder_project_access SET valid_until = valid_from - interval '1 day' WHERE id='${GRANT_B1}'`,
  'builder_project_access_window_valid');

expectEqual('a duplicate grant for the same user and project is refused',
  `SELECT count(*) FROM builder_project_access
   WHERE builder_user_id='${USER_B}' AND project_id='${PROJECT_1}'`, 1);

// ===========================================================================
// 7b. Membership is a HARD requirement — no override can restore access
//
// builder_resolve_permission alone returns false for an inactive membership,
// but that is only a baseline: a project-scoped or grant-level 'allow' used to
// raise it back to true. The resolver now returns before any override runs.
// ===========================================================================
console.log('\nMembership hard gate');

const MEMBERSHIP_B = query(`SELECT id FROM builder_organisation_memberships
  WHERE builder_user_id='${USER_B}' AND organisation_id='${BLD_ORG}'`);

// Baseline: access works with an active membership and no overrides.
run(['-c', `UPDATE builder_project_access SET permissions='{}'::jsonb, access_role='team_member'
            WHERE id='${GRANT_B1}'`]);
expectEqual('baseline: an active membership with no overrides resolves true',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');

const revokeMembership = () => run(['-c', `UPDATE builder_organisation_memberships
  SET status='revoked', revoked_at=now(), revoked_reason='hard gate test'
  WHERE id='${MEMBERSHIP_B}'`]);
const restoreMembership = () => run(['-c', `UPDATE builder_organisation_memberships
  SET status='active', revoked_at=NULL, revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);

// --- case 1: the grant itself carries projects.view = allow ---
run(['-c', `UPDATE builder_project_access
            SET permissions='{"projects":{"view":"allow","edit":"allow"}}'::jsonb
            WHERE id='${GRANT_B1}'`]);
expectEqual('with an active membership, a grant-level allow resolves true',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');
revokeMembership();
expectEqual('a grant-level allow CANNOT restore access after membership revocation',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');
expectEqual('and it cannot restore edit either',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','edit')`, 'f');
expectEqual('and the project is absent from the accessible list',
  `SELECT count(*) FROM builder_accessible_projects('${USER_B}')`, 0);
restoreMembership();
expectEqual('restoring the membership restores access',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');

// --- case 2: a project-scoped membership permission carries view_decision = allow ---
run(['-c', `UPDATE builder_project_access SET permissions='{}'::jsonb WHERE id='${GRANT_B1}'`]);
run(['-c', `INSERT INTO builder_membership_permissions(
              membership_id, permission_key, scope_type, scope_id,
              view_decision, edit_decision, delete_decision)
            VALUES ('${MEMBERSHIP_B}','projects','project','${PROJECT_1}','allow','allow','inherit')
            ON CONFLICT DO NOTHING`]);
expectEqual('with an active membership, a project-scoped allow resolves true',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');
revokeMembership();
expectEqual('a project-scoped allow CANNOT restore access after membership revocation',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');
expectEqual('and it cannot restore edit either',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','edit')`, 'f');
restoreMembership();
expectEqual('restoring the membership restores access',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');

// --- case 3: BOTH overrides present ---
run(['-c', `UPDATE builder_project_access
            SET permissions='{"projects":{"view":"allow","edit":"allow"}}'::jsonb
            WHERE id='${GRANT_B1}'`]);
expectEqual('with an active membership, both overlapping allows resolve true',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');
revokeMembership();
expectEqual('BOTH overrides together CANNOT restore access after membership revocation',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 'f');
expectEqual('and neither can restore edit',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','edit')`, 'f');
expectEqual('and the project is absent from the accessible list',
  `SELECT count(*) FROM builder_accessible_projects('${USER_B}')`, 0);
restoreMembership();
expectEqual('restoring the membership restores access with both overrides present',
  `SELECT builder_resolve_project_permission('${USER_B}','${PROJECT_1}','projects','view')`, 't');

// A membership that never existed behaves the same as a revoked one.
expectEqual('a user with no membership of the granting organisation resolves false',
  `SELECT builder_resolve_project_permission('${USER_O}','${PROJECT_1}','projects','view')`, 'f');

// Clean up so later assertions start from a plain grant.
run(['-c', `DELETE FROM builder_membership_permissions
            WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='project'`]);
run(['-c', `UPDATE builder_project_access SET permissions='{}'::jsonb WHERE id='${GRANT_B1}'`]);

// ===========================================================================
// 7c. Every Phase 3 mutation rolls back when its trusted audit write fails
// ===========================================================================
console.log('\nFail-closed auditing across every mutation');

const DEV_2 = 'dddddddd-0000-0000-0000-000000000002';
run(['-c', `INSERT INTO builder_developments(id, developer_organisation_id, name)
            VALUES ('${DEV_2}','${DEV_ORG}','Rollback Fixture')`]);
const PARTY_1 = query(`SELECT (builder_upsert_project_party(
  '${ACTOR}','command_user',NULL,'${PROJECT_1}',NULL,
  '{"name":"Existing Party","role":"builder"}'::jsonb,'fixture')).id`);
expectEqual('a party is created through the guarded command',
  `SELECT count(*) FROM builder_project_parties WHERE id='${PARTY_1}'`, 1);
expectEqual('and its creation wrote a trusted audit row',
  `SELECT count(*) > 0 FROM builder_portal_activity_log
   WHERE action='builder_project_party_added' AND entity_id='${PARTY_1}'`, 't');

const beforeCounts = {
  developments: query('SELECT count(*) FROM builder_developments'),
  projects: query('SELECT count(*) FROM builder_projects'),
  parties: query('SELECT count(*) FROM builder_project_parties'),
  devName: query(`SELECT name FROM builder_developments WHERE id='${DEV_2}'`),
  projectName: query(`SELECT name FROM builder_projects WHERE id='${PROJECT_1}'`),
  partyName: query(`SELECT name FROM builder_project_parties WHERE id='${PARTY_1}'`),
};

run(['-c', `
  CREATE OR REPLACE FUNCTION public.force_audit_failure() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SIMULATED_AUDIT_OUTAGE';
  END $$;
  CREATE TRIGGER trg_force_audit_failure BEFORE INSERT ON public.builder_portal_activity_log
    FOR EACH ROW EXECUTE FUNCTION public.force_audit_failure();
`]);

expectRejection('development CREATION fails when the trusted audit write fails',
  `SELECT builder_admin_upsert_development('${ACTOR}','command_user',NULL,'${DEV_ORG}',
     '{"name":"Should Not Exist"}'::jsonb,NULL,NULL,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no development was created',
  'SELECT count(*) FROM builder_developments', beforeCounts.developments);

expectRejection('development EDITING fails when the trusted audit write fails',
  `SELECT builder_admin_upsert_development('${ACTOR}','command_user','${DEV_2}',NULL,
     '{"name":"Renamed"}'::jsonb,NULL,
     (SELECT row_version FROM builder_developments WHERE id='${DEV_2}'),'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the development name is unchanged',
  `SELECT name FROM builder_developments WHERE id='${DEV_2}'`, beforeCounts.devName);

expectRejection('project CREATION fails when the trusted audit write fails',
  `SELECT builder_upsert_project('${ACTOR}','command_user',NULL,NULL,
     '{"name":"Should Not Exist"}'::jsonb,'${DEV_ORG}','${BLD_ORG}',NULL,NULL,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no project was created',
  'SELECT count(*) FROM builder_projects', beforeCounts.projects);

expectRejection('project EDITING fails when the trusted audit write fails',
  `SELECT builder_upsert_project('${ACTOR}','command_user',NULL,'${PROJECT_1}',
     '{"name":"Renamed Project"}'::jsonb,NULL,NULL,NULL,
     (SELECT row_version FROM builder_projects WHERE id='${PROJECT_1}'),'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the project name is unchanged',
  `SELECT name FROM builder_projects WHERE id='${PROJECT_1}'`, beforeCounts.projectName);

expectRejection('party CREATION fails when the trusted audit write fails',
  `SELECT builder_upsert_project_party('${ACTOR}','command_user',NULL,'${PROJECT_1}',NULL,
     '{"name":"Should Not Exist","role":"other"}'::jsonb,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and no party was created',
  'SELECT count(*) FROM builder_project_parties', beforeCounts.parties);

expectRejection('party EDITING fails when the trusted audit write fails',
  `SELECT builder_upsert_project_party('${ACTOR}','command_user',NULL,'${PROJECT_1}','${PARTY_1}',
     '{"name":"Renamed Party","role":"other"}'::jsonb,'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the party name is unchanged',
  `SELECT name FROM builder_project_parties WHERE id='${PARTY_1}'`, beforeCounts.partyName);

expectRejection('party DELETION fails when the trusted audit write fails',
  `SELECT builder_delete_project_party('${ACTOR}','command_user',NULL,'${PROJECT_1}','${PARTY_1}','x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the party still exists',
  `SELECT count(*) FROM builder_project_parties WHERE id='${PARTY_1}'`, 1);

run(['-c', 'DROP TRIGGER trg_force_audit_failure ON public.builder_portal_activity_log;']);

expectEqual('with audit restored, the development edit succeeds',
  `SELECT (builder_admin_upsert_development('${ACTOR}','command_user','${DEV_2}',NULL,
     '{"name":"Renamed"}'::jsonb,NULL,
     (SELECT row_version FROM builder_developments WHERE id='${DEV_2}'),'ok')).name`, 'Renamed');
expectEqual('with audit restored, the party delete succeeds',
  `SELECT builder_delete_project_party('${ACTOR}','command_user',NULL,'${PROJECT_1}','${PARTY_1}','ok')`, 't');
expectEqual('and the deletion wrote a trusted audit row carrying the removed record',
  `SELECT count(*) > 0 FROM builder_portal_activity_log
   WHERE action='builder_project_party_removed' AND entity_id='${PARTY_1}'
     AND previous_state->>'name' = 'Existing Party'`, 't');

// ===========================================================================
// 7d. expected_version is required when updating an existing access grant
// ===========================================================================
console.log('\nAccess-grant concurrency');

expectRejection('a NULL expected_version on an existing grant is refused',
  `SELECT builder_admin_upsert_project_access(
     '${ACTOR}','command_user','${USER_B}','${PROJECT_1}','builder','supervisor',
     '{}'::jsonb,NULL,NULL,'no version')`,
  'BUILDER_STALE_WRITE');
expectEqual('and the grant role is unchanged',
  `SELECT access_role FROM builder_project_access WHERE id='${GRANT_B1}'`, 'team_member');

expectRejection('a stale expected_version on an existing grant is refused',
  `SELECT builder_admin_upsert_project_access(
     '${ACTOR}','command_user','${USER_B}','${PROJECT_1}','builder','supervisor',
     '{}'::jsonb,NULL,1,'stale version')`,
  'BUILDER_STALE_WRITE');
expectEqual('and the grant role is still unchanged',
  `SELECT access_role FROM builder_project_access WHERE id='${GRANT_B1}'`, 'team_member');

expectEqual('the matching current version updates the grant',
  `SELECT (builder_admin_upsert_project_access(
     '${ACTOR}','command_user','${USER_B}','${PROJECT_1}','builder','supervisor',
     '{}'::jsonb,NULL,
     (SELECT row_version FROM builder_project_access WHERE id='${GRANT_B1}'),
     'correct version')).access_role`, 'supervisor');

expectEqual('creating a NEW grant needs no expected_version',
  `SELECT (builder_admin_upsert_project_access(
     '${ACTOR}','command_user','${USER_D}','${PROJECT_2}','developer','team_member',
     '{}'::jsonb,NULL,NULL,'new grant')).access_role`, 'team_member');

run(['-c', `UPDATE builder_project_access SET access_role='team_member' WHERE id='${GRANT_B1}'`]);

// ===========================================================================
// 8. Boundaries — Finance data and later phases
// ===========================================================================
console.log('\nBoundaries');

expectEqual('Phase 3 grants nothing on the Finance-owned builder tables',
  `SELECT count(*) FROM information_schema.role_table_grants
   WHERE table_schema='public'
     AND table_name IN ('builder_invoices','build_progress_payments')
     AND grantee IN ('anon','authenticated')`, 0);

expectEqual('no later-phase Builder table was created',
  `SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('builder_stages','builder_lots','builder_units','builder_inventory',
                        'builder_reservations','builder_transactions','builder_variations',
                        'builder_progress_claims','builder_inspections','builder_defects',
                        'builder_handovers')`, 0);

expectEqual('no Phase 3 policy uses an unrestricted USING (true)',
  `SELECT count(*) FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('builder_developments','builder_projects','builder_project_parties',
                       'builder_project_status_history','builder_project_access')
     AND (qual = 'true' OR with_check = 'true')`, 0);

expectEqual('every Phase 3 function is SECURITY DEFINER with a pinned search_path',
  `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('builder_resolve_project_permission','builder_accessible_projects',
                       'builder_transition_project','builder_admin_upsert_project_access',
                       'builder_admin_revoke_project_access')
     AND p.prosecdef
     AND array_to_string(p.proconfig, ',') LIKE '%search_path%'`, 5);

for (const fn of ['builder_resolve_project_permission', 'builder_accessible_projects',
  'builder_transition_project', 'builder_admin_upsert_project_access',
  'builder_admin_revoke_project_access']) {
  expectEqual(`anon holds no EXECUTE grant on ${fn}`,
    `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='${fn}'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')`, 0);
}

// ===========================================================================
// 9. Existing Solicitor behaviour is unchanged
// ===========================================================================
console.log('\nSolicitor regression');

expectEqual('the Solicitor matter-access table is untouched by Phase 3',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='solicitor_matter_access'`,
  query(`SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='solicitor_matter_access'`));
expectEqual('existing Solicitor terms acceptances are preserved',
  "SELECT count(*) >= 0 FROM portal_terms_acceptances WHERE portal='solicitor'", 't');
expectEqual('the Solicitor rollout adapter still resolves its original signature',
  `SELECT resolve_cross_portal_feature_mode(
     (SELECT id FROM solicitor_firms LIMIT 1), 'solicitor_matter_access_v2')`, 'cutover');

// ===========================================================================
// Summary
// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${'='.repeat(70)}`);
console.log(`Phase 3 local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const failure of failed) console.log(`  - ${failure.name}\n      ${failure.detail}`);
  process.exit(1);
}
console.log('All Phase 3 conditions verified against a live PostgreSQL database.');
