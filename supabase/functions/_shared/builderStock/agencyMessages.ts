/**
 * The read behind a property page's conversation with its builder.
 *
 * The connection is the one `builder_network_post_message` would write over:
 * the builder's ACTIVE connection carrying `stock:publish`, newest first — so
 * the page reads exactly the conversation a send would write into. It is
 * open while this workspace holds a live activation of the property; a
 * withdrawn one leaves the history readable and the conversation closed.
 */
import {
  projectConversationMessages,
  type ConversationMessageView,
} from './agencyMessages.pure.ts';

// deno-lint-ignore no-explicit-any
type Client = any;

/**
 * Why a conversation is closed, so the page names the next step rather than
 * guessing it: an activated property whose ROUTE is paused must not be told
 * to activate. Null while it is open.
 */
export type ConversationClosedReason = 'not_connected' | 'connection_paused' | 'not_activated' | 'delisted';

export type BuilderConversationRead =
  | {
    ok: true; conversation_id: string | null; open: boolean;
    closed_reason: ConversationClosedReason | null; messages: ConversationMessageView[];
  }
  | { ok: false };

export async function readBuilderConversation(
  supabase: Client,
  args: { stockItemId: string; organisationId: string; viewerUserId: string },
): Promise<BuilderConversationRead> {
  const { data: connection, error: connectionError } = await supabase
    .from('builder_network_connections')
    .select('id, scopes, identity_mismatch_since')
    .eq('builder_organisation_id', args.organisationId)
    .eq('state', 'active')
    .order('accepted_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (connectionError) return { ok: false };
  if (!connection) return { ok: true, conversation_id: null, open: false, closed_reason: 'not_connected', messages: [] };

  const [{ data: selection, error: selectionError }, { data: conversation, error: conversationError }] =
    await Promise.all([
      supabase.from('builder_stock_selections').select('id')
        .eq('stock_item_id', args.stockItemId).eq('organisation_id', args.organisationId)
        .neq('status', 'withdrawn').limit(1).maybeSingle(),
      supabase.from('builder_network_conversations').select('id')
        .eq('connection_id', connection.id).eq('stock_item_id', args.stockItemId).maybeSingle(),
    ]);
  if (selectionError || conversationError) return { ok: false };
  // History is read whatever the connection's write grant; open is whether a
  // new message could be written now — the writer's own three conditions.
  const route = connection as { scopes?: string[] | null; identity_mismatch_since?: string | null };
  const paused = !(route.scopes ?? []).includes('stock:publish') || !!route.identity_mismatch_since;
  const open = !!selection && !paused;
  // No live activation outranks a paused route: restoring the route alone
  // would not open it, so the activation is the step to name.
  const closed_reason: ConversationClosedReason | null = open ? null
    : !selection ? 'not_activated' : 'connection_paused';
  if (!conversation) return { ok: true, conversation_id: null, open, closed_reason, messages: [] };

  const { data: messages, error: messagesError } = await supabase
    .from('builder_network_messages')
    .select('id, side, sender_user_id, sender_display_name, body, sent_at, delivery_state, delivered_at, failure_reason')
    .eq('conversation_id', conversation.id)
    // The NEWEST page: a thread past the cap must keep showing what was just
    // written. The projection puts it back in reading order.
    .order('sent_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);
  if (messagesError) return { ok: false };

  return {
    ok: true,
    conversation_id: String(conversation.id),
    open,
    closed_reason,
    messages: projectConversationMessages((messages ?? []) as Record<string, unknown>[], args.viewerUserId),
  };
}
