/**
 * THE BUILDER CONVERSATION — WHAT A COMMAND CENTRE USER IS SHOWN.
 *
 * The rows are written by `builder_network_post_message` and by the message
 * sweep (`20261221120000_an_agency_and_a_builder_talk_over_the_network.sql`).
 * This decides what reaches a browser: the sender's display name and side,
 * the body, when it was written, and — for what the Command Centre sent — its
 * delivery state. Never a user id and never the client's idempotency key.
 *
 * Order is the writing side's server clock, then the id: the same order the
 * Builder Portal draws, so both ends read one conversation the same way.
 *
 * Pure: no IO.
 */

export type ConversationSide = 'command_centre' | 'builder';
export type DeliveryState = 'queued' | 'delivered' | 'failed';

export interface ConversationMessageView {
  id: string;
  side: ConversationSide;
  sender_display_name: string;
  body: string;
  sent_at: string;
  /** Only for what the Command Centre sent; the builder's messages carry none. */
  delivery_state: DeliveryState | null;
  delivered_at: string | null;
  failure_reason: string | null;
  mine: boolean;
  can_retry: boolean;
}

type Row = Record<string, unknown>;

export function projectConversationMessages(rows: readonly Row[], viewerUserId: string): ConversationMessageView[] {
  return rows
    .map((row) => {
      const side: ConversationSide = row.side === 'command_centre' ? 'command_centre' : 'builder';
      const ours = side === 'command_centre';
      const mine = ours && row.sender_user_id === viewerUserId;
      const state = ours ? (row.delivery_state as DeliveryState | null) ?? null : null;
      return {
        id: String(row.id),
        side,
        sender_display_name: String(row.sender_display_name ?? ''),
        body: String(row.body ?? ''),
        sent_at: String(row.sent_at),
        delivery_state: state,
        delivered_at: ours ? (row.delivered_at as string | null) ?? null : null,
        failure_reason: ours ? (row.failure_reason as string | null) ?? null : null,
        mine,
        can_retry: mine && state === 'failed',
      } satisfies ConversationMessageView;
    })
    .sort((a, b) => (a.sent_at === b.sent_at ? (a.id < b.id ? -1 : 1) : (a.sent_at < b.sent_at ? -1 : 1)));
}

/** A refusal raised by the SQL, as the browser is told it — or null for a fault of ours. */
export function agencyMessageRefusal(message: string): { status: number; code: string; error: string } | null {
  const table: Array<[string, number, string, string]> = [
    ['AGENCY_CONVERSATION_NOT_FOUND', 404, 'not_found', 'This property has no builder connection to message.'],
    ['AGENCY_CONVERSATION_NOT_OPEN', 409, 'conversation_not_open', 'Activate this property before messaging its builder.'],
    ['AGENCY_MESSAGE_INVALID', 400, 'invalid_message', 'A message needs between 1 and 4,000 characters.'],
    ['AGENCY_MESSAGE_NOT_RETRYABLE', 409, 'not_retryable', 'Only a message you sent that was not delivered can be sent again.'],
    ['AGENCY_SENDER_NOT_A_MEMBER', 403, 'not_a_member', 'Your account cannot send messages.'],
    ['AGENCY_MESSAGE_ID_REUSED', 409, 'message_id_reused', 'That message was already sent to a different conversation.'],
    ['AGENCY_NETWORK_DISABLED', 409, 'network_disabled', 'The builder network is switched off for this workspace.'],
    ['AGENCY_CONNECTION_HALTED', 409, 'connection_halted', 'Messages to this builder are paused while the connection is checked. Try again later.'],
  ];
  for (const [raw, status, code, error] of table) {
    if (message.includes(raw)) return { status, code, error };
  }
  return null;
}

/**
 * Whether the worker must HOLD an outbound agency message rather than send it:
 * the connection's builder identity is disputed, or the builder withdrew
 * stock:publish. The same rule the database applies to pending rows, asked
 * again at the moment of sending, because a row claimed before the hold began
 * is already in the worker's hands. Nothing else is this rule's to hold.
 */
export function agencyMessageRouteHeld(
  connection: { identity_mismatch_since?: string | null; scopes?: readonly string[] | null },
  eventType: string,
): boolean {
  if (!eventType.startsWith('agency.message.')) return false;
  return !!connection.identity_mismatch_since || !(connection.scopes ?? []).includes('stock:publish');
}
