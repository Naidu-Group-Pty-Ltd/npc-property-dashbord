/**
 * Getting a typeset market intelligence report into someone's hands.
 *
 * Hands back the `Blob` as well as saving it, for the same reason the Q&A twin
 * does: the destination that matters for this format is not always a downloads
 * folder. `dispatch-marketing-reports` emails the stored file, and a caller that
 * wants to attach or preview the document needs the bytes rather than a saved
 * copy.
 *
 * The signed URL is fetched rather than followed, for the same reason it is in
 * the other formats: a PDF that opens in a tab is a PDF someone has to find
 * again.
 */
import { tryTemplateDocument } from '@/lib/reportTemplate/templateDocument';
import {
  type MarketIntelligencePdfResult,
  requestMarketIntelligencePdf,
  type RequestMarketIntelligenceOptions,
} from './requestMarketIntelligencePdf';

export interface DeliveredMarketIntelligence {
  fileName: string;
  pageCount: number | null;
  brandGaps: string[];
  sections: string[];
  dropped: string[];
  emptyLayers: string[];
  reportPeriod: string;
  audienceSegment: string;
  /** True when `pdf_storage_path` was set, so the email dispatch can attach it. */
  persisted: boolean;
  storagePath: MarketIntelligencePdfResult['storagePath'];
  /** The document itself, for the preview and attachment paths. */
  blob: Blob;
  /**
   * Rendered from an activated template. Only ever true for a call that asked
   * not to persist — see the note in `deliverMarketIntelligencePdf` — and the
   * diagnostics above are left empty rather than measured.
   */
  templated?: boolean;
}

/** Save a file the way a browser saves files. */
function saveToBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // On a delay: Safari cancels an in-flight download when the URL disappears
  // underneath it.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Produce the document and return it.
 *
 * Throws on failure with the message the renderer gave, so a caller can put it
 * in front of the person who pressed the button rather than in a console.
 */
export async function deliverMarketIntelligencePdf(
  reportId: string,
  options: RequestMarketIntelligenceOptions & { save?: boolean } = {},
): Promise<DeliveredMarketIntelligence> {
  /**
   * An activated template wins for the document a person is asking for — but
   * **only when they are not asking for the stored copy**.
   *
   * `persist` writes the PDF into `marketing-reports` and sets
   * `pdf_storage_path`, which `dispatch-marketing-reports` attaches to a
   * scheduled email. It defaults to on, and that default is the whole reason
   * the column is ever written. The template route does not write it, so
   * routing a persisting call would quietly stop feeding the email — the
   * dispatch would still send (it generates its own report when no recent one
   * carries a path), but it would generate rather than reuse, and the emailed
   * document would be the flowing layout while the person who pressed the
   * button saw the templated one.
   *
   * So the template serves the explicit no-persist calls — a preview, an
   * attachment, a download someone wants in their hands — and the stored copy
   * stays the flowing route's job. `persisted: false` below is therefore a
   * fact rather than a shrug.
   */
  if (options.persist === false) {
    const templated = await tryTemplateDocument('market_intelligence', reportId, {
      // The audience edition is this format's variant: the same row is three
      // documents, and the adapter picks the closing panels from it.
      variant: options.audience ?? null,
    });
    if (templated) {
      if (options.save !== false) saveToBrowser(templated.blob, templated.fileName);
      return {
        fileName: templated.fileName,
        pageCount: null,
        brandGaps: [],
        sections: [],
        dropped: [],
        emptyLayers: [],
        reportPeriod: '',
        audienceSegment: String(options.audience ?? ''),
        persisted: false,
        storagePath: null,
        blob: templated.blob,
        templated: true,
      };
    }
  }

  const result = await requestMarketIntelligencePdf(reportId, options);

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();

  if (options.save !== false) saveToBrowser(blob, result.fileName);

  return {
    fileName: result.fileName,
    pageCount: result.pageCount,
    brandGaps: result.brandGaps,
    sections: result.sections,
    dropped: result.dropped,
    emptyLayers: result.emptyLayers,
    reportPeriod: result.reportPeriod,
    audienceSegment: result.audienceSegment,
    persisted: result.persisted,
    storagePath: result.storagePath,
    blob,
  };
}
