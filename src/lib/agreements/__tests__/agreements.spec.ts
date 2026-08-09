/**
 * Contract tests for the locked agreement templates.
 *
 * The wording itself is locked and not asserted line-by-line here — the
 * content hash covers change detection. What IS asserted is the binding
 * contract around it: every `{{token}}` in the content resolves to a
 * registered field or a derived value, every grid cell's field exists, the
 * pre-issue validation derives from the registry, and the reversible mapping
 * between field values and the register row holds. A typo in a token would
 * otherwise render a generic placeholder into a legal document.
 */
import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_TEMPLATE_SUMMARIES,
  DERIVED_TOKEN_PLACEHOLDERS,
  agreementContentHash,
  agreementFieldDefs,
  agreementTemplate,
  rowPatchFromValues,
  templateContentHash,
  templateKeyForDirection,
  validateForIssue,
  projectFieldValues,
  type AgreementBlock,
  type AgreementTemplateKey,
} from '@/lib/agreements';

const TEMPLATE_KEYS: AgreementTemplateKey[] = [
  'strategic_property_referral',
  'finance_referral_commission',
];

function collectTokens(value: unknown, out: Set<string>) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{([a-z0-9_]+)\}\}/g)) out.add(match[1]);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => collectTokens(entry, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectTokens(entry, out));
  }
}

function collectFieldKeys(block: AgreementBlock, out: Set<string>) {
  if (block.kind !== 'grid') return;
  for (const row of block.rows) {
    for (const cell of row) {
      if (cell.fieldKey) out.add(cell.fieldKey);
      if (cell.choice) {
        out.add(cell.choice.fieldKey);
        if (cell.choice.otherFieldKey) out.add(cell.choice.otherFieldKey);
      }
    }
  }
}

describe('locked template binding contract', () => {
  for (const key of TEMPLATE_KEYS) {
    const content = agreementTemplate(key);
    const registered = new Set(agreementFieldDefs(key).map((def) => def.key));
    const derived = new Set(Object.keys(DERIVED_TOKEN_PLACEHOLDERS));

    it(`${key}: every {{token}} resolves to a field or a derived value`, () => {
      const tokens = new Set<string>();
      collectTokens(content, tokens);
      const unresolved = [...tokens].filter((token) => !registered.has(token) && !derived.has(token));
      expect(unresolved).toEqual([]);
    });

    it(`${key}: every grid cell binds a registered field or a derived value`, () => {
      const used = new Set<string>();
      for (const section of content.sections) {
        for (const block of section.blocks) collectFieldKeys(block, used);
      }
      const unknown = [...used].filter((fieldKey) => !registered.has(fieldKey) && !derived.has(fieldKey));
      expect(unknown).toEqual([]);
    });

    it(`${key}: the content hash is stable within a build`, () => {
      expect(templateContentHash(key)).toBe(agreementContentHash(content));
      expect(templateContentHash(key)).toMatch(/^[0-9a-f]{16}$/);
    });

    it(`${key}: direction round-trips`, () => {
      expect(templateKeyForDirection(content.direction)).toBe(key);
    });
  }

  it('the two templates carry distinct content hashes', () => {
    expect(templateContentHash('strategic_property_referral'))
      .not.toBe(templateContentHash('finance_referral_commission'));
  });

  it('template summaries make direction unmistakable', () => {
    expect(AGREEMENT_TEMPLATE_SUMMARIES).toHaveLength(2);
    for (const summary of AGREEMENT_TEMPLATE_SUMMARIES) {
      expect(summary.from).not.toBe(summary.to);
    }
  });
});

describe('pre-issue validation', () => {
  it('flags every required field on an empty agreement', () => {
    const validation = validateForIssue('strategic_property_referral', {});
    expect(validation.ok).toBe(false);
    const required = agreementFieldDefs('strategic_property_referral')
      .filter((def) => def.requiredForIssue).map((def) => def.key).sort();
    expect(validation.missing.map((item) => item.key).sort()).toEqual(required);
  });

  it('passes once the required set is filled', () => {
    const values: Record<string, unknown> = {};
    for (const def of agreementFieldDefs('finance_referral_commission')) {
      if (def.requiredForIssue) values[def.key] = def.type === 'number' || def.type === 'percent' ? '30' : 'Completed';
    }
    expect(validateForIssue('finance_referral_commission', values).ok).toBe(true);
  });
});

describe('field values ↔ register row mapping', () => {
  it('mirrors the agreed fee into the numeric column the model reads', () => {
    const fixed = rowPatchFromValues('strategic_property_referral', {
      remuneration_model: 'fixed_fee',
      agreed_fee_value: '$4,500',
    });
    expect(fixed.columns.fee_model).toBe('fixed_fee');
    expect(fixed.columns.fee_amount).toBe(4500);
    expect(fixed.columns.fee_percentage).toBeNull();

    const percentage = rowPatchFromValues('strategic_property_referral', {
      remuneration_model: 'percentage_of_fee',
      agreed_fee_value: '12.5%',
    });
    expect(percentage.columns.fee_percentage).toBe(12.5);
    expect(percentage.columns.fee_amount).toBeNull();
  });

  it('defaults Agreement 02\'s qualifying event in the template\'s own words', () => {
    const patch = rowPatchFromValues('finance_referral_commission', { qualifying_event_override: '' });
    expect(patch.columns.qualifying_event).toBe('Settled loan and first drawdown');
    const overridden = rowPatchFromValues('finance_referral_commission', { qualifying_event_override: 'Loan approval' });
    expect(overridden.columns.qualifying_event).toBe('Loan approval');
  });

  it('projects percent columns with the % the schedule prints', () => {
    const values = projectFieldValues('finance_referral_commission', {
      upfront_share_pct: 40,
      trail_share_pct: 0,
      schedule_extras: {},
    });
    expect(values.upfront_commission_share).toBe('40%');
    expect(values.trail_commission_share).toBe('0%');
  });

  it('round-trips cleared funds through the boolean column', () => {
    const patch = rowPatchFromValues('finance_referral_commission', { cleared_funds_condition: 'yes' });
    expect(patch.columns.cleared_funds_required).toBe(true);
    const values = projectFieldValues('finance_referral_commission', {
      cleared_funds_required: false,
      schedule_extras: {},
    });
    expect(values.cleared_funds_condition).toBe('no');
  });
});

/**
 * What the front sheet of an agreement may and may not say.
 *
 * The cover used to carry a template descriptor and a row of chips —
 * `EDITABLE`, `ACTIVATION-READY`, `BRAND-READY`. That is copy for somebody
 * choosing a template out of a library. On the face of an agreement a
 * counterparty's lawyer is reading, it is marketing, and it was the first
 * thing on the page. It is now the particulars: every line a fact about this
 * agreement, bound from the register.
 */
describe('the cover states the deal, not the product', () => {
  const MARKETING = ['EDITABLE', 'ACTIVATION-READY', 'BRAND-READY'];

  for (const key of TEMPLATE_KEYS) {
    const cover = agreementTemplate(key).sections[0].blocks[0];

    it(`${key}: carries a particulars panel`, () => {
      expect(cover.kind).toBe('cover');
      if (cover.kind !== 'cover') return;
      const labels = cover.particulars.map((entry) => entry.label);
      // Both parties, both identifiers, the date and the governing law — the
      // six facts a front sheet exists to state.
      expect(labels).toEqual(['BETWEEN', 'ABN / ACN', 'AND', 'ABN / ACN', 'DATED', 'GOVERNING LAW']);
    });

    it(`${key}: names the issuing party first`, () => {
      if (cover.kind !== 'cover') return;
      // "Issued by the buyer's agency" must not then say BETWEEN <the other
      // party> — the parties are listed in the order the document issues.
      const issuerIsBuyersAgency = key === 'strategic_property_referral';
      expect(cover.particulars[0].value)
        .toBe(issuerIsBuyersAgency ? '{{ba_legal_name}}' : '{{fp_legal_name}}');
      expect(cover.particulars[2].value)
        .toBe(issuerIsBuyersAgency ? '{{fp_legal_name}}' : '{{ba_legal_name}}');
    });

    it(`${key}: every particular binds to a registered field`, () => {
      if (cover.kind !== 'cover') return;
      const known = new Set(agreementFieldDefs(key).map((field) => field.key));
      for (const entry of cover.particulars) {
        for (const [, token] of entry.value.matchAll(/\{\{([a-z0-9_]+)\}\}/g)) {
          expect(known.has(token) || DERIVED_TOKEN_PLACEHOLDERS[token] !== undefined).toBe(true);
        }
      }
    });

    it(`${key}: carries no template marketing anywhere in the document`, () => {
      const serialised = JSON.stringify(agreementTemplate(key));
      for (const phrase of MARKETING) expect(serialised).not.toContain(phrase);
      // The descriptor's opening words, in case the sentence moves rather than goes.
      expect(serialised).not.toContain('A structured, editable agreement template');
    });
  }
});
