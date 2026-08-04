/**
 * The spine: which chapters the document has, and how many pages each claims.
 *
 * Declared by the payload rather than by this module, which makes it the third
 * kind in the programme. The Client Details and Market Intelligence documents
 * declare their sections in code; the Report Q&A discovers them from model
 * headings; this one takes them from the prose's own numbered skeleton, which
 * is declared by the *generator* and stable across the corpus.
 *
 * Two chapters are synthesised rather than read: a property summary at the
 * front, which no prose section covers because the specs live in a column, and
 * a sources chapter at the back.
 */
import type { ChapterInput } from '../../reportDesign/structure.pure.ts';
import { pagesForLines, renderMarkdown } from '../markdown.pure.ts';
import { chartHasData } from './charts.pure.ts';
import {
  type InvestmentReport,
  MAX_DOCUMENT_LINES,
  MAX_SECTION_CHARS,
  type SectionChart,
} from './payload.pure.ts';

export type ChapterKind = 'property' | 'prose' | 'sources';

export interface PlannedChapter {
  id: string;
  kind: ChapterKind;
  title: string;
  /** The contents-page gloss. */
  note?: string;
  /** The chapter standfirst. Absent for prose chapters — see below. */
  dek?: string;
  markdown: string;
  charts: readonly SectionChart[];
  lines: number;
  pages: number;
  clippedChars?: number;
}

/**
 * Lines a chapter costs before a word of it is set.
 *
 * Three, the figure the Market Intelligence migration pinned by render:
 * `pagesForLines` already floors every chapter at one page for its header, so
 * charging more counts that header twice.
 */
export const CHAPTER_FURNITURE_LINES = 3;

/**
 * What each infographic costs in estimated lines.
 *
 * Charts are the reason this format needs its own costing at all — the other
 * seven either had none or had one per section. Here a single chapter can carry
 * a gauge, a peer strip and a caption, and a page estimate that ignores them
 * under-claims by a page per charted chapter. Fourteen charted chapters is
 * fourteen pages of drift, which is the difference between a 34-page document
 * and a 48-page one.
 *
 * Pinned by render against the archetype's own band.
 */
export const CHART_LINES: Readonly<Record<SectionChart, number>> = {
  'score-gauge': 22,
  'score-peers': 14,
  'score-wheel': 26,
  'swot-quadrant': 20,
  'locality-map': 30,
  'amenity-bullets': 20,
  'demographics-bars': 20,
  'economic-bullets': 16,
  'yield-bullets': 20,
  'cost-waterfall': 26,
  'sensitivity-tornado': 22,
  'projection-value': 28,
  'projection-rent': 28,
  'projection-cashflow': 28,
  'lvr-bullet': 10,
  'property-tiles': 14,
};

/** A citation row of a one-column table. */
export const LINES_PER_SOURCE = 2;

/** Clip a chapter's Markdown at a line boundary, never mid-construct. */
function clip(markdown: string): { text: string; omitted: number } {
  if (markdown.length <= MAX_SECTION_CHARS) return { text: markdown, omitted: 0 };
  const cut = markdown.lastIndexOf('\n', MAX_SECTION_CHARS);
  const at = cut > MAX_SECTION_CHARS / 2 ? cut : MAX_SECTION_CHARS;
  return { text: markdown.slice(0, at), omitted: markdown.length - at };
}

const proseLines = (markdown: string, idPrefix: string): number =>
  markdown ? renderMarkdown(markdown, { idPrefix }).lines : 0;

/**
 * Only the charts that will actually be drawn.
 *
 * `chartHasData` is the one fact the renderer reads too. Charging for a chart
 * the renderer then skips is what made a report with no financial model claim
 * four pages more than it printed.
 */
const chartLines = (charts: readonly SectionChart[], report: InvestmentReport): number =>
  charts.reduce((n, c) => n + (chartHasData(c, report) ? (CHART_LINES[c] ?? 0) : 0), 0);

/**
 * Plan the document.
 *
 * The budget is applied from the end and never to the property summary, the
 * score chapters or the sources: those are what a reader opens the document
 * for. A locality chapter dropped off the end is named in a callout; a missing
 * score chapter would just look broken.
 */
export function planChapters(report: InvestmentReport): {
  chapters: PlannedChapter[];
  dropped: PlannedChapter[];
  charsOmitted: number;
} {
  const all: PlannedChapter[] = [];
  let clipped = 0;

  const push = (c: Omit<PlannedChapter, 'lines' | 'pages' | 'clippedChars'> & { lines: number }) => {
    const cut = clip(c.markdown);
    clipped += cut.omitted;
    const lines = cut.omitted
      ? proseLines(cut.text, c.id.replace(/[^a-z0-9]/gi, '')) + chartLines(c.charts, report) + CHAPTER_FURNITURE_LINES
      : c.lines;
    all.push({
      ...c,
      markdown: cut.text,
      lines,
      pages: pagesForLines(lines),
      clippedChars: cut.omitted || undefined,
    });
  };

  // ── The property, synthesised ──
  //
  // Every row in the corpus has `property_specs` and no prose section covers
  // it, so without this the document opens on a locality overview and never
  // says what was actually assessed.
  push({
    id: 'inv.property',
    kind: 'property',
    title: 'The Property',
    note: report.meta.propertyAddress || 'What was assessed',
    dek: report.meta.propertyAddress,
    markdown: '',
    charts: ['property-tiles'],
    lines: chartLines(['property-tiles'], report) + CHAPTER_FURNITURE_LINES,
  });

  // ── The prose, in the generator's own numbering ──
  report.sections.forEach((section, index) => {
    push({
      id: `inv.s${section.number ?? `x${index}`}`,
      kind: 'prose',
      title: section.title,
      // The contents gloss names the charts the chapter carries, which is the
      // one thing a reader scanning a 36-entry contents page cannot see from a
      // title. No standfirst: the prose opens with its own topic sentence, and
      // the Market Intelligence render showed a gloss set above an identical
      // first line reads as a rendering fault.
      note: section.charts.length
        ? `${section.charts.length} ${section.charts.length === 1 ? 'chart' : 'charts'}`
        : undefined,
      markdown: section.markdown,
      charts: section.charts,
      lines: proseLines(section.markdown, `inv${index}`)
        + chartLines(section.charts, report) + CHAPTER_FURNITURE_LINES,
    });
  });

  // ── Sources ──
  if (report.sources.length) {
    push({
      id: 'inv.sources',
      kind: 'sources',
      title: 'Sources',
      note: `${report.sources.length} cited`,
      dek: `${report.sources.length} cited`,
      markdown: '',
      charts: [],
      lines: report.sources.length * LINES_PER_SOURCE + CHAPTER_FURNITURE_LINES,
    });
  }

  // ── The document budget ──
  const KEEP = new Set<ChapterKind>(['property', 'sources']);
  /** Prose chapters a reader opens the document for, by their stable number. */
  const KEEP_NUMBERS = new Set([29, 30, 31, 34]);
  const chapters: PlannedChapter[] = [];
  const dropped: PlannedChapter[] = [];
  let lines = 0;

  for (const chapter of all) {
    const protectedNumber = /^inv\.s(\d+)$/.exec(chapter.id);
    const keep = KEEP.has(chapter.kind)
      || (protectedNumber ? KEEP_NUMBERS.has(Number(protectedNumber[1])) : false);
    if (keep) {
      chapters.push(chapter);
      lines += chapter.lines;
      continue;
    }
    if (lines + chapter.lines > MAX_DOCUMENT_LINES) {
      dropped.push(chapter);
      continue;
    }
    chapters.push(chapter);
    lines += chapter.lines;
  }

  const charsOmitted = dropped.reduce((n, c) => n + c.markdown.length, 0) + clipped;
  return { chapters, dropped, charsOmitted };
}

/** The chapters, for `buildSpine`. */
export function chaptersFor(chapters: readonly PlannedChapter[]): ChapterInput[] {
  return chapters.map((c) => ({ id: c.id, title: c.title, pageBudget: c.pages, note: c.note }));
}

/**
 * How many pages the contents page will take.
 *
 * This document has up to 38 entries — by far the most in the programme, and
 * more than three times the Market Intelligence report that first outgrew the
 * single fixed page. The constants are that migration's, measured through
 * WeasyPrint.
 */
export const CONTENTS_LINES_PER_PAGE = 44;
export const CONTENTS_NOTE_CHARS = 33;

export function contentsPagesFor(chapters: readonly PlannedChapter[]): number {
  const lines = chapters.reduce(
    (n, c) => n + 1 + Math.max(1, Math.ceil((c.note ?? '').length / CONTENTS_NOTE_CHARS)),
    0,
  );
  return Math.max(1, Math.ceil(lines / CONTENTS_LINES_PER_PAGE));
}
