/**
 * Finance Portal — Bulk Actions across Purchase Files.
 * Operations: bulk_snooze, bulk_reassign, bulk_archive, bulk_send_message, bulk_request_doc
 *
 * Each action loops the supplied file_ids, verifying ownership/assignment for the
 * caller before performing the action. Returns a per-file outcome summary.
 */
import { extractFinanceToken, makeServiceClient, resolveFinancePartner } from '../_shared/finance-portal-session.ts';
import { parseNaturalDate } from '../_shared/parse-natural-date.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = makeServiceClient();
    const body = await req.json().catch(() => ({}));
    const token = extractFinanceToken(req.headers, body);
    const auth = await resolveFinancePartner(supabase, token);
    if (auth.error) return json({ error: auth.error }, auth.status);
    const portalUser = auth.portalUser!;

    const { operation } = body;
    const fileIds: string[] = Array.isArray(body.file_ids) ? body.file_ids.filter(Boolean).slice(0, 100) : [];
    if (!fileIds.length) return json({ error: 'file_ids required' }, 400);

    // Fetch files + verify caller is assigned partner for each (mine or watching)
    const { data: files } = await supabase
      .from('purchase_files')
      .select('id, client_id, title, assigned_finance_user_id')
      .in('id', fileIds);
    const accessible = (files || []).filter(f => f.assigned_finance_user_id === portalUser.id);
    const accessibleIds = accessible.map(f => f.id);
    const skipped = fileIds.filter(id => !accessibleIds.includes(id));

    const results: any[] = [];

    if (operation === 'bulk_snooze') {
      const raw = (body.raw_input || '').toString();
      const until = body.snooze_until ? new Date(body.snooze_until) : parseNaturalDate(raw);
      if (!until || isNaN(until.getTime())) {
        return json({ error: "Could not parse snooze time — try 'tomorrow 9am'" }, 400);
      }
      for (const f of accessible) {
        const { error } = await supabase.from('finance_partner_snoozes').insert({
          finance_contact_id: portalUser.id,
          purchase_file_id: f.id,
          scope: 'purchase_file',
          snooze_until: until.toISOString(),
          reason: body.reason || null,
          raw_input: raw || null,
        });
        results.push({ id: f.id, ok: !error, error: error?.message });
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    if (operation === 'bulk_archive') {
      for (const f of accessible) {
        const { error } = await supabase.from('purchase_files')
          .update({ archived_at: new Date().toISOString(), status: 'cancelled' })
          .eq('id', f.id);
        results.push({ id: f.id, ok: !error, error: error?.message });
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    if (operation === 'bulk_reassign') {
      const newOwnerId = body.new_owner_finance_user_id;
      if (!newOwnerId) return json({ error: 'new_owner_finance_user_id required' }, 400);
      for (const f of accessible) {
        const { error } = await supabase.from('purchase_files')
          .update({ assigned_finance_user_id: newOwnerId })
          .eq('id', f.id);
        results.push({ id: f.id, ok: !error, error: error?.message });
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    if (operation === 'bulk_send_message') {
      const messageBody = (body.body || '').toString().trim().slice(0, 5000);
      if (!messageBody) return json({ error: 'body required' }, 400);
      // Group by client_id to find/create threads
      for (const f of accessible) {
        try {
          let { data: thread } = await supabase
            .from('finance_portal_threads')
            .select('id')
            .eq('client_id', f.client_id)
            .eq('finance_user_id', portalUser.id)
            .eq('thread_type', 'command_finance')
            .maybeSingle();
          if (!thread) {
            const { data: created } = await supabase
              .from('finance_portal_threads')
              .insert({
                client_id: f.client_id,
                finance_user_id: portalUser.id,
                visibility_scope: 'command_finance_private',
                thread_type: 'command_finance',
                allocation_status: 'none',
                finance_allocated: false,
                permission_status: { command_centre: 'full', finance_portal: 'granted', client_portal: 'blocked' },
              })
              .select('id').single();
            thread = created;
          }
          if (!thread) { results.push({ id: f.id, ok: false, error: 'thread create failed' }); continue; }
          const { error } = await supabase.from('finance_portal_messages').insert({
            thread_id: thread.id,
            client_id: f.client_id,
            finance_user_id: portalUser.id,
            sender_type: 'partner',
            sender_name: portalUser.full_name || portalUser.email,
            body: messageBody,
            visibility_scope: 'command_finance_private',
            thread_type: 'command_finance',
            allocation_status: 'none',
            permission_status: { command_centre: 'full', finance_portal: 'granted', client_portal: 'blocked' },
          });
          results.push({ id: f.id, ok: !error, error: error?.message });
        } catch (e: any) {
          results.push({ id: f.id, ok: false, error: e.message });
        }
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    if (operation === 'bulk_request_doc') {
      const title = (body.title || '').toString().trim().slice(0, 200);
      const description = (body.description || '').toString().slice(0, 2000);
      if (!title) return json({ error: 'title required' }, 400);
      for (const f of accessible) {
        const { error } = await supabase.from('document_requirement_instances').insert({
          purchase_file_id: f.id,
          client_id: f.client_id,
          label: title,
          description: description || null,
          request_message: description || null,
          status: 'requested',
          owner: 'client',
          category: 'other',
          is_required: true,
          requested_by_finance_user_id: portalUser.id,
          requested_at: new Date().toISOString(),
          created_by_finance_user_id: portalUser.id,
        });
        results.push({ id: f.id, ok: !error, error: error?.message });
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    console.error('[finance-portal-bulk-actions] error', e);
    return json({ error: e.message || 'Internal error' }, 500);
  }
});
