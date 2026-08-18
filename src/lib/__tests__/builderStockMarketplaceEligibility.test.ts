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
 * TWO THINGS THESE PIN ABOVE ALL.
 *
 *   IT FAILS CLOSED. An image nothing could decode is `pending`, never
 *   `eligible`. "We could not look" and "we looked and it was clean" are
 *   different facts, and a container no decoder here reads must never be a way
 *   for a marketing tile to walk past the rule.
 *
 *   IT IS A PIPELINE RULE, NOT A REPAIR. Every future import of every
 *   supported format asks the same question of the same bytes at the same
 *   point, persists the same answer, and both selectors read it. No property,
 *   filename, word, colour, font or position is named anywhere in the
 *   implementation.
 *
 * The fixtures are drawn rather than sampled, and drawn to the geometry the
 * live tiles actually have: a flat block with straight sides, and lettering
 * set on a common baseline, over a photograph with grain in it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  measureFlatColourRegions, measureOverlayText, readMarketingOverlay,
} from '../../../supabase/functions/_shared/builderStock/marketingOverlay.pure';
import {
  decideMarketplaceEligibility, isMarketplaceEligible, marketplaceEligibilityDetail,
  needsEligibilityAssessment, readEligibilityVersion, readMarketplaceState, unmeasured,
  MARKETPLACE_ELIGIBILITY_VERSION,
} from '../../../supabase/functions/_shared/builderStock/marketplaceEligibility.pure';
import {
  assessMarketplaceEligibility, eligibilityDetailFor,
} from '../../../supabase/functions/_shared/builderStock/assessSourceImage';
import {
  decodeThumbnailResult, DECODABLE_CONTAINERS,
} from '../../../supabase/functions/_shared/builderStock/sourceImageRaster';
import {
  chooseDisplayableImage, isDisplayableSourceImage,
} from '../../../supabase/functions/_shared/builderStock/primaryImage';
import { settleMarketplaceEligibility } from '../../../supabase/functions/_shared/builderStock/settleMarketplaceEligibility';
import { uploadHasWorkOutstanding } from '../../../supabase/functions/_shared/builderStock/settleSourceImages';
import { primaryStockImage } from '../../lib/builderStock';
import {
  annotatedPicture, jpegOf, photograph, withCaption, withPlate, type Picture,
} from './fixtures/builderStockPictures';
import type { BuilderStockImage, BuilderStockItem } from '../../lib/builderStock';

// ---------------------------------------------------------------------------
// Fixtures — pictures, drawn
//
// The picture itself and the treatments laid over it come from
// `fixtures/builderStockPictures`, which the pipeline tests share. The
// arrangements below are this file's own: each one is a shape the classifier
// has to reach a stated verdict on.
// ---------------------------------------------------------------------------

const W = 400;
const H = 200;

const LIME: [number, number, number] = [193, 255, 114];
const CLEAN = photograph();

/** A banner of any colour, with a caption on it. */
const banner = (plate: [number, number, number], ink: [number, number, number]) =>
  withCaption(withPlate(CLEAN, { x: 14, y: 10, w: 230, h: 34 }, plate),
    'SOLERA', { x: 20, y: 16, scale: 3, ink });

const MARKETING_TILE = banner(LIME, [10, 10, 10]);
const BLACK_BANNER = banner([12, 12, 12], [250, 250, 250]);
const WHITE_BANNER = banner([250, 250, 250], [20, 20, 20]);
const GREY_BANNER = banner([128, 128, 130], [250, 250, 250]);
/** A builder's own corner tag: the same colour as a refused pill, a fraction
 *  of the size. */
const SMALL_TAG = withCaption(withPlate(CLEAN, { x: 6, y: 5, w: 60, h: 12 }, LIME),
  'ORAL', { x: 9, y: 7, scale: 1, ink: [10, 10, 10] });
/** An "artist impression" footer: neutral, small, and at the foot. */
const DISCLAIMER = withCaption(withPlate(CLEAN, { x: 250, y: 184, w: 140, h: 12 }, [38, 38, 40]),
  'ARSOLE', { x: 254, y: 186, scale: 1, ink: [235, 235, 235] });
/** Letterboxing: flat, neutral, perfectly straight, and pure framing. */
const LETTERBOXED = withPlate(withPlate(CLEAN, { x: 0, y: 0, w: 26, h: H }, [255, 255, 255]),
  { x: W - 26, y: 0, w: 26, h: H }, [255, 255, 255]);

// ---------------------------------------------------------------------------
// What the measurement reads, and what it refuses to read
// ---------------------------------------------------------------------------

describe('the measurement', () => {
  it('finds a coloured pill laid over the photograph', () => {
    expect(readMarketingOverlay(MARKETING_TILE).annotated).toBe(true);
    expect(measureFlatColourRegions(MARKETING_TILE).regions.length).toBeGreaterThan(0);
  });

  it('TEST T/U/V — a black, white or grey banner is refused too', () => {
    // Colour decides nothing. A neutral banner has to be larger before it
    // counts, because neutral is what ordinary presentation is drawn in, and
    // every one of these clears that.
    for (const view of [BLACK_BANNER, WHITE_BANNER, GREY_BANNER]) {
      expect(readMarketingOverlay(view).annotated).toBe(true);
    }
  });

  it('TEST Y — an artist-impression footer stays', () => {
    expect(readMarketingOverlay(DISCLAIMER).annotated).toBe(false);
  });

  it('TEST Z — a small builder tag or watermark stays', () => {
    // Exactly the colour of the pill that is refused, a fraction of the size.
    expect(readMarketingOverlay(SMALL_TAG).annotated).toBe(false);
  });

  it('a clean render, and letterboxing around one, stay', () => {
    expect(readMarketingOverlay(CLEAN).annotated).toBe(false);
    // Framing is not a badge: a band spanning the picture is excluded by
    // measurement rather than by knowing what letterboxing is.
    expect(readMarketingOverlay(LETTERBOXED).annotated).toBe(false);
  });

  it('reads lettering as shape and never as words', () => {
    const source = readFileSync(
      'supabase/functions/_shared/builderStock/marketingOverlay.pure.ts', 'utf8');
    // Comments describe the live case and quote its wording; the code may not.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    // No string or regular-expression literal of any kind: nothing to compare
    // a word, a hex colour or a font name against.
    expect(code).not.toMatch(/['"`]/);
    expect(code).not.toMatch(/\/[^\s/][^\n]*\/[gimsuy]*/);
  });

  it('the text signal is separate, and silent on a clean photograph', () => {
    // Two independent signals, either of which is enough. On the live source
    // it is the text signal that catches Lot 13 and Lot 1663; on the drawn
    // fixtures here it is the block signal, because drawn type is not
    // photographed type. What matters in both is that a clean photograph
    // trips neither.
    expect(measureOverlayText(CLEAN).lineCount).toBe(0);
    expect(measureOverlayText(CLEAN).heightShare).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Decoding, and failing closed
// ---------------------------------------------------------------------------

describe('what happens when the pixels cannot be read', () => {
  const webp = () => {
    const bytes = new Uint8Array(64);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);          // RIFF
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);          // WEBP
    bytes.set([0x56, 0x50, 0x38, 0x20], 12);         // VP8␣
    return bytes;
  };

  it('TEST Q — a WebP is not decodable here, so it is pending and hidden', async () => {
    const result = await decodeThumbnailResult(webp());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('unsupported');

    const decision = await assessMarketplaceEligibility(webp());
    expect(decision.state).toBe('pending');
    expect(decision.measured).toBe(false);
    expect(decision.reason).toBe('decoder_unsupported');
    expect(isMarketplaceEligible(marketplaceEligibilityDetail(decision))).toBe(false);
  });

  it('TEST R — a progressive JPEG IS decoded, so it is judged rather than waved through', async () => {
    // A real progressive file, from this repository.
    const progressive = readFileSync('public/brand/aurixa-source.jpg');
    const result = await decodeThumbnailResult(new Uint8Array(progressive));
    expect(result.ok).toBe(true);
    const decision = await assessMarketplaceEligibility(new Uint8Array(progressive));
    expect(decision.measured).toBe(true);
    expect(decision.state === 'eligible' || decision.state === 'ineligible').toBe(true);
  });

  it('TEST S — an unsupported container is never eligible', async () => {
    const decision = await assessMarketplaceEligibility(
      new TextEncoder().encode('<html>not an image at all</html>'));
    expect(decision.state).toBe('pending');
    expect(isMarketplaceEligible(marketplaceEligibilityDetail(decision))).toBe(false);
  });

  it('TEST AA — a decoder error leaves the row stored and the card empty', async () => {
    // A PNG signature with a truncated body: the decoder starts and fails.
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const decision = await assessMarketplaceEligibility(broken);
    expect(decision.measured).toBe(false);
    expect(decision.state).toBe('pending');
    // The import is unaffected: this never throws.
    expect(await eligibilityDetailFor(broken, 'primary_property'))
      .toMatchObject({ marketplace_display_eligible: false });
  });

  it('names the containers it can actually read', () => {
    expect(DECODABLE_CONTAINERS).toEqual(['image/png', 'image/jpeg', 'image/gif']);
  });
});

// ---------------------------------------------------------------------------
// The stored decision
// ---------------------------------------------------------------------------

describe('the decision is stored beside the role, never instead of it', () => {
  it('an annotated primary keeps its role and loses its eligibility', () => {
    const decision = decideMarketplaceEligibility(readMarketingOverlay(MARKETING_TILE));
    expect(decision.state).toBe('ineligible');
    expect(decision.reason).toBe('annotated_marketing_tile');

    const detail = { role: 'primary_property', ...marketplaceEligibilityDetail(decision) };
    expect(detail.role).toBe('primary_property');
    expect(detail.marketplace_display_eligible).toBe(false);
    expect(detail.marketplace_eligibility_state).toBe('ineligible');
    expect(detail.marketplace_eligibility_version).toBe(MARKETPLACE_ELIGIBILITY_VERSION);
  });

  it('an unjudged image is pending, which is not eligible', () => {
    expect(readMarketplaceState({ role: 'primary_property' })).toBe('pending');
    expect(isMarketplaceEligible({ role: 'primary_property' })).toBe(false);
    expect(needsEligibilityAssessment({ role: 'primary_property' })).toBe(true);
  });

  it('TEST AD — a version bump brings every old decision back for re-audit', () => {
    const settled = marketplaceEligibilityDetail(
      decideMarketplaceEligibility(readMarketingOverlay(CLEAN)));
    expect(needsEligibilityAssessment(settled)).toBe(false);
    // The same row, judged under an older algorithm, is outstanding again —
    // without re-uploading anything or touching the source bytes.
    const older = { ...settled, marketplace_eligibility_version: MARKETPLACE_ELIGIBILITY_VERSION - 1 };
    expect(readEligibilityVersion(older)).toBe(MARKETPLACE_ELIGIBILITY_VERSION - 1);
    expect(needsEligibilityAssessment(older)).toBe(true);
  });

  it('a pending row is always outstanding, so a better decoder revisits it', () => {
    const pending = marketplaceEligibilityDetail(unmeasured('decoder_unsupported'));
    expect(readEligibilityVersion(pending)).toBe(MARKETPLACE_ELIGIBILITY_VERSION);
    expect(needsEligibilityAssessment(pending)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The display gate
// ---------------------------------------------------------------------------

type Candidate = Parameters<typeof isDisplayableSourceImage>[0];

const withDecision = (view: Picture, over: Partial<Candidate> = {}, level = 3): Candidate => ({
  id: 'image-1',
  source_stage: 'uploaded_document',
  verification_status: 'source_supplied',
  processing_status: 'ready',
  storage_path: 'org/items/item-1/source/a.png',
  position: 0,
  ...over,
  source_detail: {
    role: 'primary_property',
    role_evidence_level: level,
    ...marketplaceEligibilityDetail(decideMarketplaceEligibility(readMarketingOverlay(view))),
  },
});

const eligible = (over: Partial<Candidate> = {}, level = 3) => withDecision(CLEAN, over, level);
const rejected = (over: Partial<Candidate> = {}, level = 3) =>
  withDecision(MARKETING_TILE, over, level);
const unjudged = (over: Partial<Candidate> = {}): Candidate => ({
  ...eligible(over),
  source_detail: { role: 'primary_property', role_evidence_level: 3 },
});
const otherRole = (role: string): Candidate => ({
  ...eligible({ id: `image-${role}` }),
  source_detail: {
    role,
    role_evidence_level: 1,
    ...marketplaceEligibilityDetail(decideMarketplaceEligibility(readMarketingOverlay(CLEAN))),
  },
});

describe('the display gate', () => {
  it('TEST A/D/I — the only primary is a marketing tile: no image at all', () => {
    const tile = rejected({ id: 'tile' });
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

  it('the source evidence still orders two eligible candidates', () => {
    const cover = eligible({ id: 'cover', position: 0 }, 3);
    const field = eligible({ id: 'field', position: 9 }, 1);
    expect(chooseDisplayableImage([cover, field])!.id).toBe('field');
  });

  it('TEST J/K — a rejected primary never falls through to another role', () => {
    const tile = rejected({ id: 'tile' });
    for (const role of ['interior', 'floorplan', 'masterplan', 'location_map',
      'site_plan', 'materials', 'logo_decorative', 'property_secondary', 'unknown']) {
      expect(chooseDisplayableImage([tile, otherRole(role)])).toBeNull();
    }
  });

  it('TEST L — a rejected primary beside Google and search rows shows nothing', () => {
    const google = { ...eligible({ id: 'google' }), source_stage: 'google_maps',
      verification_status: 'location_derived' } as Candidate;
    const search = { ...eligible({ id: 'search' }), source_stage: 'internet_search',
      verification_status: 'unverified' } as Candidate;
    expect(chooseDisplayableImage([rejected({ id: 'tile' }), google, search])).toBeNull();
  });

  it('TEST O — an unjudged legacy image never outranks a judged one, and never shows', () => {
    const legacy = unjudged({ id: 'legacy', position: 0 });
    const judged = eligible({ id: 'judged', position: 9 });
    expect(chooseDisplayableImage([legacy, judged])!.id).toBe('judged');
    // And on its own it shows nothing: unjudged is not clean.
    expect(chooseDisplayableImage([legacy])).toBeNull();
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
    source_reference: null, source_provider: null, source_page_url: null, external_url: null,
    storage_path: c.storage_path ?? null,
    content_type: 'image/png',
    verification_status: c.verification_status as BuilderStockImage['verification_status'],
    confidence: 1,
    processing_status: c.processing_status as BuilderStockImage['processing_status'],
    error_message: null,
    position: c.position ?? 0,
    source_detail: c.source_detail ?? null,
    created_at: '2026-08-18T00:00:00Z',
  });
  const item = (images: Candidate[], primaryId: string | null = null): BuilderStockItem => ({
    id: 'item-1', primary_image_id: primaryId, images: images.map(asImage),
  } as unknown as BuilderStockItem);

  it('hides a rejected tile even when the server still points at it', () => {
    expect(primaryStockImage(item([rejected({ id: 'tile' })], 'tile'))).toBeNull();
  });

  it('hides an unjudged image even when the server still points at it', () => {
    expect(primaryStockImage(item([unjudged({ id: 'legacy' })], 'legacy'))).toBeNull();
  });

  it('picks the same image the server picks', () => {
    const tile = rejected({ id: 'tile', position: 0 }, 3);
    const clean = eligible({ id: 'clean', position: 9 }, 1);
    expect(primaryStockImage(item([tile, clean]))!.id)
      .toBe(chooseDisplayableImage([tile, clean])!.id);
  });

  it('reads the stored verdict rather than measuring anything', () => {
    const source = readFileSync('src/lib/builderStock.ts', 'utf8');
    expect(source).not.toMatch(
      /decodeThumbnail|measureFlatColourRegions|measureOverlayText|readMarketingOverlay/);
  });
});

// ---------------------------------------------------------------------------
// Settlement of what is already stored
// ---------------------------------------------------------------------------

/** A database with enough of PostgREST's shape to run a keyset scan. */
function fakeDb(rows: Array<Record<string, any>>, objects: Record<string, Uint8Array>) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const build = () => {
    const filters: Array<[string, string, unknown]> = [];
    let limit = 1000;
    const builder: any = {
      eq(column: string, value: unknown) { filters.push(['eq', column, value]); return builder; },
      gt(column: string, value: unknown) { filters.push(['gt', column, value]); return builder; },
      order() { return builder; },
      limit(value: number) { limit = value; return builder; },
      then(resolve: (v: { data: any[]; error: null }) => unknown, reject?: unknown) {
        const matched = rows
          .filter((row) => filters.every(([op, column, value]) =>
            op === 'eq' ? row[column] === value : String(row[column]) > String(value)))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
          .slice(0, limit);
        return Promise.resolve({ data: matched, error: null }).then(resolve, reject as never);
      },
    };
    return builder;
  };
  return {
    updates,
    from() {
      return {
        select: () => build(),
        update(patch: Record<string, unknown>) {
          const filters: Array<[string, unknown]> = [];
          const builder: any = {
            eq(column: string, value: unknown) { filters.push([column, value]); return builder; },
            then(resolve: (v: unknown) => unknown, reject?: unknown) {
              for (const row of rows) {
                if (filters.every(([column, value]) => row[column] === value)) {
                  Object.assign(row, patch);
                  updates.push({ id: row.id, patch });
                }
              }
              return Promise.resolve({ data: null, error: null }).then(resolve, reject as never);
            },
          };
          return builder;
        },
      };
    },
    storage: {
      from() {
        return {
          download(path: string) {
            const bytes = objects[path];
            if (!bytes) return Promise.resolve({ data: null, error: { message: 'missing' } });
            return Promise.resolve({
              data: { arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)) },
              error: null,
            });
          },
        };
      },
    },
  };
}

describe('TEST AB — settlement reaches every outstanding row', () => {
  it('walks past thousands of settled rows to the one that is not', async () => {
    const { encodePng } = await import(
      '../../../supabase/functions/_shared/builderStock/rasterPng');
    const tile = (await encodePng(MARKETING_TILE.pixels,
      { width: W, height: H, components: 3 }))!;

    // Measured once: judging a clean picture 5,200 times is a test that
    // measures the test.
    const settledDetail = marketplaceEligibilityDetail(
      decideMarketplaceEligibility(readMarketingOverlay(CLEAN)));

    const rows: Array<Record<string, any>> = [];
    // 5,200 rows already judged, so an in-memory filter over the first page
    // would see nothing to do and stop for ever.
    for (let i = 0; i < 5_200; i++) {
      rows.push({
        id: `image-${String(i).padStart(6, '0')}`,
        organisation_id: 'org-a',
        source_stage: 'uploaded_document',
        verification_status: 'source_supplied',
        processing_status: 'ready',
        storage_bucket: 'builder-stock-images',
        storage_path: null,
        source_detail: { role: 'primary_property', ...settledDetail },
      });
    }
    // And one, last by id, that has never been judged.
    rows.push({
      id: 'image-999999',
      organisation_id: 'org-a',
      source_stage: 'uploaded_document',
      verification_status: 'source_supplied',
      processing_status: 'ready',
      storage_bucket: 'builder-stock-images',
      storage_path: 'org-a/items/item-z/source/tile.png',
      source_detail: { role: 'primary_property' },
    });

    const db = fakeDb(rows, { 'org-a/items/item-z/source/tile.png': tile });
    const outcome = await settleMarketplaceEligibility(db as any, 'org-a');

    expect(outcome.scanned).toBe(5_201);
    expect(outcome.outstanding).toBe(1);
    expect(outcome.assessed).toBe(1);
    expect(outcome.rejected).toBe(1);
    expect(rows[rows.length - 1].source_detail.marketplace_display_eligible).toBe(false);
  });
});

describe('TEST AC — the autonomous settler picks up eligibility work on its own', () => {
  it('treats an upload at the current provenance version as outstanding', () => {
    // Exactly the state every existing upload is in the moment this ships:
    // its imagery has been settled, and its display eligibility has not.
    expect(uploadHasWorkOutstanding({
      source_images_settled_version: 4,
      marketplace_eligibility_settled_version: null,
    })).toBe(true);
  });

  it('stops only when both markers are current', () => {
    expect(uploadHasWorkOutstanding({
      source_images_settled_version: 4,
      marketplace_eligibility_settled_version: MARKETPLACE_ELIGIBILITY_VERSION,
    })).toBe(false);
    expect(uploadHasWorkOutstanding({
      source_images_settled_version: null,
      marketplace_eligibility_settled_version: MARKETPLACE_ELIGIBILITY_VERSION,
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST P — one decision, wherever it is made
// ---------------------------------------------------------------------------

describe('TEST P — reprocessing reaches the same verdict as a fresh import', () => {
  it('is the same function over the same bytes', async () => {
    const { encodePng } = await import(
      '../../../supabase/functions/_shared/builderStock/rasterPng');
    const bytes = (await encodePng(MARKETING_TILE.pixels,
      { width: W, height: H, components: 3 }))!;
    const atImport = await assessMarketplaceEligibility(bytes);
    const atReprocess = await assessMarketplaceEligibility(bytes);
    expect(atReprocess).toEqual(atImport);
    expect(atImport.state).toBe('ineligible');
  });

  it('measures a primary and never a role that could not be shown', async () => {
    const { encodePng } = await import(
      '../../../supabase/functions/_shared/builderStock/rasterPng');
    const bytes = (await encodePng(MARKETING_TILE.pixels,
      { width: W, height: H, components: 3 }))!;
    expect(await eligibilityDetailFor(bytes, 'primary_property'))
      .toMatchObject({ marketplace_display_eligible: false });
    expect(await eligibilityDetailFor(bytes, 'interior')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// TEST W/X — the treatments that are not a coloured rectangle
// ---------------------------------------------------------------------------

/**
 * These go through the WHOLE path — a picture at source resolution, encoded,
 * decoded and downscaled — rather than measuring a hand-drawn 400px view.
 *
 * That is not ceremony. Type behaves differently at the two scales: a stroke
 * drawn five pixels wide at thumbnail size has hard edges, and the local
 * window sits inside it and reads no contrast, so only the stroke's outline
 * registers. A stroke drawn at source resolution and then downscaled is soft
 * and solid, which is what production actually measures. A fixture authored
 * at thumbnail size would have understated the detector and been "fixed" by
 * loosening a threshold that did not need loosening.
 */
const SOURCE_W = 960;
const SOURCE_H = 497;

const SOURCE = photograph(SOURCE_W, SOURCE_H);

/** TEST W: a scrim across the foot of the picture, with type on it. */
const SEMI_TRANSPARENT_BANNER = withCaption(
  withPlate(SOURCE, {
    x: 0, y: Math.round(SOURCE_H * 0.72), w: SOURCE_W, h: Math.round(SOURCE_H * 0.16),
  }, [10, 10, 14], 0.6),
  'SOLERA',
  { x: Math.round(SOURCE_W * 0.05), y: Math.round(SOURCE_H * 0.745), scale: 8, ink: [250, 250, 250] },
);

/** TEST X: a word set straight onto the photograph. No plate of any kind. */
const BARE_TYPOGRAPHY = withCaption(SOURCE, 'SOLERA', {
  x: Math.round(SOURCE_W * 0.08), y: Math.round(SOURCE_H * 0.12), scale: 11, ink: [12, 12, 14],
});

/** The same word, pale, over the pale part of the sky. See the test below. */
const PALE_ON_PALE = withCaption(SOURCE, 'SOLERA', {
  x: Math.round(SOURCE_W * 0.08), y: Math.round(SOURCE_H * 0.12), scale: 11, ink: [255, 255, 255],
});

describe('TEST W/X — treatments with no flat coloured rectangle to find', () => {
  it('TEST W — a semi-transparent banner is refused', async () => {
    // Nothing here is a flat colour: the photograph's own grain shows through
    // the scrim, so the block signal finds no region at all. It is refused on
    // the typography alone, which is the point of having two signals.
    const verdict = await assessMarketplaceEligibility(jpegOf(SEMI_TRANSPARENT_BANNER));
    expect(verdict.state).toBe('ineligible');
    expect(verdict.reason).toBe('annotated_marketing_tile');
    expect(verdict.overlay!.regionCount).toBe(0);
    expect(verdict.overlay!.textLineCount).toBeGreaterThan(0);
  });

  it('TEST X — large typography straight over the photograph is refused', async () => {
    const verdict = await assessMarketplaceEligibility(jpegOf(BARE_TYPOGRAPHY));
    expect(verdict.state).toBe('ineligible');
    expect(verdict.reason).toBe('annotated_marketing_tile');
    expect(verdict.overlay!.regionCount).toBe(0);
    expect(verdict.overlay!.textLineCount).toBeGreaterThan(0);
    expect(verdict.overlay!.textHeightShare).toBeGreaterThan(0.1);
  });

  it('and the clean picture under both of them is not', async () => {
    expect((await assessMarketplaceEligibility(jpegOf(SOURCE))).state).toBe('eligible');
  });

  /**
   * A LIMIT OF THIS CLASSIFIER, RECORDED RATHER THAN HIDDEN.
   *
   * The typography signal starts from local contrast, and near-white type over
   * the bright part of a sky has very little of it — after the encode and the
   * downscale, less than the floor. So this one case passes as clean, and this
   * test says so out loud instead of leaving a gap nobody knows about.
   *
   * It is written as an assertion of the CURRENT behaviour on purpose: when a
   * later version of the classifier catches it, this test fails, and whoever
   * bumps `MARKETPLACE_ELIGIBILITY_VERSION` is told exactly what changed. It
   * is not a claim that the behaviour is right.
   */
  it('does NOT yet catch pale type over the pale part of a sky', async () => {
    const verdict = await assessMarketplaceEligibility(jpegOf(PALE_ON_PALE));
    expect(verdict.state).toBe('eligible');
    expect(verdict.overlay!.textLineCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST M/N — what the decision may and may not lead to
// ---------------------------------------------------------------------------

describe('TEST M — the server and the client reach the same answer', () => {
  const asImage = (c: Candidate): BuilderStockImage => ({
    id: c.id, stock_item_id: 'item-1',
    source_stage: c.source_stage as BuilderStockImage['source_stage'],
    source_reference: null, source_provider: null, source_page_url: null, external_url: null,
    storage_path: c.storage_path ?? null, content_type: 'image/png',
    verification_status: c.verification_status as BuilderStockImage['verification_status'],
    confidence: 1,
    processing_status: c.processing_status as BuilderStockImage['processing_status'],
    error_message: null, position: c.position ?? 0, source_detail: c.source_detail ?? null,
    created_at: '2026-08-18T00:00:00Z',
  });
  const item = (images: Candidate[]): BuilderStockItem => ({
    id: 'item-1', primary_image_id: null, images: images.map(asImage),
  } as unknown as BuilderStockItem);

  it('over every combination of the three states', () => {
    const states = [
      eligible({ id: 'a', position: 0 }, 3),
      rejected({ id: 'b', position: 1 }, 1),
      unjudged({ id: 'c', position: 2 }),
      otherRole('interior'),
    ];
    // Every subset, so agreement is a property rather than three examples.
    for (let mask = 0; mask < 1 << states.length; mask++) {
      const subset = states.filter((_, index) => mask & (1 << index));
      const server = chooseDisplayableImage(subset)?.id ?? null;
      const client = primaryStockImage(item(subset))?.id ?? null;
      expect(client).toBe(server);
    }
  });
});

describe('TEST N — a refusal is a refusal, not a request for a substitute', () => {
  it('offers nothing in place of a refused or unjudged primary', () => {
    // Everything a fallback could reach, present at once: another role of the
    // same property's own builder imagery, a location-derived row, and a
    // search result. The answer is still nothing.
    const everything = [
      rejected({ id: 'tile' }, 3),
      unjudged({ id: 'legacy' }),
      otherRole('interior'),
      otherRole('floorplan'),
      otherRole('masterplan'),
      {
        id: 'google-1', source_stage: 'google_maps', verification_status: 'location_derived',
        processing_status: 'ready', position: 0, storage_path: 'g.jpg', source_detail: null,
      } as Candidate,
      {
        id: 'search-1', source_stage: 'internet_search', verification_status: 'unverified',
        processing_status: 'ready', position: 0, storage_path: 's.jpg', source_detail: null,
      } as Candidate,
    ];
    expect(chooseDisplayableImage(everything)).toBeNull();
  });

  it('and the refusal never rewrites the picture or its role', async () => {
    const bytes = jpegOf(annotatedPicture(SOURCE_W, SOURCE_H));
    const before = Uint8Array.from(bytes);
    const detail = await eligibilityDetailFor(bytes, 'primary_property');
    // The bytes handed in are the bytes still held: nothing crops, erases,
    // blurs or repaints anything, here or anywhere this is called from.
    expect(Array.from(bytes)).toEqual(Array.from(before));
    // And the verdict is stored BESIDE the role. It contributes no role key,
    // so merging it can never restate what the source said.
    expect(detail).toMatchObject({ marketplace_display_eligible: false });
    expect(Object.keys(detail).some((key) => key.startsWith('role'))).toBe(false);
  });
});
