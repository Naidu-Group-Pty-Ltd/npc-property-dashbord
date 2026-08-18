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
 * IT FAILS CLOSED, AND THAT IS THE POINT OF THE THIRD STATE. There are three
 * answers and not two:
 *
 *   eligible     measured, and carries no promotional treatment
 *   ineligible   measured, and does
 *   pending      NOT measured — an encoding no decoder here reads, a file that
 *                broke one, a picture past the resource ceiling
 *
 * `pending` is not `eligible`. An unreadable container must never be a way for
 * a marketing tile to walk past the rule: "we could not look" and "we looked
 * and it was clean" are different facts and are stored as different values.
 * The card shows nothing until the image can actually be assessed, and the
 * version below is what brings it back for assessment when the decoders grow.
 *
 * WHAT MAY NOT HAPPEN WHEN AN IMAGE IS REFUSED OR PENDING. Nothing may take
 * its place except another image that independently passes all four questions
 * for the same property. Not an interior, not a floorplan, not a masterplan,
 * not a location map, not another lot's facade, and none of the location or
 * search stages. Where there is no such image, the card shows nothing.
 *
 * Pure: no imports, no IO, no clock.
 */

/**
 * Bumped when the decision would change for bytes already assessed.
 *
 * DELIBERATELY NOT `PROVENANCE_VERSION`. Provenance is about where bytes came
 * from and never changes when a display rule does; tying the two would mean
 * every classifier improvement re-fetched every source, and every source
 * change re-ran every classification. They move independently, and a row
 * carries both numbers.
 *
 *   1  first release: flat coloured blocks, and prominent overlay typography
 *      regardless of colour or whether anything is drawn behind it
 */
export const MARKETPLACE_ELIGIBILITY_VERSION = 1;

/** The three answers. `pending` is the one that keeps this failing closed. */
export type MarketplaceEligibilityState = 'eligible' | 'ineligible' | 'pending';

/** Why an image the source designated may not be drawn on a card. */
export type MarketplaceRejection =
  /** Measured, and carrying promotional treatment. */
  | 'annotated_marketing_tile'
  /** Not measured: no decoder here reads this container. */
  | 'decoder_unsupported'
  /** Not measured: the decoder failed, or the picture was past its ceiling. */
  | 'decoder_failed';

/** What was measured, kept so a decision can be explained without re-reading. */
export interface MarketplaceOverlaySummary {
  largestShare: number;
  totalShare: number;
  regionCount: number;
  /** Tallest overlay text as a share of the picture's height, 0 for none. */
  textHeightShare: number;
  textLineCount: number;
}

export interface MarketplaceEligibility {
  state: MarketplaceEligibilityState;
  reason: MarketplaceRejection | null;
  /** False when the container could not be decoded at all. */
  measured: boolean;
  overlay: MarketplaceOverlaySummary | null;
}

/** The eligibility of an image nothing could read. NOT displayable. */
export function unmeasured(
  reason: 'decoder_unsupported' | 'decoder_failed',
): MarketplaceEligibility {
  return { state: 'pending', reason, measured: false, overlay: null };
}

/**
 * Turn an overlay measurement into the display decision.
 *
 * One rule: a picture carrying promotional treatment laid over it is not a
 * card image. What counts as promotional treatment is
 * `marketingOverlay.pure.ts`, and it names no word, colour, font or position.
 */
export function decideMarketplaceEligibility(
  overlay:
    | {
      annotated: boolean;
      largestShare: number;
      totalShare: number;
      regionCount: number;
      textHeightShare: number;
      textLineCount: number;
    }
    | null,
): MarketplaceEligibility {
  if (!overlay) return unmeasured('decoder_failed');
  const summary: MarketplaceOverlaySummary = {
    largestShare: overlay.largestShare,
    totalShare: overlay.totalShare,
    regionCount: overlay.regionCount,
    textHeightShare: overlay.textHeightShare,
    textLineCount: overlay.textLineCount,
  };
  return overlay.annotated
    ? { state: 'ineligible', reason: 'annotated_marketing_tile', measured: true, overlay: summary }
    : { state: 'eligible', reason: null, measured: true, overlay: summary };
}

/**
 * The `source_detail` keys the decision contributes.
 *
 * Stored beside the role rather than replacing anything in it, so a reader can
 * always see BOTH what the source said and what the marketplace did about it.
 * `marketplace_display_eligible` stays a boolean for anything already reading
 * it, and is true ONLY for the eligible state.
 */
export function marketplaceEligibilityDetail(
  eligibility: MarketplaceEligibility,
): Record<string, unknown> {
  return {
    marketplace_display_eligible: eligibility.state === 'eligible',
    marketplace_eligibility_state: eligibility.state,
    marketplace_rejection_reason: eligibility.reason,
    marketplace_measured: eligibility.measured,
    marketplace_overlay: eligibility.overlay
      ? {
        largest_share: eligibility.overlay.largestShare,
        total_share: eligibility.overlay.totalShare,
        region_count: eligibility.overlay.regionCount,
        text_height_share: eligibility.overlay.textHeightShare,
        text_line_count: eligibility.overlay.textLineCount,
      }
      : null,
    marketplace_eligibility_version: MARKETPLACE_ELIGIBILITY_VERSION,
  };
}

/**
 * The stored state, or `pending` where none was ever made.
 *
 * AN UNJUDGED IMAGE IS PENDING, WHICH IS NOT ELIGIBLE. A row written before
 * this existed has not been judged, and treating "never looked" as "looked and
 * it was fine" is precisely the fail-open this module refuses. The autonomous
 * settler brings them all through assessment; until it has, their cards show
 * nothing.
 */
export function readMarketplaceState(
  sourceDetail: Record<string, unknown> | null | undefined,
): MarketplaceEligibilityState {
  const raw = (sourceDetail ?? {}).marketplace_eligibility_state;
  if (raw === 'eligible' || raw === 'ineligible' || raw === 'pending') return raw;
  // A row written by the first shape of this feature, which stored only the
  // boolean. True still means measured-and-clean; anything else is unjudged.
  return (sourceDetail ?? {}).marketplace_display_eligible === true ? 'eligible' : 'pending';
}

/** The version the stored decision was made under. 0 when never made. */
export function readEligibilityVersion(
  sourceDetail: Record<string, unknown> | null | undefined,
): number {
  const raw = (sourceDetail ?? {}).marketplace_eligibility_version;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** May this image be drawn on a card? ONLY an explicit `eligible` may. */
export function isMarketplaceEligible(
  sourceDetail: Record<string, unknown> | null | undefined,
): boolean {
  return readMarketplaceState(sourceDetail) === 'eligible';
}

/**
 * Does this stored decision need making again?
 *
 * True for anything never judged, anything judged under an older algorithm,
 * and anything left `pending` — a pending row is one the decoders could not
 * read, and the next version's decoders may be able to.
 */
export function needsEligibilityAssessment(
  sourceDetail: Record<string, unknown> | null | undefined,
): boolean {
  if (readEligibilityVersion(sourceDetail) < MARKETPLACE_ELIGIBILITY_VERSION) return true;
  return readMarketplaceState(sourceDetail) === 'pending';
}
