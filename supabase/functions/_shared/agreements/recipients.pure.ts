/**
 * Who an agreement is emailed to, resolved once for both sides of the wire.
 *
 * A partner organisation is rarely one inbox. The broker who signs is not the
 * person who files, the aggregator wants a copy, compliance wants a copy, and
 * the address on the contact record is whichever one somebody typed into the
 * wizard first. Every one of those is a legitimate second recipient and none of
 * them is a reason to change who the agreement is *addressed* to — the party is
 * the organisation, and that does not move because a copy went to an assistant.
 *
 * So this separates two things the UI would otherwise conflate:
 *
 *  - the **primary** recipient, which is the partner contact on the agreement
 *    and is not the operator's to remove;
 *  - **additional** recipients, which are free text, arbitrary in number, and
 *    entirely the operator's business.
 *
 * Parsing is deliberately forgiving about separators and unforgiving about
 * addresses. People paste from Outlook, from a spreadsheet column, from a
 * signature block — commas, semicolons, newlines and stray spaces all arrive.
 * A malformed address, though, is reported rather than silently dropped: an
 * agreement that quietly failed to reach compliance is worse than one that
 * refused to send.
 */

/** Hard ceiling on additional addresses in one send. */
export const MAX_ADDITIONAL_RECIPIENTS = 10;

/**
 * Deliberately not RFC 5322. That grammar admits addresses no mail provider
 * will accept and no person will type, and the cost of being wrong here is a
 * silent non-delivery. This is the shape of an address somebody actually has.
 */
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;

export function isDeliverableAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return ADDRESS.test(trimmed);
}

export interface ResolvedRecipients {
  /** The partner contact. Absent only when the agreement has no email on it. */
  primary: string | null;
  /** Valid, de-duplicated extras, in the order they were typed. */
  additional: string[];
  /** Everything that will actually be sent to, primary first. */
  all: string[];
  /** Typed entries that are not deliverable addresses, verbatim. */
  invalid: string[];
  /** Valid entries dropped as duplicates of the primary or of each other. */
  duplicates: string[];
  /** Valid entries beyond the ceiling. */
  overflow: string[];
}

/**
 * Split typed input into addresses.
 *
 * Also unwraps `Name <addr@host>`, because that is what pasting from a mail
 * client gives you and rejecting it would look like the field is broken.
 */
export function parseRecipientInput(input: string | null | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[,;\n\r\t]+/)
    .map((entry) => {
      const trimmed = entry.trim();
      const angled = /<([^>]+)>\s*$/.exec(trimmed);
      return (angled ? angled[1] : trimmed).trim();
    })
    .filter((entry) => entry.length > 0);
}

/**
 * The final recipient list, and an honest account of what was discarded.
 *
 * De-duplication is case-insensitive on the whole address. That is not strictly
 * correct — the local part is case-sensitive per the RFC — but no mail provider
 * in use treats it that way, and sending the same partner two copies because
 * somebody capitalised their own name is the worse error.
 */
export function resolveRecipients(
  primaryEmail: string | null | undefined,
  additionalInput: string | null | undefined,
  options: { max?: number } = {},
): ResolvedRecipients {
  const max = options.max ?? MAX_ADDITIONAL_RECIPIENTS;
  const primaryRaw = (primaryEmail ?? '').trim();
  const primary = primaryRaw && isDeliverableAddress(primaryRaw) ? primaryRaw : null;

  const seen = new Set<string>();
  if (primary) seen.add(primary.toLowerCase());

  const additional: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const overflow: string[] = [];

  for (const entry of parseRecipientInput(additionalInput)) {
    if (!isDeliverableAddress(entry)) { invalid.push(entry); continue; }
    const key = entry.toLowerCase();
    if (seen.has(key)) { duplicates.push(entry); continue; }
    if (additional.length >= max) { overflow.push(entry); continue; }
    seen.add(key);
    additional.push(entry);
  }

  return {
    primary,
    additional,
    all: primary ? [primary, ...additional] : [...additional],
    invalid,
    duplicates,
    overflow,
  };
}

/** One sentence about what will happen, for the button's own label area. */
export function describeRecipients(resolved: ResolvedRecipients): string {
  if (resolved.all.length === 0) return 'No deliverable address yet.';
  if (resolved.all.length === 1) return `Sends to ${resolved.all[0]}.`;
  return `Sends to ${resolved.all[0]} and ${resolved.additional.length} other`
    + `${resolved.additional.length === 1 ? '' : 's'}.`;
}

/** Why a send cannot proceed, or null when it can. */
export function recipientBlocker(resolved: ResolvedRecipients): string | null {
  if (resolved.invalid.length > 0) {
    return `${resolved.invalid.join(', ')} ${resolved.invalid.length === 1 ? 'is not a' : 'are not'} `
      + 'valid email address'
      + `${resolved.invalid.length === 1 ? '' : 'es'}.`;
  }
  if (resolved.all.length === 0) {
    return 'This partner has no email address on record. Add one, or type an address to send to.';
  }
  return null;
}
