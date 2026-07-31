/**
 * WP-11A — CSRF protection for cookie-authenticated mutating requests.
 *
 * Cookie-carried sessions are auto-attached by the browser on any cross-site
 * request; without an Origin/Referer allowlist a malicious page could
 * mint a state-changing request against our Edge Functions from the user's
 * browser. This helper enforces a strict allowlist of accepted origins for
 * unsafe HTTP methods.
 *
 * Safe methods (GET, HEAD, OPTIONS) are allowed through — CORS handles them
 * and they are not supposed to mutate state.
 *
 * The allowlist is sourced from `ALLOWED_ORIGINS` (comma-separated, exact
 * fully-qualified URLs). SEC5-CORS: suffix trust for `*.lovable.app` /
 * `*.lovableproject.com` was removed — the SameSite=None staff cookie makes
 * exact-origin enforcement essential. The Lovable suffix is only honoured when
 * `CORS_ALLOW_LOVABLE_PREVIEW=true` is explicitly set (non-production preview).
 * If no cookie is present on the request (auth is header-only), the CSRF check
 * is bypassed because the classic CSRF attack vector (ambient cookie authority)
 * does not apply.
 */

// CORS-ORIGINS: the allowlist (`ALLOWED_ORIGINS` plus this project's own
// preview and localhost origins) comes from the shared resolver. This module
// used to keep its own fallback copy, which omitted the project preview
// origins that the CORS layer allowed — so a request the browser was told was
// legal answered `403 csrf_denied`. SEC5-CORS: exact-origin only; suffix match
// stays gated behind the default-off preview flag.
import { isOriginAllowed } from './allowedOrigins.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originAllowed(origin: string | null): boolean {
  return isOriginAllowed(origin);
}

export interface CsrfCheckResult {
  ok: boolean;
  reason?: 'origin_not_allowed' | 'origin_missing';
  origin?: string | null;
}

/**
 * Enforce Origin/Referer allowlist on cookie-authenticated mutations.
 * - GET/HEAD/OPTIONS: always allowed.
 * - No `Cookie` header on the request: CSRF risk absent, allowed.
 * - Otherwise Origin (or Referer host) must be in the allowlist.
 */
export function enforceCsrf(req: Request): CsrfCheckResult {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return { ok: true };

  const origin = req.headers.get('origin');
  if (origin) {
    return originAllowed(origin)
      ? { ok: true, origin }
      : { ok: false, reason: 'origin_not_allowed', origin };
  }
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return originAllowed(refOrigin)
        ? { ok: true, origin: refOrigin }
        : { ok: false, reason: 'origin_not_allowed', origin: refOrigin };
    } catch {
      return { ok: false, reason: 'origin_not_allowed', origin: null };
    }
  }
  return { ok: false, reason: 'origin_missing', origin: null };
}

/** Convenience 403 factory used by handlers that want a canned response. */
export function csrfDenied(cors: Record<string, string>, detail: CsrfCheckResult): Response {
  return new Response(
    JSON.stringify({ error: 'CSRF check failed', code: 'csrf_denied', reason: detail.reason }),
    { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
}
