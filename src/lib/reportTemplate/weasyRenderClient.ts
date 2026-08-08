/**
 * weasyRenderClient — single client entry point for the `render-template-pdf`
 * edge function (HTML → WeasyPrint → storage URL).
 *
 * The editor previously had two hand-rolled copies of this fetch (live PDF
 * preview + "Render with WeasyPrint" export action); keep them in sync by
 * routing both through here.
 *
 * TRANSPORT: this goes through `invokeSecureFunction`, the same transport the
 * rest of the app uses, and must keep doing so. The hand-rolled `fetch` that
 * lived here built its URL from `import.meta.env.VITE_SUPABASE_PROJECT_ID` —
 * a variable this project does not define at build time (there is no `.env`,
 * and `vite.config.ts` defines no fallback), so Vite could not inline it and
 * the bundle computed `https://undefined.supabase.co/functions/v1/…` at
 * runtime. Every WeasyPrint preview and every template PDF export failed
 * before it left the browser: the edge logs recorded no request at all, while
 * the UI reported a network error or "authentication required". The same fetch
 * also predated cookie-only sessions, so even against the right host it
 * carried no credential the function accepts.
 *
 * `invokeSecureFunction` hardcodes the project URL and anon key (like
 * `integrations/supabase/client.ts` does), resolves the bearer, sends the
 * HttpOnly session cookie, refreshes-and-retries once on an auth failure, and
 * normalises the error. Do not reintroduce a bare `fetch` here.
 */
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';

/** A WeasyPrint render is minutes, not seconds, at print resolution. */
const RENDER_TIMEOUT_MS = 10 * 60_000;

export interface WeasyRenderRequest {
  html: string;
  fileName: string;
  templateId?: string;
  mode?: 'preview' | 'production';
  /** Abort a superseded render (the editor supersedes previews as you type). */
  signal?: AbortSignal;
}

/** Renders HTML via the WeasyPrint edge function; resolves to the PDF URL. */
export async function renderHtmlToPdfUrl(
  { html, fileName, templateId, mode = 'preview', signal }: WeasyRenderRequest,
): Promise<string> {
  const { data, error } = await invokeSecureFunction<{ url?: string }>(
    'render-template-pdf',
    { html, fileName, templateId, mode },
    { timeoutMs: RENDER_TIMEOUT_MS, signal },
  );
  if (error) throw new Error(describeAuthError(error.message) ?? error.message);
  const url = data?.url;
  if (!url) throw new Error('WeasyPrint render returned no document URL');
  return url;
}

/** Sanitises a template name into a safe PDF file name. */
export function pdfFileNameFor(name: string, suffix = ''): string {
  return `${(name || 'template').replace(/[^a-z0-9]+/gi, '-')}${suffix}.pdf`;
}
