/**
 * Builder / Developer Portal — release-control plane contract tests.
 *
 * Static contract assertions over the release-control migration, the
 * builder-portal-admin release operations, the shared rollout gate and the
 * Command Centre release panel. They run with no database and no network.
 *
 * The behavioural half — transitions, rejections, optimistic concurrency,
 * audit rollback, approval revocation, organisation isolation — is executed
 * against a live PostgreSQL database by
 * scripts/builder-portal/local-db/verify-release-control.mjs.
 *
 * Many assertions below are NEGATIVE. The Solicitor rollout plane carries
 * defects this one must not reproduce:
 *
 *   NOCOPY-R1  approvals written directly from the Edge Function rather than
 *              through a guarded command
 *   NOCOPY-R2  audit written after the RPC has already committed, so a failed
 *              audit leaves an unevidenced state change
 *   NOCOPY-R3  no optimistic concurrency on the mutable rollout row
 *   NOCOPY-R4  no approval revocation path at all
 *   NOCOPY-R5  readiness hardcoded to solicitor-only evidence
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const stripSqlComments = (body) => body.replace(/--[^\n]*/g, '');
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const MIGRATION = '20260810000000_builder_portal_release_control_plane.sql';
const migrationSql = read(join('supabase/migrations', MIGRATION));
const migration = stripSqlComments(migrationSql);

const adminSource = read('supabase/functions/builder-portal-admin/index.ts');
const admin = stripJsComments(adminSource);
const authSource = read('supabase/functions/_shared/builderPortalAuth.ts');
const auth = stripJsComments(authSource);
const adminPage = read('src/pages/admin/BuilderPortalAdmin.tsx');

// ===========================================================================
// Migration shape
// ===========================================================================
test('the release-control migration exists and is additive', () => {
  assert.ok(existsSync(join(root, 'supabase/migrations', MIGRATION)));
  // No merged migration may be rewritten, and nothing may be destroyed.
  assert.doesNotMatch(migration, /\bDROP TABLE (?!IF EXISTS _builder_release_premigration)/i);
  assert.doesNotMatch(migration, /\bDROP COLUMN\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE FROM public\./i);
});

test('the migration guards its preconditions and asserts its postconditions', () => {
  assert.match(migration, /PRE-MIGRATION FAILURE/);
  assert.match(migration, /POST-MIGRATION FAILURE/);
  // Row counts on every shared table must be proven unchanged.
  for (const table of ['cross_portal_firm_rollouts', 'cross_portal_rollout_history',
                       'cross_portal_cutover_approvals']) {
    assert.match(migration, new RegExp(`count\\(\\*\\) FROM public\\.${table}`));
  }
});

test('the Solicitor plane is preserved rather than redefined', () => {
  // The Builder migration must never redefine a Solicitor command.
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.set_cross_portal_firm_rollout\b/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.get_cross_portal_cutover_readiness\b/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.resolve_cross_portal_feature_mode\s*\(/);
  // And must assert the signature is intact.
  assert.match(migration, /Solicitor rollout command signature changed/);
});

test('no parallel Builder rollout tables are created', () => {
  // ADR 020: extend the shared plane, never fork it.
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*builder_rollout/i);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*builder_cutover/i);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*builder_feature/i);
});

// ===========================================================================
// Greenfield honesty
// ===========================================================================
test('Builder features are marked as having no legacy comparison, with a reason', () => {
  assert.match(migration, /legacy_comparison_applicable boolean NOT NULL DEFAULT true/);
  assert.match(migration, /not_applicable_reason text/);
  assert.match(migration, /SET legacy_comparison_applicable = false[\s\S]{0,400}not_applicable_reason\s*=/);
  assert.match(migration, /POST-MIGRATION FAILURE: % Builder feature\(s\) still claim a legacy comparison/);
});

test('a feature key that nothing reads is marked as not runtime-consumed', () => {
  assert.match(migration, /runtime_consumed boolean NOT NULL DEFAULT true/);
  assert.match(migration, /runtime_consumed = false[\s\S]{0,500}builder_portal_admin_v1/);
});

test('no fabricated legacy comparison rows or backfill are created', () => {
  assert.doesNotMatch(migration, /INSERT INTO public\.cross_portal_dual_read_comparisons/i);
  assert.doesNotMatch(migration, /legacy_hash/i);
});

test('Builder features default to off and that is asserted', () => {
  assert.match(migration, /POST-MIGRATION FAILURE: % Builder feature\(s\) do not default to off/);
});

// ===========================================================================
// Transition graph
// ===========================================================================
test('dual_read and dual_write are unreachable for Builder', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.builder_rollout_transition_allowed/);
  const fn = migration.slice(
    migration.indexOf('FUNCTION public.builder_rollout_transition_allowed'),
    migration.indexOf('COMMENT ON FUNCTION public.builder_rollout_transition_allowed'));
  assert.doesNotMatch(fn, /dual_read/);
  assert.doesNotMatch(fn, /dual_write/);
  // And the migration proves it at apply time.
  assert.match(migration, /builder_rollout_transition_allowed\('shadow','dual_read'\)/);
  assert.match(migration, /Builder transition graph permits an unsupported move/);
});

test('off cannot jump straight to live', () => {
  assert.match(migration, /builder_rollout_transition_allowed\('off','cutover'\)/);
});

test('recovery from rollback re-enters at shadow, not at cutover', () => {
  const fn = migration.slice(
    migration.indexOf('FUNCTION public.builder_rollout_transition_allowed'),
    migration.indexOf('COMMENT ON FUNCTION public.builder_rollout_transition_allowed'));
  assert.match(fn, /_from = 'rollback'\s+AND _to = 'shadow'\s+THEN true/);
  assert.doesNotMatch(fn, /_from = 'rollback'\s+AND _to = 'cutover'\s+THEN true/);
});

// ===========================================================================
// NOCOPY-R2 — transactional audit
// ===========================================================================
test('every rollout mutation writes trusted audit in its own transaction', () => {
  for (const fn of ['set_cross_portal_rollout_for', 'record_cross_portal_approval_for',
                    'revoke_cross_portal_approval_for']) {
    const start = migration.indexOf(`FUNCTION public.${fn}`);
    assert.ok(start > -1, `${fn} is defined`);
    const body = migration.slice(start, migration.indexOf('$$;', start));
    assert.match(body, /PERFORM public\.builder_log_activity\(/,
      `${fn} writes trusted audit inside the command`);
  }
});

test('the audit trail accepts the rollout entity types', () => {
  assert.match(migration, /'rollout', 'rollout_approval'/);
});

test('extending the audit entity types carries every earlier domain forward', () => {
  // Each domain migration restates the whole enumeration, so a migration that
  // drops the constraint and re-adds a short list silently breaks audit writes
  // for every domain that came before it. Regression guard: the release-control
  // migration must still name the domain types it inherited.
  for (const inherited of ['document_version', 'conversation', 'message', 'task',
                           'notification', 'unit', 'transaction', 'construction_case',
                           'organisation_settings', 'user_preferences']) {
    assert.match(migration, new RegExp(`'${inherited}'`),
      `the entity_type constraint dropped the inherited '${inherited}' value`);
  }
});

test('audit is never best-effort inside the commands', () => {
  const start = migration.indexOf('FUNCTION public.set_cross_portal_rollout_for');
  const body = migration.slice(start, migration.indexOf('$$;', start));
  // A swallowed audit failure would make the audit trail optional.
  assert.doesNotMatch(body, /EXCEPTION\s+WHEN/i);
});

// ===========================================================================
// NOCOPY-R3 — optimistic concurrency
// ===========================================================================
test('the mutable rollout row carries a version that the command enforces', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1/);
  assert.match(migration, /CREATE TRIGGER trg_bump_cross_portal_rollout_version/);
  assert.match(migration, /BUILDER_EXPECTED_VERSION_REQUIRED/);
  assert.match(migration, /BUILDER_STALE_WRITE/);
});

test('a first-time rollout does not require a version, an update does', () => {
  const start = migration.indexOf('FUNCTION public.set_cross_portal_rollout_for');
  const body = migration.slice(start, migration.indexOf('$$;', start));
  assert.match(body, /IF v_existing\.id IS NOT NULL THEN[\s\S]{0,400}BUILDER_EXPECTED_VERSION_REQUIRED/);
});

// ===========================================================================
// NOCOPY-R4 — approval revocation
// ===========================================================================
test('approvals can be revoked, with an actor and a reason recorded', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.revoke_cross_portal_approval_for/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS revoked_by uuid/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS revoke_reason text/);
  const start = migration.indexOf('FUNCTION public.revoke_cross_portal_approval_for');
  const body = migration.slice(start, migration.indexOf('$$;', start));
  assert.match(body, /CUTOVER_REASON_REQUIRED/);
  assert.match(body, /CUTOVER_APPROVAL_NOT_FOUND/);
});

test('approvals require an evidence reference', () => {
  const start = migration.indexOf('FUNCTION public.record_cross_portal_approval_for');
  const body = migration.slice(start, migration.indexOf('$$;', start));
  assert.match(body, /CUTOVER_EVIDENCE_REQUIRED/);
  assert.match(body, /CUTOVER_UNKNOWN_APPROVAL_TYPE/);
});

// ===========================================================================
// NOCOPY-R5 — Builder-specific readiness
// ===========================================================================
test('Builder readiness does not import Solicitor-only evidence', () => {
  const start = migration.indexOf('FUNCTION public.get_builder_cutover_readiness');
  const body = migration.slice(start, migration.indexOf('COMMENT ON FUNCTION public.get_builder_cutover_readiness'));
  for (const solicitorOnly of [
    'solicitor_matter_access_migration_exceptions',
    'solicitor_portal_users',
    'legal_matters',
    'transaction_case_reconciliation_issues',
  ]) {
    assert.doesNotMatch(body, new RegExp(solicitorOnly),
      `Builder readiness must not depend on ${solicitorOnly}`);
  }
});

test('required readiness evidence fails closed when it cannot be gathered', () => {
  const start = migration.indexOf('FUNCTION public.get_builder_cutover_readiness');
  const body = migration.slice(start, migration.indexOf('COMMENT ON FUNCTION public.get_builder_cutover_readiness'));
  assert.match(body, /'status','unknown'/);
  assert.match(body, /v_unknown := v_unknown \+ 1/);
  // ready is true only when nothing required fails AND nothing required is unknown.
  assert.match(body, /'ready', \(v_required_failures = 0 AND v_unknown = 0\)/);
});

test('not-applicable checks are explicit, carry a reason and are never required', () => {
  const start = migration.indexOf('FUNCTION public.get_builder_cutover_readiness');
  const body = migration.slice(start, migration.indexOf('COMMENT ON FUNCTION public.get_builder_cutover_readiness'));
  assert.match(body, /'status','not_applicable'/);
  // Every not_applicable emission in this function pairs with required=false.
  for (const match of body.matchAll(/jsonb_build_object\(\s*'key','[a-z_]+','required',(true|false),'status','not_applicable'/g)) {
    assert.equal(match[1], 'false', 'a not-applicable check must never be marked required');
  }
});

test('readiness covers the release-blocking evidence classes', () => {
  const start = migration.indexOf('FUNCTION public.get_builder_cutover_readiness');
  const body = migration.slice(start, migration.indexOf('COMMENT ON FUNCTION public.get_builder_cutover_readiness'));
  for (const key of [
    'required_builder_tables_present',
    'required_builder_functions_present',
    'builder_tables_rls_enabled',
    'no_direct_anon_or_authenticated_grants',
    'builder_terms_version_present',
    'builder_mandatory_onboarding_configured',
    'rollout_is_organisation_scoped',
    'organisation_active',
    'builder_document_malware_scanning',
    'no_unsafe_builder_documents',
    'no_critical_builder_alerts',
    'no_orphaned_builder_memberships',
    'four_approvals_active',
    'minimum_stable_window_complete',
  ]) {
    assert.match(body, new RegExp(`'${key}'`), `readiness must evaluate ${key}`);
  }
});

test('absent Builder malware scanning is treated as a required release blocker', () => {
  const start = migration.indexOf('FUNCTION public.get_builder_cutover_readiness');
  const body = migration.slice(start, migration.indexOf('COMMENT ON FUNCTION public.get_builder_cutover_readiness'));
  assert.match(body, /'key','builder_document_malware_scanning','required',true/);
  assert.match(body, /RELEASE BLOCKER/);
});

test('readiness refuses to evaluate a Solicitor-owned feature', () => {
  const start = migration.indexOf('FUNCTION public.get_builder_cutover_readiness');
  const body = migration.slice(start, migration.indexOf('COMMENT ON FUNCTION public.get_builder_cutover_readiness'));
  assert.match(body, /v_def\.portal NOT IN \('builder','shared'\)/);
});

test('only cutover is gated on readiness — rollback always stays available', () => {
  const start = migration.indexOf('FUNCTION public.set_cross_portal_rollout_for');
  const body = migration.slice(start, migration.indexOf('$$;', start));
  assert.match(body, /IF _to_mode = 'cutover' AND COALESCE\(\(v_readiness->>'ready'\)::boolean, false\) <> true/);
});

// ===========================================================================
// Privileges
// ===========================================================================
test('the release-control functions are service-role only', () => {
  for (const fn of ['get_builder_cutover_readiness', 'set_cross_portal_rollout_for',
                    'record_cross_portal_approval_for', 'revoke_cross_portal_approval_for']) {
    assert.match(migration, new RegExp(`public\\.${fn}`), `${fn} is named in the grant block`);
  }
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]{0,700}FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]{0,700}TO service_role/);
});

// ===========================================================================
// Retired Builder application release controls
// ===========================================================================
test('historical shared release infrastructure remains intact but Builder admin no longer exposes it', () => {
  for (const operation of ['list_builder_rollouts', 'get_builder_readiness',
                           'set_builder_rollout', 'record_builder_approval',
                           'revoke_builder_approval']) {
    assert.doesNotMatch(admin, new RegExp(`case '${operation}'`));
  }
  assert.equal(existsSync(join(root, 'src/components/admin/builder-portal/AdminBuilderReleasePanel.tsx')), false);
  assert.doesNotMatch(adminPage, /AdminBuilderReleasePanel|TabsTrigger value="release"/);
});

test('Builder authentication has no rollout feature, resolver, response field or rejection', () => {
  for (const forbidden of [
    'BUILDER_ROLLOUT_FEATURE', 'ROLLOUT_ENABLED_MODES', 'isRolloutEnabled',
    'rollout_enabled', 'rollout_disabled', 'resolve_cross_portal_feature_mode_for',
    'builder_portal_identity_v1',
  ]) assert.doesNotMatch(auth, new RegExp(forbidden));
});

test('every Builder authentication entry point is detached from rollout state', () => {
  for (const fn of ['builder-portal-login', 'builder-portal-verify', 'builder-portal-accept-invite']) {
    const source = read(`supabase/functions/${fn}/index.ts`);
    assert.doesNotMatch(source, /rollout_enabled|rollout_disabled|resolve_cross_portal_feature_mode_for/,
      `${fn} must not consult rollout state`);
  }
});

test('accessible organisations are returned directly and selection remains membership-scoped', () => {
  const listing = auth.slice(auth.indexOf('export async function listAccessibleOrganisations'));
  assert.match(listing, /rpc\('builder_accessible_organisations'/);
  assert.match(listing, /is\('revoked_at', null\)/);
  assert.match(auth, /organisations\.find\(\(organisation\) => organisation\.is_primary\)/);
  assert.match(auth, /organisations\.length === 1 \? organisations\[0\] : null/);
  assert.match(auth, /organisations\.find\(\(organisation\) => organisation\.organisation_id === stored\)/);
});

test('governance and deny-by-default permission checks remain present', () => {
  for (const code of ['auth_required', 'password_rotation_required',
                      'organisation_selection_required', 'terms_acceptance_required',
                      'onboarding_required']) assert.match(auth, new RegExp(code));
  assert.match(auth, /BUILDER_FORBIDDEN_KEYS\.has\(permissionKey\)/);
  assert.match(auth, /rpc\('builder_resolve_permission'/);
  assert.match(auth, /session\.organisations\?\.some/);
});
