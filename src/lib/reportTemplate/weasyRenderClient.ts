/**
 * weasyRenderClient — single client entry point for the `render-template-pdf`
 * edge function (HTML → WeasyPrint → storage URL).
 *
 * The editor previously had two hand-rolled copies of this fetch (live PDF
 * preview + "Render with WeasyPrint" export action); keep them in sync by
 * routing both through here.
 *
 * TRANSPORT: this goes through `invokeSecureFunction`, the same transport the
 * rest of the app uses, and must keep doing so.
 *
 * The hand-rolled `fetch` it replaces built its URL from
 * `import.meta.env.VITE_SUPABASE_PROJECT_ID` and its apikey from
 * `VITE_SUPABASE_PUBLISHABLE_KEY`. The hosting build defines those, so it did
 * work in production — but nothing else in the app depends on them:
 * `integrations/supabase/client.ts` and `secureInvoke.ts` both hardcode the
 * project precisely because the repo ships no `.env` and `vite.config.ts`
 * declares no fallback. A repo or CI build therefore compiled this call site
 * into a request to `https://undefined.supabase.co`, and only this call site.
 * That is one environment away from a dead render path, for no benefit.
 *
 * `invokeSecureFunction` hardcodes the project URL and anon key like the rest
 * of the app, resolves the bearer, sends the HttpOnly session cookie,
 * refreshes-and-retries once on an auth failure, and normalises the error. Do
 * not reintroduce a bare `fetch` here.
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
