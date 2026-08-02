/**
 * The one place a report is turned into a PDF.
 *
 * `render-template-pdf` carried its own copy of this, and every new render path
 * would have carried another — each with its own idea of the timeout, of which
 * environment variable holds the token, and of what to do with a non-200. The
 * details below are not arbitrary and are worth having once:
 *
 *  - **Two variable names for the token.** Deployed environments have both
 *    `WEASYPRINT_SERVICE_TOKEN` and the older `WEASYPRINT_API_KEY`; a path that
 *    reads only one works in one project and 401s in another.
 *  - **Quotes are stripped.** A secret pasted into the dashboard with the quotes
 *    around it produces a bearer token that is silently wrong.
 *  - **No fallback.** When WeasyPrint is configured and fails, the caller must
 *    fail too. `render-investment-report-pdf` re-throws for this reason: a
 *    silent downgrade to a lesser renderer ships a client a document that does
 *    not look like the one that was approved.
 */

/** PDF/A-2b is the archival default; 1.7 exists for cases that need features it forbids. */
export type PdfVariant = 'pdf/a-2b' | 'pdf/a-3b' | 'pdf-1.7';

export const PDF_VARIANTS: readonly PdfVariant[] = ['pdf/a-2b', 'pdf/a-3b', 'pdf-1.7'];

/** Coerce an untrusted string to a variant, defaulting rather than rejecting. */
export function toPdfVariant(value: unknown, fallback: PdfVariant = 'pdf/a-2b'): PdfVariant {
  const raw = typeof value === 'string' ? value.toLowerCase().trim() : '';
  return (PDF_VARIANTS as readonly string[]).includes(raw) ? raw as PdfVariant : fallback;
}

/**
 * Ten minutes.
 *
 * A forty-page report with inlined assets is minutes, not seconds, and a
 * timeout shorter than the work turns a slow render into a failed one.
 */
export const WEASYPRINT_TIMEOUT_MS = 600_000;

/** The service's own cap. Checked before the POST so the error names the cause. */
export const MAX_HTML_BYTES = 25 * 1024 * 1024;

export interface WeasyPrintOptions {
  variant?: PdfVariant;
  /** Tagged PDF. On by default — an untagged report is not navigable. */
  tagged?: boolean;
  optimizeImages?: boolean;
  timeoutMs?: number;
}

export interface WeasyPrintConfig {
  url: string;
  token: string;
}

/**
 * Read the service configuration, or explain what is missing.
 *
 * Separate from the call so a caller can fail fast with a message a human can
 * act on, rather than at the fetch.
 */
export function weasyPrintConfig(env: (key: string) => string | undefined): WeasyPrintConfig | null {
  const url = (env('WEASYPRINT_SERVICE_URL') || '').trim().replace(/\/$/, '');
  const token = (env('WEASYPRINT_SERVICE_TOKEN') || env('WEASYPRINT_API_KEY') || '')
    .trim()
    .replace(/^["']|["']$/g, '');
  return url && token ? { url, token } : null;
}

/**
 * Render HTML to PDF bytes.
 *
 * Throws on anything other than a 200 with a body, with the service's own
 * message included — a 500 that says only "render failed" costs an hour.
 */
export async function renderPdf(
  config: WeasyPrintConfig,
  html: string,
  options: WeasyPrintOptions = {},
): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_HTML_BYTES) {
    throw new Error(
      `document is ${bytes} bytes, over the ${MAX_HTML_BYTES}-byte render cap; `
      + 'the usual cause is an inlined asset that should have been rejected by policy',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? WEASYPRINT_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.url}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/pdf',
      },
      body: JSON.stringify({
        html,
        pdf_variant: options.variant ?? 'pdf/a-2b',
        tagged: options.tagged !== false,
        optimize_images: options.optimizeImages !== false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WeasyPrint render failed (${res.status}): ${body.slice(0, 400)}`);
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) throw new Error('WeasyPrint returned an empty body');
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The number of pages in a PDF, or `null`.
 *
 * Counted from the bytes rather than asked of a library: `/Type /Page` outside a
 * `/Pages` node is one page, and that is stable across producers. Recorded on
 * the render row so a document that silently lost its audit trail is visible as
 * a page count that moved, without opening the file.
 */
export function countPdfPages(pdf: Uint8Array): number | null {
  // Latin-1 keeps byte values intact; the tokens being matched are ASCII.
  let text = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < pdf.length; i += CHUNK) {
    text += String.fromCharCode(...pdf.subarray(i, i + CHUNK));
  }
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : null;
}
