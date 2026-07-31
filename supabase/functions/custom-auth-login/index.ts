import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { verifyPassword, isLegacyPassword, hashPassword } from "../_shared/password.ts"
import { createCorsHeaders, createSessionCookie } from "../_shared/auth.ts"
import { generateSupabaseJWT } from "../_shared/jwt.ts"
import { hashSessionToken, isSessionHashConfigured, computeIdleExpiry } from "../_shared/sessionHash.ts"

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

Deno.serve(async (req) => {
  // Keep this entrypoint deployment coupled to the shared exact-origin CORS
  // contract; shared-file-only deployments are not always rebundled upstream.
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

    const { username, password, turnstile_token } = await req.json()

    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: 'Username and password are required' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify Turnstile CAPTCHA token.
    // ABUSE-002: with REQUIRE_TURNSTILE=true the login fails closed when the
    // secret is missing instead of silently skipping CAPTCHA.
    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY')
    if (!turnstileSecret && Deno.env.get('REQUIRE_TURNSTILE') === 'true') {
      console.error('TURNSTILE_SECRET_KEY missing while REQUIRE_TURNSTILE=true — failing closed')
      return new Response(
        JSON.stringify({ error: 'Security verification is unavailable. Please try again later.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (turnstileSecret) {
      if (!turnstile_token) {
        return new Response(
          JSON.stringify({ error: 'Security verification required' }), 
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: turnstile_token,
        }),
      })
      const verifyData = await verifyRes.json()
      
      if (!verifyData.success) {
        console.log('Turnstile verification failed:', verifyData)
        return new Response(
          JSON.stringify({ error: 'Security verification failed. Please try again.' }), 
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      console.log('Turnstile verification passed')
    }

    // Query custom_users table for the user
    const { data: user, error: userError } = await supabase
      .from('custom_users')
      .select('*')
      .eq('username', username)
      .eq('is_active', true)
      .single()

    if (userError || !user) {
      // Timing normalization: hash a dummy password so unknown accounts take
      // roughly as long as wrong-password attempts (Phase 6 / 11.4).
      await verifyPassword(password, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy').catch(() => {});
      return new Response(
        JSON.stringify({ error: 'Invalid username or password' }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate password using bcrypt (with legacy plaintext fallback)
    const isValid = await verifyPassword(password, user.password_hash);

    const isLocked = user.locked_until && new Date(user.locked_until) > new Date();
    if (!isValid || isLocked) {
      if (!isValid && !isLocked) {
        const newAttempts = (user.failed_login_attempts || 0) + 1;
        const updates: Record<string, number | string> = { failed_login_attempts: newAttempts };
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          const lockUntil = new Date();
          lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_MINUTES);
          updates.locked_until = lockUntil.toISOString();
          updates.failed_login_attempts = 0;
        }
        await supabase.from('custom_users').update(updates).eq('id', user.id);
      }
      console.log(`Login failed for user ${username}: incorrect password`);
      return new Response(
        JSON.stringify({ error: 'Invalid username or password' }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If using legacy plaintext password, upgrade to bcrypt hash
    if (isLegacyPassword(user.password_hash)) {
      console.log(`Upgrading password hash for user ${username}`);
      const hashedPassword = await hashPassword(password);
      await supabase
        .from('custom_users')
        .update({ 
          password_hash: hashedPassword,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);
    }

    console.log(`Login successful for user ${username}`);

    // Update last_login_at and clear lockout counters
    await supabase
      .from('custom_users')
      .update({ last_login_at: new Date().toISOString(), failed_login_attempts: 0, locked_until: null })
      .eq('id', user.id);

    // Generate session token
    const sessionToken = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24) // 24 hour session

    // Create session. WP-11A: store the peppered HMAC hash + idle-expiry
    // alongside the token so a DB dump cannot be replayed as a live cookie and
    // idle-timeout is enforced from issuance. (Plaintext column is still written
    // during the dual-read migration window; it is dropped once every reader
    // uses the hash path.)
    const tokenHash = isSessionHashConfigured() ? await hashSessionToken(sessionToken) : null;
    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        // WP-11A: store ONLY the peppered hash when it is available so no
        // replayable plaintext token is at rest. The plaintext column is written
        // solely as a fallback when the pepper is unconfigured (readers do a
        // hash-first, plaintext-fallback lookup, so both states resolve).
        ...(tokenHash ? {} : { session_token: sessionToken }),
        idle_expires_at: computeIdleExpiry().toISOString(),
        expires_at: expiresAt.toISOString()
      })

    if (sessionError) {
      console.error('Session creation error:', sessionError)
      return new Response(
        JSON.stringify({ error: 'Failed to create session' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Clean up expired sessions
    await supabase.rpc('cleanup_expired_sessions')

    // Fetch user roles from user_roles table
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)

    const roles = userRoles?.map(r => r.role) || []

    // Generate Supabase-compatible JWT for RLS
    let accessToken: string | null = null;
    try {
      accessToken = await generateSupabaseJWT(user.id, 86400, {
        email: user.email,
        roles: roles,
        userMetadata: {
          username: user.username,
          custom_role: user.role,
        },
      });
      console.log(`Generated JWT for user ${username}`);
    } catch (jwtError) {
      console.error('JWT generation failed:', jwtError);
      // Continue without JWT - session cookie still works for edge functions
    }

    // Create HttpOnly session cookie
    const sessionCookie = createSessionCookie(sessionToken, expiresAt);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        },
        roles,
        access_token: accessToken,  // Supabase-compatible JWT for direct RLS/realtime
        // WP-11B/C cookie-only: the raw session token is NEVER returned to
        // JavaScript. It is delivered solely as the HttpOnly `__Host-session_token`
        // cookie (Set-Cookie below), so it cannot be exfiltrated or replayed.
        expires_at: expiresAt.toISOString()
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookie
        } 
      }
    )

  } catch (error) {
    console.error('Login error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Auth bundle epoch 2026-07-31T17:15Z — forces shared CORS/JWT helpers into deployment.
