/**
 * Read a PDF's measured text geometry in the browser, for grounding.
 *
 * The Claude PDF path sends the document to the model. This walks the SAME bytes
 * with PDF.js first and produces the measurements to send alongside it, so the
 * model transcribes positions rather than estimating them.
 *
 * Grounding is derived from the attached file and never from the open template.
 * That is deliberate: a template's overlays may have come from a different
 * document entirely, and measurements from the wrong document are worse than
 * none — the agent treats them as authoritative and would assert text the
 * attached PDF does not contain.
 *
 * Best-effort by contract. Every failure here returns "no measurements", which
 * restores exactly the behaviour that shipped before this existed: the model
 * reads the document itself.
 *
 * Geometry and selection are pure and tested (`pdfjsTextGeometry.pure.ts`,
 * `groundedReferenceFromPdf.pure.ts`); this file is the page walk.
 */

import { loadPdfjs } from '@/lib/pdf/pdfjs';
import type { GroundedReference } from '../imageGrounding';
import {
  mergeFragmentsIntoLines,
  placeTextFragment,
  type Matrix6,
  type PlacedTextFragment,
} from './pdfjsTextGeometry.pure';
import {
  buildGroundedReferenceFromLines,
  DEFAULT_GROUNDED_ELEMENT_CAP,
} from './groundedReferenceFromPdf.pure';

export interface GroundedPage {
  /** 1-based page number in the source PDF. */
  pageNumber: number;
  reference: GroundedReference;
  /** Elements the per-page cap excluded. */
  dropped: number;
}

export interface GroundPdfResult {
  pages: GroundedPage[];
  /** Total pages in the document, including any beyond `maxPages`. */
  totalPages: number;
  /** Pages not measured because of `maxPages`. */
  pagesOmitted: number;
  /** Elements excluded by the per-page cap, across every measured page. */
  elementsDropped: number;
}

export interface GroundPdfOptions {
  /** Pages to measure. Bounds the prompt on a long document. */
  maxPages?: number;
  /** Elements per page. Matches the agent's own slice. */
  maxElementsPerPage?: number;
  /** Wall-clock budget. A grounding pass must never be why an import hangs. */
  timeoutMs?: number;
}

/**
 * A long document would otherwise put tens of thousands of measured lines in one
 * prompt. Twelve pages at the per-page cap is already a large block, and the
 * omission is reported rather than silent.
 */
export const DEFAULT_MAX_GROUNDED_PAGES = 12;

const DEFAULT_TIMEOUT_MS = 20_000;

/** The slice of PDF.js this walk touches, named so the casts stay in one place. */
interface PdfPageLike {
  getViewport: (params: { scale: number }) => { width: number; height: number; transform: number[] };
  getTextContent: () => Promise<{
    items: unknown[];
    styles?: Record<string, { ascent?: number; descent?: number; fontFamily?: string; vertical?: boolean }>;
  }>;
  cleanup?: () => void;
}

interface PdfDocumentLike {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
  destroy?: () => Promise<void>;
}

/** Base64 (no data: prefix) → bytes, without a Buffer or a fetch round-trip. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Measure every page's text, up to the caps.
 *
 * Never throws: a PDF that PDF.js cannot open, an encrypted document, a page
 * that fails mid-walk — all resolve to "no measurements for that page", because
 * a failed grounding pass must degrade to the ungrounded behaviour rather than
 * fail the import.
 */
export async function groundPdfDocument(
  source: Uint8Array | ArrayBuffer | string,
  options: GroundPdfOptions = {},
): Promise<GroundPdfResult> {
  const empty: GroundPdfResult = { pages: [], totalPages: 0, pagesOmitted: 0, elementsDropped: 0 };
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? DEFAULT_MAX_GROUNDED_PAGES));
  const maxElementsPerPage = Math.max(1, Math.floor(options.maxElementsPerPage ?? DEFAULT_GROUNDED_ELEMENT_CAP));
  const deadline = Date.now() + Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let bytes: Uint8Array;
  try {
    bytes = typeof source === 'string'
      ? base64ToBytes(source)
      : source instanceof Uint8Array ? source : new Uint8Array(source);
  } catch {
    return empty;
  }
  if (!bytes.length) return empty;

  let doc: PdfDocumentLike | null = null;
  try {
    const pdfjs = await loadPdfjs();
    // `data` is transferred, so hand PDF.js a copy — the caller still needs the
    // original bytes to send to the model.
    doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false })
      .promise as unknown as PdfDocumentLike;
    const total = Number(doc.numPages) || 0;
    if (!total) return empty;

    const pages: GroundedPage[] = [];
    let elementsDropped = 0;
    const walk = Math.min(total, maxPages);
    for (let pageNumber = 1; pageNumber <= walk; pageNumber += 1) {
      if (Date.now() > deadline) {
        return {
          pages, totalPages: total, elementsDropped,
          pagesOmitted: total - pages.length,
        };
      }
      const built = await groundOnePage(doc, pageNumber, maxElementsPerPage);
      if (built) {
        pages.push(built);
        elementsDropped += built.dropped;
      }
    }
    return { pages, totalPages: total, pagesOmitted: Math.max(0, total - walk), elementsDropped };
  } catch (error) {
    console.warn('[pdf-grounding] could not measure the document:', String((error as Error)?.message ?? error));
    return empty;
  } finally {
    try { await doc?.destroy?.(); } catch { /* best effort */ }
  }
}

async function groundOnePage(
  doc: PdfDocumentLike,
  pageNumber: number,
  maxElementsPerPage: number,
): Promise<GroundedPage | null> {
  try {
    const page = await doc.getPage(pageNumber);
    // A scale-1 viewport's transform carries the y-flip, the page rotation and a
    // non-zero MediaBox origin. Deriving those by hand is how a rotated page
    // silently comes out mirrored.
    const viewport = page.getViewport({ scale: 1 });
    const transform = viewport.transform as unknown as Matrix6;
    const content = await page.getTextContent();
    const styles = content.styles ?? {};

    const placed: PlacedTextFragment[] = [];
    for (const item of content.items ?? []) {
      const fragment = item as { fontName?: unknown };
      const style = typeof fragment.fontName === 'string' ? styles[fragment.fontName] : undefined;
      const box = placeTextFragment(fragment as never, style, transform);
      if (box) placed.push(box);
    }
    page.cleanup?.();
    if (!placed.length) return null;

    const built = buildGroundedReferenceFromLines(
      mergeFragmentsIntoLines(placed),
      { width: viewport.width, height: viewport.height },
      { maxElements: maxElementsPerPage },
    );
    return built ? { pageNumber, reference: built.reference, dropped: built.dropped } : null;
  } catch (error) {
    console.warn(`[pdf-grounding] page ${pageNumber} not measured:`, String((error as Error)?.message ?? error));
    return null;
  }
}
