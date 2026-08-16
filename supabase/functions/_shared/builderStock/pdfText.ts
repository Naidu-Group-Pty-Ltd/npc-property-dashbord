/**
 * Builder stock — a PDF's prose, one string per VISIBLE page.
 *
 * ONE implementation, because two callers need the same page numbering and a
 * disagreement between them is invisible. `extract.ts` reads a directly
 * uploaded PDF's text to find its properties; `packageImages.ts` reads a linked
 * package's text to find the page that presents the property as a package. If
 * those two numbered pages differently, a brochure uploaded through the portal
 * and the same brochure reached through a Notion row's link would attach
 * different pictures to the same house.
 *
 * `mergePages: false` is not an option here, it is the point: the page is the
 * only structure a PDF offers, and the merged string throws it away.
 *
 * pdf.js takes OWNERSHIP of the array it is handed and leaves the buffer
 * detached, which is why it is given its own copy — reading the text used to
 * empty the very bytes the photographs are then read out of.
 */

/** The text of each page, in the document's own order. Empty when unreadable. */
export async function readPdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  try {
    const { extractText, getDocumentProxy } = await import('https://esm.sh/unpdf@0.12.1');
    const pdf = await getDocumentProxy(bytes.slice());
    const { text } = await extractText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [String(text ?? '')]).map((page) => String(page ?? ''));
  } catch {
    // A PDF whose text will not come out is one no page can be read as a cover
    // of. The caller's answer to that is no primary image, which is correct.
    return [];
  }
}
