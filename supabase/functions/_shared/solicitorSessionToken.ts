import { isOriginAllowed } from './allowedOrigins.ts';

/** Cookie-first credential extraction; headers/body exist only for one legacy migration window. */
export interface SolicitorCredential { token: string; source: 'cookie' | 'legacy_header' | 'legacy_body' }
export function extractSolicitorSessionCredential(headers: Headers, body?: Record<string, unknown>): SolicitorCredential | null {
  // Old clients sent both a cookie and this header. Prefer the explicit legacy
  // carrier for one migration window so it can be exchanged and cleared.
  const header = headers.get('x-solicitor-session-token');
  if (header) return { token: header, source: 'legacy_header' };
  const cookies = Object.fromEntries((headers.get('cookie') || '').split(';').flatMap(cookie => { const [name, ...value] = cookie.trim().split('='); return name && value.length ? [[name, value.join('=')]] : []; }));
  const cookie = cookies['__Host-solicitor_session_token'];
  if (cookie) return { token: decodeURIComponent(cookie), source: 'cookie' };
  if (typeof body?.solicitor_session_token === 'string' && body.solicitor_session_token) return { token: body.solicitor_session_token, source: 'legacy_body' };
  return null;
}
export function extractSolicitorSessionToken(headers: Headers, body?: Record<string, unknown>): string | null { return extractSolicitorSessionCredential(headers, body)?.token || null; }

export function validateSolicitorPortalRequest(req: Request): boolean {
  return validateSolicitorPortalHeaders(req.headers);
}
/**
 * CORS-ORIGINS: the origin is checked against the shared allowlist — the
 * `ALLOWED_ORIGINS` secret plus this project's own preview and localhost
 * origins (see `_shared/allowedOrigins.ts`). The local fallback list this
 * replaced omitted the project preview origins, so the Solicitor Portal was
 * rejected in the Lovable editor even though CORS allowed the request.
 */
export function validateSolicitorPortalHeaders(headers: Headers, allowLegacyCarrier = false): boolean {
  if (headers.get('x-portal-request') !== 'solicitor-portal' && !(allowLegacyCarrier && headers.get('x-solicitor-session-token'))) return false;
  const origin = headers.get('origin');
  return !!origin && isOriginAllowed(origin);
}
