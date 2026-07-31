/**
 * Formara PDF Parser
 * Extracts text from PDF client-side, then sends to AI for structured data extraction.
 */
import { extractPdfTextClientSide } from '@/lib/pdfClientExtractor';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { ParsedClient } from './excelClientParser';

export type PdfParseProgress = 
  | { stage: 'extracting'; current: number; total: number }
  | { stage: 'parsing'; message: string }
  | { stage: 'complete' };

/**
 * Parse a Formara PDF file into structured client data.
 * 1. Extract text client-side using PDF parser
 * 2. Send to edge function for AI-powered structured extraction
 */
export async function parseFormaraPdf(
  file: File,
  onProgress?: (progress: PdfParseProgress) => void
): Promise<ParsedClient> {
  // Step 1: Extract text from PDF client-side
  onProgress?.({ stage: 'extracting', current: 0, total: 1 });

  const extraction = await extractPdfTextClientSide(file, (current, total) => {
    onProgress?.({ stage: 'extracting', current, total });
  });

  if (!extraction.text || extraction.text.trim().length < 50) {
    throw new Error('Could not extract sufficient text from the PDF. The file may be scanned/image-based or empty.');
  }

  console.log(`[formaraPdfParser] Extracted ${extraction.text.length} chars from ${extraction.extractedPages}/${extraction.totalPages} pages`);

  // Step 2: Send to AI for structured parsing
  onProgress?.({ stage: 'parsing', message: 'Analysing form data with AI...' });

  const { data, error } = await invokeSecureFunction('parse-formara-pdf', {
    extractedText: extraction.text,
  });

  if (error) {
    throw new Error(`AI parsing failed: ${error.message}`);
  }

  if (!data?.success || !data?.data) {
    throw new Error(data?.error || 'Failed to parse PDF data');
  }

  onProgress?.({ stage: 'complete' });

  // The AI returns the exact ParsedClient shape
  return data.data as ParsedClient;
}
