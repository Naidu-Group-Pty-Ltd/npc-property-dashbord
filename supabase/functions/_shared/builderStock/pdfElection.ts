/**
 * BUILDER STOCK — THE ELECTION, WHEREVER IT RUNS.
 *
 * WHY THIS MODULE EXISTS. This is the smallest indivisible CPU-heavy unit in
 * the whole builder-stock path: read a document's page texts, judge from them
 * whether the document was readable at all, and elect the one image that is
 * this property's. Both halves parse the same multi-megabyte PDF and neither
 * can be split from the other — the election is handed the texts the read
 * produced.
 *
 * MEASURED 8 SEPTEMBER 2026, from the platform's own per-execution telemetry.
 * A thirteen-property cold start killed the settler thirteen times, and every
 * kill was `reason: CPUTime`: successful executions ended at 1,828 ms of CPU
 * or less, killed ones at 2,031 ms or more, against a 2,000 ms limit. Memory
 * peaked at 108 MB of a 256 MB ceiling — 42% — so the memory ceiling was never
 * the constraint and no scheduling rule could have helped. Lot 516 Winterset
 * Lodge costs about 1.7 s of CPU here on fast hardware; the limit is 2.0 s on
 * shared hardware, and the rest of the invocation draws on the same budget.
 *
 * So the work moved rather than shrank. `builder-stock-pdf-service` runs THIS
 * module — the same TypeScript, the same thresholds, the same winners — where
 * there is CPU to run it. Nothing here is a second implementation, and nothing
 * about which image wins is decided anywhere else.
 *
 * WHAT DELIBERATELY DID NOT MOVE. The fetch, the guarded fetcher and its SSRF
 * rules, the `%PDF-` sniff and the "a link to an image is not a package
 * document" identity rule all sit BEFORE this in `extractFromDocument` and are
 * cheap; moving them would have duplicated security logic for no CPU. Every
 * database write — branch attempts, provenance, the image pointer, upload
 * settlement — stays in the Supabase path, so this boundary reads a document
 * and answers, and touches no state at all.
 *
 * Pure of IO except the decoding itself: no database, no network, no clock.
 */
import { selectPdfPropertyPrimaryHoldingSlot } from './pdfSourcePhoto.ts';
import { withPdfDecodeSlot } from './pdfDecodeSlot.pure.ts';
// Type-only, so this is erased at runtime and no import cycle exists.
import type { PackageOutcome } from './packageImages.ts';

/** Everything the election needs about the property, and nothing else. */
export interface ElectionContext {
  /** The property this package is supposed to be about. */
  label: string;
  /** How this document came to be this property's. See `extractFromDocument`. */
  identifiedBy: 'folder_structure' | 'direct_link';
  /** The row's stated house design, for the design fallback. */
  design?: string | null;
  /** The row's other identity names, for the cover rule's corroboration test. */
  identityHints?: readonly string[] | null;
  /** The document's own name, as it appears in the reference string. */
  documentName: string;
  /** The document's address, carried through onto the provenance. */
  url: string;
}

/**
 * Read this document and elect this property's image, or say why not.
 *
 * The slot is taken ONCE around both stages, so one document is read from end
 * to end before another begins in the same isolate. See `pdfDecodeSlot`.
 */
export async function electFromPdfBytes(
  bytes: Uint8Array,
  readPageTexts: (bytes: Uint8Array) => Promise<
    { ok: true; pages: string[] } | { ok: false; reason: string }>,
  context: ElectionContext,
): Promise<PackageOutcome> {
  const { label, design, identityHints, identifiedBy, documentName, url } = context;
  return await withPdfDecodeSlot(async () => {
  const textResult = await readPageTexts(bytes);
  if (!textResult.ok) {
    return {
      status: 'unreachable',
      detail: `That document’s text could not be read (${"reason" in textResult ? textResult.reason : "unknown"}).`,
    };
  }
  /*
   * And zero pages is the same fault wearing a different hat, whichever reader
   * produced it: a PDF always has pages, so an empty list is the read failing
   * rather than the document being silent. Judged here rather than inside one
   * reader so every reader is held to it — the production one, and the ones
   * tests inject to stand in for it.
   */
  if (!textResult.pages.length) {
    return {
      status: 'unreachable',
      detail: 'That document\'s text could not be read (no pages came back).',
    };
  }
  /*
   * AND PAGES THAT CAME BACK EMPTY ARE THE SAME FAULT AGAIN.
   *
   * A package whose every page yields no text at all is not a package that says
   * nothing about the property — it is a package this reader cannot read. The
   * live list has them: "LOT 914 • COVELLA • GREENBANK QLD.pdf" is three pages
   * of designed brochure exported as images, and its first page carries the
   * lot, the estate, the suburb, the price, the land and house sizes and the
   * facade render, all of it drawn rather than set. Text extraction returns
   * zero characters from every page.
   *
   * Recording that as "the document names no image for this property" banks a
   * finished negative produced by a reader that never read the document — and
   * `negativeProvenanceStillStands` would then suppress the source until a
   * version bump. So it is operational, and the property is asked again: the
   * answer changes for free the day this can read a drawn page.
   *
   * PARTIAL emptiness is deliberately NOT this. A document with text on some
   * pages was read; that it says nothing identifying on the others is a fact
   * about the document.
   */
  const textFree = textResult.pages.every((text) => !String(text ?? '').trim());
  if (textFree && identifiedBy !== 'folder_structure') {
    return {
      status: 'unreachable',
      detail: 'That document\'s pages carry no extractable text, so it could not be read.',
    };
  }
  const pageTexts = textResult.pages;
  const selection = await selectPdfPropertyPrimaryHoldingSlot(bytes, {
    label,
    design,
    identityHints: identityHints ?? [],
    pageTexts,
    // Supplied ONLY when the builder's folder already named this document for
    // this one property and the document itself can say nothing. See
    // `assignPdfMediaRoles`.
    structuralCoverPage: textFree ? 1 : null,
  });
  const photo = selection.primary;
  if (!photo) {
    /*
     * A document nothing could be read from has still established nothing, even
     * where its first page was structurally eligible and presented no single
     * photograph. Recording a negative for it would bank an answer this reader
     * never earned, so it stays operational and the property is asked again.
     */
    if (textFree) {
      return {
        status: 'unreachable',
        detail: 'That document\'s pages carry no extractable text and its first page '
          + 'presents no single photograph, so it could not be read.',
      };
    }
    return {
      status: 'not_identified',
      detail: 'That document does not present a page as this property\'s package cover, '
        + 'so it names no image for it.',
    };
  }

  const suffix = photo.provenance.method === 'page_crop'
    ? `crop(${photo.provenance.crop?.top}-${photo.provenance.crop?.bottom})`
    : photo.provenance.resourceName;
  return {
    status: 'recovered',
    image: {
      bytes: photo.bytes,
      contentType: photo.contentType,
      reference: `${documentName}#page${photo.provenance.page}:${suffix}`,
      documentName,
      documentUrl: url,
      provenance: photo.provenance,
      role: photo.role,
    },
  };
  });
}
