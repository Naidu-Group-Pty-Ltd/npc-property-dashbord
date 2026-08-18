/**
 * Builder stock — which image the marketplace card shows.
 *
 * ONE RULE, AND IT IS NOT A RANKING.
 *
 *   A Builder Stock property may display the image the BUILDER SUPPLIED, or no
 *   image at all.
 *
 * Nothing else qualifies. Not a Street View of the street, not a satellite
 * still of the lot, not a search result that might be the development — none
 * of them is a photograph of the property, and a card that shows one is
 * telling a client something untrue about a house they are being asked to buy.
 * The honest alternative to a builder's photograph is an empty frame, so an
 * empty frame is what the card gets.
 *
 * WHAT THIS REPLACES. The earlier rule was a priority list: source-supplied
 * first, then `google_maps`, then `internet_search`. It meant every property
 * whose builder gave us nothing still showed a picture — badged "Location
 * imagery", which reads as a photograph of the property to everyone who is not
 * reading the badge.
 *
 * The other two stages are still WRITTEN. They are provenance, they are how a
 * support question about a missing image gets answered, and the three-stage
 * schema is unchanged. They are simply never chosen.
 *
 * It lives apart from `images.ts` so it can be exercised directly: `images.ts`
 * reaches for Google and Perplexity and cannot be loaded outside the edge
 * runtime, and a rule nothing can test is a rule that drifts.
 */
import {
  comparePrimaryEvidence, isPrimaryRole, readStoredEvidenceLevel, readStoredRole,
} from './sourceImageRole.pure.ts';
import {
  compareMarketplaceEligibility, isMarketplaceEligible,
} from './marketplaceEligibility.pure.ts';

/** The stage whose provenance is the builder's own document. */
export const SOURCE_SUPPLIED_STAGE = 'uploaded_document';
/** And the only verification that means "the builder gave us this". */
export const SOURCE_SUPPLIED_VERIFICATION = 'source_supplied';

/** The shape the rule needs. Anything else about an image is irrelevant here. */
export interface DisplayableImage {
  id: string;
  source_stage: string;
  verification_status?: string | null;
  processing_status?: string | null;
  position?: number | null;
  storage_path?: string | null;
  external_url?: string | null;
  /** Carries `role`: what the SOURCE presented this image as. */
  source_detail?: Record<string, unknown> | null;
}

/**
 * May this image be shown on a Builder Stock card?
 *
 * FIVE conditions, every time: the builder's own stage, the verification that
 * says so, a stage that actually completed, bytes to serve — and the role the
 * source gave it.
 *
 * THE ROLE IS THE ONE THAT WAS MISSING, and its absence is the whole defect.
 * The first four say "these exact bytes came out of the builder's source",
 * which was true of the bedroom render that Lot 537 Kirramingly Avenue showed
 * on its card. Only the fifth says "and the source presented this image as THIS
 * property's listing image", which was not true of it and is the only thing
 * that makes the badge "Builder supplied" mean what a client reads it to mean.
 *
 * An image with no recorded role is `unknown`, and `unknown` is never
 * displayable — including every row written before roles existed. Those are
 * demoted and re-derived by `reprocess_source_images` rather than trusted.
 */
export function isDisplayableSourceImage(image: DisplayableImage): boolean {
  return image.source_stage === SOURCE_SUPPLIED_STAGE
    && image.verification_status === SOURCE_SUPPLIED_VERIFICATION
    && image.processing_status === 'ready'
    && !!(image.storage_path || image.external_url)
    && isPrimaryRole(readStoredRole(image.source_detail))
    // And the sixth: the source designating it is not the same as it being a
    // picture to draw. A facade under a "$25,000 Rebate" ribbon passes all
    // five above. See `marketplaceEligibility.pure.ts`.
    && isMarketplaceEligible(image.source_detail);
}

/**
 * The card's image, from a property's images. Null means "show no image".
 *
 * There is normally exactly one candidate, because at most one image per
 * property can carry `primary_property`. Where a source supplies MORE than
 * one, the strength of the source's own evidence decides first — see
 * `comparePrimaryEvidence`.
 *
 * THE CASE THAT ADDED THAT STEP. A builder keeps a marketing tile in the row's
 * page-cover slot: the property's own facade with "$25,000 Rebate", "VIC" and
 * "LARA" set over it in coloured pills, or "Completed" and "SMSF". It is exact
 * builder-supplied imagery of that exact property, so it is correctly
 * `primary_property` on LEVEL 3 — a structural container designating one
 * image. Where the same property ALSO carries the clean original in a field
 * the builder named for it, that is LEVEL 1, and the level is the only thing
 * that distinguishes them: same property, same provenance, same role. Ordering
 * by `position` picked whichever the reader enumerated first.
 *
 * NOTHING HERE LOOKS AT THE PICTURE. The wording baked into a marketing tile
 * is not what demotes it and must never be — an appearance test cannot say
 * whose house it is, and a builder's own facade render carrying their own
 * "ARTIST IMPRESSION" line is not a marketing tile. What demotes it is that
 * the source said something stronger about a different image of the same
 * property. Where the source says nothing stronger, the tile stays: it is
 * still the picture the builder published for that property, and an empty
 * frame is not an improvement on it.
 *
 * `position` and then the id remain the tie-break, so re-running enrichment
 * cannot silently swap a card's picture.
 */
export function chooseDisplayableImage<T extends DisplayableImage>(images: T[]): T | null {
  const displayable = (images ?? []).filter(isDisplayableSourceImage);
  if (!displayable.length) return null;

  return [...displayable].sort((a, b) =>
    // Judged eligible before never judged, so deploying this cannot leave an
    // unexamined picture in front of an examined one.
    compareMarketplaceEligibility(a.source_detail, b.source_detail)
    || comparePrimaryEvidence(
      readStoredEvidenceLevel(a.source_detail), readStoredEvidenceLevel(b.source_detail))
    || (a.position ?? 0) - (b.position ?? 0)
    || String(a.id).localeCompare(String(b.id)))[0];
}

/**
 * Settle a property's `primary_image_id`.
 *
 * Returns the id chosen, or null when the builder supplied nothing — and in
 * that case the column is CLEARED rather than left pointing at whatever it
 * pointed at before. A stale pointer to a Street View is the defect; leaving
 * it in place because "nothing new was found" would preserve it.
 */
export async function chooseAndStorePrimaryImage(
  db: any,
  stockItemId: string,
): Promise<string | null> {
  const { data: images } = await db
    .from('builder_stock_item_images')
    .select('id, source_stage, verification_status, processing_status, position, storage_path, external_url, source_detail')
    .eq('stock_item_id', stockItemId);

  const primary = chooseDisplayableImage((images ?? []) as DisplayableImage[]);

  await db.from('builder_stock_items')
    .update({ primary_image_id: primary?.id ?? null })
    .eq('id', stockItemId);

  return primary?.id ?? null;
}

/**
 * Apply the rule to every property an organisation holds.
 *
 * Run at the end of a repair so that properties the repair never touched are
 * settled too: an item whose builder supplied nothing must END the run with no
 * primary image, not with the one it had before the rule changed.
 */
export async function enforceStrictPrimaryImages(
  db: any,
  organisationId: string,
): Promise<{ inspected: number; cleared: number; corrected: number }> {
  const outcome = { inspected: 0, cleared: 0, corrected: 0 };

  const { data: items } = await db
    .from('builder_stock_items')
    .select('id, primary_image_id')
    .eq('organisation_id', organisationId)
    .eq('lifecycle_status', 'active')
    .limit(20000);
  if (!items?.length) return outcome;

  const { data: images } = await db
    .from('builder_stock_item_images')
    .select('id, stock_item_id, source_stage, verification_status, processing_status, position, storage_path, external_url, source_detail')
    .eq('organisation_id', organisationId)
    .limit(200000);

  const byItem = new Map<string, DisplayableImage[]>();
  for (const image of (images ?? []) as Array<DisplayableImage & { stock_item_id: string }>) {
    const bucket = byItem.get(image.stock_item_id) ?? [];
    bucket.push(image);
    byItem.set(image.stock_item_id, bucket);
  }

  for (const item of items as Array<{ id: string; primary_image_id: string | null }>) {
    outcome.inspected += 1;
    const chosen = chooseDisplayableImage(byItem.get(item.id) ?? []);
    const next = chosen?.id ?? null;
    if (next === item.primary_image_id) continue;

    await db.from('builder_stock_items')
      .update({ primary_image_id: next })
      .eq('id', item.id);
    if (next === null) outcome.cleared += 1;
    else outcome.corrected += 1;
  }
  return outcome;
}
