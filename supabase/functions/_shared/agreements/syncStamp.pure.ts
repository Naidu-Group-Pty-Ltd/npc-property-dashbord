/**
 * A cheap cursor that tells one portal the other has moved.
 *
 * ## What was actually wrong
 *
 * Reported as "the Finance Portal is not receiving agreements". It receives
 * them. Measured against production: one agreement was issued at 16:22:15 and
 * opened by the partner at 16:22:26 — eleven seconds, end to end. The data, the
 * partner mapping, the notification write, the session resolution and the
 * partner's own list query were all verified correct.
 *
 * What is missing is not delivery. It is **synchronisation**. Every agreement
 * surface on both sides fetched exactly once, on mount:
 *
 *  - the partner's agreement list — no interval, no focus refetch;
 *  - the partner's agreement room — the same;
 *  - the Command Centre's register and detail — the same;
 *  - and the only thing that polled at all was the notification bell's unread
 *    COUNT, which moves a badge and refreshes no agreement view.
 *
 * So the live test is: issue in the Command Centre, switch to the Finance
 * Portal tab that has been open for an hour, and nothing is there — because
 * that tab last asked the server when it mounted. Indistinguishable, from the
 * outside, from a portal that never received anything. The same gap runs the
 * other way: a partner accepts, and the Command Centre keeps showing "Awaiting
 * partner review" until somebody reloads.
 *
 * ## Why not Supabase Realtime
 *
 * Because the Finance Portal cannot use it. It authenticates with a bespoke
 * session token (`x-finance-session-token`) resolved server-side, not a
 * Supabase JWT, and `partner_agreements` is service-role only. The partner's
 * browser has no authenticated socket and no row-level read path, so
 * `postgres_changes` is not available to it by construction. Bolting realtime
 * on would mean handing the browser a Supabase credential and opening RLS on
 * the agreement register — a materially larger attack surface than the problem
 * justifies.
 *
 * ## What this is instead
 *
 * The expensive thing about polling is the payload, not the request. So the
 * portals poll a **stamp**: four scalars describing what the viewer can see.
 * Re-fetching the real payloads happens only when the stamp actually moves.
 * That keeps a steady-state poll to one indexed count per interval, and makes
 * "did anything change" a question the client can ask constantly and cheaply.
 *
 * Paired with a refetch on tab focus (in `useAgreementSync`), it closes the
 * exact scenario above: switching to the portal tab syncs immediately, and
 * sitting on the page picks the change up on the next tick.
 */

export interface AgreementSyncStamp {
  /** Agreements visible to this viewer. Catches an arrival or a disappearance. */
  count: number;
  /** The latest `updated_at` across them. Catches any field or status change. */
  latest: string | null;
  /** Open change requests. Catches a partner raising one, or an issuer answering. */
  openRequests: number;
  /** How many need THIS viewer to act — drives the badge without a full fetch. */
  attention: number;
}

export const EMPTY_SYNC_STAMP: AgreementSyncStamp = {
  count: 0, latest: null, openRequests: 0, attention: 0,
};

/**
 * One comparable string.
 *
 * Deliberately not a hash: this is compared, logged and eyeballed during
 * support, and four readable scalars are worth more than an opaque digest that
 * hides which of them moved.
 */
export function stampKey(stamp: AgreementSyncStamp | null | undefined): string {
  if (!stamp) return 'none';
  return `${stamp.count}:${stamp.latest ?? '-'}:${stamp.openRequests}:${stamp.attention}`;
}

/**
 * Has anything the viewer can see changed?
 *
 * A null previous stamp is NOT a change: it is the first poll, and treating it
 * as one would make every mount refetch everything it has just fetched.
 */
export function stampsDiffer(
  previous: AgreementSyncStamp | null | undefined,
  next: AgreementSyncStamp | null | undefined,
): boolean {
  if (!previous || !next) return false;
  return stampKey(previous) !== stampKey(next);
}

/**
 * Statuses that mean the counterparty is waiting on the viewer.
 *
 * Kept separate per side because "needs attention" is not symmetric: an
 * agreement in `partner_review` is the partner's move and the issuer's wait,
 * and `changes_requested` is the exact reverse.
 */
export const PARTNER_ATTENTION_STATUSES: readonly string[] = [
  'partner_review', 'sent_for_signature',
];

export const ISSUER_ATTENTION_STATUSES: readonly string[] = [
  'changes_requested', 'pending_review', 'approved_for_issue', 'partially_signed',
];

/**
 * How often to ask, in milliseconds.
 *
 * Twenty seconds is the compromise: fast enough that a person switching tabs
 * mid-conversation sees the change land on its own, slow enough that a partner
 * leaving the portal open all day costs three cheap queries a minute. The
 * focus/visibility listener is what makes the interval itself uncritical —
 * anybody actually looking gets a sync the moment they look.
 */
export const AGREEMENT_SYNC_INTERVAL_MS = 20_000;
