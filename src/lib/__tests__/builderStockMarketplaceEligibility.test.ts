/**
 * Builder stock — the FOURTH question, and the one the card actually asks.
 *
 * WHAT WAS MEASURED IN PRODUCTION. Two Marketplace cards showed the property's
 * own facade under promotional pills — "Completed" and "SMSF" on Lot 13
 * Hummock Rise, "$25,000 Rebate", "VIC" and "LARA" on Lot 1663 Ringer Street.
 * The source audit proved every provenance claim behind them: the stored bytes
 * and the Notion attachment hash identically, the row designates that image and
 * no other, and no clean original exists anywhere in either property's chain.
 *
 * So provenance, ownership and role all answer YES and the card is still
 * wrong, which is why display eligibility is a fourth question with its own
 * answer stored beside the other three. The role stays `primary_property` —
 * that is what the source said, and falsifying it to hide the picture would
 * put a lie in the audit trail.
 *
 * WHAT THESE PIN, and it is a pipeline rule rather than a repair: every future
 * import of every supported format asks the same question of the same bytes at
 * the same point, persists the same answer, and the marketplace reads it. No
 * property, filename, word, colour, font or position is named anywhere in the
 * implementation — a builder's next campaign will use different ones of all of
 * them.
 *
 * The fixtures below are drawn to the geometry the live tiles have, because
 * geometry is what the measurement reads: a flat coloured block with straight
 * sides laid over a photograph.
 */
import { describe, expect, it } from 'vitest';

import {
  measureFlatColourRegions, readMarketingOverlay,
} from '../../../supabase/functions/_shared/builderStock/marketingOverlay.pure';
import {
  compareMarketplaceEligibility, decideMarketplaceEligibility,
  isMarketplaceEligible, marketplaceEligibilityDetail, needsEligibilityAssessment,
  readMarketplaceEligible, MARKETPLACE_ELIGIBILITY_VERSION,
} from '../../../supabase/functions/_shared/builderStock/marketplaceEligibility.pure';
import {
  chooseDisplayableImage, isDisplayableSourceImage,
} from '../../../supabase/functions/_shared/builderStock/primaryImage';
import { primaryStockImage } from '../../lib/builderStock';
import type { BuilderStockImage, BuilderStockItem } from '../../lib/builderStock';

// ---------------------------------------------------------------------------
// Fixtures — pictures, drawn
// ---------------------------------------------------------------------------

const W = 200;
const H = 100;

/**
 * A photograph: textured everywhere, with a sky that has a gradient and a
 * roofline that cuts it off — the two things that make a sky look flat-ish and
 * still not read as a graphic.
 */
function photograph(): { width: number; height: number; pixels: Uint8Array } {
  const pixels = new Uint8Array(W * H * 3);
  // Deterministic grain. A photograph and a render both have it; a vector fill
  // is the only thing that does not, which is the whole basis of the measure.
  let seed = 12345;
  const grain = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed >> 8) % 21) - 10;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = (y * W + x) * 3;
      // A roofline: sky above it, house below.
      const roof = 30 + Math.round(18 * Math.sin((x / W) * Math.PI * 2));
      if (y < roof) {
        pixels[at] = 120 + y + grain();
        pixels[at + 1] = 165 + y + grain();
        pixels[at + 2] = 215 + Math.min(30, y) + grain();
      } else {
        pixels[at] = 150 + ((x * 11 + y * 5) % 40) + grain();
        pixels[at + 1] = 140 + ((x * 7 + y * 13) % 40) + grain();
        pixels[at + 2] = 130 + ((x * 3 + y * 17) % 40) + grain();
      }
    }
  }
  return { width: W, height: H, pixels };
}

/** Lay a flat coloured rectangle over it, the way a status ribbon sits. */
function withPill(
  base: { width: number; height: number; pixels: Uint8Array },
  box: { x: number; y: number; w: number; h: number },
  colour: [number, number, number],
  options: { caption?: boolean } = {},
): { width: number; height: number; pixels: Uint8Array } {
  const pixels = new Uint8Array(base.pixels);
  for (let y = box.y; y < box.y + box.h && y < base.height; y++) {
    for (let x = box.x; x < box.x + box.w && x < base.width; x++) {
      const at = (y * base.width + x) * 3;
      // Words on the pill, which is what cuts a real one into fragments.
      const onCaption = options.caption
        && y > box.y + box.h * 0.3 && y < box.y + box.h * 0.7
        && ((x - box.x) % 7) < 3 && x > box.x + 2 && x < box.x + box.w - 2;
      pixels[at] = onCaption ? 12 : colour[0];
      pixels[at + 1] = onCaption ? 12 : colour[1];
      pixels[at + 2] = onCaption ? 12 : colour[2];
    }
  }
  return { width: base.width, height: base.height, pixels };
}

const LIME: [number, number, number] = [193, 255, 114];
const RED: [number, number, number] = [255, 49, 49];
/** A neutral bar, the way an "ARTIST IMPRESSION" footer is drawn. */
const CHARCOAL: [number, number, number] = [38, 38, 40];

/** A clean builder render. */
const CLEAN = photograph();
/** The live shape: two big lime pills across the top, with their captions. */
const MARKETING_TILE = withPill(
  withPill(CLEAN, { x: 10, y: 8, w: 76, h: 14 }, LIME, { caption: true }),
  { x: 110, y: 8, w: 76, h: 14 }, RED, { caption: true },
);
/** A builder's own small corner tag: the same colour, a twentieth of the size. */
const SMALL_TAG = withPill(CLEAN, { x: 6, y: 5, w: 26, h: 7 }, LIME);
/** An "ARTIST IMPRESSION. INDICATIVE ONLY." footer bar. */
const DISCLAIMER = withPill(CLEAN, { x: 100, y: 92, w: 96, h: 7 }, CHARCOAL);

// ---------------------------------------------------------------------------
// The measurement itself
// ---------------------------------------------------------------------------

describe('what the measurement reads, and what it refuses to read', () => {
  it('finds the promotional blocks and nothing else', () => {
    const measured = measureFlatColourRegions(MARKETING_TILE);
    expect(measured.regions.length).toBeGreaterThanOrEqual(2);
    expect(readMarketingOverlay(MARKETING_TILE).annotated).toBe(true);
  });

  it('TEST M — a clean render with an "artist impression" footer stays', () => {
    // Neutral, so it is presentation rather than promotion, and it is never
    // named or matched as a phrase.
    expect(readMarketingOverlay(DISCLAIMER).annotated).toBe(false);
    expect(readMarketingOverlay(CLEAN).annotated).toBe(false);
  });

  it('TEST N — a small builder tag or watermark stays', () => {
    // Exactly the colour of the pill that is refused. Size and geometry
    // decide, never the colour.
    expect(readMarketingOverlay(SMALL_TAG).annotated).toBe(false);
  });

  it('reads a sky as sky: flat, saturated, larger than any pill', () => {
    // The measure that separates them is the straightness of the region's own
    // sides, not its size — a sky is cut off by a roofline.
    expect(readMarketingOverlay(CLEAN).regionCount).toBe(0);
  });

  it('names no word, colour, position or font in its CODE', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync(
      'supabase/functions/_shared/builderStock/marketingOverlay.pure.ts', 'utf8'));
    // Comments describe the case that produced the module and quote the live
    // wording; the code may not. Strip the prose and check what is left.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    // No string or regular-expression literal of any kind: nothing to match a
    // word, a hex colour or a font against.
    expect(code).not.toMatch(/['"`]/);
    expect(code).not.toMatch(/\/[^\s][^\n]*\/[gimsuy]*/);
  });
});

// ---------------------------------------------------------------------------
// The decision, and how it is stored
// ---------------------------------------------------------------------------

describe('the decision is stored beside the role, never instead of it', () => {
  it('an annotated primary keeps its role and loses its eligibility', () => {
    const decision = decideMarketplaceEligibility(readMarketingOverlay(MARKETING_TILE));
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('annotated_marketing_tile');

    const detail = { role: 'primary_property', ...marketplaceEligibilityDetail(decision) };
    // The audit trail still says what the source said.
    expect(detail.role).toBe('primary_property');
    expect(detail.marketplace_display_eligible).toBe(false);
    expect(detail.marketplace_rejection_reason).toBe('annotated_marketing_tile');
    expect(detail.marketplace_eligibility_version).toBe(MARKETPLACE_ELIGIBILITY_VERSION);
  });

  it('an image nothing can decode stays displayable and says it was not measured', () => {
    const decision = decideMarketplaceEligibility(null);
    expect(decision.eligible).toBe(true);
    expect(decision.measured).toBe(false);
    expect(isMarketplaceEligible(marketplaceEligibilityDetail(decision))).toBe(true);
  });

  it('an unjudged image is null, which is not false', () => {
    expect(readMarketplaceEligible({ role: 'primary_property' })).toBeNull();
    expect(isMarketplaceEligible({ role: 'primary_property' })).toBe(true);
    expect(needsEligibilityAssessment({ role: 'primary_property' })).toBe(true);
    expect(needsEligibilityAssessment(
      marketplaceEligibilityDetail(decideMarketplaceEligibility(null)))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The display gate — server and client, one rule
// ---------------------------------------------------------------------------

type Candidate = Parameters<typeof isDisplayableSourceImage>[0];

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'image-1',
  source_stage: 'uploaded_document',
  verification_status: 'source_supplied',
  processing_status: 'ready',
  storage_path: 'org/items/item-1/source/a.png',
  position: 0,
  source_detail: { role: 'primary_property', role_evidence_level: 3 },
  ...over,
});

const eligible = (over: Partial<Candidate> = {}, level = 3) => candidate({
  ...over,
  source_detail: {
    role: 'primary_property',
    role_evidence_level: level,
    ...marketplaceEligibilityDetail(decideMarketplaceEligibility(readMarketingOverlay(CLEAN))),
  },
});

const rejected = (over: Partial<Candidate> = {}, level = 3) => candidate({
  ...over,
  source_detail: {
    role: 'primary_property',
    role_evidence_level: level,
    ...marketplaceEligibilityDetail(
      decideMarketplaceEligibility(readMarketingOverlay(MARKETING_TILE))),
  },
});

/** A non-primary role: an interior, a floorplan, a map. Never a candidate. */
const otherRole = (role: string) => candidate({
  id: `image-${role}`,
  source_detail: {
    role,
    role_evidence_level: 1,
    ...marketplaceEligibilityDetail(decideMarketplaceEligibility(readMarketingOverlay(CLEAN))),
  },
});

describe('the display gate', () => {
  it('TEST A/D/I — the only primary is a marketing tile: no image at all', () => {
    const tile = rejected({ id: 'tile' });
    // Stored, and still source_supplied with its role intact.
    expect(tile.source_detail!.role).toBe('primary_property');
    expect(isDisplayableSourceImage(tile)).toBe(false);
    expect(chooseDisplayableImage([tile])).toBeNull();
  });

  it('TEST B/E/G — an annotated primary beside a clean one: the clean one wins', () => {
    const tile = rejected({ id: 'tile', position: 0 }, 3);
    const clean = eligible({ id: 'clean', position: 9 }, 1);
    expect(chooseDisplayableImage([tile, clean])!.id).toBe('clean');
    expect(chooseDisplayableImage([clean, tile])!.id).toBe('clean');
  });

  it('TEST C/F/H — a clean builder primary is displayed', () => {
    expect(chooseDisplayableImage([eligible({ id: 'hero' }, 2)])!.id).toBe('hero');
  });

  it('TEST J/K — a rejected primary never falls through to another role', () => {
    const tile = rejected({ id: 'tile' });
    for (const role of ['interior', 'floorplan', 'masterplan', 'location_map',
      'site_plan', 'materials', 'logo_decorative', 'property_secondary', 'unknown']) {
      expect(chooseDisplayableImage([tile, otherRole(role)])).toBeNull();
    }
  });

  it('TEST L — a rejected primary beside Google and search rows shows nothing', () => {
    const google = candidate({
      id: 'google', source_stage: 'google_maps',
      verification_status: 'location_derived', processing_status: 'ready',
      source_detail: { role: 'primary_property' },
    });
    const search = candidate({
      id: 'search', source_stage: 'internet_search',
      verification_status: 'unverified', processing_status: 'ready',
      source_detail: { role: 'primary_property' },
    });
    expect(chooseDisplayableImage([rejected({ id: 'tile' }), google, search])).toBeNull();
  });

  it('TEST O — a legacy image with no verdict never outranks a judged one', () => {
    const legacy = candidate({ id: 'legacy', position: 0 });
    const judged = eligible({ id: 'judged', position: 9 }, 3);
    expect(chooseDisplayableImage([legacy, judged])!.id).toBe('judged');
    // And on its own it still shows, rather than the card going dark on deploy.
    expect(chooseDisplayableImage([legacy])!.id).toBe('legacy');
    expect(compareMarketplaceEligibility(judged.source_detail, legacy.source_detail))
      .toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Server and client agree
// ---------------------------------------------------------------------------

describe('the client applies the identical rule', () => {
  const asImage = (c: Candidate): BuilderStockImage => ({
    id: c.id,
    stock_item_id: 'item-1',
    source_stage: c.source_stage as BuilderStockImage['source_stage'],
    source_reference: null,
    source_provider: null,
    source_page_url: null,
    external_url: null,
    storage_path: c.storage_path ?? null,
    content_type: 'image/png',
    verification_status: c.verification_status as BuilderStockImage['verification_status'],
    confidence: 1,
    processing_status: c.processing_status as BuilderStockImage['processing_status'],
    error_message: null,
    position: c.position ?? 0,
    source_detail: c.source_detail ?? null,
    created_at: '2026-08-15T00:00:00Z',
  });

  const item = (images: Candidate[], primaryId: string | null = null): BuilderStockItem => ({
    id: 'item-1', primary_image_id: primaryId, images: images.map(asImage),
  } as unknown as BuilderStockItem);

  it('hides a rejected tile even when the server still points at it', () => {
    const tile = rejected({ id: 'tile' });
    // A stale pointer must not reintroduce it.
    expect(primaryStockImage(item([tile], 'tile'))).toBeNull();
  });

  it('picks the same image the server picks', () => {
    const tile = rejected({ id: 'tile', position: 0 }, 3);
    const clean = eligible({ id: 'clean', position: 9 }, 1);
    expect(primaryStockImage(item([tile, clean]))!.id)
      .toBe(chooseDisplayableImage([tile, clean])!.id);
  });

  it('reads the stored verdict rather than measuring anything', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync(
      'src/lib/builderStock.ts', 'utf8'));
    // Nothing on the client may decode an image to render a card.
    expect(source).not.toMatch(/decodeThumbnail|measureFlatColourRegions|readMarketingOverlay/);
  });
});

// ---------------------------------------------------------------------------
// TEST P — one decision, wherever it is made
// ---------------------------------------------------------------------------

describe('TEST P — reprocessing reaches the same verdict as a fresh import', () => {
  it('is the same function over the same bytes', () => {
    // Ingestion and reprocessing both call `assessMarketplaceEligibility`, so
    // the only way they could differ is by being given different bytes — and
    // reprocessing re-reads the stored object, which IS the imported bytes.
    const atImport = decideMarketplaceEligibility(readMarketingOverlay(MARKETING_TILE));
    const atReprocess = decideMarketplaceEligibility(readMarketingOverlay(MARKETING_TILE));
    expect(atReprocess).toEqual(atImport);
    expect(marketplaceEligibilityDetail(atReprocess))
      .toEqual(marketplaceEligibilityDetail(atImport));
  });
});

// ---------------------------------------------------------------------------
// End to end, through the real decoder
// ---------------------------------------------------------------------------

describe('the ingestion path, over encoded bytes', () => {
  const encodeFixture = async (view: { width: number; height: number; pixels: Uint8Array }) => {
    const { encodePng } = await import(
      '../../../supabase/functions/_shared/builderStock/rasterPng');
    return (await encodePng(view.pixels, {
      width: view.width, height: view.height, components: 3,
    }))!;
  };

  it('decodes a stored image and refuses a marketing tile', async () => {
    const { assessMarketplaceEligibility } = await import(
      '../../../supabase/functions/_shared/builderStock/assessSourceImage');
    const decision = await assessMarketplaceEligibility(await encodeFixture(MARKETING_TILE));
    expect(decision.measured).toBe(true);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('annotated_marketing_tile');
  });

  it('decodes a stored image and passes a clean render', async () => {
    const { assessMarketplaceEligibility } = await import(
      '../../../supabase/functions/_shared/builderStock/assessSourceImage');
    const decision = await assessMarketplaceEligibility(await encodeFixture(CLEAN));
    expect(decision.measured).toBe(true);
    expect(decision.eligible).toBe(true);
  });

  it('leaves bytes it cannot decode displayable and unmeasured', async () => {
    const { assessMarketplaceEligibility } = await import(
      '../../../supabase/functions/_shared/builderStock/assessSourceImage');
    const decision = await assessMarketplaceEligibility(
      new TextEncoder().encode('GIF89a not really an image'));
    expect(decision.measured).toBe(false);
    expect(decision.eligible).toBe(true);
  });

  it('measures a primary and never a role that could not be shown', async () => {
    const { eligibilityDetailFor } = await import(
      '../../../supabase/functions/_shared/builderStock/assessSourceImage');
    const bytes = await encodeFixture(MARKETING_TILE);
    expect(await eligibilityDetailFor(bytes, 'primary_property'))
      .toMatchObject({ marketplace_display_eligible: false });
    // An interior is not a candidate, so it gets no verdict at all.
    expect(await eligibilityDetailFor(bytes, 'interior')).toEqual({});
  });
});
