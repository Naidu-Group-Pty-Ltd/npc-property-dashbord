/**
 * Builder stock — the FOURTH question about an image.
 *
 * Three were already asked and answered, each by its own module, and none of
 * them is this one:
 *
 *   1  PROVENANCE   did these exact bytes come out of the builder's source?
 *                   (`sourceImages.ts`, and the hashes in `source_detail`)
 *   2  OWNERSHIP    can they be tied to THIS property deterministically?
 *                   (`sourceAssets.pure.ts`, the anchors, the page tree)
 *   3  ROLE         did the source present them as its primary image?
 *                   (`sourceImageRole.pure.ts`)
 *   4  DISPLAY      is that image one to put on a marketplace card?
 *
 * ALL THREE OF THE FIRST CAN ANSWER YES AND THE FOURTH STILL BE NO. Lot 13
 * Hummock Rise and Lot 1663 Ringer Street are exactly that: the builder's own
 * bytes, of that exact property, designated by the source as its listing image
 * — and the picture is the facade under green pills reading "Completed" and
 * "SMSF", a red one reading "$25,000 Rebate", and suburb and state banners.
 * Provenance is perfect and the card is still wrong.
 *
 * SO THE ANSWER IS RECORDED SEPARATELY AND NOTHING ELSE IS TOUCHED. The role
 * stays `primary_property`, because that is what the source said and falsifying
 * it to hide the picture would put a lie in the audit trail. What changes is
 * one extra fact stored beside it, and the display rule reads both.
 *
 * WHAT MAY NOT HAPPEN WHEN AN IMAGE IS REFUSED. Nothing may take its place
 * except another image that independently passes all four questions for the
 * same property. Not an interior, not a floorplan, not a masterplan, not a
 * location map, not another lot's facade, and none of the location or search
 * stages — those were never candidates and are not candidates now. Where there
 * is no such image, the card shows nothing, which is the honest outcome and
 * the one the product asks for.
 *
 * Pure: no imports, no IO, no clock.
 */

/** Bumped when the decision would change for bytes already assessed. */
export const MARKETPLACE_ELIGIBILITY_VERSION = 1;

/** Why an image the source designated may not be drawn on a card. */
export type MarketplaceRejection = 'annotated_marketing_tile';

/** What was measured, kept so a decision can be explained without re-reading. */
export interface MarketplaceOverlaySummary {
  largestShare: number;
  totalShare: number;
  regionCount: number;
}

export interface MarketplaceEligibility {
  eligible: boolean;
  reason: MarketplaceRejection | null;
  /**
   * False when the container could not be decoded at all.
   *
   * An unmeasured image stays ELIGIBLE. Refusing to show a builder's
   * photograph because its format is one we cannot parse would be a worse
   * defect than the one this exists to fix, and the version field below is
   * what lets a later decoder revisit it.
   */
  measured: boolean;
  overlay: MarketplaceOverlaySummary | null;
}

/** The eligibility of an image nothing could read. Displayable, unmeasured. */
export const UNMEASURED: MarketplaceEligibility = {
  eligible: true, reason: null, measured: false, overlay: null,
};

/**
 * Turn an overlay measurement into the display decision.
 *
 * One rule: a picture carrying a promotional graphic laid over it is not a
 * card image. The measurement that establishes "promotional graphic" is
 * `marketingOverlay.pure.ts`, and it names no word, colour, font or position.
 */
export function decideMarketplaceEligibility(
  overlay: { annotated: boolean; largestShare: number; totalShare: number; regionCount: number } | null,
): MarketplaceEligibility {
  if (!overlay) return UNMEASURED;
  const summary: MarketplaceOverlaySummary = {
    largestShare: overlay.largestShare,
    totalShare: overlay.totalShare,
    regionCount: overlay.regionCount,
  };
  return overlay.annotated
    ? { eligible: false, reason: 'annotated_marketing_tile', measured: true, overlay: summary }
    : { eligible: true, reason: null, measured: true, overlay: summary };
}

/**
 * The `source_detail` keys the decision contributes.
 *
 * Stored beside the role rather than replacing anything in it, so a reader can
 * always see BOTH what the source said and what the marketplace did about it.
 */
export function marketplaceEligibilityDetail(
  eligibility: MarketplaceEligibility,
): Record<string, unknown> {
  return {
    marketplace_display_eligible: eligibility.eligible,
    marketplace_rejection_reason: eligibility.reason,
    marketplace_measured: eligibility.measured,
    marketplace_overlay: eligibility.overlay
      ? {
        largest_share: eligibility.overlay.largestShare,
        total_share: eligibility.overlay.totalShare,
        region_count: eligibility.overlay.regionCount,
      }
      : null,
    marketplace_eligibility_version: MARKETPLACE_ELIGIBILITY_VERSION,
  };
}

/**
 * The stored decision, or null where none was ever made.
 *
 * NULL IS NOT FALSE. An image stored before this existed has not been judged,
 * and hiding every one of them the moment this deploys would empty cards whose
 * pictures are perfectly good. They stay displayable and are re-judged by
 * `reprocess_source_images`; until then they simply rank behind anything that
 * HAS been judged eligible — see `compareMarketplaceEligibility`.
 */
export function readMarketplaceEligible(
  sourceDetail: Record<string, unknown> | null | undefined,
): boolean | null {
  const raw = (sourceDetail ?? {}).marketplace_display_eligible;
  return raw === true || raw === false ? raw : null;
}

/** The version the stored decision was made under. 0 when never made. */
export function readEligibilityVersion(
  sourceDetail: Record<string, unknown> | null | undefined,
): number {
  const raw = (sourceDetail ?? {}).marketplace_eligibility_version;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** May this image be drawn on a card? Only an explicit `false` forbids it. */
export function isMarketplaceEligible(
  sourceDetail: Record<string, unknown> | null | undefined,
): boolean {
  return readMarketplaceEligible(sourceDetail) !== false;
}

/**
 * Order two candidates: judged-eligible first, unjudged after.
 *
 * A legacy image carries no decision, and must never outrank one that has been
 * measured and passed — otherwise deploying this would leave a card showing
 * the older, unexamined picture while the examined one waits behind it.
 */
export function compareMarketplaceEligibility(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): number {
  const rank = (detail: Record<string, unknown> | null | undefined) =>
    readMarketplaceEligible(detail) === true ? 0 : 1;
  return rank(a) - rank(b);
}

/** Does this stored decision need making again? */
export function needsEligibilityAssessment(
  sourceDetail: Record<string, unknown> | null | undefined,
): boolean {
  return readEligibilityVersion(sourceDetail) < MARKETPLACE_ELIGIBILITY_VERSION;
}
