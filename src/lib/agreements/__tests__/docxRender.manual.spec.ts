/**
 * Manual render harness — writes both templates to /tmp so they can be
 * converted and looked at. Skipped unless AGREEMENT_DOCX_RENDER=1, because a
 * test suite should not be writing files into the machine it runs on.
 *
 *   AGREEMENT_DOCX_RENDER=1 npx vitest run src/lib/agreements/__tests__/docxRender.manual.spec.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAgreementDocx } from '@/lib/agreements/docx';
import type { AgreementTemplateKey } from '@/lib/agreements';

const ENABLED = process.env.AGREEMENT_DOCX_RENDER === '1';
const OUT_DIR = process.env.AGREEMENT_DOCX_OUT ?? '/tmp';

const BRAND = {
  brandColour: '#1F4D8F',
  companyName: 'Harbourline',
  legalName: 'Harbourline Property Co Pty Ltd',
  abn: '12 345 678 901',
  address: '1 Quay Street, Sydney NSW 2000',
  email: 'hello@harbourline.example',
  phone: '02 9000 0000',
  website: 'harbourline.example',
};

const FILLED: Record<string, unknown> = {
  effective_date: '8 August 2026',
  governing_state: 'New South Wales',
  ba_legal_name: 'Harbourline Property Co Pty Ltd',
  ba_trading_name: 'Harbourline',
  ba_abn_acn: '12 345 678 901',
  ba_address: '1 Quay Street, Sydney NSW 2000',
  ba_email: 'hello@harbourline.example',
  fp_legal_name: 'ABC Finance Pty Ltd',
  fp_trading_name: 'ABC Finance',
  fp_abn_acn: '98 765 432 109',
  fp_acl_crn: 'ACL 400123',
  fp_email: 'jane@abcfinance.example',
  remuneration_model: 'percentage_of_fee',
  agreed_fee_value: '20% of the buyer\'s agency fee',
  gst_treatment: 'plus_gst',
  qualifying_event: 'Settlement',
  payment_timeframe_days: '14',
  invoice_process: 'rcti',
  termination_notice_days: '30',
  breach_remedy_days: '10',
  dispute_resolution_days: '15',
  upfront_commission_share: '40%',
  commission_basis: 'net_of_aggregator',
  payment_cycle: 'Monthly',
  cleared_funds_condition: 'yes',
  clawback_treatment: 'Proportional repayment',
  clawback_repayment_days: '14',
  fp_contact_timeframe: '2 business days',
  payment_dispute_days: '10',
};

describe.skipIf(!ENABLED)('agreement DOCX render harness', () => {
  const keys: AgreementTemplateKey[] = ['strategic_property_referral', 'finance_referral_commission'];

  for (const key of keys) {
    it(`writes ${key} (blank + filled)`, async () => {
      const blank = await buildAgreementDocx(key, {}, { brand: BRAND, includeTemplatePack: true });
      const filled = await buildAgreementDocx(key, FILLED, { brand: BRAND, includeTemplatePack: true });
      writeFileSync(`${OUT_DIR}/${key}-blank.docx`, Buffer.from(await blank.arrayBuffer()));
      writeFileSync(`${OUT_DIR}/${key}-filled.docx`, Buffer.from(await filled.arrayBuffer()));
      expect(blank.size).toBeGreaterThan(5000);
      expect(filled.size).toBeGreaterThan(5000);
    });
  }
});
