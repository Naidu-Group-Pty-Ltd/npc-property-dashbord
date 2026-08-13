/**
 * Hand a newly-activated finance partner whatever was issued to them before
 * they had a login.
 *
 * ## The hole this fills
 *
 * A portal notification is a row keyed to `portal_user_id`. When an agreement
 * was issued to a partner who had no portal user, `notifyPartner` found nothing
 * to address and returned — silently, deliberately, so that notification
 * delivery could never break a lifecycle action. Correct as far as it went, and
 * it meant the notification was gone for ever: the partner activated their
 * account days later and arrived at an empty inbox with a live agreement
 * sitting in their list, unannounced.
 *
 * Letting an agreement be issued to a partner who cannot sign in yet — which is
 * the point of `partnerAccess.pure.ts` — turns that from an edge case into the
 * normal path. So activation has to look back.
 *
 * ## Why a sweep rather than a queue
 *
 * The agreements are already the queue. They carry `finance_agent_contact_id`,
 * `issued_at` and a partner-visible status; that is a complete description of
 * "what is waiting for this organisation", and it stays true if a notification
 * insert fails, if a row is voided before anybody sees it, or if the partner is
 * invited, revoked and re-invited. A separate outbox table would be a second
 * copy of that truth, free to disagree with it.
 *
 * The sweep is therefore idempotent by construction: it asks which agreements
 * are waiting, subtracts the ones this user has already been told about, and
 * inserts the difference. Running it twice does nothing the second time, which
 * matters because it runs on two paths that can both fire for one partner.
 */

import {
  PARTNER_VISIBLE_STATUSES,
  agreementTemplate,
  templateKeyForDirection,
} from './index.pure.ts';

/**
 * How many waiting agreements a single activation will announce.
 *
 * Realistically one or two. The cap exists so a partner who was issued a long
 * tail of superseded-then-reissued paperwork does not meet forty unread rows on
 * their first morning; the agreements themselves are all still in their list,
 * which is where a complete history belongs.
 */
const MAX_ANNOUNCED = 10;

export interface PendingDeliveryResult {
  /** Notifications actually inserted by this call. */
  delivered: number;
  /** Agreements found waiting, whether or not they needed announcing. */
  waiting: number;
}

/**
 * Announce every issued agreement this partner has never been told about.
 *
 * Best-effort in the same sense as `notifyPartner`: activation, login and
 * invitation acceptance must all succeed even if this fails entirely. A partner
 * who reaches the portal with no notification still sees the agreement in their
 * list — a missing announcement is a worse first impression, not a lost
 * document.
 */
export async function deliverPendingAgreementNotifications(
  supabase: any,
  args: { portalUserId: string; financeContactId: string },
): Promise<PendingDeliveryResult> {
  const empty: PendingDeliveryResult = { delivered: 0, waiting: 0 };
  try {
    if (!args.portalUserId || !args.financeContactId) return empty;

    // What is waiting: exactly the query the partner's own agreement list runs.
    const { data: agreements, error } = await supabase
      .from('partner_agreements')
      .select('id, direction, status, issued_at, issued_version_id')
      .eq('finance_agent_contact_id', args.financeContactId)
      .in('status', PARTNER_VISIBLE_STATUSES as unknown as string[])
      .not('issued_at', 'is', null)
      .order('issued_at', { ascending: false })
      .limit(MAX_ANNOUNCED);
    if (error) {
      console.error('[agreements] pending delivery lookup failed:', error.message);
      return empty;
    }
    const waiting = agreements ?? [];
    if (waiting.length === 0) return empty;

    // Subtract what this user has already been told. One query for the set
    // rather than one per agreement: this runs inside a login.
    const { data: told } = await supabase
      .from('finance_portal_notifications')
      .select('metadata')
      .eq('portal_user_id', args.portalUserId)
      .in('notification_type', ['agreement_issued', 'agreement_reissued', 'agreement_awaiting_you']);
    const announced = new Set(
      (told ?? [])
        .map((row: { metadata?: Record<string, unknown> | null }) =>
          row.metadata && typeof row.metadata.agreement_id === 'string' ? row.metadata.agreement_id : null)
        .filter(Boolean) as string[],
    );

    const rows = waiting
      .filter((agreement: { id: string }) => !announced.has(agreement.id))
      .map((agreement: { id: string; direction: string }) => {
        const title = agreementTemplate(templateKeyForDirection(agreement.direction as never)).title;
        return {
          portal_user_id: args.portalUserId,
          client_id: null,
          // Its own type: this is not the moment of issue, it is the moment the
          // partner became able to receive it, and a timeline that says
          // "issued" today about a document issued last week is a small lie
          // with compliance consequences.
          notification_type: 'agreement_awaiting_you',
          title: 'Agreement ready for your review',
          body: `${title} was issued to your organisation and is waiting for you.`,
          link_path: `/finance/agreements/${agreement.id}`,
          metadata: {
            agreement_id: agreement.id,
            origin_portal: 'command_center',
            delivered_on_activation: true,
          },
        };
      });

    if (rows.length === 0) return { delivered: 0, waiting: waiting.length };

    const { error: insertError } = await supabase
      .from('finance_portal_notifications').insert(rows);
    if (insertError) {
      console.error('[agreements] pending delivery insert failed:', insertError.message);
      return { delivered: 0, waiting: waiting.length };
    }
    return { delivered: rows.length, waiting: waiting.length };
  } catch (e) {
    console.error('[agreements] pending delivery failed:', e instanceof Error ? e.message : e);
    return empty;
  }
}
