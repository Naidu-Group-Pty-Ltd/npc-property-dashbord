import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders, createClearSolicitorSessionCookie } from "../_shared/auth.ts"
import { csrfDenied, enforceCsrf } from "../_shared/csrfGuard.ts"
import { extractSolicitorSessionToken } from "../_shared/solicitorSessionToken.ts"

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  const responseHeaders = () => ({
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Set-Cookie': createClearSolicitorSessionCookie(),
  });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Allow': 'POST' },
    })
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let body: Record<string, unknown> | undefined;
    try { body = await req.json(); } catch { /* ignore */ }

    const sessionToken = extractSolicitorSessionToken(req.headers, body);

    if (sessionToken) {
      const { data: user } = await supabase
        .from('solicitor_portal_users')
        .select('id, firm_id')
        .eq('session_token', sessionToken)
        .maybeSingle()

      if (user) {
        await supabase
          .from('solicitor_portal_users')
          .update({ session_token: null, session_expires_at: null })
          .eq('id', user.id)

        await supabase.from('solicitor_portal_activity_log').insert({
          solicitor_user_id: user.id,
          firm_id: user.firm_id,
          actor_user_id: user.id,
          actor_type: 'solicitor_user',
          action: 'logout',
          entity_type: 'session',
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: responseHeaders() })
  } catch (error: any) {
    console.error('Solicitor portal logout error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: responseHeaders() })
  }
})
