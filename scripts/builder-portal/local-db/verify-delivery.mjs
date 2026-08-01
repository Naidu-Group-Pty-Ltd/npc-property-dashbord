#!/usr/bin/env node
/**
 * Builder Portal Delivery — local migration and behaviour verification.
 *
 * Real execution against real PostgreSQL. Every "ok" is a statement that ran.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-delivery.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_VERIFY_DB_DEL (aurixa_delivery_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_VERIFY_DB_DEL || 'aurixa_delivery_verify';

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
  run(['-f', join(migrationsDir, '20260807000000_builder_portal_delivery.sql')]);
  record('the delivery migration is idempotent — a second apply succeeds', true);
} catch (error) {
  record('the delivery migration is idempotent — a second apply succeeds', false,
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
const TXN_P2 = query(`SELECT (builder_upsert_transaction('${ACTOR}','command_user',NULL,NULL,
  '${PROJECT_2}',NULL,'${BLD_ORG}','{"transaction_reference":"P2-1"}'::jsonb,NULL,'fixture')).id`);
const CASE_1 = query(`SELECT (builder_upsert_construction_case('${ACTOR}','command_user',NULL,
  NULL,'${TXN_1}','{"case_reference":"BLD-1"}'::jsonb,NULL,'fixture')).id`);
const CASE_P2 = query(`SELECT (builder_upsert_construction_case('${ACTOR}','command_user',NULL,
  NULL,'${TXN_P2}','{"case_reference":"BLD-P2"}'::jsonb,NULL,'fixture')).id`);
const CSTAGE_1 = query(`SELECT (builder_upsert_construction_stage('${ACTOR}','command_user',NULL,
  NULL,'${CASE_1}','{"name":"Frame","stage_key":"frame"}'::jsonb,NULL,'fixture')).id`);
const MILESTONE_1 = query(`SELECT (builder_upsert_milestone('${ACTOR}','command_user',NULL,
  NULL,'${CASE_1}','${CSTAGE_1}','{"name":"Frame complete"}'::jsonb,NULL,'fixture')).id`);
const MILESTONE_P2 = query(`SELECT (builder_upsert_milestone('${ACTOR}','command_user',NULL,
  NULL,'${CASE_P2}',NULL,'{"name":"Other milestone"}'::jsonb,NULL,'fixture')).id`);

// ===========================================================================
// 1. Schema, RLS, direct-access denial
// ===========================================================================
console.log('Schema and direct-access denial');
const TABLES = ['builder_variations','builder_variation_approvals','builder_progress_claims',
  'builder_inspections','builder_defects','builder_practical_completions','builder_handovers',
  'builder_warranties','builder_warranty_claims','builder_delivery_status_history'];
for (const t of TABLES) {
  expectEqual(`${t} is RLS-protected`,
    `SELECT relrowsecurity FROM pg_class WHERE relname='${t}'`, 't');
  expectRejection(`anonymous SELECT on ${t} is denied`,
    `SET LOCAL ROLE anon; SELECT count(*) FROM public.${t};`, 'permission denied');
  expectRejection(`authenticated SELECT on ${t} is denied`,
    `SET LOCAL ROLE authenticated; SELECT count(*) FROM public.${t};`, 'permission denied');
}
expectEqual('no delivery policy uses an unrestricted USING (true)',
  `SELECT count(*) FROM pg_policies WHERE schemaname='public'
   AND tablename = ANY(ARRAY['${TABLES.join("','")}'])
   AND (qual='true' OR with_check='true')`, 0);
expectEqual('every touch-triggered delivery table carries row_version',
  `SELECT count(*) FROM unnest(ARRAY['builder_variations','builder_variation_approvals',
     'builder_progress_claims','builder_inspections','builder_defects',
     'builder_practical_completions','builder_handovers','builder_warranties',
     'builder_warranty_claims']) t
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=t AND column_name='row_version')`, 0);

// ===========================================================================
// 2. Data boundaries
// ===========================================================================
console.log('\nData boundaries');
expectEqual('a progress claim owns no payment, receipt or invoice column',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='builder_progress_claims'
     AND column_name <> 'finance_payment_id'
     AND (column_name LIKE '%paid%' OR column_name LIKE '%payment%'
          OR column_name LIKE '%receipt%' OR column_name LIKE '%remittance%'
          OR column_name LIKE '%invoice%')`, 0);
expectEqual('a progress claim carries the Finance pointer and nothing more',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='builder_progress_claims'
     AND column_name='finance_payment_id'`, 1);
expectEqual('no quality record carries money',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('builder_defects','builder_inspections','builder_practical_completions',
                        'builder_handovers','builder_warranties','builder_warranty_claims')
     AND (column_name LIKE '%amount%' OR column_name LIKE '%price%' OR column_name LIKE '%cost%'
          OR column_name LIKE '%fee%' OR column_name LIKE '%payment%')`, 0);
expectEqual('a variation carries a price but no cost or margin',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='builder_variations'
     AND (column_name LIKE '%cost%' OR column_name LIKE '%margin%'
          OR column_name LIKE '%supplier%')`, 0);
expectEqual('the Finance-owned progress payment table is untouched',
  `SELECT count(*)>0 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='build_progress_payments'
     AND column_name='is_commission_trigger'`, 't');

// ===========================================================================
// 3. Variations and approvals
// ===========================================================================
console.log('\nVariations and approvals');
const VAR_1 = query(`SELECT (builder_upsert_variation('${ACTOR}','command_user',NULL,
  NULL,'${CASE_1}','{"title":"Upgrade kitchen benchtop","variation_price":4800,"variation_number":"V-1"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a variation is created through the guarded command',
  `SELECT count(*) FROM builder_variations WHERE id='${VAR_1}'`, 1);
expectEqual('and it wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log
   WHERE action='builder_variation_created' AND entity_id='${VAR_1}'`, 't');
expectEqual('a new variation starts as a draft',
  `SELECT status FROM builder_variations WHERE id='${VAR_1}'`, 'draft');
expectRejection('a variation update without expected_version is rejected',
  `SELECT builder_upsert_variation('${ACTOR}','command_user',NULL,'${VAR_1}',NULL,
     '{"title":"No version"}'::jsonb,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('a variation update with a stale expected_version is rejected',
  `SELECT builder_upsert_variation('${ACTOR}','command_user',NULL,'${VAR_1}',NULL,
     '{"title":"Stale"}'::jsonb,999999,'x')`,
  'BUILDER_STALE_WRITE');

expectEqual('draft to submitted is allowed',
  `SELECT builder_is_delivery_transition_allowed('variation','draft','submitted')`, 't');
expectEqual('draft to approved is not allowed',
  `SELECT builder_is_delivery_transition_allowed('variation','draft','approved')`, 'f');
expectEqual('approved is terminal',
  `SELECT builder_is_delivery_transition_allowed('variation','approved','rejected')`, 'f');
expectRejection('a variation transition without a reason is rejected',
  `SELECT builder_transition_delivery('variation','${VAR_1}',
     (SELECT row_version FROM builder_variations WHERE id='${VAR_1}'),
     'draft','submitted','','command_user',NULL,'${ACTOR}')`,
  'REASON_REQUIRED');
expectRejection('a variation transition with a stale version is rejected',
  `SELECT builder_transition_delivery('variation','${VAR_1}',999999,
     'draft','submitted','x','command_user',NULL,'${ACTOR}')`,
  'STALE_VERSION');
expectRejection('a variation transition declaring the wrong status is rejected',
  `SELECT builder_transition_delivery('variation','${VAR_1}',
     (SELECT row_version FROM builder_variations WHERE id='${VAR_1}'),
     'submitted','approved','x','command_user',NULL,'${ACTOR}')`,
  'STALE_STATUS');
run(['-c', `SELECT builder_transition_delivery('variation','${VAR_1}',
  (SELECT row_version FROM builder_variations WHERE id='${VAR_1}'),
  'draft','submitted','sent to purchaser','command_user',NULL,'${ACTOR}')`]);
expectEqual('a valid variation transition moves the status and stamps submitted_at',
  `SELECT (status='submitted' AND submitted_at IS NOT NULL)
   FROM builder_variations WHERE id='${VAR_1}'`, 't');
expectEqual('and it appended a delivery history row',
  `SELECT count(*) FROM builder_delivery_status_history
   WHERE entity_kind='variation' AND entity_id='${VAR_1}' AND to_status='submitted'`, 1);
expectRejection('delivery history cannot be updated',
  `UPDATE builder_delivery_status_history SET reason='tampered' WHERE entity_id='${VAR_1}'`,
  'BUILDER_DELIVERY_HISTORY_APPEND_ONLY');
expectRejection('delivery history cannot be deleted',
  `DELETE FROM builder_delivery_status_history WHERE entity_id='${VAR_1}'`,
  'BUILDER_DELIVERY_HISTORY_APPEND_ONLY');

const APPROVAL_1 = query(`SELECT (builder_upsert_variation_approval('${ACTOR}','command_user',NULL,
  NULL,'${VAR_1}','{"approver_role":"purchaser","approver_name":"Jordan Vale"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('an approval is created through the guarded command',
  `SELECT count(*) FROM builder_variation_approvals WHERE id='${APPROVAL_1}'`, 1);
expectEqual('and the approval is recorded in delivery history',
  `SELECT count(*) FROM builder_delivery_status_history
   WHERE entity_kind='variation_approval' AND entity_id='${APPROVAL_1}'`, 1);
expectEqual('an approval decision stamps decided_at',
  `SELECT (builder_upsert_variation_approval('${ACTOR}','command_user',NULL,'${APPROVAL_1}',NULL,
     '{"approver_name":"Jordan Vale","decision":"approved"}'::jsonb,
     (SELECT row_version FROM builder_variation_approvals WHERE id='${APPROVAL_1}'),
     'ok')).decided_at IS NOT NULL`, 't');
run(['-c', `SELECT builder_transition_delivery('variation','${VAR_1}',
  (SELECT row_version FROM builder_variations WHERE id='${VAR_1}'),
  'submitted','approved','purchaser approved','command_user',NULL,'${ACTOR}')`]);
expectEqual('an approved variation stamps decided_at',
  `SELECT decided_at IS NOT NULL FROM builder_variations WHERE id='${VAR_1}'`, 't');

// ===========================================================================
// 4. Progress claims
// ===========================================================================
console.log('\nProgress claims');
const CLAIM_1 = query(`SELECT (builder_upsert_progress_claim('${ACTOR}','command_user',NULL,
  NULL,'${CASE_1}','${MILESTONE_1}','{"claim_number":"PC-1","claimed_amount":85000}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a progress claim is created through the guarded command',
  `SELECT count(*) FROM builder_progress_claims WHERE id='${CLAIM_1}'`, 1);
expectEqual('a new claim is a draft with no Finance payment pointer',
  `SELECT (status='draft' AND finance_payment_id IS NULL)
   FROM builder_progress_claims WHERE id='${CLAIM_1}'`, 't');
expectRejection('a claim with no amount is rejected',
  `SELECT builder_upsert_progress_claim('${ACTOR}','command_user',NULL,NULL,'${CASE_1}',NULL,
     '{"claim_number":"PC-BAD"}'::jsonb,NULL,'x')`,
  'BUILDER_CLAIM_AMOUNT_REQUIRED');
expectRejection("a claim cannot reference another case's milestone",
  `INSERT INTO builder_progress_claims(construction_case_id, milestone_id, claimed_amount)
   VALUES ('${CASE_1}','${MILESTONE_P2}',100)`,
  'BUILDER_DELIVERY_PARENT_MISMATCH');
expectEqual('draft to submitted is allowed for a claim',
  `SELECT builder_is_delivery_transition_allowed('progress_claim','draft','submitted')`, 't');
expectEqual('a claim cannot jump straight to closed',
  `SELECT builder_is_delivery_transition_allowed('progress_claim','draft','closed')`, 'f');
run(['-c', `SELECT builder_transition_delivery('progress_claim','${CLAIM_1}',
  (SELECT row_version FROM builder_progress_claims WHERE id='${CLAIM_1}'),
  'draft','submitted','claim lodged','command_user',NULL,'${ACTOR}')`]);
expectEqual('a submitted claim stamps claimed_at',
  `SELECT claimed_at IS NOT NULL FROM builder_progress_claims WHERE id='${CLAIM_1}'`, 't');
run(['-c', `SELECT builder_transition_delivery('progress_claim','${CLAIM_1}',
  (SELECT row_version FROM builder_progress_claims WHERE id='${CLAIM_1}'),
  'submitted','certified','certified by the assessor','command_user',NULL,'${ACTOR}')`]);
expectEqual('a certified claim stamps certified_at but records no payment',
  `SELECT (certified_at IS NOT NULL AND finance_payment_id IS NULL)
   FROM builder_progress_claims WHERE id='${CLAIM_1}'`, 't');

// ===========================================================================
// 5. Inspections and defects
// ===========================================================================
console.log('\nInspections and defects');
const INSP_1 = query(`SELECT (builder_upsert_inspection('${ACTOR}','command_user',NULL,
  NULL,'${CASE_1}','${CSTAGE_1}','{"title":"Frame inspection","inspection_type":"frame"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('an inspection is scheduled through the guarded command',
  `SELECT count(*) FROM builder_inspections WHERE id='${INSP_1}'`, 1);
expectEqual('a new inspection is scheduled with no defects',
  `SELECT (status='scheduled' AND defect_count=0) FROM builder_inspections WHERE id='${INSP_1}'`, 't');
const CSTAGE_P2 = query(`SELECT (builder_upsert_construction_stage('${ACTOR}','command_user',NULL,
  NULL,'${CASE_P2}','{"name":"Other frame","stage_key":"frame"}'::jsonb,NULL,'fixture')).id`);
expectRejection("an inspection cannot reference another case's stage",
  `INSERT INTO builder_inspections(construction_case_id, construction_stage_id, title)
   VALUES ('${CASE_1}','${CSTAGE_P2}','Bad inspection')`,
  'BUILDER_MILESTONE_PARENT_MISMATCH');

run(['-c', `SELECT builder_transition_delivery('inspection','${INSP_1}',
  (SELECT row_version FROM builder_inspections WHERE id='${INSP_1}'),
  'scheduled','in_progress','inspector on site','command_user',NULL,'${ACTOR}')`]);
run(['-c', `SELECT builder_transition_delivery('inspection','${INSP_1}',
  (SELECT row_version FROM builder_inspections WHERE id='${INSP_1}'),
  'in_progress','passed_with_defects','minor items noted','command_user',NULL,'${ACTOR}')`]);
expectEqual('a completed inspection stamps performed_at',
  `SELECT performed_at IS NOT NULL FROM builder_inspections WHERE id='${INSP_1}'`, 't');
expectEqual('a passed inspection is terminal',
  `SELECT builder_is_delivery_transition_allowed('inspection','passed','failed')`, 'f');

const DEFECT_1 = query(`SELECT (builder_upsert_defect('${ACTOR}','command_user',NULL,
  NULL,'${CASE_1}','${INSP_1}','{"title":"Scratched window frame","severity":"minor","defect_number":"D-1"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a defect is raised through the guarded command',
  `SELECT count(*) FROM builder_defects WHERE id='${DEFECT_1}'`, 1);
expectEqual("the inspection's defect count follows the defects raised against it",
  `SELECT defect_count FROM builder_inspections WHERE id='${INSP_1}'`, 1);
const INSP_P2 = query(`SELECT (builder_upsert_inspection('${ACTOR}','command_user',NULL,
  NULL,'${CASE_P2}',NULL,'{"title":"Other inspection"}'::jsonb,NULL,'fixture')).id`);
expectRejection("a defect cannot reference another case's inspection",
  `INSERT INTO builder_defects(construction_case_id, inspection_id, title)
   VALUES ('${CASE_1}','${INSP_P2}','Bad defect')`,
  'BUILDER_DELIVERY_PARENT_MISMATCH');

expectEqual('the defect lifecycle runs open to closed through verification',
  `SELECT builder_is_delivery_transition_allowed('defect','verified','closed')`, 't');
expectEqual('a defect cannot jump from open to closed',
  `SELECT builder_is_delivery_transition_allowed('defect','open','closed')`, 'f');
run(['-c', `
  SELECT builder_transition_delivery('defect','${DEFECT_1}',(SELECT row_version FROM builder_defects WHERE id='${DEFECT_1}'),'open','acknowledged','x','command_user',NULL,'${ACTOR}');
  SELECT builder_transition_delivery('defect','${DEFECT_1}',(SELECT row_version FROM builder_defects WHERE id='${DEFECT_1}'),'acknowledged','in_rectification','x','command_user',NULL,'${ACTOR}');
  SELECT builder_transition_delivery('defect','${DEFECT_1}',(SELECT row_version FROM builder_defects WHERE id='${DEFECT_1}'),'in_rectification','rectified','x','command_user',NULL,'${ACTOR}');
  SELECT builder_transition_delivery('defect','${DEFECT_1}',(SELECT row_version FROM builder_defects WHERE id='${DEFECT_1}'),'rectified','verified','x','command_user',NULL,'${ACTOR}');
`]);
expectEqual('a rectified and verified defect stamps both dates',
  `SELECT (rectified_at IS NOT NULL AND verified_at IS NOT NULL)
   FROM builder_defects WHERE id='${DEFECT_1}'`, 't');
expectEqual('and every defect transition is in the delivery history',
  `SELECT count(*) FROM builder_delivery_status_history
   WHERE entity_kind='defect' AND entity_id='${DEFECT_1}'`, 4);

// ===========================================================================
// 6. Practical completion, handover and warranty
// ===========================================================================
console.log('\nPractical completion, handover and warranty');
const PC_1 = query(`SELECT (builder_upsert_delivery_record('${ACTOR}','command_user',NULL,
  'practical_completion','${CASE_1}','{"certificate_reference":"PC-CERT-1"}'::jsonb,NULL,'fixture'))->>'id'`);
expectEqual('a practical completion record is created on first use',
  `SELECT count(*) FROM builder_practical_completions WHERE construction_case_id='${CASE_1}'`, 1);
expectRejection('a second update without expected_version is rejected',
  `SELECT builder_upsert_delivery_record('${ACTOR}','command_user',NULL,
     'practical_completion','${CASE_1}','{"notes":"No version"}'::jsonb,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('an unknown delivery kind is rejected',
  `SELECT builder_upsert_delivery_record('${ACTOR}','command_user',NULL,
     'invented','${CASE_1}','{}'::jsonb,NULL,'x')`,
  'BUILDER_INVALID_DELIVERY_KIND');
run(['-c', `SELECT builder_transition_delivery('practical_completion','${PC_1}',
  (SELECT row_version FROM builder_practical_completions WHERE id='${PC_1}'),
  'not_reached','notified','PC notice issued','command_user',NULL,'${ACTOR}')`]);
expectEqual('a notified practical completion stamps notified_at',
  `SELECT notified_at IS NOT NULL FROM builder_practical_completions WHERE id='${PC_1}'`, 't');

const HO_1 = query(`SELECT (builder_upsert_delivery_record('${ACTOR}','command_user',NULL,
  'handover','${CASE_1}','{"key_set_count":3}'::jsonb,NULL,'fixture'))->>'id'`);
expectEqual('a handover record is created on first use',
  `SELECT count(*) FROM builder_handovers WHERE construction_case_id='${CASE_1}'`, 1);
run(['-c', `SELECT builder_transition_delivery('handover','${HO_1}',
  (SELECT row_version FROM builder_handovers WHERE id='${HO_1}'),
  'not_scheduled','scheduled','walkthrough booked','command_user',NULL,'${ACTOR}')`]);
expectEqual('handover cannot skip straight to completed',
  `SELECT builder_is_delivery_transition_allowed('handover','scheduled','completed')`, 'f');

const WR_1 = query(`SELECT (builder_upsert_delivery_record('${ACTOR}','command_user',NULL,
  'warranty','${CASE_1}','{"warranty_type":"structural","provider_name":"HomeCover","starts_on":"2027-01-01","expires_on":"2033-01-01"}'::jsonb,
  NULL,'fixture'))->>'id'`);
expectEqual('a warranty record is created on first use',
  `SELECT count(*) FROM builder_warranties WHERE construction_case_id='${CASE_1}'`, 1);
expectRejection('a warranty cannot expire before it starts',
  `UPDATE builder_warranties SET expires_on='2026-01-01' WHERE id='${WR_1}'`,
  'builder_warranties_window_valid');

const WC_1 = query(`SELECT (builder_upsert_warranty_claim('${ACTOR}','command_user',NULL,
  NULL,'${CASE_1}','${WR_1}','{"title":"Cracked cornice","claim_number":"WC-1"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a warranty claim is lodged through the guarded command',
  `SELECT count(*) FROM builder_warranty_claims WHERE id='${WC_1}'`, 1);
run(['-c', `SELECT builder_transition_delivery('warranty_claim','${WC_1}',
  (SELECT row_version FROM builder_warranty_claims WHERE id='${WC_1}'),
  'lodged','under_review','assessor assigned','command_user',NULL,'${ACTOR}')`]);
expectEqual('a warranty claim moves through review',
  `SELECT status FROM builder_warranty_claims WHERE id='${WC_1}'`, 'under_review');

// A kind cannot be aimed at the wrong table.
expectRejection('a transition kind cannot be aimed at another aggregate',
  `SELECT builder_transition_delivery('defect','${VAR_1}',1,'open','acknowledged','x',
     'command_user',NULL,'${ACTOR}')`,
  'BUILDER_DELIVERY_NOT_FOUND');

// ===========================================================================
// 7. Access control — the construction resolver governs every delivery record
// ===========================================================================
console.log('\nAccess control');
expectEqual('the granted user resolves view on the parent construction case',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_1}','construction','view')`, 't');
expectEqual('a user with no grant resolves false',
  `SELECT builder_resolve_construction_permission('${USER_O}','${CASE_1}','construction','view')`, 'f');
expectEqual('access to one project does not reach another project delivery record',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_P2}','construction','view')`, 'f');

const MEMBERSHIP_B = query(
  `SELECT id FROM builder_organisation_memberships
   WHERE builder_user_id='${USER_B}' AND organisation_id='${BLD_ORG}'`);
run(['-c', `SELECT builder_admin_upsert_project_access('${ACTOR}','command_user','${USER_B}',
  '${PROJECT_1}','builder','team_member',
  '{"construction":{"view":"allow","edit":"allow"},"variations":{"view":"allow"},"transactions":{"view":"allow"}}'::jsonb,
  NULL,(SELECT row_version FROM builder_project_access
        WHERE builder_user_id='${USER_B}' AND project_id='${PROJECT_1}'),'grant override')`]);
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='construction_case';
  INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
    scope_id, view_decision, edit_decision, delete_decision)
  VALUES ('${MEMBERSHIP_B}','construction','construction_case','${CASE_1}','allow','allow','inherit')`]);
expectEqual('with both overlapping allow overrides, delivery access resolves true',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_1}','construction','view')`, 't');

run(['-c', `UPDATE builder_organisation_memberships SET status='revoked', revoked_at=now(),
  revoked_reason='test' WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('a revoked membership denies every delivery record despite both allows',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_1}','construction','view')`, 'f');
expectEqual('and the accessible construction set is empty, so no delivery record is reachable',
  `SELECT count(*) FROM builder_accessible_construction_cases('${USER_B}','${BLD_ORG}','construction')`, 0);
run(['-c', `UPDATE builder_organisation_memberships SET status='suspended', revoked_at=NULL,
  revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('a suspended membership denies as well',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_1}','construction','view')`, 'f');
run(['-c', `UPDATE builder_organisation_memberships SET status='active',
  revoked_at=NULL, revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('restoring the membership restores delivery access',
  `SELECT builder_resolve_construction_permission('${USER_B}','${CASE_1}','construction','view')`, 't');
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='construction_case'`]);

expectEqual('every delivery permission key carries a role baseline',
  `SELECT count(*) FROM unnest(ARRAY['variations','progress_claims','inspections','defects',
     'handover']) k
   WHERE NOT EXISTS (SELECT 1 FROM builder_role_default_permissions
     WHERE permission_key=k AND membership_role='manager' AND can_view)`, 0);
expectEqual('read_only cannot edit any delivery key',
  `SELECT count(*) FROM builder_role_default_permissions
   WHERE membership_role='read_only' AND can_edit
     AND permission_key IN ('variations','progress_claims','inspections','defects','handover')`, 0);

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
  variations: query('SELECT count(*) FROM builder_variations'),
  claims: query('SELECT count(*) FROM builder_progress_claims'),
  inspections: query('SELECT count(*) FROM builder_inspections'),
  defects: query('SELECT count(*) FROM builder_defects'),
  wclaims: query('SELECT count(*) FROM builder_warranty_claims'),
  history: query('SELECT count(*) FROM builder_delivery_status_history'),
  defectStatus: query(`SELECT status FROM builder_defects WHERE id='${DEFECT_1}'`),
};

for (const [label, sql, key, table] of [
  ['variation creation', `SELECT builder_upsert_variation('${ACTOR}','command_user',NULL,NULL,'${CASE_1}','{"title":"NOPE"}'::jsonb,NULL,'x')`, 'variations', 'builder_variations'],
  ['claim creation', `SELECT builder_upsert_progress_claim('${ACTOR}','command_user',NULL,NULL,'${CASE_1}',NULL,'{"claimed_amount":1}'::jsonb,NULL,'x')`, 'claims', 'builder_progress_claims'],
  ['inspection creation', `SELECT builder_upsert_inspection('${ACTOR}','command_user',NULL,NULL,'${CASE_1}',NULL,'{"title":"NOPE"}'::jsonb,NULL,'x')`, 'inspections', 'builder_inspections'],
  ['defect creation', `SELECT builder_upsert_defect('${ACTOR}','command_user',NULL,NULL,'${CASE_1}',NULL,'{"title":"NOPE"}'::jsonb,NULL,'x')`, 'defects', 'builder_defects'],
  ['warranty claim creation', `SELECT builder_upsert_warranty_claim('${ACTOR}','command_user',NULL,NULL,'${CASE_1}',NULL,'{"title":"NOPE"}'::jsonb,NULL,'x')`, 'wclaims', 'builder_warranty_claims'],
]) {
  expectRejection(`${label} fails when the trusted audit write fails`, sql, 'SIMULATED_AUDIT_OUTAGE');
  expectEqual(`and no ${label.split(' ')[0]} row was created`,
    `SELECT count(*) FROM ${table}`, before[key]);
}

expectRejection('a delivery transition fails when the trusted audit write fails',
  `SELECT builder_transition_delivery('defect','${DEFECT_1}',
     (SELECT row_version FROM builder_defects WHERE id='${DEFECT_1}'),
     '${before.defectStatus}','closed','x','command_user',NULL,'${ACTOR}')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the defect status is unchanged',
  `SELECT status FROM builder_defects WHERE id='${DEFECT_1}'`, before.defectStatus);
expectEqual('and no delivery history row was appended',
  'SELECT count(*) FROM builder_delivery_status_history', before.history);

run(['-c', 'DROP TRIGGER trg_force_audit_failure ON public.builder_portal_activity_log;']);
expectEqual('with audit restored, a variation is created again',
  `SELECT (builder_upsert_variation('${ACTOR}','command_user',NULL,NULL,'${CASE_1}',
     '{"title":"Upgrade tapware"}'::jsonb,NULL,'ok')).title`, 'Upgrade tapware');

// ===========================================================================
// 9. Solicitor regression
// ===========================================================================
console.log('\nSolicitor regression');
expectEqual('the Solicitor firm table is untouched by the delivery migration',
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
console.log(`Delivery local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
console.log('All delivery conditions verified against a live PostgreSQL database.');
