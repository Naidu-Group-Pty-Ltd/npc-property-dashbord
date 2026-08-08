/**
 * weasyPreview — render a template to a PDF preview URL via the
 * `render-template-pdf` WeasyPrint edge function.
 *
 * This is the editor-side equivalent of the production renderer used by
 * `routeReportThroughTemplate`. The previous jsPDF preview (`pdfRenderer`)
 * could only ship Helvetica/Times/Courier; switching to WeasyPrint means the
 * in-editor preview matches the customer-facing export pixel-for-pixel
 * (Playfair Display, Google Fonts, custom CSS, etc.).
 *
 * Calls are cached in-memory by SHA-1 of the compiled HTML so re-rendering an
 * unchanged template returns the previous signed URL instantly.
 */
import { resolveAuthBearer, describeAuthError, isAuthFailureResponse } from '@/lib/secureInvoke';
import { preloadImages } from './imagePreloader';
import { renderTemplateToHtml } from './htmlRenderer';
import type { ReportTemplate } from './templateSchema';

export interface WeasyPreviewOptions {
  data?: Record<string, any>;
  customCss?: string;
  title?: string;
  fileName?: string;
  templateId?: string | null;
  templateName?: string | null;
  mode?: 'preview' | 'final';
  signal?: AbortSignal;
}

export interface WeasyPreviewResult {
  url: string;
  fileName: string;
  bytes?: number;
  cached: boolean;
}

const cache = new Map<string, { url: string; fileName: string; bytes?: number; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h (signed URL lives 24h, refresh well before)
const MAX_CACHE = 32;

async function sha1(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt < now) cache.delete(k);
  }
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

/**
 * Compile the template to HTML, send to WeasyPrint, return a signed PDF URL.
 */
export async function renderTemplateViaWeasyPrint(
  template: ReportTemplate,
  opts: WeasyPreviewOptions = {},
): Promise<WeasyPreviewResult> {
  // Reference mode: WeasyPrint fetches assets itself via its safe_url_fetcher
  // rather than receiving them base64-inlined. Inlining is bounded by the
  // service's 25 MB MAX_HTML_BYTES, and an A4 page raster costs ~5.9 MB inlined
  // at 200 DPI and ~13.3 MB at 300 — so an inlined pixel-perfect export blows
  // the cap at roughly two pages, while production imports average 18.5.
  const prepared = await preloadImages(template, { mode: 'reference' });
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');

  const { html } = renderTemplateToHtml(prepared, {
    data: opts.data ?? {},
    title: opts.title ?? 'Template Preview',
    customCss: opts.customCss,
  });

  const fileName = (opts.fileName || 'template-preview.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = await sha1(`${opts.templateId ?? ''}::${opts.mode ?? 'preview'}::${html}`);
  purgeExpired();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { url: hit.url, fileName: hit.fileName, bytes: hit.bytes, cached: true };
  }

  // WP-11B/C cookie-only sessions: the staff session travels in the HttpOnly
  // `__Host-session_token` cookie, so the request MUST go out with
  // `credentials: 'include'` — and the Bearer comes from `resolveAuthBearer`
  // (mirrored access token → native supabase-js session → cookie re-mint),
  // NOT from `supabase.auth.getSession()` alone, which is null for every
  // custom-auth user. This call site predated that migration; after the
  // functions fleet redeployed with cookie-only auth, every render call 401'd
  // "Authentication required" and ALL WeasyPrint previews/exports failed.
  const { token } = await resolveAuthBearer({ refreshIfMissing: true });
  const projectId = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID;
  const anonKey = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!projectId || !anonKey) {
    throw new Error('Supabase env not configured (VITE_SUPABASE_PROJECT_ID / VITE_SUPABASE_PUBLISHABLE_KEY)');
  }

  const url = `https://${projectId}.supabase.co/functions/v1/render-template-pdf`;
  const sendRequest = (credentials: RequestCredentials) => fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
    credentials,
    body: JSON.stringify({
      html,
      fileName,
      templateId: opts.templateId ?? null,
      templateName: opts.templateName ?? null,
      mode: opts.mode ?? 'preview',
    }),
    signal: opts.signal,
  });

  let res: Response;
  try {
    res = await sendRequest('include');
  } catch (err) {
    // A function still running a wildcard-CORS build rejects a credentialed
    // request at the PREFLIGHT — nothing was dispatched — so one uncredentialed
    // retry is side-effect free (same pattern as invokeSecureFunction).
    if ((err as Error)?.name === 'AbortError') throw err;
    res = await sendRequest('omit');
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(json?.error?.message || json?.error || '');
    if (isAuthFailureResponse(res.status, message)) {
      throw new Error(describeAuthError(message || 'authentication required')
        ?? 'Your sign-in session has expired. Sign out, sign back in, and try again.');
    }
    throw new Error(json?.error || `WeasyPrint render failed (HTTP ${res.status})`);
  }
  const result: WeasyPreviewResult = {
    url: String(json.url),
    fileName: String(json.fileName ?? fileName),
    bytes: typeof json.bytes === 'number' ? json.bytes : undefined,
    cached: false,
  };
  cache.set(key, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
