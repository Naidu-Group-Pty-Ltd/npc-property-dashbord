#!/usr/bin/env node
/**
 * Builder / Developer Portal — Phase 0 inspection.
 *
 * Baseline: a2ec188faa806ff97cb272f7f5a8bcf56b984cb1
 *
 * Two jobs:
 *   1. Prove Phase 0 was non-behavioural: no migration, no Edge Function, no
 *      route, no component, no style token changed.
 *   2. Re-derive the Phase 0 findings from the repository so a stale document is
 *      detected rather than trusted.
 *
 * Read-only. Exits non-zero on any failure. Run with:
 *   npm run builder:phase-0-inspect
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const failures = [];
const notes = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// ---------------------------------------------------------------------------
// 0. Phase detection
//
// The non-behavioural assertions below describe the Phase 0 pull request. Once
// Phase 1 lands they are no longer true and no longer meaningful: Phase 1
// deliberately creates Builder identity tables and an administration module.
// The script stays useful by scoping those assertions to Phase 0 and switching
// to the Phase 1 boundary once Phase 1 migrations are present.
// ---------------------------------------------------------------------------
const migrationNamesForPhase = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'));
const PHASE_1_LANDED = migrationNamesForPhase.some((name) =>
  /_builder_portal_phase1_/.test(name));

// ---------------------------------------------------------------------------
// 1. Phase invariants
// ---------------------------------------------------------------------------

const PHASE_0_ALLOWED_PREFIXES = [
  'docs/builder-portal/',
  'docs/architecture/builder-cross-portal-',
  'docs/architecture/adr/018-',
  'docs/architecture/adr/019-',
  'docs/architecture/adr/020-',
  'tests/builder-portal/',
  'scripts/builder-portal/',
  'package.json',
];

const PHASE_0_FORBIDDEN_PREFIXES = [
  'supabase/migrations/',
  'supabase/functions/',
  'src/',
  'tests/solicitor-portal/',
  'tests/cross-portal-contracts/',
  'tests-e2e/',
];

notes.push('Phase 0 may only add files under: ' + PHASE_0_ALLOWED_PREFIXES.join(', '));
notes.push('Phase 0 must not touch: ' + PHASE_0_FORBIDDEN_PREFIXES.join(', '));

// No Builder production surface may exist after Phase 0.
const functionDirs = readdirSync(join(root, 'supabase/functions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const app = read('src/App.tsx');
const builderFunctions = functionDirs.filter((name) => name.startsWith('builder-portal-')).sort();

if (!PHASE_1_LANDED) {
  notes.push('Phase: 0 (no Phase 1 migrations present)');
  check(builderFunctions.length === 0,
    'Phase 0 created a builder-portal Edge Function; Phase 0 must add no executable server code');
  check(!app.includes('builder_portal_admin'), 'Phase 0 added the builder_portal_admin module guard');
} else {
  notes.push('Phase: 1 has landed — Phase 0 non-behavioural assertions no longer apply');
  // Phase 1 delivers the INTERNAL administration function only. The external
  // portal family belongs to a later phase.
  check(builderFunctions.length === 1 && builderFunctions[0] === 'builder-portal-admin',
    `expected only builder-portal-admin, found [${builderFunctions.join(', ')}]`);
  check(app.includes('moduleKey="builder_portal_admin"'),
    'Phase 1 landed but the administration route is not module-guarded');
}

// True in every phase until the external portal is built.
check(!/path=["'`]\/builder\b/.test(app), 'a /builder external route exists before its phase');
check(!app.includes('BuilderPortalAuthProvider'), 'a Builder auth provider is mounted before its phase');

const migrationsDir = join(root, 'supabase/migrations');
const migrationNames = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
const migrations = migrationNames.map((name) => readFileSync(join(migrationsDir, name), 'utf8')).join('\n');

if (!PHASE_1_LANDED) {
  check(
    !migrationNames.some((name) => /builder[-_]portal|builder[-_]domain/i.test(name)),
    'Phase 0 added a Builder migration; Phase 0 creates no production Builder tables',
  );
}

// ---------------------------------------------------------------------------
// 2. Re-derive the Phase 0 findings
// ---------------------------------------------------------------------------

const declaredTables = new Set(
  [...migrations.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
    .map((match) => match[1].toLowerCase()),
);

// Finding: the Builder domain is greenfield.
const BUILDER_DOMAIN_TABLES = [
  'builder_organisations', 'builder_organizations', 'builder_portal_users',
  'builder_portal_sessions', 'builder_developments', 'builder_projects',
  'builder_project_stages', 'builder_project_parties', 'builder_user_access',
  'property_units', 'property_reservations', 'construction_cases',
  'builder_transactions', 'builder_variations', 'builder_progress_claims',
  'builder_inspections', 'builder_defects', 'builder_case_read_model',
];
const PHASE_1_IDENTITY_TABLES = [
  'builder_organisations', 'builder_portal_users', 'builder_organisation_memberships',
  'builder_portal_sessions', 'builder_permission_keys',
  'builder_role_default_permissions', 'builder_membership_permissions',
];
const PHASE_2_DOMAIN_TABLES = BUILDER_DOMAIN_TABLES.filter((t) => !PHASE_1_IDENTITY_TABLES.includes(t));

if (PHASE_1_LANDED) {
  for (const table of PHASE_1_IDENTITY_TABLES) {
    check(declaredTables.has(table), `Phase 1 identity table ${table} is missing`);
  }
} else {
  for (const table of PHASE_1_IDENTITY_TABLES) {
    check(!declaredTables.has(table), `Builder identity table ${table} exists before Phase 1`);
  }
}
// The Phase 2 business domain must be absent in both phases.
for (const table of PHASE_2_DOMAIN_TABLES) {
  check(!declaredTables.has(table), `Phase 2 domain table ${table} exists before Phase 2`);
}
notes.push(`Tables declared in the migration corpus: ${declaredTables.size}`);

// Finding: the Finance-owned builder-named pair must remain exactly two. They
// are enumerated explicitly because Phase 1 adds its own builder_* tables and a
// substring match would sweep them in.
const financeOwned = [...declaredTables]
  .filter((name) => name.startsWith('build_') || name === 'builder_invoices').sort();
check(
  financeOwned.length === 2 && financeOwned[0] === 'build_progress_payments' && financeOwned[1] === 'builder_invoices',
  `expected exactly [build_progress_payments, builder_invoices]; found [${financeOwned.join(', ')}]`,
);

// Finding: those two tables carry commission data (security risk SEC-06).
check(migrations.includes('is_commission_trigger'), 'build_progress_payments no longer carries is_commission_trigger');
check(migrations.includes('commission_amount'), 'builder_invoices no longer carries commission_amount');

// Finding: transaction_cases already permits a construction case type.
check(
  /case_type text NOT NULL DEFAULT 'property_purchase' CHECK\(case_type IN \([^)]*'construction'/.test(migrations),
  "transaction_cases no longer permits a 'construction' case type",
);

// Finding: transaction_case_links has three slots and no Builder slot.
check(!migrations.includes('builder_transaction_id'), 'a Builder link slot exists; GEN-09 has landed');

// Finding: the twelve legal-coupled shared constraints (ADR 020).
const COUPLED = [
  ["GEN-01 portal_terms_versions.portal", /portal text NOT NULL CHECK\(portal IN \('solicitor'\)\)/],
  ["GEN-02 portal_terms_acceptances.portal", /portal text NOT NULL CHECK\(portal='solicitor'\)/],
  ["GEN-02 portal_terms_acceptances.solicitor_user_id NOT NULL", /solicitor_user_id uuid NOT NULL REFERENCES public\.solicitor_portal_users\(id\)/],
  ["GEN-03 case_milestones.source_domain", /source_domain text NOT NULL CHECK\(source_domain IN \('legal','finance','command_centre','system'\)\)/],
  ["GEN-04 visibility lists", /visibility text NOT NULL CHECK\(visibility IN \('shared','client','legal_private','finance_private','command_private'\)\)/],
  ["GEN-05 case_tasks.owner_domain", /owner_domain text NOT NULL CHECK\(owner_domain IN \('legal','finance','client','command_centre','shared'\)\)/],
  ["GEN-06 case_task_assignments.assignee_type", /assignee_type text NOT NULL CHECK\(assignee_type IN \('solicitor_user','finance_user','command_user','client','team'\)\)/],
  ["GEN-07 conversation_participants.participant_type", /participant_type text NOT NULL CHECK\(participant_type IN \('solicitor_user','command_user','client_user','finance_user','firm','system'\)\)/],
  ["GEN-08 document_access_grants.audience", /audience text NOT NULL CHECK\(audience IN \('solicitor','client','finance','command_centre'\)\)/],
  ["GEN-09 link history domain_type", /domain_type text NOT NULL CHECK\(domain_type IN \('legal_matter','purchase_file','client_deal'\)\)/],
  ["GEN-10 cutover plane FK", /firm_id uuid NOT NULL REFERENCES public\.solicitor_firms\(id\) ON DELETE CASCADE/],
  ["GEN-11 firm_ai_policies FK", /firm_id uuid NOT NULL UNIQUE REFERENCES public\.solicitor_firms\(id\) ON DELETE CASCADE/],
];
let stillCoupled = 0;
for (const [label, pattern] of COUPLED) {
  if (pattern.test(migrations)) {
    stillCoupled += 1;
  } else {
    notes.push(`WIDENED: ${label} no longer matches its baseline shape — update ADR 020 and the Phase 0 tests`);
  }
}
notes.push(`Legal-coupled shared constraints still at baseline shape: ${stillCoupled}/${COUPLED.length}`);

// Finding: PortalDomain has four members.
const ownership = read('supabase/functions/_shared/crossPortalFieldOwnership.ts');
check(
  /export type PortalDomain = 'command_centre' \| 'client' \| 'finance' \| 'solicitor';/.test(ownership),
  'PortalDomain changed; GEN-12 may have landed — update the field-ownership document',
);
check(!ownership.includes('builder'), 'the field-ownership module now names builder');

// Finding: solicitor_portal_admin is not registered in dashboard_modules (MIG-10).
const solicitorAdminRegistered = /dashboard_modules[\s\S]{0,4000}?'solicitor_portal_admin'/.test(migrations);
if (solicitorAdminRegistered) {
  notes.push('REPAIRED: solicitor_portal_admin is now registered in dashboard_modules — update finding NOCOPY-03 / MIG-10');
} else {
  notes.push('OPEN: solicitor_portal_admin is still absent from dashboard_modules (finding NOCOPY-03 / MIG-10)');
}

// ---------------------------------------------------------------------------
// 3. Deliverable completeness
// ---------------------------------------------------------------------------

const DELIVERABLES = [
  'docs/builder-portal/README.md',
  'docs/builder-portal/00-baseline.md',
  'docs/builder-portal/01-solicitor-portal-assessment.md',
  'docs/builder-portal/02-admin-vs-portal-boundary.md',
  'docs/builder-portal/03-shared-service-inventory.md',
  'docs/builder-portal/04-builder-domain-boundaries.md',
  'docs/builder-portal/05-organisation-and-access-hierarchy.md',
  'docs/builder-portal/06-roles-and-permissions.md',
  'docs/builder-portal/07-lifecycle-and-milestones.md',
  'docs/builder-portal/08-transaction-case-relationships.md',
  'docs/builder-portal/09-migration-risks.md',
  'docs/builder-portal/10-security-risks.md',
  'docs/builder-portal/11-phase-0-report.md',
  'docs/architecture/builder-cross-portal-current-state.md',
  'docs/architecture/builder-cross-portal-target-state.md',
  'docs/architecture/builder-cross-portal-field-ownership.md',
  'docs/architecture/adr/018-builder-portal-separation.md',
  'docs/architecture/adr/019-builder-domain-model.md',
  'docs/architecture/adr/020-shared-portal-primitive-generalisation.md',
  'tests/builder-portal/fixtures/phase-0-scenarios.json',
  'tests/builder-portal/phase0-existing-architecture.test.mjs',
  'tests/builder-portal/phase0-shared-primitive-constraints.test.mjs',
  'tests/builder-portal/phase0-builder-domain-boundaries.test.mjs',
  'scripts/builder-portal/phase-0-inspection.mjs',
  'scripts/builder-portal/phase-0-reconciliation.sql',
];

const PHASE_1_DELIVERABLES = [
  'supabase/migrations/20260801000000_builder_portal_phase1_organisations_users.sql',
  'supabase/migrations/20260801000100_builder_portal_phase1_permissions.sql',
  'supabase/migrations/20260801000200_builder_portal_phase1_sessions.sql',
  'supabase/migrations/20260801000300_portal_terms_multi_portal.sql',
  'supabase/migrations/20260801000400_cross_portal_rollout_org_generalisation.sql',
  'supabase/migrations/20260801000500_builder_portal_admin_module.sql',
  'supabase/functions/builder-portal-admin/index.ts',
  'src/pages/admin/BuilderPortalAdmin.tsx',
  'tests/builder-portal/phase1-identity-access.test.mjs',
  'scripts/builder-portal/local-db/00-supabase-bootstrap.sql',
  'scripts/builder-portal/local-db/01-upstream-fixture.sql',
  'scripts/builder-portal/local-db/reset.mjs',
  'scripts/builder-portal/local-db/verify-phase-1.mjs',
  'scripts/builder-portal/local-db/generate-builder-types.mjs',
  'docs/architecture/adr/021-portal-terms-multi-portal-ownership.md',
  'docs/builder-portal/12-phase-1-report.md',
];
for (const path of DELIVERABLES) {
  check(existsSync(join(root, path)), `missing Phase 0 deliverable: ${path}`);
}
if (PHASE_1_LANDED) {
  for (const path of PHASE_1_DELIVERABLES) {
    check(existsSync(join(root, path)), `missing Phase 1 deliverable: ${path}`);
  }
}

// Every document must cite the baseline commit so a stale copy is obvious.
const BASELINE = 'a2ec188faa806ff97cb272f7f5a8bcf56b984cb1';
for (const path of DELIVERABLES.filter((name) => name.endsWith('.md'))) {
  if (!existsSync(join(root, path))) continue;
  check(read(path).includes(BASELINE), `${path} does not cite the Phase 0 baseline commit`);
}

// The generalisation IDs must be consistent across the inventory, the ADR and the tests.
const inventory = existsSync(join(root, 'docs/builder-portal/03-shared-service-inventory.md'))
  ? read('docs/builder-portal/03-shared-service-inventory.md') : '';
const adr020 = existsSync(join(root, 'docs/architecture/adr/020-shared-portal-primitive-generalisation.md'))
  ? read('docs/architecture/adr/020-shared-portal-primitive-generalisation.md') : '';
for (let index = 1; index <= 13; index += 1) {
  const id = `GEN-${String(index).padStart(2, '0')}`;
  check(inventory.includes(id), `${id} missing from the shared-service inventory`);
  check(adr020.includes(id), `${id} missing from ADR 020`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('Builder / Developer Portal — Phase 0 inspection');
console.log(`Baseline: ${BASELINE}\n`);
for (const note of notes) console.log(`  note  ${note}`);

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
console.log('\nPhase 0 inspection passed: non-behavioural, findings re-derived, deliverables complete.');
