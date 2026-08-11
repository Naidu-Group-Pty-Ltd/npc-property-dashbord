import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';

/**
 * GHL Conversations Cron Sync
 * 
 * Fallback sync job that runs periodically to catch any messages
 * missed by the webhook. Invokes sync-ghl-conversations for each
 * client that has a GHL contact ID, prioritizing those with the
 * oldest last_synced_at timestamps.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const apiKey = _ghlCreds.apiKey;
    const locationId = _ghlCreds.locationId;
    console.log(`[ghl-conversations-cron] Using GHL account: ${_ghlCreds.label}`);

    if (!apiKey || !locationId) {
      console.log('[ghl-conversations-cron] GHL not configured, skipping');
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'GHL not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all clients with GHL contact IDs, ordered by least recently synced
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, ghl_contact_id')
      .not('ghl_contact_id', 'is', null)
      .order('updated_at', { ascending: true });

    if (clientsError) {
      throw new Error(`Failed to fetch clients: ${clientsError.message}`);
    }

    if (!clients || clients.length === 0) {
      console.log('[ghl-conversations-cron] No clients with GHL contact IDs');
      return new Response(JSON.stringify({ success: true, clients_processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine how many to sync this run (limit to avoid timeouts)
    const maxClientsPerRun = 20;
    const batchSize = Math.min(clients.length, maxClientsPerRun);
    
    // Find clients whose conversations are stale (never synced or synced > 30 min ago)
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    const { data: recentlySynced } = await supabase
      .from('ghl_conversations')
      .select('ghl_contact_id, last_synced_at')
      .gt('last_synced_at', staleThreshold)
      .not('ghl_contact_id', 'is', null);

    const recentContactIds = new Set((recentlySynced || []).map((r: any) => r.ghl_contact_id));
    
    // Prioritize stale clients
    const staleClients = clients.filter((c: any) => !recentContactIds.has(c.ghl_contact_id));
    const freshClients = clients.filter((c: any) => recentContactIds.has(c.ghl_contact_id));
    const orderedClients = [...staleClients, ...freshClients].slice(0, batchSize);

    console.log(`[ghl-conversations-cron] Processing ${orderedClients.length}/${clients.length} clients (${staleClients.length} stale)`);

    let totalConversations = 0;
    let totalMessages = 0;
    let errors: Array<{ clientId: string; error: string }> = [];
    let processed = 0;

    // Call the sync function for each client via internal HTTP call
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    
    for (const client of orderedClients) {
      // Check if we're approaching timeout (leave 30s buffer)
      if (Date.now() - startTime > 250000) {
        console.log(`[ghl-conversations-cron] Approaching timeout, stopping after ${processed} clients`);
        break;
      }

      try {
        const syncUrl = `${supabaseUrl}/functions/v1/sync-ghl-conversations`;
        const internalEdgeSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
        const syncRes = await fetch(syncUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // AUTH-002: internal secret, not the service-role key.
            'Authorization': `Bearer ${anonKey}`,
            'apikey': anonKey,
            ...(internalEdgeSecret ? { 'x-internal-edge-secret': internalEdgeSecret } : {}),
          },
          body: JSON.stringify({
            client_id: client.id,
            mode: 'incremental',
          }),
        });

        if (syncRes.ok) {
          const result = await syncRes.json();
          totalConversations += result.conversations_synced || 0;
          totalMessages += result.messages_synced || 0;
          processed++;
        } else {
          const errText = await syncRes.text();
          console.error(`[ghl-conversations-cron] Sync failed for ${client.id}: ${syncRes.status} ${errText}`);
          errors.push({ clientId: client.id, error: `HTTP ${syncRes.status}` });
        }
      } catch (err: any) {
        console.error(`[ghl-conversations-cron] Exception for ${client.id}:`, err.message);
        errors.push({ clientId: client.id, error: err.message });
      }

      // Rate limit: 1s between client syncs
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[ghl-conversations-cron] Complete in ${elapsed}s: ${processed} clients, ${totalConversations} convos, ${totalMessages} msgs`);

    return new Response(JSON.stringify({
      success: true,
      clients_total: clients.length,
      clients_processed: processed,
      stale_clients: staleClients.length,
      conversations_synced: totalConversations,
      messages_synced: totalMessages,
      elapsed_seconds: elapsed,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[ghl-conversations-cron] Error:', error);
    return new Response(JSON.stringify({ ...internalError(error, 'ghl-conversations-cron'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
