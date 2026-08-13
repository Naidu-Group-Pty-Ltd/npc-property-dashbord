/**
 * Did the thing we sent actually land on the other side?
 *
 * ## Why this exists
 *
 * Issuing an agreement does four things, and three of them are best-effort by
 * design: it freezes a version (must succeed), renders a PDF (deferred to the
 * first download if the renderer is down), emails the partner (reported), and
 * raises an in-portal notification (silent). That last one was the only step
 * whose outcome nobody could see. `notifyPartner` catches its own errors so a
 * notification failure can never roll back an issue — correct — and then
 * returns nothing, so the Command Centre said "issued to the partner portal"
 * whether or not anything reached the portal.
 *
 * That is the shape of the complaint this module answers. Not "the notification
 * is broken" — in production every one of them was written correctly, to the
 * right portal user, with the right deep link. The problem is that "issued" and
 * "issued, and I can prove they were told" were the same sentence, so a real
 * failure and a healthy issue would have looked identical, and the only way to
 * tell them apart was to log in as the partner.
 *
 * ## The states
 *
 * Deliberately five, not a boolean. Three of them are healthy and mean
 * different things to whoever is chasing the partner, and separating
 * `awaiting_activation` from `unnotified` is the whole point: the first is a
 * partner who has no login yet (expected, and the activation sweep will raise
 * the notification when they get one), the second is a partner who CAN log in
 * and was never told (a real fault, and the one that reads as "the agreement
 * never arrived").
 */

/** What one attempt to notify a partner did. */
export type PartnerNotifyOutcome =
  /** A row is in their feed now. */
  | 'delivered'
  /** No portal user to address — activation will sweep it up. Not a fault. */
  | 'deferred'
  /** The insert failed. The issue still stands; the partner was not told. */
  | 'failed';

export interface AgreementPortalReceiptInput {
  issuedAt: string | null | undefined;
  /** Whether the partner can sign in — `partnerAccess.pure.ts`. */
  canSignIn: boolean;
  /** In-portal notifications raised for this agreement, ever. */
  notifications: number;
  /** When the partner first opened it. The strongest evidence there is. */
  firstViewedAt: string | null | undefined;
}

export type PortalReceiptState =
  /** Nothing has been issued, so there is nothing to have received. */
  | 'not_issued'
  /** Issued and opened by the partner. Nothing to chase. */
  | 'opened'
  /** Issued, and a notification is waiting in their feed. */
  | 'notified'
  /** Issued to a partner with no login yet. Held, not lost. */
  | 'awaiting_activation'
  /** Issued, they can log in, and nothing was ever raised. Chase this. */
  | 'unnotified';

export function agreementPortalReceipt(input: AgreementPortalReceiptInput): PortalReceiptState {
  if (!input.issuedAt) return 'not_issued';
  // A view outranks everything else: it is the partner's own browser telling us
  // they have the document, and it stays true even if the notification row was
  // later marked read, deleted or never written.
  if (input.firstViewedAt) return 'opened';
  if (input.notifications > 0) return 'notified';
  // Order matters here. Somebody with no login has no feed for a notification
  // to live in, so "nothing was raised" is the expected reading of that state
  // and calling it a fault would put a red flag on every dormant issue.
  return input.canSignIn ? 'unnotified' : 'awaiting_activation';
}

export const PORTAL_RECEIPT_LABELS: Record<PortalReceiptState, string> = {
  not_issued: 'Not issued',
  opened: 'Opened by the partner',
  notified: 'Waiting in their portal',
  awaiting_activation: 'Held until they activate',
  unnotified: 'Not announced in the portal',
};

export const PORTAL_RECEIPT_NOTES: Record<PortalReceiptState, string> = {
  not_issued: 'Nothing has been issued to the partner portal yet.',
  opened:
    'The partner has opened this agreement in their portal. Delivery is confirmed.',
  notified:
    'The agreement is in the partner\'s portal and a notification is waiting in their feed. '
    + 'They have not opened it yet.',
  awaiting_activation:
    'The agreement is issued and addressed to this partner. They have no portal login yet, so '
    + 'the notification is raised for them the moment they activate one.',
  unnotified:
    'The agreement is issued and the partner can sign in, but no portal notification was ever '
    + 'raised for it — so nothing told them it is there. Use Send to announce it again.',
};

/** Whether this state is one somebody should act on. */
export function portalReceiptNeedsAttention(state: PortalReceiptState): boolean {
  return state === 'unnotified';
}
