/**
 * Builder stock — telling a property photograph from a marketing tile.
 *
 * THE CASE THIS EXISTS FOR. A builder publishes their listing image as a
 * 1200×600 tile with the property's own facade under a status ribbon: green
 * pills reading "Completed" and "SMSF", a red one reading "$25,000 Rebate",
 * suburb and state banners. Those bytes are genuinely the builder's, they are
 * genuinely of that property, and the source genuinely designates them as its
 * listing image — every provenance question answers yes — and the picture is
 * still not one to put in front of a client being asked to buy a house.
 *
 * SO THIS ANSWERS A DIFFERENT QUESTION FROM EVERY OTHER MODULE HERE. Not
 * "whose house is it" and not "did the builder supply it" — those are settled
 * structurally, before anything gets here, and nothing in this file may ever
 * be used to settle them. Only: does this image carry a promotional graphic
 * laid OVER the photograph.
 *
 * WHAT IT MEASURES, AND WHY THAT GENERALISES. Not words, not colours, not
 * positions, not fonts — a builder's next campaign will use different ones of
 * all four. What every such tile has in common is a graphic laid over a
 * photograph, and a graphic is flat in a way nothing photographed or rendered
 * is: a pill is ONE colour, edge to edge, to within compression noise. A sky
 * has a gradient, a lawn has texture, a wall has shading. So the measure is
 *
 *     the largest connected region of a single COLOURED colour,
 *     as a share of the picture
 *
 * where "single" means every pixel within a tight tolerance of the region's
 * own seed — which is what stops a smooth gradient from creeping across the
 * sky and reading as one flat region.
 *
 * WHY "COLOURED" IS PART OF IT. Letterboxing, a white margin, a black
 * disclaimer bar and a drop shadow are all large flat regions, and all of them
 * are ordinary presentation. Requiring real chroma excludes every one of them
 * without naming any.
 *
 * WHAT STAYS DISPLAYABLE, measured on the live source: a builder's own small
 * corner tag, an "ARTIST IMPRESSION. INDICATIVE ONLY." footer, a logo, a
 * watermark, a design name. They are small, or neutral, or both.
 *
 * Pure: no imports, no IO, no clock.
 */

/** An RGB thumbnail. Produced by `sourceImageRaster.ts`. */
export interface RasterView {
  width: number;
  height: number;
  /** RGB triples, row-major. */
  pixels: Uint8Array;
}

/**
 * How far a pixel may sit from its region's seed and still belong to it.
 *
 * Sum of the three channel differences, so ~4 levels per channel. Wide enough
 * to hold a flat fill through JPEG ringing and an eighth-scale DC reading,
 * tight enough that a sky gradient fragments into bands instead of flooding.
 */
const SEED_TOLERANCE = 14;

/**
 * How far apart two pixels of the same flat colour may be and still count as
 * one region.
 *
 * A pill has WORDS on it, and the words cut the fill into pieces — badly so on
 * a JPEG, where the picture is read one sample per 8×8 block and a block
 * holding a letter averages to something else entirely. Bridging a two-pixel
 * gap puts the pill back together without joining anything a gap of two
 * pixels does not already join. Without it the live Lot 13 tile measured as
 * having no graphic on it at all: its two pills had been shredded by their own
 * captions.
 */
const BRIDGE_GAP = 2;

/**
 * How colourful a region must be to count as a graphic rather than as
 * presentation. Chroma over the channel maximum, so it is exposure-independent.
 */
const MIN_CHROMA = 0.28;

/**
 * Below this a region is a tag, a logo or a badge, and stays.
 *
 * Fitted, not chosen. Across the live source the smallest thing that is
 * unmistakably a status ribbon measures 1.25% of its picture, and the largest
 * thing that is unmistakably a builder's own corner tag measures 0.51%. The
 * floor sits between them with room on both sides.
 */
const MIN_REGION_SHARE = 0.01;

/**
 * How straight the region's own left and right edges are, as the average
 * deviation of its per-row extents over its width.
 *
 * THIS IS THE MEASURE THAT ACTUALLY SEPARATES THEM, and size is not. A clear
 * sky in a render is flat, saturated and larger than any pill — 2.06% against
 * the 1.25% of the smallest real ribbon — so a size threshold alone either
 * misses ribbons or refuses skies. What a sky does not have is straight sides:
 * it is cut off by a roofline, a tree, a fence. A pill, a ribbon and a banner
 * are rectangles.
 *
 * Measured across the live source: every promotional block scores 0.015–0.031,
 * every sky, lawn and canopy scores 0.171–0.258. The threshold sits in a gap
 * five times wider than either group's spread.
 */
const MAX_EDGE_SPREAD = 0.08;

/**
 * How much of its bounding box's WIDTH the region occupies on the rows it
 * occupies at all — the second half of the same geometric argument.
 */
const MIN_ROW_FILL = 0.5;

/** A region this large is the picture itself, not something laid over it. */
const MAX_REGION_SHARE = 0.55;

export interface OverlayRegion {
  /** Share of the picture the region covers. */
  share: number;
  /** Mean row occupancy across the rows it touches. */
  rowFill: number;
  /** Straightness of its sides. Low is rectangular. */
  edgeSpread: number;
  /** Chroma over the channel maximum, 0 for any grey. */
  chroma: number;
  colour: [number, number, number];
}

export interface OverlayMeasurement {
  /** Every region that qualifies as a laid-over graphic, largest first. */
  regions: OverlayRegion[];
  /** Their combined share of the picture. */
  totalShare: number;
  /** The largest single one, which is what the threshold is applied to. */
  largestShare: number;
}

/**
 * Measure the flat coloured graphics laid over a picture.
 *
 * Deterministic: the same pixels always produce the same regions, in the same
 * order, on any runtime.
 */
export function measureFlatColourRegions(view: RasterView): OverlayMeasurement {
  const { width, height, pixels } = view;
  const count = width * height;
  if (count <= 0 || pixels.length < count * 3) {
    return { regions: [], totalShare: 0, largestShare: 0 };
  }

  const label = new Int32Array(count).fill(-1);
  const regions: OverlayRegion[] = [];
  const stack: number[] = [];

  for (let seed = 0; seed < count; seed++) {
    if (label[seed] !== -1) continue;
    const at = seed * 3;
    const sr = pixels[at];
    const sg = pixels[at + 1];
    const sb = pixels[at + 2];

    // Flood from this seed, admitting only pixels close to the SEED — never
    // to the neighbour, which is what a gradient would walk along.
    let area = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    label[seed] = regions.length;
    stack.length = 0;
    stack.push(seed);
    // Per-row extents, for the straightness measure below.
    const rowLeft = new Map<number, number>();
    const rowRight = new Map<number, number>();
    const rowCount = new Map<number, number>();

    while (stack.length) {
      const index = stack.pop()!;
      const p = index * 3;
      area += 1;
      sumR += pixels[p];
      sumG += pixels[p + 1];
      sumB += pixels[p + 2];
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const left = rowLeft.get(y);
      if (left === undefined || x < left) rowLeft.set(y, x);
      const right = rowRight.get(y);
      if (right === undefined || x > right) rowRight.set(y, x);
      rowCount.set(y, (rowCount.get(y) ?? 0) + 1);

      for (let dy = -BRIDGE_GAP; dy <= BRIDGE_GAP; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -BRIDGE_GAP; dx <= BRIDGE_GAP; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (!dx && !dy)) continue;
          const n = ny * width + nx;
          if (label[n] !== -1) continue;
          const q = n * 3;
          const distance = Math.abs(pixels[q] - sr)
            + Math.abs(pixels[q + 1] - sg)
            + Math.abs(pixels[q + 2] - sb);
          if (distance > SEED_TOLERANCE) continue;
          label[n] = regions.length;
          stack.push(n);
        }
      }
    }

    const share = area / count;
    if (share < MIN_REGION_SHARE || share > MAX_REGION_SHARE) continue;

    const r = sumR / area;
    const g = sumG / area;
    const b = sumB / area;
    const max = Math.max(r, g, b);
    const chroma = max <= 0 ? 0 : (max - Math.min(r, g, b)) / max;
    if (chroma < MIN_CHROMA) continue;

    const boxWidth = maxX - minX + 1;
    let occupancy = 0;
    for (const count of rowCount.values()) occupancy += count / boxWidth;
    const rowFill = occupancy / rowCount.size;
    if (rowFill < MIN_ROW_FILL) continue;

    const edgeSpread = (meanDeviation(rowLeft) + meanDeviation(rowRight)) / 2 / boxWidth;
    if (edgeSpread > MAX_EDGE_SPREAD) continue;

    regions.push({
      share,
      rowFill,
      edgeSpread,
      chroma,
      colour: [Math.round(r), Math.round(g), Math.round(b)],
    });
  }

  regions.sort((a, b) => b.share - a.share);
  const totalShare = regions.reduce((sum, region) => sum + region.share, 0);
  return { regions, totalShare, largestShare: regions[0]?.share ?? 0 };
}

/** What the measurement concluded, and the numbers behind it. */
export interface OverlayVerdict {
  /** True when a promotional graphic is laid over the picture. */
  annotated: boolean;
  largestShare: number;
  totalShare: number;
  regionCount: number;
}

/**
 * Is this picture a marketing tile?
 *
 * ONE flat coloured block covering `MIN_REGION_SHARE` of it is already a
 * ribbon rather than a badge; the live tiles carry three or four, each around
 * a twentieth of the picture. A picture with none is a photograph or a render,
 * whatever a builder wrote in the corner of it.
 */
export function readMarketingOverlay(view: RasterView): OverlayVerdict {
  const measurement = measureFlatColourRegions(view);
  return {
    annotated: measurement.regions.length > 0,
    largestShare: Number(measurement.largestShare.toFixed(4)),
    totalShare: Number(measurement.totalShare.toFixed(4)),
    regionCount: measurement.regions.length,
  };
}

/** Mean absolute deviation of a set of row extents. */
function meanDeviation(extents: Map<number, number>): number {
  if (!extents.size) return 0;
  let sum = 0;
  for (const value of extents.values()) sum += value;
  const mean = sum / extents.size;
  let deviation = 0;
  for (const value of extents.values()) deviation += Math.abs(value - mean);
  return deviation / extents.size;
}
