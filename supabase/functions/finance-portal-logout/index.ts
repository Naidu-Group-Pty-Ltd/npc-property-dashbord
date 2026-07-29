import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders, createClearFinanceSessionCookie } from "../_shared/auth.ts"

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let sessionToken: string | null = null;
    try {
      const body = await req.json();
      sessionToken = body?.finance_session_token || body?.session_token;
    } catch { /* ignore */ }

    if (!sessionToken) {
      sessionToken = req.headers.get('x-finance-session-token') || req.headers.get('x-session-token');
    }

    if (sessionToken) {
      const { data: user } = await supabase
        .from('finance_portal_users')
        .select('id')
        .eq('session_token', sessionToken)
        .maybeSingle()

      if (user) {
        await supabase
          .from('finance_portal_users')
          .update({ session_token: null, session_expires_at: null })
          .eq('id', user.id)

        await supabase.from('finance_portal_activity_log').insert({
          finance_user_id: user.id,
          actor_user_id: user.id,
          actor_type: 'finance_user',
          action: 'logout',
          entity_type: 'session',
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createClearFinanceSessionCookie(),
        }
      }
    )
  } catch (error: any) {
    console.error('Finance portal logout error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createClearFinanceSessionCookie(),
        }
      }
    )
  }
})
