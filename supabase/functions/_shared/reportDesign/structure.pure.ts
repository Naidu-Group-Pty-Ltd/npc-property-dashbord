/**
 * The document spine — the shape every report shares, independent of what is
 * written in it.
 *
 * ## Why this is not another section registry
 *
 * `compassSectionRegistry.ts` already declares *what the sections are* for two
 * formats: their headings, word budgets, visual components, trim priorities.
 * That is content. This module declares *what a document is*: a cover, then a
 * contents, then chapters, then a closing page — and which physical page each
 * of those prints on.
 *
 * Keeping them apart is deliberate. The registry has already been mirrored by
 * hand into `src/lib/reports/` and drifted from 672 lines to 174; copying its
 * section lists into a third place would guarantee a third divergence. A caller
 * passes the registry's sections *into* `buildSpine()` — the two compose rather
 * than overlap.
 *
 * ## What this buys
 *
 * `validateSpine()` catches the structural defects that reach clients: a report
 * with two covers because a retry appended one, a disclaimer that is not last,
 * a contents page listing sections a trim pass removed, a 40-page document that
 * rendered as 12 because a data fetch failed silently. None of those are
 * detectable from the PDF bytes; all of them are detectable here, before the
 * render.
 */
import { type NamedPage } from './page.pure.ts';

/** A structural role in the document. */
export type ReportSlot =
  | 'cover'
  | 'contents'
  | 'chapter'
  | 'divider'
  | 'wide-table'
  | 'closing';

/**
 * Which physical page each slot prints on.
 *
 * The indirection matters: a chapter is a *role*, `chapter-opener` is a *page
 * geometry*, and the day a format wants its chapters to open on the body page
 * that is one entry here rather than a change at every call site.
 */
export const SLOT_PAGE: Record<ReportSlot, NamedPage> = {
  cover: 'cover',
  contents: 'contents',
  chapter: 'chapter-opener',
  divider: 'section-divider',
  'wide-table': 'landscape-table',
  closing: 'disclaimer',
};

export interface SpineEntry {
  slot: ReportSlot;
  /** Stable id. For chapters this is the registry's section id. */
  id: string;
  /** As printed in the contents and the running head. */
  title: string;
  /** Expected page count. Summed and checked against the archetype's band. */
  pageBudget: number;
  /** One line for the contents page. */
  note?: string;
}

export type ReportArchetypeId =
  | 'investment-compass'
  | 'financial-analysis'
  | 'cash-flow-projection'
  | 'market-intelligence'
  | 'borrowing-capacity'
  | 'portfolio-performance'
  | 'snapshot';

export interface ReportArchetype {
  id: ReportArchetypeId;
  /** Printed on the cover and in the running foot. */
  documentName: string;
  /** The word before a chapter number — "Chapter", "Part", "Section". */
  chapterLabel: string;
  /** Slots this format is allowed to use. */
  slots: readonly ReportSlot[];
  /** Inclusive page band. A render outside it is a defect, not a preference. */
  pageBudget: readonly [number, number];
  /** Whether a contents page is expected. Short formats do not carry one. */
  contents: boolean;
  /** Why this archetype differs from the others. */
  note: string;
}

const FULL_SLOTS: readonly ReportSlot[] = ['cover', 'contents', 'chapter', 'divider', 'wide-table', 'closing'];
const SHORT_SLOTS: readonly ReportSlot[] = ['cover', 'chapter', 'closing'];

export const REPORT_ARCHETYPES: Record<ReportArchetypeId, ReportArchetype> = {
  'investment-compass': {
    id: 'investment-compass',
    documentName: 'Investment Location & Property Fit Report',
    chapterLabel: 'Chapter',
    slots: FULL_SLOTS,
    pageBudget: [34, 44],
    contents: true,
    note: 'The macro / locality / property-fit document. Carries no financial '
      + 'modelling — that lives in the Financial Analysis report by design.',
  },
  'financial-analysis': {
    id: 'financial-analysis',
    documentName: 'Financial Analysis Report',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    pageBudget: [16, 26],
    contents: true,
    note: 'Purchase costs through to the ten-year projection. The only archetype '
      + 'that regularly needs the landscape page.',
  },
  'cash-flow-projection': {
    id: 'cash-flow-projection',
    documentName: '10 Year Cash Flow Analysis',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    pageBudget: [6, 14],
    contents: false,
    note: 'A matrix document. The projection table is the artefact; the narrative '
      + 'exists to frame it.',
  },
  'market-intelligence': {
    id: 'market-intelligence',
    documentName: 'Market Intelligence Report',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    pageBudget: [8, 20],
    contents: true,
    note: 'Comparables, trends and commentary for a locality.',
  },
  'borrowing-capacity': {
    id: 'borrowing-capacity',
    documentName: 'Borrowing Capacity Assessment',
    chapterLabel: 'Section',
    slots: SHORT_SLOTS,
    pageBudget: [4, 12],
    contents: false,
    note: 'Serviceability and capacity. Implemented three times in the codebase '
      + 'today; one archetype so the three converge rather than diverge further.',
  },
  'portfolio-performance': {
    id: 'portfolio-performance',
    documentName: 'Portfolio Performance Review',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    // Measured: all 21 stored reports rendered through WeasyPrint land between
    // 18 and 26 pages.
    //
    // The band is far wider than that range, and deliberately so — it is the
    // one archetype whose length scales with its subject. A portfolio is
    // between one and sixty properties, and the sections that describe them
    // grow with the count, so a band tight enough to be a page prediction would
    // refuse to render a legitimate large portfolio. This ceiling is a runaway
    // guard: with `MAX_HOLDINGS` properties and the per-property commentary
    // capped at `DETAIL_CAP`, the spine tops out in the low forties.
    //
    // The floor is the arithmetic minimum, not a preference: cover, contents,
    // where-the-portfolio-stands, one page of holdings matrix and the closing
    // page is seven, and that is what a report whose `report_data.analysis` came
    // back empty produces. That is a real state — the analysis is stored model
    // output parsed out of a fenced code block — and such a document is still
    // worth sending, because the figures in it are the deterministic half.
    // Refusing to render a client's report because the model wrote fewer blocks
    // would turn a content problem into an outage. Found by rendering one.
    pageBudget: [7, 46],
    // The first migrated format long enough to need one. Borrowing Capacity
    // refuses a contents page for four pages and is right to; this document
    // runs to nine sections and the legacy generator built one by hand.
    contents: true,
    note: 'The whole-of-portfolio document: every holding in one landscape '
      + 'matrix, then what the portfolio is, how it performs, and what to do '
      + 'about it. The only format that reads a second, optional table — a '
      + 'portfolio review — to enrich a report it can already write without it.',
  },
  snapshot: {
    id: 'snapshot',
    documentName: 'Property Snapshot',
    chapterLabel: 'Section',
    slots: SHORT_SLOTS,
    // Three is the floor for any document at all: cover, one chapter, closing.
    pageBudget: [3, 6],
    contents: false,
    note: 'The short overview. No contents page — a table of contents for three '
      + 'pages reads as padding.',
  },
};

/** A chapter as the caller supplies it — typically from the section registry. */
export interface ChapterInput {
  id: string;
  title: string;
  pageBudget: number;
  note?: string;
  /** Force this chapter onto the landscape page. */
  wide?: boolean;
}

export interface BuildSpineInput {
  archetype: ReportArchetypeId;
  chapters: readonly ChapterInput[];
  /** Page budget for the cover. One, unless a format says otherwise. */
  coverPages?: number;
  /** Page budget for the closing page. */
  closingPages?: number;
  /** Override the archetype's contents default. */
  contents?: boolean;
}

/**
 * Assemble the full spine: cover, optional contents, the chapters, closing.
 *
 * The cover and closing are added here rather than left to the caller because
 * every report has both, and "the disclaimer page was missing" is the one
 * structural defect with a legal consequence.
 */
export function buildSpine(input: BuildSpineInput): SpineEntry[] {
  const archetype = REPORT_ARCHETYPES[input.archetype];
  const wantContents = input.contents ?? archetype.contents;

  const spine: SpineEntry[] = [{
    slot: 'cover',
    id: `${archetype.id}.cover`,
    title: archetype.documentName,
    pageBudget: input.coverPages ?? 1,
  }];

  if (wantContents && archetype.slots.includes('contents')) {
    spine.push({
      slot: 'contents',
      id: `${archetype.id}.contents`,
      title: 'Contents',
      pageBudget: 1,
    });
  }

  for (const c of input.chapters) {
    spine.push({
      slot: c.wide && archetype.slots.includes('wide-table') ? 'wide-table' : 'chapter',
      id: c.id,
      title: c.title,
      pageBudget: c.pageBudget,
      note: c.note,
    });
  }

  spine.push({
    slot: 'closing',
    id: `${archetype.id}.closing`,
    title: 'Contact & disclaimer',
    pageBudget: input.closingPages ?? 1,
  });

  return spine;
}

/** Total pages the spine claims it will occupy. */
export function spinePageBudget(spine: readonly SpineEntry[]): number {
  return spine.reduce((sum, e) => sum + (Number.isFinite(e.pageBudget) ? e.pageBudget : 0), 0);
}

/**
 * Contents entries for the chapter slots, numbered in printed order.
 *
 * Derived from the spine rather than passed in separately, which is what stops
 * a contents page listing a section a trim pass removed.
 */
export function contentsEntriesFor(
  spine: readonly SpineEntry[],
): Array<{ number: string; title: string; note?: string }> {
  let n = 0;
  return spine
    .filter((e) => e.slot === 'chapter' || e.slot === 'wide-table')
    .map((e) => {
      n += 1;
      return { number: String(n).padStart(2, '0'), title: e.title, note: e.note };
    });
}

/**
 * Every way a spine violates its archetype.
 *
 * Returns an empty array for a valid spine. Messages are written to be read in
 * a CI failure, so each one names the entry it is about.
 */
export function validateSpine(
  archetypeId: ReportArchetypeId,
  spine: readonly SpineEntry[],
): string[] {
  const archetype = REPORT_ARCHETYPES[archetypeId];
  const problems: string[] = [];
  const allowed = new Set(archetype.slots);

  for (const entry of spine) {
    if (!allowed.has(entry.slot)) {
      problems.push(`${entry.id}: slot "${entry.slot}" is not permitted in ${archetype.id}`);
    }
    if (!entry.title.trim()) problems.push(`${entry.id}: has no title`);
    if (!(entry.pageBudget > 0)) {
      problems.push(`${entry.id}: page budget must be positive, got ${entry.pageBudget}`);
    }
  }

  const seen = new Set<string>();
  for (const entry of spine) {
    if (seen.has(entry.id)) problems.push(`${entry.id}: duplicate entry id`);
    seen.add(entry.id);
  }

  const covers = spine.filter((e) => e.slot === 'cover');
  if (covers.length !== 1) problems.push(`expected exactly one cover, found ${covers.length}`);
  else if (spine[0]?.slot !== 'cover') problems.push('the cover must be the first entry');

  const closings = spine.filter((e) => e.slot === 'closing');
  if (closings.length !== 1) {
    problems.push(`expected exactly one closing page, found ${closings.length}`);
  } else if (spine[spine.length - 1]?.slot !== 'closing') {
    problems.push('the closing page must be the last entry');
  }

  const contentsIdx = spine.findIndex((e) => e.slot === 'contents');
  if (contentsIdx > 0 && spine[contentsIdx - 1]?.slot !== 'cover') {
    problems.push('the contents page must follow the cover');
  }
  if (spine.filter((e) => e.slot === 'contents').length > 1) {
    problems.push('a document may carry only one contents page');
  }

  const chapters = spine.filter((e) => e.slot === 'chapter' || e.slot === 'wide-table');
  if (!chapters.length) problems.push(`${archetype.id}: a document must have at least one chapter`);

  const [min, max] = archetype.pageBudget;
  const total = spinePageBudget(spine);
  if (total < min || total > max) {
    problems.push(
      `page budget ${total} is outside ${archetype.id}'s band of ${min}–${max}`,
    );
  }

  return problems;
}
