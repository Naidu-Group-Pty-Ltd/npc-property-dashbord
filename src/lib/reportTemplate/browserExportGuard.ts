/**
 * A client never receives a placeholder.
 *
 * RC-3 draws production documents in the browser, and the browser's block
 * renderer is not yet complete: `drawExtrasPlaceholder` paints a dashed box
 * reading *"Block … renders in HTML/PDF pipeline"*. That was harmless while it
 * only appeared in the editor's legacy preview, and it is not harmless on a
 * page somebody sends to a paying client.
 *
 * `exportCapability` already classifies every block in a template — `partial`
 * is the placeholder, `unsupported` is no renderer at all. This turns that
 * advisory reading into a **refusal** for the one audience that matters, and
 * reuses it rather than asking the same question twice.
 *
 * Two things this deliberately does NOT do:
 *
 *  * **It does not fall back to Cloud Run.** The target is zero Cloud Run; a
 *    guard that quietly re-routed to WeasyPrint would make the dependency
 *    permanent and invisible.
 *  * **It does not rasterise the document.** An image of a page is not the
 *    page — no text layer, no accessibility, and a far worse artefact than
 *    the one it replaces.
 *
 * What it does is refuse, name the blocks, and leave the caller to render the
 * standard document instead. A template that cannot be drawn whole is a
 * template that is not ready for production export, and the honest answer is
 * to say so rather than to ship a page with a hole in it.
 */
import { analyzeExportCapability } from './exportCapability';
import type { ReportTemplate } from './templateSchema';

export interface BrowserExportRefusal {
  ok: false;
  /** Block types the browser renderer cannot draw properly, for the operator. */
  blockTypes: string[];
  /** Operator-facing, names no internal identifier a client should ever read. */
  reason: string;
}

export interface BrowserExportPermitted {
  ok: true;
}

export type BrowserExportVerdict = BrowserExportPermitted | BrowserExportRefusal;

const PERMITTED: BrowserExportVerdict = { ok: true };

/**
 * May this template be drawn in the browser for a client?
 *
 * `partial` and `unsupported` are both refusals here, and that is the whole
 * point: a placeholder is WORSE than a missing block, because it looks
 * deliberate. The severity split `exportCapability` uses is right for an
 * operator deciding whether to export a draft, and wrong for a document
 * leaving the building.
 */
export function judgeBrowserProductionExport(
  template: Pick<ReportTemplate, 'pages'> | null | undefined,
): BrowserExportVerdict {
  if (!template) return PERMITTED;

  const report = analyzeExportCapability(template as ReportTemplate, 'jspdf');
  const blocking = report.issues.filter(
    (issue) => issue.code === 'jspdf-placeholder' || issue.code === 'jspdf-unsupported',
  );
  if (blocking.length === 0) return PERMITTED;

  // The block TYPES, recovered from the messages the analysis already builds,
  // so there is one place that knows how a block is named.
  const blockTypes = Array.from(new Set(
    blocking.flatMap((issue) => issue.message.match(/\(([^)]+)\)/)?.[1]?.split(', ') ?? []),
  )).filter(Boolean).sort();

  return {
    ok: false,
    blockTypes,
    reason:
      'This template uses layout blocks the in-app renderer cannot draw yet, so it would '
      + 'produce a document with placeholder panels in it. The standard report has been '
      + 'produced instead.',
  };
}
