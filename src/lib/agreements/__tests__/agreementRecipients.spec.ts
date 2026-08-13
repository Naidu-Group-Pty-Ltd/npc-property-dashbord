/**
 * Who a copy of an agreement goes to.
 *
 * A partner organisation is rarely one inbox: the broker who signs is not the
 * person who files, and the aggregator and compliance both want a copy. None of
 * those changes who the agreement is *addressed* to — the party is the
 * organisation — so the primary recipient is fixed and everything else is the
 * operator's business.
 *
 * The parsing is forgiving because people paste out of Outlook and spreadsheets;
 * the validation is not, because a copy that silently failed to reach compliance
 * is worse than a send that refused.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ADDITIONAL_RECIPIENTS,
  describeRecipients,
  isDeliverableAddress,
  parseRecipientInput,
  recipientBlocker,
  resolveRecipients,
} from '@/lib/agreements';

const PARTNER = 'broker@brokerage.com.au';

describe('what counts as a deliverable address', () => {
  it('accepts the ordinary shapes', () => {
    for (const address of [
      'a@b.co', 'first.last@sub.domain.com.au', 'name+tag@example.org', "o'brien@firm.com",
    ]) {
      expect(isDeliverableAddress(address)).toBe(true);
    }
  });

  it('rejects what a person would notice is wrong', () => {
    for (const address of ['', '   ', 'nope', 'a@b', 'a@@b.com', 'a b@c.com', '@b.com', 'a@.com']) {
      expect(isDeliverableAddress(address)).toBe(false);
    }
  });

  it('rejects anything over the length a mailbox can be', () => {
    expect(isDeliverableAddress(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('parsing what people actually paste', () => {
  it('splits on commas, semicolons, tabs and newlines together', () => {
    expect(parseRecipientInput('a@x.com, b@x.com; c@x.com\nd@x.com\te@x.com'))
      .toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com']);
  });

  it('unwraps a pasted mail-client address', () => {
    // Rejecting this would look like the field is broken, because this is
    // exactly what copying a recipient out of Outlook gives you.
    expect(parseRecipientInput('Jane Smith <jane@firm.com.au>')).toEqual(['jane@firm.com.au']);
    expect(parseRecipientInput('"Ops Team" <ops@firm.com>, bob@firm.com'))
      .toEqual(['ops@firm.com', 'bob@firm.com']);
  });

  it('ignores empty entries and stray separators', () => {
    expect(parseRecipientInput(' , ;a@x.com,,  ')).toEqual(['a@x.com']);
    expect(parseRecipientInput(null)).toEqual([]);
    expect(parseRecipientInput('')).toEqual([]);
  });
});

describe('resolving the final list', () => {
  it('always includes the partner, first', () => {
    const resolved = resolveRecipients(PARTNER, 'ops@firm.com');
    expect(resolved.primary).toBe(PARTNER);
    expect(resolved.all[0]).toBe(PARTNER);
    expect(resolved.all).toEqual([PARTNER, 'ops@firm.com']);
  });

  it('never sends the partner two copies, whatever the casing', () => {
    const resolved = resolveRecipients(PARTNER, 'BROKER@Brokerage.com.AU, ops@firm.com');
    expect(resolved.all).toEqual([PARTNER, 'ops@firm.com']);
    expect(resolved.duplicates).toEqual(['BROKER@Brokerage.com.AU']);
  });

  it('de-duplicates the extras against each other', () => {
    const resolved = resolveRecipients(PARTNER, 'ops@firm.com, ops@firm.com');
    expect(resolved.additional).toEqual(['ops@firm.com']);
    expect(resolved.duplicates).toEqual(['ops@firm.com']);
  });

  it('reports a malformed address rather than dropping it', () => {
    const resolved = resolveRecipients(PARTNER, 'ops@firm.com, not-an-address');
    expect(resolved.additional).toEqual(['ops@firm.com']);
    expect(resolved.invalid).toEqual(['not-an-address']);
    // And it blocks the send: a compliance copy that silently never went is
    // the failure this whole field exists to avoid.
    expect(recipientBlocker(resolved)).toMatch(/not-an-address/);
  });

  it('caps the extras and says which were dropped', () => {
    const many = Array.from({ length: MAX_ADDITIONAL_RECIPIENTS + 3 },
      (_, i) => `person${i}@firm.com`).join(', ');
    const resolved = resolveRecipients(PARTNER, many);
    expect(resolved.additional).toHaveLength(MAX_ADDITIONAL_RECIPIENTS);
    expect(resolved.overflow).toHaveLength(3);
    // Overflow is not a blocker — the named partner and ten copies still go.
    expect(recipientBlocker(resolved)).toBeNull();
  });

  it('still sends when the partner record has no email but an address was typed', () => {
    const resolved = resolveRecipients(null, 'ops@firm.com');
    expect(resolved.primary).toBeNull();
    expect(resolved.all).toEqual(['ops@firm.com']);
    expect(recipientBlocker(resolved)).toBeNull();
  });

  it('blocks when there is nobody to send to at all', () => {
    const resolved = resolveRecipients(null, '');
    expect(resolved.all).toEqual([]);
    expect(recipientBlocker(resolved)).toMatch(/no email address on record/i);
  });

  it('ignores a partner address that is not deliverable', () => {
    // A junk value in the contact record must not become a recipient.
    const resolved = resolveRecipients('not-an-email', 'ops@firm.com');
    expect(resolved.primary).toBeNull();
    expect(resolved.all).toEqual(['ops@firm.com']);
  });

  it('describes the send in one sentence', () => {
    expect(describeRecipients(resolveRecipients(PARTNER, ''))).toBe(`Sends to ${PARTNER}.`);
    expect(describeRecipients(resolveRecipients(PARTNER, 'a@x.com'))).toMatch(/and 1 other\./);
    expect(describeRecipients(resolveRecipients(PARTNER, 'a@x.com, b@x.com'))).toMatch(/and 2 others\./);
    expect(describeRecipients(resolveRecipients(null, ''))).toMatch(/No deliverable address/);
  });
});
