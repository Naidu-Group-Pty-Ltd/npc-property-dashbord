/**
 * Which of the report's own sections landed on which rendered page.
 *
 * A contents list and a PDF outline both name parts of a document, and on the
 * template path they named PAGE ARCHETYPES: a real 36-page Investment Compass
 * listed *Cover · Contents · Executive dashboard · The assessment · Risk and
 * recommendation · The report · Sources and methodology · Important
 * information* — eight rows for a body of twenty-one sections, because the
 * twenty-nine narrative sheets fold into the one row named "The report".
 * Everything a reader opens a contents page to find was inside that row.
 *
 * The sections were there the whole time; nothing had read them. A
 * `markdown-block` packs its source into buckets and draws bucket `pageIndex`,
 * so the headings in THAT bucket are the sections that page opens — a mapping
 * only the renderer can make, because pagination and conditional content
 * decide it. The renderer computes it once and publishes it here; the contents
 * block renders it and the page's own outline entry stands down for it, so the
 * two surfaces cannot describe the document differently.
 *
 * The key is named in this one module because a literal at each end is how two
 * ends drift.
 */

/** Where the index is published on the render context's `data`. */
export const NARRATIVE_INDEX_KEY = '__narrativeIndex';

export interface NarrativeIndexSection {
  /** The heading's printed text. */
  label: string;
  /** The heading's own level, as `renderMarkdown` assigned it. */
  level: number;
  /** Index into `visiblePages` — the same index `renderPage` stamps as `id="tpl-page-N"`. */
  pageIndex: number;
  /** The heading's own element id, so a link lands on the section and not the sheet. */
  anchor: string;
}

export interface NarrativeIndex {
  /**
   * Every visible page the narrative draws on, opening a section or not.
   *
   * A sheet in the MIDDLE of a section is not a part of the document, so it
   * contributes no name of its own to either surface. Pages 25 to 28 of a real
   * Compass are the middle of the risk register, and they were announcing
   * themselves as "The report (20)" … "The report (23)".
   */
  narrativePages: number[];
  /** Document order: page by page, and within a page, bucket order. */
  sections: NarrativeIndexSection[];
}

/** The index a context carries, or an empty one — never null, so no caller branches. */
export function narrativeIndexFrom(data: unknown): NarrativeIndex {
  const raw = (data as Record<string, unknown> | undefined)?.[NARRATIVE_INDEX_KEY] as
    Partial<NarrativeIndex> | undefined;
  return {
    narrativePages: Array.isArray(raw?.narrativePages) ? raw!.narrativePages : [],
    sections: Array.isArray(raw?.sections) ? raw!.sections : [],
  };
}
