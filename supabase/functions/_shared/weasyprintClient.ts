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
  /**
   * Refuse a document the engine could not render whole.
   *
   * Off for client-facing renders: a dropped `text-wrap` is cosmetic and a
   * person waiting on a report is not served by a 422. On for CI and for
   * `scripts/reports/engineCheck.mts`, where a warning is the whole point.
   */
  strict?: boolean;
}

/**
 * What the engine said while it was rendering.
 *
 * WeasyPrint does not fail on CSS it cannot implement — it logs a line and
 * renders the document without it. That log went to the container's stderr and
 * no caller ever saw it, which is how a stylesheet written against one version
 * and printed by another shipped a broken cover on every render for a day.
 *
 * `warnings` is empty for a document the engine rendered whole. Anything in it
 * is a declaration that did not reach the page.
 */
export interface WeasyPrintDiagnostics {
  pdf: Uint8Array;
  /** The engine's own page count, not inferred from the bytes. */
  pages: number | null;
  /** Declarations the engine dropped, verbatim. */
  warnings: string[];
  /** The version that actually rendered it. Pinned, and worth recording. */
  engine: string | null;
  /** Whether a structure tree was written. An untagged PDF is not navigable. */
  tagged: boolean | null;
  renderMs: number | null;
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

/** A header the service may not be new enough to send. */
function headerInt(res: Response, name: string): number | null {
  const raw = Number(res.headers.get(name));
  return Number.isFinite(raw) ? raw : null;
}

/**
 * The dropped declarations, or an empty list.
 *
 * JSON in a header, so it is parsed defensively: a proxy that truncates it, or
 * a service too old to send it, must degrade to "nothing reported" rather than
 * failing a render that otherwise succeeded.
 */
function readWarnings(res: Response): string[] {
  const raw = res.headers.get('X-WeasyPrint-Warnings');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

/**
 * Render HTML to PDF bytes, and hand back what the engine said about it.
 *
 * Throws on anything other than a 200 with a body, with the service's own
 * message included — a 500 that says only "render failed" costs an hour.
 */
export async function renderPdfWithDiagnostics(
  config: WeasyPrintConfig,
  html: string,
  options: WeasyPrintOptions = {},
): Promise<WeasyPrintDiagnostics> {
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
        strict: options.strict === true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WeasyPrint render failed (${res.status}): ${body.slice(0, 400)}`);
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) throw new Error('WeasyPrint returned an empty body');
    const taggedHeader = res.headers.get('X-Pdf-Tagged');
    return {
      pdf: new Uint8Array(buffer),
      pages: headerInt(res, 'X-Pdf-Pages'),
      warnings: readWarnings(res),
      engine: res.headers.get('X-WeasyPrint-Version'),
      tagged: taggedHeader === null ? null : taggedHeader === '1',
      renderMs: headerInt(res, 'X-Render-Ms'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Render HTML to PDF bytes.
 *
 * The nine render routes want bytes and nothing else. `renderPdfWithDiagnostics`
 * is for a caller that wants to record what the engine dropped — the converter's
 * route, CI, and the engine check.
 */
export async function renderPdf(
  config: WeasyPrintConfig,
  html: string,
  options: WeasyPrintOptions = {},
): Promise<Uint8Array> {
  return (await renderPdfWithDiagnostics(config, html, options)).pdf;
}

/** Latin-1 decode. Keeps byte values intact; the tokens matched are ASCII. */
function asLatin1(bytes: Uint8Array): string {
  let text = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return text;
}

/** `/Type /Page` outside a `/Pages` node is one page. Stable across producers. */
function countPageTokens(text: string): number {
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * The number of pages in a PDF, or `null`.
 *
 * Counted from the bytes rather than asked of a library.
 *
 * **This returns `null` for every document WeasyPrint produces**, and did so
 * for every render in this programme until it was measured. WeasyPrint packs
 * its page objects into compressed object streams — the raw bytes hold
 * `/Type /ObjStm … /Filter /FlateDecode` and the `/Type /Page` token appears
 * nowhere outside them — so the scan finds zero matches and, by its own rule,
 * says it does not know. It was not wrong; it was blind. Use
 * `countPdfPagesAsync`, which inflates the streams first.
 *
 * Kept, un-deprecated, because it is correct and synchronous for an uncompressed
 * PDF and it is the first thing the async version tries.
 */
export function countPdfPages(pdf: Uint8Array): number | null {
  const matches = countPageTokens(asLatin1(pdf));
  return matches ? matches : null;
}

/**
 * `/Type /ObjStm` … `stream` … `endstream`, capturing the dictionary and the
 * payload separately.
 *
 * The dictionary is captured because it carries `/Length`, and `/Length` is the
 * only exact answer. Slicing at `endstream` overshoots by the end-of-line the
 * spec puts before the keyword — one byte here — and a deflate stream handed
 * one trailing byte fails with `failed to write whole buffer` rather than
 * inflating what it can. That single byte is why the first version of this
 * counted zero pages in a PDF whose object stream inflated perfectly under
 * `zlib.decompress`.
 */
const OBJ_STREAM = /\/Type\s*\/ObjStm([\s\S]{0,400}?)stream\r?\n([\s\S]*?)endstream/g;

/**
 * The number of pages, looking inside compressed object streams.
 *
 * Async because inflating needs `DecompressionStream`, which is a stream API.
 * That is the entire reason this is a second function rather than a fix to the
 * first: every caller records the count on a row it is already `await`ing a
 * write to, so the cost is nothing, but the signature change is not free.
 *
 * Still `null` on genuine failure — an encrypted PDF, a producer using a filter
 * other than Flate, a truncated file. A wrong page count is worse than an
 * absent one: the column exists so that a document which silently lost its
 * audit trail shows up as a count that moved, and a fabricated number defeats
 * exactly that.
 */
export async function countPdfPagesAsync(pdf: Uint8Array): Promise<number | null> {
  const raw = asLatin1(pdf);
  const direct = countPageTokens(raw);
  if (direct) return direct;

  let found = 0;
  for (const match of raw.matchAll(OBJ_STREAM)) {
    const declared = Number(/\/Length\s+(\d+)/.exec(match[1] ?? '')?.[1]);
    let payload = match[2];
    if (!payload) continue;
    payload = Number.isFinite(declared) && declared > 0 && declared <= payload.length
      ? payload.slice(0, declared)
      // No `/Length` — an indirect one, which is legal. Drop the end-of-line
      // the spec requires before `endstream` and hope the data does not end in
      // one itself.
      : payload.replace(/\r?\n$/, '');
    const bytes = new Uint8Array(payload.length);
    for (let i = 0; i < payload.length; i += 1) bytes[i] = payload.charCodeAt(i) & 0xff;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      found += countPageTokens(asLatin1(inflated));
    } catch {
      // One unreadable stream is not a reason to abandon the others; a PDF
      // mixing filters still yields a count from the streams that did inflate.
      continue;
    }
  }
  return found || null;
}
