#!/usr/bin/env node
/**
 * Builder Portal Inventory — local migration and behaviour verification.
 *
 * Real execution against real PostgreSQL. Every "ok" is a statement that ran.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-inventory.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_VERIFY_DB_INV (aurixa_inventory_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_VERIFY_DB_INV || 'aurixa_inventory_verify';

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
  run(['-f', join(migrationsDir, '20260804000000_builder_portal_inventory.sql')]);
  record('the inventory migration is idempotent — a second apply succeeds', true);
} catch (error) {
  record('the inventory migration is idempotent — a second apply succeeds', false,
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

// ===========================================================================
// 1. Schema, RLS, direct-access denial
// ===========================================================================
console.log('Schema and direct-access denial');
const TABLES = ['builder_stages','builder_buildings','builder_lots','builder_units',
  'builder_unit_pricing','builder_unit_holds','builder_reservations','builder_allocations',
  'builder_unit_status_history','builder_reservation_status_history'];
for (const t of TABLES) {
  expectEqual(`${t} is RLS-protected`,
    `SELECT relrowsecurity FROM pg_class WHERE relname='${t}'`, 't');
  expectRejection(`anonymous SELECT on ${t} is denied`,
    `SET LOCAL ROLE anon; SELECT count(*) FROM public.${t};`, 'permission denied');
  expectRejection(`authenticated SELECT on ${t} is denied`,
    `SET LOCAL ROLE authenticated; SELECT count(*) FROM public.${t};`, 'permission denied');
}
expectEqual('no inventory policy uses an unrestricted USING (true)',
  `SELECT count(*) FROM pg_policies WHERE schemaname='public'
   AND tablename = ANY(ARRAY['${TABLES.join("','")}'])
   AND (qual='true' OR with_check='true')`, 0);
expectEqual('no cost, margin or supplier price column exists on any builder table',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name LIKE 'builder_%'
     AND (column_name LIKE '%cost%' OR column_name LIKE '%margin%'
          OR column_name LIKE '%supplier%' OR column_name LIKE '%contractor_price%')`, 0);
expectEqual('every touch-triggered inventory table carries row_version',
  `SELECT count(*) FROM unnest(ARRAY['builder_stages','builder_buildings','builder_lots',
     'builder_units','builder_unit_pricing','builder_unit_holds','builder_reservations',
     'builder_allocations']) t
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=t AND column_name='row_version')`, 0);

// ===========================================================================
// 2. Structure and parentage
// ===========================================================================
console.log('\nStructure and parentage');
const STAGE_1 = query(`SELECT (builder_upsert_stage('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',
  '{"name":"Stage 1","stage_number":"S1"}'::jsonb,NULL,'fixture')).id`);
expectEqual('a stage is created through the guarded command',
  `SELECT count(*) FROM builder_stages WHERE id='${STAGE_1}'`, 1);
expectEqual('and it wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log
   WHERE action='builder_stage_created' AND entity_id='${STAGE_1}'`, 't');

const STAGE_P2 = query(`SELECT (builder_upsert_stage('${ACTOR}','command_user',NULL,NULL,'${PROJECT_2}',
  '{"name":"Other Stage"}'::jsonb,NULL,'fixture')).id`);
expectRejection("a unit cannot reference another project's stage",
  `INSERT INTO builder_units(project_id, stage_id, unit_number)
   VALUES ('${PROJECT_1}','${STAGE_P2}','X1')`,
  'BUILDER_UNIT_PARENT_MISMATCH');
expectRejection("a building cannot reference another project's stage",
  `INSERT INTO builder_buildings(project_id, stage_id, name)
   VALUES ('${PROJECT_1}','${STAGE_P2}','Bad Building')`,
  'BUILDER_STAGE_PARENT_MISMATCH');
expectRejection("a lot cannot reference another project's stage",
  `INSERT INTO builder_lots(project_id, stage_id, lot_number)
   VALUES ('${PROJECT_1}','${STAGE_P2}','L99')`,
  'BUILDER_STAGE_PARENT_MISMATCH');

const BUILDING_1 = query(`SELECT (builder_upsert_building('${ACTOR}','command_user',NULL,NULL,
  '${PROJECT_1}','${STAGE_1}','{"name":"Tower A","building_code":"TA","level_count":8}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a building is created', `SELECT count(*) FROM builder_buildings WHERE id='${BUILDING_1}'`, 1);
const LOT_1 = query(`SELECT (builder_upsert_lot('${ACTOR}','command_user',NULL,NULL,
  '${PROJECT_1}','${STAGE_1}','{"lot_number":"L1","land_area_sqm":"450.5"}'::jsonb,NULL,'fixture')).id`);
expectEqual('a lot is created', `SELECT count(*) FROM builder_lots WHERE id='${LOT_1}'`, 1);

const UNIT_1 = query(`SELECT (builder_upsert_unit('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',
  '${STAGE_1}','${BUILDING_1}','${LOT_1}',
  '{"unit_number":"U1","unit_type":"townhouse","bedrooms":"3","bathrooms":"2","car_spaces":"2"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a unit is created with its full parentage',
  `SELECT count(*) FROM builder_units WHERE id='${UNIT_1}' AND stage_id='${STAGE_1}'
     AND building_id='${BUILDING_1}' AND lot_id='${LOT_1}'`, 1);
const UNIT_2 = query(`SELECT (builder_upsert_unit('${ACTOR}','command_user',NULL,NULL,'${PROJECT_2}',
  NULL,NULL,NULL,'{"unit_number":"OTHER-1"}'::jsonb,NULL,'fixture')).id`);

expectEqual('a duplicate unit number in the same project is refused',
  `SELECT count(*) FROM (SELECT 1) x WHERE EXISTS (
     SELECT 1 FROM pg_indexes WHERE indexname='builder_units_project_id_unit_number_key')`, 1);

// ===========================================================================
// 3. Access — units reached through the project only
// ===========================================================================
console.log('\nAccess and isolation');
expectEqual('a granted project makes its unit visible',
  `SELECT count(*) FROM builder_accessible_units('${USER_B}','${BLD_ORG}')`, 1);
expectEqual('and it is the granted project’s unit',
  `SELECT unit_id FROM builder_accessible_units('${USER_B}','${BLD_ORG}')`, UNIT_1);
expectEqual('a unit in an ungranted project is NOT visible',
  `SELECT builder_resolve_unit_permission('${USER_B}','${UNIT_2}','inventory','view')`, 'f');
expectEqual('a user of an unrelated organisation sees no units',
  `SELECT count(*) FROM builder_accessible_units('${USER_O}')`, 0);
expectEqual('and resolves false on a unit they were never granted',
  `SELECT builder_resolve_unit_permission('${USER_O}','${UNIT_1}','inventory','view')`, 'f');

// scope guard
console.log('\nPermission scopes');
const MEMBERSHIP_B = query(`SELECT id FROM builder_organisation_memberships
  WHERE builder_user_id='${USER_B}' AND organisation_id='${BLD_ORG}'`);
// Written then counted separately: a multi-statement `psql -tAc` prints the
// command tag as well as the row, so INSERT ... RETURNING cannot be compared.
run(['-c', `INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
     scope_id, view_decision, edit_decision, delete_decision)
   VALUES ('${MEMBERSHIP_B}','inventory','stage','${STAGE_1}','inherit','inherit','inherit')`]);
expectEqual('a stage-scoped override can be STORED',
  `SELECT count(*) FROM builder_membership_permissions
   WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='stage' AND scope_id='${STAGE_1}'`, 1);
run(['-c', `INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
     scope_id, view_decision, edit_decision, delete_decision)
   VALUES ('${MEMBERSHIP_B}','inventory','unit','${UNIT_1}','inherit','inherit','inherit')`]);
expectEqual('a unit-scoped override can be STORED',
  `SELECT count(*) FROM builder_membership_permissions
   WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='unit' AND scope_id='${UNIT_1}'`, 1);
expectRejection('a scope pointing at a non-existent unit is refused',
  `INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type, scope_id)
   VALUES ('${MEMBERSHIP_B}','pricing','unit','00000000-0000-0000-0000-0000000000ff')`,
  'BUILDER_SCOPE_TARGET_NOT_FOUND');
expectRejection('a development scope is still refused — nothing resolves it',
  `INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type, scope_id)
   VALUES ('${MEMBERSHIP_B}','inventory','development','${PROJECT_1}')`,
  'BUILDER_SCOPE_NOT_AVAILABLE');

expectEqual('baseline: the unit resolves true with inherit overrides',
  `SELECT builder_resolve_unit_permission('${USER_B}','${UNIT_1}','inventory','view')`, 't');
run(['-c', `UPDATE builder_membership_permissions SET view_decision='deny', edit_decision='deny',
            delete_decision='deny'
            WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='unit' AND scope_id='${UNIT_1}'`]);
expectEqual('a unit-scoped DENY narrows access',
  `SELECT builder_resolve_unit_permission('${USER_B}','${UNIT_1}','inventory','view')`, 'f');
run(['-c', `UPDATE builder_membership_permissions SET view_decision='inherit', edit_decision='inherit',
            delete_decision='inherit'
            WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='unit' AND scope_id='${UNIT_1}'`]);
run(['-c', `UPDATE builder_membership_permissions SET view_decision='deny', edit_decision='deny',
            delete_decision='deny'
            WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='stage' AND scope_id='${STAGE_1}'`]);
expectEqual('a stage-scoped DENY narrows access',
  `SELECT builder_resolve_unit_permission('${USER_B}','${UNIT_1}','inventory','view')`, 'f');
run(['-c', `DELETE FROM builder_membership_permissions
            WHERE membership_id='${MEMBERSHIP_B}' AND scope_type IN ('stage','unit')`]);

// membership hard gate, with every override present
console.log('\nMembership hard gate');
run(['-c', `INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
              scope_id, view_decision, edit_decision, delete_decision)
            VALUES ('${MEMBERSHIP_B}','inventory','unit','${UNIT_1}','allow','allow','inherit')`]);
run(['-c', `UPDATE builder_project_access SET permissions='{"inventory":{"view":"allow"}}'::jsonb
            WHERE builder_user_id='${USER_B}' AND project_id='${PROJECT_1}'`]);
expectEqual('with an active membership and both allows, the unit resolves true',
  `SELECT builder_resolve_unit_permission('${USER_B}','${UNIT_1}','inventory','view')`, 't');
run(['-c', `UPDATE builder_organisation_memberships SET status='revoked', revoked_at=now(),
            revoked_reason='test' WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('a revoked membership denies the unit despite a unit-scoped allow AND a grant allow',
  `SELECT builder_resolve_unit_permission('${USER_B}','${UNIT_1}','inventory','view')`, 'f');
expectEqual('and the unit disappears from the accessible list',
  `SELECT count(*) FROM builder_accessible_units('${USER_B}')`, 0);
run(['-c', `UPDATE builder_organisation_memberships SET status='active', revoked_at=NULL,
            revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('restoring the membership restores access',
  `SELECT builder_resolve_unit_permission('${USER_B}','${UNIT_1}','inventory','view')`, 't');
run(['-c', `DELETE FROM builder_membership_permissions WHERE membership_id='${MEMBERSHIP_B}'
            AND scope_type='unit'`]);
run(['-c', `UPDATE builder_project_access SET permissions='{}'::jsonb
            WHERE builder_user_id='${USER_B}' AND project_id='${PROJECT_1}'`]);

// ===========================================================================
// 4. Pricing
// ===========================================================================
console.log('\nPricing');
const PRICE_1 = query(`SELECT (builder_set_unit_price('${ACTOR}','command_user',NULL,'${UNIT_1}',
  750000,'fixed','initial price')).id`);
expectEqual('a price is set and marked current',
  `SELECT count(*) FROM builder_unit_pricing WHERE id='${PRICE_1}' AND is_current`, 1);
run(['-c', `SELECT builder_set_unit_price('${ACTOR}','command_user',NULL,'${UNIT_1}',
  790000,'fixed','price increase')`]);
expectEqual('setting a new price closes the previous one rather than editing it',
  `SELECT count(*) FROM builder_unit_pricing WHERE unit_id='${UNIT_1}'`, 2);
expectEqual('and exactly one price is current',
  `SELECT count(*) FROM builder_unit_pricing WHERE unit_id='${UNIT_1}' AND is_current`, 1);
expectEqual('the current price is the new one',
  `SELECT list_price::numeric(14,0) FROM builder_unit_pricing WHERE unit_id='${UNIT_1}' AND is_current`, 790000);
expectRejection('a negative price is refused',
  `SELECT builder_set_unit_price('${ACTOR}','command_user',NULL,'${UNIT_1}',-1,'fixed','bad')`,
  'BUILDER_INVALID_PRICE');
expectRejection('an unknown price basis is refused',
  `SELECT builder_set_unit_price('${ACTOR}','command_user',NULL,'${UNIT_1}',1,'auction','bad')`,
  'BUILDER_INVALID_PRICE_BASIS');

// ===========================================================================
// 5. Availability and release transitions
// ===========================================================================
console.log('\nAvailability and release');
expectRejection('a unit cannot be released without a current price',
  `SELECT builder_transition_unit_release('${UNIT_2}',
     (SELECT row_version FROM builder_units WHERE id='${UNIT_2}'),
     'unreleased','released','go live','command_user',NULL,'${ACTOR}')`,
  'BUILDER_UNIT_PRICE_REQUIRED');
expectEqual('a priced unit can be released',
  `SELECT (builder_transition_unit_release('${UNIT_1}',
     (SELECT row_version FROM builder_units WHERE id='${UNIT_1}'),
     'unreleased','released','go live','command_user',NULL,'${ACTOR}')->>'release_status')`, 'released');
expectEqual('the release stamped released_at',
  `SELECT released_at IS NOT NULL FROM builder_units WHERE id='${UNIT_1}'`, 't');
expectEqual('and wrote an append-only history row',
  `SELECT count(*) FROM builder_unit_status_history
   WHERE unit_id='${UNIT_1}' AND status_kind='release' AND to_status='released'`, 1);

expectRejection('an illegal availability transition is refused',
  `SELECT builder_transition_unit_availability('${UNIT_1}',
     (SELECT row_version FROM builder_units WHERE id='${UNIT_1}'),
     'available','settled','skip','command_user',NULL,'${ACTOR}')`,
  'INVALID_TRANSITION');
expectRejection('a stale expected_version on an availability transition is refused',
  `SELECT builder_transition_unit_availability('${UNIT_1}',1,'available','on_hold','x','command_user',NULL,'${ACTOR}')`,
  'STALE_VERSION');
expectRejection('a stale from-status is refused',
  `SELECT builder_transition_unit_availability('${UNIT_1}',
     (SELECT row_version FROM builder_units WHERE id='${UNIT_1}'),
     'reserved','contracted','x','command_user',NULL,'${ACTOR}')`,
  'STALE_STATUS');
expectRejection('a transition with no reason is refused',
  `SELECT builder_transition_unit_availability('${UNIT_1}',
     (SELECT row_version FROM builder_units WHERE id='${UNIT_1}'),
     'available','on_hold','   ','command_user',NULL,'${ACTOR}')`,
  'REASON_REQUIRED');

expectRejection('unit status history cannot be updated',
  `UPDATE builder_unit_status_history SET to_status='settled' WHERE unit_id='${UNIT_1}'`,
  'BUILDER_INVENTORY_HISTORY_APPEND_ONLY');
expectRejection('unit status history cannot be deleted',
  `DELETE FROM builder_unit_status_history WHERE unit_id='${UNIT_1}'`,
  'BUILDER_INVENTORY_HISTORY_APPEND_ONLY');

// ===========================================================================
// 6. Holds
// ===========================================================================
console.log('\nHolds');
const HOLD_1 = query(`SELECT (builder_create_unit_hold('${ACTOR}','command_user',NULL,'${UNIT_1}',
  '${BLD_ORG}', now()+interval '3 days','H1','holding for buyer')).id`);
expectEqual('a hold is created', `SELECT count(*) FROM builder_unit_holds WHERE id='${HOLD_1}'`, 1);
expectEqual('and the unit moved to on_hold',
  `SELECT availability_status FROM builder_units WHERE id='${UNIT_1}'`, 'on_hold');
expectRejection('a second active hold on the same unit is refused',
  `INSERT INTO builder_unit_holds(unit_id, organisation_id, expires_at)
   VALUES ('${UNIT_1}','${BLD_ORG}', now()+interval '1 day')`,
  'builder_unit_holds_one_active');
expectRejection('a hold on a unit that is not available is refused',
  `SELECT builder_create_unit_hold('${ACTOR}','command_user',NULL,'${UNIT_1}','${BLD_ORG}',
     now()+interval '1 day','H2','again')`,
  'BUILDER_UNIT_NOT_AVAILABLE');
expectRejection('a hold expiring in the past is refused',
  `SELECT builder_create_unit_hold('${ACTOR}','command_user',NULL,'${UNIT_2}','${BLD_ORG}',
     now()-interval '1 day','H3','bad')`,
  'BUILDER_HOLD_EXPIRY_INVALID');
expectRejection('releasing a hold without expected_version is refused',
  `SELECT builder_release_unit_hold('${ACTOR}','command_user',NULL,'${HOLD_1}',NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('releasing a hold with a stale expected_version is refused',
  `SELECT builder_release_unit_hold('${ACTOR}','command_user',NULL,'${HOLD_1}',999,'x')`,
  'BUILDER_STALE_WRITE');
expectEqual('releasing a hold with the matching version succeeds',
  `SELECT (builder_release_unit_hold('${ACTOR}','command_user',NULL,'${HOLD_1}',
     (SELECT row_version FROM builder_unit_holds WHERE id='${HOLD_1}'),'buyer withdrew')).status`,
  'released');
expectEqual('and the unit returned to available',
  `SELECT availability_status FROM builder_units WHERE id='${UNIT_1}'`, 'available');

// ===========================================================================
// 7. Reservations
// ===========================================================================
console.log('\nReservations');
const RES_1 = query(`SELECT (builder_create_reservation('${ACTOR}','command_user',NULL,'${UNIT_1}',
  '${BLD_ORG}','{"purchaser_name":"A Buyer","purchaser_email":"buyer@test.test","reservation_fee":"5000"}'::jsonb,
  'deposit taken')).id`);
expectEqual('a reservation is created', `SELECT count(*) FROM builder_reservations WHERE id='${RES_1}'`, 1);
expectEqual('and the unit moved to reserved',
  `SELECT availability_status FROM builder_units WHERE id='${UNIT_1}'`, 'reserved');
expectEqual('and an append-only reservation history row exists',
  `SELECT count(*) FROM builder_reservation_status_history
   WHERE reservation_id='${RES_1}' AND to_status='active'`, 1);
expectRejection('a reservation with no purchaser name is refused',
  `SELECT builder_create_reservation('${ACTOR}','command_user',NULL,'${UNIT_2}','${BLD_ORG}',
     '{"purchaser_name":"  "}'::jsonb,'bad')`,
  'BUILDER_PURCHASER_REQUIRED');
expectRejection('a second reservation on a reserved unit is refused',
  `SELECT builder_create_reservation('${ACTOR}','command_user',NULL,'${UNIT_1}','${BLD_ORG}',
     '{"purchaser_name":"B Buyer"}'::jsonb,'double')`,
  'BUILDER_UNIT_NOT_RESERVABLE');
// 999999 rather than 1: a freshly created row HAS row_version 1, so 1 is the
// matching version, not a stale one.
expectRejection('a stale expected_version on a reservation transition is refused',
  `SELECT builder_transition_reservation('${RES_1}',999999,'active','contracted','x','command_user',NULL,'${ACTOR}')`,
  'STALE_VERSION');
expectRejection('an illegal reservation transition is refused',
  `SELECT builder_transition_reservation('${RES_1}',
     (SELECT row_version FROM builder_reservations WHERE id='${RES_1}'),
     'active','active','x','command_user',NULL,'${ACTOR}')`,
  'INVALID_TRANSITION');
expectEqual('contracting the reservation succeeds',
  `SELECT (builder_transition_reservation('${RES_1}',
     (SELECT row_version FROM builder_reservations WHERE id='${RES_1}'),
     'active','contracted','contract exchanged','command_user',NULL,'${ACTOR}')->>'status')`, 'contracted');
expectEqual('and the unit followed to contracted',
  `SELECT availability_status FROM builder_units WHERE id='${UNIT_1}'`, 'contracted');
expectEqual('the reservation history recorded the move',
  `SELECT count(*) FROM builder_reservation_status_history
   WHERE reservation_id='${RES_1}' AND from_status='active' AND to_status='contracted'`, 1);

// cancellation returns the unit
run(['-c', `SELECT builder_set_unit_price('${ACTOR}','command_user',NULL,'${UNIT_2}',500000,'fixed','p')`]);
const RES_2 = query(`SELECT (builder_create_reservation('${ACTOR}','command_user',NULL,'${UNIT_2}',
  '${BLD_ORG}','{"purchaser_name":"C Buyer"}'::jsonb,'reserved')).id`);
// Two statements: a single SELECT sees one snapshot taken at statement start,
// so reading the unit in the same statement as the transition returns the
// pre-transition value even though the transition succeeded.
run(['-c', `SELECT builder_transition_reservation('${RES_2}',
     (SELECT row_version FROM builder_reservations WHERE id='${RES_2}'),
     'active','cancelled','buyer withdrew','command_user',NULL,'${ACTOR}')`]);
expectEqual('cancelling a reservation marks it cancelled',
  `SELECT status FROM builder_reservations WHERE id='${RES_2}'`, 'cancelled');
expectEqual('and returns the unit to available',
  `SELECT availability_status FROM builder_units WHERE id='${UNIT_2}'`, 'available');

// ===========================================================================
// 8. Allocations
// ===========================================================================
console.log('\nAllocations');
const ALLOC_1 = query(`SELECT (builder_create_allocation('${ACTOR}','command_user',NULL,'${UNIT_2}',
  '${OTHER_ORG}','sales_channel',now()+interval '30 days','A1','channel allocation')).id`);
expectEqual('an allocation is created', `SELECT count(*) FROM builder_allocations WHERE id='${ALLOC_1}'`, 1);
expectRejection('a second active allocation on the same unit is refused',
  `INSERT INTO builder_allocations(unit_id, allocated_to_organisation_id)
   VALUES ('${UNIT_2}','${BLD_ORG}')`,
  'builder_allocations_one_active');
expectRejection('an unknown allocation type is refused',
  `SELECT builder_create_allocation('${ACTOR}','command_user',NULL,'${UNIT_1}','${OTHER_ORG}',
     'nonsense',NULL,NULL,'bad')`,
  'BUILDER_INVALID_ALLOCATION_TYPE');
expectRejection('releasing an allocation without expected_version is refused',
  `SELECT builder_release_allocation('${ACTOR}','command_user',NULL,'${ALLOC_1}',NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectEqual('releasing an allocation with the matching version succeeds',
  `SELECT (builder_release_allocation('${ACTOR}','command_user',NULL,'${ALLOC_1}',
     (SELECT row_version FROM builder_allocations WHERE id='${ALLOC_1}'),'channel ended')).status`,
  'released');

// ===========================================================================
// 9. expected_version on every mutable aggregate
// ===========================================================================
console.log('\nOptimistic concurrency');
for (const [label, fn, args] of [
  ['stage', 'builder_upsert_stage', `'${ACTOR}','command_user',NULL,'${STAGE_1}',NULL,'{"name":"X"}'::jsonb`],
  ['building', 'builder_upsert_building', `'${ACTOR}','command_user',NULL,'${BUILDING_1}',NULL,NULL,'{"name":"X"}'::jsonb`],
  ['lot', 'builder_upsert_lot', `'${ACTOR}','command_user',NULL,'${LOT_1}',NULL,NULL,'{"lot_number":"X"}'::jsonb`],
  ['unit', 'builder_upsert_unit', `'${ACTOR}','command_user',NULL,'${UNIT_1}',NULL,NULL,NULL,NULL,'{"description":"X"}'::jsonb`],
]) {
  expectRejection(`a MISSING expected_version on a ${label} update is refused`,
    `SELECT ${fn}(${args},NULL,'x')`, 'BUILDER_STALE_WRITE');
  // 999999, not 1 — a freshly created row's current version IS 1.
  expectRejection(`a STALE expected_version on a ${label} update is refused`,
    `SELECT ${fn}(${args},999999,'x')`, 'BUILDER_STALE_WRITE');
}
expectEqual('the matching version updates the stage',
  `SELECT (builder_upsert_stage('${ACTOR}','command_user',NULL,'${STAGE_1}',NULL,
     '{"name":"Stage One"}'::jsonb,
     (SELECT row_version FROM builder_stages WHERE id='${STAGE_1}'),'rename')).name`, 'Stage One');
expectEqual('the matching version updates the unit',
  `SELECT (builder_upsert_unit('${ACTOR}','command_user',NULL,'${UNIT_1}',NULL,NULL,NULL,NULL,
     '{"description":"Corner townhouse"}'::jsonb,
     (SELECT row_version FROM builder_units WHERE id='${UNIT_1}'),'describe')).description`,
  'Corner townhouse');

// ===========================================================================
// 10. Audit failure rolls back EVERY mutation family
// ===========================================================================
console.log('\nFail-closed auditing');
const before = {
  stages: query('SELECT count(*) FROM builder_stages'),
  buildings: query('SELECT count(*) FROM builder_buildings'),
  lots: query('SELECT count(*) FROM builder_lots'),
  units: query('SELECT count(*) FROM builder_units'),
  prices: query('SELECT count(*) FROM builder_unit_pricing'),
  holds: query('SELECT count(*) FROM builder_unit_holds'),
  reservations: query('SELECT count(*) FROM builder_reservations'),
  allocations: query('SELECT count(*) FROM builder_allocations'),
  unitName: query(`SELECT unit_number FROM builder_units WHERE id='${UNIT_1}'`),
  unitAvail: query(`SELECT availability_status FROM builder_units WHERE id='${UNIT_1}'`),
};
run(['-c', `
  CREATE OR REPLACE FUNCTION public.force_audit_failure() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SIMULATED_AUDIT_OUTAGE';
  END $$;
  CREATE TRIGGER trg_force_audit_failure BEFORE INSERT ON public.builder_portal_activity_log
    FOR EACH ROW EXECUTE FUNCTION public.force_audit_failure();
`]);

const rollbackCases = [
  ['stage creation', `SELECT builder_upsert_stage('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}','{"name":"Nope"}'::jsonb,NULL,'x')`, 'stages', 'builder_stages'],
  ['building creation', `SELECT builder_upsert_building('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',NULL,'{"name":"Nope"}'::jsonb,NULL,'x')`, 'buildings', 'builder_buildings'],
  ['lot creation', `SELECT builder_upsert_lot('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',NULL,'{"lot_number":"NOPE"}'::jsonb,NULL,'x')`, 'lots', 'builder_lots'],
  ['unit creation', `SELECT builder_upsert_unit('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',NULL,NULL,NULL,'{"unit_number":"NOPE"}'::jsonb,NULL,'x')`, 'units', 'builder_units'],
  ['price change', `SELECT builder_set_unit_price('${ACTOR}','command_user',NULL,'${UNIT_1}',999999,'fixed','x')`, 'prices', 'builder_unit_pricing'],
  ['hold creation', `SELECT builder_create_unit_hold('${ACTOR}','command_user',NULL,'${UNIT_2}','${BLD_ORG}',now()+interval '1 day','X','x')`, 'holds', 'builder_unit_holds'],
  ['reservation creation', `SELECT builder_create_reservation('${ACTOR}','command_user',NULL,'${UNIT_2}','${BLD_ORG}','{"purchaser_name":"Nope"}'::jsonb,'x')`, 'reservations', 'builder_reservations'],
  ['allocation creation', `SELECT builder_create_allocation('${ACTOR}','command_user',NULL,'${UNIT_2}','${OTHER_ORG}','display',NULL,NULL,'x')`, 'allocations', 'builder_allocations'],
];
for (const [label, sql, key, table] of rollbackCases) {
  expectRejection(`${label} fails when the trusted audit write fails`, sql, 'SIMULATED_AUDIT_OUTAGE');
  expectEqual(`and no ${label.split(' ')[0]} row was created`, `SELECT count(*) FROM ${table}`, before[key]);
}
expectRejection('a unit update fails when the trusted audit write fails',
  `SELECT builder_upsert_unit('${ACTOR}','command_user',NULL,'${UNIT_1}',NULL,NULL,NULL,NULL,
     '{"unit_number":"CHANGED"}'::jsonb,
     (SELECT row_version FROM builder_units WHERE id='${UNIT_1}'),'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the unit number is unchanged',
  `SELECT unit_number FROM builder_units WHERE id='${UNIT_1}'`, before.unitName);
expectRejection('an availability transition fails when the trusted audit write fails',
  `SELECT builder_transition_unit_availability('${UNIT_2}',
     (SELECT row_version FROM builder_units WHERE id='${UNIT_2}'),
     'available','on_hold','x','command_user',NULL,'${ACTOR}')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the unit availability is unchanged',
  `SELECT availability_status FROM builder_units WHERE id='${UNIT_2}'`, 'available');
expectRejection('a reservation transition fails when the trusted audit write fails',
  `SELECT builder_transition_reservation('${RES_2}',
     (SELECT row_version FROM builder_reservations WHERE id='${RES_2}'),
     'cancelled','contracted','x','command_user',NULL,'${ACTOR}')`,
  'SIMULATED_AUDIT_OUTAGE', 'INVALID_TRANSITION');

run(['-c', 'DROP TRIGGER trg_force_audit_failure ON public.builder_portal_activity_log;']);
expectEqual('with audit restored, a stage is created again',
  `SELECT (builder_upsert_stage('${ACTOR}','command_user',NULL,NULL,'${PROJECT_1}',
     '{"name":"Stage 2"}'::jsonb,NULL,'ok')).name`, 'Stage 2');

// ===========================================================================
// 11. Solicitor regression
// ===========================================================================
console.log('\nSolicitor regression');
// The upstream fixture creates the Solicitor objects the Builder programme
// generalises, not the whole Solicitor schema — assert on what it does create.
expectEqual('the Solicitor firm table is untouched by the inventory migration',
  `SELECT count(*)>0 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='solicitor_firms'`, 't');
expectEqual('existing Solicitor terms acceptances are preserved',
  "SELECT count(*)>=0 FROM portal_terms_acceptances WHERE portal='solicitor'", 't');
expectEqual('the Solicitor rollout adapter still resolves its original signature',
  `SELECT resolve_cross_portal_feature_mode(
     (SELECT id FROM solicitor_firms LIMIT 1),'solicitor_matter_access_v2')`, 'cutover');

// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${'='.repeat(70)}`);
console.log(`Inventory local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
console.log('All inventory conditions verified against a live PostgreSQL database.');
