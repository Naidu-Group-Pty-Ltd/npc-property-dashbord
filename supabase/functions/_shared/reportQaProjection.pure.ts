/**
 * What a Report Q&A template may bind.
 *
 * ## This restates the document, it does not re-read the record
 *
 * `_shared/reports/reportQa/` already builds a `ReportQaDocument` for the
 * flowing `render-report-qa-pdf` route — turns in order, citations, the
 * transcript budget, what was cut and by how much. This projection restates
 * that, exactly as the Comparison, Client Details and Cash Flow Comparison
 * projections restate their normalisers. A second read of
 * `report_qa_messages` would be a second set of answers to "what was said",
 * which is the failure this programme removes rather than adds.
 *
 * ## The answer stays Markdown
 *
 * Every other projection publishes formatted scalars, because every other block
 * escapes its body. This one publishes the answer as **Markdown source**, and
 * `markdown-block` renders it. That is the whole reason the format can be on
 * the families at all: the safety is in the renderer, so the projection does not
 * have to sanitise, and must not try — a projection that pre-rendered HTML would
 * move the escaping decision to whoever calls it.
 *
 * ## Page counts are computed here and honoured by the block
 *
 * A master makes answer page N conditional on `qa.answerPages > N`. That number
 * comes from `packMarkdownPages` — the same function the block uses to decide
 * what page N contains. See `reports/markdownPaging.pure.ts` for why that is one
 * function rather than two.
 *
 * ## What it deliberately does not publish
 *
 * `structured_report` on the conversation. It is a second, separately-generated
 * document about the same conversation, and binding it beside the turns would
 * put two answers to the same question on one page with nothing to tell a reader
 * which is current.
 */
import { renderMarkdown } from './reports/markdown.pure.ts';
import { packMarkdownPages, DEFAULT_LINES_PER_PAGE } from './reports/markdownPaging.pure.ts';
import type { ReportQaDocument, QaTurn } from './reports/reportQa/payload.pure.ts';

/**
 * What a master may draw, and what the specs assert against.
 *
 * Turns are capped because a page model that cannot paginate cannot be handed an
 * unbounded collection. The largest real conversation is 70 turns; a document
 * that shows the first 12 and says so is a better artefact than one that runs
 * off the end of its own page sequence.
 */
export const CAPS = {
  turns: 12,
  /** Answer pages a master declares. Beyond this the answer is cut and says so. */
  answerPages: 10,
  citationsPerTurn: 6,
} as const;

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/** How many pages this Markdown needs at the master's line budget. */
export function answerPageCount(
  markdown: string,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): number {
  const source = str(markdown);
  if (!source) return 0;
  return packMarkdownPages(renderMarkdown(source).blocks, linesPerPage).length;
}

function projectTurn(turn: QaTurn, linesPerPage: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'index', turn.index);
  put(out, 'question', str(turn.question));
  put(out, 'askedAt', str(turn.askedAt));
  put(out, 'answer', str(turn.answer));
  put(out, 'answerPages', answerPageCount(turn.answer, linesPerPage) || undefined);

  // A human edited this before it was sent. Worth printing, and only when true —
  // "Edited: No" on every one of 565 answers tells a reader nothing.
  if (turn.answerWasEdited) put(out, 'editedNote', 'This answer was edited before export.');

  const model = [str(turn.modelProvider), str(turn.modelVersion)].filter(Boolean).join(' ');
  put(out, 'model', model || undefined);

  const citations = turn.citations.slice(0, CAPS.citationsPerTurn).map((c) => {
    const cite: Record<string, unknown> = {};
    put(cite, 'documentName', str(c.documentName));
    const locus = [
      c.page != null ? `p.${c.page}` : null,
      c.paragraph != null ? `¶${c.paragraph}` : null,
    ].filter(Boolean).join(' ');
    put(cite, 'locus', locus || undefined);
    put(cite, 'snippet', str(c.snippet));
    return cite;
  });
  if (citations.length) out.citations = citations;
  put(out, 'citationCount', turn.citations.length || undefined);
  if (turn.citations.length > CAPS.citationsPerTurn) {
    put(out, 'citationsOmitted', `${turn.citations.length - CAPS.citationsPerTurn} more sources`);
  }
  return out;
}

export interface ProjectedReportQa {
  qa: Record<string, unknown>;
}

export function projectReportQa(
  doc: ReportQaDocument,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): ProjectedReportQa {
  const qa: Record<string, unknown> = {};

  /*
   * Nothing to describe means nothing published — not even `subject`.
   *
   * `subject` is an enum and so is never empty, which would make `qa` truthy on
   * a document with no title, no turns and no answer. A template making a page
   * conditional on `qa` would then draw an empty page for it. Absent has to mean
   * absent all the way up, not just per-key.
   */
  const hasContent = Boolean(str(doc.meta.title))
    || doc.turns.some((t) => str(t.question) || str(t.answer));
  if (!hasContent) return { qa };

  put(qa, 'title', str(doc.meta.title));
  put(qa, 'subject', doc.meta.subject);
  put(qa, 'preparedOn', str(doc.meta.preparedOn));
  put(qa, 'turnCount', doc.meta.turnCount || undefined);
  put(qa, 'turnsShown', doc.meta.turnsShown || undefined);

  const turns = doc.turns.slice(0, CAPS.turns);
  if (turns.length) qa.turns = turns.map((t) => projectTurn(t, linesPerPage));

  // The single-answer subject: one turn, and the pages it needs.
  const first = turns[0];
  if (first) {
    put(qa, 'question', str(first.question));
    put(qa, 'answer', str(first.answer));
    put(qa, 'answerPages', answerPageCount(first.answer, linesPerPage) || undefined);
  }

  /*
   * A whole sentence, and absent when nothing was cut.
   *
   * The Cash Flow Comparison's `matched` taught this: `put` correctly drops an
   * empty string, but a template that concatenates a fragment into a sentence is
   * left with a dangling clause when the fragment is absent. So the omission is
   * either a complete sentence or it is not published at all.
   */
  const omittedTurns = Math.max(0, doc.meta.turnCount - doc.meta.turnsShown);
  const cappedHere = Math.max(0, doc.meta.turnsShown - turns.length);
  const notShown = omittedTurns + cappedHere;
  if (notShown > 0) {
    put(
      qa,
      'omissionNote',
      `This document carries ${turns.length} of ${doc.meta.turnCount} exchanges; `
      + `${notShown} ${notShown === 1 ? 'is' : 'are'} not shown.`,
    );
  }
  if (doc.meta.truncated && doc.meta.charsOmitted > 0) {
    put(
      qa,
      'truncationNote',
      `${doc.meta.charsOmitted.toLocaleString('en-AU')} characters of the conversation `
      + 'are not shown. The complete text is in the Markdown export.',
    );
  }

  // What the conversation was grounded in. Named, because an answer about a
  // report the reader cannot identify is not checkable.
  const names = (doc.grounding?.reportNames ?? []).map(str).filter(Boolean) as string[];
  if (names.length) {
    qa.sources = names.slice(0, 8).map((name) => ({ name }));
    put(qa, 'sourceCount', names.length);
    put(qa, 'sourceSummary', names.length === 1
      ? `Grounded in ${names[0]}.`
      : `Grounded in ${names.length} reports.`);
  }

  return { qa };
}

export function applyReportQaProjection(
  target: Record<string, unknown>,
  doc: ReportQaDocument,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): void {
  const { qa } = projectReportQa(doc, linesPerPage);
  if (Object.keys(qa).length) target.qa = qa;
}
