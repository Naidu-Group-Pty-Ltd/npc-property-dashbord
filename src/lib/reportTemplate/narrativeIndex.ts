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

/**
 * The heading level a contents list should name.
 *
 * Normally the run's own TOP level: the Compass's narrative carries 18 `h2`
 * sections and 26 `h3` subsections, and listing both is 51 rows on a page
 * fitting about 30 — `fitTocEntries` would then omit the tail, losing the END
 * of the document rather than its detail.
 *
 * **But a narrative that wraps everything in one `h1` has a top level with a
 * single member, and that member is the document's own title.** Measured 18
 * September 2026 on a real Financial Analysis render: the body carries 21
 * headings — one `h1` (*Client Investment Feasibility & Financial Performance
 * Report*) over six `h2` sections and fourteen `h3` subsections — so the top
 * level was level 1, level 1 held exactly one row, and a nineteen-page
 * document's contents read:
 *
 * ```
 * 1. Cover                                                            1
 * 2. Contents                                                         2
 * 3. Executive dashboard                                              3
 * 4. Client Investment Feasibility & Financial Performance Report     4
 * 5. Important information                                           19
 * ```
 *
 * Five rows for nineteen pages, one of them covering fifteen. Every section a
 * reader opens a contents page to find — the yield positioning, the risk
 * dashboard, the recommendation — was inside row 4 and reachable only by
 * turning pages. That is the same defect the section index was built to close,
 * surviving in the one shape it does not catch.
 *
 * So a level holding a single section is a TITLE rather than a tier, and the
 * list descends past it. The descent stops at the first level with more than
 * one section, which is the shallowest level that is actually a section list;
 * where no level has more than one, the top level stands, because a document
 * with one section has one section.
 *
 * A master that wants more than this level still sets `sectionDepth`.
 */
export function listedSectionLevel(sections: readonly NarrativeIndexSection[]): number {
  if (!sections.length) return 0;
  const countByLevel = new Map<number, number>();
  for (const s of sections) countByLevel.set(s.level, (countByLevel.get(s.level) ?? 0) + 1);
  const levels = [...countByLevel.keys()].sort((a, b) => a - b);
  for (const level of levels) if ((countByLevel.get(level) ?? 0) > 1) return level;
  return levels[0];
}
