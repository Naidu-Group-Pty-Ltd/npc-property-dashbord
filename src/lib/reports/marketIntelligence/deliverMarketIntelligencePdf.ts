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
