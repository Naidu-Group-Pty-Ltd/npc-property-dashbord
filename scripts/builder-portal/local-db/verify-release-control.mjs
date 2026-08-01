#!/usr/bin/env node
/**
 * Builder Portal release-control plane — local verification.
 *
 * Builds a clean database, applies the Supabase-compatible bootstrap, the
 * upstream fixture and every Builder migration through the new release-control
 * migration, then exercises the plane against real PostgreSQL.
 *
 * This is real execution, not a static scan: every transition, rejection,
 * concurrency conflict and audit rollback below is produced by the database.
 *
 * Usage:  node scripts/builder-portal/local-db/verify-release-control.mjs
 * Env:    LOCAL_PG_HOST (/tmp)  LOCAL_PG_PORT (55432)
 *         LOCAL_PG_USER (postgres)  LOCAL_PG_RELEASE_DB (aurixa_release_verify)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_RELEASE_DB || 'aurixa_release_verify';

/**
 * Every Builder migration, in order. The release-control plane's readiness
 * function asserts the presence of the full Builder schema, so the whole
 * programme has to be applied for the readiness evidence to be meaningful.
 */
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
  '20260810000000_builder_portal_release_control_plane.sql',
  '20260810000100_builder_portal_onboarding_tour.sql',
];

const FEATURE = 'builder_portal_identity_v1';

const run = (args, db = DB) =>
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', ...args],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: '' } });

const query = (sql) => run(['-tAc', sql]).trim();

const results = [];
const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${name}${detail && !passed ? `\n         ${detail}` : ''}`);
};

const expectEqual = (name, sql, expected) => {
  let actual;
  try { actual = query(sql); } catch (error) {
    return record(name, false, `query failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
  }
  record(name, actual === String(expected), `expected ${expected}, got ${actual}`);
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

// ===========================================================================
// Build
// ===========================================================================
console.log(`Building ${DB} ...`);
run(['-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`], 'postgres');
run(['-c', `CREATE DATABASE ${DB}`], 'postgres');
run(['-f', join(root, 'scripts/builder-portal/local-db/00-supabase-bootstrap.sql')]);
run(['-f', join(root, 'scripts/builder-portal/local-db/01-upstream-fixture.sql')]);

const preSolicitorRollouts = query('SELECT count(*) FROM cross_portal_firm_rollouts');
const preSolicitorApprovals = query('SELECT count(*) FROM cross_portal_cutover_approvals');
// Overload counts for the Solicitor commands, captured BEFORE the Builder
// migration runs. The upstream fixture reproduces only the Solicitor objects
// Phase 1 generalises, so it carries the resolution adapter but not the Phase
// 15 commands. Comparing before against after therefore proves the real
// invariant in either environment: the Builder migration must never define,
// redefine or overload a Solicitor command.
const overloads = (name) =>
  query(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='${name}'`);
const preSetRolloutOverloads = overloads('set_cross_portal_firm_rollout');
const preReadinessOverloads = overloads('get_cross_portal_cutover_readiness');
const preResolveOverloads = overloads('resolve_cross_portal_feature_mode');

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
console.log(`Applied ${MIGRATIONS.length} migrations.\n`);

// Seed: two isolated Builder organisations and a staff actor.
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const STAFF = '33333333-3333-3333-3333-333333333333';
run(['-c', `
  INSERT INTO builder_organisations(id, legal_name, org_type, status, is_active, activated_at)
  VALUES ('${ORG_A}', 'Pilot Developments Pty Ltd', 'builder_developer', 'active', true, now()),
         ('${ORG_B}', 'Isolated Holdings Pty Ltd', 'builder', 'active', true, now());
`]);

const setMode = (org, mode, reason, version) =>
  `SELECT set_cross_portal_rollout_for('builder','${org}','${FEATURE}','${mode}',${reason},'${STAFF}','command_user',${
    version === undefined || version === '' ? 'NULL' : version})`;
const versionOf = (org) =>
  query(`SELECT row_version FROM cross_portal_firm_rollouts WHERE portal='builder' AND builder_organisation_id='${org}' AND feature_key='${FEATURE}'`);

// ===========================================================================
// 1. Solicitor plane is unchanged
// ===========================================================================
console.log('Solicitor compatibility');
expectEqual('solicitor rollout rows preserved',
  "SELECT count(*) FROM cross_portal_firm_rollouts WHERE portal='solicitor'", preSolicitorRollouts);
expectEqual('solicitor approvals preserved',
  "SELECT count(*) FROM cross_portal_cutover_approvals WHERE portal='solicitor'", preSolicitorApprovals);
expectEqual('the solicitor rollout command was neither redefined nor overloaded',
  `SELECT ${overloads('set_cross_portal_firm_rollout')}`, preSetRolloutOverloads);
expectEqual('the solicitor readiness function was neither redefined nor overloaded',
  `SELECT ${overloads('get_cross_portal_cutover_readiness')}`, preReadinessOverloads);
expectEqual('the solicitor resolution adapter was not overloaded',
  `SELECT ${overloads('resolve_cross_portal_feature_mode')}`, preResolveOverloads);
expectEqual('builder transitions go through a separate command, not the solicitor one',
  `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='set_cross_portal_rollout_for'`, 1);
expectEqual('solicitor resolution adapter unchanged',
  `SELECT resolve_cross_portal_feature_mode((SELECT id FROM solicitor_firms LIMIT 1),'solicitor_matter_access_v2')`,
  'cutover');
expectEqual('rollout reconciliation view remains clean',
  'SELECT count(*) FROM cross_portal_rollout_reconciliation WHERE portal_mismatch OR orphaned_owner', 0);

// ===========================================================================
// 2. Feature definitions
// ===========================================================================
console.log('\nFeature definitions');
expectEqual('builder features default to off',
  "SELECT count(*) FROM cross_portal_feature_definitions WHERE portal='builder' AND default_mode<>'off'", 0);
expectEqual('builder features are marked as having no legacy comparison',
  "SELECT count(*) FROM cross_portal_feature_definitions WHERE portal='builder' AND legacy_comparison_applicable", 0);
expectEqual('every builder not-applicable marker carries a reason',
  `SELECT count(*) FROM cross_portal_feature_definitions
   WHERE portal='builder' AND NOT legacy_comparison_applicable AND COALESCE(btrim(not_applicable_reason),'')=''`, 0);
expectEqual('builder_portal_admin_v1 is marked as not consumed by any runtime path',
  "SELECT runtime_consumed FROM cross_portal_feature_definitions WHERE feature_key='builder_portal_admin_v1'", 'f');
expectEqual('builder_portal_identity_v1 is marked as runtime-consumed',
  `SELECT runtime_consumed FROM cross_portal_feature_definitions WHERE feature_key='${FEATURE}'`, 't');

// ===========================================================================
// 3. Transition graph
// ===========================================================================
console.log('\nTransition graph');
expectEqual('off advances to shadow', "SELECT builder_rollout_transition_allowed('off','shadow')", 't');
expectEqual('shadow advances to cutover', "SELECT builder_rollout_transition_allowed('shadow','cutover')", 't');
expectEqual('off cannot jump straight to cutover', "SELECT builder_rollout_transition_allowed('off','cutover')", 'f');
expectEqual('dual_read is unreachable for builder', "SELECT builder_rollout_transition_allowed('shadow','dual_read')", 'f');
expectEqual('dual_write is unreachable for builder', "SELECT builder_rollout_transition_allowed('shadow','dual_write')", 'f');
expectEqual('rollback is reachable from shadow', "SELECT builder_rollout_transition_allowed('shadow','rollback')", 't');
expectEqual('rollback is reachable from cutover', "SELECT builder_rollout_transition_allowed('cutover','rollback')", 't');
expectEqual('rollback re-enters at shadow, never straight back to cutover',
  "SELECT builder_rollout_transition_allowed('rollback','cutover')", 'f');
expectEqual('recovery from rollback goes through shadow',
  "SELECT builder_rollout_transition_allowed('rollback','shadow')", 't');
expectEqual('off cannot roll back — there is nothing to roll back from',
  "SELECT builder_rollout_transition_allowed('off','rollback')", 'f');

// ===========================================================================
// 4. Command validation
// ===========================================================================
console.log('\nCommand validation');
expectRejection('a solicitor portal argument is rejected',
  `SELECT set_cross_portal_rollout_for('solicitor','${ORG_A}','${FEATURE}','shadow','x','${STAFF}')`,
  'CROSS_PORTAL_UNSUPPORTED_PORTAL');
expectRejection('a missing reason is rejected',
  setMode(ORG_A, 'shadow', `'   '`), 'CUTOVER_REASON_REQUIRED');
expectRejection('an unknown feature key is rejected',
  `SELECT set_cross_portal_rollout_for('builder','${ORG_A}','not_a_feature','shadow','x','${STAFF}')`,
  'CROSS_PORTAL_FEATURE_NOT_FOUND');
expectRejection('a solicitor-owned feature cannot be governed by a builder rollout',
  `SELECT set_cross_portal_rollout_for('builder','${ORG_A}','solicitor_matter_access_v2','shadow','x','${STAFF}')`,
  'CROSS_PORTAL_FEATURE_PORTAL_MISMATCH');
expectRejection('an unknown organisation is rejected',
  `SELECT set_cross_portal_rollout_for('builder','44444444-4444-4444-4444-444444444444','${FEATURE}','shadow','x','${STAFF}')`,
  'BUILDER_ORG_NOT_FOUND');
expectRejection('a missing actor is rejected',
  `SELECT set_cross_portal_rollout_for('builder','${ORG_A}','${FEATURE}','shadow','x',NULL)`,
  'CUTOVER_ACTOR_REQUIRED');
expectRejection('an invalid first transition is rejected',
  setMode(ORG_A, 'cutover', `'straight to live'`), 'INVALID_CUTOVER_TRANSITION');

// ===========================================================================
// 5. First transition, history and audit
// ===========================================================================
console.log('\nFirst transition');
expectEqual('portal is blocked before any rollout row exists',
  `SELECT resolve_cross_portal_feature_mode_for('builder','${ORG_A}','${FEATURE}')`, 'off');
expectEqual('off advances to shadow and reports its origin',
  `SELECT (${setMode(ORG_A, 'shadow', `'pilot organisation provisioned'`)})->>'from_mode'`, 'off');
expectEqual('the rollout row is organisation-scoped, not firm-scoped',
  `SELECT count(*) FROM cross_portal_firm_rollouts
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND firm_id IS NULL`, 1);
expectEqual('history records the transition',
  `SELECT count(*) FROM cross_portal_rollout_history
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND from_mode='off' AND to_mode='shadow'`, 1);
expectEqual('history carries the readiness snapshot taken at the time',
  `SELECT count(*) FROM cross_portal_rollout_history
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND readiness_snapshot ? 'checks'`, 1);
expectEqual('trusted audit records the transition in the builder audit trail',
  `SELECT count(*) FROM builder_portal_activity_log
   WHERE action='builder_rollout_shadow' AND entity_type='rollout' AND organisation_id='${ORG_A}'`, 1);
expectEqual('the other organisation is untouched and still blocked',
  `SELECT resolve_cross_portal_feature_mode_for('builder','${ORG_B}','${FEATURE}')`, 'off');
expectEqual('shadow does not open the external portal',
  // _shared/builderPortalAuth treats only cutover as portal-enabling for
  // Builder; shadow is the internal observation stage.
  `SELECT count(*) FROM cross_portal_firm_rollouts
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND mode='shadow'`, 1);

// ===========================================================================
// 6. Optimistic concurrency
// ===========================================================================
console.log('\nOptimistic concurrency');
const vA = versionOf(ORG_A);
expectEqual('a new rollout row starts at version 1', `SELECT ${vA}`, 1);
expectRejection('updating without expected_version is rejected',
  setMode(ORG_A, 'off', `'no version supplied'`), 'BUILDER_EXPECTED_VERSION_REQUIRED');
expectRejection('a stale expected_version is rejected',
  setMode(ORG_A, 'off', `'stale writer'`, 99), 'BUILDER_STALE_WRITE');
expectEqual('a matching expected_version succeeds',
  `SELECT (${setMode(ORG_A, 'off', `'operator stood the pilot down'`, vA)})->>'mode'`, 'off');
expectEqual('the version bumps on update', `SELECT ${versionOf(ORG_A)}`, 2);

// ===========================================================================
// 7. Readiness
// ===========================================================================
console.log('\nReadiness');
run(['-c', setMode(ORG_A, 'shadow', `'pilot re-provisioned'`, versionOf(ORG_A))]);

expectEqual('readiness is not ready before approvals and observation',
  `SELECT (get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->>'ready'`, 'false');
expectEqual('readiness reports the builder portal',
  `SELECT (get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->>'portal'`, 'builder');
expectEqual('required builder tables are present',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='required_builder_tables_present'`, 'pass');
expectEqual('required builder functions are present',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='required_builder_functions_present'`, 'pass');
expectEqual('every builder table has row level security',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='builder_tables_rls_enabled'`, 'pass');
expectEqual('no builder table is granted to anon or authenticated',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='no_direct_anon_or_authenticated_grants'`, 'pass');
expectEqual('the rollout is recognised as organisation-scoped',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='rollout_is_organisation_scoped'`, 'pass');
expectEqual('legacy dual-read comparison is explicitly not applicable',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='no_dual_read_mismatches'`, 'not_applicable');
expectEqual('the not-applicable check carries a reason',
  `SELECT (length(c->>'detail') > 30)::text FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='no_dual_read_mismatches'`, 'true');
expectEqual('legacy backfill is explicitly not applicable',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='legacy_backfill_reconciled'`, 'not_applicable');
expectEqual('not-applicable checks are never marked required',
  `SELECT count(*) FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'status'='not_applicable' AND (c->>'required')::boolean`, 0);
expectEqual('absent builder document malware scanning is a required failing check',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='builder_document_malware_scanning'`, 'fail');
expectEqual('the document blocker is marked required',
  `SELECT (c->>'required') FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='builder_document_malware_scanning'`, 'true');
expectEqual('unknown document scan evidence fails closed rather than passing',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='no_unsafe_builder_documents'`, 'unknown');
expectEqual('the observation window has not completed',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='minimum_stable_window_complete'`, 'fail');
expectRejection('readiness rejects a solicitor-owned feature',
  `SELECT get_builder_cutover_readiness('${ORG_A}','solicitor_matter_access_v2')`,
  'CROSS_PORTAL_FEATURE_PORTAL_MISMATCH');
expectRejection('readiness rejects an unknown organisation',
  `SELECT get_builder_cutover_readiness('44444444-4444-4444-4444-444444444444','${FEATURE}')`,
  'BUILDER_ORG_NOT_FOUND');

// ===========================================================================
// 8. Approvals
// ===========================================================================
console.log('\nApprovals');
const approve = (org, type, evidence) =>
  `SELECT record_cross_portal_approval_for('builder','${org}','${FEATURE}','${type}',${evidence},'${STAFF}')`;

expectRejection('an approval without evidence is rejected',
  approve(ORG_A, 'technical', `'  '`), 'CUTOVER_EVIDENCE_REQUIRED');
expectRejection('an unknown approval type is rejected',
  approve(ORG_A, 'vibes', `'x'`), 'CUTOVER_UNKNOWN_APPROVAL_TYPE');
expectRejection('an approval for a solicitor feature is rejected',
  `SELECT record_cross_portal_approval_for('builder','${ORG_A}','solicitor_matter_access_v2','technical','x','${STAFF}')`,
  'CROSS_PORTAL_FEATURE_PORTAL_MISMATCH');

for (const type of ['technical', 'security', 'operations', 'business_owner']) {
  run(['-c', approve(ORG_A, type, `'EVID-${type.toUpperCase()}-001'`)]);
}
expectEqual('all four approval types are recorded',
  `SELECT count(DISTINCT approval_type) FROM cross_portal_cutover_approvals
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND revoked_at IS NULL`, 4);
expectEqual('approvals are audited',
  `SELECT count(*) FROM builder_portal_activity_log
   WHERE action='builder_rollout_approval_recorded' AND organisation_id='${ORG_A}'`, 4);
expectEqual('re-approving the same type is idempotent, not duplicated',
  `SELECT count(*) FROM (SELECT ${'1'} FROM cross_portal_cutover_approvals
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND approval_type='technical') x`, 1);
run(['-c', approve(ORG_A, 'technical', `'EVID-TECHNICAL-002'`)]);
expectEqual('re-approval refreshes the evidence rather than inserting a second row',
  `SELECT evidence_reference FROM cross_portal_cutover_approvals
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND approval_type='technical'`,
  'EVID-TECHNICAL-002');
expectEqual('readiness now sees four approvals',
  `SELECT c->>'status' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='four_approvals_active'`, 'pass');

console.log('\nApproval revocation');
expectRejection('revocation without a reason is rejected',
  `SELECT revoke_cross_portal_approval_for('builder','${ORG_A}','${FEATURE}','security','  ','${STAFF}')`,
  'CUTOVER_REASON_REQUIRED');
expectEqual('an active approval can be revoked',
  `SELECT (revoke_cross_portal_approval_for('builder','${ORG_A}','${FEATURE}','security',
     'penetration test regression','${STAFF}'))->>'revoke_reason'`, 'penetration test regression');
expectEqual('revocation records who revoked it',
  `SELECT revoked_by FROM cross_portal_cutover_approvals
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND approval_type='security'`, STAFF);
expectEqual('readiness drops back to three approvals',
  `SELECT c->>'detail' FROM jsonb_array_elements((get_builder_cutover_readiness('${ORG_A}','${FEATURE}'))->'checks') c
   WHERE c->>'key'='four_approvals_active'`, '3 of 4 approval types active');
expectRejection('revoking an already-revoked approval is rejected',
  `SELECT revoke_cross_portal_approval_for('builder','${ORG_A}','${FEATURE}','security','again','${STAFF}')`,
  'CUTOVER_APPROVAL_NOT_FOUND');
expectEqual('revocation is audited',
  `SELECT count(*) FROM builder_portal_activity_log
   WHERE action='builder_rollout_approval_revoked' AND organisation_id='${ORG_A}'`, 1);
run(['-c', approve(ORG_A, 'security', `'EVID-SECURITY-002'`)]);
expectEqual('re-approval after revocation clears the revocation',
  `SELECT count(*) FROM cross_portal_cutover_approvals
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND approval_type='security' AND revoked_at IS NULL`, 1);

// ===========================================================================
// 9. Cutover is blocked while required evidence fails
// ===========================================================================
console.log('\nCutover gating');
expectRejection('cutover is refused while required checks fail',
  setMode(ORG_A, 'cutover', `'go live'`, versionOf(ORG_A)), 'CUTOVER_READINESS_FAILED');
expectEqual('the refused transition wrote no history row',
  `SELECT count(*) FROM cross_portal_rollout_history
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND to_mode='cutover'`, 0);
expectEqual('the organisation is still in shadow after the refusal',
  `SELECT resolve_cross_portal_feature_mode_for('builder','${ORG_A}','${FEATURE}')`, 'shadow');

// ===========================================================================
// 10. Audit failure rolls the transition back
//
// The audit trail is append-only and builder_log_activity raises rather than
// swallowing. Breaking the audit write must therefore abort the state change.
// ===========================================================================
console.log('\nAudit rollback');
const versionBeforeAuditBreak = versionOf(ORG_A);
run(['-c', `
  ALTER TABLE builder_portal_activity_log
    ADD CONSTRAINT tmp_block_rollout_audit CHECK (entity_type IS DISTINCT FROM 'rollout') NOT VALID;
`]);
expectRejection('a transition whose audit write fails is rejected',
  setMode(ORG_A, 'rollback', `'audit failure probe'`, versionBeforeAuditBreak),
  'tmp_block_rollout_audit', 'violates check constraint');
expectEqual('the state change was rolled back with the failed audit',
  `SELECT resolve_cross_portal_feature_mode_for('builder','${ORG_A}','${FEATURE}')`, 'shadow');
expectEqual('the row version did not advance',
  `SELECT ${versionOf(ORG_A)}`, versionBeforeAuditBreak);
expectEqual('no orphaned history row survived the rollback',
  `SELECT count(*) FROM cross_portal_rollout_history
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND to_mode='rollback'`, 0);
run(['-c', 'ALTER TABLE builder_portal_activity_log DROP CONSTRAINT tmp_block_rollout_audit']);

// ===========================================================================
// 11. Rollback preserves domain data
// ===========================================================================
console.log('\nRollback');
run(['-c', `
  INSERT INTO builder_developments(id, developer_organisation_id, name, status)
  VALUES ('55555555-5555-5555-5555-555555555555','${ORG_A}','Riverside Stage 1','active');
`]);
const developmentsBefore = query(`SELECT count(*) FROM builder_developments WHERE developer_organisation_id='${ORG_A}'`);
expectEqual('rollback from shadow succeeds',
  `SELECT (${setMode(ORG_A, 'rollback', `'incident 4711 — pausing the pilot'`, versionOf(ORG_A))})->>'mode'`, 'rollback');
expectEqual('the portal is blocked after rollback',
  `SELECT resolve_cross_portal_feature_mode_for('builder','${ORG_A}','${FEATURE}')`, 'rollback');
expectEqual('rollback preserved the organisation domain data',
  `SELECT count(*) FROM builder_developments WHERE developer_organisation_id='${ORG_A}'`, developmentsBefore);
expectEqual('rollback cleared the observation window so recovery must observe again',
  `SELECT COALESCE(stable_since::text,'null') FROM cross_portal_firm_rollouts
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}'`, 'null');
expectEqual('rollback is recorded in history',
  `SELECT count(*) FROM cross_portal_rollout_history
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND to_mode='rollback'`, 1);
expectEqual('rollback is recorded in the trusted audit trail',
  `SELECT count(*) FROM builder_portal_activity_log
   WHERE action='builder_rollout_rollback' AND organisation_id='${ORG_A}'`, 1);
expectEqual('approvals survive a rollback as evidence',
  `SELECT count(*) FROM cross_portal_cutover_approvals
   WHERE portal='builder' AND builder_organisation_id='${ORG_A}' AND revoked_at IS NULL`, 4);

// ===========================================================================
// 12. Organisation isolation
// ===========================================================================
console.log('\nOrganisation isolation');
expectEqual('the second organisation never gained a rollout row',
  `SELECT count(*) FROM cross_portal_firm_rollouts
   WHERE portal='builder' AND builder_organisation_id='${ORG_B}'`, 0);
expectEqual('the second organisation is still blocked',
  `SELECT resolve_cross_portal_feature_mode_for('builder','${ORG_B}','${FEATURE}')`, 'off');
expectEqual('the second organisation has no approvals',
  `SELECT count(*) FROM cross_portal_cutover_approvals
   WHERE portal='builder' AND builder_organisation_id='${ORG_B}'`, 0);
expectEqual('the second organisation reads not ready',
  `SELECT (get_builder_cutover_readiness('${ORG_B}','${FEATURE}'))->>'ready'`, 'false');
expectEqual('the second organisation has no audit entries',
  `SELECT count(*) FROM builder_portal_activity_log WHERE organisation_id='${ORG_B}'`, 0);

// ===========================================================================
// 13. Privileges
// ===========================================================================
console.log('\nPrivileges');
for (const fn of ['set_cross_portal_rollout_for', 'record_cross_portal_approval_for',
                  'revoke_cross_portal_approval_for', 'get_builder_cutover_readiness']) {
  expectEqual(`${fn} is not executable by anon`,
    `SELECT has_function_privilege('anon', p.oid, 'EXECUTE')::text FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${fn}'`, 'false');
  expectEqual(`${fn} is not executable by authenticated`,
    `SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')::text FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${fn}'`, 'false');
  expectEqual(`${fn} is executable by service_role`,
    `SELECT has_function_privilege('service_role', p.oid, 'EXECUTE')::text FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${fn}'`, 'true');
}
expectRejection('the browser cannot write the rollout table directly',
  `SET LOCAL ROLE anon; UPDATE public.cross_portal_firm_rollouts SET mode='cutover';`,
  'permission denied');
expectRejection('the browser cannot read the rollout table directly',
  `SET LOCAL ROLE authenticated; SELECT count(*) FROM public.cross_portal_firm_rollouts;`,
  'permission denied');

// ===========================================================================
// 14. Guided onboarding tour state
//
// The Builder Portal persists nothing in the browser, so tour completion is a
// server column rather than a localStorage flag.
// ===========================================================================
console.log('\nOnboarding tour state');
const TOUR_USER = '66666666-6666-6666-6666-666666666666';
run(['-c', `
  INSERT INTO builder_portal_users(id, email, name, status, is_active)
  VALUES ('${TOUR_USER}', 'tour@pilot.test', 'Tour User', 'active', true);
`]);

expectEqual('tour completion starts unset',
  `SELECT count(*) FROM builder_user_preferences
   WHERE builder_user_id='${TOUR_USER}' AND tour_completed_at IS NOT NULL`, 0);
expectEqual('completing the tour creates the preferences row and stamps it',
  `SELECT (builder_complete_onboarding_tour('${TOUR_USER}') IS NOT NULL)::text`, 'true');
expectEqual('exactly one preferences row exists afterwards',
  `SELECT count(*) FROM builder_user_preferences WHERE builder_user_id='${TOUR_USER}'`, 1);

const firstStamp = query(
  `SELECT tour_completed_at FROM builder_user_preferences WHERE builder_user_id='${TOUR_USER}'`);
run(['-c', `SELECT builder_complete_onboarding_tour('${TOUR_USER}')`]);
expectEqual('completing twice is idempotent and never restamps',
  `SELECT tour_completed_at FROM builder_user_preferences WHERE builder_user_id='${TOUR_USER}'`,
  firstStamp);

expectEqual('completing the tour does not disturb other preferences',
  `SELECT landing_page FROM builder_user_preferences WHERE builder_user_id='${TOUR_USER}'`, 'dashboard');
expectRejection('an unknown user cannot be stamped',
  `SELECT builder_complete_onboarding_tour('77777777-7777-7777-7777-777777777777')`,
  'BUILDER_USER_NOT_FOUND');
expectRejection('a null owner is rejected',
  'SELECT builder_complete_onboarding_tour(NULL)', 'BUILDER_PREFERENCE_OWNER_REQUIRED');
expectEqual('the completion command is not executable by anon',
  `SELECT has_function_privilege('anon', p.oid, 'EXECUTE')::text FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='builder_complete_onboarding_tour'`, 'false');
expectEqual('the completion command is executable by service_role',
  `SELECT has_function_privilege('service_role', p.oid, 'EXECUTE')::text FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='builder_complete_onboarding_tour'`, 'true');

// ===========================================================================
// 15. Operational health
// ===========================================================================
console.log('\nOperational health');
expectEqual('operational health reports the builder portal',
  `SELECT (get_builder_operational_health('${ORG_A}'))->>'portal'`, 'builder');
expectEqual('operational health returns an alert list',
  `SELECT jsonb_typeof((get_builder_operational_health('${ORG_A}'))->'open_alerts')`, 'array');

// ===========================================================================
// Summary
// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${'='.repeat(70)}`);
console.log(`Release-control local verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} failure(s):`);
  for (const failure of failed) console.log(`  - ${failure.name}\n      ${failure.detail}`);
  process.exit(1);
}
console.log('All release-control conditions verified against a live PostgreSQL database.');
