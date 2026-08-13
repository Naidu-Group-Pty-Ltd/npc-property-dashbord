/**
 * The mandatory acknowledgments of the Portal Access, Confidentiality, Privacy
 * and AML/CTF Compliance Passport Agreement, in the order the agreement sets.
 *
 * One agreement, one list, three portals. This is the server side of the same
 * contract as `PORTAL_TERMS_ACKNOWLEDGEMENTS` in `src/lib/portalAgreement.ts`;
 * the two must agree. Enforcing it here rather than in the page is the point:
 * the acknowledgments are contractual statements — authority to bind and the
 * section 37A arrangement among them — and an acceptance recorded without them
 * would claim assent nobody gave.
 *
 * A fifth, `independent_amlctf_responsibility`, was withdrawn in terms version
 * 2026-08-07 and is deliberately absent. Removing a required key is the safe
 * direction to ship in: a browser still running a previous bundle sends the old
 * set, and only the keys required here are looked for, so it keeps working
 * through the deploy. Adding one back is not — the pages must ship first.
 */
export const REQUIRED_TERMS_ACKNOWLEDGEMENTS = [
  'global_confidentiality_privacy',
  'authority_binding_acceptance',
  'portal_access',
  'binding_amlctf_arrangement',
] as const;

export type RequiredAcknowledgement = (typeof REQUIRED_TERMS_ACKNOWLEDGEMENTS)[number];

export interface AcknowledgementCheck {
  /** The required keys the caller asserted, in the agreement's own order. */
  acknowledgements: RequiredAcknowledgement[];
  /** Required keys the caller did not assert. Non-empty means refuse. */
  missing: RequiredAcknowledgement[];
}

/**
 * Read the acknowledgments off a request body.
 *
 * Unknown keys are dropped rather than stored: the acknowledgment history is a
 * record of what this agreement asked, not of whatever the caller sent. A body
 * with no `acknowledgements` field at all reports every key missing, which is
 * the correct answer — an acceptance is not a thing that can be assumed.
 */
export function readAcknowledgements(body: Record<string, unknown>): AcknowledgementCheck {
  const submitted = Array.isArray(body?.acknowledgements)
    ? (body.acknowledgements as unknown[]).filter((key): key is string => typeof key === 'string')
    : [];
  return {
    acknowledgements: REQUIRED_TERMS_ACKNOWLEDGEMENTS.filter((key) => submitted.includes(key)),
    missing: REQUIRED_TERMS_ACKNOWLEDGEMENTS.filter((key) => !submitted.includes(key)),
  };
}

/** The single wording every portal returns when an acknowledgment is missing. */
export const ACKNOWLEDGEMENTS_INCOMPLETE_ERROR =
  'All mandatory acknowledgments must be accepted before this agreement can be recorded.';

/**
 * The acknowledgments with the wording the agreement itself uses, in the
 * agreement's order. The server side of `PORTAL_TERMS_ACKNOWLEDGEMENTS` in
 * `src/lib/portalAgreement.ts` — the executed-agreement PDF must print the
 * statement a person assented to, not a key, and an edge function cannot import
 * from `src/`. Keys must stay in step with REQUIRED_TERMS_ACKNOWLEDGEMENTS.
 */
export const PORTAL_TERMS_ACKNOWLEDGEMENTS = [
  {
    key: 'global_confidentiality_privacy',
    heading: 'Global confidentiality and privacy',
    statement:
      'I acknowledge that all information made available through the Portal is confidential and may include personal, sensitive, commercially confidential or legally privileged information. I agree that my organisation will access, use, protect and disclose that information only for an authorised client, transaction and lawful professional purpose.',
  },
  {
    key: 'authority_binding_acceptance',
    heading: 'Authority and binding acceptance',
    statement:
      'I confirm that I am authorised to accept this Agreement and legally bind the Partner Organisation identified above. I agree that my electronic acceptance will constitute execution of this Agreement on behalf of the Partner Organisation.',
  },
  {
    key: 'portal_access',
    heading: 'Portal access',
    statement:
      'I agree that the Partner Organisation will access and use the Portal only for authorised matters and will comply with the Portal access, privacy, confidentiality, security and audit requirements set out in this Agreement.',
  },
  {
    key: 'binding_amlctf_arrangement',
    heading: 'Binding AML/CTF arrangement',
    statement:
      'I acknowledge and agree that, where the applicable eligibility and legislative requirements are satisfied, this Agreement is intended to constitute a binding customer due-diligence agreement or arrangement between the Originating Organisation and Partner Organisation for the purposes of section 37A of the AML/CTF Act and section 6-29 of the AML/CTF Rules.',
  },
] as const;
