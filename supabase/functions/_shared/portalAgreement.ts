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
