/**
 * Measure a rendered document by laying it out, not by adding it up.
 *
 * ## Why this exists
 *
 * The viewer puts each document in a sandboxed, script-free iframe. An iframe
 * does not size itself to its content, so something has to tell it how tall and
 * wide to be — and because the frame cannot run a script, it cannot report that
 * itself.
 *
 * The first two attempts computed the size arithmetically: sum the column
 * widths from the spreadsheet, sum the row heights, add the padding. That is
 * wrong in a way that is easy to miss and impossible to fix by adjusting the
 * numbers, because the heights stored in an .xlsx are the heights *Excel* laid
 * the file out with, using Excel's fonts and Excel's wrapping. A browser wraps
 * a long answer across two lines where Excel used one, and the row grows. Every
 * sheet in the pack came out between 53px and 356px short, and the shortfall
 * was silently clipped.
 *
 * So: render the exact same HTML in a hidden, same-origin iframe first and read
 * the size back. It is the same document, laid out by the same engine, so the
 * answer is exact rather than an estimate that happens to be close.
 *
 * The measuring frame is deliberately *not* sandboxed — same-origin is what
 * makes `contentDocument` readable — but it is also never shown, never
 * navigated, and carries only our own generated markup, which contains no
 * script (`documentViewer.test.ts` asserts that).
 */

export interface MeasuredSize {
  width: number;
  height: number;
}

/**
 * Viewport for the measuring frame.
 *
 * Wide enough that a document is never forced to wrap more than it would at its
 * natural width — the widest sheet in the pack is ~2,400px. Cell wrapping is
 * governed by the fixed column widths rather than the viewport, so a generous
 * viewport does not change the measured height.
 */
const MEASURE_VIEWPORT_PX = 3200;

/** A frame that never loads must not hang the viewer behind its spinner. */
const MEASURE_TIMEOUT_MS = 2000;

/**
 * Breathing room on the measured size.
 *
 * Sub-pixel layout, a collapsed outer border and the browser's own rounding all
 * land within a pixel or two. Rather than chase them, the box is given a couple
 * of pixels it does not need — invisible against the page, and the difference
 * between "exact" and "clipped by one line of text".
 */
const SAFETY_PX = 4;

interface MeasureRequest {
  html: string;
  /**
   * What to measure. The element that defines the content's true extent — the
   * table on a worksheet, the page wrapper on a Word document — because the
   * body itself stretches to the measuring viewport and would over-report.
   */
  selector: string;
  /** Used when measurement is unavailable, and as a floor under the result. */
  fallback: MeasuredSize;
  /** Optional: offsets of these elements from the top, for page navigation. */
  offsetSelector?: string;
}

export interface MeasureResult extends MeasuredSize {
  /** Present when `offsetSelector` was given. */
  offsets?: number[];
  /** False when the environment could not lay the document out. */
  measured: boolean;
}

function createFrame(): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('title', 'Measuring');
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;visibility:hidden;'
    + `width:${MEASURE_VIEWPORT_PX}px;height:800px;pointer-events:none;`;
  return frame;
}

/**
 * Measure one document.
 *
 * Resolves with the fallback rather than rejecting when there is no layout to
 * read — jsdom under test, or a frame that never fires `load`. A viewer that
 * showed an approximately sized document is far better than one that showed an
 * error because it could not measure it.
 */
export function measureDocument(request: MeasureRequest): Promise<MeasureResult> {
  const unmeasured: MeasureResult = { ...request.fallback, measured: false };
  if (typeof document === 'undefined' || !document.body) {
    return Promise.resolve(unmeasured);
  }

  return new Promise<MeasureResult>((resolve) => {
    const frame = createFrame();
    let settled = false;

    const finish = (result: MeasureResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      frame.remove();
      resolve(result);
    };

    const timer = window.setTimeout(() => finish(unmeasured), MEASURE_TIMEOUT_MS);

    frame.addEventListener('load', () => {
      try {
        const inner = frame.contentDocument;
        const target = inner?.querySelector(request.selector);
        if (!inner || !target) { finish(unmeasured); return; }

        const rect = target.getBoundingClientRect();
        // Padding on the container the target sits in is part of the document.
        const container = target.parentElement;
        const style = container ? inner.defaultView?.getComputedStyle(container) : null;
        const padX = style
          ? parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0') : 0;
        const padY = style
          ? parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0') : 0;

        const offsets = request.offsetSelector
          ? Array.from(inner.querySelectorAll(request.offsetSelector)).map(
            (node) => Math.max(0, Math.round(node.getBoundingClientRect().top + inner.documentElement.scrollTop)),
          )
          : undefined;

        // A document that lays out to nothing means the frame never really
        // rendered; trust the estimate instead of sizing the box to zero.
        if (rect.width < 1 || rect.height < 1) { finish(unmeasured); return; }

        finish({
          width: Math.max(Math.ceil(rect.width + padX) + SAFETY_PX, request.fallback.width),
          height: Math.max(Math.ceil(rect.height + padY) + SAFETY_PX, request.fallback.height),
          offsets,
          measured: true,
        });
      } catch {
        // Cross-origin or a document that refused to lay out. Estimate it is.
        finish(unmeasured);
      }
    });

    document.body.appendChild(frame);
    frame.srcdoc = request.html;
  });
}

/** Measure several documents in sequence, reusing nothing but the main thread. */
export async function measureDocuments(
  requests: MeasureRequest[],
): Promise<MeasureResult[]> {
  const results: MeasureResult[] = [];
  for (const request of requests) {
    // Sequential on purpose: a dozen frames laying out at once is slower than
    // one at a time, and the whole batch runs behind the viewer's spinner.
    results.push(await measureDocument(request));
  }
  return results;
}
