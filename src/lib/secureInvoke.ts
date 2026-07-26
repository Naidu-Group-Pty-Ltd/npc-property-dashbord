/**
 * Secure Edge Function invocation helper
 * Supports HttpOnly cookies for session authentication
 * Includes fallback session token in body for cross-origin cookie issues
 */
import { emitTokensUsed, emitOutOfTokens, isReportGenerator } from "@/lib/tokenEvents";

const SUPABASE_URL = "https://dduzbchuswwbefdunfct.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk";

// ── Global auth-failure circuit breaker ──
let _globalAuthExhausted = false;
const GLOBAL_AUTH_FAIL_LIMIT = 5;
let _globalAuthFailCount = 0;

export function markAuthFailure(): void {
  _globalAuthFailCount++;
  if (_globalAuthFailCount >= GLOBAL_AUTH_FAIL_LIMIT) {
    _globalAuthExhausted = true;
    console.warn('[secureInvoke] Global auth circuit breaker tripped – all polling stopped until re-login.');
  }
}

export function resetAuthFailures(): void {
  _globalAuthFailCount = 0;
  _globalAuthExhausted = false;
}

export function isAuthExhausted(): boolean {
  return _globalAuthExhausted;
}

// Matches src/hooks/useAuth.tsx. WP-11B/C cookie-only: the staff session token
// is no longer read from JS storage — the HttpOnly `__Host-session_token` cookie
// is the sole carrier, so only the access-token (RLS/realtime JWT) key remains.
const ACCESS_TOKEN_KEY = 'supabase_access_token';

// These endpoints deliberately use wildcard, token-auth CORS responses. Sending
// cookies would make browsers reject those responses because credentialed CORS
// requests cannot be combined with `Access-Control-Allow-Origin: *`.
const TOKEN_AUTH_FUNCTIONS = new Set([
  'template-import-pdf',
  'template-design-agent',
  'render-source',
  'import-from-url',
  'pdf-parse-dispatch',
]);

/** Human-readable guidance for auth failures from secured edge functions. */
export function describeAuthError(message: string | undefined | null): string | null {
  const m = String(message ?? '').toLowerCase();
  if (
    m.includes('authentication required')
    || m.includes('invalid or expired session')
    || m.includes('session not found')
    || m === 'unauthorized'
  ) {
    return 'Your sign-in session has expired. Sign out, sign back in, and retry the import.';
  }
  return null;
}

export interface InvokeResult<T = any> {
  data: T | null;
  error: { message: string; status?: number; functionName?: string; network?: boolean; code?:string; stage?:string; correlationId?:string; retryable?:boolean } | null;
}

function getStoredToken(key: string): string | null {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
  } catch {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

function clearStoredToken(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function getAccessToken(): string | null {
  return getStoredToken(ACCESS_TOKEN_KEY);
}

/**
 * Attempt to refresh the stored Supabase access token by re-verifying the
 * HttpOnly `__Host-session_token` cookie (WP-11B/C cookie-only — no raw session
 * token is read from or written to JS storage). Returns the new access token on
 * success, or null when no refresh is possible (e.g. cookie absent/expired).
 */
async function tryRefreshAccessToken(): Promise<string | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/custom-auth-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null) as any;
    if (json?.valid && json?.access_token) {
      try { sessionStorage.setItem(ACCESS_TOKEN_KEY, json.access_token); } catch { /* ignore */ }
      return json.access_token as string;
    }
  } catch (err) {
    console.warn('[secureInvoke] Token refresh failed', err);
  }
  return null;
}

/**
 * Invoke an edge function with HttpOnly cookie support
 */
export async function invokeSecureFunction<T = any>(
  functionName: string,
  body?: Record<string, any>,
  options?: { timeoutMs?: number; _isRetry?: boolean; stepUpCapability?: string; correlationId?:string }
): Promise<InvokeResult<T>> {
  const correlationId = options?.correlationId ?? crypto.randomUUID();
  try {
    let accessToken = getAccessToken();
    // Native Supabase Auth fallback: users signed in through supabase-js keep
    // their JWT in the client's own storage, not under our custom keys — for
    // them the old code silently sent the ANON key and secured functions 401'd.
    if (!accessToken) {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        accessToken = (await supabase.auth.getSession()).data.session?.access_token ?? null;
      } catch { /* native session lookup is best-effort */ }
    }
    const bearerToken = accessToken || SUPABASE_ANON_KEY;

    // WP-11C: attach a live step-up token when the caller declares a capability.
    let stepUpToken: string | null = null;
    if (options?.stepUpCapability) {
      try {
        const { getStepUpToken } = await import('@/lib/security/stepUp');
        stepUpToken = getStepUpToken(options.stepUpCapability);
      } catch { /* module optional at boot */ }
    }

    // WP-11B/C cookie-only: the staff session travels solely in the HttpOnly
    // `__Host-session_token` cookie (`credentials: 'include'`). No raw session
    // token is read from storage or attached to the body/headers.
    //
    // CORS-SAFE CARRIERS — do not move these into request headers.
    // The frontend deploys as one bundle; the ~300 edge functions each carry
    // their own bundled copy of `_shared/auth.ts` and are redeployed
    // individually. A custom request header therefore only works once EVERY
    // function it can reach has been redeployed with that header in its
    // `Access-Control-Allow-Headers`. Until then the browser fails the
    // preflight and `fetch()` throws `Failed to fetch` — the whole app goes
    // dark. Body fields have no preflight requirement, so they stay correct
    // no matter how far the client runs ahead of the backend.
    // See scripts/security/check-cors-contract.mjs.
    const requestBody = {
      correlation_id: correlationId,
      ...(body ?? {}),
      ...(stepUpToken ? { step_up_token: stepUpToken } : {}),
    };

    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs || 60000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      // Only CORS-safelisted headers plus the two Supabase auth headers every
      // deployed function already allow-lists. `correlation_id` and
      // `step_up_token` ride in the body (see the note above) — adding either
      // as a header here breaks every page until all functions are redeployed.
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${bearerToken}`,
      },
      credentials: TOKEN_AUTH_FUNCTIONS.has(functionName) ? 'omit' : 'include',
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));
    const responseCorrelationId = response.headers.get('x-correlation-id') || data?.correlation_id || correlationId;
    
    if (!response.ok) {
      // Mission Control insufficient_funds → surface global banner.
      if (response.status === 402 && data?.error?.code === 'insufficient_funds') {
        emitOutOfTokens({
          available: Number(data.error.available ?? 0),
          requested: Number(data.error.requested ?? 0),
          functionName,
        });
        return {
          data: data as T,
          error: { message: data.error.message || 'Insufficient tokens', status: response.status, functionName, code:data.error.code, correlationId:responseCorrelationId, retryable:false },
        };
      }

      const isTransient = response.status >= 500 && response.status < 600;
      const log = isTransient ? console.warn : console.error;
      log('[invokeSecureFunction] Request failed', {
        functionName,
        status: response.status,
        ...(functionName.startsWith('market-updates-') ? { code:data?.code ?? 'unknown', stage:data?.stage ?? 'function', correlationId:responseCorrelationId } : { data }),
        hasAccessToken: Boolean(accessToken),
      });

      const message = String(data?.error || data?.message || '').toLowerCase();
      const isAuthFailure = response.status === 401
        || response.status === 403
        || (response.status === 400 && (
          message.includes('authentication required')
          || message.includes('auth required')
          || message.includes('invalid session')
          || message.includes('session expired')
        ));

      // ── One-shot token refresh + retry on auth failure ──
      if (isAuthFailure && !options?._isRetry && functionName !== 'custom-auth-verify') {
        const refreshed = await tryRefreshAccessToken();
        if (refreshed) {
          console.log('[invokeSecureFunction] Access token refreshed, retrying', functionName);
          return invokeSecureFunction<T>(functionName, body, { ...options, _isRetry: true, correlationId });
        }
      }

      if (isAuthFailure) {
        markAuthFailure();
        if (isAuthExhausted()) {
          console.warn('[secureInvoke] Clearing stale access token after repeated auth failures');
          clearStoredToken(ACCESS_TOKEN_KEY);
        }
      }

      const errorMessage = typeof data?.error === 'object' && data.error?.message
        ? data.error.message
        : data?.error || data?.message || `HTTP ${response.status}`;

      return { 
        data: data as T, 
        error: { message: String(errorMessage), status: response.status, functionName, code:data?.code, stage:data?.stage, correlationId:responseCorrelationId, retryable:data?.retryable }
      };
    }
    
    resetAuthFailures();

    // Surface token usage for metered generators.
    if (isReportGenerator(functionName)) {
      const headerUsed = Number(response.headers.get('x-tokens-used') || 0);
      const headerReserved = Number(response.headers.get('x-tokens-reserved') || 0);
      const headerEstimated = Number(response.headers.get('x-tokens-estimated') || 0);
      const headerDuration = Number(response.headers.get('x-duration-ms') || 0);
      const bodyUsed = Number((data as any)?.tokensUsed || 0);
      const used = bodyUsed > 0 ? bodyUsed : headerUsed;
      if (used > 0) {
        emitTokensUsed({
          tokensUsed: used,
          tokensReserved: headerReserved || (data as any)?.tokensReserved,
          estimatedTokens: headerEstimated || (data as any)?.estimatedTokens,
          durationMs: headerDuration || (data as any)?.durationMs,
          functionName,
        });
      }
    }

    return { data: data as T, error: null };
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    const rawMessage = error.message || 'Network error';
    const message = isTimeout
      ? 'Request timed out. Please try again.'
      : rawMessage === 'Failed to fetch'
        ? `Network/CORS error calling ${functionName}. Please check the function deployment and auth/CORS configuration.`
        : rawMessage;
    console.error('[invokeSecureFunction] Network invocation failed', {
      functionName,
      message: rawMessage,
      isTimeout,
      correlationId,
    });
    return {
      data: null,
      error: { message, functionName, network: true, code:isTimeout?'provider_timeout':'network_error', stage:'network', correlationId, retryable:true },
    };
  }
}


/**
 * Best-effort check for an active session. The staff session lives in an
 * HttpOnly cookie that JS cannot read, so this reflects only whether a
 * (tab-scoped) access token is present; the authoritative check is a
 * cookie-authenticated custom-auth-verify call.
 */
export function hasActiveSession(): boolean {
  return Boolean(getAccessToken());
}
