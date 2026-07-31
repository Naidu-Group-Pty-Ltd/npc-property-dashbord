#!/usr/bin/env node
/**
 * Builder Portal Phase 2 — local migration and behaviour verification.
 *
 * Builds a clean database, applies the Supabase-compatible bootstrap, the
 * upstream fixture and the Phase 1 migrations, then applies the Phase 2
 * migration and exercises the resulting schema against the conditions this
 * phase must satisfy.
 *
 * This is real execution against real PostgreSQL, not a static scan. Every
 * "ok" line below is the result of a statement that actually ran.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-phase-2.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_VERIFY_DB_2 (aurixa_phase2_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_VERIFY_DB_2 || 'aurixa_phase2_verify';

const PHASE_1_MIGRATIONS = [
  '20260801000000_builder_portal_phase1_organisations_users.sql',
  '20260801000100_builder_portal_phase1_permissions.sql',
  '20260801000200_builder_portal_phase1_sessions.sql',
  '20260801000300_portal_terms_multi_portal.sql',
  '20260801000400_cross_portal_rollout_org_generalisation.sql',
  '20260801000500_builder_portal_admin_module.sql',
  '20260801000600_builder_portal_activity_log.sql',
];

const PHASE_2_MIGRATIONS = [
  '20260802000000_builder_portal_phase2_auth_governance.sql',
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
for (const name of [...PHASE_1_MIGRATIONS, ...PHASE_2_MIGRATIONS]) {
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
console.log(`Applied ${PHASE_1_MIGRATIONS.length} Phase 1 + ${PHASE_2_MIGRATIONS.length} Phase 2 migration(s).\n`);

// Re-applying must be safe: a partially applied deploy is re-run by the CLI.
try {
  for (const name of PHASE_2_MIGRATIONS) run(['-f', join(migrationsDir, name)]);
  record('the Phase 2 migration is idempotent — a second apply succeeds', true);
} catch (error) {
  record('the Phase 2 migration is idempotent — a second apply succeeds', false,
    String(error.stderr || error.message).trim().split('\n')[0]);
}

// ---------------------------------------------------------------------------
// Fixture: two organisations, four users, memberships mirroring Phase 1.
// ---------------------------------------------------------------------------
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER_MULTI = 'aaaaaaaa-0000-0000-0000-00000000000a';   // member of A and B
const USER_SINGLE = 'aaaaaaaa-0000-0000-0000-00000000000b';  // member of A only
const USER_NONE = 'aaaaaaaa-0000-0000-0000-00000000000c';    // no membership
const HASH_1 = '1'.repeat(64);
const HASH_2 = '2'.repeat(64);
const RESET_HASH = 'f'.repeat(64);

run(['-c', `
  INSERT INTO builder_organisations(id, legal_name, trading_name, org_type, status, is_active, activated_at)
  VALUES ('${ORG_A}','Harbourline Constructions Pty Ltd','Harbourline','builder','active',true,now()),
         ('${ORG_B}','Northpoint Developments Pty Ltd','Northpoint','developer','active',true,now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO builder_portal_users(id, email, name, job_title, status, is_active)
  VALUES ('${USER_MULTI}','multi@harbourline.test','Multi Org','Project Manager','active',true),
         ('${USER_SINGLE}','single@harbourline.test','Single Org','Site Supervisor','active',true),
         ('${USER_NONE}','none@harbourline.test','No Membership','Contract Administrator','active',true);

  INSERT INTO builder_organisation_memberships(builder_user_id, organisation_id, membership_role, is_primary)
  VALUES ('${USER_MULTI}','${ORG_A}','manager',true),
         ('${USER_MULTI}','${ORG_B}','member',false),
         ('${USER_SINGLE}','${ORG_A}','read_only',true);
`]);

// ===========================================================================
// 1. Login attempt tracking
// ===========================================================================
console.log('\nLogin attempt tracking');
for (const [column, type] of [
  ['failed_login_attempts', 'integer'],
  ['locked_until', 'timestamp with time zone'],
  ['last_login_at', 'timestamp with time zone'],
  ['terms_accepted_at', 'timestamp with time zone'],
]) {
  expectEqual(`builder_portal_users.${column} exists as ${type}`,
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='builder_portal_users' AND column_name='${column}'`,
    type);
}

expectEqual('failed_login_attempts defaults to zero and is NOT NULL',
  `SELECT is_nullable||'/'||failed_login_attempts FROM information_schema.columns c,
     builder_portal_users u
   WHERE c.table_schema='public' AND c.table_name='builder_portal_users'
     AND c.column_name='failed_login_attempts' AND u.id='${USER_MULTI}'`,
  'NO/0');

expectRejection('a negative failed-attempt count is rejected',
  `UPDATE builder_portal_users SET failed_login_attempts=-1 WHERE id='${USER_MULTI}'`,
  'builder_portal_users_failed_attempts_sane');

// Kept as separate statements: a multi-statement psql -tAc prints the command
// tag of each statement, so the assertion would compare against "UPDATE 1\n1".
run(['-c', `UPDATE builder_portal_users SET locked_until=now()+interval '15 minutes' WHERE id='${USER_SINGLE}'`]);
expectEqual('a lockout timestamp is storable and readable',
  `SELECT count(*) FROM builder_portal_users WHERE id='${USER_SINGLE}' AND locked_until > now()`, 1);
run(['-c', `UPDATE builder_portal_users SET locked_until=NULL WHERE id='${USER_SINGLE}'`]);

// ===========================================================================
// 2. Onboarding steps
// ===========================================================================
console.log('\nOnboarding checklist');
expectEqual('builder_onboarding_steps exists',
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='builder_onboarding_steps'", 1);
expectEqual('builder_onboarding_steps is RLS-protected',
  "SELECT relrowsecurity FROM pg_class WHERE relname='builder_onboarding_steps'", 't');
expectRejection('anonymous SELECT on the onboarding checklist is denied',
  'SET LOCAL ROLE anon; SELECT count(*) FROM public.builder_onboarding_steps;', 'permission denied');

expectEqual('seeding a checklist creates the four mandatory steps',
  `SELECT builder_ensure_onboarding_steps('${USER_MULTI}')`, 4);
expectEqual('seeding again is idempotent — no duplicates, nothing reset',
  `SELECT builder_ensure_onboarding_steps('${USER_MULTI}')`, 0);
expectEqual('the checklist holds exactly four rows for that user',
  `SELECT count(*) FROM builder_onboarding_steps WHERE builder_user_id='${USER_MULTI}'`, 4);

expectRejection('seeding for a non-existent user is refused',
  "SELECT builder_ensure_onboarding_steps('00000000-0000-0000-0000-0000000000ff')",
  'BUILDER_USER_NOT_FOUND');

expectRejection('an unrecognised onboarding step key is rejected',
  `INSERT INTO builder_onboarding_steps(builder_user_id, step_key)
   VALUES ('${USER_MULTI}','grant_yourself_admin')`,
  'builder_onboarding_steps_step_key_check');

expectRejection('a duplicate step for the same user is rejected',
  `INSERT INTO builder_onboarding_steps(builder_user_id, step_key)
   VALUES ('${USER_MULTI}','profile_confirmed')`,
  'builder_onboarding_steps_builder_user_id_step_key_key');

// ===========================================================================
// 3. Server-held active organisation context
// ===========================================================================
console.log('\nSession organisation context');
expectEqual('builder_portal_sessions.active_organisation_id exists',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='builder_portal_sessions'
     AND column_name='active_organisation_id'`, 1);

const SESSION_MULTI = query(`SELECT builder_issue_session('${USER_MULTI}','${HASH_1}',
  now()+interval '12 hours', now()+interval '30 minutes')`);
const SESSION_SINGLE = query(`SELECT builder_issue_session('${USER_SINGLE}','${HASH_2}',
  now()+interval '12 hours', now()+interval '30 minutes')`);

expectEqual('a new session starts with no organisation selected',
  `SELECT count(*) FROM builder_portal_sessions
   WHERE id='${SESSION_MULTI}' AND active_organisation_id IS NULL`, 1);

expectEqual('selecting a reachable organisation sets the server-held context',
  `SELECT builder_select_session_organisation('${SESSION_MULTI}','${USER_MULTI}','${ORG_A}')`, ORG_A);
expectEqual('and the value is persisted on the session row, not the client',
  `SELECT active_organisation_id FROM builder_portal_sessions WHERE id='${SESSION_MULTI}'`, ORG_A);

expectEqual('a multi-organisation user can switch to their other organisation',
  `SELECT builder_select_session_organisation('${SESSION_MULTI}','${USER_MULTI}','${ORG_B}')`, ORG_B);

expectRejection('selecting an organisation the user cannot reach is refused',
  `SELECT builder_select_session_organisation('${SESSION_SINGLE}','${USER_SINGLE}','${ORG_B}')`,
  'BUILDER_ORGANISATION_NOT_ACCESSIBLE');
expectEqual('and the refused selection left the session context unchanged',
  `SELECT count(*) FROM builder_portal_sessions
   WHERE id='${SESSION_SINGLE}' AND active_organisation_id IS NULL`, 1);

expectRejection("selecting against another user's session is refused",
  `SELECT builder_select_session_organisation('${SESSION_MULTI}','${USER_SINGLE}','${ORG_A}')`,
  'BUILDER_SESSION_NOT_FOUND');

// The trigger is the backstop: even a direct UPDATE that bypasses the guarded
// command cannot point a session at an unreachable organisation.
expectRejection('a direct UPDATE cannot bypass the membership check',
  `UPDATE builder_portal_sessions SET active_organisation_id='${ORG_B}' WHERE id='${SESSION_SINGLE}'`,
  'BUILDER_ORGANISATION_NOT_ACCESSIBLE');

expectEqual('the selection wrote a trusted audit row',
  `SELECT count(*) FROM builder_portal_activity_log
   WHERE action='builder_active_organisation_selected' AND builder_user_id='${USER_MULTI}'`, 2);

// Losing the membership must immediately close the organisation off.
run(['-c', `UPDATE builder_organisation_memberships
            SET status='revoked', revoked_at=now(), revoked_reason='test'
            WHERE builder_user_id='${USER_MULTI}' AND organisation_id='${ORG_B}'`]);
expectRejection('a revoked membership can no longer be selected',
  `SELECT builder_select_session_organisation('${SESSION_MULTI}','${USER_MULTI}','${ORG_B}')`,
  'BUILDER_ORGANISATION_NOT_ACCESSIBLE');

run(['-c', `SELECT builder_revoke_session('${SESSION_SINGLE}','test')`]);
expectRejection('a revoked session cannot select an organisation',
  `SELECT builder_select_session_organisation('${SESSION_SINGLE}','${USER_SINGLE}','${ORG_A}')`,
  'BUILDER_SESSION_NOT_FOUND');

// ===========================================================================
// 4. Terms acceptance
// ===========================================================================
console.log('\nTerms acceptance');
const solicitorAcceptancesBefore = query(
  "SELECT count(*) FROM portal_terms_acceptances WHERE portal='solicitor'");

// Phase 1 seeds a current Builder terms version. Retire it briefly to prove the
// fail-closed branch, then restore it — nothing here fabricates a second
// "current" version, which the one-current-per-portal index would reject anyway.
const seededVersion = query(
  "SELECT version FROM portal_terms_versions WHERE portal='builder' AND retired_at IS NULL");
record('Phase 1 seeded exactly one current Builder terms version',
  seededVersion !== '' && !seededVersion.includes('\n'), `got: ${JSON.stringify(seededVersion)}`);

run(['-c', "UPDATE portal_terms_versions SET retired_at=now() WHERE portal='builder'"]);
expectRejection('acceptance fails closed when no Builder terms are published',
  `SELECT builder_accept_current_terms('${USER_MULTI}','${SESSION_MULTI}')`,
  'BUILDER_TERMS_UNAVAILABLE');
run(['-c', "UPDATE portal_terms_versions SET retired_at=NULL WHERE portal='builder'"]);

expectEqual('acceptance records the exact published version',
  `SELECT version FROM builder_accept_current_terms('${USER_MULTI}','${SESSION_MULTI}')`, seededVersion);
expectEqual('the acceptance row is owned by the builder user and the builder portal',
  `SELECT count(*) FROM portal_terms_acceptances
   WHERE portal='builder' AND builder_user_id='${USER_MULTI}'
     AND solicitor_user_id IS NULL`, 1);
expectEqual('the user is flagged as having accepted, with a timestamp',
  `SELECT has_accepted_current_terms AND terms_accepted_at IS NOT NULL
   FROM builder_portal_users WHERE id='${USER_MULTI}'`, 't');

run(['-c', `SELECT builder_accept_current_terms('${USER_MULTI}','${SESSION_MULTI}')`]);
expectEqual('accepting twice does not create a second acceptance row',
  `SELECT count(*) FROM portal_terms_acceptances
   WHERE portal='builder' AND builder_user_id='${USER_MULTI}'`, 1);

expectEqual('acceptance wrote a trusted audit row',
  `SELECT count(*) > 0 FROM builder_portal_activity_log
   WHERE action='builder_terms_accepted' AND builder_user_id='${USER_MULTI}'`, 't');

expectEqual('existing Solicitor acceptances are untouched',
  "SELECT count(*) FROM portal_terms_acceptances WHERE portal='solicitor'",
  solicitorAcceptancesBefore);

// ===========================================================================
// 5. Onboarding completion
// ===========================================================================
console.log('\nOnboarding completion');
expectEqual('completing one step alone does not complete onboarding',
  `SELECT builder_complete_onboarding('${USER_SINGLE}','${SESSION_MULTI}','profile_confirmed')`, 'f');
expectEqual('and the user is not yet marked as onboarded',
  `SELECT has_completed_onboarding FROM builder_portal_users WHERE id='${USER_SINGLE}'`, 'f');
expectEqual('exactly one step was completed',
  `SELECT count(*) FROM builder_onboarding_steps
   WHERE builder_user_id='${USER_SINGLE}' AND completed_at IS NOT NULL`, 1);

expectEqual('completing the remaining steps completes onboarding',
  `SELECT builder_complete_onboarding('${USER_SINGLE}','${SESSION_MULTI}')`, 't');
expectEqual('and the user is now marked as onboarded',
  `SELECT has_completed_onboarding FROM builder_portal_users WHERE id='${USER_SINGLE}'`, 't');
expectEqual('onboarding completion wrote a trusted audit row',
  `SELECT count(*) > 0 FROM builder_portal_activity_log
   WHERE action='builder_onboarding_updated' AND builder_user_id='${USER_SINGLE}'`, 't');

// ===========================================================================
// 6. Reset-attempt consumption
// ===========================================================================
console.log('\nPassword-reset attempt consumption');
expectEqual('an unknown email consumes nothing and reports not_found',
  "SELECT status FROM consume_builder_portal_reset_attempt('nobody@nowhere.test','"
  + RESET_HASH + "',5)", 'not_found');

run(['-c', `UPDATE builder_portal_users
            SET reset_token_hash='${RESET_HASH}',
                reset_token_expires_at=now()+interval '15 minutes',
                reset_attempts=0
            WHERE id='${USER_MULTI}'`]);

expectEqual('a wrong code is reported as not_found — no enumeration signal',
  `SELECT status FROM consume_builder_portal_reset_attempt('multi@harbourline.test','${'0'.repeat(64)}',5)`,
  'not_found');
expectEqual('but the attempt was still counted',
  `SELECT reset_attempts FROM builder_portal_users WHERE id='${USER_MULTI}'`, 1);

expectEqual('the correct code is accepted and identifies the account',
  `SELECT user_id FROM consume_builder_portal_reset_attempt('multi@harbourline.test','${RESET_HASH}',5)`,
  USER_MULTI);

run(['-c', `UPDATE builder_portal_users SET reset_attempts=5 WHERE id='${USER_MULTI}'`]);
expectEqual('exceeding the attempt ceiling is reported as too_many',
  `SELECT status FROM consume_builder_portal_reset_attempt('multi@harbourline.test','${RESET_HASH}',5)`,
  'too_many');

run(['-c', `UPDATE builder_portal_users
            SET reset_attempts=0, reset_token_expires_at=now()-interval '1 minute'
            WHERE id='${USER_MULTI}'`]);
expectEqual('an expired code is reported as expired',
  `SELECT status FROM consume_builder_portal_reset_attempt('multi@harbourline.test','${RESET_HASH}',5)`,
  'expired');

expectEqual('a user with no membership still cannot be probed through reset',
  `SELECT status FROM consume_builder_portal_reset_attempt('none@harbourline.test','${RESET_HASH}',5)`,
  'not_found');

// ===========================================================================
// 7. Rollout stays off, and no production rollout row is enabled
// ===========================================================================
console.log('\nRollout posture');
expectEqual('builder_portal_identity_v1 default_mode is off',
  "SELECT default_mode FROM cross_portal_feature_definitions WHERE feature_key='builder_portal_identity_v1'",
  'off');
expectEqual('no Builder rollout row exists in an enabled mode',
  `SELECT count(*) FROM cross_portal_firm_rollouts
   WHERE portal='builder' AND mode <> 'off'`, 0);

// ===========================================================================
// 8. Security posture of the Phase 2 surface
// ===========================================================================
console.log('\nSecurity posture');
expectEqual('every Phase 2 function is SECURITY DEFINER with a pinned search_path',
  `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('builder_ensure_onboarding_steps','builder_select_session_organisation',
                       'builder_accept_current_terms','builder_complete_onboarding',
                       'consume_builder_portal_reset_attempt')
     AND p.prosecdef
     AND array_to_string(p.proconfig, ',') LIKE '%search_path%'`, 5);

for (const fn of [
  'builder_ensure_onboarding_steps',
  'builder_select_session_organisation',
  'builder_accept_current_terms',
  'builder_complete_onboarding',
  'consume_builder_portal_reset_attempt',
]) {
  expectEqual(`anon holds no EXECUTE grant on ${fn}`,
    `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='${fn}'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')`, 0);
}

expectEqual('no plaintext credential column exists on builder_portal_users',
  `SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='builder_portal_users'
     AND column_name IN ('session_token','reset_token','invite_token')`, 0);

expectEqual('no Phase 2 policy uses an unrestricted USING (true)',
  `SELECT count(*) FROM pg_policies
   WHERE schemaname='public' AND tablename='builder_onboarding_steps'
     AND (qual = 'true' OR with_check = 'true')`, 0);

// Phase 2 must not reach the Finance-owned tables, whatever their names suggest.
expectEqual('Phase 2 grants nothing on the Finance-owned builder tables',
  `SELECT count(*) FROM information_schema.role_table_grants
   WHERE table_schema='public'
     AND table_name IN ('builder_invoices','build_progress_payments')
     AND grantee IN ('anon','authenticated')`, 0);

// ===========================================================================
// Summary
// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${'='.repeat(70)}`);
console.log(`Phase 2 local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const failure of failed) console.log(`  - ${failure.name}\n      ${failure.detail}`);
  process.exit(1);
}
console.log('All Phase 2 conditions verified against a live PostgreSQL database.');
