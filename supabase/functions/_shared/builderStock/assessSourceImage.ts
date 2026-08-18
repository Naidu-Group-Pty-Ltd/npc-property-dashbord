/**
 * Builder stock — running the marketplace display test over real bytes.
 *
 * The glue between the decoder and the decision, and the ONE place ingestion
 * calls. Every format reaches it: a Notion cover, a spreadsheet's embedded
 * media, a PDF's page raster, a DOCX hero, an HTML card's image, a linked
 * Drive package, a direct upload. They differ in how the bytes are found and
 * in nothing after that, which is why this takes bytes and knows nothing about
 * where they came from.
 *
 * IT IS ONLY EVER ASKED ABOUT A PRIMARY. An image the source did not designate
 * cannot be drawn on a card whatever it looks like, so measuring one would be
 * spending an inverse DCT to answer a question nobody asked.
 */
import { decodeThumbnail } from './sourceImageRaster.ts';
import { readMarketingOverlay } from './marketingOverlay.pure.ts';
import {
  decideMarketplaceEligibility, marketplaceEligibilityDetail, UNMEASURED,
  type MarketplaceEligibility,
} from './marketplaceEligibility.pure.ts';
import { isPrimaryRole } from './sourceImageRole.pure.ts';

/**
 * Judge bytes the pipeline is about to store.
 *
 * Never throws: a decoder that fails on a builder's file must not fail their
 * import, and an unmeasured image stays displayable.
 */
export async function assessMarketplaceEligibility(
  bytes: Uint8Array,
): Promise<MarketplaceEligibility> {
  try {
    const view = await decodeThumbnail(bytes);
    if (!view) return UNMEASURED;
    return decideMarketplaceEligibility(readMarketingOverlay(view));
  } catch {
    return UNMEASURED;
  }
}

/**
 * The `source_detail` keys to merge into a row being written, for an image
 * whose role is already known.
 *
 * A non-primary image is not measured and carries no decision: it was never a
 * candidate, and recording a display verdict for it would suggest it was.
 */
export async function eligibilityDetailFor(
  bytes: Uint8Array,
  role: unknown,
): Promise<Record<string, unknown>> {
  if (!isPrimaryRole(role)) return {};
  return marketplaceEligibilityDetail(await assessMarketplaceEligibility(bytes));
}
