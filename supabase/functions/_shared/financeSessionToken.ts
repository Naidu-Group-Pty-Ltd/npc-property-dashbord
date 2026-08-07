export function extractFinanceSessionToken(headers: Headers, body?: Record<string, unknown>): string | null {
  const headerToken = headers.get('x-finance-session-token');
  if (headerToken) return headerToken;
  if (typeof body?.finance_session_token === 'string' && body.finance_session_token) {
    return body.finance_session_token;
  }

  const sessionHeader = headers.get('x-session-token');
  if (sessionHeader) return sessionHeader;
  if (typeof body?.session_token === 'string' && body.session_token) return body.session_token;

  const cookies = Object.fromEntries(
    (headers.get('cookie') || '').split(';').flatMap((cookie) => {
      const [name, ...value] = cookie.trim().split('=');
      return name && value.length ? [[name, value.join('=')]] : [];
    }),
  );
  // Only the Finance Portal's own cookie. The `__Host-session_token` fallback
  // that used to sit here read the COMMAND CENTRE's cookie: it existed to prop
  // up `finance-portal-accept-invite`, which was writing finance sessions into
  // the staff cookie name. That is fixed at the source, so the fallback is
  // removed — a staff cookie must never be offered as a finance credential, and
  // a finance session must never be resolvable from one.
  const cookieToken = cookies['__Host-finance_session_token'];
  return cookieToken ? decodeURIComponent(cookieToken) : null;
}
