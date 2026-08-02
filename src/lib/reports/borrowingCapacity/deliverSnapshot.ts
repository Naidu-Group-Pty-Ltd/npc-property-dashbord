/**
 * Getting a Borrowing Capacity Snapshot into someone's hands.
 *
 * ## Why this exists
 *
 * Four call sites each had their own copy of the same twelve lines: create an
 * anchor, set `download`, append it to the body, click it, remove it, remember
 * to revoke the object URL — but only when the blob was one we made. Two of the
 * four forgot the revoke. That is not a bug worth four fixes; it is a function.
 *
 * ## The variant, and why it is a parameter
 *
 * `requestSnapshot.ts` treats the legacy generator as a *deployment* fallback:
 * reached only when the render function is absent, and never otherwise. That was
 * right for landing the new path and wrong as a resting state — the moment the
 * function is deployed, the generator that has produced this document for the
 * life of the product becomes unreachable from every button in the app. Nobody
 * decided to retire it; it would simply have stopped happening.
 *
 * So the choice is explicit here. `variant: 'server'` is the default everywhere
 * and still carries the undeployed-fallback, because that is a different
 * situation with a different answer. `variant: 'legacy'` is a person choosing
 * the layout they know, and it is offered beside the other on every surface that
 * produces this document.
 */
import { requestBorrowingCapacitySnapshot, type SnapshotRequest } from './requestSnapshot';

/** Which renderer produces the document. */
export type SnapshotVariant = 'server' | 'legacy';

/** What the legacy generator hands back. `undefined` is its failure shape. */
export type LegacySnapshot = { blob: Blob; fileName: string } | null | undefined;

export interface DeliverSnapshotInput {
  variant: SnapshotVariant;
  request: SnapshotRequest;
  /**
   * The in-browser generator, bound to whatever this call site knows.
   *
   * Passed in rather than imported so a bundle that only ever asks the server
   * does not carry jsPDF, and so a call site with live what-if overrides can
   * hand in the generator call that renders them.
   */
  legacy: () => Promise<LegacySnapshot>;
}

export interface DeliveredSnapshot {
  /** Which renderer actually produced it — `legacy` may mean chosen or fallen back to. */
  source: 'server' | 'legacy';
  fileName: string;
  /** What the tenant's brand snapshot was missing. Always empty for the legacy path. */
  brandGaps: string[];
}

/**
 * Save a file the way a browser saves files.
 *
 * An object URL is revoked and a signed URL is not — revoking a URL we did not
 * create does nothing, but the distinction is worth keeping visible because the
 * bug it prevents (a revoked blob URL clicked twice) is invisible until someone
 * clicks twice.
 */
function saveToBrowser(url: string, fileName: string, revoke: boolean): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The legacy generator, run and saved. */
async function deliverLegacy(legacy: () => Promise<LegacySnapshot>): Promise<DeliveredSnapshot> {
  const produced = await legacy();
  if (!produced?.blob) {
    throw new Error('The in-browser generator produced no document');
  }
  const url = URL.createObjectURL(produced.blob);
  saveToBrowser(url, produced.fileName, true);
  return { source: 'legacy', fileName: produced.fileName, brandGaps: [] };
}

/**
 * Produce the Snapshot and hand it to the browser.
 *
 * Throws on failure with the message the renderer gave, so a caller can put it
 * in front of the person who pressed the button rather than in a console.
 */
export async function deliverSnapshot(input: DeliverSnapshotInput): Promise<DeliveredSnapshot> {
  if (input.variant === 'legacy') return deliverLegacy(input.legacy);

  const result = await requestBorrowingCapacitySnapshot(input.request, async () => {
    const produced = await input.legacy();
    if (!produced?.blob) return null;
    return {
      url: URL.createObjectURL(produced.blob),
      fileName: produced.fileName,
      bytes: produced.blob.size,
    };
  });

  if (result.source === 'legacy') {
    // The fallback already made an object URL; save it and revoke it.
    saveToBrowser(result.url, result.fileName, true);
    return { source: 'legacy', fileName: result.fileName, brandGaps: [] };
  }

  // A signed URL. Fetched rather than followed, so the file is *saved* — a PDF
  // that opens in a tab is a PDF the client has to find again.
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  saveToBrowser(url, result.fileName, true);

  return { source: 'server', fileName: result.fileName, brandGaps: result.brandGaps };
}

/**
 * The Snapshot as bytes, for a caller that uploads it rather than saving it.
 *
 * `ClientReportsTab`'s publish-to-portal path is the only one of these: it puts
 * the file in `client-files/portal-reports/<clientId>/…` and has never handed it
 * to the browser. The contract that path needs is a blob and a filename,
 * produced without a download side effect — which is exactly what this returns.
 */
export async function snapshotBlob(input: DeliverSnapshotInput): Promise<{
  blob: Blob;
  fileName: string;
  source: 'server' | 'legacy';
  brandGaps: string[];
}> {
  if (input.variant === 'legacy') {
    const produced = await input.legacy();
    if (!produced?.blob) throw new Error('The in-browser generator produced no document');
    return { blob: produced.blob, fileName: produced.fileName, source: 'legacy', brandGaps: [] };
  }

  let legacyBlob: Blob | null = null;
  const result = await requestBorrowingCapacitySnapshot(input.request, async () => {
    const produced = await input.legacy();
    if (!produced?.blob) return null;
    legacyBlob = produced.blob;
    // The URL is never used on this path; the caller wants the bytes.
    return { url: '', fileName: produced.fileName, bytes: produced.blob.size };
  });

  if (result.source === 'legacy') {
    if (!legacyBlob) throw new Error('The in-browser generator produced no document');
    return { blob: legacyBlob, fileName: result.fileName, source: 'legacy', brandGaps: [] };
  }

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Could not read the rendered document (${response.status})`);
  return {
    blob: await response.blob(),
    fileName: result.fileName,
    source: 'server',
    brandGaps: result.brandGaps,
  };
}
