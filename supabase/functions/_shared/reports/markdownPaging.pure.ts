/**
 * Packing rendered Markdown into fixed-height page buckets.
 *
 * This lives on the shared side, and is imported by both the `markdown-block`
 * renderer in `src/lib/reportTemplate/blocks/` and the narrative projections,
 * for a reason that is not tidiness. A master makes page N conditional on
 * `narrative.pages > N` (or `qa.answerPages > N`), and the block decides what
 * page N contains. If the two disagreed by a single line the document would
 * either print a blank page or silently drop its tail — and the tail is the
 * end of something a client is reading. They have to be the same arithmetic,
 * so they are the same functions, and a format that opts into the calibrated
 * profile below must do so on BOTH sides through `resolveNarrativeProfile`.
 *
 * ## The 2026-09 calibration
 *
 * `scripts/reports/markdownCalibration.mts` rendered probes through the real
 * seeded Investment Compass master (WeasyPrint 69, the pinned engine) twice:
 * once with the pager in charge, once with the bucket cap lifted so the page
 * geometry decided. The pager was sending pages at **40–47% of what they
 * hold**: a continuation page really fits ~54.5 rendered line-units and the
 * first narrative page ~42.5 (part-header furniture), while the legacy charge
 * model (65 chars/line, integer rounding) summed the same content to 34 units.
 * Real prose wraps at ~98 characters on this measure, not 65. That under-fill
 * is where every "large sectional gap" in a narrative page came from — the
 * page broke long before it was full.
 *
 * The calibrated profile pairs the measured charge model in `markdown.pure.ts`
 * (`charging: 'measured'`) with budgets set 8% under the measured capacity,
 * because template families set their own body size and a slightly larger face
 * must not push the last line past the box. `DEFAULT_LINES_PER_PAGE` (34) is
 * ALSO the value baked into every deployed master's block props, so it doubles
 * as the legacy sentinel: a schema still carrying 34 is read as "use the
 * calibrated profile" by the formats that opt in, while any other explicit
 * value is honoured verbatim — a hand-tuned master keeps its tuning.
 */
import type { MarkdownBlock, MarkdownTableMeta } from './markdown.pure.ts';
import { splitListBlock, splitParagraphBlock, splitTableBlock } from './markdown.pure.ts';
import { listCharge, paragraphCharge, type NarrativeGeometry } from './narrativeGeometry.pure.ts';

/**
 * The legacy bucket size, and the sentinel every pre-calibration master baked
 * into its block props. Overridable per master.
 */
export const DEFAULT_LINES_PER_PAGE = 34;

/**
 * Measured on the Compass continuation page; see the header — then cut again
 * against a failure in the field. A real Compass render (1/27D Mitchell
 * Street, 2026-09-04) packed its final bucket at 47 charged units under the
 * 50 budget and still overflowed the physical box: the estimator's error on
 * a list-and-margin-heavy page exceeded the 8% held back, the tail printed
 * over the running foot, and the sources bullet lost its description with
 * nothing saying so. The budget therefore sits ~16% under the measured
 * capacity (54.5), because a sparser page costs white space and an overfull
 * one costs a client the end of the document — and only one of those is
 * recoverable by reading on.
 */
export const CALIBRATED_CONT_LINES = 46;
/** The first narrative page's box is shorter (part-header furniture). */
export const CALIBRATED_FIRST_LINES = 36;

export interface NarrativeProfile {
  /** Charge model `renderMarkdown` must be called with. */
  charging: 'measured';
  /** Bucket size for continuation pages, in measured line-units. */
  linesPerPage: number;
  /** Bucket size for the first page (its box is shorter). */
  firstPageLines: number;
  /** Never end a page on a heading or a lead-in line. */
  keepWithNext: true;
  /** Split a taller-than-a-page table by rows, repeating its head. */
  splitTables: true;
  /**
   * Pack by the template's own geometry when the renderer can supply it —
   * see `narrativeGeometry.pure.ts` and `packNarrativeGeometry`. The
   * calibrated budgets above remain the arithmetic for a caller with no
   * template in hand (the projection's template-blind page count).
   */
  geometryAware: boolean;
}

const INVESTMENT_PROFILE: NarrativeProfile = {
  charging: 'measured',
  linesPerPage: CALIBRATED_CONT_LINES,
  firstPageLines: CALIBRATED_FIRST_LINES,
  keepWithNext: true,
  splitTables: true,
  geometryAware: true,
};

/**
 * The formats whose narrative path has been calibrated. Both sides of the
 * contract — the block renderer and the format's projection — resolve through
 * this one function, so they cannot disagree about whether a format is on the
 * calibrated arithmetic. Formats not named here keep the legacy behaviour
 * byte for byte; they join by being measured, not by being assumed
 * (`scripts/reports/markdownCalibration.mts` is the instrument).
 */
export function resolveNarrativeProfile(reportType: string | null | undefined): NarrativeProfile | null {
  const t = String(reportType ?? '').toLowerCase();
  if (t === 'investment' || t === 'investment_compass' || t === 'compass') return INVESTMENT_PROFILE;
  return null;
}

export interface PackOptions {
  /** Bucket size for page 0; defaults to `linesPerPage`. */
  firstPageLines?: number;
  /**
   * When a page break would strand a heading, or a lead-in paragraph ending
   * in a colon, as the last block of a page, carry it (and at most one
   * companion) onto the next page instead. A heading at a page foot promises
   * content the page does not deliver, and "The key considerations are:"
   * followed by white space is the exact defect this was measured from.
   */
  keepWithNext?: boolean;
  /**
   * A table taller than a whole page used to get a bucket of its own and then
   * overflow its fixed-height box — the overflow was clipped at the page edge
   * and the severed row was simply lost (measured on a real risk register:
   * the word "dependency" sliced through by the row rule, its remainder never
   * printed). With this on, such a table is split by rows into page-sized
   * chunks, each repeating the header row, which is what a paper ledger does.
   * A table that fits a page whole still moves whole.
   */
  splitTables?: boolean;
  /**
   * Split a table at a page boundary when the room left on the page holds
   * its head and a few rows, instead of pushing it whole and leaving that
   * room white. Measured on the sparse reference report (14 Sep 2026): a
   * risk table and a checklist pushed whole left 67% and 57% of two pages
   * empty above them. Only a table long enough to survive the cut is split
   * (`BOUNDARY_SPLIT_MIN_ROWS`), and only into room worth using
   * (`BOUNDARY_SPLIT_MIN_LINES`).
   */
  splitAtBoundary?: boolean;
  /**
   * Let a figure that does not fit the room left float past the prose that
   * follows it, up to the next heading, and open the next page instead — the
   * convention every typeset book uses, and the difference between a page
   * that ends where its text ends and one that ends where a chart would not
   * fit. At most `MAX_FLOATED` figures are carried at once; a figure taller
   * than a page is never floated.
   */
  floatFigures?: boolean;
  /**
   * Fold a final bucket of at most `TAIL_ABSORB_LINES` lines onto the page
   * before it. A last page carrying three lines is a page that is 90% white,
   * and the master's content bottom sits 76pt above the running foot on every
   * family, so an overrun that small lands well inside the reserve.
   */
  absorbTail?: boolean;
  /**
   * Split a paragraph that does not fit at a sentence boundary, charging each
   * part with this function (the geometry's paragraph charge), so the room
   * left on a page is filled rather than left white. See
   * `splitParagraphBlock` for what makes a cut honest.
   */
  splitParagraphs?: (chars: number) => number;
  /**
   * Split a list taller than the room it has by top-level item, charging
   * each chunk with this function (the geometry's list charge). A list was
   * never split before, and one taller than a page was clipped at the
   * paper's edge with its tail lost — see `splitListBlock`.
   */
  splitLists?: (items: readonly { depth: number; text: string }[]) => number;
}

export const BOUNDARY_SPLIT_MIN_ROWS = 6;
/** Room worth cutting a paragraph for, and the paragraph worth cutting. */
export const PARAGRAPH_SPLIT_MIN_ROOM = 3;
export const PARAGRAPH_SPLIT_MIN_LINES = 5;
export const BOUNDARY_SPLIT_MIN_LINES = 8;
/**
 * A table short of `BOUNDARY_SPLIT_MIN_ROWS` still meets the boundary when it
 * is TALL — its rows are paragraphs, so a head over one row is a page's worth
 * of reading rather than an orphan (`splitTableBlock` lets such a row stand
 * alone). A fifth of a page is tall. The room must also hold the head and the
 * first row, or the cut would only put two heads on the next page.
 */
export const BOUNDARY_SPLIT_TALL_LINES = 2 * BOUNDARY_SPLIT_MIN_LINES;
function survivesTheCut(table: MarkdownTableMeta, remaining: number): boolean {
  if (table.rows.length >= BOUNDARY_SPLIT_MIN_ROWS) return true;
  const total = table.headLines + table.rowLines.reduce((n, l) => n + l, 0);
  return table.rows.length >= 2 && total >= BOUNDARY_SPLIT_TALL_LINES
    && remaining >= table.headLines + (table.rowLines[0] ?? 1) + 1;
}
export const MAX_FLOATED = 2;
export const TAIL_ABSORB_LINES = 3;

const sumLines = (blocks: readonly MarkdownBlock[]): number => blocks.reduce((n, b) => n + b.lines, 0);

/**
 * Pack blocks into buckets of at most `linesPerPage` estimated lines.
 *
 * A block taller than a whole page gets a bucket of its own rather than being
 * split — unless it is a table and `splitTables` is on, because a clipped
 * table row is lost content, which is worse than either alternative.
 */
export function packMarkdownPages(
  blocks: readonly MarkdownBlock[],
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
  options: PackOptions = {},
): MarkdownBlock[][] {
  const contBudget = Math.max(1, linesPerPage);
  const firstBudget = Math.max(1, options.firstPageLines ?? contBudget);
  const pages: MarkdownBlock[][] = [];
  let current: MarkdownBlock[] = [];
  let used = 0;
  // Figures carried past the prose that follows them; they open the next page.
  let floated: MarkdownBlock[] = [];

  const budgetFor = (pageIndex: number) => (pageIndex === 0 ? firstBudget : contBudget);

  const breakPage = () => {
    if (!current.length) return;
    let peeled: MarkdownBlock[] = [];
    if (options.keepWithNext) {
      // Peel a trailing heading / lead-in so it opens the next page instead of
      // closing this one. At most two blocks (a heading over a lead-in), and
      // never the whole page.
      while (current.length > 1 && peeled.length < 2) {
        const last = current[current.length - 1];
        const isHeading = last.kind === 'heading';
        const isLeadIn = last.kind === 'paragraph' && /[:：]\s*<\/p>\s*$/.test(last.html);
        if (!isHeading && !isLeadIn) break;
        peeled.unshift(current.pop()!);
      }
    }
    pages.push(current);
    // A floated figure is earlier content than anything peeled, so it leads.
    current = [...floated, ...peeled];
    floated = [];
    used = sumLines(current);
  };

  for (const block of blocks) {
    const budget = budgetFor(pages.length);
    let pieces: readonly MarkdownBlock[] = [block];
    if (options.splitLists && block.kind === 'list' && block.list) {
      const remaining = budget - used;
      const room = current.length && remaining >= BOUNDARY_SPLIT_MIN_LINES ? remaining : contBudget;
      if (block.lines > budget) {
        pieces = splitListBlock(block, room, contBudget, options.splitLists);
      } else if (
        options.splitAtBoundary && current.length && block.lines > remaining
        && remaining >= BOUNDARY_SPLIT_MIN_LINES && block.list.items.length >= BOUNDARY_SPLIT_MIN_ROWS
      ) {
        pieces = splitListBlock(block, remaining, contBudget, options.splitLists);
      }
    }
    if (block.kind === 'table' && block.table) {
      const remaining = budget - used;
      if (options.splitTables && block.lines > budget) {
        // First chunk sizes to the space left on the current page when that is
        // worth using (head + a few rows); otherwise every chunk is page-sized
        // and the pack loop opens a fresh page for the first one naturally.
        const firstChunk = current.length && remaining >= BOUNDARY_SPLIT_MIN_LINES ? remaining : contBudget;
        pieces = splitTableBlock(block, firstChunk, contBudget);
      } else if (
        options.splitAtBoundary && current.length && block.lines > remaining
        && remaining >= BOUNDARY_SPLIT_MIN_LINES && survivesTheCut(block.table, remaining)
      ) {
        pieces = splitTableBlock(block, remaining, contBudget);
      }
    }

    const queue = [...pieces];
    while (queue.length) {
      const piece = queue.shift()!;
      const pageBudget = budgetFor(pages.length);
      const remaining = pageBudget - used;
      if (current.length && piece.lines > remaining) {
        if (options.floatFigures && piece.kind === 'figure' && floated.length < MAX_FLOATED && piece.lines <= contBudget) {
          floated.push(piece);
          continue;
        }
        if (options.splitParagraphs && piece.kind === 'paragraph'
          && remaining >= PARAGRAPH_SPLIT_MIN_ROOM && piece.lines >= PARAGRAPH_SPLIT_MIN_LINES) {
          const parts = splitParagraphBlock(piece, remaining, options.splitParagraphs);
          // The head fits the room by construction; the tail comes round again
          // and opens the next page.
          if (parts.length === 2) { queue.unshift(...parts); continue; }
        }
        breakPage();
      } else if (floated.length && piece.kind === 'heading' && current.length) {
        // A new section: the figure it follows must not drift into it.
        breakPage();
      }
      current.push(piece);
      used += piece.lines;
    }
  }
  if (floated.length) {
    // Nothing followed the figure on this page; it opens the last one.
    if (current.length) breakPage();
    else { current = floated; floated = []; }
  }
  if (current.length) pages.push(current);
  if (options.absorbTail && pages.length > 1 && sumLines(pages[pages.length - 1]) <= TAIL_ABSORB_LINES) {
    const tail = pages.pop()!;
    pages[pages.length - 1].push(...tail);
  }
  return pages;
}

/**
 * The one call both sides of a calibrated format make.
 *
 * `schemaLinesPerPage` is the value baked into the master's block props. The
 * legacy sentinel (34) — and any absent value — resolves to the calibrated
 * budgets; an explicit different value is a hand-tuned master and is honoured
 * with the profile's packing behaviours but its own bucket size.
 */
export function packNarrativePages(
  blocks: readonly MarkdownBlock[],
  profile: NarrativeProfile,
  schemaLinesPerPage?: number,
): MarkdownBlock[][] {
  const custom = schemaLinesPerPage !== undefined
    && schemaLinesPerPage !== DEFAULT_LINES_PER_PAGE
    && schemaLinesPerPage > 0;
  const lines = custom ? schemaLinesPerPage! : profile.linesPerPage;
  const first = custom ? schemaLinesPerPage! : profile.firstPageLines;
  return packMarkdownPages(blocks, lines, {
    firstPageLines: first,
    keepWithNext: profile.keepWithNext,
    splitTables: profile.splitTables,
  });
}

/**
 * Pack by one template's geometry: the first page's and the continuation
 * pages' own line capacities, with the profile's packing behaviours. The
 * blocks must have been charged with the SAME geometry (`renderMarkdown`'s
 * `geometry` option), and every instance of the run must be packed with it,
 * because each packs the whole source and a differing budget on one instance
 * prints a line twice or not at all.
 */
export function packNarrativeGeometry(
  blocks: readonly MarkdownBlock[],
  geometry: NarrativeGeometry,
): MarkdownBlock[][] {
  return packMarkdownPages(blocks, geometry.contLines, {
    firstPageLines: geometry.firstPageLines,
    keepWithNext: true,
    splitTables: true,
    splitAtBoundary: true,
    floatFigures: true,
    absorbTail: true,
    splitParagraphs: (chars) => paragraphCharge(geometry, chars),
    splitLists: (items) => listCharge(geometry, items.map((it) => ({ chars: it.text.length, depth: it.depth }))),
  });
}
