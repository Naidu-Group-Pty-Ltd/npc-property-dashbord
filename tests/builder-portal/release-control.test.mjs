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
const panelSource = read('src/components/admin/builder-portal/AdminBuilderReleasePanel.tsx');
const panel = stripJsComments(panelSource);
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
  assert.match(migration, /'rollout','rollout_approval'/);
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
// Edge Function contract
// ===========================================================================
test('the release operations are served by builder-portal-admin', () => {
  for (const operation of ['list_builder_rollouts', 'get_builder_readiness',
                           'get_builder_operational_health', 'set_builder_rollout',
                           'record_builder_approval', 'revoke_builder_approval']) {
    assert.match(admin, new RegExp(`case '${operation}'`), `${operation} is dispatched`);
  }
});

test('release mutations require can_edit and pass through CSRF', () => {
  const readSet = admin.slice(admin.indexOf('const READ_OPERATIONS'), admin.indexOf('function requiredPermFor'));
  assert.match(readSet, /list_builder_rollouts/);
  assert.match(readSet, /get_builder_readiness/);
  // Mutations must NOT be in the read set, or they would skip CSRF and can_edit.
  assert.doesNotMatch(readSet, /set_builder_rollout/);
  assert.doesNotMatch(readSet, /record_builder_approval/);
  assert.doesNotMatch(readSet, /revoke_builder_approval/);
});

test('only Builder and shared feature definitions are listable', () => {
  const start = admin.indexOf("case 'list_builder_rollouts'");
  const body = admin.slice(start, admin.indexOf("case 'get_builder_readiness'"));
  assert.match(body, /\.in\('portal', \['builder', 'shared'\]\)/);
  // Every owner-scoped read is filtered to the builder portal.
  assert.match(body, /\.eq\('portal', 'builder'\)/);
  assert.doesNotMatch(body, /select\('\*'\)/);
});

test('the Builder surface never calls the legal admin function', () => {
  assert.doesNotMatch(admin, /legal-matters-admin/);
  assert.doesNotMatch(panel, /legal-matters-admin/);
  assert.doesNotMatch(panel, /solicitor/i);
});

test('rollout state is never written to the tables directly from the function', () => {
  // Anchored on code, not on a comment banner: `admin` has had its comments
  // stripped, so a banner would slice from -1 and silently assert nothing.
  const start = admin.indexOf("case 'list_builder_rollouts'");
  assert.ok(start > -1, 'the release operations are present');
  const body = admin.slice(start);
  for (const table of ['cross_portal_firm_rollouts', 'cross_portal_rollout_history',
                       'cross_portal_cutover_approvals']) {
    assert.doesNotMatch(body, new RegExp(`from\\('${table}'\\)[\\s\\S]{0,120}\\.(insert|update|upsert|delete)\\(`),
      `${table} must only be mutated through a guarded command`);
  }
  // Transitions and approvals go through RPC.
  assert.match(body, /rpc\('set_cross_portal_rollout_for'/);
  assert.match(body, /rpc\('record_cross_portal_approval_for'/);
  assert.match(body, /rpc\('revoke_cross_portal_approval_for'/);
});

test('the organisation is re-read server-side before a transition', () => {
  const start = admin.indexOf("case 'set_builder_rollout'");
  const body = admin.slice(start, admin.indexOf("case 'record_builder_approval'"));
  assert.match(body, /await loadOrganisation\(organisationId\)/);
  assert.match(body, /Organisation not found/);
});

test('the HTTP contract distinguishes a missing version from a stale one', () => {
  assert.match(admin, /\[\/BUILDER_EXPECTED_VERSION_REQUIRED\/, 400/);
  assert.match(admin, /\[\/BUILDER_STALE_WRITE\/, 409/);
  assert.match(admin, /\[\/INVALID_CUTOVER_TRANSITION\/, 409/);
  assert.match(admin, /\[\/CUTOVER_READINESS_FAILED\/, 409/);
  assert.match(admin, /\[\/CUTOVER_REASON_REQUIRED\/, 400/);
  assert.match(admin, /\[\/CUTOVER_EVIDENCE_REQUIRED\/, 400/);
});

test('a transition without a reason is rejected before it reaches the database', () => {
  const start = admin.indexOf("case 'set_builder_rollout'");
  const body = admin.slice(start, admin.indexOf("case 'record_builder_approval'"));
  assert.match(body, /A rollout reason is required/);
});

// ===========================================================================
// Runtime gate
// ===========================================================================
test('shadow does not open the external Builder portal', () => {
  assert.match(auth, /const ROLLOUT_ENABLED_MODES = new Set\(\['cutover'\]\)/);
  const gate = auth.slice(auth.indexOf('ROLLOUT_ENABLED_MODES'), auth.indexOf('export interface'));
  assert.doesNotMatch(gate, /'shadow'/);
  assert.doesNotMatch(gate, /'dual_read'/);
  assert.doesNotMatch(gate, /'dual_write'/);
});

test('the rollout gate is enforced server-side on every entry point', () => {
  for (const fn of ['builder-portal-login', 'builder-portal-verify', 'builder-portal-accept-invite']) {
    const source = read(`supabase/functions/${fn}/index.ts`);
    assert.match(source, /rollout_enabled/, `${fn} enforces the rollout gate`);
  }
});

test('the feature key the gate reads is the one the plane governs', () => {
  assert.match(auth, /BUILDER_ROLLOUT_FEATURE = 'builder_portal_identity_v1'/);
  assert.match(auth, /resolve_cross_portal_feature_mode_for/);
});

// ===========================================================================
// Command Centre surface
// ===========================================================================
test('the release panel is mounted on the Builder admin page', () => {
  assert.match(adminPage, /AdminBuilderReleasePanel/);
  assert.match(adminPage, /<TabsTrigger value="release">/);
  assert.match(adminPage, /<TabsContent value="release"/);
});

test('the panel calls only the Builder admin function', () => {
  const calls = [...panel.matchAll(/invokeSecureFunction\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(calls.length > 0, 'the panel invokes at least one function');
  for (const target of calls) {
    assert.equal(target, 'builder-portal-admin');
  }
});

test('the panel requires a reason for every transition and evidence for approvals', () => {
  assert.match(panel, /A reason is required for every rollout transition/);
  assert.match(panel, /An evidence reference is required/);
  assert.match(panel, /A revocation reason is required/);
  // Buttons stay disabled until the operator has typed one.
  assert.match(panel, /disabled=\{!reason\.trim\(\)\}/);
  assert.match(panel, /disabled=\{!evidence\.trim\(\)\}/);
  assert.match(panel, /disabled=\{!revokeReason\.trim\(\)\}/);
});

test('the panel offers only valid Builder transitions', () => {
  const next = panel.slice(panel.indexOf('const NEXT_MODE'), panel.indexOf('const MODE_META'));
  assert.match(next, /off: 'shadow'/);
  assert.match(next, /shadow: 'cutover'/);
  assert.match(next, /rollback: 'shadow'/);
  assert.doesNotMatch(next, /dual_read/);
  assert.doesNotMatch(next, /dual_write/);
});

test('the panel explains that rollback preserves data', () => {
  assert.match(panelSource, /preserved/i);
  assert.match(panelSource, /rollback changes who may sign in, never the data/i);
});

test('mutating controls are hidden without can_edit', () => {
  assert.match(panel, /canEdit && next/);
  assert.match(panel, /canEdit &&/);
  assert.match(adminPage, /<AdminBuilderReleasePanel organisations=\{organisations\} canEdit=\{canEdit\} \/>/);
});

test('the panel surfaces required, not-applicable and unknown evidence distinctly', () => {
  assert.match(panel, /not_applicable/);
  assert.match(panel, /unknown/);
  assert.match(panel, /Not applicable/);
  assert.match(panel, /Advisory/);
  assert.match(panel, /Required/);
});

test('a flag no runtime path reads is not presented as a control', () => {
  assert.match(panel, /runtime_consumed/);
  assert.match(panelSource, /Descriptive only/);
});

test('the panel shows rollout history and operational health', () => {
  assert.match(panelSource, /Rollout history/);
  assert.match(panelSource, /Builder operational health/);
  assert.match(panel, /get_builder_operational_health/);
});
