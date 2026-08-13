/**
 * Packing rendered Markdown into fixed-height page buckets.
 *
 * This lives on the shared side, and is imported by both the `markdown-block`
 * renderer in `src/lib/reportTemplate/blocks/` and the Report Q&A projection,
 * for a reason that is not tidiness. A master makes page N conditional on
 * `qa.answerPages > N`, and the block decides what page N contains. If the two
 * disagreed by a single line the document would either print a blank page or
 * silently drop its tail — and the tail is the end of an answer a client is
 * reading. They have to be the same arithmetic, so they are the same function.
 */
import type { MarkdownBlock } from './markdown.pure.ts';

/** Sensible for 174mm of measure at 10pt. Overridable per master. */
export const DEFAULT_LINES_PER_PAGE = 34;

/**
 * Pack blocks into buckets of at most `linesPerPage` estimated lines.
 *
 * A block taller than a whole page gets a bucket of its own rather than being
 * split. That is deliberate: splitting a table across a page break loses its
 * header row and the remainder reads as a different, unlabelled table, which is
 * a worse document than one over-full page.
 */
export function packMarkdownPages(
  blocks: readonly MarkdownBlock[],
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): MarkdownBlock[][] {
  const budget = Math.max(1, linesPerPage);
  const pages: MarkdownBlock[][] = [];
  let current: MarkdownBlock[] = [];
  let used = 0;

  for (const block of blocks) {
    if (current.length && used + block.lines > budget) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(block);
    used += block.lines;
  }
  if (current.length) pages.push(current);
  return pages;
}
