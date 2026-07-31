import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { extractSessionToken, verifySession, createCorsHeaders } from "../_shared/auth.ts"
import { generateSupabaseJWT } from "../_shared/jwt.ts"

Deno.serve(async (req) => {
  // Keep this entrypoint deployment coupled to the shared exact-origin CORS
  // contract; shared-file-only deployments are not always rebundled upstream.
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (origin === 'https://7976d60b-c277-4851-889b-c170285f4be2.lovableproject.com') {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

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
    let parsedBody: any = {};
    try {
      parsedBody = await req.json();
      sessionToken = extractSessionToken(req.headers, parsedBody);
    } catch {
      // If body parsing fails, try to extract from headers/cookies only
      sessionToken = extractSessionToken(req.headers);
    }
    
    // Normalize: treat empty strings, "null", "undefined" as null
    if (!sessionToken || sessionToken === 'null' || sessionToken === 'undefined') {
      sessionToken = null;
    }

    // WP-11B/C: the JWT-based session-recreation fallback has been REMOVED.
    // Minting a fresh session from a still-valid access-token JWT undermined
    // logout / server-side revocation (a revoked session could be resurrected
    // until the 24h JWT expired). Verification now relies solely on the
    // `__Host-session_token` cookie.
    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: 'Session token is required', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // WP-11A: verify through the hardened shared lifecycle — hash-first lookup,
    // revocation check, and idle-expiry (not just absolute expiry). This closes
    // the "verify checks only absolute expiry" gap and ensures a revoked or
    // idle-expired session cannot be re-validated here.
    const sessionResult = await verifySession(supabase, sessionToken);
    if (sessionResult.error || !sessionResult.userId) {
      // Invalid / expired / revoked cookie session — no JWT recreation.
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', valid: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: customUser } = await supabase
      .from('custom_users')
      .select('id, username, role, is_active')
      .eq('id', sessionResult.userId)
      .maybeSingle()

    if (!customUser || !customUser.is_active) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', valid: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch user roles from user_roles table
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', customUser.id)

    const roles = userRoles?.map(r => r.role) || []

    // Generate fresh Supabase-compatible JWT for RLS
    let accessToken: string | null = null;
    try {
      accessToken = await generateSupabaseJWT(customUser.id, 86400, {
        roles: roles,
        userMetadata: {
          username: customUser.username,
          custom_role: customUser.role,
        },
      });
    } catch (jwtError) {
      console.error('JWT generation failed during verify:', jwtError);
      // Continue without JWT - session is still valid
    }

    return new Response(
      JSON.stringify({
        valid: true,
        user: {
          id: customUser.id,
          username: customUser.username,
          role: customUser.role
        },
        roles,
        access_token: accessToken,  // Supabase-compatible JWT for direct queries when signing is configured
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Session verification error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', valid: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Auth bundle epoch 2026-07-31T17:15Z — forces shared CORS/JWT helpers into deployment.
