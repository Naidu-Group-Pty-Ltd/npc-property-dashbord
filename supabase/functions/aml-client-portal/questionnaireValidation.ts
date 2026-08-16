const ENTITY_TYPES = ['Individual', 'Joint', 'Company', 'Trust', 'SMSF', 'Partnership'] as const;
const FUNDING_SOURCES = [
  'Salary savings', 'Business income', 'Sale of asset', 'Inheritance', 'Gift',
  'Investment returns', 'Superannuation', 'Loan / mortgage', 'Other',
] as const;
const PURCHASE_PURPOSES = ['Owner-occupier', 'Investment', 'Business use', 'Development'] as const;
const PARTY_ROLES = [
  'Co-purchaser', 'Director', 'Trustee', 'Beneficial owner', 'Beneficiary',
  'Authorised representative', 'Donor (gift)', 'Private lender', 'Other',
] as const;

type Payload = Record<string, unknown>;

function isPayload(value: unknown): value is Payload {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonBlank(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireFields(payload: Payload, fields: string[]): string[] {
  return fields.filter((field) => !isNonBlank(payload[field]));
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

/** Validate the server-owned questionnaire contract before a section is submitted. */
export function validateQuestionnaireSection(
  section: string,
  value: unknown,
  structureValue?: unknown,
): string[] {
  if (!isPayload(value)) return ['payload'];
  const payload = value;

  switch (section) {
    case 'purchasing_structure':
      return isOneOf(payload.entity_type, ENTITY_TYPES) ? [] : ['entity_type'];
    case 'personal_details': {
      const errors = requireFields(payload, [
        'full_name', 'dob', 'citizenship', 'tax_residency', 'address', 'occupation',
      ]);
      if (!isOneOf(payload.pep, ['yes', 'no'])) errors.push('pep');
      if (!isOneOf(payload.adverse, ['yes', 'no'])) errors.push('adverse');
      return errors;
    }
    case 'purchase_profile': {
      const errors = requireFields(payload, ['price_range']);
      if (!isOneOf(payload.purpose, PURCHASE_PURPOSES)) errors.push('purpose');
      if (!isOneOf(payload.third_party, ['yes', 'no'])) errors.push('third_party');
      return errors;
    }
    case 'funding': {
      const errors = requireFields(payload, ['deposit', 'narrative']);
      const sources = payload.sources;
      if (!Array.isArray(sources) || sources.length === 0 ||
          sources.some((source) => !isOneOf(source, FUNDING_SOURCES))) {
        errors.push('sources');
      }
      if (!isOneOf(payload.overseas, ['yes', 'no'])) errors.push('overseas');
      return errors;
    }
    case 'entity_details': {
      const errors = requireFields(payload, [
        'entity_name', 'abn_acn', 'registration_place', 'registered_address',
      ]);
      const structure = isPayload(structureValue) ? structureValue.entity_type : undefined;
      if (structure === 'Trust' || structure === 'SMSF') {
        errors.push(...requireFields(payload, ['deed_date']));
        if (!isOneOf(payload.trustee_type, ['individual', 'corporate'])) errors.push('trustee_type');
        if (payload.trustee_type === 'corporate' && !isNonBlank(payload.corporate_trustee)) {
          errors.push('corporate_trustee');
        }
      }
      if (structure === 'SMSF' && !isOneOf(payload.lrba, ['yes', 'no'])) errors.push('lrba');
      return errors;
    }
    case 'related_parties': {
      if (!Array.isArray(payload.parties) || payload.parties.length === 0) return ['parties'];
      const errors: string[] = [];
      payload.parties.forEach((party, index) => {
        if (!isPayload(party) || !isOneOf(party.role, PARTY_ROLES)) errors.push(`parties.${index}.role`);
        if (!isPayload(party) || !isNonBlank(party.full_name)) errors.push(`parties.${index}.full_name`);
      });
      return errors;
    }
    case 'sanctions_screening': {
      // The client declares COMPLETENESS of the screening information, never
      // a screening outcome. Every branch here is about what they told us,
      // and none of it can widen or narrow what must be determined.
      const errors: string[] = [];
      if (!isOneOf(payload.completeness, ['complete', 'additions', 'unsure'])) {
        errors.push('completeness');
      }
      // The acknowledgement is an audit record of an information declaration.
      // It is not consent to screen — screening happens under an independent
      // obligation — so it is required but never load-bearing on scope.
      if (payload.acknowledged !== true) errors.push('acknowledged');
      const aliases = payload.aliases;
      if (aliases !== undefined && (!Array.isArray(aliases)
        || aliases.some((a) => typeof a !== 'string'))) {
        errors.push('aliases');
      }
      return errors;
    }
    default:
      return ['section'];
  }
}
