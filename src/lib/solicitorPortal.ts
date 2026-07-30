/**
 * Solicitor Portal client-side API wrapper.
 *
 * Mirrors the Finance Portal transport: anon-key edge invocation carrying a
 * portal-scoped session token in a dedicated header so the Command Centre,
 * Client Portal, Finance Portal and Solicitor Portal never share a session.
 */

const SUPABASE_URL = 'https://dduzbchuswwbefdunfct.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';

export const SOLICITOR_SESSION_KEY = 'solicitor_session_token';

export interface SolicitorPortalUser {
  id: string;
  firm_id: string;
  email: string;
  name: string;
  phone: string | null;
  position: string | null;
  portal_role: string;
  firm_name: string | null;
  practising_states: string[];
  has_accepted_terms: boolean;
  has_completed_onboarding: boolean;
  must_change_password: boolean;
}

export function getSolicitorSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SOLICITOR_SESSION_KEY) || localStorage.getItem(SOLICITOR_SESSION_KEY);
  } catch {
    try {
      return localStorage.getItem(SOLICITOR_SESSION_KEY);
    } catch {
      return null;
    }
  }
}

export function persistSolicitorSessionToken(token: string) {
  try { sessionStorage.setItem(SOLICITOR_SESSION_KEY, token); } catch { /* ignore */ }
  try { localStorage.setItem(SOLICITOR_SESSION_KEY, token); } catch { /* ignore */ }
}

export function clearSolicitorSessionToken() {
  try { sessionStorage.removeItem(SOLICITOR_SESSION_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(SOLICITOR_SESSION_KEY); } catch { /* ignore */ }
}

export async function invokeSolicitorFunction<T = any>(
  functionName: string,
  body: Record<string, unknown> = {},
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const sessionToken = getSolicitorSessionToken();

    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        ...(sessionToken ? { 'x-solicitor-session-token': sessionToken } : {}),
      },
      credentials: 'omit',
      body: JSON.stringify({
        ...body,
        ...(sessionToken ? { solicitor_session_token: sessionToken } : {}),
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { data, error: { message: (data as any)?.error || `HTTP ${response.status}` } };
    }
    return { data, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error?.message || 'Network error' } };
  }
}
