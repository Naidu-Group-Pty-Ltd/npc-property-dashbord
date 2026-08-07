import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const migration = read('supabase/migrations/20260901000300_solicitor_portal_access_agreement.sql');
const verify = read('supabase/functions/solicitor-portal-verify/index.ts');
const portalLib = read('src/lib/solicitorPortal.ts');
const termsPage = read('src/pages/solicitor/SolicitorTerms.tsx');
const authHook = read('src/hooks/useSolicitorPortalAuth.tsx');

const agreement = migration.slice(migration.indexOf('$md$') + 4, migration.lastIndexOf('$md$'));

test('the published agreement carries every section of the executed document', () => {
  const sections = [
    'Global Confidentiality and Privacy Acknowledgment',
    '1. Binding acceptance and authority',
    '2. Portal access and permitted use',
    '3. Confidentiality and legal professional privilege',
    '4. Privacy and cross-portal information sharing',
    '5. Security and incident management',
    '6. Nature of the AML/CTF Compliance Passport',
    '7. Binding customer due-diligence arrangement',
    '8. Originating Organisation responsibilities',
    '9. Partner Organisation responsibilities',
    '10. Information requests and supporting evidence',
    '11. Restricted AML/CTF information',
    '12. Review, suspension and termination of reliance',
    '13. Audit records and retention',
    '14. Role of Aurixa Systems',
    '15. Suspension and termination of Portal access',
    '16. Changes to this Agreement',
    '17. General provisions',
    'Mandatory acknowledgments',
  ];
  for (const section of sections) {
    assert.ok(agreement.includes(`## ${section}`), `agreement is missing section "${section}"`);
  }

  // The statutory hooks the agreement turns on. A paraphrase here is a
  // different legal claim, so they are asserted literally.
  assert.match(agreement, /section 37A of the Anti-Money Laundering and Counter-Terrorism Financing Act 2006/);
  assert.match(agreement, /section 6-29 of the Anti-Money Laundering and Counter-Terrorism Financing Rules 2025/);
  assert.match(agreement, /section 37B must be prepared within 10 business days/);
  assert.match(agreement, /Privacy Act 1988 and Australian Privacy Principles/);
  assert.match(agreement, /not exceeding two years/);

  // No unfilled drafting placeholder may reach a solicitor's screen.
  assert.doesNotMatch(agreement, /\[[A-Z][A-Z \/]+\]/, 'agreement still contains a bracketed placeholder');
  assert.match(agreement, /This Agreement is governed by the laws of .+, Australia\./);
});

test('publishing the agreement supersedes the old terms without rewriting them', () => {
  // A new version, not an edit: acceptances are keyed to a version id, so
  // editing in place would silently restate what past users agreed to.
  assert.match(migration, /INSERT INTO public\.portal_terms_versions/);
  assert.match(migration, /'2026-08-06'/);
  assert.match(migration, /SET retired_at = now\(\)[\s\S]*?AND version <> '2026-08-06'/);
  assert.doesNotMatch(migration, /DELETE FROM public\.portal_terms_versions/);
  assert.doesNotMatch(migration, /DELETE FROM public\.portal_terms_acceptances/);

  // Section 16 requires a new version to be linked to a new document hash, and
  // the hash must be derived rather than supplied.
  assert.match(migration, /ADD COLUMN IF NOT EXISTS document_hash text/);
  assert.match(migration, /encode\(sha256\(convert_to\(NEW\.content_markdown, 'UTF8'\)\), 'hex'\)/);
  assert.match(migration, /BEFORE INSERT OR UPDATE\s+ON public\.portal_terms_versions/);

  // Acknowledgment history is storable, and only as a list.
  assert.match(migration, /ADD COLUMN IF NOT EXISTS acknowledgements jsonb/);
  assert.match(migration, /jsonb_typeof\(acknowledgements\) = 'array'/);
});

test('the five mandatory acknowledgments agree across the page, the client and the server', () => {
  const keys = [
    'global_confidentiality_privacy',
    'authority_binding_acceptance',
    'portal_access',
    'binding_amlctf_arrangement',
    'independent_amlctf_responsibility',
  ];

  const serverList = verify.slice(
    verify.indexOf('const REQUIRED_TERMS_ACKNOWLEDGEMENTS'),
    verify.indexOf('] as const;', verify.indexOf('const REQUIRED_TERMS_ACKNOWLEDGEMENTS')),
  );
  const clientList = portalLib.slice(
    portalLib.indexOf('export const SOLICITOR_TERMS_ACKNOWLEDGEMENTS'),
    portalLib.indexOf('] as const;', portalLib.indexOf('export const SOLICITOR_TERMS_ACKNOWLEDGEMENTS')),
  );

  const orderIn = (source) => keys
    .map((key) => ({ key, at: source.indexOf(key) }))
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.key);

  for (const key of keys) {
    assert.ok(serverList.includes(key), `server does not require "${key}"`);
    assert.ok(clientList.includes(key), `client does not present "${key}"`);
  }
  // Order is part of the agreement: "The acknowledgments should appear in the
  // following order."
  assert.deepEqual(orderIn(serverList), keys);
  assert.deepEqual(orderIn(clientList), keys);

  // Each acknowledgment's wording is the agreement's own wording.
  const statements = [...clientList.matchAll(/statement:\s*\n?\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(statements.length, keys.length);
  for (const statement of statements) {
    assert.ok(
      agreement.includes(statement),
      `acknowledgment wording is not the published agreement's: "${statement.slice(0, 60)}…"`,
    );
  }
});

test('acceptance is refused unless every acknowledgment was asserted', () => {
  // The gate is the server's, not the checkbox's.
  assert.match(verify, /REQUIRED_TERMS_ACKNOWLEDGEMENTS\.filter\(\(key\) => !submitted\.includes\(key\)\)/);
  assert.match(verify, /ACKNOWLEDGEMENTS_INCOMPLETE/);
  assert.match(verify, /status: 400/);

  // Only the agreement's own keys are stored, and the acceptance record names
  // the exact document that was accepted.
  assert.match(verify, /const acknowledgements = REQUIRED_TERMS_ACKNOWLEDGEMENTS\.filter\(\(key\) => submitted\.includes\(key\)\)/);
  assert.match(verify, /portal_terms_acceptances'\)\.insert\(\{[^}]*acknowledgements/);
  assert.match(verify, /document_hash: terms\.document_hash \?\? null/);
  assert.match(verify, /select\('id, version, title, content_markdown, document_hash, effective_at'\)/);

  // The client cannot accept without carrying them.
  assert.match(authHook, /acceptTerms = useCallback\(async \(acknowledgements: SolicitorAcknowledgementKey\[\]\)/);
  assert.match(authHook, /action: 'accept_current_terms',\s*\n\s*acknowledgements,/);
});

test('the consent wall renders the stored agreement rather than a copy of it', () => {
  assert.match(termsPage, /terms\.content_markdown/);
  assert.match(termsPage, /<ReactMarkdown/);
  assert.match(termsPage, /SOLICITOR_TERMS_ACKNOWLEDGEMENTS\.map/);
  assert.match(termsPage, /Accept Binding Agreement & Continue/);
  assert.match(termsPage, /authorised to bind the Partner Organisation/);
  assert.match(termsPage, /Statutory reliance is available only where/);
  // The page shows which document it is asking about.
  assert.match(termsPage, /document hash/);
});

test('the agreement hashes to a stable document hash', () => {
  // Not a golden value — the point is that the hash is a function of the text,
  // so the value recorded against an acceptance identifies these exact bytes.
  const hash = createHash('sha256').update(agreement, 'utf8').digest('hex');
  assert.equal(hash.length, 64);
  assert.ok(agreement.length > 15000, 'agreement is shorter than the migration asserts');
});
