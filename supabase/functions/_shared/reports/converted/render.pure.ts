/**
 * A converted template, as a document.
 *
 * ## What this renders
 *
 * The sections extracted from somebody's uploaded template, set through the
 * report design system under a chosen brand design system, in the order the
 * bound report format expects them.
 *
 * The bound format is what makes the output more than a reformat. Its chapters
 * are the spine, so a converted template opens as *that format* — same chapter
 * order, same running heads, same contents page, same closing company page as
 * the migrated renderers produce. When the real report data arrives later, the
 * chapters are already the right ones and in the right order.
 *
 * ## Three things a chapter can be
 *
 * - **bound** — a section of the upload plays this chapter. Its prose is set.
 * - **unfilled** — the format has this chapter and the template offered nothing.
 *   It is still printed, with a line saying the live report will supply it,
 *   because dropping it would change the format's own structure.
 * - **appendix** — a section of the upload that no chapter wanted. Printed at
 *   the back rather than discarded, so nothing a person uploaded disappears
 *   without being visible somewhere.
 *
 * That third case is the one worth stating plainly. It is tempting to drop
 * unbound sections — they are, by definition, the ones the format has no place
 * for. But somebody chose to put them in their template, and a converter that
 * silently eats a third of an upload is a converter nobody trusts twice.
 */
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDocument,
  renderLede,
  type BrandLockupProps,
} from '../../reportDesign/primitives.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import {
  buildSpine,
  contentsEntriesFor,
  REPORT_ARCHETYPES,
  type ReportArchetypeId,
  type SpineEntry,
  spinePageBudget,
  validateSpine,
} from '../../reportDesign/structure.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { chartContext } from '../../reportDesign/charts.pure.ts';
import { pagesForLines, renderMarkdown } from '../markdown.pure.ts';
import type { BindingPlan } from './binding.pure.ts';
import { formatName } from './binding.pure.ts';
import { enrichedLines, type EnrichedBlock } from './enrich.pure.ts';
import { renderEnrichedBlocks } from './renderBlocks.pure.ts';
import type { ExtractedStructure } from './structure.pure.ts';

/**
 * Enriched blocks for the chapters that got them, by chapter id.
 *
 * Partial on purpose. Enrichment is per-chapter and every chapter can fail on
 * its own — no key, a timeout, a guard rejection twice, zero blocks — and a
 * chapter with no entry here renders exactly as the converter always rendered
 * it. That is what makes enrichment safe to add to a working path: its total
 * failure is the previous behaviour.
 */
export type EnrichedChapters = Readonly<Record<string, readonly EnrichedBlock[]>>;

/** Lines a chapter costs before a word of it is set. Pinned by the programme. */
export const CHAPTER_FURNITURE_LINES = 3;

/** An unfilled chapter is a header and one callout. */
export const UNFILLED_CHAPTER_LINES = 10;

/**
 * The lede and the draft notice, which only the first chapter carries.
 *
 * Measured against a render, not estimated: a two-line lede, a five-line
 * callout with its label and rules, and the space around both. It was not
 * charged at all until a real conversion was rendered and read — the spine
 * claimed thirteen pages for a document WeasyPrint printed in fifteen, and this
 * was one of the two pages missing.
 */
export const OPENING_NOTICE_LINES = 11;

/** The "your upload had no headings" callout, when there is one. */
export const UNSTRUCTURED_NOTICE_LINES = 7;

export type PlannedChapterKind = 'bound' | 'unfilled' | 'appendix';

export interface PlannedConvertedChapter {
  id: string;
  kind: PlannedChapterKind;
  title: string;
  note?: string;
  markdown: string;
  /** Present only when this chapter was enriched. Rendered instead of `markdown`. */
  blocks?: readonly EnrichedBlock[];
  lines: number;
  pages: number;
}

/** Plan the document from the binding, in the format's own chapter order. */
export function planConvertedChapters(
  structure: ExtractedStructure,
  plan: BindingPlan,
  enriched: EnrichedChapters = {},
): PlannedConvertedChapter[] {
  const chapters: PlannedConvertedChapter[] = [];

  // Whatever the first chapter carries on top of its own content.
  const opening = OPENING_NOTICE_LINES
    + (structure.notices.unstructured ? UNSTRUCTURED_NOTICE_LINES : 0);

  // Enriched blocks and flat Markdown cost different numbers of lines — a KPI
  // strip is four where the table it replaced was nine — so the budget has to
  // be taken from whichever will actually be printed. Costing the Markdown and
  // printing the blocks is how a spine claims a page count the document does
  // not have, which is the defect `BORROWING_CAPACITY.md` §2 exists about.
  const costOf = (id: string, markdown: string, idPrefix: string): number => {
    const blocks = enriched[id];
    return (blocks?.length ? enrichedLines(blocks) : renderMarkdown(markdown, { idPrefix }).lines)
      + CHAPTER_FURNITURE_LINES
      // `renderConvertedBody` puts the lede and the draft notice inside the
      // first chapter's body, so the first chapter is the one that pays for
      // them. Keyed on the list being empty rather than on an index, because
      // an unfilled first chapter is charged too — it prints the same notice.
      + (chapters.length === 0 ? opening : 0);
  };

  plan.bindings.forEach((binding, i) => {
    const section = binding.sectionIndex === null
      ? null
      : structure.sections[binding.sectionIndex] ?? null;
    if (section) {
      const id = `cv.${i}`;
      const blocks = enriched[id];
      const lines = costOf(id, section.markdown, `cv${i}`);
      chapters.push({
        id,
        kind: 'bound',
        title: binding.chapter,
        note: section.title === binding.chapter ? undefined : `From "${section.title}"`,
        markdown: section.markdown,
        blocks: blocks?.length ? blocks : undefined,
        lines,
        pages: pagesForLines(lines),
      });
      return;
    }
    const unfilledLines = UNFILLED_CHAPTER_LINES + (chapters.length === 0 ? opening : 0);
    chapters.push({
      id: `cv.${i}`,
      kind: 'unfilled',
      title: binding.chapter,
      note: 'Supplied by the live report',
      markdown: '',
      lines: unfilledLines,
      pages: pagesForLines(unfilledLines),
    });
  });

  plan.unbound.forEach((index, n) => {
    const section = structure.sections[index];
    if (!section) return;
    const id = `cv.a${n}`;
    const blocks = enriched[id];
    const lines = costOf(id, section.markdown, `cva${n}`);
    chapters.push({
      id,
      kind: 'appendix',
      title: section.title,
      note: 'From the uploaded template',
      markdown: section.markdown,
      blocks: blocks?.length ? blocks : undefined,
      lines,
      pages: pagesForLines(lines),
    });
  });

  return chapters;
}

export interface RenderConvertedInput {
  structure: ExtractedStructure;
  plan: BindingPlan;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  masthead: string;
  /** The design system's name, printed on the cover so a draft is identifiable. */
  systemName: string;
  lockup?: BrandLockupProps | null;
  heroDataUri?: string | null;
  confidentiality?: string | null;
  options?: ReportDesignOptions | null;
  preparedOn: string;
  reference?: string | null;
  /** Enriched blocks, by chapter id. Absent chapters render as flat Markdown. */
  enriched?: EnrichedChapters;
}

export interface ConvertedRenderPlan {
  spine: SpineEntry[];
  bodyHtml: string;
  chapters: string[];
  pageBudget: number;
  boundCount: number;
  unfilledCount: number;
  appendixCount: number;
  /** Chapters that printed enriched blocks rather than flat Markdown. */
  enrichedCount: number;
  /** Every block kind printed across the document, counted. For the ledger. */
  blockCounts: Record<string, number>;
  problems: string[];
  /**
   * The format's page band, when the draft sits outside it.
   *
   * Advisory rather than fatal — see `renderConvertedBody`. Surfaced so the
   * review screen can say "this draft is longer than the format usually runs",
   * which is worth knowing and is not an error.
   */
  bandNote: string[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatReportDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]} ${month} ${m[1]}` : '';
}

export function renderConvertedBody(input: RenderConvertedInput): ConvertedRenderPlan {
  const archetype = REPORT_ARCHETYPES[input.plan.format];
  const chapters = planConvertedChapters(input.structure, input.plan, input.enriched ?? {});
  const charts = chartContext(input.palette);

  // The name the document calls itself, everywhere.
  //
  // `archetype.documentName` is catalogue metadata; `formatName` is what the
  // renderer prints on a real one of these. Using both put "Borrowing Capacity
  // Assessment" in the cover eyebrow and the running head while the cover's own
  // "Bound to" line said "Borrowing Capacity Snapshot" — one page, two names
  // for the same format.
  const documentName = formatName(input.plan.format);

  const spine = buildSpine({
    archetype: input.plan.format,
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, pageBudget: c.pages, note: c.note })),
    contentsPages: Math.max(1, Math.ceil(chapters.length / 22)),
  });

  // Whether there is a contents page is the *spine's* answer, not this
  // renderer's.
  //
  // `buildSpine` adds one only when the archetype asks for it — Borrowing
  // Capacity declares `contents: false`, because a short format does not carry
  // one. This renderer used to print a contents page unconditionally, which
  // broke the binding's whole promise (a draft bound to a format opens *as*
  // that format) and under-claimed the page budget by exactly one, since the
  // spine was costing a page the document was not printing and vice versa.
  //
  // Reading it back off the spine is what makes the two incapable of
  // disagreeing again.
  const contentsEntry = spine.find((e) => e.slot === 'contents');

  // The page band is advisory here, and only here.
  //
  // A converted draft is not an instance of the format — it is a draft *bound*
  // to one, and it carries appendix chapters the format never has. The
  // Borrowing Capacity band is [4, 12] and a seven-chapter template with four
  // unmatched sections lands at 13, which is correct output and would be a
  // fatal `problems` entry for every other renderer in the programme. Every
  // other rule `validateSpine` enforces — illegal slots, duplicate ids, a
  // document with no chapters — is a real defect here too and stays fatal.
  const allProblems = validateSpine(input.plan.format, spine);
  const bandMarker = `outside ${input.plan.format}`;
  const problems = allProblems.filter((p) => !p.includes(bandMarker));
  const bandNote = allProblems.filter((p) => p.includes(bandMarker));

  const bound = chapters.filter((c) => c.kind === 'bound').length;
  const unfilled = chapters.filter((c) => c.kind === 'unfilled').length;
  const appendix = chapters.filter((c) => c.kind === 'appendix').length;

  const cover = renderCover({
    eyebrow: `${documentName} · converted draft`,
    title: input.structure.title,
    masthead: input.masthead,
    edition: input.systemName ? input.systemName.toUpperCase() : null,
    meta: [
      { label: 'Bound to', value: formatName(input.plan.format) },
      { label: 'Prepared on', value: formatReportDate(input.preparedOn) },
      { label: 'Chapters', value: String(chapters.length) },
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  const contents = contentsEntry
    ? renderContentsPage(
      'Contents',
      contentsEntriesFor(spine).map((e) => ({ number: e.number, title: e.title, note: e.note })),
    )
    : '';

  // Said on page one, every time.
  //
  // A converted document looks exactly like a finished one — same cover, same
  // typography, same closing page — and it is not. Somebody will send it to a
  // client by accident unless the document itself says what it is.
  const draftNotice = renderCallout(
    'caution',
    'This is a converted draft, not a client document',
    `<p>${escapeHtml(
      `The structure of "${input.structure.title}" has been converted onto the ${
        formatName(input.plan.format)
      } format. The words are the ones from the uploaded template, not live report data. `
      + `${bound} ${bound === 1 ? 'chapter carries' : 'chapters carry'} converted content`
      + `${unfilled ? `, ${unfilled} will be supplied by the live report` : ''}`
      + `${appendix ? `, and ${appendix} unmatched ${appendix === 1 ? 'section is' : 'sections are'} kept as an appendix` : ''}.`,
    )}</p>`,
  );

  const unstructured = input.structure.notices.unstructured
    ? renderCallout(
      'caution',
      'The upload had no headings',
      '<p>No heading structure was found in the source, so the whole document became one '
      + 'section and nothing could be bound to the format. Re-exporting the original with '
      + 'real headings — rather than text sized to look like them — converts far better.</p>',
    )
    : '';

  const blockCounts: Record<string, number> = {};
  let enrichedCount = 0;

  const body = chapters.map((chapter, index) => {
    const number = String(index + 1).padStart(2, '0');
    const opening = index === 0
      ? renderLede(
        `A converted draft of "${input.structure.title}", bound to the ${
          formatName(input.plan.format)
        } format.`,
      ) + draftNotice + unstructured
      : '';

    const idPrefix = chapter.id.replace(/[^a-z0-9]/gi, '');
    let inner: string;
    if (chapter.kind === 'unfilled') {
      inner = renderCallout(
        'informative',
        'Supplied by the live report',
        `<p>${escapeHtml(
          `The ${formatName(input.plan.format)} format prints a "${chapter.title}" chapter from `
          + 'its own data. The uploaded template had no section that matched it, so this chapter '
          + 'is empty in the draft and will fill itself when the format renders for real.',
        )}</p>`,
      );
    } else if (chapter.blocks?.length) {
      // Designed. `renderEnrichedBlocks` returns the primitives' own output —
      // KPI strips, data tables, charts — rather than the paragraph soup that
      // `renderMarkdown` makes of anything it does not have a rule for.
      const rendered = renderEnrichedBlocks(chapter.blocks, charts, idPrefix);
      if (rendered.html) {
        enrichedCount += 1;
        for (const b of chapter.blocks) blockCounts[b.kind] = (blockCounts[b.kind] ?? 0) + 1;
        inner = rendered.html;
      } else {
        // Every block refused by its primitive. Vanishingly unlikely — the
        // reader rejects degenerate input before it gets here — but a chapter
        // that prints nothing is worse than one that prints flat prose.
        inner = renderMarkdown(chapter.markdown, { idPrefix }).html;
      }
    } else {
      inner = renderMarkdown(chapter.markdown, { idPrefix }).html;
    }

    return openChapter(documentName, number, chapter.title)
      + renderChapterHeader({
        number,
        title: chapter.title,
        dek: chapter.note,
        label: archetype.chapterLabel,
      })
      + `<div class="chapter-body">${opening}${inner}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({ block: input.company, lockup: input.lockup ?? null });

  return {
    spine,
    bodyHtml: cover + contents + body + closing,
    chapters: chapters.map((c) => c.title),
    pageBudget: spinePageBudget(spine),
    boundCount: bound,
    unfilledCount: unfilled,
    appendixCount: appendix,
    enrichedCount,
    blockCounts,
    problems,
    bandNote,
  };
}

export function renderConvertedDocument(
  input: RenderConvertedInput,
): ConvertedRenderPlan & { html: string } {
  const plan = renderConvertedBody(input);
  return {
    ...plan,
    html: renderDocument({
      title: `${input.structure.title} — converted draft`,
      author: input.masthead,
      subject: formatName(input.plan.format),
      css: buildReportCss({
        palette: input.palette,
        options: input.options ?? null,
        masthead: input.masthead,
      }),
      bodyHtml: plan.bodyHtml,
    }),
  };
}

export interface RenderConvertedFromBrandInput {
  structure: ExtractedStructure;
  plan: BindingPlan;
  snapshot: ReportBrandSnapshot;
  /** The palette the chosen design system resolves to. */
  palette: ResolvedReportPalette;
  options: ReportDesignOptions;
  systemName: string;
  disclaimer?: CompanyDisclaimer | null;
  coverArtDataUri?: string | null;
  preparedOn: string;
  reference?: string | null;
  enriched?: EnrichedChapters;
}

export interface ConvertedRenderResult extends ConvertedRenderPlan {
  html: string;
  gaps: string[];
}

/**
 * Render under a brand design system.
 *
 * The palette comes from the *design system*, not from the brand snapshot —
 * that is the whole point of choosing one. The snapshot still supplies the
 * company block, the lockup and the confidentiality line, because those are
 * facts about the tenant rather than design decisions.
 */
export function renderConvertedFromBrand(
  input: RenderConvertedFromBrandInput,
): ConvertedRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  const rendered = renderConvertedDocument({
    structure: input.structure,
    plan: input.plan,
    palette: input.palette,
    company: brand.company,
    masthead: brand.masthead,
    systemName: input.systemName,
    lockup: brand.lockup,
    heroDataUri: brand.heroDataUri,
    confidentiality: brand.confidentiality,
    options: input.options,
    preparedOn: input.preparedOn,
    reference: input.reference ?? null,
    enriched: input.enriched,
  });

  return { ...rendered, gaps: brand.gaps };
}
