/**
 * What the pixels say about an image: is it a floor plan, how big is it, and
 * which picture is it?
 *
 * All three answers come out of one decode. The canvas draw was already
 * happening for the plan classifier, so the perceptual signature and the
 * natural dimensions are free — and both are load-bearing for the gallery:
 *
 * - the **signature** is the last de-duplication layer, the only one that
 *   catches a re-encode sharing neither bytes nor URL structure with the copy
 *   beside it (`listingImageSelection.pure.ts`);
 * - the **dimensions** are how an agent's headshot is told from a room. Nothing
 *   else on a stored row can say it: `width`/`height` are null on every one of
 *   the 4,807 rows in production, because the harvester only fills them from an
 *   Airtable attachment and these arrive as scraped URLs.
 *
 * Telling a floor plan from a photograph by looking at it.
 *
 * The URL heuristic in `listingImageOrder.pure` catches assets that are named
 * honestly. Most of this corpus is not: the harvested CDN paths are content
 * hashes (`phimg.reapit.website/<sha1>`), so nothing in the URL says what the
 * bytes are. But the bytes themselves are unambiguous — a floor plan is a line
 * drawing on a white ground with flat fills, and a photograph of a property is
 * almost never mostly white with almost no colour.
 *
 * So: draw the image small on a canvas and measure two fractions —
 * near-white pixels and genuinely colourful pixels. The decision rule is
 * deliberately biased: misreading a plan as a photo leaves it in the front of
 * the carousel (yesterday's behaviour), misreading a photo as a plan buries it
 * at the back. The second mistake is worse, so the thresholds demand strong
 * evidence before calling something a plan.
 *
 * Results are cached by URL-without-query — signed URLs rotate hourly, the
 * bytes behind them do not.
 */

export type ImageKind = 'photo' | 'floorplan' | 'unknown';

export interface ImagePixelStats {
  /** Fraction of sampled pixels that are near-white (paper ground). */
  whiteFraction: number;
  /** Fraction of sampled pixels with real chroma (sky, brick, lawn, water). */
  colorfulFraction: number;
}

/**
 * The decision, pure so it can be tested against synthetic distributions.
 *
 * A plan drawn on white with beige/green fills sits around 0.45–0.8 white and
 * modest colour; photographs of properties rarely exceed ~0.35 white — even a
 * white render against an overcast sky carries colour from ground and
 * landscaping. The overlap zone deliberately resolves to 'photo'.
 */
export function decideImageKind(stats: ImagePixelStats): Exclude<ImageKind, 'unknown'> {
  if (stats.whiteFraction >= 0.62) return 'floorplan';
  if (stats.whiteFraction >= 0.45 && stats.colorfulFraction <= 0.3) return 'floorplan';
  return 'photo';
}

/** Sampled statistics from decoded pixels. Exported for the canvas path only. */
export function statsFromPixels(data: Uint8ClampedArray): ImagePixelStats {
  let white = 0;
  let colorful = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r >= 232 && g >= 232 && b >= 232) {
      white += 1;
      continue;
    }
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Saturation on bright-enough pixels; dark line-work counts as neither.
    if (max > 60 && max - min > 0.28 * max) colorful += 1;
  }
  return { whiteFraction: white / pixels, colorfulFraction: colorful / pixels };
}

/**
 * A 64-bit difference hash of the decoded image, as 16 hex characters.
 *
 * Row-wise brightness comparisons on an 8×9 grid: bit `i` is "this cell is
 * brighter than the one to its right". That makes it indifferent to scale, to
 * JPEG quality and to a mild exposure shift — which is exactly the set of
 * differences between two copies of one photograph — while two different rooms
 * disagree on roughly half the bits.
 *
 * Sampled from the same 48×48 draw the plan classifier uses, so it costs a
 * handful of array reads and no extra network or decode.
 */
export function signatureFromPixels(data: Uint8ClampedArray, sampleSize: number): string {
  const cell = sampleSize / 8;
  const luma = (col: number, row: number): number => {
    // Centre of the cell, clamped inside the sampled square.
    const x = Math.min(sampleSize - 1, Math.floor((col + 0.5) * (cell * 8) / 9));
    const y = Math.min(sampleSize - 1, Math.floor((row + 0.5) * cell));
    const at = (y * sampleSize + x) * 4;
    return 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2];
  };

  let hex = '';
  for (let row = 0; row < 8; row += 1) {
    let nibble = 0;
    for (let col = 0; col < 8; col += 1) {
      nibble = (nibble << 1) | (luma(col, row) > luma(col + 1, row) ? 1 : 0);
      if (col % 4 === 3) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}

/** Everything one decode can tell us. */
export interface ImageInspection {
  kind: ImageKind;
  /** 16 hex characters, or null when the pixels could not be read. */
  signature: string | null;
  /** Natural pixel dimensions, or null. */
  width: number | null;
  height: number | null;
}

const UNREADABLE: ImageInspection = { kind: 'unknown', signature: null, width: null, height: null };

const SAMPLE_SIZE = 48;
const LOAD_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT = 3;

const cache = new Map<string, ImageInspection>();
let inFlight = 0;
const waiters: Array<() => void> = [];

function cacheKey(url: string): string {
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  waiters.shift()?.();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
    // Without this the canvas taints and getImageData throws. Our bucket and
    // the harvested CDNs serve permissive CORS; anything that does not simply
    // stays 'unknown'.
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('load_failed'));
    };
    img.src = url;
  });
}

/**
 * Read one image URL. Never throws; anything that cannot be decoded and
 * measured comes back as `UNREADABLE`, whose `kind` is 'unknown' (which
 * downstream treats as a photograph) and whose signature is null (which never
 * merges anything).
 */
export async function inspectImageUrl(url: string): Promise<ImageInspection> {
  const key = cacheKey(url);
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return UNREADABLE;

  await acquireSlot();
  try {
    // Another caller may have answered while this one queued.
    const answered = cache.get(key);
    if (answered) return answered;

    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return UNREADABLE;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const pixels = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    const inspection: ImageInspection = {
      kind: decideImageKind(statsFromPixels(pixels)),
      signature: signatureFromPixels(pixels, SAMPLE_SIZE),
      width: img.naturalWidth || null,
      height: img.naturalHeight || null,
    };
    cache.set(key, inspection);
    return inspection;
  } catch {
    // Tainted canvas, network failure, decode failure — no verdict, and no
    // caching of the non-verdict: a transient failure should not condemn the
    // URL to permanent ignorance within the session.
    return UNREADABLE;
  } finally {
    releaseSlot();
  }
}

/** Just the plan/photo verdict, for callers that want nothing else. */
export async function classifyImageUrl(url: string): Promise<ImageKind> {
  return (await inspectImageUrl(url)).kind;
}

/** Test seam. */
export function clearImageKindCache(): void {
  cache.clear();
}

/** Test seam: lets tests preload verdicts without canvas machinery. */
export function primeImageKind(url: string, kind: ImageKind, extra: Partial<ImageInspection> = {}): void {
  cache.set(cacheKey(url), { ...UNREADABLE, ...extra, kind });
}
