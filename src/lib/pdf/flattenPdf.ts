/**
 * flattenPdfBlob — rasterise every page of a PDF and re-emit as an image-only
 * PDF. Output has no selectable text, no annotations, no form fields, no layers
 * — every page becomes a single embedded JPEG at the original physical size.
 *
 * Designed as a universal "Download as Flattened PDF" step that sits behind
 * every download surface in the dashboard. PDF.js is lazy-loaded from the
 * build-pinned dependency so no executable code is fetched at runtime.
 */
import { PDFDocument } from 'pdf-lib';
import { loadPdfjs } from './pdfjs';

export interface FlattenPdfOptions {
  /** Render DPI for each page. Default 150 (print-ready, ~10MB / 50pp). */
  dpi?: number;
  /** JPEG quality 0..1. Default 0.85. */
  jpegQuality?: number;
  /** Optional progress hook fired after each page. */
  onProgress?: (page: number, totalPages: number) => void;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('canvas.toBlob returned null'));
        blobToArrayBuffer(b).then((buf) => resolve(new Uint8Array(buf))).catch(reject);
      },
      'image/jpeg',
      quality,
    );
  });
}

export async function flattenPdfBlob(
  input: Blob,
  options: FlattenPdfOptions = {},
): Promise<Blob> {
  const dpi = options.dpi ?? 150;
  const quality = options.jpegQuality ?? 0.85;
  const scale = dpi / 72;

  const pdfjs = await loadPdfjs();
  const srcBuf = await blobToArrayBuffer(input);
  // pdfjs mutates the buffer; clone so callers can reuse the original blob.
  const srcDoc = await pdfjs.getDocument({ data: srcBuf.slice(0) }).promise;
  const out = await PDFDocument.create();

  try {
    for (let i = 1; i <= srcDoc.numPages; i++) {
      const page = await srcDoc.getPage(i);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Failed to acquire 2D canvas context');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // pdfjs ≥4 requires `canvas`; older types only required `canvasContext`.
      await page.render({
        canvas,
        canvasContext: ctx,
        viewport,
      } as any).promise;

      const jpegBytes = await canvasToJpegBytes(canvas, quality);
      const jpeg = await out.embedJpg(jpegBytes);

      // Physical page size in PDF points (1pt = 1/72in). Preserves the original
      // page dimensions regardless of render DPI.
      const widthPt = canvas.width / scale;
      const heightPt = canvas.height / scale;
      const newPage = out.addPage([widthPt, heightPt]);
      newPage.drawImage(jpeg, { x: 0, y: 0, width: widthPt, height: heightPt });

      // Free the canvas backing store eagerly to keep memory flat on large PDFs.
      canvas.width = 0;
      canvas.height = 0;

      options.onProgress?.(i, srcDoc.numPages);
    }
  } finally {
    await srcDoc.cleanup().catch(() => {});
    (srcDoc as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {});
  }

  const bytes = await out.save();
  // Copy into a fresh ArrayBuffer so the Blob constructor is happy across browsers.
  return new Blob([bytes.slice().buffer], { type: 'application/pdf' });
}

/** Convenience: append `-flattened` before the `.pdf` extension. */
export function withFlattenedSuffix(filename: string): string {
  if (/\.pdf$/i.test(filename)) {
    return filename.replace(/\.pdf$/i, '-flattened.pdf');
  }
  return `${filename}-flattened.pdf`;
}
