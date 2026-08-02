/**
 * Builder / Developer Portal — user access flow contract tests.
 *
 * These cover the Command Centre lifecycle
 *
 *   create user -> grant membership -> send invite -> user accepts -> active
 *
 * and the two invitation-acceptance defects that made it unusable:
 *
 *   * `builder-portal-accept-invite` declared `const organisations` twice in
 *     one block scope. That is a SyntaxError, so the function could not even
 *     parse — Builder invitation acceptance was completely dead.
 *   * `solicitor-portal-accept-invite` tested `updatedUser` without ever
 *     binding it, throwing a ReferenceError on the success path after the
 *     password had already been written.
 *
 * Like the rest of this directory these are static assertions over the source,
 * so they run with no database and no network and gate every CI run. The
 * behaviour they describe is exercised against a live database by
 * scripts/builder-portal/local-db/verify-phase-1.mjs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const acceptInvite = read('supabase/functions/builder-portal-accept-invite/index.ts');
const invite = read('supabase/functions/builder-portal-invite/index.ts');
const adminFn = read('supabase/functions/builder-portal-admin/index.ts');
const login = read('supabase/functions/builder-portal-login/index.ts');
const adminPage = read('src/pages/admin/BuilderPortalAdmin.tsx');
const solicitorAccept = read('supabase/functions/solicitor-portal-accept-invite/index.ts');
const permissionsSql = read('supabase/migrations/20260801000100_builder_portal_phase1_permissions.sql');
const activitySql = read('supabase/migrations/20260801000600_builder_portal_activity_log.sql');
const sessionsSql = read('supabase/migrations/20260801000200_builder_portal_phase1_sessions.sql');

/** Comments explain the defects being corrected; searching them finds phantoms. */
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const acceptInviteCode = stripJsComments(acceptInvite);
const adminFnCode = stripJsComments(adminFn);
const inviteCode = stripJsComments(invite);
const adminPageCode = stripJsComments(adminPage);
const solicitorAcceptCode = stripJsComments(solicitorAccept);

/** Count block-scoped declarations of `name` at the top level of a function body. */
const declarationsOf = (code, name) =>
  (code.match(new RegExp(`\\b(?:const|let)\\s+${name}\\b`, 'g')) ?? []).length;

// ---------------------------------------------------------------------------
// The two confirmed compile-breaking defects
// ---------------------------------------------------------------------------

test('builder invite acceptance declares `organisations` at most once per scope', () => {
  // The regression: two `const organisations` in the same try block. The fix
  // names them for the lifecycle stage they belong to, because they are not
  // interchangeable — see the next test.
  assert.equal(declarationsOf(acceptInviteCode, 'organisations'), 0,
    'a bare `const organisations` is back; use a stage-specific name');
  assert.equal(declarationsOf(acceptInviteCode, 'invitedOrganisations'), 1);
  assert.equal(declarationsOf(acceptInviteCode, 'accessibleOrganisations'), 1);
});

test('the pre-activation lookup does not use the active-user-only resolver', () => {
  // `builder_accessible_organisations` filters on `u.is_active AND u.status =
  // 'active'`, so before acceptance it can only ever return nothing. Using it
  // to answer "does this invite lead anywhere" made the eligibility gate a
  // no-op and left the acceptance form unable to name the organisation.
  assert.match(permissionsSql,
    /builder_accessible_organisations[\s\S]{0,600}u\.is_active AND u\.status = 'active'/);

  const beforeActivation = acceptInviteCode.slice(
    acceptInviteCode.indexOf('Deno.serve'),
    acceptInviteCode.indexOf("action === 'validate'"));
  assert.doesNotMatch(beforeActivation, /listAccessibleOrganisations/,
    'the pre-activation path must read memberships directly');
  assert.match(acceptInviteCode, /const invitedOrganisations = await listInvitedOrganisations\(/);

  // The validate response names the organisation from that direct read.
  assert.match(acceptInviteCode, /organisations: invitedOrganisations\.map\(/);

  // listInvitedOrganisations reads memberships, skips revoked ones, and
  // excludes closed organisations.
  const helper = acceptInviteCode.slice(acceptInviteCode.indexOf('async function listInvitedOrganisations'));
  assert.match(helper, /from\('builder_organisation_memberships'\)/);
  assert.match(helper, /\.is\('revoked_at', null\)/);
  assert.match(helper, /\.neq\('status', 'closed'\)/);
});

test('the post-activation lookup is the one the session is scoped to', () => {
  const afterActivation = acceptInviteCode.slice(acceptInviteCode.indexOf('builder_ensure_onboarding_steps'));
  assert.match(afterActivation, /const accessibleOrganisations = await listAccessibleOrganisations\(/);
  assert.match(afterActivation, /accessibleOrganisations\.find\(\(organisation\) => organisation\.is_primary\)/);
  assert.match(afterActivation, /organisations: accessibleOrganisations/);
});

test('solicitor invitation acceptance binds the row it then checks', () => {
  // The regression: `if (updateError || !updatedUser)` with no `updatedUser`
  // in scope — a ReferenceError on every successful acceptance.
  assert.match(solicitorAcceptCode, /const \{ data: updatedUser, error: updateError \} = await supabase/);
  assert.match(solicitorAcceptCode, /if \(updateError \|\| !updatedUser\)/);

  // Every use is preceded by the binding.
  const binding = solicitorAcceptCode.indexOf('data: updatedUser');
  const firstUse = solicitorAcceptCode.indexOf('!updatedUser');
  assert.ok(binding > -1 && binding < firstUse, 'updatedUser is used before it is bound');
});

// ---------------------------------------------------------------------------
// 1. Creation starts invited and inactive
// ---------------------------------------------------------------------------

test('a new Builder portal user starts invited, inactive and passwordless', () => {
  const createUser = adminFnCode.slice(
    adminFnCode.indexOf("case 'create_user'"), adminFnCode.indexOf("case 'update_user'"));
  assert.match(createUser, /status: 'invited', is_active: false/);
  assert.match(createUser, /must_change_password: true/);
  // Nothing in the create path writes a password or a token.
  assert.doesNotMatch(createUser, /password_hash/);
  assert.doesNotMatch(createUser, /invite_token_hash/);
});

// ---------------------------------------------------------------------------
// 2 & 3. Membership gates the invitation
// ---------------------------------------------------------------------------

test('an invitation cannot be issued to a user with no membership', () => {
  assert.match(inviteCode,
    /from\('builder_organisation_memberships'\)[\s\S]{0,200}\.is\('revoked_at', null\)/);
  assert.match(inviteCode, /code: 'no_membership'/);
  assert.match(inviteCode, /\}, 409\)/);

  // The 409 is raised only when the membership lookup came back empty, so the
  // same guard permits issuance once a membership exists.
  assert.match(inviteCode,
    /if \(!Array\.isArray\(memberships\) \|\| !memberships\.length\) \{[\s\S]{0,240}no_membership/);
});

test('the membership gate runs before any token is generated', () => {
  const gate = inviteCode.indexOf("code: 'no_membership'");
  const mint = inviteCode.indexOf('crypto.randomUUID()');
  assert.ok(gate > -1 && mint > -1 && gate < mint,
    'a token must never be minted for a user who cannot be invited');
});

test('an already-active or revoked account is refused a fresh invitation', () => {
  assert.match(inviteCode, /portalUser\.invite_accepted_at \|\| portalUser\.password_hash/);
  assert.match(inviteCode, /code: 'already_active'/);
  assert.match(inviteCode, /portalUser\.revoked_at \|\| portalUser\.status === 'revoked'/);
});

// ---------------------------------------------------------------------------
// 4. A passwordless invited user cannot be activated by hand
// ---------------------------------------------------------------------------

test('manual activation is refused server-side, not merely hidden in the UI', () => {
  // The guarded database command happily flips any row to active, so the
  // precondition has to live in the function ahead of it.
  assert.match(adminFnCode, /async function activationBlocker\(/);
  assert.match(adminFnCode,
    /if \(status === 'active'\) \{[\s\S]{0,200}activationBlocker\(supabase, userId, existing\)[\s\S]{0,120}409, cors\)/);

  const blocker = adminFnCode.slice(
    adminFnCode.indexOf('async function activationBlocker'),
    adminFnCode.indexOf('const json = (body: unknown'));

  // All five preconditions.
  assert.match(blocker, /user\.revoked_at \|\| user\.status === 'revoked'/);
  assert.match(blocker, /!user\.invite_accepted_at \|\| !user\.password_hash/);
  assert.match(blocker, /code: 'invitation_not_accepted'/);
  assert.match(blocker, /code: 'no_membership'/);
  assert.match(blocker, /organisation\.status !== 'closed'/);
  assert.match(blocker, /code: 'organisation_closed'/);
});

test('the activation guard reads the columns it judges on', () => {
  const setStatus = adminFnCode.slice(
    adminFnCode.indexOf("case 'set_user_status'"), adminFnCode.indexOf("case 'list_memberships'"));
  assert.match(setStatus, /invite_accepted_at/);
  assert.match(setStatus, /password_hash/);
  // Guard runs after the optimistic-concurrency check, so a stale write still
  // loses first.
  assert.ok(setStatus.indexOf("code: 'stale_write'") < setStatus.indexOf('activationBlocker'));
});

test('the guard permits restoring a genuinely activated, suspended user', () => {
  // Nothing in the blocker rejects `status === 'suspended'`; only revoked,
  // unaccepted, membership-less and closed-organisation cases are refused.
  const blocker = adminFnCode.slice(
    adminFnCode.indexOf('async function activationBlocker'),
    adminFnCode.indexOf('const json = (body: unknown'));
  assert.doesNotMatch(blocker, /status === 'suspended'/);
  assert.match(blocker, /return null;/);
});

// ---------------------------------------------------------------------------
// 5, 6, 7. Acceptance activates once, and only while valid
// ---------------------------------------------------------------------------

test('accepting the invitation is what activates the account', () => {
  assert.match(acceptInviteCode, /status: 'active'/);
  assert.match(acceptInviteCode, /is_active: true/);
  assert.match(acceptInviteCode, /invite_accepted_at: new Date\(\)\.toISOString\(\)/);
  assert.match(acceptInviteCode, /password_hash: hashedPassword/);
  assert.match(acceptInviteCode, /builder_ensure_onboarding_steps/);
  assert.match(acceptInviteCode, /issueBuilderSession\(/);
});

test('acceptance is single use and clears the invitation credentials', () => {
  const update = acceptInviteCode.slice(
    acceptInviteCode.indexOf('const { data: updatedUser'),
    acceptInviteCode.indexOf('if (updateError)'));
  assert.match(update, /invite_token_hash: null/);
  assert.match(update, /invite_token_expires_at: null/);
  // A concurrent second acceptance matches no row.
  assert.match(update, /\.eq\('invite_token_hash', tokenHash\)/);
  assert.match(update, /\.is\('invite_accepted_at', null\)/);
  assert.match(update, /\.maybeSingle\(\)/);
  assert.match(acceptInviteCode, /if \(!updatedUser\) return json\(\{ error: GENERIC_INVITE_ERROR/);
});

test('expired, revoked and already-used invitations are rejected', () => {
  assert.match(acceptInviteCode,
    /new Date\(portalUser\.invite_token_expires_at\) < new Date\(\)/);
  assert.match(acceptInviteCode, /expired: true/);
  assert.match(acceptInviteCode, /portalUser\.revoked_at \|\| portalUser\.status === 'revoked'/);
  assert.match(acceptInviteCode, /portalUser\.invite_accepted_at \|\| portalUser\.password_hash/);
});

test('the password is strength-checked before it is stored', () => {
  const strength = acceptInviteCode.indexOf('validatePasswordStrength(password)');
  const hash = acceptInviteCode.indexOf('await hashPassword(password)');
  assert.ok(strength > -1 && strength < hash);
});

// ---------------------------------------------------------------------------
// 8. Login requires an active account and an active membership
// ---------------------------------------------------------------------------

test('login refuses an account that is not active', () => {
  assert.match(stripJsComments(login),
    /!portalUser\.is_active \|\| portalUser\.status !== 'active' \|\| portalUser\.revoked_at/);
});

test('login resolves organisations through the membership-gated resolver', () => {
  assert.match(login, /listAccessibleOrganisations\(supabase, portalUser\.id\)/);
  // That resolver requires an active membership of an active organisation.
  const resolver = permissionsSql.slice(
    permissionsSql.indexOf('FUNCTION public.builder_accessible_organisations'));
  const body = resolver.slice(0, resolver.indexOf('$$;'));
  assert.match(body, /m\.status = 'active' AND m\.revoked_at IS NULL/);
  assert.match(body, /o\.is_active AND o\.status = 'active'/);
  assert.match(body, /u\.is_active AND u\.status = 'active' AND u\.revoked_at IS NULL/);
});

// ---------------------------------------------------------------------------
// 9 & 10. Losing access ends sessions
// ---------------------------------------------------------------------------

test('suspending a user ends their sessions in the same transaction', () => {
  const setStatus = activitySql.slice(
    activitySql.indexOf('FUNCTION public.builder_admin_set_user_status'),
    activitySql.indexOf('3d. Organisation suspended'));
  assert.match(setStatus, /is_active = \(_status = 'active'\)/);
  assert.match(setStatus,
    /IF _status <> 'active' THEN[\s\S]{0,200}builder_revoke_user_sessions\(_builder_user_id/);
});

test('revoking the last membership removes access and ends sessions', () => {
  const combined = `${sessionsSql}\n${activitySql}`;
  assert.match(combined, /builder_organisation_memberships/);
  assert.match(combined, /builder_revoke_user_sessions/);
  // A revoked membership stops satisfying the accessible-organisations
  // resolver, which is what "removes access" means here.
  assert.match(permissionsSql,
    /builder_accessible_organisations[\s\S]{0,600}m\.revoked_at IS NULL/);
});

// ---------------------------------------------------------------------------
// 11. No plaintext token is returned or stored improperly
// ---------------------------------------------------------------------------

test('the invitation function stores only a hash and never a plaintext token', () => {
  assert.match(inviteCode, /const inviteTokenHash = await hashSessionToken\(inviteToken\)/);
  assert.match(inviteCode, /invite_token_hash: inviteTokenHash/);
  // No column is written the plaintext.
  assert.doesNotMatch(inviteCode, /invite_token: inviteToken/);
  assert.doesNotMatch(inviteCode, /\binvite_token\b\s*:/);
  // Hashing being unavailable refuses the whole operation rather than
  // degrading to an unpeppered store.
  assert.match(inviteCode, /if \(!inviteTokenHash\)[\s\S]{0,240}503/);
});

test('the plaintext link is returned only when the email could not be sent', () => {
  assert.match(inviteCode, /invite_url: emailSent \? undefined : inviteUrl/);
  // The link points at the Builder acceptance route.
  assert.match(inviteCode, /\$\{appUrl\}\/builder\/accept-invite\?token=\$\{encodeURIComponent\(inviteToken\)\}/);
});

test('invitation acceptance returns session metadata but never the session token', () => {
  // The JSON body only — the Set-Cookie header that follows it legitimately
  // carries the token.
  const body = acceptInviteCode.slice(
    acceptInviteCode.indexOf('success: true'),
    acceptInviteCode.indexOf("'Set-Cookie'"));
  assert.match(body, /absolute_expires_at: issued\.absoluteExpiresAt\.toISOString\(\)/);
  assert.match(body, /idle_expires_at: issued\.idleExpiresAt\.toISOString\(\)/);
  assert.doesNotMatch(body, /issued\.token/);
  // The token leaves only inside the HttpOnly cookie.
  assert.match(acceptInviteCode, /'Set-Cookie': createBuilderSessionCookie\(issued\.token/);
});

test('the admin function never returns a password, invite or reset hash', () => {
  assert.match(adminFnCode, /const projectUser = /);
  // Every handler that returns user data projects it. The empty early-return
  // carries no row and so needs no projection.
  const returns = (adminFnCode.match(/return json\(\{ users?: [^}]*\}/g) ?? [])
    .filter((statement) => !/users: \[\]/.test(statement));
  assert.ok(returns.length >= 4,
    `expected at least 4 user-returning handlers, found ${returns.length}`);
  for (const statement of returns) {
    assert.match(statement, /projectUser/, `unprojected user response: ${statement}`);
  }
  // The RPC returns the whole row, token hashes included, so it is projected too.
  assert.match(adminFnCode, /return json\(\{ user: projectUser\(data as Record<string, any>\) \}/);
});

test('the safe field list and the select string stay in step', () => {
  const listed = (adminFn.match(/const SAFE_USER_FIELDS = \[([\s\S]*?)\] as const;/) ?? [])[1];
  assert.ok(listed, 'SAFE_USER_FIELDS not found');
  const fields = [...listed.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();

  const select = (adminFn.match(/const USER_SELECT = `([\s\S]*?)`;/) ?? [])[1];
  assert.ok(select, 'USER_SELECT not found');
  const selected = select.split(',').map((entry) => entry.trim()).filter(Boolean).sort();

  assert.deepEqual(selected, fields,
    'USER_SELECT and SAFE_USER_FIELDS have drifted — a column could leak or go missing');
  for (const secret of ['password_hash', 'invite_token_hash', 'reset_token_hash']) {
    assert.ok(!fields.includes(secret), `${secret} is in the safe field list`);
  }
});

test('list_users returns the invitation state the Command Centre needs', () => {
  for (const field of [
    'invited_at', 'invite_token_expires_at', 'invite_accepted_at',
    'last_login_at', 'status', 'is_active',
  ]) {
    assert.match(adminFn, new RegExp(`'${field}'`), `SAFE_USER_FIELDS is missing ${field}`);
  }
  assert.match(adminFnCode,
    /has_completed_account_setup = !!row\.password_hash && !!row\.invite_accepted_at/);
});

// ---------------------------------------------------------------------------
// The Command Centre interface
// ---------------------------------------------------------------------------

test('the Builder admin page issues invitations through the existing function', () => {
  assert.match(adminPageCode, /invokeSecureFunction\('builder-portal-invite'/);
  assert.match(adminPageCode, /action, builder_user_id: user\.id/);
  for (const action of ['invite', 'resend', 'revoke_invite']) {
    assert.match(adminPageCode, new RegExp(`'${action}'`), `missing the ${action} action`);
  }
});

test('the browser never mints, hashes or persists an invitation token', () => {
  assert.doesNotMatch(adminPageCode, /randomUUID|hashSessionToken|invite_token_hash/);
  assert.doesNotMatch(adminPageCode, /localStorage|sessionStorage/);
});

test('the page offers Send invite only once a membership exists', () => {
  assert.match(adminPageCode, /const canInvite = stage === 'not_invited'/);
  assert.match(adminPageCode, /if \(!hasMembership\) return 'no_membership'/);
  // The no-membership row explains itself instead of offering a dead action.
  assert.match(adminPageCode, /Grant a membership before inviting/);
  assert.match(adminPageCode, /No access/);
});

test('the page no longer offers a bare Activate action', () => {
  // The defect: a single button that flipped any inactive user to active,
  // including an invited, passwordless one.
  assert.doesNotMatch(adminPageCode, /user\.is_active \? 'suspended' : 'active'/);
  assert.doesNotMatch(adminPageCode, /\{user\.is_active \? 'Suspend' : 'Activate'\}/);
  // Restore is gated on the account having actually completed setup.
  assert.match(adminPageCode,
    /stage === 'suspended' && user\.has_completed_account_setup/);
});

test('the page exposes the full set of per-user access actions', () => {
  for (const label of [
    'Send invite', 'Resend invite', 'Revoke invite',
    'Suspend', 'Restore', 'Revoke sessions', 'Copy link',
  ]) {
    assert.ok(adminPageCode.includes(label), `missing the ${label} action`);
  }
});

test('the invitation link is surfaced only when email delivery failed', () => {
  assert.match(adminPageCode, /result\?\.email_sent/);
  assert.match(adminPageCode, /else if \(result\?\.invite_url\)/);
  assert.match(adminPageCode, /setInviteLink\(\{ email: user\.email, url: result\.invite_url \}\)/);
});

test('the page states the lifecycle order it enforces', () => {
  assert.match(adminPageCode, /create the user/);
  assert.match(adminPageCode, /grant an organisation membership/);
  assert.match(adminPageCode, /send the invitation/);
  assert.match(adminPageCode, /accepts and sets a password/);
  assert.match(adminPageCode, /becomes active/);
});

// ---------------------------------------------------------------------------
// 13. The Solicitor Portal is otherwise untouched
// ---------------------------------------------------------------------------

test('the Solicitor invite fix does not change its workflow', () => {
  // Same single-use condition, same firm model, same session issuance.
  assert.match(solicitorAcceptCode, /\.is\('invite_accepted_at', null\)/);
  assert.match(solicitorAcceptCode, /\.eq\('invite_token', token\)/);
  assert.match(solicitorAcceptCode, /issueSolicitorSession\(/);
  assert.match(solicitorAcceptCode, /createSolicitorSessionCookie\(issued\.token/);
  assert.match(solicitorAcceptCode, /solicitor_firms:firm_id/);
  // The Builder organisation model was not grafted onto it.
  assert.doesNotMatch(solicitorAcceptCode, /builder_organisation|listAccessibleOrganisations/);
});

test('Solicitor login and admin remain untouched by this change', () => {
  const solicitorLogin = read('supabase/functions/solicitor-portal-login/index.ts');
  const solicitorAdmin = read('supabase/functions/solicitor-portal-admin/index.ts');
  assert.match(solicitorLogin, /issueSolicitorSession|solicitor_portal_users/);
  assert.match(solicitorAdmin, /solicitor_portal_users|solicitor_firms/);
  // Neither picked up the Builder guard or the Builder projection.
  assert.doesNotMatch(solicitorLogin, /activationBlocker/);
  assert.doesNotMatch(solicitorAdmin, /activationBlocker|has_completed_account_setup/);
});

// ---------------------------------------------------------------------------
// Security invariants that must survive the repair
// ---------------------------------------------------------------------------

test('the Builder invite function stays an internal, CSRF-protected surface', () => {
  const registry = JSON.parse(read('supabase/functions-registry/SECURITY_REGISTRY.json'));
  assert.equal(registry.functions['builder-portal-invite'].verify_jwt, true);
  assert.equal(registry.functions['builder-portal-accept-invite'].verify_jwt, false);
  assert.match(inviteCode, /enforceCsrf\(req\)/);
  assert.match(inviteCode, /requireModulePermission\(/);
  assert.match(inviteCode, /builder_portal_admin/);
});

test('the admin function keeps CSRF and deny-by-default authorization', () => {
  assert.match(adminFnCode, /if \(!READ_OPERATIONS\.has\(operation\)\) \{[\s\S]{0,160}enforceCsrf\(req\)/);
  assert.match(adminFnCode, /requireModulePermission\(/);
  assert.match(adminFnCode, /createForbiddenResponse\(/);
});

test('acceptance keeps its rate limit and single generic rejection message', () => {
  assert.match(acceptInviteCode, /check_and_bump_rate_limit/);
  assert.match(acceptInviteCode, /const GENERIC_INVITE_ERROR = 'Invalid or expired invite link'/);
  assert.match(acceptInviteCode, /validateBuilderPortalRequest\(req\)/);
});

test('no Builder rollout gate was reintroduced', () => {
  for (const source of [acceptInvite, invite, adminFn, login, adminPage]) {
    assert.doesNotMatch(source, /ROLLOUT_ENABLED_MODES|rollout_disabled/);
  }
});
