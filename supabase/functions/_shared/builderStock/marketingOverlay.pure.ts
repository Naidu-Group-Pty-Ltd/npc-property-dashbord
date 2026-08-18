/**
 * Builder stock — telling a property photograph from a marketing tile.
 *
 * THE CASE THIS EXISTS FOR. A builder publishes their listing image as a
 * 1200×600 tile with the property's own facade under a status ribbon: pills
 * reading "Completed" and "SMSF", one reading "$25,000 Rebate", suburb and
 * state banners. Those bytes are genuinely the builder's, they are genuinely
 * of that property, and the source genuinely designates them as its listing
 * image — every provenance question answers yes — and the picture is still not
 * one to put in front of a client being asked to buy a house.
 *
 * SO THIS ANSWERS A DIFFERENT QUESTION FROM EVERY OTHER MODULE HERE. Not
 * "whose house is it" and not "did the builder supply it" — those are settled
 * structurally, before anything gets here, and nothing in this file may ever
 * be used to settle them. Only: has promotional treatment been laid OVER the
 * photograph.
 *
 * TWO INDEPENDENT SIGNALS, AND EITHER IS ENOUGH.
 *
 *   1  PROMINENT OVERLAY TYPOGRAPHY. Big lettering laid over the picture, in
 *      lines, whatever it says and whatever is behind it. This is the general
 *      signal and the one that survives a change of campaign: it does not care
 *      about colour, so a black, white, grey, gradient, semi-transparent or
 *      entirely absent backing plate makes no difference to it, and text set
 *      straight onto the photograph is caught the same way. Letters are found
 *      as shapes and never read — nothing here recognises a word, and there is
 *      no vocabulary to recognise one against.
 *
 *   2  A LARGE FLAT COLOURED BLOCK. A pill, a ribbon or a banner, found as a
 *      region of one exact colour with straight sides. Kept because it catches
 *      a graphic carrying no lettering at all, and because it is cheap.
 *
 * WHAT SEPARATES THEM FROM A PHOTOGRAPH, in both cases, is that neither
 * lettering nor a vector fill occurs naturally in one. A sky has a gradient, a
 * lawn has texture, a wall has shading, and a roofline is not a straight edge
 * of one colour. Where a sky IS flat and saturated — a render's often is — it
 * is still cut off by a roof, a tree, a fence, and the straightness of a
 * region's own sides is what tells the two apart.
 *
 * WHAT STAYS DISPLAYABLE, measured on the live source: a builder's own small
 * corner tag, an "ARTIST IMPRESSION. INDICATIVE ONLY." footer, a logo, a
 * watermark, a design name. Every one of them is small — that is the whole of
 * the distinction, and it is a measurement rather than a list.
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
 * How colourful a region must be to be judged on the COLOURED floor below.
 *
 * Chroma over the channel maximum, so it is exposure-independent.
 */
const MIN_CHROMA = 0.28;

/**
 * A neutral block has to be substantially bigger before it counts.
 *
 * Black, white and grey are what ORDINARY presentation is drawn in — a
 * letterbox margin, a drop shadow, an "ARTIST IMPRESSION" footer — so refusing
 * every neutral rectangle would refuse most clean builder renders. Refusing
 * none of them would let a black or white promotional banner past, which is a
 * shape this must catch. Size is what separates the two: measured on the live
 * source, the largest neutral block that is ordinary presentation is a
 * disclaimer bar at 3.4% of its picture, and a promotional banner runs from
 * 4.5% up.
 */
const MIN_NEUTRAL_REGION_SHARE = 0.045;

/**
 * A band running the full width or height of the picture is FRAMING.
 *
 * Letterboxing, pillarboxing and a full-bleed border are all large, flat,
 * perfectly straight-sided rectangles, and none of them is a badge. A banner
 * sits inside the picture; framing surrounds it.
 */
const MAX_SPAN_SHARE = 0.9;

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
    // Coloured blocks are judged on the ordinary floor; neutral ones have to
    // be much larger before they are anything but presentation.
    if (chroma < MIN_CHROMA && share < MIN_NEUTRAL_REGION_SHARE) continue;

    // Framing rather than a badge. See `MAX_SPAN_SHARE`.
    if ((maxX - minX + 1) / width > MAX_SPAN_SHARE) continue;
    if ((maxY - minY + 1) / height > MAX_SPAN_SHARE) continue;

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

// ---------------------------------------------------------------------------
// Signal 1 — prominent overlay typography
// ---------------------------------------------------------------------------

/**
 * How far a pixel must sit from its own neighbourhood's average brightness to
 * count as ink.
 *
 * Local rather than global, so lettering is found whether it is dark on light
 * or light on dark, on a plate or straight onto the picture. That is the whole
 * reason this signal survives a change of campaign: it never looks at the
 * colour of the type or of whatever is behind it.
 */
const INK_CONTRAST = 40;

/**
 * Radius of the neighbourhood the average is taken over, as a share of height.
 *
 * Deliberately SMALL — about a stroke's width. A wide window makes the average
 * track the whole composition rather than the local background, and then half
 * the picture reads as ink and floods into one component.
 */
const INK_WINDOW_SHARE = 0.02;

/**
 * WHAT IS MEASURED IS A RUN OF LETTERING, NOT A LETTER.
 *
 * At the scale a card image is judged on, a word's letters and their contrast
 * edges merge into one shape, and trying to split them back into glyphs is
 * both fragile and unnecessary: the run itself has exactly the properties that
 * distinguish type from architecture. It is horizontal, it is solid without
 * being a filled block, and it is striped — a line of alternating strokes and
 * counters — which a window, a garage door, a fence or a roofline is not.
 *
 * Every bound below was fitted against the live source rather than chosen.
 */
/** Below this a run is a disclaimer, a design name or a watermark, and stays. */
const MIN_PROMINENT_TEXT_SHARE = 0.045;
/** Above this it is a building, not a caption. */
const MAX_TEXT_HEIGHT_SHARE = 0.22;
/** A run of lettering is wider than it is tall. One mark is not a caption. */
const MIN_TEXT_ASPECT = 1.2;
/**
 * How much of its own box a run fills.
 *
 * The floor excludes the sparse networks a photograph's own edges make — those
 * measure 0.06 to 0.11. The ceiling excludes anything solid: a filled
 * rectangle is a shadow or a door, never a word.
 */
const MIN_TEXT_FILL = 0.45;
const MAX_TEXT_FILL = 0.88;
/** Strokes and counters across the middle of the run. Type alternates. */
const MIN_TEXT_STRIPES = 3;
/**
 * How far across a gap two strokes still belong to the same run.
 *
 * A WORD, NOT A LETTER, IS THE THING BEING LOOKED FOR. Eight-connectivity
 * alone joins the strokes of a letter and stops at the space beside it, so a
 * word set straight over a photograph arrives as six separate marks, each
 * taller than it is wide — refused by the aspect test one at a time, however
 * large the word is. Where something IS drawn behind the type the marks touch
 * anyway, which is why the pill and the ribbon were caught and bare
 * typography was not.
 *
 * Two pixels at the measured edge, which is the widest inter-letter space a
 * word carries at this scale and narrower than the space between words. It
 * joins letters and never joins captions.
 */
const TEXT_RUN_BRIDGE = 2;

/**
 * How much of the run's ink is where its LETTERS are rather than at its edges.
 *
 * A disclaimer plate defeats every test above: it is a wide dark bar of the
 * right height, its outline plus its tiny caption fill it plausibly, and the
 * caption gives it plenty of stripes. What gives it away is WHERE the ink
 * sits — almost all of it on the plate's top and bottom edges, with a thin
 * line of very small type between them. A caption's ink is in the middle,
 * because the middle is what a letter is.
 *
 * Measured as the ink in the central band of the run over the ink in its
 * busiest row. On the live source a disclaimer bar scores 0.57 and every
 * promotional caption scores 0.76 or more. A word set STRAIGHT ONTO the
 * photograph with nothing drawn behind it scores lower than one on a plate —
 * 0.67, because the picture's own texture adds ink at the run's edges that a
 * plate would have covered — so the floor sits at 0.64 rather than in the
 * middle of the original gap. Every clean cover in the live source is
 * unaffected: none of them produces a qualifying run at any threshold.
 */
const MIN_TEXT_CORE_PROFILE = 0.64;
/** And the single middle row, as a second look at the same thing. */
const MIN_TEXT_MIDDLE_PROFILE = 0.45;

export interface TextMeasurement {
  /** Tallest prominent run, as a share of the picture's height. 0 for none. */
  heightShare: number;
  /** How many prominent runs were found. */
  lineCount: number;
}

/**
 * Find runs of lettering laid over the picture, and report the tallest.
 *
 * Lettering is located as SHAPE — never read. There is no alphabet here, no
 * language, and nothing a word could be compared against.
 */
export function measureOverlayText(view: RasterView): TextMeasurement {
  const { width, height, pixels } = view;
  const count = width * height;
  if (count <= 0 || pixels.length < count * 3 || height < 16) {
    return { heightShare: 0, lineCount: 0 };
  }

  const luma = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const at = i * 3;
    luma[i] = pixels[at] * 0.299 + pixels[at + 1] * 0.587 + pixels[at + 2] * 0.114;
  }
  const radius = Math.max(2, Math.round(height * INK_WINDOW_SHARE));
  const local = boxBlur(luma, width, height, radius);

  const ink = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (Math.abs(luma[i] - local[i]) > INK_CONTRAST) ink[i] = 1;
  }

  const label = new Int32Array(count).fill(-1);
  const stack: number[] = [];
  const minHeight = Math.max(3, height * MIN_PROMINENT_TEXT_SHARE);
  const maxHeight = height * MAX_TEXT_HEIGHT_SHARE;
  let tallest = 0;
  let lines = 0;

  for (let seed = 0; seed < count; seed++) {
    if (!ink[seed] || label[seed] !== -1) continue;
    label[seed] = 1;
    stack.length = 0;
    stack.push(seed);
    let area = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    while (stack.length) {
      const index = stack.pop()!;
      area += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        // Horizontal only: a run is a LINE of letters, so reaching sideways
        // joins a word and reaching downwards would join two captions, or a
        // caption to the roofline under it.
        for (let dx = -TEXT_RUN_BRIDGE; dx <= TEXT_RUN_BRIDGE; dx++) {
          if (dy !== 0 && (dx < -1 || dx > 1)) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width || (!dx && !dy)) continue;
          const n = ny * width + nx;
          if (!ink[n] || label[n] !== -1) continue;
          label[n] = 1;
          stack.push(n);
        }
      }
    }

    const runHeight = maxY - minY + 1;
    const runWidth = maxX - minX + 1;
    if (runHeight < minHeight || runHeight > maxHeight) continue;
    if (runWidth < runHeight * MIN_TEXT_ASPECT) continue;
    const fill = area / (runWidth * runHeight);
    if (fill < MIN_TEXT_FILL || fill > MAX_TEXT_FILL) continue;
    if (stripesAcross(ink, label, width, minX, maxX, minY, maxY) < MIN_TEXT_STRIPES) continue;
    const profile = inkProfile(ink, label, width, minX, maxX, minY, maxY);
    if (profile.core < MIN_TEXT_CORE_PROFILE) continue;
    if (profile.middle < MIN_TEXT_MIDDLE_PROFILE) continue;

    lines += 1;
    const share = runHeight / height;
    if (share > tallest) tallest = share;
  }

  return { heightShare: tallest, lineCount: lines };
}

/**
 * Where the run's ink sits: the central band, and the single middle row, each
 * against its busiest row. See `MIN_TEXT_CORE_PROFILE`.
 */
function inkProfile(
  ink: Uint8Array,
  label: Int32Array,
  width: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): { core: number; middle: number } {
  const rows: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    let count = 0;
    for (let x = minX; x <= maxX; x++) {
      const index = y * width + x;
      if (ink[index] === 1 && label[index] === 1) count += 1;
    }
    rows.push(count);
  }
  const busiest = Math.max(1, ...rows);
  const from = Math.floor(rows.length * 0.3);
  const to = Math.max(from + 1, Math.ceil(rows.length * 0.7));
  let sum = 0;
  for (let i = from; i < to; i++) sum += rows[i];
  return {
    core: (sum / (to - from)) / busiest,
    middle: rows[Math.floor(rows.length / 2)] / busiest,
  };
}

/**
 * How many times the run's ink starts and stops across its own middle.
 *
 * A word alternates: stroke, counter, stroke. A solid bar does not, and
 * neither does a single blot. Counted on the row through the middle of the
 * run, which is where letters are at their most regular.
 */
function stripesAcross(
  ink: Uint8Array,
  label: Int32Array,
  width: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): number {
  const row = Math.floor((minY + maxY) / 2);
  let runs = 0;
  let inside = false;
  for (let x = minX; x <= maxX; x++) {
    const index = row * width + x;
    const on = ink[index] === 1 && label[index] === 1;
    if (on && !inside) runs += 1;
    inside = on;
  }
  return runs;
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/** What the measurement concluded, and the numbers behind it. */
export interface OverlayVerdict {
  /** True when promotional treatment is laid over the picture. */
  annotated: boolean;
  largestShare: number;
  totalShare: number;
  regionCount: number;
  textHeightShare: number;
  textLineCount: number;
}

/**
 * Is this picture a marketing tile?
 *
 * EITHER signal is enough. Prominent lettering laid over a photograph is a
 * marketing tile whatever is behind it, and a flat coloured block of ribbon
 * size is one even when it carries no lettering at all.
 */
export function readMarketingOverlay(view: RasterView): OverlayVerdict {
  const blocks = measureFlatColourRegions(view);
  const text = measureOverlayText(view);
  return {
    annotated: blocks.regions.length > 0 || text.lineCount > 0,
    largestShare: Number(blocks.largestShare.toFixed(4)),
    totalShare: Number(blocks.totalShare.toFixed(4)),
    regionCount: blocks.regions.length,
    textHeightShare: Number(text.heightShare.toFixed(4)),
    textLineCount: text.lineCount,
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

/** Separable box blur. Two passes, so the window is a square. */
function boxBlur(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const horizontal = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    let span = 0;
    for (let x = -radius; x <= radius; x++) {
      if (x >= 0 && x < width) { sum += source[row + x]; span += 1; }
    }
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / span;
      const drop = x - radius;
      const add = x + radius + 1;
      if (drop >= 0) { sum -= source[row + drop]; span -= 1; }
      if (add < width) { sum += source[row + add]; span += 1; }
    }
  }

  const out = new Float32Array(source.length);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let span = 0;
    for (let y = -radius; y <= radius; y++) {
      if (y >= 0 && y < height) { sum += horizontal[y * width + x]; span += 1; }
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span;
      const drop = y - radius;
      const add = y + radius + 1;
      if (drop >= 0) { sum -= horizontal[drop * width + x]; span -= 1; }
      if (add < height) { sum += horizontal[add * width + x]; span += 1; }
    }
  }
  return out;
}
