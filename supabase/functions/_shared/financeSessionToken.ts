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
  const cookieToken = cookies['__Host-finance_session_token'] || cookies['__Host-session_token'];
  return cookieToken ? decodeURIComponent(cookieToken) : null;
}
