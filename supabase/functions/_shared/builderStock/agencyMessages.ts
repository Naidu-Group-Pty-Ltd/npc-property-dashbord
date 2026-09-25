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

export type BuilderConversationRead =
  | { ok: true; conversation_id: string | null; open: boolean; messages: ConversationMessageView[] }
  | { ok: false };

export async function readBuilderConversation(
  supabase: Client,
  args: { stockItemId: string; organisationId: string; viewerUserId: string },
): Promise<BuilderConversationRead> {
  const { data: connection, error: connectionError } = await supabase
    .from('builder_network_connections')
    .select('id')
    .eq('builder_organisation_id', args.organisationId)
    .eq('state', 'active')
    .contains('scopes', ['stock:publish'])
    .order('accepted_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (connectionError) return { ok: false };
  if (!connection) return { ok: true, conversation_id: null, open: false, messages: [] };

  const [{ data: selection, error: selectionError }, { data: conversation, error: conversationError }] =
    await Promise.all([
      supabase.from('builder_stock_selections').select('id')
        .eq('stock_item_id', args.stockItemId).eq('organisation_id', args.organisationId)
        .neq('status', 'withdrawn').limit(1).maybeSingle(),
      supabase.from('builder_network_conversations').select('id')
        .eq('connection_id', connection.id).eq('stock_item_id', args.stockItemId).maybeSingle(),
    ]);
  if (selectionError || conversationError) return { ok: false };
  const open = !!selection;
  if (!conversation) return { ok: true, conversation_id: null, open, messages: [] };

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
    messages: projectConversationMessages((messages ?? []) as Record<string, unknown>[], args.viewerUserId),
  };
}
