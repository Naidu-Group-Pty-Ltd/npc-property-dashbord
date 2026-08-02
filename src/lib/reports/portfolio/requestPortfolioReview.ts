/**
 * Asking the server for a Portfolio Performance Review.
 *
 * One function behind every button that produces the typeset document.
 *
 * ## No fallback, unlike the Snapshot
 *
 * `requestSnapshot.ts` falls back to the in-browser generator when its route is
 * absent, because for that format the two renderers produce the same document
 * from the same inputs and a deployment gap would otherwise break five working
 * buttons.
 *
 * Neither half of that holds here. `PortfolioAnalysisPDFGenerator` has **no
 * importable entry point** — the only way to reach it is to mount the component
 * and click through *Generate* then *Download & Save* — so there is nothing this
 * module could call. And nothing is being replaced: the legacy flow keeps every
 * button it has today, and this is an additional one. A deployment gap here
 * means one new menu item does not work yet, and it says so, naming the button
 * that does.
 *
 * That is the stronger position. Handing someone a document produced by a
 * different renderer than the one they asked for is what both prior formats
 * refused to do, and here we do not even have the option.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface PortfolioReviewRequest {
  /** The `portfolio_analysis_reports` row to typeset. */
  reportId: string;
  /**
   * Fold in the client's most recent completed review. Defaults to true.
   *
   * The review is a later, separate assessment whose figures differ from the
   * analysis's — the document says so where they meet — so a caller who wants
   * the analysis alone can ask for it.
   */
  includeReview?: boolean;
  /** `VOL. 2026 · ED. 08`. Cosmetic. */
  edition?: string | null;
}

export interface PortfolioReviewResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  /** Whether a review was folded in, so the UI can say which document it made. */
  reviewIncluded: boolean;
}

/**
 * True when the failure means "this function does not exist here yet".
 *
 * Deliberately narrow, and used only to choose the *message*. A bare 404 does
 * not count: the route answers 404 with `not found` for a report the caller may
 * not see — on purpose, so it does not confirm whether that report exists — and
 * reading that as "not deployed" would tell someone to go and deploy a function
 * that is already there.
 */
function looksUndeployed(error: { message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return message.includes('function not found')
    || message.includes('requested function')
    || message.includes('does not exist')
    || message.includes('failed to fetch')
    || message.includes('failed to send a request');
}

const UNDEPLOYED_MESSAGE =
  'The typeset review is not available yet — render-portfolio-review-pdf has not been '
  + 'deployed. Use “Generate Performance Report” for the existing PDF in the meantime.';

/** Request the document. Throws with a message worth showing a person. */
export async function requestPortfolioReview(
  request: PortfolioReviewRequest,
): Promise<PortfolioReviewResult> {
  const { data, error } = await invokeSecureFunction('render-portfolio-review-pdf', {
    reportId: request.reportId,
    includeReview: request.includeReview !== false,
    edition: request.edition ?? null,
    // A portfolio of thirty properties is a long document and WeasyPrint is a
    // network hop; the measured range is 18 to 26 pages and this is generous
    // against the worst case rather than against the median.
  }, { timeoutMs: 180_000 });

  if (!error && data?.url) {
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Portfolio_Analysis.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      reviewIncluded: data.reviewIncluded === true,
    };
  }

  if (looksUndeployed(error)) throw new Error(UNDEPLOYED_MESSAGE);
  throw new Error(error?.message || 'Could not generate the Portfolio Performance Review');
}
