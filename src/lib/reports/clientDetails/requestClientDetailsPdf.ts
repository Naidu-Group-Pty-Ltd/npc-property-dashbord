/**
 * Asking the server for a typeset Client Details report.
 *
 * ## One id crosses the wire
 *
 * Not the client's details. Every figure in this document is a persisted row in
 * one of nine tables, so the route reads them itself — which is the difference
 * between this format and the cash flow ones, where the arithmetic lives in a
 * modal against overrides nobody has saved.
 *
 * It also means the document does not depend on which screen asked for it. A
 * report produced from what a component happened to have fetched is a report
 * whose contents vary by route taken; this one cannot.
 *
 * ## No legacy fallback
 *
 * `requestCashFlowPdf` falls back to its in-browser generator when the route is
 * absent, because for that format the two renderers produce the same document
 * from the same inputs.
 *
 * Here they produce genuinely different documents — one is a stack of pictures
 * of the other's ancestor — so substituting either would send a broker something
 * nobody chose. A deployment gap means the new menu item does not work yet, and
 * it says so, naming the buttons that do.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface ClientDetailsPdfResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  /** Which sections the record had content for. */
  sections: string[];
  /** Holdings covered. Routinely zero — 745 of 771 clients have none. */
  propertyCount: number;
}

/**
 * True when the failure means "this function does not exist here yet".
 *
 * Deliberately narrow, and used only to choose the *message*. A bare 404 does
 * not count: the route answers 404 for a client that does not exist, and reading
 * that as "not deployed" would send someone to deploy a function that is already
 * there.
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
  'The typeset client details report is not available yet — render-client-details-pdf '
  + 'has not been deployed. The existing Download and Send to Finance buttons still work.';

/** Request the document. Throws with a message worth showing a person. */
export async function requestClientDetailsPdf(
  clientId: string,
  edition?: string | null,
): Promise<ClientDetailsPdfResult> {
  const { data, error } = await invokeSecureFunction('render-client-details-pdf', {
    clientId,
    edition: edition ?? null,
    // The largest real record runs to 26 pages across nine tables and WeasyPrint
    // is a network hop; generous against the worst case rather than the median.
    // The legacy's own cap was two minutes and it was reached.
  }, { timeoutMs: 180_000 });

  if (!error && data?.url) {
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Client_Details.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      sections: Array.isArray(data.sections) ? data.sections.map(String) : [],
      propertyCount: Number(data.propertyCount ?? 0),
    };
  }

  if (looksUndeployed(error)) throw new Error(UNDEPLOYED_MESSAGE);
  throw new Error(error?.message || 'Could not produce the client details report');
}
