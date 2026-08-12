/**
 * A blank required field must not throw away the whole step.
 *
 * Reported as "agreements are not being issued to the finance portal, which it
 * had previously done". The production log said what it actually was — three
 * consecutive saves, on one draft, inside forty seconds:
 *
 *   [manage-partner-agreements] error: null value in column
 *   "principal_legal_name" of relation "partner_agreements" violates
 *   not-null constraint  { code: "23502" }
 *
 * `rowPatchFromValues` maps every empty field to `null`, which is right for
 * almost every column and fatal for the handful the register declares NOT
 * NULL: Postgres rejects the **entire** statement, so one blank issuer name
 * discards every other edit made in that step.
 *
 * It had been invisible because `principal_legal_name` carried a column
 * DEFAULT of the founding tenant's own name — a freshly created agreement was
 * never empty, the wizard read that value back, and the patch never sent null.
 * The white-label audit removed that default, correctly, because it was
 * printing one agency's name on another agency's contract. Removing it also
 * removed the thing that had been accidentally keeping the column populated.
 *
 * That is the shape worth remembering: a fix to a data-correctness bug exposed
 * a latent write bug that the wrong data had been masking.
 */
import { describe, expect, it } from 'vitest';
import { rowPatchFromValues, type AgreementTemplateKey } from '@/lib/agreements';
// The error translator is its own module — `@/lib/agreements` re-exports the
// Edge Function bridge, and this one is browser-only.
import { agreementErrorMessage, detectSkew } from '@/lib/agreements/apiErrors.pure';

const KEYS: AgreementTemplateKey[] = ['strategic_property_referral', 'finance_referral_commission'];

/** Every NOT NULL column on `partner_agreements` the register can write. */
const NOT_NULL = [
  'principal_legal_name',
  'partner_legal_name',
  'governing_state',
  'termination_notice_days',
  'dispute_window_days',
  'cleared_funds_required',
];

describe('a required column is never sent a null', () => {
  it('omits the issuer legal name when it is blank, rather than nulling it', () => {
    // The exact failure from the log.
    const patch = rowPatchFromValues('strategic_property_referral', { ba_legal_name: '' });
    expect(patch.columns).not.toHaveProperty('principal_legal_name');
  });

  it('omits the counterparty legal name too — it has no default to fall back on', () => {
    const patch = rowPatchFromValues('strategic_property_referral', { fp_legal_name: '' });
    expect(patch.columns).not.toHaveProperty('partner_legal_name');
  });

  it('never emits null for any NOT NULL column, on either template', () => {
    for (const key of KEYS) {
      // Blank every field that maps onto one of them.
      const patch = rowPatchFromValues(key, {
        ba_legal_name: '', fp_legal_name: '', governing_state: '',
        termination_notice_days: '', dispute_window_days: '',
        ba_trading_name: '', fp_trading_name: '', ba_abn_acn: '', fp_abn_acn: '',
      });
      for (const column of NOT_NULL) {
        if (column in patch.columns) {
          expect(patch.columns[column]).not.toBeNull();
        }
      }
    }
  });

  it('still writes a value the user actually typed', () => {
    // The guard must not become "never write these columns".
    const patch = rowPatchFromValues('strategic_property_referral', {
      ba_legal_name: 'Naidu Property Consulting Services Pty Ltd',
    });
    expect(patch.columns.principal_legal_name)
      .toBe('Naidu Property Consulting Services Pty Ltd');
  });

  it('still nulls a nullable column, which is what clearing one should do', () => {
    // Only the NOT NULL set is special. Everything else must keep behaving.
    const patch = rowPatchFromValues('strategic_property_referral', { ba_trading_name: '' });
    expect(patch.columns).toHaveProperty('principal_trading_name');
    expect(patch.columns.principal_trading_name).toBeNull();
  });

  it('leaves the boolean column a boolean rather than omitting it', () => {
    const patch = rowPatchFromValues('finance_referral_commission', { cleared_funds_required: '' });
    if ('cleared_funds_required' in patch.columns) {
      expect(typeof patch.columns.cleared_funds_required).toBe('boolean');
    }
  });
});

describe('and if one ever slips through, it reads like something a person can fix', () => {
  const failure = {
    code: '23502',
    message: 'null value in column "principal_legal_name" of relation "partner_agreements" '
      + 'violates not-null constraint',
  };

  it('names the field instead of the column', () => {
    const message = agreementErrorMessage(failure);
    expect(message).toContain('Principal legal name');
    expect(message).not.toContain('partner_agreements');
    expect(message).not.toContain('not-null constraint');
  });

  it('says the rest of the step was lost, because it was', () => {
    // A user who does not know the whole update aborted will not redo the
    // other fields, and will save the same failure again.
    expect(agreementErrorMessage(failure)).toMatch(/Nothing on this step was saved/i);
  });

  it('recognises the violation from the prose when there is no code', () => {
    expect(agreementErrorMessage({ message: failure.message })).toContain('Principal legal name');
  });

  it('falls back gracefully when the column is not named', () => {
    expect(agreementErrorMessage({ code: '23502', message: 'violates not-null constraint' }))
      .toMatch(/^A required field cannot be left blank/);
  });

  it('is not mistaken for deployment skew', () => {
    // Both halves are current; telling somebody to go and deploy would send
    // them to the one place the fault is not.
    expect(detectSkew(failure)).toBeNull();
  });

  it('leaves ordinary refusals alone', () => {
    expect(agreementErrorMessage({
      code: 'not_archivable',
      message: 'This agreement is executed. Archive it instead.',
    })).toBe('This agreement is executed. Archive it instead.');
  });
});
