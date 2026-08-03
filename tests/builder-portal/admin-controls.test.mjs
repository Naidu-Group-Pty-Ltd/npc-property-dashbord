/**
 * Builder / Developer Portal — Command Centre administration controls.
 *
 * Covers the full management lifecycle the Command Centre now exposes for
 * portal users, builder/developer organisations and organisation memberships:
 * creation, safe editing, the invitation flow, access revocation and restore,
 * session revocation, and dependency-checked permanent removal.
 *
 * The point of most of these is negative. Removal is the dangerous one: the
 * Phase 1 schema attaches ON DELETE CASCADE to most Builder child tables, so a
 * delete issued without a guard would quietly destroy memberships, project
 * access, documents and messages. These assertions pin the guards that stop it.
 *
 * Like the rest of this directory they are static assertions over the shipped
 * source, so they run with no database and no network and gate every CI run.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const adminFn = read('supabase/functions/builder-portal-admin/index.ts');
const invite = read('supabase/functions/builder-portal-invite/index.ts');
const login = read('supabase/functions/builder-portal-login/index.ts');
const acceptInvite = read('supabase/functions/builder-portal-accept-invite/index.ts');
const adminPage = read('src/pages/admin/BuilderPortalAdmin.tsx');
const deletionSql = read('supabase/migrations/20260820000000_builder_admin_safe_deletion.sql');
const permissionsSql = read('supabase/migrations/20260801000100_builder_portal_phase1_permissions.sql');
const activitySql = read('supabase/migrations/20260801000600_builder_portal_activity_log.sql');
const confirmDialog = read('src/components/admin/builder-portal/ui/BuilderConfirmDialog.tsx');
const userFormDialog = read('src/components/admin/builder-portal/ui/BuilderUserFormDialog.tsx');
const orgFormDialog = read('src/components/admin/builder-portal/ui/BuilderOrganisationFormDialog.tsx');
const membershipFormDialog = read('src/components/admin/builder-portal/ui/BuilderMembershipFormDialog.tsx');
const permissionsDialog = read('src/components/admin/builder-portal/ui/BuilderPermissionsDialog.tsx');

/** Comments explain what each guard is for; searching them would find phantoms. */
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const stripSqlComments = (body) => body.replace(/--[^\n]*/g, '');

const adminFnCode = stripJsComments(adminFn);
const adminPageCode = stripJsComments(adminPage);
const deletionSqlCode = stripSqlComments(deletionSql);

/** The body of a `case 'name': { ... }` block in the admin function. */
const operationBlock = (name) => {
  const start = adminFnCode.indexOf(`case '${name}':`);
  assert.ok(start !== -1, `operation ${name} is missing`);
  const next = adminFnCode.indexOf('      case ', start + 10);
  return adminFnCode.slice(start, next === -1 ? adminFnCode.length : next);
};

/** The body of a `CREATE OR REPLACE FUNCTION name(...) ... $$;` block. */
const sqlFunctionBody = (name) => {
  const start = deletionSqlCode.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start !== -1, `SQL function ${name} is missing`);
  const end = deletionSqlCode.indexOf('END $$;', start);
  assert.ok(end !== -1, `SQL function ${name} is unterminated`);
  return deletionSqlCode.slice(start, end);
};

// ---------------------------------------------------------------------------
// Portal users — creation, editing and the invitation lifecycle
// ---------------------------------------------------------------------------

test('1. a new user is created invited and inactive, with no password', () => {
  const block = operationBlock('create_user');
  assert.match(block, /status:\s*'invited'/);
  assert.match(block, /is_active:\s*false/);
  // Nothing on the create path may mint a credential.
  assert.doesNotMatch(block, /password_hash|invite_token_hash|reset_token_hash/);
  assert.match(adminPageCode, /'create_user'/);
});

test('2. editing a user touches profile fields only', () => {
  const block = operationBlock('update_user');
  for (const field of ['name:', 'email:', 'phone:', 'job_title:']) {
    assert.ok(block.includes(field), `update_user cannot set ${field}`);
  }
  // The update payload is a closed allow-list. None of these may appear in it.
  for (const forbidden of [
    'password_hash', 'invite_token_hash', 'reset_token_hash', 'session_token',
    'invite_accepted_at:', 'invited_at:', 'last_login_at:', 'revoked_at:',
  ]) {
    assert.ok(!block.includes(forbidden), `update_user must not write ${forbidden}`);
  }
  // A changed email is normalised and re-validated, not trusted.
  assert.match(block, /trimmed\(body\.email\)\?\.toLowerCase\(\)/);
  assert.match(block, /\^\[\^@\\s\]\+@\[\^@\\s\]\+\\\.\[\^@\\s\]\+\$/);
  // The edit form's value type is the whole set of fields it can submit.
  const formValues = userFormDialog.slice(
    userFormDialog.indexOf('export interface BuilderUserFormValues {'),
    userFormDialog.indexOf('}', userFormDialog.indexOf('export interface BuilderUserFormValues {')));
  assert.deepEqual(
    [...formValues.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]).sort(),
    ['email', 'job_title', 'name', 'phone'],
  );
  assert.doesNotMatch(stripJsComments(userFormDialog), /password|token|is_active/i);
});

test('3. a user with no membership cannot be invited', () => {
  // The stage is derived from membership, and the invite action is offered for
  // one stage only — which is unreachable without a membership.
  assert.match(adminPageCode, /if \(!hasMembership\) return 'no_membership'/);
  assert.match(adminPageCode, /const canInvite = stage === 'not_invited'/);
  assert.match(adminPageCode, /Grant a membership before inviting/);
  // And the server refuses it regardless of what the interface offers.
  assert.match(invite, /no_membership/);
});

test('4. once a membership exists the invitation can be sent', () => {
  assert.match(adminPageCode, /invokeSecureFunction\('builder-portal-invite'/);
  assert.match(adminPageCode, /action, builder_user_id: user\.id/);
  assert.match(adminPageCode, /sendInvite\(user, canInvite \? 'invite' : 'resend'\)/);
  assert.ok(adminPageCode.includes('Send invite'));
  assert.ok(adminPageCode.includes('Resend invite'));
});

test('5. an active user can have access revoked', () => {
  assert.match(adminPageCode, /kind: 'user_revoke_access'/);
  assert.match(adminPageCode, /status: 'revoked'/);
  assert.ok(adminPageCode.includes('Revoke access'));
  assert.match(adminFnCode, /USER_STATUSES = new Set\(\['invited', 'active', 'suspended', 'revoked'\]\)/);
});

test('6. a revoked user cannot sign in', () => {
  assert.match(login, /portalUser\.status !== 'active' \|\| portalUser\.revoked_at/);
});

test('7. revoking or suspending a user ends their sessions', () => {
  const setStatus = activitySql.slice(activitySql.indexOf('builder_admin_set_user_status'));
  assert.match(setStatus, /builder_revoke_user_sessions\(_builder_user_id/);
  // And the confirmation says so before the administrator commits.
  assert.match(adminPageCode, /Every active Builder Portal session is ended/);
});

test('8. a previously activated user can be restored to active', () => {
  // Restore goes straight back to active only for an account that finished
  // setup; the server permits exactly that case and no other.
  assert.match(adminPageCode, /stage === 'suspended' && user\.has_completed_account_setup \? 'active'/);
  assert.match(adminPageCode, /kind: 'user_restore_access'/);
  assert.ok(adminPageCode.includes('Restore access'));
});

test('9. a passwordless or uninvited account is never activated by hand', () => {
  // Server: the activation guard refuses without an accepted invite AND a password.
  assert.match(adminFnCode, /if \(!user\.invite_accepted_at \|\| !user\.password_hash\)/);
  assert.match(adminFnCode, /code: 'invitation_not_accepted'/);
  assert.match(adminFnCode, /if \(status === 'active'\)\s*\{\s*const blocked = await activationBlocker/);
  // Interface: such an account is routed back to the invitation lifecycle.
  assert.match(adminPageCode, /: !user\.has_completed_account_setup \? 'invited'/);
});

test('10. a pending invitation can be revoked without deleting the user', () => {
  assert.match(adminPageCode, /kind: 'user_revoke_invite'/);
  assert.match(adminPageCode, /callInvite\('revoke_invite', user\)/);
  assert.ok(adminPageCode.includes('Revoke invite'));
  assert.match(invite, /action === 'revoke_invite'/);
  // The confirmation promises the account survives.
  assert.match(adminPageCode, /The user account and its memberships are kept/);
});

// ---------------------------------------------------------------------------
// Portal users — permanent removal
// ---------------------------------------------------------------------------

test('11. user removal is refused while protected dependants exist', () => {
  const fn = sqlFunctionBody('builder_admin_delete_user');
  for (const table of [
    'builder_organisation_memberships', 'builder_project_access', 'builder_portal_sessions',
    'builder_document_grants', 'builder_document_versions', 'builder_messages',
    'builder_conversation_participants', 'builder_notifications', 'builder_reservations',
    'builder_unit_holds', 'builder_tasks', 'builder_task_assignments',
    'builder_construction_progress_updates', 'builder_construction_photographs',
  ]) {
    assert.ok(fn.includes(table), `delete_user does not check ${table}`);
  }
  assert.match(fn, /BUILDER_HAS_DEPENDENTS/);
  // The refusal must be counted before the delete, under a lock on the parent.
  assert.ok(fn.indexOf('FOR UPDATE') < fn.indexOf('BUILDER_HAS_DEPENDENTS'));
  assert.ok(fn.indexOf('BUILDER_HAS_DEPENDENTS') < fn.indexOf('DELETE FROM public.builder_portal_users'));
  assert.match(adminFnCode, /\[\/BUILDER_HAS_DEPENDENTS\/, 409, 'has_dependents'\]/);
});

test('12. a user with no protected dependants is removed, and nothing cascades', () => {
  const fn = sqlFunctionBody('builder_admin_delete_user');
  assert.match(fn, /DELETE FROM public\.builder_portal_users WHERE id = _builder_user_id/);
  // Only the account's own setup rows go with it. No business table is deleted.
  const deletes = fn.match(/DELETE FROM public\.[a-z_]+/g) ?? [];
  assert.deepEqual(new Set(deletes), new Set([
    'DELETE FROM public.builder_onboarding_steps',
    'DELETE FROM public.builder_user_preferences',
    'DELETE FROM public.builder_portal_users',
  ]));
  assert.ok(!/CASCADE/i.test(fn), 'user removal must not cascade');
});

test('13. no admin response can carry a credential hash', () => {
  assert.match(adminFnCode, /const SAFE_USER_FIELDS = \[/);
  const safeList = adminFnCode.slice(
    adminFnCode.indexOf('const SAFE_USER_FIELDS = ['),
    adminFnCode.indexOf('] as const;', adminFnCode.indexOf('const SAFE_USER_FIELDS = [')));
  for (const secret of ['password_hash', 'invite_token_hash', 'reset_token_hash', 'token_hash']) {
    assert.ok(!safeList.includes(secret), `${secret} is in the safe projection`);
  }
  // The removal operations return a receipt, never a user row.
  assert.match(operationBlock('delete_user'), /json\(\{ removed: true, result: data \}/);
  assert.doesNotMatch(operationBlock('delete_user'), /projectUser|USER_SELECT/);
});

// ---------------------------------------------------------------------------
// Organisations
// ---------------------------------------------------------------------------

test('14. an organisation is created pending activation', () => {
  const block = operationBlock('upsert_organisation');
  assert.match(block, /status: 'pending_activation', is_active: false/);
  assert.match(adminPageCode, /'upsert_organisation'/);
  assert.ok(adminPageCode.includes('Add organisation'));
});

test('15. an organisation is edited under optimistic concurrency', () => {
  const block = operationBlock('upsert_organisation');
  assert.match(block, /expected_version is required/);
  assert.match(block, /code: 'stale_write', current_version: existing\.row_version/);
  assert.ok(adminPageCode.includes('Edit organisation'));
  assert.match(adminPageCode, /organisation_id: editing\.id, expected_version: editing\.row_version/);
  // The edit form covers the fields the server accepts.
  for (const field of ['legal_name', 'trading_name', 'org_type', 'abn', 'acn',
    'contact_email', 'contact_phone', 'website', 'address_line1', 'suburb', 'state', 'postcode', 'notes']) {
    assert.ok(orgFormDialog.includes(field), `the organisation form omits ${field}`);
  }
});

test('16. an organisation can be suspended, with a reason', () => {
  assert.ok(adminPageCode.includes('Suspend organisation'));
  assert.match(adminPageCode, /kind: 'org_status', organisation, status: 'suspended'/);
  assert.match(adminPageCode, /reasonRequired: true, reasonLabel: 'Reason for suspending'/);
  assert.match(operationBlock('set_organisation_status'), /builder_admin_set_organisation_status/);
});

test('17. a suspended or closed organisation confers no access', () => {
  const accessible = permissionsSql.slice(permissionsSql.indexOf('builder_accessible_organisations'));
  assert.match(accessible, /o\.is_active AND o\.status = 'active'/);
});

test('18. a suspended organisation can be restored', () => {
  assert.ok(adminPageCode.includes('Restore organisation'));
  assert.match(adminPageCode, /organisation\.status === 'suspended' && \(/);
});

test('19. an organisation can be closed, and the consequence is spelled out', () => {
  assert.ok(adminPageCode.includes('Close organisation'));
  assert.match(adminPageCode, /kind: 'org_status', organisation, status: 'closed'/);
  assert.match(adminPageCode, /Projects, transactions, documents and history are all preserved/);
  assert.match(adminPageCode, /lose Builder Portal access/);
});

test('20. organisation removal is refused while dependants exist', () => {
  const fn = sqlFunctionBody('builder_admin_delete_organisation');
  for (const table of [
    'builder_organisation_memberships', 'builder_projects', 'builder_project_access',
    'builder_reservations', 'builder_transactions', 'builder_tasks', 'builder_unit_holds',
    'builder_documents', 'builder_conversations', 'builder_notifications',
  ]) {
    assert.ok(fn.includes(table), `delete_organisation does not check ${table}`);
  }
  assert.match(fn, /BUILDER_HAS_DEPENDENTS/);
  assert.ok(fn.indexOf('BUILDER_HAS_DEPENDENTS') < fn.indexOf('DELETE FROM public.builder_organisations'));
  // The interface names the alternative rather than just refusing.
  assert.match(adminPageCode, /Close it instead/);
});

test('21. an organisation with no dependants is removed, and nothing cascades', () => {
  const fn = sqlFunctionBody('builder_admin_delete_organisation');
  const deletes = fn.match(/DELETE FROM public\.[a-z_]+/g) ?? [];
  assert.deepEqual(new Set(deletes), new Set([
    'DELETE FROM public.builder_organisation_settings',
    'DELETE FROM public.builder_organisations',
  ]));
  assert.ok(!/CASCADE/i.test(fn), 'organisation removal must not cascade');
});

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

test('22. a membership can be granted to an existing user and organisation', () => {
  const block = operationBlock('upsert_membership');
  assert.match(block, /builder_admin_upsert_membership/);
  assert.match(block, /Organisation not found/);
  assert.match(block, /User not found/);
  assert.ok(adminPageCode.includes('Grant membership'));
});

test('23. a duplicate live membership cannot be created', () => {
  // The command matches the live row and updates it rather than inserting a
  // second one, and a partial unique index backs that up.
  const fn = sqlFunctionBody('builder_admin_upsert_membership');
  assert.match(fn, /WHERE builder_user_id = _builder_user_id AND organisation_id = _organisation_id\s*\n\s*AND revoked_at IS NULL\s*\n\s*FOR UPDATE/);
  assert.match(fn, /IF v_existing\.id IS NOT NULL THEN/);
  const orgSql = read('supabase/migrations/20260801000000_builder_portal_phase1_organisations_users.sql');
  assert.match(orgSql, /builder_memberships_live_key[\s\S]{0,160}WHERE revoked_at IS NULL/);
  // Neither a closed organisation nor a revoked user may be given one.
  assert.match(operationBlock('upsert_membership'), /organisation\.status === 'closed'/);
  assert.match(operationBlock('upsert_membership'), /user\.status === 'revoked'/);
});

test('24. a membership role can be edited under optimistic concurrency', () => {
  assert.ok(adminPageCode.includes('Edit membership'));
  assert.match(adminPageCode, /expected_version: editingLive\.row_version/);
  assert.match(sqlFunctionBody('builder_admin_upsert_membership'), /BUILDER_STALE_WRITE/);
  assert.match(membershipFormDialog, /membership_role/);
});

test('25. the primary organisation moves atomically instead of colliding', () => {
  // A partial unique index allows one primary per user, so the flag has to be
  // cleared from the previous holder in the same transaction that sets it.
  const fn = sqlFunctionBody('builder_admin_upsert_membership');
  assert.match(fn, /IF COALESCE\(_is_primary, false\) THEN/);
  assert.match(fn, /SET is_primary = false/);
  assert.match(fn, /AND \(v_existing\.id IS NULL OR id <> v_existing\.id\)/);
  assert.ok(fn.indexOf('SET is_primary = false') < fn.indexOf('INSERT INTO public.builder_organisation_memberships'));
  assert.ok(adminPageCode.includes('Set primary'));
  assert.match(adminPageCode, /is_primary: true/);
});

test('26. a membership can be revoked, with a reason', () => {
  assert.ok(adminPageCode.includes('Revoke membership'));
  assert.match(adminPageCode, /kind: 'membership_revoke'/);
  assert.match(adminPageCode, /'revoke_membership'/);
  assert.match(adminPageCode, /reasonLabel: 'Reason for revoking'/);
  // Revocation keeps the record — it is the evidence access once existed.
  assert.match(adminPageCode, /The membership record is kept, marked revoked, as audit evidence/);
});

test('27. revoking the last membership warns that all portal access ends', () => {
  assert.match(adminPageCode, /liveMembershipCountFor\(membership\.builder_user_id\) === 1/);
  assert.match(adminPageCode, /This is their last active membership/);
  assert.match(adminPageCode, /they will lose all Builder Portal access/);
});

test('28. a revoked membership can be re-granted without resurrecting the old row', () => {
  assert.ok(adminPageCode.includes('Restore membership'));
  // upsert matches only live rows, so a revoked one is replaced by a fresh
  // grant and the revoked record stays put.
  assert.match(adminPageCode, /!membershipDialog\.membership\.revoked_at/);
  // A re-grant does not activate anybody by itself.
  assert.match(membershipFormDialog, /They still need to accept an\s*\n?\s*invitation and set a password/);
});

test('29. membership removal deletes the link and nothing else', () => {
  const fn = sqlFunctionBody('builder_admin_delete_membership');
  const deletes = fn.match(/DELETE FROM public\.[a-z_]+/g) ?? [];
  assert.deepEqual(deletes, ['DELETE FROM public.builder_organisation_memberships']);
  // A revoked membership is audit evidence and is never removed.
  assert.match(fn, /IF v_membership\.revoked_at IS NOT NULL THEN/);
  assert.match(fn, /a revoked membership is retained as audit evidence/);
  assert.match(fn, /builder_membership_permissions/);
  assert.match(fn, /builder_project_access/);
  assert.match(adminPageCode, /The user is kept\. The organisation is kept\./);
});

// ---------------------------------------------------------------------------
// Cross-cutting guarantees
// ---------------------------------------------------------------------------

test('30. every destructive operation needs permission, CSRF, a reason and a version', () => {
  // Only reads are exempt from CSRF, and only reads settle for can_view.
  assert.match(adminFnCode, /if \(!READ_OPERATIONS\.has\(operation\)\) \{\s*const csrf = enforceCsrf\(req\)/);
  assert.match(adminFnCode, /return READ_OPERATIONS\.has\(operation\) \? 'can_view' : 'can_edit'/);
  const readOps = adminFnCode.slice(
    adminFnCode.indexOf('const READ_OPERATIONS = new Set(['),
    adminFnCode.indexOf(']);', adminFnCode.indexOf('const READ_OPERATIONS = new Set([')));
  for (const destructive of ['delete_user', 'delete_organisation', 'delete_membership']) {
    assert.ok(!readOps.includes(destructive), `${destructive} is treated as a read`);
    const block = operationBlock(destructive);
    assert.match(block, /A reason is required/, `${destructive} does not require a reason`);
    assert.match(block, /expected_version is required/, `${destructive} skips concurrency`);
    assert.match(block, /code: 'reason_required'/);
  }
  // The database enforces the reason again, so a direct RPC cannot skip it.
  for (const fn of ['builder_admin_delete_user', 'builder_admin_delete_organisation',
    'builder_admin_delete_membership']) {
    assert.match(sqlFunctionBody(fn), /BUILDER_REASON_REQUIRED/, `${fn} does not require a reason`);
    assert.match(sqlFunctionBody(fn), /BUILDER_STALE_WRITE/, `${fn} does not check the version`);
    assert.match(sqlFunctionBody(fn), /builder_log_activity/, `${fn} does not write an audit record`);
  }
  // Removal is audited before the row goes, because the audit link is SET NULL.
  const deleteUser = sqlFunctionBody('builder_admin_delete_user');
  assert.ok(deleteUser.indexOf('builder_log_activity') < deleteUser.indexOf('DELETE FROM public.builder_portal_users'));
  // Service-role only, like every other guarded command.
  for (const fn of ['builder_admin_delete_user', 'builder_admin_delete_organisation',
    'builder_admin_delete_membership']) {
    assert.match(deletionSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^\\n]*FROM PUBLIC, anon, authenticated`));
  }
  // And every destructive action is confirmed, with a reason box, in the UI.
  assert.match(confirmDialog, /reasonRequired \|\| reason\.trim\(\)\.length > 0/);
  assert.match(confirmDialog, /Recorded against this action in the Builder audit trail/);
});

test('31. invitation acceptance is untouched', () => {
  assert.match(acceptInvite, /invite_token_hash/);
  assert.match(acceptInvite, /password_hash/);
  // Acceptance is still what sets the account active — not the admin surface.
  assert.match(acceptInvite, /invite_accepted_at/);
  assert.doesNotMatch(adminFnCode, /invite_accepted_at:\s*new Date/);
});

test('32. login and session restoration are untouched', () => {
  assert.match(login, /__Host-builder_session_token|createBuilderSessionCookie/);
  assert.doesNotMatch(adminFnCode, /createBuilderSessionCookie/);
  // The admin surface never mints or reads a Builder portal session.
  assert.doesNotMatch(adminPage, /session_token|sessionToken|document\.cookie/);
});

test('33. terms and onboarding remain the portal’s own concern', () => {
  // The admin function reads these flags but never writes them.
  assert.match(adminFnCode, /has_accepted_current_terms/);
  assert.doesNotMatch(adminFnCode, /has_accepted_current_terms:\s*(true|false)/);
  assert.doesNotMatch(adminFnCode, /has_completed_onboarding:\s*(true|false)/);
});

test('34. no rollout gate is reintroduced', () => {
  for (const source of [adminFn, adminPage, deletionSql, confirmDialog,
    userFormDialog, orgFormDialog, membershipFormDialog, permissionsDialog]) {
    assert.doesNotMatch(source, /ROLLOUT_ENABLED_MODES|rollout_disabled|AdminBuilderReleasePanel/);
  }
  assert.doesNotMatch(adminPage, /TabsTrigger value="release"/);
});

test('35. nothing here reaches into the Solicitor Portal', () => {
  // A reach is an import, an invoked function or a touched table. The word
  // itself is allowed to appear in a comment or in copy that tells the
  // administrator which keys are NOT available here.
  for (const source of [adminFn, adminPage, deletionSql, confirmDialog,
    userFormDialog, orgFormDialog, membershipFormDialog, permissionsDialog]) {
    const code = source.trimStart().startsWith('--') || source.includes('CREATE OR REPLACE FUNCTION')
      ? stripSqlComments(source)
      : stripJsComments(source);
    assert.doesNotMatch(code, /invokeSecureFunction\(\s*'solicitor|'solicitor-portal/i);
    assert.doesNotMatch(code, /from '[^']*solicitor[^']*'/i);
    assert.doesNotMatch(code, /solicitor_[a-z_]+/i);
  }
  // Nor into the Finance-owned tables, which stay off-limits to this function.
  assert.doesNotMatch(deletionSql, /builder_invoices|build_progress_payments/);
});

// ---------------------------------------------------------------------------
// Action visibility — a row offers only what its stage allows
// ---------------------------------------------------------------------------

test('the per-stage action set matches the documented lifecycle', () => {
  // Invitation actions are gated on the stage, never shown unconditionally.
  assert.match(adminPageCode, /\{canResend && \(/);
  assert.match(adminPageCode, /\{stage === 'active' && \(/);
  assert.match(adminPageCode, /\{\(stage === 'suspended' \|\| stage === 'revoked'\) && \(/);
  // Revoking access is meaningless for an already revoked account.
  assert.match(adminPageCode, /\{stage !== 'revoked' && \(/);
  // Grant membership is offered exactly where the user has none.
  assert.match(adminPageCode, /\{stage === 'no_membership' && \(/);
});

test('every control is hidden from an administrator without edit permission', () => {
  assert.match(adminPageCode, /useModulePermissions\('builder_portal_admin'\)/);
  const triggers = adminPageCode.match(/<DropdownMenuTrigger asChild>[\s\S]*?<\/DropdownMenuTrigger>/g) ?? [];
  assert.ok(triggers.length >= 3, 'expected an action menu on each of the three tables');
  for (const trigger of triggers) {
    assert.match(trigger, /disabled=\{!canEdit \|\| busy\}/);
  }
});

test('a refused removal explains itself instead of closing the dialog', () => {
  assert.match(adminPageCode, /failure\?\.code === 'has_dependents'/);
  assert.match(adminPageCode, /setConfirmBlocked\(describeBlockedRemoval\(/);
  assert.match(adminFnCode, /dependents=\(\[\^\\n\]\+\)/);
  assert.match(confirmDialog, /blocked\.dependents\.map/);
  assert.match(confirmDialog, /Still attached:/);
});

test('permission overrides stay inside the Builder boundary', () => {
  // The catalogue the dialog renders is the server's, which already excludes
  // every forbidden key; the dialog never invents one.
  assert.match(operationBlock('get_permission_catalogue'), /eq\('is_forbidden', false\)/);
  assert.match(operationBlock('update_membership_permissions'), /eq\('is_forbidden', false\)/);
  assert.match(operationBlock('update_membership_permissions'), /if \(allowed\.get\(key\) === 'inbound_projection'\)/);
  // The dialog renders the server's catalogue and invents no key of its own.
  assert.match(permissionsDialog, /permissionKeys\.map\(/);
  assert.doesNotMatch(stripJsComments(permissionsDialog), /'builder\.[a-z_.]+'/);
  // Leaving a key alone must mean "grant nothing", not "grant the default".
  assert.match(permissionsDialog, /const DECISIONS: PermissionDecision\[\] = \['inherit', 'allow', 'deny'\]/);
  assert.match(permissionsDialog, /resolves deny-by-default/);
});
