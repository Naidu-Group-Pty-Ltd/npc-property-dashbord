/**
 * Text handling shared by every report format.
 *
 * One function lives here today, and it is here rather than in a format module
 * because two formats now need it and a second copy is the defect this
 * programme removes. The Cash Flow Comparison wrote it first; the Report Q&A
 * export cannot render a single conversation without it.
 */

/**
 * Turn a URL in model prose back into plain text.
 *
 * Not hygiene — a correctness fix for a failure that takes the whole document
 * down. `assertSafeRenderResources` decodes HTML entities *first*
 * (`renderResourcePolicy.pure.ts:68`) and then throws on any `//host`,
 * `http(s)://`, `file:`, `ftp:` or `gopher:` token **anywhere in the HTML**,
 * including inside escaped body text:
 *
 *     Remote render resources must be normalized into project storage
 *
 * So a model that writes "per corelogic.com.au/median-values" with a scheme on
 * the front fails the render with an error naming no field and no line. Escaping
 * does not help: the policy undoes it before it looks.
 *
 * The scheme and its slashes are removed and the rest of the token kept, so the
 * sentence still reads and still says where the claim came from — `URL_TOKEN`
 * does not match a bare host. Dropping the whole token would silently delete a
 * citation from a client's document, which is a worse answer than a link that
 * is not clickable in a PDF anyway.
 *
 * ## Run this *after* any pass that removes characters
 *
 * Stripping zero-width characters is what *creates* a scheme-relative URL. A
 * slash, a U+200B, a slash is inert until the zero-width space goes, and then it
 * is a live `//` the policy throws on. Any sanitiser that deletes codepoints —
 * the Q&A export's glyph pass is the one that does — must run before this,
 * never after.
 */
export function neutraliseUrls(value: string): string {
  return value
    .replace(/(?:https?:)?\/\/+/gi, '')
    .replace(/\b(?:file|ftp|gopher):\/*/gi, '');
}

/** How many URL tokens `neutraliseUrls` would rewrite. For a ledger count. */
export function countUrlTokens(value: string): number {
  const schemeRelative = value.match(/(?:https?:)?\/\/+/gi)?.length ?? 0;
  const otherSchemes = value.match(/\b(?:file|ftp|gopher):\/*/gi)?.length ?? 0;
  return schemeRelative + otherSchemes;
}
