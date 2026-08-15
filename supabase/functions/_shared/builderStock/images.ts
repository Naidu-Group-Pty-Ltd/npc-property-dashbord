/**
 * Builder stock — three-stage image enrichment.
 *
 * An imported property needs a picture, and there are exactly three places one
 * can come from. They are run in order, they are recorded SEPARATELY, and
 * their provenance is never merged:
 *
 *   1. uploaded_document  the builder's own render or photograph, taken out of
 *                         the file they uploaded. Written by `importStock.ts`
 *                         at import time, not here.
 *   2. google_maps        Street View or satellite imagery of the property's
 *                         actual address, fetched server-side so the API key
 *                         never reaches a browser.
 *   3. internet_search    a broader search for imagery of this development.
 *                         Kept as a URL plus where it was found, marked
 *                         `unverified` for ever, because nothing has confirmed
 *                         it depicts THIS property.
 *
 * THE STAGES MAY FAIL. A property whose address will not geocode, a
 * deployment with no Google key, a search that returns nothing — each records
 * its stage as unavailable and the import stands. Only a stage that produced
 * an image is allowed to change what the marketplace shows.
 */
import { meteredFetch } from '../meteredFetch.ts';
import { STOCK_IMAGE_BUCKET } from './fileTypes.pure.ts';
import { geocodableAddress } from './normalise.pure.ts';

export interface EnrichableStockItem {
  id: string;
  organisation_id: string;
  address_line: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  development_name: string | null;
  project_name: string | null;
  lot_number: string | null;
  unit_number: string | null;
}

export interface StageOutcome {
  stage: 'google_maps' | 'internet_search';
  status: 'ready' | 'unavailable' | 'failed';
  detail: string;
}

const FETCH_TIMEOUT_MS = 8000;

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Record a stage that produced nothing, so the UI can say why. */
async function recordStageUnavailable(
  db: any,
  item: EnrichableStockItem,
  stage: 'google_maps' | 'internet_search',
  status: 'unavailable' | 'failed',
  message: string,
  provider: string,
): Promise<StageOutcome> {
  await db.from('builder_stock_item_images').upsert({
    stock_item_id: item.id,
    organisation_id: item.organisation_id,
    source_stage: stage,
    source_reference: 'stage-status',
    source_provider: provider,
    processing_status: status,
    verification_status: stage === 'google_maps' ? 'location_derived' : 'unverified',
    error_message: message,
    position: 0,
  }, { onConflict: 'stock_item_id,source_stage,source_reference' });
  return { stage, status, detail: message };
}

// ---------------------------------------------------------------------------
// Stage 2 — Google Maps / location
// ---------------------------------------------------------------------------

/**
 * Street View of the address, falling back to a satellite still.
 *
 * The key is read from the environment inside this function and is never
 * returned to any caller: the bytes are stored in a private bucket and the
 * browser gets a short-lived signed URL from the edge function, exactly as
 * `street-view` does for the Listings page.
 */
export async function enrichFromGoogle(
  db: any,
  item: EnrichableStockItem,
): Promise<StageOutcome> {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) {
    return await recordStageUnavailable(
      db, item, 'google_maps', 'unavailable',
      'Location imagery is not configured for this workspace.', 'google');
  }

  const address = geocodableAddress(item);
  if (!address) {
    return await recordStageUnavailable(
      db, item, 'google_maps', 'unavailable',
      'This property has no street address to look up.', 'google');
  }

  try {
    const geocoded = await withTimeout((signal) => meteredFetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=au&key=${apiKey}`,
      { signal },
      { feature: 'builder-stock/geocode' },
    ));
    const geo = await geocoded.json().catch(() => null);
    const location = geo?.results?.[0]?.geometry?.location;
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return await recordStageUnavailable(
        db, item, 'google_maps', 'unavailable',
        'That address could not be located.', 'google');
    }

    const point = `${location.lat},${location.lng}`;
    let bytes: Uint8Array | null = null;
    let product = 'streetview';

    const metadata = await withTimeout((signal) => meteredFetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(point)}&key=${apiKey}`,
      { signal },
      { feature: 'builder-stock/streetview-metadata' },
    ));
    const meta = await metadata.json().catch(() => ({}));

    if (meta?.status === 'OK') {
      const params = new URLSearchParams({
        size: '640x400', location: point, fov: '80', pitch: '0',
        return_error_code: 'true', key: apiKey,
      });
      const image = await withTimeout((signal) => meteredFetch(
        `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`,
        { signal }, { feature: 'builder-stock/streetview' },
      ));
      if (image.ok) bytes = new Uint8Array(await image.arrayBuffer());
    }

    if (!bytes) {
      // No Street View coverage is normal on a new estate — the road may not
      // have been driven. A satellite still of the lot is still location
      // imagery of the right place.
      product = 'staticmap';
      const params = new URLSearchParams({
        center: point, zoom: '18', size: '640x400', maptype: 'satellite',
        markers: `color:red|${point}`, key: apiKey,
      });
      const image = await withTimeout((signal) => meteredFetch(
        `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`,
        { signal }, { feature: 'builder-stock/staticmap' },
      ));
      if (image.ok) bytes = new Uint8Array(await image.arrayBuffer());
    }

    if (!bytes || bytes.length < 1024) {
      return await recordStageUnavailable(
        db, item, 'google_maps', 'unavailable',
        'No location imagery is available for this address.', 'google');
    }

    const path = `${item.organisation_id}/items/${item.id}/google-${product}.jpg`;
    const { error: uploadError } = await db.storage
      .from(STOCK_IMAGE_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;

    await db.from('builder_stock_item_images').upsert({
      stock_item_id: item.id,
      organisation_id: item.organisation_id,
      source_stage: 'google_maps',
      source_reference: product,
      source_provider: 'google',
      storage_bucket: STOCK_IMAGE_BUCKET,
      storage_path: path,
      content_type: 'image/jpeg',
      byte_size: bytes.length,
      // Derived from the address we hold, which is a weaker claim than the
      // builder's own render and a much stronger one than a search result.
      verification_status: 'location_derived',
      confidence: product === 'streetview' ? 0.8 : 0.6,
      processing_status: 'ready',
      error_message: null,
      position: 0,
      source_detail: { address, latitude: location.lat, longitude: location.lng, product },
    }, { onConflict: 'stock_item_id,source_stage,source_reference' });

    return { stage: 'google_maps', status: 'ready', detail: product };
  } catch (error) {
    console.warn('[builderStock] google enrichment failed', {
      item: item.id, message: String((error as { message?: string })?.message ?? error),
    });
    return await recordStageUnavailable(
      db, item, 'google_maps', 'failed',
      'Location imagery could not be retrieved.', 'google');
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — broader internet search
// ---------------------------------------------------------------------------

/**
 * What the property is called out in the world, for a search engine.
 *
 * Deliberately more than the address: a new estate's lots are not indexed
 * individually, but the development and the builder are.
 */
export function stockSearchQuery(
  item: EnrichableStockItem,
  builderName: string | null,
): string | null {
  const parts: string[] = [];
  if (item.address_line) parts.push(item.address_line);
  const development = item.development_name ?? item.project_name;
  if (development) parts.push(development);
  if (item.suburb) parts.push(item.suburb);
  if (item.state) parts.push(item.state);
  if (builderName) parts.push(builderName);
  if (item.lot_number) parts.push(`Lot ${item.lot_number}`);
  else if (item.unit_number) parts.push(`Unit ${item.unit_number}`);
  // A search on a suburb alone returns pictures of somewhere else in it.
  if (!item.address_line && !development) return null;
  return parts.join(', ').slice(0, 300);
}

export async function enrichFromInternetSearch(
  db: any,
  item: EnrichableStockItem,
  builderName: string | null,
): Promise<StageOutcome> {
  const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
  if (!apiKey) {
    return await recordStageUnavailable(
      db, item, 'internet_search', 'unavailable',
      'Internet property search is not configured for this workspace.', 'perplexity');
  }

  const query = stockSearchQuery(item, builderName);
  if (!query) {
    return await recordStageUnavailable(
      db, item, 'internet_search', 'unavailable',
      'This property does not name enough to search for.', 'perplexity');
  }

  try {
    const response = await withTimeout((signal) => meteredFetch(
      'https://api.perplexity.ai/chat/completions',
      {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar',
          temperature: 0,
          max_tokens: 700,
          messages: [
            {
              role: 'system',
              content: 'You find publicly published photographs of Australian residential property. '
                + 'Reply with JSON only: {"images":[{"image_url":"...","source_page_url":"...","title":"..."}]}. '
                + 'Only include direct links to image files (.jpg, .jpeg, .png, .webp) that you found on the page you cite. '
                + 'Never guess a URL. If you find none, reply {"images":[]}.',
            },
            {
              role: 'user',
              content: `Find published photographs or renders of this property or its development: ${query}`,
            },
          ],
        }),
      },
      { feature: 'builder-stock/image-search', model: 'sonar' },
    ));

    if (!response.ok) {
      return await recordStageUnavailable(
        db, item, 'internet_search', 'failed',
        'The property search service did not respond.', 'perplexity');
    }

    const payload = await response.json().catch(() => null);
    const content = String(payload?.choices?.[0]?.message?.content ?? '');
    const candidates = parseSearchImages(content);

    if (!candidates.length) {
      return await recordStageUnavailable(
        db, item, 'internet_search', 'unavailable',
        'No published imagery was found for this property.', 'perplexity');
    }

    for (const [index, candidate] of candidates.entries()) {
      await db.from('builder_stock_item_images').upsert({
        stock_item_id: item.id,
        organisation_id: item.organisation_id,
        source_stage: 'internet_search',
        source_reference: candidate.imageUrl.slice(0, 400),
        source_provider: 'perplexity',
        source_page_url: candidate.pageUrl,
        // NOT stored. An unverified internet image is kept as a link with its
        // provenance; copying it into our bucket would make it look like ours.
        external_url: candidate.imageUrl,
        verification_status: 'unverified',
        confidence: 0.3,
        processing_status: 'ready',
        position: index,
        source_detail: { query, title: candidate.title },
      }, { onConflict: 'stock_item_id,source_stage,source_reference' });
    }

    return { stage: 'internet_search', status: 'ready', detail: `${candidates.length} candidate(s)` };
  } catch (error) {
    console.warn('[builderStock] internet search failed', {
      item: item.id, message: String((error as { message?: string })?.message ?? error),
    });
    return await recordStageUnavailable(
      db, item, 'internet_search', 'failed',
      'The property search could not be completed.', 'perplexity');
  }
}

interface SearchCandidate { imageUrl: string; pageUrl: string | null; title: string | null }

/** Pull the candidates out of the model's reply, discarding anything unusable. */
export function parseSearchImages(content: string): SearchCandidate[] {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: { images?: unknown };
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed.images) ? parsed.images : [];
  const out: SearchCandidate[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const imageUrl = String((row as { image_url?: unknown }).image_url ?? '').trim();
    if (!/^https:\/\/[^\s"']+$/i.test(imageUrl)) continue;
    if (imageUrl.length > 1500) continue;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(imageUrl)) continue;
    if (seen.has(imageUrl)) continue;
    seen.add(imageUrl);

    const pageUrl = String((row as { source_page_url?: unknown }).source_page_url ?? '').trim();
    out.push({
      imageUrl,
      pageUrl: /^https?:\/\//i.test(pageUrl) ? pageUrl.slice(0, 1500) : null,
      title: String((row as { title?: unknown }).title ?? '').trim().slice(0, 200) || null,
    });
    if (out.length >= 4) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run stages 2 and 3 for one property and settle its enrichment status.
 *
 * Stage 1 already ran at import time. The primary image is then chosen by
 * priority — the builder's own image, then location imagery, then a search
 * result — and nothing is deleted when a better one appears.
 */
export async function enrichStockItem(
  db: any,
  item: EnrichableStockItem,
  builderName: string | null,
): Promise<{ outcomes: StageOutcome[]; enrichmentStatus: string }> {
  await db.from('builder_stock_items')
    .update({ enrichment_status: 'enriching' })
    .eq('id', item.id);

  const outcomes: StageOutcome[] = [];
  outcomes.push(await enrichFromGoogle(db, item));
  outcomes.push(await enrichFromInternetSearch(db, item, builderName));

  const primaryImageId = await chooseAndStorePrimaryImage(db, item.id);
  const anyReady = !!primaryImageId;
  const anyProblem = outcomes.some((outcome) => outcome.status !== 'ready');

  const enrichmentStatus = anyReady
    ? (anyProblem ? 'partial' : 'complete')
    : 'failed';

  await db.from('builder_stock_items')
    .update({ enrichment_status: enrichmentStatus, enriched_at: new Date().toISOString() })
    .eq('id', item.id);

  return { outcomes, enrichmentStatus };
}

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

  usable.sort((a: any, b: any) =>
    (STAGE_PRIORITY[a.source_stage] ?? 9) - (STAGE_PRIORITY[b.source_stage] ?? 9)
    || (a.position ?? 0) - (b.position ?? 0));

  const primary = usable[0];
  await db.from('builder_stock_items')
    .update({ primary_image_id: primary.id })
    .eq('id', stockItemId);
  return primary.id;
}
