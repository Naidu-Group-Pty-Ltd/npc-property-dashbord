/**
 * Agreement Centre — one import surface for the locked templates and their
 * bindings. Everything here is pure and browser-safe; the browser reaches it
 * through the `src/lib/agreements/` bridge re-exports.
 */

import { FINANCE_REFERRAL_CONTENT } from './contentFinanceReferral.pure.ts';
import { STRATEGIC_REFERRAL_CONTENT } from './contentStrategicReferral.pure.ts';
import { agreementContentHash } from './types.pure.ts';
import type { AgreementTemplateContent, AgreementTemplateKey } from './types.pure.ts';

export * from './types.pure.ts';
export * from './fields.pure.ts';
export * from './lifecycle.pure.ts';
export { STRATEGIC_REFERRAL_CONTENT } from './contentStrategicReferral.pure.ts';
export { FINANCE_REFERRAL_CONTENT } from './contentFinanceReferral.pure.ts';

/**
 * The revision of the agreement document RENDERING — bump when the visual
 * composition changes and an already-stored unsigned preview should be
 * re-rendered. The legal content is hashed separately (`templateContentHash`)
 * and does not change with this number.
 */
export const AGREEMENT_CENTRE_DOCUMENT_REVISION = 1;

export function agreementTemplate(key: AgreementTemplateKey): AgreementTemplateContent {
  return key === 'strategic_property_referral' ? STRATEGIC_REFERRAL_CONTENT : FINANCE_REFERRAL_CONTENT;
}

const CONTENT_HASHES: Record<AgreementTemplateKey, string> = {
  strategic_property_referral: agreementContentHash(STRATEGIC_REFERRAL_CONTENT),
  finance_referral_commission: agreementContentHash(FINANCE_REFERRAL_CONTENT),
};

/** The locked content's fingerprint, frozen onto every issued version row. */
export function templateContentHash(key: AgreementTemplateKey): string {
  return CONTENT_HASHES[key];
}

export const AGREEMENT_TEMPLATE_SUMMARIES: readonly {
  key: AgreementTemplateKey;
  title: string;
  issuedByLine: string;
  /** The relationship arrow, for the template library card. */
  from: string;
  to: string;
  /** Who the referred clients flow from/to — makes direction unmistakable. */
  referralFlow: string;
}[] = [
  {
    key: 'strategic_property_referral',
    title: STRATEGIC_REFERRAL_CONTENT.title,
    issuedByLine: STRATEGIC_REFERRAL_CONTENT.issuedByLine,
    from: 'FINANCE PARTNER',
    to: 'BUYER\'S AGENCY',
    referralFlow: 'The finance partner refers clients to the buyer\'s agency for property services. Issued by the buyer\'s agency.',
  },
  {
    key: 'finance_referral_commission',
    title: FINANCE_REFERRAL_CONTENT.title,
    issuedByLine: FINANCE_REFERRAL_CONTENT.issuedByLine,
    from: 'BUYER\'S AGENCY',
    to: 'FINANCE PARTNER',
    referralFlow: 'The buyer\'s agency refers clients to the finance partner for credit services. Issued by the finance partner.',
  },
];
