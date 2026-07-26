import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseGhlDate(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'number' || /^\d{10,13}$/.test(String(val))) {
    const num = Number(val);
    const ms = num > 1e12 ? num : num * 1000;
    return new Date(ms).toISOString();
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function mapChannelType(ghlType: string | number | undefined): string {
  if (!ghlType) return 'sms';
  const typeStr = String(ghlType).toLowerCase();
  const mapping: Record<string, string> = {
    'sms': 'sms', '1': 'sms', 'phone': 'sms', 'type_phone': 'sms',
    'email': 'email', '2': 'email', 'type_email': 'email',
    'whatsapp': 'whatsapp', '3': 'whatsapp', 'type_whatsapp': 'whatsapp',
    'fb': 'facebook', 'facebook': 'facebook', '4': 'facebook', 'type_facebook': 'facebook',
    'ig': 'instagram', 'instagram': 'instagram', '5': 'instagram', 'type_instagram': 'instagram',
    'live_chat': 'live_chat', 'livechat': 'live_chat', '6': 'live_chat', 'type_live_chat': 'live_chat',
    'google_my_business': 'gmb', 'gmb': 'gmb', '7': 'gmb',
    'custom': 'custom', 'activity': 'activity',
  };
  return mapping[typeStr] || typeStr;
}

function mapMessageDirection(msg: any): string {
  const dir = msg.direction;
  if (dir === 'inbound' || dir === 1 || dir === '1') return 'inbound';
  if (dir === 'outbound' || dir === 2 || dir === '2') return 'outbound';
  if (msg.incoming === true) return 'inbound';
  if (msg.incoming === false) return 'outbound';
  if (msg.userId) return 'outbound';
  return 'outbound';
}

function mapContentType(contentType: string | undefined): string {
  if (!contentType) return 'text';
  const ct = contentType.toLowerCase();
  if (ct.includes('image')) return 'image';
  if (ct.includes('video')) return 'video';
  if (ct.includes('audio')) return 'audio';
  if (ct.includes('document') || ct.includes('pdf') || ct.includes('file')) return 'document';
  return 'text';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const apiKey = Deno.env.get('GOHIGHLEVEL_API_KEY');
    const locationId = Deno.env.get('GOHIGHLEVEL_LOCATION_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!apiKey || !locationId) {
      return new Response(JSON.stringify({ error: 'GHL not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const batchSize = body.batchSize || 50;
    const offset = body.offset || 0;

    const ghlHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Accept': 'application/json',
    };

    // Get clients with GHL contact IDs
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, ghl_contact_id')
      .not('ghl_contact_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (clientsError) throw new Error(`Failed to fetch clients: ${clientsError.message}`);
    if (!clients || clients.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No more clients to process', offset }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[bulk-sync] Processing batch: offset=${offset}, count=${clients.length}`);

    let totalConversations = 0;
    let totalMessages = 0;
    let processed = 0;
    let errors: Array<{ clientId: string; error: string }> = [];

    for (const client of clients) {
      if (Date.now() - startTime > 240000) {
        console.log(`[bulk-sync] Timeout approaching after ${processed} clients`);
        break;
      }

      try {
        await delay(600);

        const searchParams = new URLSearchParams({
          locationId,
          contactId: client.ghl_contact_id,
        });

        const convRes = await fetch(`${GHL_API_BASE}/conversations/search?${searchParams}`, {
          method: 'GET', headers: ghlHeaders,
        });

        if (!convRes.ok) {
          const errText = await convRes.text();
          console.error(`[bulk-sync] Search failed for ${client.ghl_contact_id}: ${convRes.status}`);
          errors.push({ clientId: client.id, error: `Search: ${convRes.status}` });
          continue;
        }

        const convData = await convRes.json();
        const conversations = convData.conversations || [];

        for (const conv of conversations) {
          const ghlConvId = conv.id;
          const channelType = mapChannelType(conv.type);

          const { data: upsertedConv, error: convError } = await supabase
            .from('ghl_conversations')
            .upsert({
              ghl_conversation_id: ghlConvId,
              client_id: client.id,
              ghl_contact_id: client.ghl_contact_id,
              channel_type: channelType,
              last_message_body: conv.lastMessageBody || conv.snippet || null,
              last_message_date: parseGhlDate(conv.lastMessageDate || conv.dateUpdated),
              last_message_direction: conv.lastMessageDirection || (conv.lastMessageType === 1 ? 'inbound' : 'outbound'),
              unread_count: conv.unreadCount || 0,
              conversation_status: conv.starred ? 'starred' : (conv.deleted ? 'archived' : 'open'),
              assigned_to: conv.assignedTo || null,
              last_synced_at: new Date().toISOString(),
            }, { onConflict: 'ghl_conversation_id' })
            .select('id')
            .single();

          if (convError) {
            console.error(`[bulk-sync] Conv upsert failed:`, convError.message);
            errors.push({ clientId: client.id, error: `Conv: ${convError.message}` });
            continue;
          }

          totalConversations++;

          // Fetch all messages
          await delay(400);
          let lastMessageId: string | undefined;
          let hasMore = true;
          let page = 0;

          while (hasMore && page < 10) {
            page++;
            const params = new URLSearchParams({ limit: '50' });
            if (lastMessageId) params.set('lastMessageId', lastMessageId);

            const res = await fetch(
              `${GHL_API_BASE}/conversations/${ghlConvId}/messages?${params}`,
              { method: 'GET', headers: ghlHeaders }
            );

            if (!res.ok) {
              console.error(`[bulk-sync] Messages fetch failed for ${ghlConvId}: ${res.status}`);
              break;
            }

            const data = await res.json();
            let messages: any[] = [];
            if (data.messages?.messages && Array.isArray(data.messages.messages)) {
              messages = data.messages.messages;
              hasMore = data.messages.nextPage === true;
              lastMessageId = data.messages.lastMessageId || undefined;
            } else if (Array.isArray(data.messages)) {
              messages = data.messages;
            }

            if (messages.length === 0) { hasMore = false; break; }

            const messageRows = messages.map((msg: any) => ({
              conversation_id: upsertedConv.id,
              ghl_message_id: msg.id,
              direction: mapMessageDirection(msg),
              channel_type: mapChannelType(msg.messageType || msg.source),
              body: msg.body || msg.message || msg.text || null,
              content_type: mapContentType(msg.contentType),
              attachment_urls: msg.attachments?.map((a: any) => a.url).filter(Boolean) || null,
              sender_name: msg.contactName || msg.userName || null,
              sender_number: msg.contactId ? null : (msg.phone || msg.from || null),
              recipient_number: msg.phone || msg.to || null,
              message_status: msg.status || 'sent',
              ghl_date_added: parseGhlDate(msg.dateAdded || msg.createdAt),
            }));

            const { error: insertError } = await supabase
              .from('ghl_conversation_messages')
              .upsert(messageRows, { onConflict: 'ghl_message_id', ignoreDuplicates: false });

            if (insertError && insertError.code !== '23505') {
              console.error(`[bulk-sync] Messages upsert error:`, insertError.message);
              break;
            }

            totalMessages += messages.length;
            if (messages.length < 50) hasMore = false;
            await delay(300);
          }
        }

        processed++;
      } catch (err: any) {
        console.error(`[bulk-sync] Exception for ${client.id}:`, err.message);
        errors.push({ clientId: client.id, error: err.message });
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[bulk-sync] Done in ${elapsed}s: ${processed} clients, ${totalConversations} convos, ${totalMessages} msgs`);

    // Surface a Command Center notification so the sync isn't silent.
    try {
      const errorSuffix = errors.length > 0 ? ` (${errors.length} client${errors.length === 1 ? '' : 's'} had errors)` : '';
      const { error: notifyError } = await supabase
        .from('notifications')
        .insert({
          type: 'bulk_conversation_sync_completed',
          title: 'Conversation sync completed',
          message: `Synced ${totalConversations} conversation${totalConversations === 1 ? '' : 's'} and ${totalMessages} message${totalMessages === 1 ? '' : 's'} across ${processed} client${processed === 1 ? '' : 's'} in ${elapsed}s${errorSuffix}.`,
          read: false,
        });
      if (notifyError) console.error('[bulk-sync] Failed to insert completion notification:', notifyError.message);
    } catch (notifyErr: any) {
      console.error('[bulk-sync] Notification insert threw:', notifyErr?.message || notifyErr);
    }

    return new Response(JSON.stringify({
      success: true,
      offset,
      clients_in_batch: clients.length,
      clients_processed: processed,
      conversations_synced: totalConversations,
      messages_synced: totalMessages,
      next_offset: offset + clients.length,
      elapsed_seconds: elapsed,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[bulk-sync] Error:', error);
    return new Response(JSON.stringify({ error: error.message, success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
