import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { extractSessionToken, createCorsHeaders, createClearSessionCookie } from "../_shared/auth.ts"
import { hashSessionToken, isSessionHashConfigured } from "../_shared/sessionHash.ts"

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Try to get session token from body for backwards compatibility
    let sessionToken: string | null = null;
    try {
      const body = await req.json();
      sessionToken = extractSessionToken(req.headers, body);
    } catch {
      // If body parsing fails, try to extract from headers/cookies only
      sessionToken = extractSessionToken(req.headers);
    }

    if (!sessionToken) {
      // Still return success and clear cookie even if no token found
      return new Response(
        JSON.stringify({ success: true }), 
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Set-Cookie': createClearSessionCookie()
          } 
        }
      )
    }

    // Revoke the session. Match on the peppered hash first (hash-only sessions
    // have no plaintext at rest) and the legacy plaintext column as a fallback,
    // so logout revokes regardless of which representation the row carries.
    const hash = isSessionHashConfigured() ? await hashSessionToken(sessionToken) : null;
    const deletionErrors = [];
    if (hash) {
      const { error } = await supabase
        .from('user_sessions')
        .delete()
        .eq('token_hash', hash);
      if (error) deletionErrors.push(error);
    }

    const { error: plaintextDeletionError } = await supabase
      .from('user_sessions')
      .delete()
      .eq('session_token', sessionToken);
    if (plaintextDeletionError) deletionErrors.push(plaintextDeletionError);

    if (deletionErrors.length > 0) {
      console.error('Logout error:', deletionErrors)
      // Still clear cookie even if database delete fails
    }

    // Clear the HttpOnly session cookie
    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Set-Cookie': createClearSessionCookie()
        } 
      }
    )

  } catch (error) {
    console.error('Logout error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Set-Cookie': createClearSessionCookie()
        } 
      }
    )
  }
})
