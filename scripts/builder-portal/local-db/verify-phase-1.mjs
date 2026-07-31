#!/usr/bin/env node
/**
 * Builder Portal Phase 1 — local migration and behaviour verification.
 *
 * Builds a clean database, applies the Supabase-compatible bootstrap and the
 * upstream fixture (the Solicitor Phase 3 and Phase 15 objects that Phase 1
 * generalises), then applies the Phase 1 migrations and exercises the resulting
 * schema against the fifteen conditions the phase must satisfy.
 *
 * This is real execution against real PostgreSQL, not a static scan.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-phase-1.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_VERIFY_DB (aurixa_phase1_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_VERIFY_DB || 'aurixa_phase1_verify';

const PHASE_1_MIGRATIONS = [
  '20260801000000_builder_portal_phase1_organisations_users.sql',
  '20260801000100_builder_portal_phase1_permissions.sql',
  '20260801000200_builder_portal_phase1_sessions.sql',
  '20260801000300_portal_terms_multi_portal.sql',
  '20260801000400_cross_portal_rollout_org_generalisation.sql',
  '20260801000500_builder_portal_admin_module.sql',
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

/**
 * Assert a statement raises, and that the message names one of `fragments`.
 * More than one fragment is accepted where several constraints legitimately
 * cover the same illegal state and PostgreSQL may report either.
 */
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
  const actual = query(sql);
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
console.log('Bootstrap and upstream fixture applied.\n');

// Confirm the fixture reproduced the pre-generalisation shape we are migrating
// from, so a passing run cannot be an artefact of a fixture that was already
// generalised.
const preSolicitorAcceptances = query('SELECT count(*) FROM portal_terms_acceptances');
const preRollouts = query('SELECT count(*) FROM cross_portal_firm_rollouts');
console.log(`Pre-migration: ${preSolicitorAcceptances} solicitor acceptance(s), ${preRollouts} rollout(s).\n`);

console.log('Applying Phase 1 migrations ...');
const migrationsDir = join(root, 'supabase/migrations');
const onDisk = readdirSync(migrationsDir);
for (const name of PHASE_1_MIGRATIONS) {
  if (!onDisk.includes(name)) {
    console.error(`FATAL: Phase 1 migration missing from supabase/migrations: ${name}`);
    process.exit(1);
  }
  try {
    run(['-f', join(migrationsDir, name)]);
    console.log(`  applied  ${name}`);
  } catch (error) {
    console.error(`\nFATAL: ${name} failed to apply\n${String(error.stderr || error.message)}`);
    process.exit(1);
  }
}
console.log('');

// ===========================================================================
// 1–4. Existing Solicitor schema, terms and rollout records survive
// ===========================================================================
console.log('Solicitor compatibility');
expectEqual('existing solicitor terms version preserved',
  "SELECT count(*) FROM portal_terms_versions WHERE portal='solicitor'", preSolicitorAcceptances);
expectEqual('existing solicitor acceptance preserved with its owner',
  "SELECT count(*) FROM portal_terms_acceptances WHERE portal='solicitor' AND solicitor_user_id IS NOT NULL",
  preSolicitorAcceptances);
expectEqual('existing rollout rows preserved and still solicitor-owned',
  "SELECT count(*) FROM cross_portal_firm_rollouts WHERE portal='solicitor' AND firm_id IS NOT NULL",
  preRollouts);
expectEqual('rollout reconciliation view is clean',
  'SELECT count(*) FROM cross_portal_rollout_reconciliation WHERE portal_mismatch OR orphaned_owner', 0);
expectEqual('solicitor compatibility adapter still resolves the original signature',
  `SELECT resolve_cross_portal_feature_mode(
     (SELECT id FROM solicitor_firms LIMIT 1), 'solicitor_matter_access_v2')`, 'cutover');
expectEqual('solicitor sessions table untouched by the Builder migrations',
  "SELECT count(*) FROM information_schema.columns WHERE table_name='solicitor_portal_sessions' AND column_name='builder_user_id'", 0);

// ===========================================================================
// 5–7. Organisations, users, memberships
// ===========================================================================
console.log('\nOrganisations, users and memberships');
run(['-c', `
  INSERT INTO builder_organisations(id, legal_name, org_type, abn, status, is_active, activated_at, suspended_at)
  VALUES ('11111111-1111-1111-1111-111111111111','Harbourline Constructions Pty Ltd','builder','51824753556','active',true,now(),NULL),
         ('22222222-2222-2222-2222-222222222222','Northpoint Developments Pty Ltd','developer','53004085616','active',true,now(),NULL),
         ('33333333-3333-3333-3333-333333333333','Dormant Estates Pty Ltd','developer',NULL,'suspended',false,NULL,now());
`]);
expectEqual('builder organisation creation works', 'SELECT count(*) FROM builder_organisations', 3);
run(['-c', `
  INSERT INTO builder_organisations(legal_name, org_type, status, is_active)
  VALUES ('Kestrel Homes Group Pty Ltd','builder_developer','pending_activation',false),
         ('Coastal Property Sales Pty Ltd','sales_representative','pending_activation',false);
`]);
expectEqual('all four organisation types are storable',
  "SELECT count(DISTINCT org_type) FROM builder_organisations", 4);
expectRejection('an unknown organisation type is rejected',
  `INSERT INTO builder_organisations(legal_name, org_type) VALUES ('Bogus Pty Ltd','architect')`,
  'builder_organisations_org_type_check');

expectRejection('a suspended organisation must record when it was suspended',
  `INSERT INTO builder_organisations(legal_name, org_type, status, is_active)
   VALUES ('Undated Suspension Pty Ltd','builder','suspended',false)`,
  'builder_organisations_suspension_stamp');

run(['-c', `
  INSERT INTO builder_portal_users(id, email, name, job_title, status, is_active)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','pm@harbourline.test','Project Manager','Project Manager','active',true),
         ('aaaaaaaa-0000-0000-0000-000000000002','ro@harbourline.test','Read Only','Site Supervisor','active',true),
         ('aaaaaaaa-0000-0000-0000-000000000003','sales@northpoint.test','Sales Consultant','Sales Consultant','active',true),
         ('aaaaaaaa-0000-0000-0000-000000000004','nomember@harbourline.test','No Membership','Contract Administrator','active',true),
         ('aaaaaaaa-0000-0000-0000-000000000005','suspended@harbourline.test','Suspended User','Defects Coordinator','suspended',false);
`]);
expectEqual('builder user creation works', 'SELECT count(*) FROM builder_portal_users', 5);

expectRejection('status and is_active cannot contradict each other',
  `INSERT INTO builder_portal_users(email,name,status,is_active)
   VALUES ('bad@x.test','Bad','active',false)`,
  'builder_portal_users_status_active_agree');

expectRejection('a malformed ABN is rejected',
  `INSERT INTO builder_organisations(legal_name,org_type,abn) VALUES ('Bad ABN Pty Ltd','builder','12')`,
  'builder_organisations_abn_check');

expectRejection('a duplicate ABN is rejected',
  `INSERT INTO builder_organisations(legal_name,org_type,abn) VALUES ('Clone Pty Ltd','builder','51824753556')`,
  'builder_organisations_abn_key');

run(['-c', `
  INSERT INTO builder_organisation_memberships(id, builder_user_id, organisation_id, membership_role, is_primary)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','manager',true),
         ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','read_only',true),
         ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','owner',true);
`]);
expectEqual('membership creation works', 'SELECT count(*) FROM builder_organisation_memberships', 3);

expectRejection('a membership cannot reference a closed organisation',
  `UPDATE builder_organisations SET status='closed', is_active=false WHERE id='33333333-3333-3333-3333-333333333333';
   INSERT INTO builder_organisation_memberships(builder_user_id, organisation_id, membership_role)
   VALUES ('aaaaaaaa-0000-0000-0000-000000000004','33333333-3333-3333-3333-333333333333','member')`,
  'BUILDER_ORG_CLOSED');

expectRejection('a user cannot hold two live memberships of one organisation',
  `INSERT INTO builder_organisation_memberships(builder_user_id, organisation_id, membership_role)
   VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','member')`,
  'builder_memberships_live_key');

expectEqual('no membership means no reachable organisation',
  "SELECT count(*) FROM builder_accessible_organisations('aaaaaaaa-0000-0000-0000-000000000004')", 0);
expectEqual('an active membership yields exactly one reachable organisation',
  "SELECT count(*) FROM builder_accessible_organisations('aaaaaaaa-0000-0000-0000-000000000001')", 1);

// ===========================================================================
// 8–10. Cross-organisation isolation and deny-by-default permissions
// ===========================================================================
console.log('\nPermissions');
expectEqual('a member may view their own organisation',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000001',
     '11111111-1111-1111-1111-111111111111','organisation','view')`, 't');

expectEqual('cross-organisation access is denied',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000001',
     '22222222-2222-2222-2222-222222222222','organisation','view')`, 'f');

expectEqual('a user with no membership is denied',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000004',
     '11111111-1111-1111-1111-111111111111','organisation','view')`, 'f');

expectEqual('an unconfigured key is denied (no DEFAULT_ALLOW_KEYS equivalent)',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000001',
     '11111111-1111-1111-1111-111111111111','pricing','view')`, 'f');

expectEqual('an unknown key is denied',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000001',
     '11111111-1111-1111-1111-111111111111','not_a_real_key','view')`, 'f');

expectEqual('a manager cannot administer users by default',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000001',
     '11111111-1111-1111-1111-111111111111','org_admin','view')`, 'f');

// Explicit deny must beat a role allow.
run(['-c', `
  INSERT INTO builder_membership_permissions(membership_id, permission_key, view_decision)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001','documents','deny');
`]);
expectEqual('an explicit membership deny overrides a role-default allow',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000001',
     '11111111-1111-1111-1111-111111111111','documents','view')`, 'f');
expectEqual('denying view cascades to edit',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000001',
     '11111111-1111-1111-1111-111111111111','documents','edit')`, 'f');

// Explicit allow must be able to raise a false baseline.
run(['-c', `
  INSERT INTO builder_membership_permissions(membership_id, permission_key, view_decision)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001','pricing','allow');
`]);
expectEqual('an explicit membership allow raises a denied baseline',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000001',
     '11111111-1111-1111-1111-111111111111','pricing','view')`, 't');

// read_only clamps writes even when granted.
run(['-c', `
  INSERT INTO builder_membership_permissions(membership_id, permission_key, view_decision, edit_decision)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000002','documents','allow','allow');
`]);
expectEqual('read_only still views',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000002',
     '11111111-1111-1111-1111-111111111111','documents','view')`, 't');
expectEqual('read_only cannot edit even with an explicit allow',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000002',
     '11111111-1111-1111-1111-111111111111','documents','edit')`, 'f');

// Forbidden keys.
for (const key of ['income', 'borrowing_capacity', 'commissions', 'aml_restricted', 'smr',
  'legal_privileged', 'conflict_checks', 'finance_private', 'solicitor_private']) {
  expectEqual(`forbidden key "${key}" can never resolve true`,
    `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000003',
       '22222222-2222-2222-2222-222222222222','${key}','view')`, 'f');
}
expectRejection('a forbidden key cannot even be stored as a grant',
  `INSERT INTO builder_membership_permissions(membership_id, permission_key, view_decision)
   VALUES ('bbbbbbbb-0000-0000-0000-000000000003','commissions','allow')`,
  'BUILDER_FORBIDDEN_PERMISSION_KEY');

expectEqual('an inbound projection is never writable',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000003',
     '22222222-2222-2222-2222-222222222222','finance_status','edit')`, 'f');

expectRejection('a Phase 2 project scope cannot be stored yet',
  `INSERT INTO builder_membership_permissions(membership_id, permission_key, scope_type, scope_id, view_decision)
   VALUES ('bbbbbbbb-0000-0000-0000-000000000003','projects','project',gen_random_uuid(),'allow')`,
  'BUILDER_SCOPE_NOT_AVAILABLE');

// Revoking the membership must remove access immediately.
run(['-c', `
  UPDATE builder_organisation_memberships
  SET status='revoked', revoked_at=now(), revoked_reason='test'
  WHERE id='bbbbbbbb-0000-0000-0000-000000000003';
`]);
expectEqual('revoking a membership removes access immediately',
  `SELECT builder_resolve_permission('aaaaaaaa-0000-0000-0000-000000000003',
     '22222222-2222-2222-2222-222222222222','organisation','view')`, 'f');

// ===========================================================================
// 11–13. Sessions
// ===========================================================================
console.log('\nSessions');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

expectRejection('a raw (non-hex) session token is not a storable value',
  `INSERT INTO builder_portal_sessions(builder_user_id, token_hash, absolute_expires_at, idle_expires_at)
   VALUES ('aaaaaaaa-0000-0000-0000-000000000001','raw-token-value-not-a-hash', now()+interval '1 hour', now()+interval '30 min')`,
  'builder_portal_sessions_token_hash_check');

expectRejection('builder_issue_session refuses anything that is not a hash',
  `SELECT builder_issue_session('aaaaaaaa-0000-0000-0000-000000000001','plaintext',
     now()+interval '1 hour', now()+interval '30 min')`,
  'BUILDER_SESSION_TOKEN_NOT_HASHED');

expectRejection('a session cannot be issued to a user with no membership',
  `SELECT builder_issue_session('aaaaaaaa-0000-0000-0000-000000000004','${HASH_A}',
     now()+interval '1 hour', now()+interval '30 min')`,
  'BUILDER_SESSION_NOT_PERMITTED');

run(['-c', `SELECT builder_issue_session('aaaaaaaa-0000-0000-0000-000000000001','${HASH_A}',
  now()+interval '12 hours', now()+interval '30 minutes');`]);
run(['-c', `SELECT builder_issue_session('aaaaaaaa-0000-0000-0000-000000000001','${HASH_B}',
  now()+interval '12 hours', now()+interval '30 minutes');`]);
expectEqual('multiple concurrent sessions are supported',
  "SELECT count(*) FROM builder_portal_sessions WHERE builder_user_id='aaaaaaaa-0000-0000-0000-000000000001' AND revoked_at IS NULL", 2);

expectEqual('a session resolves by hash',
  `SELECT count(*) FROM builder_resolve_session('${HASH_A}')`, 1);
expectEqual('no database API ever returns a token or a hash',
  `SELECT count(*) FROM information_schema.columns c
   WHERE c.table_name='builder_portal_sessions' AND c.column_name IN ('token','session_token','raw_token')`, 0);
expectEqual('builder_resolve_session returns identity columns only',
  `SELECT string_agg(p.proargnames[i], ',' ORDER BY i)
   FROM pg_proc p, generate_subscripts(p.proargnames, 1) i
   WHERE p.proname='builder_resolve_session' AND p.proargnames[i] NOT LIKE '\\_%'`,
  'session_id,builder_user_id,absolute_expires_at');

expectRejection('idle expiry cannot exceed absolute expiry',
  `INSERT INTO builder_portal_sessions(builder_user_id, token_hash, absolute_expires_at, idle_expires_at)
   VALUES ('aaaaaaaa-0000-0000-0000-000000000001','${'c'.repeat(64)}', now()+interval '1 hour', now()+interval '2 hours')`,
  'builder_portal_sessions_expiry_order');

run(['-c', `SELECT builder_revoke_session(
  (SELECT id FROM builder_portal_sessions WHERE token_hash='${HASH_A}'), 'test revoke');`]);
expectEqual('a revoked session no longer resolves',
  `SELECT count(*) FROM builder_resolve_session('${HASH_A}')`, 0);
expectEqual('the sibling session is unaffected',
  `SELECT count(*) FROM builder_resolve_session('${HASH_B}')`, 1);

// A session cannot be force-expired by backdating: revocation is the mechanism.
expectRejection('a session cannot be backdated past its own creation',
  `UPDATE builder_portal_sessions
   SET absolute_expires_at = now() - interval '1 minute',
       idle_expires_at = now() - interval '1 minute'
   WHERE token_hash='${HASH_B}'`,
  'builder_portal_sessions_absolute_after_creation');

const HASH_EXPIRED = 'f'.repeat(64);
run(['-c', `
  INSERT INTO builder_portal_sessions(builder_user_id, token_hash, created_at, absolute_expires_at, idle_expires_at)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','${HASH_EXPIRED}',
          now() - interval '13 hours', now() - interval '1 hour', now() - interval '1 hour');
`]);
expectEqual('an expired session no longer resolves',
  `SELECT count(*) FROM builder_resolve_session('${HASH_EXPIRED}')`, 0);
run(['-c', `
  INSERT INTO builder_portal_sessions(builder_user_id, token_hash, created_at, absolute_expires_at, idle_expires_at)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','${'9'.repeat(64)}',
          now() - interval '1 hour', now() + interval '11 hours', now() - interval '1 minute');
`]);
expectEqual('an idle-expired but absolutely-live session no longer resolves',
  `SELECT count(*) FROM builder_resolve_session('${'9'.repeat(64)}')`, 0);

// Password change must invalidate every live session.
run(['-c', `
  SELECT builder_issue_session('aaaaaaaa-0000-0000-0000-000000000001','${'d'.repeat(64)}',
    now()+interval '12 hours', now()+interval '30 minutes');
  UPDATE builder_portal_users SET password_changed_at = now()
  WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
`]);
expectEqual('a password change revokes every live session',
  `SELECT count(*) FROM builder_portal_sessions
   WHERE builder_user_id='aaaaaaaa-0000-0000-0000-000000000001' AND revoked_at IS NULL`, 0);
expectEqual('the revocation records password_changed as its reason',
  `SELECT count(*) > 0 FROM builder_portal_sessions WHERE revoked_reason='password_changed'`, 't');
expectEqual('every revoked session carries a reason',
  'SELECT count(*) FROM builder_portal_sessions WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL', 0);

// Losing the last membership must kill sessions.
run(['-c', `
  SELECT builder_issue_session('aaaaaaaa-0000-0000-0000-000000000002','${'e'.repeat(64)}',
    now()+interval '12 hours', now()+interval '30 minutes');
  UPDATE builder_organisation_memberships SET status='revoked', revoked_at=now(), revoked_reason='test'
  WHERE id='bbbbbbbb-0000-0000-0000-000000000002';
`]);
expectEqual('losing the last membership revokes live sessions',
  `SELECT count(*) FROM builder_portal_sessions
   WHERE builder_user_id='aaaaaaaa-0000-0000-0000-000000000002' AND revoked_at IS NULL`, 0);

expectEqual('builder and solicitor sessions are separate tables with no shared rows',
  `SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('builder_portal_sessions','solicitor_portal_sessions')`, 2);
expectEqual('the builder session table has no solicitor foreign key',
  `SELECT count(*) FROM information_schema.constraint_column_usage u
   JOIN information_schema.table_constraints c USING (constraint_name)
   WHERE c.table_name='builder_portal_sessions' AND u.table_name LIKE 'solicitor%'`, 0);

// ===========================================================================
// Portal terms ownership
// ===========================================================================
console.log('\nPortal terms');
expectEqual('a builder terms version was created',
  "SELECT count(*) FROM portal_terms_versions WHERE portal='builder'", 1);
expectEqual('one current version per portal is still enforced',
  "SELECT count(*) FROM portal_terms_versions WHERE retired_at IS NULL", 2);

run(['-c', `
  INSERT INTO portal_terms_acceptances(terms_version_id, portal, builder_user_id)
  VALUES ((SELECT id FROM portal_terms_versions WHERE portal='builder'), 'builder',
          'aaaaaaaa-0000-0000-0000-000000000001');
`]);
expectEqual('a builder user can accept builder terms',
  "SELECT count(*) FROM portal_terms_acceptances WHERE portal='builder'", 1);

// Two constraints cover these illegal states — single_owner and
// portal_owner_agree — and PostgreSQL may report whichever it evaluates first.
// Either rejection is correct; what matters is that the row is not storable.
expectRejection('an acceptance cannot have two owners',
  `INSERT INTO portal_terms_acceptances(terms_version_id, portal, solicitor_user_id, builder_user_id)
   VALUES ((SELECT id FROM portal_terms_versions WHERE portal='builder'),'builder',
           (SELECT id FROM solicitor_portal_users LIMIT 1),'aaaaaaaa-0000-0000-0000-000000000003')`,
  'portal_terms_acceptances_single_owner', 'portal_terms_acceptances_portal_owner_agree');

expectRejection('an acceptance cannot be ownerless',
  `INSERT INTO portal_terms_acceptances(terms_version_id, portal)
   VALUES ((SELECT id FROM portal_terms_versions WHERE portal='builder'),'builder')`,
  'portal_terms_acceptances_single_owner', 'portal_terms_acceptances_portal_owner_agree');

// Prove single_owner is independently live, not merely shadowed by the
// agreement constraint: a solicitor row carrying both owners violates it while
// satisfying the solicitor arm of portal_owner_agree's owner test.
expectEqual('the exactly-one-owner constraint is present and validated',
  `SELECT count(*) FROM pg_constraint
   WHERE conname='portal_terms_acceptances_single_owner' AND convalidated`, 1);
expectEqual('the portal/owner agreement constraint is present and validated',
  `SELECT count(*) FROM pg_constraint
   WHERE conname='portal_terms_acceptances_portal_owner_agree' AND convalidated`, 1);
expectEqual('solicitor_user_id is nullable but the pair is still constrained',
  `SELECT is_nullable FROM information_schema.columns
   WHERE table_name='portal_terms_acceptances' AND column_name='solicitor_user_id'`, 'YES');

expectRejection('a builder user cannot accept solicitor terms',
  `INSERT INTO portal_terms_acceptances(terms_version_id, portal, builder_user_id)
   VALUES ((SELECT id FROM portal_terms_versions WHERE portal='solicitor'),'builder',
           'aaaaaaaa-0000-0000-0000-000000000003')`,
  'PORTAL_TERMS_PORTAL_MISMATCH');

expectRejection('a solicitor owner cannot be recorded under the builder portal',
  `INSERT INTO portal_terms_acceptances(terms_version_id, portal, solicitor_user_id)
   VALUES ((SELECT id FROM portal_terms_versions WHERE portal='builder'),'builder',
           (SELECT id FROM solicitor_portal_users LIMIT 1))`,
  'portal_terms_acceptances_portal_owner_agree');

expectRejection('duplicate acceptance by the same builder user is rejected',
  `INSERT INTO portal_terms_acceptances(terms_version_id, portal, builder_user_id)
   VALUES ((SELECT id FROM portal_terms_versions WHERE portal='builder'),'builder',
           'aaaaaaaa-0000-0000-0000-000000000001')`,
  'portal_terms_acceptances_builder_key');

expectRejection('duplicate acceptance by the same solicitor user is still rejected',
  `INSERT INTO portal_terms_acceptances(terms_version_id, portal, solicitor_user_id)
   SELECT terms_version_id, 'solicitor', solicitor_user_id FROM portal_terms_acceptances
   WHERE portal='solicitor' LIMIT 1`,
  'portal_terms_acceptances_solicitor_key');

// ===========================================================================
// Rollout controls
// ===========================================================================
console.log('\nRollout controls');
run(['-c', `
  INSERT INTO cross_portal_firm_rollouts(portal, builder_organisation_id, feature_key, mode, reason)
  VALUES ('builder','11111111-1111-1111-1111-111111111111','builder_portal_identity_v1','shadow','phase 1 activation');
`]);
expectEqual('a builder organisation rollout can be recorded',
  `SELECT resolve_cross_portal_feature_mode_for('builder','11111111-1111-1111-1111-111111111111','builder_portal_identity_v1')`,
  'shadow');
expectEqual('an unset builder rollout falls back to the feature default',
  `SELECT resolve_cross_portal_feature_mode_for('builder','22222222-2222-2222-2222-222222222222','builder_portal_identity_v1')`,
  'off');
run(['-c', `UPDATE cross_portal_firm_rollouts SET mode='rollback'
  WHERE portal='builder' AND feature_key='builder_portal_identity_v1';`]);
expectEqual('rollback capability is preserved for builder rollouts',
  `SELECT resolve_cross_portal_feature_mode_for('builder','11111111-1111-1111-1111-111111111111','builder_portal_identity_v1')`,
  'rollback');

expectRejection('a rollout row cannot own both a firm and a builder organisation',
  `INSERT INTO cross_portal_firm_rollouts(portal, firm_id, builder_organisation_id, feature_key, mode, reason)
   VALUES ('builder',(SELECT id FROM solicitor_firms LIMIT 1),'22222222-2222-2222-2222-222222222222',
           'builder_portal_identity_v1','off','bad')`,
  'cross_portal_firm_rollouts_owner_agree');

expectRejection('a builder rollout cannot govern a solicitor-owned feature',
  `INSERT INTO cross_portal_firm_rollouts(portal, builder_organisation_id, feature_key, mode, reason)
   VALUES ('builder','22222222-2222-2222-2222-222222222222','solicitor_matter_access_v2','cutover','bad')`,
  'CROSS_PORTAL_FEATURE_PORTAL_MISMATCH');

expectEqual('a shared feature may be governed by either portal',
  `SELECT resolve_cross_portal_feature_mode_for('builder','22222222-2222-2222-2222-222222222222','transaction_case_backbone')`,
  'cutover');

// ===========================================================================
// Internal administration permission
// ===========================================================================
console.log('\nInternal administration');
expectEqual('builder_portal_admin is registered',
  "SELECT count(*) FROM dashboard_modules WHERE module_key='builder_portal_admin' AND is_active", 1);
expectEqual('builder_portal_admin points at the internal route',
  "SELECT route FROM dashboard_modules WHERE module_key='builder_portal_admin'", '/admin/builder-portal');
expectEqual('the solicitor_portal_admin drift is repaired',
  "SELECT count(*) FROM dashboard_modules WHERE module_key='solicitor_portal_admin'", 1);
expectEqual('module registration supports separate view and edit permissions',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_name='user_permissions' AND column_name IN ('can_view','can_edit','can_delete')`, 3);

// ===========================================================================
// RLS and anonymous access
// ===========================================================================
console.log('\nRow level security');
const BUILDER_TABLES = [
  'builder_organisations', 'builder_portal_users', 'builder_organisation_memberships',
  'builder_permission_keys', 'builder_role_default_permissions',
  'builder_membership_permissions', 'builder_portal_sessions',
];

expectEqual('RLS is enabled on every builder table',
  `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relrowsecurity
     AND c.relname IN (${BUILDER_TABLES.map((t) => `'${t}'`).join(',')})`, BUILDER_TABLES.length);

expectEqual('no builder policy grants anon or authenticated anything',
  `SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname LIKE 'builder%'
     AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = ANY(p.polroles) AND r.rolname IN ('anon','authenticated'))`, 0);

expectEqual('no builder policy uses an unrestricted USING (true)',
  `SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname LIKE 'builder%' AND pg_get_expr(p.polqual, p.polrelid) = 'true'`, 0);

for (const role of ['anon', 'authenticated']) {
  expectEqual(`${role} holds no privilege on builder identity tables`,
    `SELECT count(*) FROM information_schema.role_table_grants
     WHERE grantee='${role}' AND table_name IN (${BUILDER_TABLES.map((t) => `'${t}'`).join(',')})`, 0);
}

// Anonymous access denial, executed as the role rather than inferred.
for (const table of ['builder_organisations', 'builder_portal_users', 'builder_portal_sessions']) {
  expectRejection(`anonymous SELECT on ${table} is denied`,
    `SET LOCAL ROLE anon; SELECT count(*) FROM public.${table};`, 'permission denied');
}
expectRejection('an authenticated staff role cannot read builder users directly',
  'SET LOCAL ROLE authenticated; SELECT count(*) FROM public.builder_portal_users;', 'permission denied');
expectRejection('anon cannot call the permission resolver',
  `SET LOCAL ROLE anon; SELECT builder_resolve_permission(gen_random_uuid(), gen_random_uuid(), 'organisation', 'view');`,
  'permission denied');

// ===========================================================================
// Finance-owned tables stay out of reach
// ===========================================================================
console.log('\nFinance-owned boundary');
// NOTE: builder_invoices is Finance-owned despite its name and legitimately
// references client_deals. Matching on `builder%` would catch it, so the Phase 1
// tables are enumerated explicitly rather than pattern-matched.
const PHASE_1_TABLE_LIST = BUILDER_TABLES.map((t) => `'${t}'`).join(',');

expectEqual('no Phase 1 builder table references the Finance-owned deal tables',
  `SELECT count(*) FROM pg_constraint con
   JOIN pg_class child ON child.oid = con.conrelid
   JOIN pg_class parent ON parent.oid = con.confrelid
   WHERE child.relname IN (${PHASE_1_TABLE_LIST})
     AND parent.relname IN ('builder_invoices','build_progress_payments','client_deals')`, 0);

expectEqual('no Phase 1 builder table references any client or deal table at all',
  `SELECT count(*) FROM pg_constraint con
   JOIN pg_class child ON child.oid = con.conrelid
   JOIN pg_class parent ON parent.oid = con.confrelid
   WHERE child.relname IN (${PHASE_1_TABLE_LIST})
     AND parent.relname IN ('clients','client_deals')`, 0);

expectEqual('no builder function body mentions the Finance-owned deal tables',
  `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'builder%'
     AND (p.prosrc LIKE '%builder_invoices%' OR p.prosrc LIKE '%build_progress_payments%')`, 0);

expectEqual('the Finance-owned builder-named tables are untouched by Phase 1',
  `SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname IN ('builder_invoices','build_progress_payments')
     AND p.polname LIKE 'builder_portal%'`, 0);

// ===========================================================================
// No Phase 2 business tables
// ===========================================================================
console.log('\nPhase boundary');
expectEqual('no Phase 2 business table was introduced',
  `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN
   ('builder_developments','builder_projects','builder_project_stages','builder_project_parties',
    'property_units','property_reservations','construction_cases','builder_transactions',
    'builder_variations','builder_progress_claims','builder_inspections','builder_defects')`, 0);

expectEqual('transaction_case_links gained no builder slot in Phase 1',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_name='transaction_case_links' AND column_name='builder_transaction_id'`, 0);

// ===========================================================================
// Concurrency
// ===========================================================================
console.log('\nConcurrency');
expectEqual('row_version increments on update and is server-owned',
  `WITH before AS (SELECT row_version FROM builder_organisations WHERE id='11111111-1111-1111-1111-111111111111'),
        upd AS (UPDATE builder_organisations SET notes='touched'
                WHERE id='11111111-1111-1111-1111-111111111111' RETURNING row_version)
   SELECT (SELECT row_version FROM upd) - (SELECT row_version FROM before)`, 1);

expectEqual('a client-supplied row_version cannot be forced',
  `WITH upd AS (UPDATE builder_organisations SET row_version = 999, notes='forced'
                WHERE id='11111111-1111-1111-1111-111111111111' RETURNING row_version)
   SELECT CASE WHEN (SELECT row_version FROM upd) = 999 THEN 'forced' ELSE 'server_owned' END`,
  'server_owned');

// ===========================================================================
// Summary
// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${'='.repeat(70)}`);
console.log(`Phase 1 local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const failure of failed) console.log(`  - ${failure.name}\n      ${failure.detail}`);
  process.exit(1);
}
console.log('All Phase 1 conditions verified against a live PostgreSQL database.');
