/**
 * weasyRenderClient — single client entry point for the `render-template-pdf`
 * edge function (HTML → WeasyPrint → storage URL).
 *
 * The editor previously had two hand-rolled copies of this fetch (live PDF
 * preview + "Render with WeasyPrint" export action); keep them in sync by
 * routing both through here.
 *
 * WP-11B/C cookie-only sessions: the staff session travels in the HttpOnly
 * `__Host-session_token` cookie, so this request goes out with
 * `credentials: 'include'`, and the Bearer comes from `resolveAuthBearer`
 * (mirrored access token → native supabase-js session → cookie re-mint) —
 * `supabase.auth.getSession()` alone is null for every custom-auth staff user.
 * This call site predated that migration; once the functions fleet redeployed
 * with cookie-only auth, every render call 401'd "Authentication required" and
 * the WeasyPrint preview and PDF exports failed across the board.
 */
import { resolveAuthBearer, describeAuthError, isAuthFailureResponse } from '@/lib/secureInvoke';

export interface WeasyRenderRequest {
  html: string;
  fileName: string;
  templateId?: string;
  mode?: 'preview' | 'production';
}

/** Renders HTML via the WeasyPrint edge function; resolves to the PDF URL. */
export async function renderHtmlToPdfUrl({ html, fileName, templateId, mode = 'preview' }: WeasyRenderRequest): Promise<string> {
  const { token } = await resolveAuthBearer({ refreshIfMissing: true });
  const projectId = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/render-template-pdf`;
  const sendRequest = (credentials: RequestCredentials) => fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
    credentials,
    body: JSON.stringify({ html, fileName, templateId, mode }),
  });
  let res: Response;
  try {
    res = await sendRequest('include');
  } catch (err) {
    // A function still on a wildcard-CORS build rejects a credentialed request
    // at the PREFLIGHT — nothing was dispatched — so one uncredentialed retry
    // is side-effect free (same pattern as invokeSecureFunction).
    if ((err as Error)?.name === 'AbortError') throw err;
    res = await sendRequest('omit');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String((json as any)?.error?.message || (json as any)?.error || '');
    if (isAuthFailureResponse(res.status, message)) {
      throw new Error(describeAuthError(message || 'authentication required')
        ?? 'Your sign-in session has expired. Sign out, sign back in, and try again.');
    }
    throw new Error((json as any)?.error || `HTTP ${res.status}`);
  }
  return (json as any).url as string;
}

/** Sanitises a template name into a safe PDF file name. */
export function pdfFileNameFor(name: string, suffix = ''): string {
  return `${(name || 'template').replace(/[^a-z0-9]+/gi, '-')}${suffix}.pdf`;
}
