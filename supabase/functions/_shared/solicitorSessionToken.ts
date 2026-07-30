/**
 * Solicitor Portal session-token extraction.
 *
 * Mirrors `financeSessionToken.ts` but uses a portal-scoped header/cookie name
 * so a browser signed into the Command Centre, the Client Portal, the Finance
 * Portal AND the Solicitor Portal keeps four independent sessions without
 * cookie-jar collisions.
 */
export function extractSolicitorSessionToken(
  headers: Headers,
  body?: Record<string, unknown>,
): string | null {
  const headerToken = headers.get('x-solicitor-session-token');
  if (headerToken) return headerToken;

  if (typeof body?.solicitor_session_token === 'string' && body.solicitor_session_token) {
    return body.solicitor_session_token;
  }

  const cookies = Object.fromEntries(
    (headers.get('cookie') || '').split(';').flatMap((cookie) => {
      const [name, ...value] = cookie.trim().split('=');
      return name && value.length ? [[name, value.join('=')]] : [];
    }),
  );
  const cookieToken = cookies['__Host-solicitor_session_token'];
  return cookieToken ? decodeURIComponent(cookieToken) : null;
}
