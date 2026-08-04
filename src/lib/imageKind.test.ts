import { describe, expect, it } from 'vitest';
import { decideImageKind, statsFromPixels } from './imageKind';

/** Build an RGBA buffer from a list of [r,g,b] pixels. */
function pixels(...colors: Array<[number, number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return data;
}

const repeat = (color: [number, number, number], n: number): Array<[number, number, number]> =>
  Array.from({ length: n }, () => color);

describe('statsFromPixels', () => {
  it('measures white ground and real chroma separately', () => {
    const stats = statsFromPixels(
      pixels(
        ...repeat([250, 250, 250], 6), // paper
        ...repeat([40, 40, 40], 2), // line-work — neither white nor colourful
        ...repeat([80, 160, 60], 2), // lawn fill
      ),
    );
    expect(stats.whiteFraction).toBeCloseTo(0.6);
    expect(stats.colorfulFraction).toBeCloseTo(0.2);
  });
});

describe('decideImageKind', () => {
  it('calls a line drawing on white a floor plan', () => {
    // The classic plan: mostly paper, dark line-work, no colour to speak of.
    expect(decideImageKind({ whiteFraction: 0.7, colorfulFraction: 0.05 })).toBe('floorplan');
  });

  it('calls a plan with coloured fills a floor plan when the ground still dominates', () => {
    // Beige rooms and green garden beds — the style in this corpus — still sit
    // on an overwhelmingly white sheet.
    expect(decideImageKind({ whiteFraction: 0.65, colorfulFraction: 0.3 })).toBe('floorplan');
  });

  it('calls an ordinary property photograph a photo', () => {
    expect(decideImageKind({ whiteFraction: 0.08, colorfulFraction: 0.7 })).toBe('photo');
  });

  it('gives a bright, colourful exterior shot the benefit of the doubt', () => {
    // A white render against an overcast sky: plenty of near-white, but the
    // landscaping and paving keep it colourful. Demoting it would bury the
    // best photo of the listing — the worse mistake.
    expect(decideImageKind({ whiteFraction: 0.5, colorfulFraction: 0.4 })).toBe('photo');
  });

  it('treats a moderately white but colour-dead image as a plan', () => {
    expect(decideImageKind({ whiteFraction: 0.48, colorfulFraction: 0.2 })).toBe('floorplan');
  });
});
