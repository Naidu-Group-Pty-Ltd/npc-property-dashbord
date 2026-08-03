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

test('2. removing a revoked membership is refused with a controlled 409', () => {
  const body = bodyFrom(fixSql, 'builder_admin_delete_membership');
  assert.match(body, /IF v_membership\.revoked_at IS NOT NULL THEN/);
  assert.match(body, /BUILDER_HAS_DEPENDENTS/);
  // The refusal is raised before any DELETE can run.
  assert.ok(body.indexOf('BUILDER_HAS_DEPENDENTS') < body.indexOf('DELETE FROM'));
  // And the Edge Function maps that sentinel onto 409 has_dependents.
  assert.match(adminFnCode, /\[\/BUILDER_HAS_DEPENDENTS\/, 409, 'has_dependents'\]/);
});

test('3. the refusal names the revoked-membership reason', () => {
  const body = bodyFrom(fixSql, 'builder_admin_delete_membership');
  assert.match(body, /array_append\(\s*v_blockers,\s*'a revoked membership is retained as audit evidence'\s*\)/s);
  // The reason travels to the browser as `dependents`.
  assert.match(adminFnCode, /dependents=\(\[\^\\n\]\+\)/);
  assert.match(adminFnCode, /\.\.\.\(dependents \? \{ dependents \} : \{\}\)/);
  // And the interface has copy of its own for exactly that reason.
  assert.match(adminPageCode, /const REVOKED_MEMBERSHIP_BLOCKER = 'a revoked membership is retained as audit evidence'/);
  assert.match(adminPageCode, /This membership has already been revoked and is retained as audit evidence/);
});

// ---------------------------------------------------------------------------
// 4–5. Action visibility
// ---------------------------------------------------------------------------

test('4. a revoked membership offers no Remove action', () => {
  const menu = adminPageCode.slice(
    adminPageCode.indexOf('<DropdownMenuLabel>Membership</DropdownMenuLabel>'),
    adminPageCode.indexOf('</DropdownMenuContent>',
      adminPageCode.indexOf('<DropdownMenuLabel>Membership</DropdownMenuLabel>')));

  // Restore is the revoked row's only forward action.
  assert.match(menu, /\{isRevoked \? \(/);
  assert.match(menu, /Restore membership/);

  // Both destructive actions sit inside the same `!isRevoked` branch, so a
  // revoked row cannot reach either of them.
  const guarded = menu.slice(menu.indexOf('{!isRevoked && ('));
  assert.ok(guarded.includes('Remove membership'), 'Remove membership is not behind the !isRevoked guard');
  assert.ok(guarded.includes('Revoke membership'), 'Revoke membership is not behind the !isRevoked guard');
  assert.equal((menu.match(/Remove membership/g) ?? []).length, 1);
  assert.equal((menu.match(/\{!isRevoked && \(/g) ?? []).length, 1);
});

test('5. a live membership still offers Remove, because an unused one qualifies', () => {
  const menu = adminPageCode.slice(
    adminPageCode.indexOf('<DropdownMenuLabel>Membership</DropdownMenuLabel>'),
    adminPageCode.indexOf('</DropdownMenuContent>',
      adminPageCode.indexOf('<DropdownMenuLabel>Membership</DropdownMenuLabel>')));
  assert.match(menu, /kind: 'membership_remove', membership/);
  // The command still permits a live membership that never conferred anything.
  const body = bodyFrom(fixSql, 'builder_admin_delete_membership');
  assert.match(body, /DELETE FROM public\.builder_organisation_memberships WHERE id = _membership_id/);
});

// ---------------------------------------------------------------------------
// 6–7. Users and organisations still refuse, controllably
// ---------------------------------------------------------------------------

test('6. removing a user with dependants is refused with a controlled 409', () => {
  const body = bodyFrom(fixSql, 'builder_admin_delete_user');
  assert.match(body, /BUILDER_HAS_DEPENDENTS/);
  assert.ok(body.indexOf('FOR UPDATE') < body.indexOf('BUILDER_HAS_DEPENDENTS'));
  assert.ok(body.indexOf('BUILDER_HAS_DEPENDENTS') < body.indexOf('DELETE FROM public.builder_portal_users'));
  // Revoking is the alternative the interface offers.
  assert.match(adminPageCode, /Revoke access instead to preserve its history/);
});

test('7. removing an organisation with dependants is refused with a controlled 409', () => {
  const body = bodyFrom(fixSql, 'builder_admin_delete_organisation');
  assert.match(body, /BUILDER_HAS_DEPENDENTS/);
  assert.ok(body.indexOf('BUILDER_HAS_DEPENDENTS') < body.indexOf('DELETE FROM public.builder_organisations'));
  assert.match(adminPageCode, /Close the organisation instead to preserve its history/);
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
  assert.match(adminPageCode, /This record cannot be removed because it is still in use/);
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

test('12. no dependency guard is weakened by the corrective migration', () => {
  // The strongest form of this: apart from the append mechanics, each function
  // body is byte-identical to the one already applied in production.
  for (const name of DELETE_FUNCTIONS) {
    assert.equal(
      normaliseAppends(bodyFrom(fixSql, name)),
      normaliseAppends(bodyFrom(originalSql, name)),
      `${name} differs from the applied version by more than the append mechanics`,
    );
  }
});

test('13. no cascade deletion is introduced', () => {
  const deletes = fixSqlCode.match(/DELETE FROM public\.[a-z_]+/g) ?? [];
  assert.deepEqual(new Set(deletes), new Set([
    'DELETE FROM public.builder_onboarding_steps',
    'DELETE FROM public.builder_user_preferences',
    'DELETE FROM public.builder_portal_users',
    'DELETE FROM public.builder_organisation_settings',
    'DELETE FROM public.builder_organisations',
    'DELETE FROM public.builder_organisation_memberships',
  ]));
  assert.doesNotMatch(fixSqlCode, /CASCADE/i);
  // No table, column or constraint is touched either — functions only.
  assert.doesNotMatch(fixSqlCode, /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|CONSTRAINT|TYPE|SCHEMA)\b/i);
  // No row is rewritten either — `FOR UPDATE` is a lock, not a write.
  assert.doesNotMatch(fixSqlCode, /\bTRUNCATE\b/i);
  assert.doesNotMatch(fixSqlCode, /\bUPDATE\s+public\./i);
});

test('14. the Solicitor Portal is untouched', () => {
  for (const source of [fixSql, adminFn, adminPage, confirmDialog]) {
    const code = source.includes('CREATE OR REPLACE FUNCTION')
      ? stripSqlComments(source)
      : stripJsComments(source);
    assert.doesNotMatch(code, /invokeSecureFunction\(\s*'solicitor|'solicitor-portal/i);
    assert.doesNotMatch(code, /from '[^']*solicitor[^']*'/i);
    assert.doesNotMatch(code, /solicitor_[a-z_]+/i);
  }
  // The Finance-owned tables stay off-limits as well.
  assert.doesNotMatch(fixSqlCode, /builder_invoices|build_progress_payments/);
});
