/**
 * Report Q&A on the Investment Compass families.
 *
 * ## Why this file exists, given a spec used to forbid it
 *
 * `reportQaNotOnTheFamilies.spec.ts` held that this format could not be drawn
 * by a fixed-layout master, and it was right about the vocabulary as it stood:
 * no block rendered Markdown, and 70% of the 565 stored answers carry inline
 * bold, 48% a heading, 56% a list and 19% a pipe table. Bound to a `text-block`
 * every one of those printed as its own source on a client's page.
 *
 * `markdown-block` closed that. It takes Markdown **source** and renders it
 * through the programme's escape-first renderer, so it cannot emit markup the
 * model chose — which is what let it into `PRODUCTION_SAFE_BLOCK_TYPES` without
 * putting a hole in a security allow-list.
 *
 * ## What these masters draw, and what they leave to the flowing route
 *
 * One exchange, in depth. That is the document a fixed page sequence suits: a
 * question, its answer set properly, the sources it was grounded in, and a list
 * of what else was asked in the same conversation.
 *
 * A whole transcript is not that document. Answers run 2,193 characters at the
 * median and 33,377 at the longest, and a conversation reaches 70 turns — no
 * fixed sequence covers that range, and `render-report-qa-pdf` paginates it
 * properly. The adapter's `legacyFallback` says so rather than implying the
 * template is a replacement.
 *
 * ## How a page sequence carries a body of unknown length
 *
 * The answer gets one page plus seven conditional continuations, each holding
 * `pageIndex` N of the same source and each conditional on
 * `qa.answerPages > N`. A conditional page that does not render costs nothing —
 * `visiblePages` filters before layout — so a median answer produces a five-page
 * document and the longest produces twelve, from one set of masters. This is the
 * Client Details Form pattern, where 742 of 775 clients get five pages and the
 * other 33 get up to thirteen.
 *
 * The page count comes from the projection, which computes it with the same
 * `packMarkdownPages` the block uses. See `reports/markdownPaging.pure.ts` for
 * why that is one function rather than two.
 */
import {
  DESIGN_FAMILIES,
  resolveManifest,
  type DesignFamily,
  type VariantDefinition,
} from './family';
import {
  beginCompassTemplate,
  callout,
  contentTop,
  cover,
  disclaimerPage,
  flow,
  kpis,
  markdown,
  MARKDOWN_LINES_PER_PAGE,
  page,
  prose,
  sectionHeading,
  table,
  textHeight,
  withFurniture,
  type KpiItem,
  type PageDef,
} from './blocks';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

const FOOTER = '{{qa.title}} · Report Q&A';
const DOCUMENT_LABEL = 'Report Q&A';

/**
 * Answer pages a master declares: one plus seven continuations.
 *
 * Eight pages is 272 estimated lines, about 17,700 characters, which covers
 * roughly the 95th percentile of the corpus. Beyond it the projection's
 * `truncationNote` prints on the page rather than the tail vanishing — the same
 * rule Market Intelligence holds about clipping a section and saying so.
 */
const ANSWER_PAGES = 8;

/** Further questions listed after the exchange. The projection caps turns at 12. */
const FURTHER_QUESTIONS = 6;

const REPORT_QA_FORMAT: ReportFormat = {
  key: 'report-qa',
  reportType: 'qa',
  // `client_form` is a fact-find; this is analysis of reports the client owns.
  category: 'investment',
  tier: 'compass',
  label: 'Report Q&A',
  extraTags: ['report-qa', 'question', 'analysis', 'model-authored'],
};

const HAS_QA = 'qa';

const SUMMARY_KPIS: KpiItem[] = [
  { label: 'Exchanges', value: '{{qa.turnCount}}', note: 'In this conversation' },
  { label: 'Sources', value: '{{qa.sourceCount}}', note: 'Reports it was grounded in' },
  { label: 'Prepared', value: '{{qa.preparedOn | date}}', note: 'When this was exported' },
];

/** A page that exists only when the answer runs on to it. */
function answerPage(index: number, p: PageDef): PageDef {
  return { ...p, conditional: `qa && qa.answerPages > ${index}` };
}

function questionRow(i: number): string[] {
  return [`{{qa.turns.${i}.index}}`, `{{qa.turns.${i}.question}}`];
}

function sourceRow(i: number): string[] {
  return [`{{qa.sources.${i}.name}}`];
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const pages: PageDef[] = [];

  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Report Q&A',
    tagline: 'Your dedicated property partner',
    marker: 'Report Q&A',
    eyebrow: 'Report Q&A',
    title: '{{qa.title}}',
    standfirst:
      'A question asked of the reports on file, and the answer it drew. The '
      + 'answer is written by a language model against the documents named in '
      + 'it, and is reproduced here as it was given.',
    locations: 'Prepared {{qa.preparedOn | date}}',
    facts: [
      { label: 'Subject', value: '{{qa.subject}}' },
      { label: 'Exchanges', value: '{{qa.turnCount | fixed:0}}' },
      { label: 'Sources', value: '{{qa.sourceCount | fixed:0}}' },
      { label: 'Answer pages', value: '{{qa.answerPages | fixed:0}}' },
    ],
  }));

  // ---------------------------------------------------------------- the question
  pages.push(withFurniture(page('What was asked', [
    ...flow([
      sectionHeading({ eyebrow: 'What was asked', heading: 'The question' }),
      // The question is plain text — it is a heading in the record and carries
      // no markup, which is why this is prose rather than a markdown-block.
      prose('{{qa.question}}', textHeight(240)),
      { ...kpis(SUMMARY_KPIS), conditional: HAS_QA },
      {
        ...callout('What this document is', '{{qa.sourceSummary}}'),
        conditional: 'qa && qa.sourceSummary',
      },
      // Both notes are whole sentences from the projection, or absent. A
      // fragment concatenated into a title is what left a dangling separator on
      // the Cash Flow Comparison's ranking page.
      {
        ...callout('Not everything is shown', '{{qa.omissionNote}}'),
        conditional: 'qa && qa.omissionNote',
      },
    ], contentTop()),
  ]), FOOTER));

  // ---------------------------------------------------------------- the answer
  // Page one always exists when there is an answer at all; the rest are
  // conditional on the projection's page count.
  // Page one carries the section heading as well, so its body is shorter than a
  // continuation page's. Fitted against the seed builder's overflow guard rather
  // than derived: `sectionHeading` sizes itself from the family's own scale, and
  // a declared height that is too small does not overflow the page — it prints
  // over the next block, which `flow()`'s arithmetic cannot see.
  const firstBodyHeight = c.contentBottom - contentTop() - c.spacing.headingGap - 104;
  const contBodyHeight = c.contentBottom - contentTop() - 12;

  pages.push({
    ...withFurniture(page('The answer', [
      ...flow([
        sectionHeading({ eyebrow: 'The reply', heading: 'The answer' }),
        markdown('{{qa.answer}}', 0, firstBodyHeight, MARKDOWN_LINES_PER_PAGE),
      ], contentTop()),
    ]), FOOTER),
    conditional: HAS_QA,
  });

  for (let i = 1; i < ANSWER_PAGES; i += 1) {
    pages.push(answerPage(i, withFurniture(page(`The answer (${i + 1})`, [
      ...flow([
        markdown('{{qa.answer}}', i, contBodyHeight, MARKDOWN_LINES_PER_PAGE),
      ], contentTop()),
    ]), FOOTER)));
  }

  // ---------------------------------------------------------------- what else
  pages.push({
    ...withFurniture(page('The rest of the conversation', [
      ...flow([
        sectionHeading({ eyebrow: 'The conversation', heading: 'What else was asked' }),
        prose(
          'The exchanges below are part of the same conversation. Their answers '
          + 'are in the full transcript rather than in this document.',
          textHeight(150),
        ),
        table({
          headers: ['#', 'Question'],
          // An unresolved binding is the empty string, so a conversation with
          // three exchanges prints three rows and blanks; the caps are what stop
          // an unbounded collection running off a page that cannot paginate.
          rows: Array.from({ length: FURTHER_QUESTIONS }, (_, i) => questionRow(i + 1)),
          columnWidths: [40, c.contentWidth - 40],
          numeric: [],
        }),
        {
          ...callout('The complete text', '{{qa.truncationNote}}'),
          conditional: 'qa && qa.truncationNote',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: 'qa && qa.turns && qa.turns.1',
  });

  // ---------------------------------------------------------------- sources
  pages.push({
    ...withFurniture(page('What it read', [
      ...flow([
        sectionHeading({ eyebrow: 'Grounding', heading: 'Sources' }),
        prose(
          'The answer was grounded in the reports below. A figure it states that '
          + 'is not in one of them is not supported by this document.',
          textHeight(170),
        ),
        table({
          headers: ['Report'],
          rows: Array.from({ length: 8 }, (_, i) => sourceRow(i)),
          columnWidths: [c.contentWidth],
          numeric: [],
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'qa && qa.sources',
  });

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: REPORT_QA_FORMAT });
}

/** Every Report Q&A master, by family, in catalogue order. */
export const REPORT_QA_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
