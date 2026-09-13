/**
 * Getting the Investment report into someone's hands — download, send, or
 * portal — as ONE document, produced ONE way.
 *
 * ## What this replaces
 *
 * The audit (F11/F12) measured the highest-volume format delivering three
 * different artefacts depending on which control was pressed:
 *
 *  * the report page's PRIMARY "Download" saved the markdown as a `.txt`;
 *  * "Send to Client" published whatever `pdf_url` held — written by the
 *    legacy server route *or* the browser html2canvas generator, whichever
 *    ran last — or minted a fresh browser raster on the spot;
 *  * only `PremiumPdfButton`, low in a collapsible panel, produced the real
 *    chain: chosen template → legacy WeasyPrint route.
 *
 * That chain — the person's template selection honoured first, the route
 * that has produced this document for the life of the product as the
 * fallback — was correct and lived inside one button. It lives here now, and
 * every surface (the primary download, the send, the premium button, the
 * flatten copy) asks this module, so a client receives the same document the
 * operator reviewed.
 *
 * ## Every failure is a fallback, never an error — until there is nothing
 *
 * A refused template, no selection, a stale choice: the legacy route still
 * renders (`tryTemplateDocument`'s own contract). Only when BOTH engines
 * fail does this throw, with the message in front of the person who clicked.
 *
 * ## Coverage
 *
 * Neither leg logs here: the template route writes `template_render_jobs`
 * server-side, and the legacy invoke is auto-tagged by `secureInvoke`
 * (engine `legacy_server`). A manual event would double-count.
 *
 * ## `pdf_url` has one meaning now
 *
 * "The storage path of the most recent standard-delivery document." Every
 * write goes through the `manage-investment-reports` broker (this module and
 * the legacy generator's own upload path both use it) or the legacy route's
 * internal bookkeeping — and after `publishInvestmentPdf`, the row points at
 * the exact bytes that were just published to a portal.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  saveTemplateDocument,
  tryTemplateDocument,
} from '@/lib/reportTemplate/templateDocument';
import {
  generateInvestmentPdfBlob,
  BROWSER_PDF_RENDERER,
} from '@/lib/reports/investment/investmentPdfDocument';
import {
  loadInvestmentReportForPdf,
  projectRowForPdf,
} from '@/lib/reports/investment/investmentPdfSource';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import type { PdfDesignOptions } from '@/components/reports/premiumPdfDesign';

export interface InvestmentDocument {
  blob: Blob;
  fileName: string;
  /**
   * Which machinery produced the bytes.
   *
   * `browser_pdf_lib` replaced `legacy_server`: the standard document is drawn
   * in this browser with pdf-lib now, not by a Cloud Run WeasyPrint route. The
   * value is carried into the render event so production telemetry can show
   * the path an artefact actually took.
   */
  engine: 'template' | typeof BROWSER_PDF_RENDERER;
  /** The template that rendered it, when the template engine did. */
  templateId: string | null;
}

export interface ProduceInvestmentOptions {
  /** The report's variant (financial / briefing / snapshot), for the adapter. */
  variant?: string | null;
  /** Legacy-route presentation switches, forwarded untouched. */
  includeCharts?: boolean;
  includeHeroImages?: boolean;
  includeSparklines?: boolean;
  designOptions?: PdfDesignOptions;
}


/**
 * The document, template-first.
 *
 * Throws only when no engine could produce it; the message is the one the
 * failing engine gave.
 */
export async function produceInvestmentDocument(
  reportId: string,
  options: ProduceInvestmentOptions = {},
): Promise<InvestmentDocument> {
  if (!reportId) throw new Error('A report is required to produce the document.');

  const templated = await tryTemplateDocument('investment', reportId, {
    variant: options.variant ?? null,
  });
  if (templated) {
    return {
      blob: templated.blob,
      fileName: templated.fileName,
      engine: 'template',
      templateId: templated.templateId,
    };
  }

  // The standard document, drawn HERE.
  //
  // This used to POST to `render-investment-report-pdf`, which composed HTML
  // and handed it to WeasyPrint on Cloud Run. The drawing is now
  // `investmentPdfDocument` — the same pdf-lib implementation that produced
  // 263 of the 275 Investment PDFs this product has delivered — so the
  // document reaches a client without leaving the browser and Supabase.
  //
  // The projection is shared with `ClientPDFGenerator` rather than repeated,
  // because it is where stored financials are healed and an historic row's
  // overrides are overlaid. One transform, one set of numbers.
  const row = await loadInvestmentReportForPdf(reportId);
  const { report, reportTier } = projectRowForPdf(row);
  const drawn = await generateInvestmentPdfBlob({
    report,
    reportTier,
    includeSources: true,
    includeScoring: true,
  });
  if (!drawn.blob.size) throw new Error('The rendered PDF was empty.');
  return {
    blob: drawn.blob,
    fileName: drawn.fileName,
    engine: drawn.renderer,
    templateId: null,
  };
}

/** Produce and save to the browser's downloads. */
export async function deliverInvestmentPdf(
  reportId: string,
  options: ProduceInvestmentOptions = {},
): Promise<InvestmentDocument> {
  const doc = await produceInvestmentDocument(reportId, options);
  saveTemplateDocument({ blob: doc.blob, fileName: doc.fileName, templateId: doc.templateId ?? '' });
  return doc;
}

const STORAGE_BUCKET = 'investment-reports';


/**
 * Record the published path on the row, through the one broker every client
 * write uses. Best-effort: the document is already published; failing the
 * caller over bookkeeping would un-send nothing.
 */
async function rememberInvestmentPdfPath(reportId: string, path: string): Promise<void> {
  try {
    await invokeSecureFunction('manage-investment-reports', {
      action: 'update',
      reportId,
      data: { pdf_url: path },
    });
  } catch (err) {
    console.warn('[deliverInvestmentPdf] could not record pdf_url:', err);
  }
}

export interface PublishedInvestmentPdf {
  /** Path in the `investment-reports` bucket — what a portal row stores. */
  path: string;
  engine: InvestmentDocument['engine'];
  templateId: string | null;
}

/**
 * Produce the document and make it a stored artefact a portal can serve.
 *
 * Every document is uploaded here and recorded through the same broker, and
 * the returned path IS what `pdf_url` names.
 *
 * There used to be a shortcut: the server route persisted its own render and
 * wrote the path to the row, so this read it back rather than uploading the
 * same bytes twice. Nothing persists a render behind our back any more — the
 * document is drawn in this browser and exists only as a Blob until it is
 * stored — so the shortcut is gone rather than left to return a stale path
 * from whichever render happened to run last.
 */
export async function publishInvestmentPdf(
  reportId: string,
  options: ProduceInvestmentOptions = {},
): Promise<PublishedInvestmentPdf> {
  const doc = await produceInvestmentDocument(reportId, options);

  const safeName = doc.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const path = `${reportId}_${Date.now()}_${safeName}`;
  const upload = await secureStorageUpload(STORAGE_BUCKET, path, doc.blob, {
    contentType: 'application/pdf',
    upsert: true,
    resourceId: reportId,
  });
  if (!upload.success) {
    throw new Error(upload.error || 'The document rendered but could not be stored.');
  }
  const storedPath = upload.path || path;
  await rememberInvestmentPdfPath(reportId, storedPath);
  return { path: storedPath, engine: doc.engine, templateId: doc.templateId };
}
