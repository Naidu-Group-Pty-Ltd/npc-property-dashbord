/**
 * Browser PDF text extraction compatibility shim.
 *
 * A few non-template experiences need lightweight browser text extraction.
 * PDF.js is lazy-loaded from the build-pinned browser utility.
 */
import { loadPdfjs as getPdfJs } from '@/lib/pdf/pdfjs';

export interface ExtractionResult {
  text: string;
  totalPages: number;
  extractedPages: number;
}

export type ProgressCallback = (current: number, total: number) => void;

export async function extractPdfTextClientSide(
  file: File,
  onProgress?: ProgressCallback,
): Promise<ExtractionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjs = await getPdfJs();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer, useSystemFonts: true }).promise;
  const totalPages = pdf.numPages;

  const pageTexts: string[] = [];
  let extractedPages = 0;

  for (let i = 1; i <= totalPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      const parts: string[] = [];

      for (const item of content.items) {
        if ('str' in item && item.str) {
          const y = (item as any).transform?.[5];
          if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) parts.push('\n');
          parts.push(item.str);
          if (y !== undefined) lastY = y;
        }
      }

      const pageText = parts.join(' ').replace(/ \n /g, '\n').trim();
      if (pageText) {
        pageTexts.push(`--- Page ${i} ---\n${pageText}`);
        extractedPages++;
      }
    } finally {
      onProgress?.(i, totalPages);
    }
  }

  return { text: pageTexts.join('\n\n'), totalPages, extractedPages };
}
