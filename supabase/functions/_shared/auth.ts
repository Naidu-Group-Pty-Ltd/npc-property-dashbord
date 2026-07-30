/**
 * Shared authentication utilities for Edge Functions
 * Validates session tokens from the custom auth system
 * Supports HttpOnly cookies for XSS protection
 * Also supports Supabase JWT when verify_jwt is enabled (defense in depth)
 *
 * SECURITY: Bearer JWTs are ALWAYS cryptographically verified before any
 * claim (sub/role) is trusted. Most functions run with verify_jwt=false at
 * the gateway, so in-function signature verification is the trust boundary.
 */

import { verifySupabaseJWT } from './jwt.ts';
import { hashSessionToken, isSessionHashConfigured, computeIdleExpiry, isSessionUsable } from './sessionHash.ts';

/** Constant-time string comparison (avoids leaking a secret via timing). */
function constantTimeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SessionValidationResult {
  error: string | null;
  userId: string | null;
  username: string | null;
  authMethod?: 'jwt' | 'session' | 'service_role'; // Track which auth method was used
}

/**
 * Verify a session token is valid and not expired
 * @param supabase - Supabase client with service_role
 * @param sessionToken - The session token from the request
 * @returns Session validation result with user info or error
 */
export async function verifySession(
  supabase: any,
  sessionToken: string | null | undefined
): Promise<SessionValidationResult> {
  if (!sessionToken) {
    console.log('[verifySession] No session token provided');
    return { error: 'Authentication required', userId: null, username: null };
  }

  // WP-11A: never log a preview of the token; hash-derived id is what we key on.
  console.log('[verifySession] Verifying session token (length:', sessionToken.length, ')');

  try {
    // WP-11A: dual-read. Prefer HMAC hash lookup so a DB dump cannot be
    // replayed as a live cookie; fall back to the legacy plaintext column
    // for sessions issued before the migration window closed.
    const hash = isSessionHashConfigured() ? await hashSessionToken(sessionToken) : null;

    type Row = {
      id: string;
      user_id: string;
      expires_at: string;
      token_hash: string | null;
      revoked_at: string | null;
      idle_expires_at: string | null;
    };

    let session: Row | null = null;

    if (hash) {
      const { data } = await supabase
        .from('user_sessions')
        .select('id, user_id, expires_at, token_hash, revoked_at, idle_expires_at')
        .eq('token_hash', hash)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      session = (data as Row | null) ?? null;
    }

    let matchedByPlaintext = false;
    if (!session) {
      const { data, error: sessionError } = await supabase
        .from('user_sessions')
        .select('id, user_id, expires_at, token_hash, revoked_at, idle_expires_at')
        .eq('session_token', sessionToken)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (sessionError) {
        console.log('[verifySession] Session query error:', sessionError.code, sessionError.message);
      }
      if (data) {
        session = data as Row;
        matchedByPlaintext = true;
      }
    }

    if (!session) {
      return { error: 'Invalid or expired session', userId: null, username: null };
    }

    // WP-11A: idle-expiry and revocation checks.
    const usable = isSessionUsable(session);
    if (!usable.ok) {
      console.log('[verifySession] Session unusable:', usable.reason);
      return { error: 'Session revoked or expired', userId: null, username: null };
    }

    // WP-11A: lazily backfill token_hash + last_used_at, and SLIDE the
    // idle-expiry forward on every successful verify. Previously idle_expires_at
    // was only set when null, which effectively pinned the idle deadline to
    // 30 minutes after login and killed active sessions.
    try {
      const patch: Record<string, unknown> = {
        last_used_at: new Date().toISOString(),
        idle_expires_at: computeIdleExpiry().toISOString(),
      };
      if (hash && (matchedByPlaintext || !session.token_hash)) patch.token_hash = hash;
      await supabase.from('user_sessions').update(patch).eq('id', session.id);
    } catch (bfErr) {
      console.log('[verifySession] Backfill non-fatal error:', (bfErr as Error).message);
    }


    // A session is valid only while its owning custom user remains active and
    // has not been soft-deleted. This prevents disabling a user from leaving
    // existing sessions usable until their expiry.
    const { data: user } = await supabase
      .from('custom_users')
      .select('username, is_active, deleted_at')
      .eq('id', session.user_id)
      .maybeSingle();

    if (!user || user.is_active !== true || user.deleted_at !== null) {
      console.log('[verifySession] Session user missing, inactive, or deleted');
      return { error: 'Invalid or expired session', userId: null, username: null };
    }

    console.log('[verifySession] Session authentication successful (userId 8-prefix:',
      session.user_id?.substring(0, 8) + '...',
      'username:', user?.username || 'not found', ')');

    return {
      error: null,
      userId: session.user_id,
      username: user?.username || null,
      authMethod: 'session',
    };
  } catch (err) {
    console.error('[verifySession] Session verification error:', err);
    return { error: 'Session verification failed', userId: null, username: null };
  }
}

/**
 * Verify authentication using either Supabase JWT (when verify_jwt is enabled) or custom session token
 * This provides defense in depth - JWT is checked first, then falls back to session token
 * @param supabase - Supabase client with service_role
 * @param headers - Request headers (for JWT from Authorization header)
 * @param body - Request body (for session_token)
 * @returns Session validation result with user info or error
 */
export async function verifyAuth(
  supabase: any,
  headers: Headers,
  body?: { session_token?: string; command_centre_session_token?: string }
): Promise<SessionValidationResult> {
  // DIAGNOSTIC: presence-only. WP-11A/P1-LOG: never log previews of credential
  // material (Authorization prefix, Cookie preview, token prefix) — those leak
  // exploitable bytes of a session cookie/JWT into logs.
  const authHeader = headers.get('authorization');
  const cookieHeader = headers.get('cookie');
  const commandCentreSessionHeader = headers.get('x-command-centre-session-token');
  const sessionHeader = headers.get('x-session-token');
  console.log('[verifyAuth] Headers check:', {
    hasAuthHeader: !!authHeader,
    hasCookieHeader: !!cookieHeader,
    hasCommandCentreSessionHeader: !!commandCentreSessionHeader,
    hasSessionHeader: !!sessionHeader,
    hasBody: !!body,
    bodyHasCommandCentreSessionToken: !!(body?.command_centre_session_token),
    bodyHasSessionToken: !!(body?.session_token)
  });

  // Internal-service auth (AUTH-002): a dedicated INTERNAL_EDGE_SECRET presented
  // in x-internal-edge-secret authorizes an internal edge-to-edge call as
  // service_role, WITHOUT spreading the crown-jewel service-role key on the
  // wire. Constant-time compared; headers-only. This lets every receiver that
  // already accepts service_role via verifyAuth transparently accept the safer
  // internal credential.
  const internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
  const presentedInternal = (headers.get('x-internal-edge-secret') || '').trim();
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (internalSecret.length >= 16 && (
        (presentedInternal.length > 0 && constantTimeEqualStr(internalSecret, presentedInternal)) ||
        (bearerToken.length > 0 && constantTimeEqualStr(internalSecret, bearerToken))
      )) {
    console.log('[verifyAuth] Valid INTERNAL_EDGE_SECRET - allowing internal service call');
    return { error: null, userId: 'service_role', username: 'system', authMethod: 'service_role' };
  }

  // First, try the Authorization header. SECURITY: claims from a Bearer JWT
  // are only trusted after cryptographic verification. Most functions run
  // with verify_jwt=false at the gateway, so a decoded-but-unverified payload
  // is attacker-controlled input (forged sub/role, alg=none, etc.).
  if (authHeader?.startsWith('Bearer ')) {
    const jwtToken = authHeader.substring(7).trim();

    // AUTH-004 / SEC5-P0.2: the raw service-role key is NO LONGER accepted as a
    // Bearer credential (the previous `sb_secret_*` direct-comparison put the
    // crown-jewel key on the wire as an inter-function Authorization value).
    // Internal callers present the dedicated INTERNAL_EDGE_SECRET via the
    // `x-internal-edge-secret` header (handled above); pg_cron sends that header
    // too. A cryptographically-verified service_role JWT is still honoured below
    // (a signed token, not the raw key).

    // The anon key is public and identifies nobody; fall through to session auth.
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const isAnonKey = !!anonKey && jwtToken === anonKey.trim();

    if (jwtToken.includes('.') && !isAnonKey) {
      try {
        // 1) Verify the HS256 signature against the project JWT secret. This
        //    covers both custom-auth JWTs (issued by _shared/jwt.ts) and
        //    legacy Supabase keys/JWTs signed with the same secret.
        const payload = await verifySupabaseJWT(jwtToken);

        if (payload) {
          if ((payload as any).role === 'service_role') {
            console.log('[verifyAuth] Verified service_role JWT - allowing internal service call');
            return {
              error: null,
              userId: 'service_role',
              username: 'system',
              authMethod: 'service_role',
            };
          }

          if (payload.sub && payload.role === 'authenticated') {
            // Signature is valid; confirm the user is active and not soft-deleted.
            const { data: user, error: userError } = await supabase
              .from('custom_users')
              .select('username, id, is_active, deleted_at')
              .eq('id', payload.sub)
              .maybeSingle();

            if (!userError && user && user.is_active === true && user.deleted_at === null) {
              console.log('[verifyAuth] JWT authentication successful:', { userId: payload.sub.substring(0, 8) + '...', username: user.username });
              return {
                error: null,
                userId: payload.sub,
                username: user.username || null,
                authMethod: 'jwt',
              };
            }
            console.log('[verifyAuth] Verified JWT but user missing/inactive in custom_users, falling back to session token');
          } else {
            console.log('[verifyAuth] Verified JWT is not an authenticated user token (role:', payload.role, '), falling back to session token');
          }
        } else {
          // 2) HS256 verification failed. The token may be a native Supabase
          //    Auth JWT signed with a newer (possibly asymmetric) key — verify
          //    it with the Auth server instead of trusting decoded claims.
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          if (supabaseUrl && anonKey) {
            const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
              headers: { Authorization: `Bearer ${jwtToken}`, apikey: anonKey },
            });
            if (resp.ok) {
              const authUser = await resp.json();
              if (authUser?.id) {
                const { data: user, error: userError } = await supabase
                  .from('custom_users')
                  .select('username, id, is_active, deleted_at')
                  .eq('id', authUser.id)
                  .maybeSingle();
                if (!userError && user && user.is_active === true && user.deleted_at === null) {
                  console.log('[verifyAuth] Auth-server-verified JWT successful:', { userId: String(authUser.id).substring(0, 8) + '...' });
                  return {
                    error: null,
                    userId: String(authUser.id),
                    username: user.username || null,
                    authMethod: 'jwt',
                  };
                }
              }
            }
          }
          console.log('[verifyAuth] Bearer JWT failed cryptographic verification, falling back to session token');
        }
      } catch (err) {
        console.log('[verifyAuth] JWT verification errored, falling back to session token:', err);
        // Fall through to session token check
      }
    }
  }

  // Fall back to custom session token authentication
  // This is the primary authentication method for the custom auth system
  console.log('[verifyAuth] Attempting session token extraction...');
  const sessionToken = extractSessionToken(headers, body);
  console.log('[verifyAuth] Session token extracted:', sessionToken ? 'present' : 'null');

  if (!sessionToken) {
    console.log('[verifyAuth] No session token found - returning authentication required');
    return { error: 'Authentication required', userId: null, username: null };
  }

  console.log('[verifyAuth] Verifying session token...');
  return await verifySession(supabase, sessionToken);
}

/**
 * Verify the caller as EITHER a custom-auth user (session token / custom HS256
 * JWT → `custom_users`) OR a native Supabase Auth user (JWT verified against
 * the Auth server). The template-builder endpoints authenticate real humans
 * from both systems; accepting only one of them locked out the other and
 * surfaced as blanket "Authentication required" errors on every import.
 */
export async function verifyAuthOrNativeUser(
  supabase: any,
  req: Request,
  body?: { session_token?: string; command_centre_session_token?: string }
): Promise<SessionValidationResult> {
  const custom = await verifyAuth(supabase, req.headers, body);
  if (!custom.error) return custom;

  // Fallback: a native Supabase Auth user (verify the JWT with the Auth server).
  try {
    const authHeader = req.headers.get('authorization');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (authHeader?.startsWith('Bearer ') && anonKey && supabaseUrl) {
      const jwt = authHeader.substring(7).trim();
      // The anon key itself is not a user.
      if (jwt && jwt !== anonKey.trim()) {
        const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
        });
        if (resp.ok) {
          const user = await resp.json();
          if (user?.id) {
            console.log('[verifyAuthOrNativeUser] Native Supabase Auth user verified:', String(user.id).substring(0, 8) + '...');
            return {
              error: null,
              userId: String(user.id),
              username: user.email ?? null,
              authMethod: 'jwt',
            };
          }
        }
      }
    }
  } catch (err) {
    console.log('[verifyAuthOrNativeUser] Native auth fallback failed:', err);
  }
  return custom; // original custom-auth error (message + null user)
}

/**
 * Parse cookies from Cookie header
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = rest.join('=');
    }
  });
  
  return cookies;
}

/**
 * Extract session token from request headers, cookies, or body
 * Priority: Cookie > x-command-centre-session-token header > x-session-token header > body > Authorization header (only if not a JWT)
 * Supports HttpOnly cookies for XSS protection
 * 
 * NOTE: We check Authorization header LAST and only if it doesn't look like a JWT
 * to avoid treating the Supabase anon key as a session token
 */
export function extractSessionToken(
  headers: Headers,
  // Body is accepted for signature compatibility but ignored — WP-11B/C Phase 4
  // sunsets every non-cookie carrier.
  _body?: { session_token?: string | null; command_centre_session_token?: string | null }
): string | null {
  const isValidToken = (t: any): t is string =>
    typeof t === 'string' && t.length > 0 && t !== 'null' && t !== 'undefined';

  // WP-11B/C Phase 4: the `__Host-session_token` HttpOnly cookie is the SOLE
  // carrier for staff sessions. The legacy `session_token` cookie name and
  // every header/body/authorization fallback that was tagged as
  // `[wp11c.legacy_fallback]` during the Phase 3 soak has been removed.
  const cookieHeader = headers.get('cookie');
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  return isValidToken(cookies['__Host-session_token']) ? cookies['__Host-session_token'] : null;
}


/**
 * Create CORS headers with credentials support for cookies
 * Uses dynamic origin for security
 *
 * SECURITY (SEC5-CORS): this response carries `Access-Control-Allow-Credentials:
 * true`, so the reflected origin must be an EXACT, fully-qualified match — never
 * a shared hosting suffix. Suffix trust for `*.lovable.app` /
 * `*.lovableproject.com` was removed: a hostile page on any such subdomain could
 * otherwise read a credentialed response (staff-session exfiltration chain).
 *
 * Allowed origins come from `ALLOWED_ORIGINS` (comma-separated, fully-qualified
 * URLs) plus localhost for development. Preview deployments must be listed by
 * full URL in `ALLOWED_ORIGINS`. As a deliberate, auditable escape hatch,
 * setting `CORS_ALLOW_LOVABLE_PREVIEW=true` re-enables the Lovable suffix match
 * for non-production preview environments — it is OFF by default so production
 * is exact-origin without any configuration.
 *
 * SAFETY FALLBACK: If `ALLOWED_ORIGINS` is unset, we fall back to the legacy
 * production origin so existing deployments never break. Set `ALLOWED_ORIGINS`.
 */

const LEGACY_FALLBACK_ORIGINS = [
  'https://command-centre.npcservices.com.au',
  'https://npc-property-dashbord.lovable.app',
];

/**
 * CORS-REQ-HEADERS: canonical allowlist of REQUEST headers the browser may send.
 *
 * A preflight succeeds only when EVERY header the client puts in
 * `Access-Control-Request-Headers` appears here. A header the app sends but
 * that is missing from this list fails the preflight, so the real request is
 * never dispatched and `fetch()` rejects with an opaque `TypeError: Failed to
 * fetch` — indistinguishable from the function being down.
 *
 * `src/lib/secureInvoke.ts` attaches `x-correlation-id` to EVERY edge-function
 * call and `x-step-up-token` to step-up-gated calls, so both must stay listed.
 * Anything new added to a client request header must be added here in the same
 * change; `scripts/security/check-cors-contract.mjs` enforces that.
 */
export const CORS_ALLOWED_REQUEST_HEADERS = [
  'authorization',
  'x-client-info',
  'apikey',
  'content-type',
  // Observability + step-up (sent by src/lib/secureInvoke.ts).
  'x-correlation-id',
  'x-step-up-token',
  // Session carriers for the staff / client / finance / solicitor portals.
  'x-session-token',
  'x-command-centre-session-token',
  'x-portal-session-token',
  'x-finance-session-token',
  'x-solicitor-session-token',
  'x-session-id',
  'x-generation-run-id',
].join(', ');

/**
 * CORS-RES-HEADERS: response headers the browser is allowed to reveal to JS.
 *
 * Cross-origin, `response.headers.get()` can only see the seven CORS-safelisted
 * response headers unless the header is named here. Without this list the
 * metering/correlation headers below silently read back as `null`, so token
 * accounting records 0 and correlation ids never reach the client logs.
 */
export const CORS_EXPOSED_RESPONSE_HEADERS = [
  'x-correlation-id',
  'x-tokens-used',
  'x-tokens-reserved',
  'x-tokens-estimated',
  'x-duration-ms',
].join(', ');

function parseAllowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') || '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (fromEnv.length > 0) {
    return fromEnv;
  }
  console.warn('[auth.cors] ALLOWED_ORIGINS env var is unset; using legacy fallback origins. Set ALLOWED_ORIGINS to override.');
  return LEGACY_FALLBACK_ORIGINS;
}

/**
 * Opt-in, non-production escape hatch for Lovable preview iframes. OFF unless
 * `CORS_ALLOW_LOVABLE_PREVIEW=true` is explicitly set. Production leaves this
 * unset, so suffix origins are NOT trusted for credentialed responses.
 */
function lovablePreviewSuffixAllowed(origin: string): boolean {
  if ((Deno.env.get('CORS_ALLOW_LOVABLE_PREVIEW') || '').trim().toLowerCase() !== 'true') return false;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com');
  } catch {
    return false;
  }
}

export function createCorsHeaders(origin: string | null = null): Record<string, string> {
  const allowedOrigins = [
    ...parseAllowedOrigins(),
    'http://localhost:5173',
    'http://localhost:8080',
  ];

  // Exact-origin allowlist only. Suffix matching is gated behind an explicit,
  // default-off preview flag (see lovablePreviewSuffixAllowed). A disallowed
  // origin gets a mismatched ACAO (allowedOrigins[0]) that the browser refuses
  // to expose to the caller.
  const allowedOrigin = origin && (
    allowedOrigins.includes(origin) ||
    lovablePreviewSuffixAllowed(origin)
  ) ? origin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    // Required for browser preflight (POST + application/json)
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': CORS_ALLOWED_REQUEST_HEADERS,
    // Without this the client reads back `null` for every custom header.
    'Access-Control-Expose-Headers': CORS_EXPOSED_RESPONSE_HEADERS,
    // Required for HttpOnly cookie auth
    'Access-Control-Allow-Credentials': 'true',
    // Cache the preflight so each call isn't a two-round-trip.
    'Access-Control-Max-Age': '86400',
    // Ensure caches/proxies don't mix CORS responses across origins
    'Vary': 'Origin',
  };
}

/**
 * CORS headers for TOKEN-authenticated endpoints (no cookies involved — the
 * app calls them with `credentials: 'omit'` and auth travels in the
 * Authorization header / `session_token` body field).
 *
 * Wildcard origin is deliberate: the origin-allowlist variant returned a
 * mismatched `Access-Control-Allow-Origin` for any origin missing from
 * `ALLOWED_ORIGINS`, which the browser surfaces as an opaque
 * "Failed to fetch" hard error on EVERY call — indistinguishable from an
 * outage. Authentication is enforced in-function, not by CORS.
 */
export function createTokenAuthCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': CORS_ALLOWED_REQUEST_HEADERS,
    'Access-Control-Expose-Headers': CORS_EXPOSED_RESPONSE_HEADERS,
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Create session cookie header for login response
 */
export function createSessionCookie(
  sessionToken: string,
  expiresAt: Date,
  options?: { clear?: boolean }
): string {
  const maxAge = options?.clear ? 0 : Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  const expires = options?.clear ? new Date(0).toUTCString() : expiresAt.toUTCString();
  
  // HttpOnly: prevents JavaScript access (XSS protection)
  // Secure: only sent over HTTPS
  // SameSite=None: required because the app runs on a different site than *.supabase.co
  // (cross-site fetch). We rely on:
  //  - strict Origin allow-listing in createCorsHeaders
  //  - required apikey header (not possible in CSRF form posts)
  // to preserve CSRF protection.
  // Path=/: cookie available for all paths.
  // WP-11B: cookie name is `__Host-session_token` (host-prefixed per RFC 6265bis).
  //         The prefix forces Secure, Path=/, and forbids Domain — browsers
  //         reject the Set-Cookie if any of those invariants is violated,
  //         which prevents cookie-jar contamination from sibling subdomains.
  return `__Host-session_token=${options?.clear ? '' : sessionToken}; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}; Expires=${expires}; Path=/`;
}

/**
 * Create a clear session cookie header for logout.
 * WP-11B/C Phase 4: the legacy `session_token` cookie name has been sunset;
 * only the `__Host-session_token` cookie is emitted/cleared.
 */
export function createClearSessionCookie(): string {
  return createSessionCookie('', new Date(0), { clear: true });
}

export function createClearSessionCookies(): string[] {
  const past = new Date(0).toUTCString();
  return [
    `__Host-session_token=; HttpOnly; Secure; SameSite=None; Max-Age=0; Expires=${past}; Path=/`,
  ];
}

/**
 * Finance-portal-scoped session cookie. Uses a dedicated cookie name so it does
 * NOT collide with the main dashboard's `__Host-session_token` when a user is
 * signed into both apps on the same browser (both cookies are scoped to
 * *.supabase.co because that's where edge functions live). Prior to this,
 * signing into the main dashboard overwrote the finance portal cookie and
 * every finance-portal-verify call returned 401.
 */
export function createFinanceSessionCookie(
  sessionToken: string,
  expiresAt: Date,
  options?: { clear?: boolean }
): string {
  const maxAge = options?.clear ? 0 : Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  const expires = options?.clear ? new Date(0).toUTCString() : expiresAt.toUTCString();
  return `__Host-finance_session_token=${options?.clear ? '' : sessionToken}; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}; Expires=${expires}; Path=/`;
}

export function createClearFinanceSessionCookie(): string {
  return createFinanceSessionCookie('', new Date(0), { clear: true });
}

/**
 * Create an unauthorized response with proper CORS headers
 */
export function createUnauthorizedResponse(
  message: string = 'Authentication required',
  corsHeaders: Record<string, string> = createCorsHeaders()
): Response {
  return new Response(
    // `code` lets clients distinguish a real sign-in problem from other
    // failures and show actionable guidance instead of a raw 401.
    JSON.stringify({ error: message, code: 'auth_required', success: false }),
    {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Create a forbidden response with proper CORS headers
 */
export function createForbiddenResponse(
  message: string = 'Access denied',
  corsHeaders: Record<string, string> = createCorsHeaders()
): Response {
  return new Response(
    JSON.stringify({ error: message, success: false }),
    {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}
