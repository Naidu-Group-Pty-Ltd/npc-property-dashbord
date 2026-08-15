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
}

/**
 * May this image be shown on a Builder Stock card?
 *
 * All four conditions, every time: the builder's own stage, the verification
 * that says so, a stage that actually completed, and bytes to serve.
 */
export function isDisplayableSourceImage(image: DisplayableImage): boolean {
  return image.source_stage === SOURCE_SUPPLIED_STAGE
    && image.verification_status === SOURCE_SUPPLIED_VERIFICATION
    && image.processing_status === 'ready'
    && !!(image.storage_path || image.external_url);
}

/**
 * The card's image, from a property's images. Null means "show no image".
 *
 * Ordering among displayable images is by `position` — the order the source
 * itself presented them — with the id as a stable last resort so re-running
 * enrichment cannot silently swap a card's picture.
 */
export function chooseDisplayableImage<T extends DisplayableImage>(images: T[]): T | null {
  const displayable = (images ?? []).filter(isDisplayableSourceImage);
  if (!displayable.length) return null;

  return [...displayable].sort((a, b) =>
    (a.position ?? 0) - (b.position ?? 0)
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
    .select('id, source_stage, verification_status, processing_status, position, storage_path, external_url')
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
    .select('id, stock_item_id, source_stage, verification_status, processing_status, position, storage_path, external_url')
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
