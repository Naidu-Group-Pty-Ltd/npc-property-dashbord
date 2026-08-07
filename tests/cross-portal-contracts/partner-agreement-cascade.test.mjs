import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const cascade = read('supabase/migrations/20260901000700_partner_portal_agreement_cascade.sql');
const solicitorAmendment = read('supabase/migrations/20260901000600_solicitor_agreement_four_acknowledgments.sql');

const sharedContract = read('supabase/functions/_shared/portalAgreement.ts');
const sharedClient = read('src/lib/portalAgreement.ts');
const consentWall = read('src/components/portal/PortalAgreementConsent.tsx');

const solicitorVerify = read('supabase/functions/solicitor-portal-verify/index.ts');
const builderVerify = read('supabase/functions/builder-portal-verify/index.ts');
const financeVerify = read('supabase/functions/finance-portal-verify/index.ts');

const solicitorPage = read('src/pages/solicitor/SolicitorTerms.tsx');
const builderPage = read('src/pages/builder/BuilderTerms.tsx');
const financeGate = read('src/components/finance-portal/FinancePortalOnboardingGate.tsx');

const body = (sql) => sql.slice(sql.indexOf('$md$') + 4, sql.lastIndexOf('$md$'));

/**
 * One agreement, three portals.
 *
 * The Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport
 * Agreement binds "the Partner Organisation" — a solicitor's practice, a
 * builder, a finance partner alike. Before this cascade each portal asked for
 * something different: the Builder Portal a six-clause terms of use, the
 * Finance Portal a string compiled into the bundle. These tests exist to keep
 * the three from drifting apart again, because drift here is invisible until
 * two portals' acceptance records are compared and found to name different
 * documents under one name.
 */

test('every portal publishes the same document, not a similar one', () => {
  // The cascade migration carries the solicitor text verbatim; it is generated
  // from that migration rather than retyped.
  assert.equal(body(cascade), body(solicitorAmendment));

  // One INSERT, both portals, so the two cannot be given different text.
  assert.match(cascade, /FROM \(VALUES \('builder'\), \('finance'\)\) AS p\(portal\)/);
  assert.match(cascade, /'2026-08-07'/);

  // And the migration proves it after the fact rather than assuming it.
  assert.match(cascade, /the % agreement differs from the solicitor agreement/);
  assert.match(cascade, /has % current terms versions, expected 1/);
});

test('a portal keeps its own version row, hash and acceptance history', () => {
  // Not one shared row: acceptance is an act by a named person in a named
  // portal, and the audit trail has to say which.
  assert.match(cascade, /portal_terms_versions_portal_check[\s\S]*?CHECK \(portal IN \('solicitor','builder','finance'\)\)/);
  assert.match(cascade, /portal_terms_acceptances_portal_check[\s\S]*?CHECK \(portal IN \('solicitor','builder','finance'\)\)/);
  assert.match(cascade, /ADD COLUMN IF NOT EXISTS finance_user_id uuid\s*\n\s*REFERENCES public\.finance_portal_users\(id\) ON DELETE CASCADE/);
  assert.match(cascade, /num_nonnulls\(solicitor_user_id, builder_user_id, finance_user_id\) = 1/);
  assert.match(cascade, /portal_terms_acceptances_finance_key/);

  // Every portal's owner column must agree with the portal discriminator, so
  // one portal's user cannot accept another portal's terms.
  for (const portal of ['solicitor', 'builder', 'finance']) {
    assert.ok(
      new RegExp(`portal = '${portal}'\\s+AND \\w+_user_id\\s+IS NOT NULL`).test(cascade),
      `the owner-agreement CHECK does not cover ${portal}`,
    );
  }

  // History is retired, never rewritten: the Builder Portal's old terms of use
  // and every acceptance of it stay exactly as they are.
  assert.match(cascade, /SET retired_at = now\(\)[\s\S]*?AND version <> '2026-08-07'/);
  assert.doesNotMatch(cascade, /DELETE FROM public\.portal_terms_versions/);
  assert.doesNotMatch(cascade, /DELETE FROM public\.portal_terms_acceptances/);
});

test('all three portals enforce the same four acknowledgments, server-side', () => {
  const keys = [
    'global_confidentiality_privacy',
    'authority_binding_acceptance',
    'portal_access',
    'binding_amlctf_arrangement',
  ];
  for (const key of keys) {
    assert.ok(sharedContract.includes(`'${key}'`), `the shared server contract is missing "${key}"`);
    assert.ok(sharedClient.includes(`'${key}'`), `the shared client list is missing "${key}"`);
  }
  // Sliced to the lists themselves: both files name the withdrawn key in a
  // comment that records why it is gone, and that note is worth keeping.
  const serverList = sharedContract.slice(
    sharedContract.indexOf('export const REQUIRED_TERMS_ACKNOWLEDGEMENTS'),
    sharedContract.indexOf('] as const;'),
  );
  const clientList = sharedClient.slice(
    sharedClient.indexOf('export const PORTAL_TERMS_ACKNOWLEDGEMENTS'),
    sharedClient.indexOf('] as const;'),
  );
  assert.ok(!serverList.includes('independent_amlctf_responsibility'));
  assert.ok(!clientList.includes('independent_amlctf_responsibility'));
  assert.equal(serverList.match(/'\w+'/g)?.length, keys.length);

  // Each portal reads the one list rather than keeping its own.
  for (const [name, source] of [
    ['solicitor', solicitorVerify], ['builder', builderVerify], ['finance', financeVerify],
  ]) {
    assert.match(source, /readAcknowledgements/, `${name} does not read the shared acknowledgments`);
    assert.match(source, /ACKNOWLEDGEMENTS_INCOMPLETE/, `${name} does not refuse an incomplete acceptance`);
    assert.doesNotMatch(
      source, /const REQUIRED_TERMS_ACKNOWLEDGEMENTS = \[/,
      `${name} keeps its own copy of the required keys`,
    );
  }
});

test('an acceptance records which acknowledgments were asserted, in every portal', () => {
  // Solicitor and Finance insert directly; Builder goes through its RPC, which
  // is why the acknowledgments had to become a parameter of that function.
  assert.match(solicitorVerify, /portal_terms_acceptances'\)\.insert\(\{[^}]*acknowledgements/);
  assert.match(financeVerify, /finance_user_id: portalUser\.id,\s*\n\s*acknowledgements,/);
  assert.match(builderVerify, /_acknowledgements: acknowledgements/);
  assert.match(cascade, /_acknowledgements jsonb DEFAULT NULL/);
  assert.match(cascade, /terms_version_id, portal, builder_user_id, acknowledgements, ip_hash, user_agent_hash/);
  assert.match(cascade, /'acknowledgements', COALESCE\(_acknowledgements, '\[\]'::jsonb\)/);
});

test('all three portals present the agreement through one wall', () => {
  for (const [name, source] of [
    ['solicitor', solicitorPage], ['builder', builderPage], ['finance', financeGate],
  ]) {
    assert.match(source, /<PortalAgreementConsent/, `${name} does not use the shared consent wall`);
  }

  // The wall renders the stored Markdown; no portal restates the agreement.
  assert.match(consentWall, /terms\.content_markdown/);
  for (const [name, source] of [
    ['builder', builderPage], ['finance', financeGate],
  ]) {
    assert.doesNotMatch(source, /Terms of Use\n/, `${name} still carries its own terms text`);
  }
  assert.doesNotMatch(financeGate, /buildTermsBody/, 'the finance terms are still compiled into the bundle');
});

test('the Finance Portal gate is version-aware', () => {
  // `has_accepted_terms` only records that the partner once accepted
  // something. Gating on it would mean an amended agreement is never shown to
  // anyone already through the door.
  assert.match(financeGate, /const showTerms = !user\.has_accepted_current_terms/);
  assert.match(financeVerify, /const hasAcceptedCurrentTerms = Boolean\(currentTerms && currentAcceptance\)/);
  assert.match(financeVerify, /has_accepted_current_terms: hasAcceptedCurrentTerms/);
  assert.match(read('supabase/functions/finance-portal-login/index.ts'), /has_accepted_current_terms: hasAcceptedCurrentTerms/);
  assert.match(financeVerify, /action === 'get_governance'/);
});
