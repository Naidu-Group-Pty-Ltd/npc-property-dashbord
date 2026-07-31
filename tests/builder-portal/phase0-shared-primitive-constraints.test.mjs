/**
 * Builder / Developer Portal — Phase 0 characterisation of legal-coupled shared primitives.
 *
 * Baseline: a2ec188faa806ff97cb272f7f5a8bcf56b984cb1
 *
 * ADR 020 records that twelve shared objects are named "shared" but constrained
 * to the legal domain, and that Builder generalises them rather than creating
 * parallel tables. Each test below pins one of those constraints exactly as it
 * stands today.
 *
 * These tests are EXPECTED TO FAIL in the phase that performs the corresponding
 * widening (GEN-01 … GEN-13). A failure is the signal that a shared constraint
 * has moved, and the widening PR must update the assertion in the same change so
 * the new shape is reviewed rather than absorbed silently.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const migrationsDir = join(root, 'supabase/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
  .join('\n');

/** Collect every distinct CHECK member list declared for a column name. */
const checkListsFor = (column) => {
  const pattern = new RegExp(`${column}[^,;]*?CHECK\\(\\s*${column}\\s*IN\\s*\\(([^)]*)\\)`, 'gi');
  const found = new Set();
  for (const match of migrations.matchAll(pattern)) {
    found.add(match[1].split(',').map((value) => value.trim().replace(/^'|'$/g, '')).sort().join('|'));
  }
  return [...found];
};

// --- GEN-01 / GEN-02: portal terms -----------------------------------------

test('GEN-01 portal_terms_versions.portal admits only the solicitor portal', () => {
  assert.match(migrations, /portal text NOT NULL CHECK\(portal IN \('solicitor'\)\)/);
  assert.ok(
    !/portal text NOT NULL CHECK\(portal IN \([^)]*'builder'/.test(migrations),
    "portal_terms_versions already admits 'builder' — GEN-01 has landed, update this test",
  );
});

test('GEN-01 the one-current-terms index is already portal-generic', () => {
  // This partial unique index needs no change for Builder; recorded so the
  // widening PR does not "fix" something that is already correct.
  assert.match(
    migrations,
    /CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_one_current_idx ON public\.portal_terms_versions\(portal\) WHERE retired_at IS NULL/,
  );
});

test('GEN-02 portal_terms_acceptances is single-owner and NOT NULL on the solicitor user', () => {
  assert.match(migrations, /portal text NOT NULL CHECK\(portal='solicitor'\)/);
  assert.match(
    migrations,
    /solicitor_user_id uuid NOT NULL REFERENCES public\.solicitor_portal_users\(id\) ON DELETE CASCADE, accepted_at/,
  );
  assert.match(migrations, /UNIQUE\(terms_version_id,solicitor_user_id\)/);
  assert.ok(
    !migrations.includes('builder_user_id'),
    'portal_terms_acceptances already has a builder owner — GEN-02 has landed, update this test',
  );
});

// --- GEN-03 … GEN-06: milestones and tasks ---------------------------------

test('GEN-03 case_milestones.source_domain excludes builder', () => {
  assert.deepEqual(checkListsFor('source_domain'), ['command_centre|finance|legal|system']);
});

test('GEN-03 case_milestones.authority excludes builder', () => {
  assert.deepEqual(checkListsFor('authority'), ['command_centre|finance|legal|system|unresolved']);
});

test('GEN-04 milestone and task visibility exclude builder_private', () => {
  assert.deepEqual(checkListsFor('visibility'), ['client|command_private|finance_private|legal_private|shared']);
});

test('GEN-05 case_tasks.owner_domain excludes builder', () => {
  assert.deepEqual(checkListsFor('owner_domain'), ['client|command_centre|finance|legal|shared']);
});

test('GEN-06 case_task_assignments.assignee_type excludes builder_user', () => {
  assert.deepEqual(checkListsFor('assignee_type'), ['client|command_user|finance_user|solicitor_user|team']);
});

// --- GEN-07 / GEN-08: conversations and documents --------------------------

test('GEN-07 conversation_participants.participant_type excludes builder participants', () => {
  assert.deepEqual(
    checkListsFor('participant_type'),
    ['client_user|command_user|finance_user|firm|solicitor_user|system'],
  );
});

test('GEN-07 the participant scope guard exists and must be extended with the type list', () => {
  assert.match(migrations, /CREATE OR REPLACE FUNCTION public\.guard_conversation_participant_scope/);
  assert.match(migrations, /CREATE OR REPLACE FUNCTION public\.get_participant_conversations/);
});

test('GEN-08 document_access_grants.audience excludes builder', () => {
  assert.deepEqual(checkListsFor('audience'), ['client|command_centre|finance|solicitor']);
});

test('GEN-08 the document authorization functions that must move with the audience list exist', () => {
  assert.match(migrations, /CREATE OR REPLACE FUNCTION public\.authorize_document_download/);
  assert.match(migrations, /CREATE OR REPLACE FUNCTION public\.list_accessible_documents/);
});

// --- GEN-09: transaction case links ----------------------------------------

test('GEN-09 transaction_case_links has three domain slots and no builder slot', () => {
  assert.match(migrations, /legal_matter_id uuid UNIQUE REFERENCES public\.legal_matters\(id\)/);
  assert.match(migrations, /purchase_file_id uuid UNIQUE REFERENCES public\.purchase_files\(id\)/);
  assert.match(migrations, /client_deal_id uuid UNIQUE REFERENCES public\.client_deals\(id\)/);
  assert.ok(!migrations.includes('builder_transaction_id'), 'GEN-09 has landed, update this test');
});

test('GEN-09 link history domain_type and link_source exclude builder values', () => {
  assert.deepEqual(checkListsFor('domain_type'), ['client_deal|legal_matter|purchase_file']);
  assert.deepEqual(checkListsFor('link_source'), ['command_centre|legacy_explicit|legacy_reverse|system']);
});

test('GEN-09 the cross-client guard trigger lists exactly the three current slots', () => {
  // The trigger must be redefined when a fourth slot is added, or an UPDATE that
  // touches only the new column would not fire it at all (migration risk MIG-02).
  assert.match(
    migrations,
    /BEFORE INSERT OR UPDATE OF case_id,legal_matter_id,purchase_file_id,client_deal_id ON public\.transaction_case_links/,
  );
  assert.match(migrations, /MESSAGE='CROSS_CLIENT_CASE_LINK'/);
});

// --- GEN-10 / GEN-11: cutover control plane and AI policy -------------------

test('GEN-10 all five cross_portal cutover tables key on solicitor_firms', () => {
  for (const table of [
    'cross_portal_firm_rollouts',
    'cross_portal_rollout_history',
    'cross_portal_dual_read_comparisons',
    'cross_portal_cutover_approvals',
    'cross_portal_reconciliation_runs',
  ]) {
    const declaration = migrations.slice(
      migrations.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`),
    ).split(');')[0];
    assert.ok(
      /firm_id uuid[^,]*REFERENCES public\.solicitor_firms\(id\)/.test(declaration),
      `${table} no longer keys on solicitor_firms — GEN-10 may have landed, update this test`,
    );
  }
});

test('GEN-10 the feature-mode resolver takes a firm id', () => {
  assert.match(
    migrations,
    /CREATE OR REPLACE FUNCTION public\.resolve_cross_portal_feature_mode\(_firm_id uuid,_feature_key text\)/,
  );
});

test('GEN-10 no builder feature definition is seeded yet', () => {
  const seedBlock = migrations.slice(migrations.indexOf('INSERT INTO public.cross_portal_feature_definitions'));
  assert.ok(!/'builder[a-z_]*'/.test(seedBlock.split(';')[0]), 'a Builder feature flag is already seeded');
});

test('GEN-11 firm_ai_policies keys on solicitor_firms', () => {
  assert.match(migrations, /firm_id uuid NOT NULL UNIQUE REFERENCES public\.solicitor_firms\(id\) ON DELETE CASCADE/);
});

// --- GEN-12 / GEN-13: field ownership and read models ----------------------

test('GEN-12 PortalDomain has exactly four members', () => {
  const source = readFileSync(join(root, 'supabase/functions/_shared/crossPortalFieldOwnership.ts'), 'utf8');
  const union = source.match(/export type PortalDomain = ([^;]+);/);
  assert.ok(union, 'the PortalDomain union declaration is missing');
  const members = union[1].split('|').map((value) => value.trim().replace(/'/g, '')).sort();
  assert.deepEqual(members, ['client', 'command_centre', 'finance', 'solicitor']);
});

test('GEN-13 no builder case read model exists', () => {
  assert.ok(!migrations.includes('builder_case_read_model'), 'GEN-13 has landed, update this test');
});

// --- Ordering constraint ---------------------------------------------------

test('the widening inventory in the shared-service document matches this test file', () => {
  const inventory = readFileSync(join(root, 'docs/builder-portal/03-shared-service-inventory.md'), 'utf8');
  for (let index = 1; index <= 13; index += 1) {
    const id = `GEN-${String(index).padStart(2, '0')}`;
    assert.ok(inventory.includes(id), `${id} is missing from the shared-service inventory`);
  }
});
