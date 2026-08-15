/**
 * Builder stock — which page of an uploaded PDF a property came off.
 *
 * A PDF stock list has no rows and no cells: its properties are read out of
 * prose, and the prose arrives as one string per page. That page number is the
 * only structure the document offers, and it is enough — a property described
 * on page 3 and the photograph drawn on page 3 are about the same house.
 *
 * So this answers one question: which page does each imported property belong
 * to? The answer becomes an ordinary source anchor, the same reserved
 * mechanism a Notion row id and a spreadsheet cell already travel through, and
 * `attributeDocumentMedia` then does the attaching.
 *
 * TWO RULES, AND THEY REFUSE MORE OFTEN THAN THEY ANSWER:
 *
 *   • A property anchors to a page only when EXACTLY ONE page names it. Two
 *     pages naming the same lot is the document declining to say which one is
 *     its record, and the answer to that is no anchor and no picture.
 *   • A document that produced exactly ONE property is that property's
 *     document, and it anchors to the FIRST page presenting a photograph —
 *     the page the brochure leads with, which is the same rule a package PDF
 *     reached through a Notion row already follows. Later pages stay
 *     unanchored: a display-village shot on page 4 is kept against the upload
 *     and shown against nobody.
 *
 * Pure: no imports, no IO, no clock.
 */

/** The anchor vocabulary. Minted here so both halves cannot drift. */
export const pdfPageAnchor = (page: number): string => `pdf:page${page}`;

/** The page an anchor names, or null when the anchor is not one of ours. */
export function pdfAnchorPage(anchor: string | null | undefined): number | null {
  const match = /^pdf:page(\d+)$/.exec(String(anchor ?? ''));
  return match ? Number(match[1]) : null;
}

/** Tokens of a label, in order, punctuation and case removed. */
function tokenise(value: string): string[] {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0);
}

/**
 * How much of a label has to appear on a page before the page is said to name
 * it.
 *
 * The whole label rarely appears verbatim: a PDF breaks lines wherever the
 * layout did, so "Lot 537 Kirramingly Avenue, Donnybrook" can arrive as three
 * fragments. Matching the label's tokens as a SET survives that, and requiring
 * several of them keeps "Lot 5" from matching every page that mentions a 5.
 */
const MIN_TOKENS = 2;
const MAX_TOKENS = 8;

/** Does this page name this property? */
export function pageNamesLabel(pageText: string, label: string): boolean {
  const tokens = tokenise(label).slice(0, MAX_TOKENS);
  if (tokens.length < MIN_TOKENS) return false;
  const haystack = ` ${tokenise(pageText).join(' ')} `;
  return tokens.every((token) => haystack.includes(` ${token} `));
}

/**
 * The page each property belongs to, or null where the document does not say.
 *
 * `photoPages` is the pages that actually presented a photograph, in document
 * order. It is used only for the single-property rule, where a document about
 * one house needs no text matching to be unambiguous.
 */
export function anchorPdfRowsToPages(
  labels: string[],
  pageTexts: string[],
  photoPages: number[] = [],
): Array<string | null> {
  if (!labels.length) return [];

  // One property: the document is that property's, and it leads with its
  // picture. Nothing later is claimed — see the header.
  if (labels.length === 1 && photoPages.length >= 1) {
    return [pdfPageAnchor(photoPages[0])];
  }

  return labels.map((label) => {
    const matches: number[] = [];
    pageTexts.forEach((text, index) => {
      if (pageNamesLabel(text, label)) matches.push(index + 1);
    });
    // Exactly one page, or nothing. A property named on two pages has not been
    // located by the document, and a guess here becomes somebody else's house
    // on a client's card.
    return matches.length === 1 ? pdfPageAnchor(matches[0]) : null;
  });
}
