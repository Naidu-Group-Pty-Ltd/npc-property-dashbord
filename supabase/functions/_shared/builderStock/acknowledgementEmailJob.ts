/**
 * The email that tells the activating Command Centre user their builder
 * acknowledged the activation (docs/builder-portal/52). Queued ONCE, by the
 * acknowledgement step, carrying only which activation it is about; the rest
 * is read here, at send time, and nothing about the client is read at all.
 *
 * Exactly once is the ledger's job, and the ledger is written FIRST: the job
 * claims `email_sent_at` before sending, so a failed claim throws with
 * nothing sent (the outbox retries), a claim somebody else holds sends
 * nothing, and a send that fails releases the claim and throws so the retry
 * can send it. Stamping after the send instead would make a failed stamp
 * either silent (the ledger says unsent) or a second email on retry.
 *
 * `send` is the existing portal email helper, injected so the rule can be
 * tested without a mail service.
 */
import { acknowledgementEmail, userDisplayName } from './privateConversations.pure.ts';

type Db = any;
type Send = (input: {
  to: string; clientFirstName: string; title: string; message: string;
  type: 'success'; category: 'property'; actionUrl: string;
}) => Promise<{ success: boolean; error?: unknown }>;

export async function sendActivationAcknowledgedEmail(db: Db, event: { payload?: { selection_id?: unknown } }, send: Send) {
  const selectionId = String(event.payload?.selection_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(selectionId)) return;
  const { data: notice, error: noticeError } = await db.from('builder_network_acknowledgement_notices')
    .select('email_sent_at, outcome').eq('selection_id', selectionId).maybeSingle();
  if (noticeError) throw new Error('acknowledgement_notice_unreadable');
  if (!notice || notice.outcome !== 'notified' || notice.email_sent_at) return;
  const { data: selection, error: selectionError } = await db.from('builder_stock_selections')
    .select('selected_by_user_id, stock_item_id, organisation_id, acknowledged_by_display_name')
    .eq('id', selectionId).maybeSingle();
  if (selectionError) throw new Error('activation_unreadable');
  if (!selection) return;
  const [{ data: user, error: userError }, { data: item, error: itemError }, { data: org, error: orgError }] = await Promise.all([
    db.from('custom_users').select('email, first_name, last_name, username, is_active, deleted_at')
      .eq('id', selection.selected_by_user_id).maybeSingle(),
    db.from('builder_network_stock_items').select('address_line, lot_number').eq('id', selection.stock_item_id).maybeSingle(),
    db.from('builder_network_stock_organisations').select('legal_name, trading_name').eq('id', selection.organisation_id).maybeSingle(),
  ]);
  // A read that failed is not an absent user or a nameless builder: throw, and
  // the outbox's backoff asks again rather than marking the job done.
  if (userError || itemError || orgError) throw new Error('acknowledgement_email_facts_unreadable');
  if (!user || !user.is_active || user.deleted_at || !user.email) return;
  const email = acknowledgementEmail({
    builderName: (typeof org?.trading_name === 'string' && org.trading_name.trim()) || org?.legal_name || 'The builder',
    address: item?.address_line ?? '',
    lotNumber: item?.lot_number ?? null,
    acknowledgedBy: selection.acknowledged_by_display_name ?? null,
    link: null,
  });

  // Claim the send before making it.
  const { data: claimed, error: claimError } = await db.from('builder_network_acknowledgement_notices')
    .update({ email_sent_at: new Date().toISOString() })
    .eq('selection_id', selectionId).is('email_sent_at', null)
    .select('selection_id');
  if (claimError) throw new Error('acknowledgement_email_claim_failed');
  if (!Array.isArray(claimed) || claimed.length === 0) return;

  const sent = await send({
    to: String(user.email),
    clientFirstName: (typeof user.first_name === 'string' && user.first_name.trim()) || userDisplayName(user) || 'there',
    title: email.title,
    message: email.html,
    type: 'success',
    category: 'property',
    actionUrl: '/admin/builder-portal/activated',
  });
  if (!sent.success) {
    const { error: releaseError } = await db.from('builder_network_acknowledgement_notices')
      .update({ email_sent_at: null }).eq('selection_id', selectionId);
    if (releaseError) throw new Error('acknowledgement_email_not_sent_and_claim_not_released');
    throw new Error(`acknowledgement_email_not_sent:${String(sent.error ?? 'unknown').slice(0, 80)}`);
  }
}
