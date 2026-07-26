/**
 * Finance Portal Notifications — list/mark read for the authenticated portal user.
 * Operations: list, mark_read, mark_all_read, unread_count
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractToken(headers: Headers, body?: any): string | null {
  return headers.get('x-finance-session-token')
    || body?.finance_session_token
    || headers.get('x-session-token')
    || body?.session_token
    || null;
}

/** Apply the authoritative portal boundary to retrieval and read mutations. */
function authorisedFinanceRoute(query: any) {
  return query
    .eq('target_portal', 'finance_portal')
    .eq('notification_domain', 'finance')
    .eq('command_centre_authorised', true);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const sessionToken = extractToken(req.headers, body);
    if (!sessionToken) return jsonResponse({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, is_active, revoked_at, session_expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return jsonResponse({ error: 'Session expired' }, 401);
    }

    const { operation } = body;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);

    switch (operation) {
      case 'list': {
        const limit = Math.min(Number(body.limit) || 50, 200);
        const onlyUnread = !!body.only_unread;
        let q = authorisedFinanceRoute(supabase
          .from('finance_portal_notifications')
          .select('*, clients:client_id(id, primary_first_name, primary_surname)')
          .eq('portal_user_id', portalUser.id))
          .order('created_at', { ascending: false })
          .limit(limit);
        if (onlyUnread) q = q.eq('is_read', false);
        const { data, error } = await q;
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ notifications: data || [] });
      }

      case 'unread_count': {
        const { count, error } = await authorisedFinanceRoute(supabase
          .from('finance_portal_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('portal_user_id', portalUser.id))
          .eq('is_read', false);
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ count: count || 0 });
      }

      case 'mark_read': {
        if (!body.notification_id) return jsonResponse({ error: 'notification_id required' }, 400);
        const { error } = await authorisedFinanceRoute(supabase
          .from('finance_portal_notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('id', body.notification_id)
          .eq('portal_user_id', portalUser.id));
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ success: true });
      }

      case 'mark_all_read': {
        const { error } = await authorisedFinanceRoute(supabase
          .from('finance_portal_notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('portal_user_id', portalUser.id)
          .eq('is_read', false));
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ success: true });
      }

      default:
        return jsonResponse({ error: `Unknown operation: ${operation}` }, 400);
    }
  } catch (err: any) {
    console.error('finance-portal-notifications error', err);
    return jsonResponse({ error: err.message || 'Server error' }, 500);
  }
});
