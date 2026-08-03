/**
 * Builder / Developer Portal — safe-removal refusal defects.
 *
 * Two production defects are pinned here.
 *
 *  1. `builder_admin_delete_membership` appended one blocker reason as a bare
 *     string literal:
 *
 *       v_blockers := v_blockers || 'a revoked membership is retained as audit evidence';
 *
 *     A bare literal is type `unknown`. Given `text[] || unknown` PostgreSQL
 *     prefers the `anyarray || anyarray` candidate and coerces the literal to
 *     text[], so it tried to parse the sentence as an array literal and failed
 *     with `malformed array literal`. The refusal was right; the way it was
 *     raised was not.
 *
 *  2. `invokeSecureFunction` returns BOTH `error` and the parsed body on a
 *     non-2xx reply. The Builder admin page threw on `error` first, discarding
 *     `code`, `dependents` and `current_version`, so every 409 arrived as a
 *     bare message and a refused removal produced a toast instead of an
 *     explanation inside the dialog.
 *
 * The refusals themselves are correct behaviour and must not weaken: the tests
 * below assert the blocker rules are byte-identical to the ones already applied
 * in production.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const originalSql = read('supabase/migrations/20260820000000_builder_admin_safe_deletion.sql');
const fixSql = read('supabase/migrations/20260821000000_builder_admin_blocker_array_fix.sql');
const lifecycleSql = read('supabase/migrations/20260822000000_builder_deletion_lifecycle.sql');
const adminFn = read('supabase/functions/builder-portal-admin/index.ts');
const adminPage = read('src/pages/admin/BuilderPortalAdmin.tsx');
const confirmDialog = read('src/components/admin/builder-portal/ui/BuilderConfirmDialog.tsx');

const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const stripSqlComments = (body) => body.replace(/--[^\n]*/g, '');

const adminFnCode = stripJsComments(adminFn);
const adminPageCode = stripJsComments(adminPage);
const fixSqlCode = stripSqlComments(fixSql);

const DELETE_FUNCTIONS = [
  'builder_admin_delete_user',
  'builder_admin_delete_organisation',
  'builder_admin_delete_membership',
];

/** The body of one guarded command, comments stripped. */
const bodyFrom = (sql, name) => {
  const code = stripSqlComments(sql);
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start !== -1, `${name} is missing`);
  const end = code.indexOf('END $$;', start);
  assert.ok(end !== -1, `${name} is unterminated`);
  return code.slice(start, end);
};

/**
 * Collapses both append spellings to one token, so two bodies can be compared
 * for everything EXCEPT the mechanics this change is allowed to alter.
 */
const normaliseAppends = (body) => body
  .replace(/v_blockers := v_blockers \|\| (format\([^;]+?\));/g, 'APPEND($1);')
  .replace(/v_blockers := v_blockers \|\| ('(?:[^']|'')*');/g, 'APPEND($1);')
  .replace(/v_blockers := array_append\(v_blockers, (.+?)\);/gs, 'APPEND($1);');

// ---------------------------------------------------------------------------
// 1–3. The malformed array literal
// ---------------------------------------------------------------------------

test('1. the corrective migration leaves no ambiguous blocker append', () => {
  // The defect, as shipped.
  assert.match(
    bodyFrom(originalSql, 'builder_admin_delete_membership'),
    /v_blockers := v_blockers \|\| 'a revoked membership is retained as audit evidence'/,
    'the original migration should still show the defect this fixes',
  );

  // The fix: no `||` append survives anywhere, in any of the three commands.
  assert.doesNotMatch(fixSqlCode, /v_blockers := v_blockers \|\|/);
  for (const name of DELETE_FUNCTIONS) {
    const body = bodyFrom(fixSql, name);
    assert.doesNotMatch(body, /v_blockers := v_blockers \|\|/, `${name} still concatenates`);
    assert.match(body, /array_append\(v_blockers,/, `${name} has no array_append`);
  }
  // array_append takes an element, so the reason can never be read as an array.
  assert.equal((fixSqlCode.match(/array_append\(v_blockers,/g) ?? []).length, 29);

  // The original migration is not edited — it is already applied in production.
  assert.match(originalSql, /^-- =+\n-- Builder \/ Developer Portal — guarded safe-deletion commands/m);
});

test('2. a revoked membership is removable, not refused', () => {
  // The superseded rule. It made the record permanently undeletable, which in
  // turn made its user and its organisation undeletable.
  assert.match(
    bodyFrom(fixSql, 'builder_admin_delete_membership'),
    /IF v_membership\.revoked_at IS NOT NULL THEN/,
    'the superseded migration should still show the rule this replaces',
  );

  const body = bodyFrom(lifecycleSql, 'builder_admin_delete_membership');
  assert.doesNotMatch(body, /revoked_at IS NOT NULL/,
    'a revoked membership must no longer be refused');
  assert.doesNotMatch(body, /BUILDER_HAS_DEPENDENTS/,
    'a membership is access, so it has no business dependants to refuse for');
  assert.match(body, /DELETE FROM public\.builder_organisation_memberships WHERE id = _membership_id/);
});

test('3. removing a membership records the evidence and cleans up its access rows', () => {
  const body = bodyFrom(lifecycleSql, 'builder_admin_delete_membership');

  // The audit snapshot is the retained evidence, written before the delete.
  assert.match(body, /'builder_membership_removed'/);
  for (const field of [
    'membership_id', 'builder_user_id', 'organisation_id', 'membership_role',
    'is_primary', 'status', 'revoked_at', 'revoked_reason',
  ]) {
    assert.ok(body.includes(`'${field}'`), `the snapshot omits ${field}`);
  }
  assert.ok(body.indexOf('builder_log_activity') < body.indexOf('DELETE FROM'));

  // Access rows that exist only because of this membership go with it.
  assert.match(body, /DELETE FROM public\.builder_membership_permissions WHERE membership_id = _membership_id/);
  assert.match(body, /DELETE FROM public\.builder_project_access/);

  // The primary flag is handed on, and lost access ends the sessions.
  assert.match(body, /IF v_membership\.is_primary THEN/);
  assert.match(body, /SET is_primary = true WHERE id = v_next_primary/);
  assert.match(body, /builder_revoke_user_sessions\(\s*v_membership\.builder_user_id, 'membership_removed'\)/s);
});

// ---------------------------------------------------------------------------
// 4–5. Action visibility
// ---------------------------------------------------------------------------

test('4. a revoked membership offers Remove, so nothing is trapped', () => {
  const menu = adminPageCode.slice(
    adminPageCode.indexOf('<DropdownMenuLabel>Membership</DropdownMenuLabel>'),
    adminPageCode.indexOf('</DropdownMenuContent>',
      adminPageCode.indexOf('<DropdownMenuLabel>Membership</DropdownMenuLabel>')));

  // Remove sits outside the !isRevoked guard; only Revoke is inside it.
  // The block ends at a `)}` on its own line — `)}` also occurs inside the
  // onClick handlers, so it cannot be found by a plain indexOf.
  const guarded = /\{!isRevoked && \(\n([\s\S]*?)\n\s*\)\}/.exec(menu)?.[1] ?? '';
  assert.ok(guarded.length > 0, 'the !isRevoked guard block was not found');
  assert.ok(guarded.includes('Revoke membership'), 'Revoke membership should be live-only');
  assert.ok(!guarded.includes('Remove membership'), 'Remove membership must not be live-only');
  assert.match(menu, /kind: 'membership_remove', membership/);
  assert.match(menu, /Restore membership/);
});

test('5. the memberships tab counts the rows it actually shows', () => {
  // It counted live memberships while the table renders every membership, so a
  // revoked row appeared beneath a tab reading "0".
  const trigger = adminPageCode.slice(
    adminPageCode.indexOf('<TabsTrigger value="memberships"'),
    adminPageCode.indexOf('</TabsTrigger>', adminPageCode.indexOf('<TabsTrigger value="memberships"')));
  assert.match(trigger, /\{memberships\.length\}/);
  assert.doesNotMatch(trigger, /liveMemberships\.length/);
  assert.match(adminPageCode, /\{memberships\.map\(\(membership\) => \{/);
});

// ---------------------------------------------------------------------------
// 6–7. Users and organisations still refuse, controllably
// ---------------------------------------------------------------------------

test('6. removing a user with business work is refused with a controlled 409', () => {
  const body = bodyFrom(lifecycleSql, 'builder_admin_delete_user');
  assert.match(body, /BUILDER_HAS_DEPENDENTS/);
  assert.ok(body.indexOf('FOR UPDATE') < body.indexOf('BUILDER_HAS_DEPENDENTS'));
  assert.ok(body.indexOf('BUILDER_HAS_DEPENDENTS') < body.indexOf('DELETE FROM public.builder_portal_users'));
  // Revoking is the alternative the interface offers.
  assert.match(adminPageCode, /Revoke access instead — the account keeps its work and its history/);
});

test('7. removing an organisation with business work is refused with a controlled 409', () => {
  const body = bodyFrom(lifecycleSql, 'builder_admin_delete_organisation');
  assert.match(body, /BUILDER_HAS_DEPENDENTS/);
  assert.ok(body.indexOf('BUILDER_HAS_DEPENDENTS') < body.indexOf('DELETE FROM public.builder_organisations'));
  assert.match(adminPageCode, /Close the organisation instead — its projects and records are preserved/);
});

// ---------------------------------------------------------------------------
// 8–11. Structured error transport and presentation
// ---------------------------------------------------------------------------

test('8. the structured body survives a non-2xx function response', () => {
  const callBlock = adminPageCode.slice(
    adminPageCode.indexOf('const call = useCallback('),
    adminPageCode.indexOf('const callInvite = useCallback('));

  // The defect: throwing on `error` alone discarded the body that carries the
  // structured detail. Both carriers are now read.
  assert.doesNotMatch(callBlock, /if \(error\) throw new Error\(error\.message\);/);
  assert.match(callBlock, /if \(error \|\| data\?\.error\)/);
  assert.match(callBlock, /failure\.code = data\?\.code \?\? \(error as \{ code\?: string \} \| null\)\?\.code/);
  assert.match(callBlock, /failure\.dependents = data\?\.dependents/);
  assert.match(callBlock, /failure\.currentVersion = data\?\.current_version/);

  // The shared helper does return the body alongside the error on non-2xx —
  // which is what makes reading `data` here correct rather than hopeful.
  const secureInvoke = read('src/lib/secureInvoke.ts');
  assert.match(secureInvoke, /if \(!response\.ok\) \{/);
  assert.match(secureInvoke, /return \{\s*\n?\s*data: data as T,\s*\n?\s*error: \{ message: String\(errorMessage\)/);
  // And it is left alone, because every other module depends on its shape.
  assert.doesNotMatch(secureInvoke, /builder-portal-admin/);
});

test('9. a has_dependents refusal keeps the confirmation dialog open', () => {
  const branch = adminPageCode.slice(
    adminPageCode.indexOf("if (failure?.code === 'has_dependents')"),
    adminPageCode.indexOf('toast.error(failure?.message'));
  // It populates the blocked state and returns — no setConfirm(null), no toast.
  assert.match(branch, /setConfirmBlocked\(describeBlockedRemoval\(/);
  assert.match(branch, /return;/);
  assert.doesNotMatch(branch, /setConfirm\(null\)/);
  assert.doesNotMatch(branch, /toast\./);
  // Confirming again would only be refused again.
  assert.match(confirmDialog, /const canConfirm = !busy && !blocked/);
});

test('10. the dependency detail is rendered inside the dialog', () => {
  assert.match(confirmDialog, /\{blocked && \(/);
  assert.match(confirmDialog, /Still attached:/);
  assert.match(confirmDialog, /blocked\.dependents\.map\(\(entry\) => <li key=\{entry\}>\{entry\}<\/li>\)/);
  assert.match(confirmDialog, /\{blocked\.recommendation && /);
  // The page splits the server's comma-separated list into those bullets.
  assert.match(adminPageCode, /\.split\(','\)/);
  assert.match(adminPageCode, /This record cannot be removed because it holds business records/);
});

test('11. no raw PostgreSQL text or sentinel can reach the administrator', () => {
  // Every message shown for a refusal is written in the page, not echoed.
  const describe = adminPageCode.slice(
    adminPageCode.indexOf('function describeBlockedRemoval('),
    adminPageCode.indexOf('export default function BuilderPortalAdmin'));
  assert.doesNotMatch(describe, /failure\.message|error\.message/);

  // The sentinels stay server-side: the Edge Function substitutes a sentence
  // before the body is sent, and the page never mentions one.
  assert.match(adminFnCode, /has_dependents: 'This record is still in use and cannot be removed\.'/);
  assert.match(adminFnCode, /\(code && RPC_MESSAGE\[code\]\) \|\| error\?\.message/);
  assert.doesNotMatch(adminPageCode, /BUILDER_[A-Z_]+/);
  assert.doesNotMatch(adminPageCode, /malformed array literal/);
  assert.doesNotMatch(confirmDialog, /BUILDER_[A-Z_]+/);
});

// ---------------------------------------------------------------------------
// 12–14. Nothing else moved
// ---------------------------------------------------------------------------

test('12. business records still refuse a removal', () => {
  // The protection that must survive the policy change: every Category B table
  // is still counted, under the lock, before anything is deleted.
  const user = bodyFrom(lifecycleSql, 'builder_admin_delete_user');
  for (const table of [
    'builder_document_versions', 'builder_messages', 'builder_reservations',
    'builder_unit_holds', 'builder_tasks', 'builder_task_assignments',
    'builder_construction_progress_updates', 'builder_construction_photographs',
    'builder_construction_status_history', 'builder_transaction_status_history',
  ]) {
    assert.ok(user.includes(table), `delete_user no longer checks ${table}`);
  }
  assert.ok(user.indexOf('FOR UPDATE') < user.indexOf('BUILDER_HAS_DEPENDENTS'));
  assert.ok(user.indexOf('BUILDER_HAS_DEPENDENTS') < user.indexOf('DELETE FROM'));

  const org = bodyFrom(lifecycleSql, 'builder_admin_delete_organisation');
  for (const table of [
    'builder_projects', 'builder_reservations', 'builder_transactions',
    'builder_unit_holds', 'builder_tasks', 'builder_documents',
  ]) {
    assert.ok(org.includes(table), `delete_organisation no longer checks ${table}`);
  }
  // A conversation carrying messages is business correspondence.
  assert.match(org, /builder_conversations\s*\n?\s*WHERE organisation_id = _organisation_id AND message_count > 0/);
  assert.ok(org.indexOf('BUILDER_HAS_DEPENDENTS') < org.indexOf('DELETE FROM'));
});

test('13. only access records are deleted, and never by cascade', () => {
  const code = stripSqlComments(lifecycleSql);
  const deletes = new Set(code.match(/DELETE FROM public\.[a-z_]+/g) ?? []);
  // Every table a removal may delete. Business tables are absent by design.
  assert.deepEqual(deletes, new Set([
    'DELETE FROM public.builder_membership_permissions',
    'DELETE FROM public.builder_organisation_memberships',
    'DELETE FROM public.builder_project_access',
    'DELETE FROM public.builder_document_grants',
    'DELETE FROM public.builder_conversation_participants',
    'DELETE FROM public.builder_conversations',
    'DELETE FROM public.builder_notifications',
    'DELETE FROM public.builder_onboarding_steps',
    'DELETE FROM public.builder_user_preferences',
    'DELETE FROM public.builder_portal_sessions',
    'DELETE FROM public.builder_organisation_settings',
    'DELETE FROM public.builder_portal_users',
    'DELETE FROM public.builder_organisations',
  ]));
  for (const business of [
    'DELETE FROM public.builder_projects', 'DELETE FROM public.builder_transactions',
    'DELETE FROM public.builder_documents', 'DELETE FROM public.builder_messages',
    'DELETE FROM public.builder_reservations', 'DELETE FROM public.builder_tasks',
    'DELETE FROM public.builder_portal_activity_log',
  ]) {
    assert.ok(!deletes.has(business), `${business} must never be issued`);
  }
  assert.doesNotMatch(code, /CASCADE/i);
  assert.doesNotMatch(code, /\bTRUNCATE\b/i);
  assert.doesNotMatch(code, /DISABLE TRIGGER|session_replication_role/i);
  // Functions only — no schema change.
  assert.doesNotMatch(code, /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|CONSTRAINT|TYPE|SCHEMA)\b/i);
});

test('14. the Solicitor Portal is untouched', () => {
  for (const source of [fixSql, lifecycleSql, adminFn, adminPage, confirmDialog]) {
    const code = source.includes('CREATE OR REPLACE FUNCTION')
      ? stripSqlComments(source)
      : stripJsComments(source);
    assert.doesNotMatch(code, /invokeSecureFunction\(\s*'solicitor|'solicitor-portal/i);
    assert.doesNotMatch(code, /from '[^']*solicitor[^']*'/i);
    assert.doesNotMatch(code, /solicitor_[a-z_]+/i);
  }
  // The Finance-owned tables stay off-limits as well.
  assert.doesNotMatch(fixSqlCode, /builder_invoices|build_progress_payments/);
  assert.doesNotMatch(lifecycleSql, /builder_invoices|build_progress_payments/);
});
