/**
 * Builder stock — which image the marketplace card shows.
 *
 * One rule, in one place, because it is the rule the whole imagery programme
 * exists to protect. It lives apart from `images.ts` so it can be exercised
 * directly: `images.ts` reaches for Google and Perplexity and cannot be loaded
 * outside the edge runtime, and a rule nothing can test is a rule that drifts.
 */
/**
 * Image priority for the marketplace card.
 *
 * The builder's own image outranks everything: it is the only one that is
 * certainly this property. A search result is used only when nothing else
 * exists, and the UI still labels it unverified.
 */
const STAGE_PRIORITY: Record<string, number> = {
  uploaded_document: 0,
  google_maps: 1,
  internet_search: 2,
};

/** The stage whose provenance is the builder's own document. */
export const SOURCE_SUPPLIED_STAGE = 'uploaded_document';

export async function chooseAndStorePrimaryImage(
  db: any,
  stockItemId: string,
): Promise<string | null> {
  const { data: images } = await db
    .from('builder_stock_item_images')
    .select('id, source_stage, position, storage_path, external_url')
    .eq('stock_item_id', stockItemId)
    .eq('processing_status', 'ready');

  const usable = (images ?? []).filter((image: any) => image.storage_path || image.external_url);
  if (!usable.length) return null;

  /**
   * THE SOURCE-SUPPLIED IMAGE WINS OUTRIGHT — it is not merely first in a
   * ranking that something else could climb.
   *
   * Stated as a partition rather than left to the comparator, because a
   * comparator is a rule about ORDER and this is a rule about ELIGIBILITY:
   * once the builder has given us a photograph of this property, a Street View
   * of the street and a search result that might be the development are not
   * candidates at all. Ranking is what decides between two images of the same
   * standing.
   */
  const sourceSupplied = usable.filter(
    (image: any) => image.source_stage === SOURCE_SUPPLIED_STAGE);
  const candidates = sourceSupplied.length ? sourceSupplied : usable;

  candidates.sort((a: any, b: any) =>
    (STAGE_PRIORITY[a.source_stage] ?? 9) - (STAGE_PRIORITY[b.source_stage] ?? 9)
    || (a.position ?? 0) - (b.position ?? 0)
    // A stable last resort, so re-running enrichment cannot silently swap the
    // card's picture between two equally ranked images.
    || String(a.id).localeCompare(String(b.id)));

  const primary = candidates[0];
  await db.from('builder_stock_items')
    .update({ primary_image_id: primary.id })
    .eq('id', stockItemId);
  return primary.id;
}
