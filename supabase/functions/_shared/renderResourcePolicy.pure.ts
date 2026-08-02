/** Resource policy for HTML sent to the server-side PDF renderer.
 *
 * Render HTML is client supplied, so every network URL must be treated as an
 * SSRF primitive. Render jobs may use embedded data resources or objects from
 * this project's Supabase origin; all other network/file references must be
 * normalized by the client before the HTML reaches this trust boundary.
 */

const URL_TOKEN = /(?:https?:)?\/\/[^\s"'<>),]+|(?:file|ftp|gopher):[^\s"'<>),]+/gi;

/**
 * An XML namespace declaration, which is an identifier and not a resource.
 *
 * `<svg xmlns="http://www.w3.org/2000/svg">` is how every inline SVG in this
 * codebase opens — the report charts, the template builder's curved-text block,
 * the QR code block. WeasyPrint never fetches a namespace URI; it compares it
 * as a string. Treating it as a network reference rejected the whole document,
 * which is what made every Borrowing Capacity Snapshot fail with "Remote render
 * resources must be normalized into project storage" and took any template
 * carrying a QR code down with it.
 *
 * Only the `xmlns` and `xmlns:prefix` attributes are removed, and only their
 * quoted values. A URL smuggled into an attribute by that name is still never
 * fetched — the renderer resolves resources from `src`, `href`, `url()` and
 * `@import`, none of which this touches. `xlink:href` is deliberately not
 * matched: that one *is* fetchable and must stay under the policy.
 */
const XMLNS_DECLARATION = /\sxmlns(?::[a-zA-Z][\w.-]*)?\s*=\s*(?:"[^"]*"|'[^']*')/g;

/**
 * The base64 payload of a `data:` URI, which is opaque bytes and not markup.
 *
 * The base64 alphabet includes `/`, so any embedded image large enough will
 * eventually contain `//` — and `URL_TOKEN` reads that as a scheme-relative
 * URL and rejects the document. A 240 KB logo hits it essentially every time,
 * which is why inlining a brand asset (the thing `assets.pure.ts` requires)
 * made the render fail with "Remote render resources must be normalized into
 * project storage" and pointed at nothing.
 *
 * Only the **base64** form is skipped. A `data:` URI without `;base64` carries
 * percent-encoded text — an SVG document, say — which can name a real host and
 * therefore stays under the policy. The media type prefix is left in the text
 * being scanned too, so nothing about *what* the URI claims to be is hidden.
 */
const DATA_URI_BASE64_PAYLOAD = /;base64,[A-Za-z0-9+/=]*/g;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);?/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);?/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&colon;/gi, ':')
    .replace(/&sol;/gi, '/')
    .replace(/&amp;/gi, '&');
}

function configuredOrigin(rawSupabaseUrl: string): string {
  try {
    const url = new URL(rawSupabaseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** Throws before WeasyPrint is invoked if HTML could make a network request. */
export function assertSafeRenderResources(html: string, supabaseUrl: string): void {
  const decoded = decodeHtmlEntities(html)
    .replace(XMLNS_DECLARATION, ' ')
    .replace(DATA_URI_BASE64_PAYLOAD, ';base64,');
  const allowedOrigin = configuredOrigin(supabaseUrl);

  for (const token of decoded.match(URL_TOKEN) ?? []) {
    if (!token.startsWith('http://') && !token.startsWith('https://') && !token.startsWith('//')) {
      throw new Error('Render HTML contains a forbidden resource scheme');
    }

    let url: URL;
    try {
      url = new URL(token, allowedOrigin || undefined);
    } catch {
      throw new Error('Render HTML contains an invalid resource URL');
    }

    const isProjectStorageObject = allowedOrigin
      && url.origin === allowedOrigin
      && url.pathname.startsWith('/storage/v1/object/');
    if (!isProjectStorageObject) {
      throw new Error('Remote render resources must be normalized into project storage');
    }
  }
}
