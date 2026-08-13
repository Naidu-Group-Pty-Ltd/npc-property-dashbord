/**
 * Builder / Developer Portal — the working deletion lifecycle.
 *
 * The policy these pin replaces one that deadlocked. Treating every dependent
 * row as protected meant a revoked membership could not be deleted, and while
 * it existed neither its user nor its organisation could be deleted either — so
 * nothing could ever be removed.
 *
 * Dependants are now sorted:
 *
 *   Category A — access and account records. Deleted with the parent, in the
 *   same transaction, never a blocker.
 *   Category B — business and historical work. Refuses the removal with 409
 *   `has_dependents`; revoke, suspend or close instead.
 *
 * These are static assertions over the shipped source. The behaviour they
 * describe was additionally executed against a real PostgreSQL 16 while the
 * migration was written.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

// 20260823000000 carries the live definitions of all three commands; the
// policy they implement was introduced by 20260822000000.
const lifecycleSql = read('supabase/migrations/20260823000000_builder_deletion_audit_constraints.sql');
const policySql = read('supabase/migrations/20260822000000_builder_deletion_lifecycle.sql');
const activitySql = read('supabase/migrations/20260801000600_builder_portal_activity_log.sql');
const adminFn = read('supabase/functions/builder-portal-admin/index.ts');
const adminPage = read('src/pages/admin/BuilderPortalAdmin.tsx');
const confirmDialog = read('src/components/admin/builder-portal/ui/BuilderConfirmDialog.tsx');

const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const stripSqlComments = (body) => body.replace(/--[^\n]*/g, '');

const adminFnCode = stripJsComments(adminFn);
const adminPageCode = stripJsComments(adminPage);
const lifecycleCode = stripSqlComments(lifecycleSql);

const fn = (name) => {
  const start = lifecycleCode.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start !== -1, `${name} is missing`);
  const end = lifecycleCode.indexOf('END $$;', start);
  assert.ok(end !== -1, `${name} is unterminated`);
  return lifecycleCode.slice(start, end);
};

const operationBlock = (name) => {
  const start = adminFnCode.indexOf(`case '${name}':`);
  assert.ok(start !== -1, `operation ${name} is missing`);
  const next = adminFnCode.indexOf('      case ', start + 10);
  return adminFnCode.slice(start, next === -1 ? adminFnCode.length : next);
};

const DELETE_COMMANDS = [
  'builder_admin_delete_membership',
  'builder_admin_delete_user',
  'builder_admin_delete_organisation',
];

// ---------------------------------------------------------------------------
// The deadlock is gone
// ---------------------------------------------------------------------------

test('access records never block a removal', () => {
  // Category A tables must not appear in any blocker count. If one did, the
  // deadlock would be back.
  const CATEGORY_A = [
    'builder_organisation_memberships', 'builder_membership_permissions',
    'builder_portal_sessions', 'builder_project_access', 'builder_document_grants',
    'builder_onboarding_steps', 'builder_user_preferences',
    'builder_conversation_participants', 'builder_notifications',
    'builder_organisation_settings',
  ];
  for (const name of DELETE_COMMANDS) {
    const body = fn(name);
    // Every blocker is a `SELECT count(*) ... IF v_count > 0` pair; collect the
    // tables those counts read from.
    const counted = [...body.matchAll(/SELECT count\(\*\) INTO v_count FROM public\.([a-z_]+)/g)]
      .map((m) => m[1]);
    for (const table of CATEGORY_A) {
      assert.ok(!counted.includes(table), `${name} still blocks on the access table ${table}`);
    }
  }
});

test('the activity log is never a blocker', () => {
  // Administrative history — user created, invite sent, membership revoked —
  // is not business work and must not trap a record.
  for (const name of DELETE_COMMANDS) {
    assert.doesNotMatch(fn(name), /count\(\*\)[\s\S]{0,120}builder_portal_activity_log/,
      `${name} counts the activity log as a dependant`);
  }
});

test('a membership is removable whatever its status', () => {
  const body = fn('builder_admin_delete_membership');
  // No status predicate stands between the lock and the delete.
  assert.doesNotMatch(body, /revoked_at IS NOT NULL/);
  assert.doesNotMatch(body, /status = 'revoked'/);
  assert.doesNotMatch(body, /BUILDER_HAS_DEPENDENTS/);
  assert.match(body, /DELETE FROM public\.builder_organisation_memberships WHERE id = _membership_id/);
});

// ---------------------------------------------------------------------------
// Membership removal side effects
// ---------------------------------------------------------------------------

test('removing the primary membership hands the flag to another live one', () => {
  const body = fn('builder_admin_delete_membership');
  assert.match(body, /IF v_membership\.is_primary THEN/);
  assert.match(body, /WHERE builder_user_id = v_membership\.builder_user_id\s*\n\s*AND revoked_at IS NULL AND status = 'active'/);
  assert.match(body, /SET is_primary = true WHERE id = v_next_primary/);
  // Only when one exists; otherwise the user simply has no primary.
  assert.match(body, /IF v_next_primary IS NOT NULL THEN/);
});

test('losing the last access ends the sessions', () => {
  const membership = fn('builder_admin_delete_membership');
  // The Phase 1 trigger fires on UPDATE only, so a DELETE has to do this here.
  assert.match(membership, /NOT EXISTS \(SELECT 1 FROM public\.builder_accessible_organisations/);
  assert.match(membership, /builder_revoke_user_sessions\(\s*v_membership\.builder_user_id, 'membership_removed'\)/s);

  const org = fn('builder_admin_delete_organisation');
  assert.match(org, /FOREACH v_user_id IN ARRAY v_user_ids LOOP/);
  assert.match(org, /builder_revoke_user_sessions\(v_user_id, 'organisation_removed'\)/);

  const user = fn('builder_admin_delete_user');
  assert.match(user, /builder_revoke_user_sessions\(_builder_user_id, 'user_removed'\)/);
});

// ---------------------------------------------------------------------------
// Audit evidence
// ---------------------------------------------------------------------------

test('every removal writes its snapshot before deleting anything', () => {
  for (const name of DELETE_COMMANDS) {
    const body = fn(name);
    assert.match(body, /builder_log_activity/, `${name} writes no audit record`);
    assert.ok(body.indexOf('builder_log_activity') < body.indexOf('DELETE FROM'),
      `${name} deletes before it records`);
    assert.match(body, /'removal', 'permanent'/);
  }
});

test('the user snapshot names the memberships and organisations it removed', () => {
  const body = fn('builder_admin_delete_user');
  for (const field of [
    'builder_user_id', 'email', 'name', 'job_title', 'status',
    'membership_ids', 'organisation_ids',
  ]) {
    assert.ok(body.includes(`'${field}'`), `the user snapshot omits ${field}`);
  }
  // Collected before the rows go, or they could not be named.
  assert.ok(body.indexOf('INTO v_membership_ids') < body.indexOf('builder_log_activity'));
  // No credential ever enters the snapshot.
  assert.doesNotMatch(body, /password_hash|invite_token_hash|reset_token_hash|token_hash/);
});

test('the organisation snapshot names the memberships and users it affected', () => {
  const body = fn('builder_admin_delete_organisation');
  for (const field of [
    'organisation_id', 'legal_name', 'trading_name', 'abn', 'acn', 'status',
    'membership_ids', 'affected_user_ids',
  ]) {
    assert.ok(body.includes(`'${field}'`), `the organisation snapshot omits ${field}`);
  }
});

// ---------------------------------------------------------------------------
// What a removal must never touch
// ---------------------------------------------------------------------------

test('removing an organisation never deletes a user, and vice versa', () => {
  const org = fn('builder_admin_delete_organisation');
  assert.ok(!org.includes('DELETE FROM public.builder_portal_users'),
    'organisation removal must not delete users');
  assert.match(adminPageCode, /The users themselves are kept, including anyone who belonged only here/);

  const user = fn('builder_admin_delete_user');
  assert.ok(!user.includes('DELETE FROM public.builder_organisations'),
    'user removal must not delete organisations');
});

test('the commands are transactional, locked and service-role only', () => {
  for (const name of DELETE_COMMANDS) {
    const body = fn(name);
    assert.match(body, /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/,
      `${name} lacks SECURITY DEFINER with a fixed search_path`);
    assert.match(body, /FOR UPDATE/, `${name} does not lock its parent row`);
    assert.match(body, /BUILDER_REASON_REQUIRED/, `${name} does not require a reason`);
    assert.match(body, /BUILDER_STALE_WRITE/, `${name} does not check expected_version`);
    assert.match(lifecycleSql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}[^\\n]*FROM PUBLIC, anon, authenticated`),
      `${name} is not revoked from PUBLIC`);
  }
  // A plpgsql function invoked over RPC is one transaction, and the audit
  // helper raises rather than swallowing, so a failed write rolls the whole
  // removal back. Nothing here opens a nested transaction that could commit
  // part of the work.
  assert.doesNotMatch(lifecycleCode, /\b(COMMIT|ROLLBACK|SAVEPOINT)\b/i);
  assert.doesNotMatch(lifecycleCode, /EXCEPTION\s+WHEN/i);
});

// ---------------------------------------------------------------------------
// Edge Function contract
// ---------------------------------------------------------------------------

test('a successful removal answers with removed and the id', () => {
  for (const [op, idVar] of [
    ['delete_user', 'userId'],
    ['delete_organisation', 'organisationId'],
    ['delete_membership', 'membershipId'],
  ]) {
    const block = operationBlock(op);
    assert.match(block, new RegExp(`json\\(\\{ removed: true, id: ${idVar}, detail: data \\?\\? null \\}, 200`),
      `${op} does not answer with the removal contract`);
    // The guards stay in place.
    assert.match(block, /A reason is required/);
    assert.match(block, /expected_version is required/);
  }
  // Deletions are mutations, so they need can_edit and CSRF.
  const readOps = adminFnCode.slice(
    adminFnCode.indexOf('const READ_OPERATIONS = new Set(['),
    adminFnCode.indexOf(']);', adminFnCode.indexOf('const READ_OPERATIONS = new Set([')));
  for (const op of ['delete_user', 'delete_organisation', 'delete_membership']) {
    assert.ok(!readOps.includes(op), `${op} is treated as a read`);
  }
});

test('no SQLSTATE can be appended to the dependency list', () => {
  // `Memberships (1) P0001` reached production because the structured values
  // were read out of a string that had the SQLSTATE concatenated onto it.
  // They are now read from the DETAIL line alone.
  const failure = adminFnCode.slice(
    adminFnCode.indexOf('const rpcFailure = ('),
    adminFnCode.indexOf('const auditRows'));
  assert.match(failure, /const detail = String\(error\?\.details \?\? ''\) \|\| String\(error\?\.message \?\? ''\)/);
  assert.match(failure, /\/dependents=\(\[\^\\n\]\+\)\/\.exec\(detail\)/);
  assert.match(failure, /\/current_version=\(\\d\+\)\/\.exec\(detail\)/);
  // The code is still used for matching, but never for extraction.
  assert.doesNotMatch(failure, /exec\(text\)/);
});

test('the dialog shows the dependants and the alternative, never raw SQL', () => {
  assert.match(adminPageCode, /This record cannot be removed because it holds business records/);
  assert.match(adminPageCode, /Revoke access instead — the account keeps its work and its history/);
  assert.match(adminPageCode, /Close the organisation instead — its projects and records are preserved/);
  assert.match(confirmDialog, /Still attached:/);
  assert.match(confirmDialog, /blocked\.dependents\.map/);
  // Confirming again after a refusal is blocked, and the dialog stays open.
  assert.match(confirmDialog, /const canConfirm = !busy && !blocked/);
  assert.doesNotMatch(adminPageCode, /P0001|BUILDER_[A-Z_]+|SQLSTATE/);
});

test('a refresh after a deletion does not throw the administrator to another tab', () => {
  // The full-page loading state replaces the surface, unmounting the tabs with
  // it, so every post-mutation refresh reset the active tab to Organisations —
  // deleting a membership looked as though nothing had happened. The loading
  // screen is now first-load only.
  assert.match(adminPageCode, /const hasLoadedOnce = useRef\(false\)/);
  assert.match(adminPageCode, /if \(loading && !hasLoadedOnce\.current\) \{/);
  assert.match(adminPageCode, /hasLoadedOnce\.current = true;/);
  // The refresh control is where progress shows once the page stays mounted.
  assert.match(adminPageCode, /disabled=\{busy \|\| loading\}/);
  assert.match(adminPageCode, /loading \? 'h-4 w-4 animate-spin' : 'h-4 w-4'/);
});

// ---------------------------------------------------------------------------
// Production corrections
// ---------------------------------------------------------------------------

test('every audited entity_type is one the check constraint permits', () => {
  // builder_admin_delete_user wrote 'user'; the constraint allows 'portal_user'.
  // The whole removal failed on the audit insert.
  const allowed = /entity_type IS NULL OR entity_type IN\s*\n?\s*\(([^)]+)\)/.exec(activitySql)?.[1];
  assert.ok(allowed, 'the entity_type check constraint could not be read');
  const permitted = [...allowed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(permitted.includes('portal_user'));

  for (const name of DELETE_COMMANDS) {
    const body = fn(name);
    // entity_type is the 4th argument of builder_log_activity — the literal
    // immediately after the action. Anchoring on the action keeps this from
    // matching the same-shaped keys inside jsonb_build_object.
    const used = [...body.matchAll(/'builder_\w+_removed',\s*\n\s*'([a-z_]+)',/g)].map((m) => m[1]);
    assert.ok(used.length > 0, `${name} passes no entity_type literal`);
    for (const value of used) {
      assert.ok(permitted.includes(value),
        `${name} audits entity_type '${value}', which the check constraint rejects`);
    }
  }
  // The superseded migration still shows the defect this corrects.
  assert.match(policySql, /'user', v_user\.id, NULL, NULL,/);
  assert.match(lifecycleSql, /'portal_user', v_user\.id, NULL, NULL,/);
});

test('the audit log carries no foreign key to a record it outlives', () => {
  // organisation_id and builder_user_id were ON DELETE SET NULL, so deleting a
  // parent made PostgreSQL UPDATE the log — which the append-only trigger
  // rejects with BUILDER_ACTIVITY_LOG_APPEND_ONLY. Every user and organisation
  // that had ever been touched was therefore undeletable.
  assert.match(activitySql, /organisation_id uuid REFERENCES public\.builder_organisations\(id\) ON DELETE SET NULL/);
  assert.match(activitySql, /builder_user_id uuid REFERENCES public\.builder_portal_users\(id\) ON DELETE SET NULL/);

  assert.match(lifecycleSql,
    /ALTER TABLE public\.builder_portal_activity_log\s*\n\s*DROP CONSTRAINT IF EXISTS builder_portal_activity_log_organisation_id_fkey;/);
  assert.match(lifecycleSql,
    /ALTER TABLE public\.builder_portal_activity_log\s*\n\s*DROP CONSTRAINT IF EXISTS builder_portal_activity_log_builder_user_id_fkey;/);

  // Only the constraints go. The append-only trigger, the columns and the rows
  // are all left alone — the log becomes more immutable, not less.
  assert.doesNotMatch(lifecycleSql, /DROP\s+(TRIGGER|TABLE|COLUMN)/i);
  assert.doesNotMatch(lifecycleSql, /ALTER TABLE[^;]*DROP COLUMN/i);
  assert.doesNotMatch(lifecycleSql, /DELETE FROM public\.builder_portal_activity_log/);
  assert.doesNotMatch(lifecycleSql, /UPDATE public\.builder_portal_activity_log/);
  assert.match(activitySql, /BEFORE UPDATE OR DELETE ON public\.builder_portal_activity_log/);
});

test('the Solicitor Portal is untouched', () => {
  for (const source of [lifecycleSql, adminFn, adminPage, confirmDialog]) {
    const code = source.includes('CREATE OR REPLACE FUNCTION')
      ? stripSqlComments(source) : stripJsComments(source);
    assert.doesNotMatch(code, /invokeSecureFunction\(\s*'solicitor|'solicitor-portal/i);
    assert.doesNotMatch(code, /from '[^']*solicitor[^']*'/i);
    assert.doesNotMatch(code, /solicitor_[a-z_]+/i);
  }
});
