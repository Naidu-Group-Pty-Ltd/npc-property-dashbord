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

test('GEN-01 the original single-portal DDL is preserved in the corpus', () => {
  // Migrations are append-only: the Phase 3 DDL still declares the original
  // single-portal CHECK, and the Phase 1 widening replaces it at run time.
  // Both must be present for the corpus to describe the true history.
  assert.match(migrations, /portal text NOT NULL CHECK\(portal IN \('solicitor'\)\)/);
  assert.match(migrations, /CHECK \(portal IN \('solicitor','builder'\)\)/);
});

test('GEN-01 the one-current-terms index is already portal-generic', () => {
  // This partial unique index needs no change for Builder; recorded so the
  // widening PR does not "fix" something that is already correct.
  assert.match(
    migrations,
    /CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_one_current_idx ON public\.portal_terms_versions\(portal\) WHERE retired_at IS NULL/,
  );
});

test('GEN-02 LANDED: portal_terms_acceptances is multi-portal with enforced ownership', () => {
  // GEN-02 was the highest-risk widening in the programme (MIG-01) because it
  // drops a NOT NULL, which is one-way once a Builder row exists. Phase 1
  // performed it; this assertion is updated in the same PR, as ADR 020 requires,
  // so the new shape is reviewed rather than silently absorbed.
  //
  // The original single-portal DDL is still in the corpus — migrations are
  // append-only — so the assertions below check the widening migration itself.
  const widening = readFileSync(
    join(migrationsDir, '20260801000300_portal_terms_multi_portal.sql'), 'utf8');

  // Ownership stays a real foreign key, never a generic unenforced user_id.
  assert.match(widening, /builder_user_id uuid\s*\n?\s*REFERENCES public\.builder_portal_users\(id\) ON DELETE CASCADE/);
  // Exactly one owner, validated.
  assert.match(widening, /CHECK \(num_nonnulls\(solicitor_user_id, builder_user_id\) = 1\) NOT VALID/);
  assert.match(widening, /VALIDATE CONSTRAINT portal_terms_acceptances_single_owner/);
  // The owner column must agree with the portal discriminator.
  assert.match(widening, /portal_terms_acceptances_portal_owner_agree/);
  // Replacement uniqueness must be created BEFORE the old constraint is dropped.
  assert.ok(
    widening.indexOf('portal_terms_acceptances_builder_key')
      < widening.indexOf('ALTER COLUMN solicitor_user_id DROP NOT NULL'),
    'the NOT NULL was dropped before the replacement uniqueness existed',
  );
  // Both portals are now storable.
  assert.match(widening, /CHECK \(portal IN \('solicitor','builder'\)\)/);
});

test('GEN-01 LANDED: portal_terms_versions admits both portals', () => {
  const widening = readFileSync(
    join(migrationsDir, '20260801000300_portal_terms_multi_portal.sql'), 'utf8');
  assert.match(widening, /ADD CONSTRAINT portal_terms_versions_portal_check\s*\n\s*CHECK \(portal IN \('solicitor','builder'\)\)/);
  // The one-current-version-per-portal index generalises without change.
  assert.doesNotMatch(widening, /DROP INDEX[\s\S]*?portal_terms_one_current_idx/);
});

test('GEN-10 LANDED: the cutover plane accepts a builder organisation owner', () => {
  const widening = readFileSync(
    join(migrationsDir, '20260801000400_cross_portal_rollout_org_generalisation.sql'), 'utf8');
  assert.match(widening, /builder_organisation_id uuid\s*\n?\s*REFERENCES public\.builder_organisations\(id\)/);
  assert.match(widening, /resolve_cross_portal_feature_mode_for/);
  // The Solicitor caller's signature must survive untouched.
  assert.match(widening,
    /CREATE OR REPLACE FUNCTION public\.resolve_cross_portal_feature_mode\(_firm_id uuid, _feature_key text\)/);
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

test('GEN-09 has landed: transaction_case_links carries the fourth builder slot', () => {
  assert.match(migrations, /legal_matter_id uuid UNIQUE REFERENCES public\.legal_matters\(id\)/);
  assert.match(migrations, /purchase_file_id uuid UNIQUE REFERENCES public\.purchase_files\(id\)/);
  assert.match(migrations, /client_deal_id uuid UNIQUE REFERENCES public\.client_deals\(id\)/);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS builder_transaction_id uuid/);
  // The slot is unique and indexed, so a transaction joins at most one case.
  assert.match(migrations, /transaction_case_links_builder_transaction_id_key/);
  assert.match(migrations, /idx_transaction_case_links_builder/);
});

test('GEN-09 link history domain_type and link_source now carry the builder values', () => {
  // The baseline lists are still declared by the Phase 5 migration, because
  // migrations are append-only and are never rewritten.
  assert.deepEqual(checkListsFor('domain_type'), ['client_deal|legal_matter|purchase_file']);
  assert.deepEqual(checkListsFor('link_source'),
    ['command_centre|legacy_explicit|legacy_reverse|system']);
  // The widened lists arrive as named constraints in the transactions module.
  assert.match(migrations,
    /ADD CONSTRAINT transaction_case_link_history_domain_type_check[\s\S]{0,200}?'builder_transaction'/,
    'domain_type was not widened for builder_transaction');
  assert.match(migrations,
    /ADD CONSTRAINT transaction_case_links_link_source_check[\s\S]{0,200}?'builder_portal'/,
    'link_source was not widened for builder_portal');
});

test('GEN-09 the cross-client guard trigger was redefined for the fourth slot', () => {
  // MIG-02: an UPDATE touching only the new column would not fire the baseline
  // trigger at all, so the trigger is replaced in the same migration.
  assert.match(
    migrations,
    /BEFORE INSERT OR UPDATE OF case_id,legal_matter_id,purchase_file_id,client_deal_id ON public\.transaction_case_links/,
  );
  assert.match(
    migrations,
    /BEFORE INSERT OR UPDATE OF case_id, legal_matter_id, purchase_file_id,\s*\n\s*client_deal_id, builder_transaction_id/,
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
