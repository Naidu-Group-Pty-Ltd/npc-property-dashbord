/**
 * Builder stock — taking the marketing sticker off, and refusing to when the
 * result would be a guess.
 *
 * These run the real detector and the real reconstruction over generated
 * pictures whose ground truth is known, so an assertion about "the badge is
 * gone" is an assertion about pixels rather than about a flag.
 */
import { describe, expect, it } from 'vitest';

import {
  measureFlatColourRegions,
} from '../../../supabase/functions/_shared/builderStock/marketingOverlay.pure';
import {
  sanitizeOverlay,
} from '../../../supabase/functions/_shared/builderStock/sanitizeOverlay.pure';
import {
  SANITIZATION_VERSION,
} from '../../../supabase/functions/_shared/builderStock/sanitizedDerivative.pure';

/**
 * A sky-like gradient with grain: the ground a badge is normally stuck onto.
 *
 * The grain is not decoration. A mathematically perfect gradient is smoother
 * than any photograph, and the detector's flood — which admits neighbours close
 * to the SEED — walks straight through it and claims the whole sky as one flat
 * region. Real sensor and render noise is what stops that, so the fixture has
 * to have some, deterministically.
 */
function sky(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      const t = y / height;
      const grain = ((x * 29 + y * 71) % 13) - 6;
      pixels[at] = Math.max(0, Math.min(255, Math.round(120 + 90 * t + grain)));
      pixels[at + 1] = Math.max(0, Math.min(255, Math.round(160 + 70 * t + grain)));
      pixels[at + 2] = Math.max(0, Math.min(255, Math.round(210 + 40 * t + grain)));
    }
  }
  return pixels;
}

/** Busy foliage-like ground, where a reconstruction would be inventing. */
function foliage(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      // Deterministic, high-frequency, and nothing like a gradient.
      const n = ((x * 37 + y * 61) % 97) + ((x * 13 + y * 7) % 53);
      pixels[at] = 40 + (n % 90);
      pixels[at + 1] = 70 + (n % 120);
      pixels[at + 2] = 30 + (n % 60);
    }
  }
  return pixels;
}

/** Stamp a flat coloured badge, the shape a detector calls a laid-over graphic. */
function stamp(
  pixels: Uint8Array, width: number,
  box: { x: number; y: number; w: number; h: number }, colour: [number, number, number],
): void {
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const at = (y * width + x) * 3;
      pixels[at] = colour[0];
      pixels[at + 1] = colour[1];
      pixels[at + 2] = colour[2];
    }
  }
}

const W = 400;
const H = 200;

const run = (pixels: Uint8Array) => {
  const overlay = measureFlatColourRegions({ width: W, height: H, pixels });
  return {
    overlay,
    // Same size for mask and picture here: the scaling is exercised separately.
    result: sanitizeOverlay({
      width: W, height: H, pixels, overlay, maskWidth: W, maskHeight: H,
    }),
  };
};

describe('removing a marketing badge from the builder\'s own photograph', () => {
  it('leaves a clean picture completely alone', () => {
    const clean = sky(W, H);
    const { overlay, result } = run(clean);

    expect(overlay.regions).toHaveLength(0);
    // Not "cleaned to the same thing" — never touched at all.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('nothing_to_remove');
  });

  it('removes a badge from open sky and leaves the rest byte-identical', () => {
    const original = sky(W, H);
    const badged = new Uint8Array(original);
    const box = { x: 20, y: 14, w: 96, h: 30 };
    stamp(badged, W, box, [180, 240, 60]);

    const { overlay, result } = run(badged);
    expect(overlay.regions.length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The badge is gone: no pixel in its box is still the badge colour.
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const at = (y * W + x) * 3;
        const isBadge = result.pixels[at] === 180
          && result.pixels[at + 1] === 240 && result.pixels[at + 2] === 60;
        expect(isBadge).toBe(false);
      }
    }

    /*
     * And the photograph outside the repair is the builder's, to the byte.
     * This is the promise that makes the derivative honest: it is their picture
     * with a sticker taken off, not a picture of ours that resembles theirs.
     */
    const margin = 40;
    let compared = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const farFromBadge = x < box.x - margin || x > box.x + box.w + margin
          || y < box.y - margin || y > box.y + box.h + margin;
        if (!farFromBadge) continue;
        const at = (y * W + x) * 3;
        expect(result.pixels[at]).toBe(original[at]);
        expect(result.pixels[at + 1]).toBe(original[at + 1]);
        expect(result.pixels[at + 2]).toBe(original[at + 2]);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('reconstructs the sky it covered rather than filling it flat', () => {
    const original = sky(W, H);
    const badged = new Uint8Array(original);
    stamp(badged, W, { x: 20, y: 14, w: 96, h: 30 }, [180, 240, 60]);

    const { result } = run(badged);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The gradient continues through the patch: the top of the repaired area is
    // measurably darker than the bottom, as the sky above and below it are.
    const sample = (x: number, y: number) => result.pixels[(y * W + x) * 3];
    expect(sample(60, 40)).toBeGreaterThan(sample(60, 18));
  });

  it('REFUSES a badge sitting on detail, rather than smearing it', () => {
    const busy = foliage(W, H);
    stamp(busy, W, { x: 40, y: 40, w: 70, h: 26 }, [180, 240, 60]);

    const { result } = run(busy);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('background_too_detailed');
  });

  it('REFUSES when too much of the picture would have to be rebuilt', () => {
    const original = sky(W, H);
    const badged = new Uint8Array(original);
    // Three big plates, the Lot 13 shape: quiet surroundings, far too much area.
    stamp(badged, W, { x: 10, y: 10, w: 150, h: 40 }, [180, 240, 60]);
    stamp(badged, W, { x: 200, y: 10, w: 150, h: 40 }, [180, 240, 60]);
    stamp(badged, W, { x: 100, y: 120, w: 180, h: 40 }, [180, 240, 60]);

    const { result } = run(badged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too_much_to_rebuild');
  });

  it('is deterministic — the same picture always cleans to the same bytes', () => {
    const make = () => {
      const p = sky(W, H);
      stamp(p, W, { x: 20, y: 14, w: 96, h: 30 }, [180, 240, 60]);
      return p;
    };
    const a = run(make()).result;
    const b = run(make()).result;
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });

  it('carries a version, so a better reconstruction can re-make what it stored', () => {
    expect(SANITIZATION_VERSION).toBeGreaterThanOrEqual(1);
  });
});
