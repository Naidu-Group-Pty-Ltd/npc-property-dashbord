/**
 * No agreement may name a company the deployment did not configure.
 *
 * This product is sold to other agencies. Every party name, ABN, email, phone
 * and wordmark on a generated agreement has to come from that deployment's own
 * settings — and the failure mode is quiet, because a document that is wrong
 * in one line and right in every other does not look wrong.
 *
 * The audit that produced these tests found the founding tenant's identity in
 * three database column defaults (fixed in
 * `20260901001200_agreement_white_label_defaults.sql`) and nowhere in the code.
 * These tests hold the code side of that line: the locked content, the field
 * registry and the DOCX builder are checked for tenant literals, and the
 * builder is checked for the behaviour that matters most — given no brand at
 * all, it must print placeholders rather than invent an issuer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agreementTemplate,
  projectFieldValues,
  substitutePlain,
  templateKeyForDirection,
  type AgreementTemplateKey,
} from '@/lib/agreements';
import { buildAgreementDocx } from '@/lib/agreements/docx';

const KEYS: AgreementTemplateKey[] = ['strategic_property_referral', 'finance_referral_commission'];

/**
 * The founding tenant, in every form it appears in this repository's history.
 * A match on any of these inside the agreement path is a white-label leak.
 */
const TENANT_IDENTITY = [
  'Naidu',
  'NPC Services',
  'NPC Property',
  'npcservices',
  '50 684 555 771',
  '8609 3299',
  'admin@npcservices',
];

/** Modules that compose an agreement document. Comments count — a literal in
 *  a comment today is a literal in code after the next careless edit. */
const AGREEMENT_SOURCES = [
  'supabase/functions/_shared/agreements/contentStrategicReferral.pure.ts',
  'supabase/functions/_shared/agreements/contentFinanceReferral.pure.ts',
  'supabase/functions/_shared/agreements/fields.pure.ts',
  'supabase/functions/_shared/agreements/types.pure.ts',
  'supabase/functions/_shared/agreements/lifecycle.pure.ts',
  'supabase/functions/_shared/agreements/documentHtml.pure.ts',
  'src/lib/agreements/docx.ts',
  'src/lib/agreements/docxTheme.ts',
];

describe('the agreement path names no tenant', () => {
  for (const relative of AGREEMENT_SOURCES) {
    it(`${relative} carries no tenant identity`, () => {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      for (const needle of TENANT_IDENTITY) {
        expect(source).not.toContain(needle);
      }
    });
  }

  for (const key of KEYS) {
    it(`${key}: the locked content names no tenant`, () => {
      const serialised = JSON.stringify(agreementTemplate(key));
      for (const needle of TENANT_IDENTITY) {
        expect(serialised).not.toContain(needle);
      }
    });

    it(`${key}: an unbranded build invents no issuer`, async () => {
      // The whole point: with nothing configured, the document must say
      // "<<INSERT>>", never a company name inherited from somewhere.
      const blob = await buildAgreementDocx(key, {}, { brand: {}, includeTemplatePack: true });
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const doc = await zip.files['word/document.xml'].async('string');
      for (const needle of TENANT_IDENTITY) {
        expect(doc).not.toContain(needle);
      }
      // …and it does print the brackets, rather than rendering blank.
      expect(doc).toContain('&lt;&lt;INSERT&gt;&gt;');
    });

    it(`${key}: the tenant's own brand does reach the document`, async () => {
      // The other half of white-labelling: a configured deployment must see
      // itself, not a placeholder.
      const blob = await buildAgreementDocx(key, {}, {
        brand: {
          companyName: 'Harbourline Property Co',
          legalName: 'Harbourline Property Co Pty Ltd',
          abn: '11 222 333 444',
          email: 'hello@harbourline.example',
        },
        includeTemplatePack: true,
      });
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const doc = await zip.files['word/document.xml'].async('string');
      expect(doc).toContain('Harbourline Property Co Pty Ltd');
      expect(doc).toContain('11 222 333 444');
    });
  }
});

describe('an empty party name prints a bracket, not a company', () => {
  // This is the behaviour the migration relies on. `principal_legal_name`
  // defaulted to a company name; it now defaults to empty, which is only safe
  // because an empty value renders as the field's own placeholder.
  for (const key of KEYS) {
    it(`${key}: empty renders as the placeholder`, () => {
      expect(substitutePlain('{{ba_legal_name}}', key, { ba_legal_name: '' }))
        .toBe('<<INSERT>>');
      expect(substitutePlain('{{ba_legal_name}}', key, {}))
        .toBe('<<INSERT>>');
      expect(substitutePlain('{{ba_legal_name}}', key, { ba_legal_name: '   ' }))
        .toBe('<<INSERT>>');
    });
  }

  it('projects an empty register column as unset rather than blank text', () => {
    const key = templateKeyForDirection('inbound_property_referral');
    const values = projectFieldValues(key, {
      principal_legal_name: '',
      principal_trading_name: '',
      schedule_extras: {},
    } as never);
    expect(substitutePlain('{{ba_legal_name}}', key, values)).toBe('<<INSERT>>');
  });
});
