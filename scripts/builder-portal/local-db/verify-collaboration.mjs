#!/usr/bin/env node
/**
 * Builder Portal Collaboration — local migration and behaviour verification.
 *
 * Real execution against real PostgreSQL. Every "ok" is a statement that ran.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-collaboration.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_VERIFY_DB_COL (aurixa_collab_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_VERIFY_DB_COL || 'aurixa_collab_verify';

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
  run(['-f', join(migrationsDir, '20260808000000_builder_portal_collaboration.sql')]);
  record('the collaboration migration is idempotent — a second apply succeeds', true);
} catch (error) {
  record('the collaboration migration is idempotent — a second apply succeeds', false,
    String(error.stderr || error.message).trim().split('\n')[0]);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const DEV_ORG = '11111111-1111-1111-1111-111111111111';
const BLD_ORG = '22222222-2222-2222-2222-222222222222';
const OTHER_ORG = '33333333-3333-3333-3333-333333333333';
const USER_B = 'aaaaaaaa-0000-0000-0000-0000000000b1';
const USER_C = 'aaaaaaaa-0000-0000-0000-0000000000c1';
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
         ('${USER_C}','colleague@harbourline.test','Colleague User','active',true),
         ('${USER_O}','other@unrelated.test','Other User','active',true);
  INSERT INTO builder_organisation_memberships(builder_user_id, organisation_id, membership_role, is_primary)
  VALUES ('${USER_B}','${BLD_ORG}','manager',true),
         ('${USER_C}','${BLD_ORG}','member',true),
         ('${USER_O}','${OTHER_ORG}','manager',true);
  INSERT INTO builder_projects(id, name, developer_organisation_id, builder_organisation_id, status)
  VALUES ('${PROJECT_1}','Harbour Rise A','${DEV_ORG}','${BLD_ORG}','planning'),
         ('${PROJECT_2}','Harbour Rise B','${DEV_ORG}','${BLD_ORG}','planning');
`]);
for (const u of [USER_B, USER_C]) {
  run(['-c', `SELECT builder_admin_upsert_project_access(
    '${ACTOR}','command_user','${u}','${PROJECT_1}','builder','team_member','{}'::jsonb,NULL,NULL,'fixture')`]);
}

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

// ===========================================================================
// 1. Schema, RLS, direct-access denial
// ===========================================================================
console.log('Schema and direct-access denial');
const TABLES = ['builder_documents','builder_document_versions','builder_document_grants',
  'builder_conversations','builder_conversation_participants','builder_messages',
  'builder_tasks','builder_task_assignments','builder_notifications'];
for (const t of TABLES) {
  expectEqual(`${t} is RLS-protected`,
    `SELECT relrowsecurity FROM pg_class WHERE relname='${t}'`, 't');
  expectRejection(`anonymous SELECT on ${t} is denied`,
    `SET LOCAL ROLE anon; SELECT count(*) FROM public.${t};`, 'permission denied');
  expectRejection(`authenticated SELECT on ${t} is denied`,
    `SET LOCAL ROLE authenticated; SELECT count(*) FROM public.${t};`, 'permission denied');
}
expectEqual('no collaboration policy uses an unrestricted USING (true)',
  `SELECT count(*) FROM pg_policies WHERE schemaname='public'
   AND tablename = ANY(ARRAY['${TABLES.join("','")}'])
   AND (qual='true' OR with_check='true')`, 0);
expectEqual('every touch-triggered collaboration table carries row_version',
  `SELECT count(*) FROM unnest(ARRAY['builder_documents','builder_document_grants',
     'builder_conversations','builder_conversation_participants','builder_tasks',
     'builder_task_assignments']) t
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=t AND column_name='row_version')`, 0);
expectEqual('no collaboration command is executable by anon or authenticated',
  `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('builder_upsert_document',
     'builder_add_document_version','builder_set_document_grant','builder_create_conversation',
     'builder_post_message','builder_mark_conversation_read','builder_upsert_task',
     'builder_set_task_assignment','builder_mark_notifications_read')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, 0);

// ===========================================================================
// 2. Data boundaries
// ===========================================================================
console.log('\nData boundaries');
expectEqual('no collaboration table carries money, AML or privileged columns',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name = ANY(ARRAY['${TABLES.join("','")}'])
     AND (column_name LIKE '%amount%' OR column_name LIKE '%price%' OR column_name LIKE '%cost%'
          OR column_name LIKE '%income%' OR column_name LIKE '%borrowing%'
          OR column_name LIKE '%aml%' OR column_name LIKE '%privileg%'
          OR column_name LIKE '%commission%')`, 0);
expectEqual('a document version holds a storage path, never a public URL column',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='builder_document_versions'
     AND (column_name LIKE '%url%' OR column_name LIKE '%public%')`, 0);
expectEqual('a notification points at an entity and carries no record copy',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='builder_notifications'
     AND column_name IN ('entity_kind','entity_id','scope_type','scope_id')`, 4);
expectEqual('the Solicitor portal tables are untouched by the collaboration migration',
  `SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('solicitor_firms','solicitor_portal_users','solicitor_portal_sessions')`, 3);
expectEqual('no collaboration table reaches into a Client, Finance or Solicitor row',
  `SELECT count(*) FROM information_schema.constraint_column_usage u
   JOIN information_schema.table_constraints c ON c.constraint_name=u.constraint_name
   WHERE c.constraint_type='FOREIGN KEY'
     AND c.table_name = ANY(ARRAY['${TABLES.join("','")}'])
     AND u.table_name IN ('clients','client_deals','builder_invoices','build_progress_payments',
                          'legal_matters','purchase_files','solicitor_firms')`, 0);

// ===========================================================================
// 3. The scope dispatcher
// ===========================================================================
console.log('\nScope dispatch');
expectEqual('the dispatcher resolves a project scope through the project resolver',
  `SELECT builder_resolve_scope_permission('${USER_B}','project','${PROJECT_1}','documents','view')
   = builder_resolve_project_permission('${USER_B}','${PROJECT_1}','documents','view')`, 't');
expectEqual('the dispatcher resolves a unit scope through the unit resolver',
  `SELECT builder_resolve_scope_permission('${USER_B}','unit','${UNIT_1}','documents','view')
   = builder_resolve_unit_permission('${USER_B}','${UNIT_1}','documents','view')`, 't');
expectEqual('the dispatcher resolves a transaction scope through the transaction resolver',
  `SELECT builder_resolve_scope_permission('${USER_B}','transaction','${TXN_1}','documents','view')
   = builder_resolve_transaction_permission('${USER_B}','${TXN_1}','documents','view')`, 't');
expectEqual('the dispatcher resolves a construction scope through the construction resolver',
  `SELECT builder_resolve_scope_permission('${USER_B}','construction_case','${CASE_1}','documents','view')
   = builder_resolve_construction_permission('${USER_B}','${CASE_1}','documents','view')`, 't');
expectEqual('an unknown scope type resolves false rather than defaulting open',
  `SELECT builder_resolve_scope_permission('${USER_B}','invented','${PROJECT_1}','documents','view')`, 'f');
expectEqual('an unknown scope type does not exist',
  `SELECT builder_scope_exists('invented','${PROJECT_1}')`, 'f');
expectEqual('an unknown scope type has no owning organisation',
  `SELECT builder_scope_org('invented','${PROJECT_1}') IS NULL`, 't');
expectRejection('a document cannot be attached to a scope that does not exist',
  `INSERT INTO builder_documents(scope_type, scope_id, organisation_id, title)
   VALUES ('project','00000000-0000-0000-0000-0000000000ff','${BLD_ORG}','Orphan')`,
  'BUILDER_SCOPE_TARGET_NOT_FOUND');
expectRejection('a conversation cannot be attached to a scope that does not exist',
  `INSERT INTO builder_conversations(scope_type, scope_id, organisation_id, subject)
   VALUES ('unit','00000000-0000-0000-0000-0000000000ff','${BLD_ORG}','Orphan')`,
  'BUILDER_SCOPE_TARGET_NOT_FOUND');
expectRejection('a task cannot be attached to a scope that does not exist',
  `INSERT INTO builder_tasks(scope_type, scope_id, organisation_id, title)
   VALUES ('transaction','00000000-0000-0000-0000-0000000000ff','${BLD_ORG}','Orphan')`,
  'BUILDER_SCOPE_TARGET_NOT_FOUND');
// The BEFORE trigger fires first and rejects an unresolvable scope, so the column
// CHECK is the second gate rather than the observable one. Both must be present:
// the trigger stops a dangling id, the CHECK stops a scope type nothing resolves.
for (const t of ['builder_documents','builder_conversations','builder_tasks']) {
  expectEqual(`${t} closes the scope list at the column`,
    `SELECT pg_get_constraintdef(oid) LIKE '%project%unit%transaction%construction_case%'
     FROM pg_constraint WHERE conname='${t}_scope_type_check'`, 't');
  expectEqual(`${t} also guards the scope target with a trigger`,
    `SELECT count(*) FROM pg_trigger WHERE tgname='trg_${t}_scope' AND NOT tgisinternal`, 1);
}

// ===========================================================================
// 4. Documents, versions and grants
// ===========================================================================
console.log('\nDocuments, versions and grants');
const DOC_1 = query(`SELECT (builder_upsert_document('${ACTOR}','command_user',NULL,
  NULL,'construction_case','${CASE_1}','{"title":"Frame certificate","document_type":"certificate"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a document is created through the guarded command',
  `SELECT count(*) FROM builder_documents WHERE id='${DOC_1}'`, 1);
expectEqual('and it wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log
   WHERE action='builder_document_created' AND entity_id='${DOC_1}'`, 't');
expectEqual('the owning organisation is resolved server-side from the scope',
  `SELECT organisation_id FROM builder_documents WHERE id='${DOC_1}'`, BLD_ORG);
expectEqual('a new document is active and not customer visible',
  `SELECT (status='active' AND is_customer_visible=false)
   FROM builder_documents WHERE id='${DOC_1}'`, 't');
expectRejection('a document with no title is rejected',
  `SELECT builder_upsert_document('${ACTOR}','command_user',NULL,NULL,'project','${PROJECT_1}',
     '{}'::jsonb,NULL,'x')`,
  'BUILDER_DOCUMENT_TITLE_REQUIRED');
expectRejection('a document update without expected_version is rejected',
  `SELECT builder_upsert_document('${ACTOR}','command_user',NULL,'${DOC_1}',NULL,NULL,
     '{"title":"No version"}'::jsonb,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('a document update with a stale expected_version is rejected',
  `SELECT builder_upsert_document('${ACTOR}','command_user',NULL,'${DOC_1}',NULL,NULL,
     '{"title":"Stale"}'::jsonb,999999,'x')`,
  'BUILDER_STALE_WRITE');
expectEqual('a document update with the matching expected_version succeeds',
  `SELECT (builder_upsert_document('${ACTOR}','command_user',NULL,'${DOC_1}',NULL,NULL,
     '{"title":"Frame certificate v2"}'::jsonb,
     (SELECT row_version FROM builder_documents WHERE id='${DOC_1}'),'ok')).title`,
  'Frame certificate v2');
expectEqual('and the row_version advanced',
  `SELECT row_version>1 FROM builder_documents WHERE id='${DOC_1}'`, 't');
expectRejection('an unknown document cannot be updated',
  `SELECT builder_upsert_document('${ACTOR}','command_user',NULL,
     '00000000-0000-0000-0000-0000000000ff',NULL,NULL,'{}'::jsonb,1,'x')`,
  'BUILDER_DOCUMENT_NOT_FOUND');

const VER_1 = query(`SELECT (builder_add_document_version('${ACTOR}','command_user',NULL,'${DOC_1}',
  '{"storage_path":"builder/case/frame-cert-v1.pdf","file_name":"frame-cert-v1.pdf"}'::jsonb,
  'first upload')).id`);
expectEqual('the first version is numbered 1',
  `SELECT version_number FROM builder_document_versions WHERE id='${VER_1}'`, 1);
expectEqual('and the document now points at it',
  `SELECT current_version_id='${VER_1}' FROM builder_documents WHERE id='${DOC_1}'`, 't');
const VER_2 = query(`SELECT (builder_add_document_version('${ACTOR}','command_user',NULL,'${DOC_1}',
  '{"storage_path":"builder/case/frame-cert-v2.pdf","file_name":"frame-cert-v2.pdf"}'::jsonb,
  'reissued')).id`);
expectEqual('the next version is numbered 2',
  `SELECT version_number FROM builder_document_versions WHERE id='${VER_2}'`, 2);
expectEqual('and the document points at the newest version',
  `SELECT current_version_id='${VER_2}' FROM builder_documents WHERE id='${DOC_1}'`, 't');
expectRejection('a version with no file is rejected',
  `SELECT builder_add_document_version('${ACTOR}','command_user',NULL,'${DOC_1}',
     '{"change_note":"nothing attached"}'::jsonb,'x')`,
  'BUILDER_DOCUMENT_FILE_REQUIRED');
expectRejection('a document version cannot be edited',
  `UPDATE builder_document_versions SET file_name='tampered.pdf' WHERE id='${VER_1}'`,
  'BUILDER_DOCUMENT_VERSION_IMMUTABLE');
expectRejection('a document version cannot be deleted',
  `DELETE FROM builder_document_versions WHERE id='${VER_1}'`,
  'BUILDER_DOCUMENT_VERSION_IMMUTABLE');
expectRejection('two versions cannot share a number',
  `INSERT INTO builder_document_versions(document_id, version_number, storage_path, file_name)
   VALUES ('${DOC_1}',1,'x/y.pdf','y.pdf')`,
  'builder_document_versions_document_id_version_number_key');

expectEqual('an ungranted document is visible to everyone who reaches its scope',
  `SELECT builder_can_see_document('${USER_B}','${DOC_1}','view')`, 't');
expectEqual('and to a colleague who also reaches that scope',
  `SELECT builder_can_see_document('${USER_C}','${DOC_1}','view')`, 't');
expectEqual('but not to a user outside the organisation',
  `SELECT builder_can_see_document('${USER_O}','${DOC_1}','view')`, 'f');

const GRANT_1 = query(`SELECT (builder_set_document_grant('${ACTOR}','command_user',NULL,'${DOC_1}',
  '${USER_B}',true,false,NULL,'restrict to the site manager')).id`);
expectEqual('a grant is created through the guarded command',
  `SELECT count(*) FROM builder_document_grants WHERE id='${GRANT_1}'`, 1);
expectEqual('the granted user still sees the document',
  `SELECT builder_can_see_document('${USER_B}','${DOC_1}','view')`, 't');
expectEqual('a grant NARROWS — the ungranted colleague loses the document',
  `SELECT builder_can_see_document('${USER_C}','${DOC_1}','view')`, 'f');
expectEqual('and a grant cannot WIDEN — the outside user is still refused',
  `SELECT builder_can_see_document('${USER_O}','${DOC_1}','view')`, 'f');
run(['-c', `INSERT INTO builder_document_grants(document_id, builder_user_id)
  VALUES ('${DOC_1}','${USER_O}')`]);
expectEqual('a grant handed directly to an outside user still resolves false',
  `SELECT builder_can_see_document('${USER_O}','${DOC_1}','view')`, 'f');
run(['-c', `DELETE FROM builder_document_grants
  WHERE document_id='${DOC_1}' AND builder_user_id='${USER_O}'`]);
expectRejection('a grant update without expected_version is rejected',
  `SELECT builder_set_document_grant('${ACTOR}','command_user',NULL,'${DOC_1}','${USER_B}',
     false,false,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('a grant update with a stale expected_version is rejected',
  `SELECT builder_set_document_grant('${ACTOR}','command_user',NULL,'${DOC_1}','${USER_B}',
     false,false,999999,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('an absent grant cannot be revoked',
  `SELECT builder_set_document_grant('${ACTOR}','command_user',NULL,'${DOC_1}','${USER_C}',
     true,true,NULL,'x')`,
  'BUILDER_DOCUMENT_GRANT_NOT_FOUND');
run(['-c', `SELECT builder_set_document_grant('${ACTOR}','command_user',NULL,'${DOC_1}','${USER_B}',
  true,true,(SELECT row_version FROM builder_document_grants WHERE id='${GRANT_1}'),'no longer needed')`]);
expectEqual('revoking the only grant returns the document to everyone in scope',
  `SELECT (builder_can_see_document('${USER_B}','${DOC_1}','view')
       AND builder_can_see_document('${USER_C}','${DOC_1}','view'))`, 't');
expectEqual('and the outside user is still refused',
  `SELECT builder_can_see_document('${USER_O}','${DOC_1}','view')`, 'f');
expectEqual('an unknown document is never visible',
  `SELECT builder_can_see_document('${USER_B}','00000000-0000-0000-0000-0000000000ff','view')`, 'f');

const DOC_P2 = query(`SELECT (builder_upsert_document('${ACTOR}','command_user',NULL,
  NULL,'project','${PROJECT_2}','{"title":"Other project pack"}'::jsonb,NULL,'fixture')).id`);
expectEqual('access to one project does not reach another project document',
  `SELECT builder_can_see_document('${USER_B}','${DOC_P2}','view')`, 'f');
expectEqual('the accessible document set excludes it',
  `SELECT count(*) FROM builder_accessible_documents('${USER_B}') WHERE document_id='${DOC_P2}'`, 0);
expectEqual('the accessible document set includes the reachable one',
  `SELECT count(*) FROM builder_accessible_documents('${USER_B}') WHERE document_id='${DOC_1}'`, 1);
expectEqual('the accessible document set is empty for an outside user',
  `SELECT count(*) FROM builder_accessible_documents('${USER_O}')`, 0);

// ===========================================================================
// 5. Conversations, messages and unread counts
// ===========================================================================
console.log('\nConversations, messages and unread counts');
const CONV_1 = query(`SELECT (builder_create_conversation('${ACTOR}','command_user','${USER_B}',
  'construction_case','${CASE_1}','{"subject":"Frame stage queries"}'::jsonb,
  ARRAY['${USER_C}']::uuid[],'fixture')).id`);
expectEqual('a conversation is created through the guarded command',
  `SELECT count(*) FROM builder_conversations WHERE id='${CONV_1}'`, 1);
expectEqual('the author and the named participants are enrolled',
  `SELECT count(*) FROM builder_conversation_participants WHERE conversation_id='${CONV_1}'`, 2);
expectEqual('and it wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log
   WHERE action='builder_conversation_created' AND entity_id='${CONV_1}'`, 't');
expectRejection('a conversation with no subject is rejected',
  `SELECT builder_create_conversation('${ACTOR}','command_user','${USER_B}','project','${PROJECT_1}',
     '{}'::jsonb,NULL,'x')`,
  'BUILDER_CONVERSATION_SUBJECT_REQUIRED');
expectRejection('a conversation on a missing scope is rejected',
  `SELECT builder_create_conversation('${ACTOR}','command_user','${USER_B}','project',
     '00000000-0000-0000-0000-0000000000ff','{"subject":"Orphan"}'::jsonb,NULL,'x')`,
  'BUILDER_SCOPE_TARGET_NOT_FOUND');

const MSG_1 = query(`SELECT (builder_post_message('${ACTOR}','command_user','${USER_B}','${CONV_1}',
  'Frame inspection is booked for Tuesday.','Builder User','fixture')).id`);
expectEqual('a message is posted through the guarded command',
  `SELECT count(*) FROM builder_messages WHERE id='${MSG_1}'`, 1);
expectEqual('the conversation counter and last_message_at follow the message',
  `SELECT (message_count=1 AND last_message_at IS NOT NULL)
   FROM builder_conversations WHERE id='${CONV_1}'`, 't');
expectRejection('an empty message is rejected',
  `SELECT builder_post_message('${ACTOR}','command_user','${USER_B}','${CONV_1}','   ',NULL,'x')`,
  'BUILDER_MESSAGE_BODY_REQUIRED');
expectRejection('a message cannot be edited',
  `UPDATE builder_messages SET body='tampered' WHERE id='${MSG_1}'`,
  'BUILDER_MESSAGE_IMMUTABLE');
expectRejection('a message cannot be deleted',
  `DELETE FROM builder_messages WHERE id='${MSG_1}'`,
  'BUILDER_MESSAGE_IMMUTABLE');
expectRejection('a message cannot be posted to an unknown conversation',
  `SELECT builder_post_message('${ACTOR}','command_user','${USER_B}',
     '00000000-0000-0000-0000-0000000000ff','hello',NULL,'x')`,
  'BUILDER_CONVERSATION_NOT_FOUND');

expectEqual("the author's own message is not unread for the author",
  `SELECT unread_messages FROM builder_unread_counts('${USER_B}')`, 0);
expectEqual('but it is unread for the other participant',
  `SELECT unread_messages FROM builder_unread_counts('${USER_C}')`, 1);
run(['-c', `SELECT builder_mark_conversation_read('${ACTOR}','command_user','${USER_C}','${CONV_1}')`]);
expectEqual('marking it read clears the count',
  `SELECT unread_messages FROM builder_unread_counts('${USER_C}')`, 0);
expectEqual('and marking read wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log
   WHERE action='builder_conversation_read' AND entity_id='${CONV_1}'`, 't');
expectRejection('a non-participant cannot move a read watermark',
  `SELECT builder_mark_conversation_read('${ACTOR}','command_user','${USER_O}','${CONV_1}')`,
  'BUILDER_NOT_A_PARTICIPANT');
expectRejection('an unknown conversation cannot be marked read',
  `SELECT builder_mark_conversation_read('${ACTOR}','command_user','${USER_B}',
     '00000000-0000-0000-0000-0000000000ff')`,
  'BUILDER_CONVERSATION_NOT_FOUND');

expectEqual('a participant who reaches the scope sees the conversation',
  `SELECT builder_can_see_conversation('${USER_B}','${CONV_1}','view')`, 't');
run(['-c', `INSERT INTO builder_conversation_participants(conversation_id, builder_user_id)
  VALUES ('${CONV_1}','${USER_O}')`]);
expectEqual('participation cannot WIDEN — the outside user is still refused',
  `SELECT builder_can_see_conversation('${USER_O}','${CONV_1}','view')`, 'f');
expectEqual('and the outside participant scores no unread messages',
  `SELECT unread_messages FROM builder_unread_counts('${USER_O}')`, 0);
run(['-c', `DELETE FROM builder_conversation_participants
  WHERE conversation_id='${CONV_1}' AND builder_user_id='${USER_O}'`]);

const CONV_OPEN = query(`SELECT (builder_create_conversation('${ACTOR}','command_user',NULL,
  'project','${PROJECT_1}','{"subject":"Site notices"}'::jsonb,NULL,'fixture')).id`);
expectEqual('a conversation with no participants is open to everyone in scope',
  `SELECT (builder_can_see_conversation('${USER_B}','${CONV_OPEN}','view')
       AND builder_can_see_conversation('${USER_C}','${CONV_OPEN}','view'))`, 't');
expectEqual('but still closed to a user outside the scope',
  `SELECT builder_can_see_conversation('${USER_O}','${CONV_OPEN}','view')`, 'f');
run(['-c', `UPDATE builder_conversations SET status='archived' WHERE id='${CONV_OPEN}'`]);
expectRejection('an archived conversation refuses new messages',
  `SELECT builder_post_message('${ACTOR}','command_user','${USER_B}','${CONV_OPEN}','late',NULL,'x')`,
  'BUILDER_CONVERSATION_ARCHIVED');

const CONV_P2 = query(`SELECT (builder_create_conversation('${ACTOR}','command_user',NULL,
  'project','${PROJECT_2}','{"subject":"Other project"}'::jsonb,NULL,'fixture')).id`);
expectEqual('access to one project does not reach another project conversation',
  `SELECT builder_can_see_conversation('${USER_B}','${CONV_P2}','view')`, 'f');
expectEqual('the accessible conversation set excludes it',
  `SELECT count(*) FROM builder_accessible_conversations('${USER_B}')
   WHERE conversation_id='${CONV_P2}'`, 0);
expectEqual('an unknown conversation is never visible',
  `SELECT builder_can_see_conversation('${USER_B}','00000000-0000-0000-0000-0000000000ff','view')`, 'f');

// ===========================================================================
// 6. Tasks, assignments and due dates
// ===========================================================================
console.log('\nTasks, assignments and due dates');
const TASK_1 = query(`SELECT (builder_upsert_task('${ACTOR}','command_user','${USER_B}',
  NULL,'construction_case','${CASE_1}',
  '{"title":"Book the frame inspection","priority":"high","due_date":"2026-01-05"}'::jsonb,
  NULL,'fixture')).id`);
expectEqual('a task is created through the guarded command',
  `SELECT count(*) FROM builder_tasks WHERE id='${TASK_1}'`, 1);
expectEqual('a new task is open with its due date and priority',
  `SELECT (status='open' AND priority='high' AND due_date='2026-01-05')
   FROM builder_tasks WHERE id='${TASK_1}'`, 't');
expectRejection('a task with no title is rejected',
  `SELECT builder_upsert_task('${ACTOR}','command_user',NULL,NULL,'project','${PROJECT_1}',
     '{}'::jsonb,NULL,'x')`,
  'BUILDER_TASK_TITLE_REQUIRED');
expectRejection('a task update without expected_version is rejected',
  `SELECT builder_upsert_task('${ACTOR}','command_user',NULL,'${TASK_1}',NULL,NULL,
     '{"status":"done"}'::jsonb,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('a task update with a stale expected_version is rejected',
  `SELECT builder_upsert_task('${ACTOR}','command_user',NULL,'${TASK_1}',NULL,NULL,
     '{"status":"done"}'::jsonb,999999,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('an unknown task cannot be updated',
  `SELECT builder_upsert_task('${ACTOR}','command_user',NULL,
     '00000000-0000-0000-0000-0000000000ff',NULL,NULL,'{}'::jsonb,1,'x')`,
  'BUILDER_TASK_NOT_FOUND');
expectRejection('a task status outside the closed list is refused',
  `UPDATE builder_tasks SET status='invented' WHERE id='${TASK_1}'`,
  'builder_tasks_status_check');

const ASSIGN_1 = query(`SELECT (builder_set_task_assignment('${ACTOR}','command_user','${USER_B}',
  '${TASK_1}','${USER_C}',false,NULL,'assigned to the site supervisor')).id`);
expectEqual('an assignment is created through the guarded command',
  `SELECT count(*) FROM builder_task_assignments WHERE id='${ASSIGN_1}'`, 1);
expectEqual('assignment raises a notification for the assignee',
  `SELECT count(*) FROM builder_notifications
   WHERE builder_user_id='${USER_C}' AND notification_type='task_assigned' AND entity_id='${TASK_1}'`, 1);
expectEqual('the notification points at the task and copies nothing but its title',
  `SELECT (entity_kind='task' AND scope_type='construction_case' AND scope_id='${CASE_1}'
       AND body='Book the frame inspection')
   FROM builder_notifications WHERE entity_id='${TASK_1}' AND builder_user_id='${USER_C}'`, 't');
expectRejection('an assignment update without expected_version is rejected',
  `SELECT builder_set_task_assignment('${ACTOR}','command_user',NULL,'${TASK_1}','${USER_C}',
     true,NULL,'x')`,
  'BUILDER_STALE_WRITE');
expectRejection('an absent assignment cannot be unassigned',
  `SELECT builder_set_task_assignment('${ACTOR}','command_user',NULL,'${TASK_1}','${USER_B}',
     true,NULL,'x')`,
  'BUILDER_ASSIGNMENT_NOT_FOUND');
expectRejection('an assignment on an unknown task is rejected',
  `SELECT builder_set_task_assignment('${ACTOR}','command_user',NULL,
     '00000000-0000-0000-0000-0000000000ff','${USER_C}',false,NULL,'x')`,
  'BUILDER_TASK_NOT_FOUND');

expectEqual('an overdue assigned task is counted for the assignee',
  `SELECT overdue_tasks FROM builder_unread_counts('${USER_C}')`, 1);
expectEqual('and not for someone who is not assigned',
  `SELECT overdue_tasks FROM builder_unread_counts('${USER_B}')`, 0);
run(['-c', `SELECT builder_upsert_task('${ACTOR}','command_user',NULL,'${TASK_1}',NULL,NULL,
  '{"status":"done"}'::jsonb,(SELECT row_version FROM builder_tasks WHERE id='${TASK_1}'),'complete')`]);
expectEqual('completing the task stamps completed_at',
  `SELECT completed_at IS NOT NULL FROM builder_tasks WHERE id='${TASK_1}'`, 't');
expectEqual('and it no longer counts as overdue',
  `SELECT overdue_tasks FROM builder_unread_counts('${USER_C}')`, 0);
run(['-c', `SELECT builder_upsert_task('${ACTOR}','command_user',NULL,'${TASK_1}',NULL,NULL,
  '{"status":"open"}'::jsonb,(SELECT row_version FROM builder_tasks WHERE id='${TASK_1}'),'reopen')`]);
expectEqual('reopening the task clears completed_at',
  `SELECT completed_at IS NULL FROM builder_tasks WHERE id='${TASK_1}'`, 't');
run(['-c', `SELECT builder_set_task_assignment('${ACTOR}','command_user',NULL,'${TASK_1}','${USER_C}',
  true,(SELECT row_version FROM builder_task_assignments WHERE id='${ASSIGN_1}'),'reassigned')`]);
expectEqual('an unassigned user stops counting the task as overdue',
  `SELECT overdue_tasks FROM builder_unread_counts('${USER_C}')`, 0);

const TASK_P2 = query(`SELECT (builder_upsert_task('${ACTOR}','command_user',NULL,
  NULL,'project','${PROJECT_2}','{"title":"Other project task"}'::jsonb,NULL,'fixture')).id`);
expectEqual('access to one project does not reach another project task',
  `SELECT builder_resolve_scope_permission('${USER_B}','project','${PROJECT_2}','tasks','view')`, 'f');
expectEqual('the accessible task set excludes it',
  `SELECT count(*) FROM builder_accessible_tasks('${USER_B}') WHERE task_id='${TASK_P2}'`, 0);
expectEqual('the accessible task set includes the reachable one',
  `SELECT count(*) FROM builder_accessible_tasks('${USER_B}') WHERE task_id='${TASK_1}'`, 1);
expectEqual('the accessible task set is empty for an outside user',
  `SELECT count(*) FROM builder_accessible_tasks('${USER_O}')`, 0);

// ===========================================================================
// 7. Notifications
// ===========================================================================
console.log('\nNotifications');
run(['-c', `INSERT INTO builder_notifications(builder_user_id, organisation_id, notification_type,
  title, body) VALUES ('${USER_B}','${BLD_ORG}','general','Site meeting moved','Now Thursday')`]);
expectEqual('an unread notification is counted',
  `SELECT unread_notifications FROM builder_unread_counts('${USER_B}')`, 1);
const OTHER_NOTIFICATION = query(
  `SELECT id FROM builder_notifications WHERE builder_user_id='${USER_C}' LIMIT 1`);
expectEqual("marking someone else's notification read affects nothing",
  `SELECT builder_mark_notifications_read('${ACTOR}','command_user','${USER_B}',
     ARRAY['${OTHER_NOTIFICATION}']::uuid[])`, 0);
expectEqual("and that notification is still unread for its owner",
  `SELECT read_at IS NULL FROM builder_notifications WHERE id='${OTHER_NOTIFICATION}'`, 't');
expectEqual('marking own notifications read returns the number changed',
  `SELECT builder_mark_notifications_read('${ACTOR}','command_user','${USER_B}',NULL)`, 1);
expectEqual('and the unread count is cleared',
  `SELECT unread_notifications FROM builder_unread_counts('${USER_B}')`, 0);
expectEqual('and it wrote a trusted audit row',
  `SELECT count(*)>0 FROM builder_portal_activity_log WHERE action='builder_notifications_read'`, 't');
expectRejection('a notification read with no reader identity is rejected',
  `SELECT builder_mark_notifications_read('${ACTOR}','command_user',NULL,NULL)`,
  'BUILDER_NOTIFICATION_READER_REQUIRED');
expectEqual('a notification type outside the closed list is refused',
  `SELECT count(*) FROM pg_constraint WHERE conname='builder_notifications_notification_type_check'`, 1);

// ===========================================================================
// 8. Access control — membership is the hard gate
// ===========================================================================
console.log('\nAccess control');
const MEMBERSHIP_B = query(
  `SELECT id FROM builder_organisation_memberships
   WHERE builder_user_id='${USER_B}' AND organisation_id='${BLD_ORG}'`);
run(['-c', `SELECT builder_admin_upsert_project_access('${ACTOR}','command_user','${USER_B}',
  '${PROJECT_1}','builder','team_member',
  '{"documents":{"view":"allow","edit":"allow"},"messages":{"view":"allow"},"tasks":{"view":"allow"}}'::jsonb,
  NULL,(SELECT row_version FROM builder_project_access
        WHERE builder_user_id='${USER_B}' AND project_id='${PROJECT_1}'),'grant override')`]);
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='construction_case';
  INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
    scope_id, view_decision, edit_decision, delete_decision)
  VALUES ('${MEMBERSHIP_B}','documents','construction_case','${CASE_1}','allow','allow','inherit')`]);
expectEqual('with both overlapping allow overrides, the document resolves true',
  `SELECT builder_can_see_document('${USER_B}','${DOC_1}','view')`, 't');

run(['-c', `UPDATE builder_organisation_memberships SET status='revoked', revoked_at=now(),
  revoked_reason='test' WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('a revoked membership denies the document despite both allows',
  `SELECT builder_can_see_document('${USER_B}','${DOC_1}','view')`, 'f');
expectEqual('and denies the conversation',
  `SELECT builder_can_see_conversation('${USER_B}','${CONV_1}','view')`, 'f');
expectEqual('and denies the task scope',
  `SELECT builder_resolve_scope_permission('${USER_B}','construction_case','${CASE_1}','tasks','view')`, 'f');
expectEqual('and every accessible set is empty',
  `SELECT (SELECT count(*) FROM builder_accessible_documents('${USER_B}'))
        + (SELECT count(*) FROM builder_accessible_conversations('${USER_B}'))
        + (SELECT count(*) FROM builder_accessible_tasks('${USER_B}'))`, 0);
expectEqual('and the unread message count collapses to zero',
  `SELECT unread_messages FROM builder_unread_counts('${USER_B}')`, 0);
run(['-c', `UPDATE builder_organisation_memberships SET status='suspended', revoked_at=NULL,
  revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('a suspended membership denies as well',
  `SELECT builder_can_see_document('${USER_B}','${DOC_1}','view')`, 'f');
run(['-c', `UPDATE builder_organisation_memberships SET status='active',
  revoked_at=NULL, revoked_reason=NULL WHERE id='${MEMBERSHIP_B}'`]);
expectEqual('restoring the membership restores collaboration access',
  `SELECT builder_can_see_document('${USER_B}','${DOC_1}','view')`, 't');
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='construction_case'`]);

expectEqual('every collaboration permission key carries a role baseline',
  `SELECT count(*) FROM unnest(ARRAY['documents','messages','tasks']) k
   WHERE NOT EXISTS (SELECT 1 FROM builder_role_default_permissions
     WHERE permission_key=k AND membership_role='manager' AND can_view)`, 0);
expectEqual('read_only cannot edit documents',
  `SELECT count(*) FROM builder_role_default_permissions
   WHERE membership_role='read_only' AND can_edit AND permission_key='documents'`, 0);
run(['-c', `INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type,
  scope_id, view_decision, edit_decision, delete_decision)
  VALUES ('${MEMBERSHIP_B}','documents','construction_case','${CASE_1}','deny','inherit','inherit')`]);
expectEqual('an explicit deny at the narrow scope beats the allow at the project',
  `SELECT builder_can_see_document('${USER_B}','${DOC_1}','view')`, 'f');
expectEqual('and the denied document drops out of the accessible set',
  `SELECT count(*) FROM builder_accessible_documents('${USER_B}') WHERE document_id='${DOC_1}'`, 0);
expectEqual('the deny is scoped — the conversation on the same case is unaffected',
  `SELECT builder_can_see_conversation('${USER_B}','${CONV_1}','view')`, 't');
run(['-c', `DELETE FROM builder_membership_permissions
  WHERE membership_id='${MEMBERSHIP_B}' AND scope_type='construction_case'`]);
expectEqual('removing the deny restores the document',
  `SELECT builder_can_see_document('${USER_B}','${DOC_1}','view')`, 't');

// ===========================================================================
// 9. Audit failure rolls the mutation back
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
  documents: query('SELECT count(*) FROM builder_documents'),
  versions: query('SELECT count(*) FROM builder_document_versions'),
  grants: query('SELECT count(*) FROM builder_document_grants'),
  conversations: query('SELECT count(*) FROM builder_conversations'),
  messages: query('SELECT count(*) FROM builder_messages'),
  tasks: query('SELECT count(*) FROM builder_tasks'),
  assignments: query('SELECT count(*) FROM builder_task_assignments'),
  notifications: query('SELECT count(*) FROM builder_notifications'),
  docTitle: query(`SELECT title FROM builder_documents WHERE id='${DOC_1}'`),
  currentVersion: query(`SELECT current_version_id FROM builder_documents WHERE id='${DOC_1}'`),
  messageCount: query(`SELECT message_count FROM builder_conversations WHERE id='${CONV_1}'`),
};

for (const [label, sql, key, table] of [
  ['document creation', `SELECT builder_upsert_document('${ACTOR}','command_user',NULL,NULL,'project','${PROJECT_1}','{"title":"NOPE"}'::jsonb,NULL,'x')`, 'documents', 'builder_documents'],
  ['version creation', `SELECT builder_add_document_version('${ACTOR}','command_user',NULL,'${DOC_1}','{"storage_path":"x/nope.pdf","file_name":"nope.pdf"}'::jsonb,'x')`, 'versions', 'builder_document_versions'],
  ['grant creation', `SELECT builder_set_document_grant('${ACTOR}','command_user',NULL,'${DOC_1}','${USER_C}',true,false,NULL,'x')`, 'grants', 'builder_document_grants'],
  ['conversation creation', `SELECT builder_create_conversation('${ACTOR}','command_user','${USER_B}','project','${PROJECT_1}','{"subject":"NOPE"}'::jsonb,NULL,'x')`, 'conversations', 'builder_conversations'],
  ['message posting', `SELECT builder_post_message('${ACTOR}','command_user','${USER_B}','${CONV_1}','NOPE',NULL,'x')`, 'messages', 'builder_messages'],
  ['task creation', `SELECT builder_upsert_task('${ACTOR}','command_user',NULL,NULL,'project','${PROJECT_1}','{"title":"NOPE"}'::jsonb,NULL,'x')`, 'tasks', 'builder_tasks'],
  ['assignment creation', `SELECT builder_set_task_assignment('${ACTOR}','command_user',NULL,'${TASK_1}','${USER_B}',false,NULL,'x')`, 'assignments', 'builder_task_assignments'],
]) {
  expectRejection(`${label} fails when the trusted audit write fails`, sql, 'SIMULATED_AUDIT_OUTAGE');
  expectEqual(`and no ${label.split(' ')[0]} row survives`,
    `SELECT count(*) FROM ${table}`, before[key]);
}
expectEqual('the assignment rollback also rolled back its notification',
  'SELECT count(*) FROM builder_notifications', before.notifications);
expectEqual('a failed version add left the document pointing at the old version',
  `SELECT current_version_id FROM builder_documents WHERE id='${DOC_1}'`, before.currentVersion);
expectEqual('a failed message left the conversation counter untouched',
  `SELECT message_count FROM builder_conversations WHERE id='${CONV_1}'`, before.messageCount);

expectRejection('a document update fails when the trusted audit write fails',
  `SELECT builder_upsert_document('${ACTOR}','command_user',NULL,'${DOC_1}',NULL,NULL,
     '{"title":"TAMPERED"}'::jsonb,
     (SELECT row_version FROM builder_documents WHERE id='${DOC_1}'),'x')`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual('and the document title is unchanged',
  `SELECT title FROM builder_documents WHERE id='${DOC_1}'`, before.docTitle);
expectRejection('marking notifications read fails when the trusted audit write fails',
  `SELECT builder_mark_notifications_read('${ACTOR}','command_user','${USER_C}',NULL)`,
  'SIMULATED_AUDIT_OUTAGE');
expectEqual("and the assignee's notification is still unread",
  `SELECT read_at IS NULL FROM builder_notifications WHERE id='${OTHER_NOTIFICATION}'`, 't');

run(['-c', 'DROP TRIGGER trg_force_audit_failure ON public.builder_portal_activity_log;']);
expectEqual('with audit restored, a document is created again',
  `SELECT (builder_upsert_document('${ACTOR}','command_user',NULL,NULL,'project','${PROJECT_1}',
     '{"title":"Site induction pack"}'::jsonb,NULL,'ok')).title`, 'Site induction pack');

// ===========================================================================
// 10. Solicitor regression
// ===========================================================================
console.log('\nSolicitor regression');
expectEqual('the Solicitor firm table is untouched by the collaboration migration',
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
console.log(`Collaboration local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
console.log('All collaboration conditions verified against a live PostgreSQL database.');
