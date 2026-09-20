/**
 * A footnote marker in a document that has no footnotes.
 *
 * ## What reached the page
 *
 * Five sentences of the Investment Compass issued for 97 Poole Road,
 * Kellyville on 20 Sep 2026 ended in a bare digit, set in the body face at
 * body size, glued to the full stop before it:
 *
 * ```
 * p21  …which medians do not capture.12 Median house prices in postcode 2155…
 * p21  …over both the short and medium term.2 The 4-period median price series…
 * p22  …rather than a thinly traded niche.2 This volume is specific to the…
 * p22  …according to the Australian Bureau of Statistics.4 This very modest…
 * p23  …than as a safety score.3 Latest recorded counts by offence category…
 * ```
 *
 * The document carries no footnotes, so each digit refers to nothing.
 *
 * ## What wrote them, established by execution rather than inferred
 *
 * Every other form a citation could take survives the pipeline VISIBLY
 * different, so none of them can be the source. Driven through the real
 * write-path stripper in `generate-investment-report` and then through
 * `renderMarkdown`:
 *
 * ```
 * capture.[12] Median     -> capture. Median            (stripped, correctly)
 * capture.[^12] Median    -> capture.[^12] Median       (numeric id kept as prose)
 * capture.¹² Median       -> capture.¹² Median          (superscripts survive)
 * capture.\[12\] Median   -> capture.\[12\] Median
 * capture.**[12]** Median -> capture.* Median
 * capture.<sup>12</sup>   -> capture.&lt;sup&gt;12&lt;/sup&gt;
 * capture.(12) Median     -> capture.(12) Median
 * capture.12 Median       -> capture.12 Median          <- the only match
 * ```
 *
 * So the model wrote the marker as a bare digit with no markup at all, which
 * is what a writer does when it wants a superscript and the format has none.
 * The generator's prompt asks for `[^id]` (line 1569) and its stripper already
 * handles `[1]`, `[1][2]` and `[citation]` — this is the one form neither
 * reaches, and it is the form that shipped.
 *
 * ## Why this is not the prose scrub this repository forbids
 *
 * Two things hold it apart, and both are checkable rather than argued.
 *
 * **It is conditional on the document.** A marker is debris only where there
 * is no apparatus for it to refer to, so this asks the document first: a body
 * carrying a `**Notes**` list or any `[^id]:` definition is left entirely
 * alone, markers and all. That is the same shape as "asserted by effect, never
 * by configuration" — the document says whether its markers mean anything.
 *
 * **A digit between two sentences is in neither of them.** Removing it cannot
 * change a claim, a figure or a source, which is what makes this punctuation
 * rather than prose — the distinction `rewriteScaffoldingPointers` draws in
 * those words one file over.
 *
 * ## The shape, and why each bound is there
 *
 * A sentence end, then one or two digits, then the start of the next sentence:
 *
 *  - **at least three lowercase letters** immediately before the stop, which
 *    is what a word ends with and what an abbreviation does not — it is the
 *    bound that keeps `No.3 Smith Street`, `Fig.2` and `p.12` out;
 *  - the token before the stop is not in `ABBREVIATIONS`, a closed list, for
 *    the longer abbreviations three letters admits;
 *  - **one or two digits**, because footnotes run 1..99 and a third digit is
 *    a number;
 *  - then whitespace and a capital letter, or the end of the block — a new
 *    sentence, never a continuing phrase.
 *
 * Measured over the 38 pages of the document above: 5 matches, all five the
 * markers, 0 false positives. `s.10.7 planning certificate`, `(CC BY 4.0)`,
 * `api.apps1.nsw.gov.au` and `Clause 4.3` are all excluded by shape.
 *
 * One document is not a distribution, and this file does not pretend
 * otherwise: the bounds are chosen to fail closed — a marker left standing is
 * the defect that shipped, an edited sentence would be worse.
 */

/**
 * Words that end in three or more lowercase letters, take a full stop, and are
 * abbreviations rather than sentence ends. A closed list: each one is a form
 * that could otherwise precede a figure.
 */
export const ABBREVIATIONS: readonly string[] = [
  'approx', 'para', 'vol', 'fig', 'sec', 'art', 'chap', 'ref', 'ave',
  'est', 'max', 'min', 'inc', 'ltd', 'pty', 'etc', 'nos', 'apt', 'dept',
];

const ABBR = new Set(ABBREVIATIONS);

/**
 * A marker: a sentence end, one or two digits, and the next sentence.
 *
 * Group 1 is the word the sentence ended on, so the abbreviation test reads
 * the token rather than guessing from the match.
 */
const MARKER = /([A-Za-z]*[a-z]{3})\.(\d{1,2})(?=\s+[A-Z“"(]|\s*$)/gm;

/** A document that carries footnotes keeps its markers, whatever they look like. */
export function hasFootnoteApparatus(markdown: string): boolean {
  if (/^\s*\*\*Notes\*\*\s*$/m.test(markdown)) return true;
  // A definition — `[^id]: text` — at the head of a line.
  if (/^\s*\[\^[^\]\s]{1,40}\]:/m.test(markdown)) return true;
  // A numbered note list under a Notes lead-in, as `resolveFootnotes` emits.
  return /^\s*\[\d{1,2}\]\s+\S/m.test(markdown);
}

export interface FootnoteDebrisResult {
  readonly markdown: string;
  /** One entry per marker removed, in document order: the word and the digits. */
  readonly removed: ReadonlyArray<{ after: string; marker: string }>;
}

/**
 * Remove footnote markers from a document that has no footnotes.
 *
 * Returns the source unchanged, and an empty list, for a document that carries
 * an apparatus or carries no marker.
 */
export function stripFootnoteDebris(markdown: string): FootnoteDebrisResult {
  if (!markdown || hasFootnoteApparatus(markdown)) {
    return { markdown: markdown ?? '', removed: [] };
  }
  const removed: Array<{ after: string; marker: string }> = [];
  const out = markdown.replace(MARKER, (whole, word: string, digits: string) => {
    if (ABBR.has(word.toLowerCase())) return whole;
    removed.push({ after: word, marker: digits });
    return `${word}.`;
  });
  return removed.length ? { markdown: out, removed } : { markdown, removed: [] };
}
