/** Resource policy for HTML sent to the server-side PDF renderer.
 *
 * Render HTML is client supplied, so every network URL must be treated as an
 * SSRF primitive. Render jobs may use embedded data resources or objects from
 * this project's Supabase origin; all other network/file references must be
 * normalized by the client before the HTML reaches this trust boundary.
 */

const URL_TOKEN = /(?:https?:)?\/\/[^\s"'<>),]+|(?:file|ftp|gopher):[^\s"'<>),]+/gi;

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
  const decoded = decodeHtmlEntities(html);
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
