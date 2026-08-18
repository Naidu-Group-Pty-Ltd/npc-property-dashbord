/**
 * Builder stock tests — writing a lossy WebP, so the VP8 decoder has something
 * real to read.
 *
 * WHY THIS EXISTS. No generated image may be committed to this repository — the
 * PDF Import release gate refuses any `.png`, `.jpg` or `.webp` in a change —
 * and there is no WebP encoder in the dependency tree. Without one of those two
 * things the lossy half of the WebP decoder, which is by far the larger and
 * riskier half, would have no test at all. So the fixture is written here and
 * generated in memory when a test asks for it.
 *
 * IT IS DELIBERATELY NOT BUILT FROM THE DECODER. Everything below comes from
 * RFC 6386 directly: the arithmetic coder from section 7, the frame header from
 * section 9, the mode records from section 11, the token tree from section 13.
 * An encoder that shares its author's misreadings with the decoder proves
 * nothing, so the two were written from the specification separately and the
 * round trip is the check.
 *
 * IT IS THE SIMPLEST LEGAL KEY FRAME THAT IS STILL A PICTURE:
 *
 *   * `B_PRED` luma with every sub-block `B_DC_PRED`, so each 4x4 block
 *     predicts from its own reconstructed neighbours and codes its own DC.
 *     That removes the second-order (Y2/Walsh-Hadamard) block entirely.
 *   * `DC_PRED` chroma, one prediction per 8x8, each 4x4 coding its own DC.
 *   * Full 4x4 transform coefficients. An earlier DC-only version was simpler
 *     and produced a MOSAIC — every 4x4 block one flat colour — which the
 *     overlay classifier then read as large flat regions and refused. A fixture
 *     that is not a photograph cannot stand in for one.
 *   * Loop filter level 0, one token partition, no segmentation, no probability
 *     updates. Every one of those is a feature the DECODER still has to parse
 *     correctly to stay in sync, which is the point.
 *
 * The encoder reconstructs as it goes, exactly as the decoder will, because a
 * predictive format has no other way to know what its residuals mean.
 */
import {
  AC_QLOOKUP, CAT_PROBS, COEFF_BANDS, COEFF_UPDATE_PROBS, DC_QLOOKUP,
  DEFAULT_COEFF_PROBS, KF_BMODE_PROBS, KF_UV_MODE_PROBS, KF_YMODE_PROBS, ZIGZAG,
} from '../../../../supabase/functions/_shared/builderStock/vp8Tables';

interface Picture { width: number; height: number; pixels: Uint8Array }

// ---------------------------------------------------------------------------
// The arithmetic coder — RFC 6386 section 7.3
// ---------------------------------------------------------------------------

class BoolEncoder {
  private readonly out: number[] = [];
  private range = 255;
  private bottom = 0;
  private bitCount = 24;

  /** Propagate a carry backwards through the bytes already emitted. */
  private carry(): void {
    for (let i = this.out.length - 1; i >= 0; i--) {
      if (this.out[i] === 255) { this.out[i] = 0; continue; }
      this.out[i] += 1;
      return;
    }
  }

  bit(probability: number, value: number): void {
    const split = 1 + (((this.range - 1) * probability) >> 8);
    if (value) {
      this.bottom = (this.bottom + split) >>> 0;
      this.range -= split;
    } else {
      this.range = split;
    }
    while (this.range < 128) {
      this.range <<= 1;
      if (this.bottom & 0x80000000) this.carry();
      this.bottom = (this.bottom << 1) >>> 0;
      if (--this.bitCount === 0) {
        this.out.push((this.bottom >>> 24) & 0xff);
        this.bottom = this.bottom & 0x00ffffff;
        this.bitCount = 8;
      }
    }
  }

  /** A uniform value, most significant bit first. */
  literal(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bit(128, (value >> i) & 1);
  }

  bytes(): Uint8Array {
    let value = this.bottom;
    let count = this.bitCount;
    if (value & (1 << (32 - count))) this.carry();
    value = (value << (count & 7)) >>> 0;
    count >>= 3;
    while (--count >= 0) value = (value << 8) >>> 0;
    for (let i = 0; i < 4; i++) {
      this.out.push((value >>> 24) & 0xff);
      value = (value << 8) >>> 0;
    }
    return Uint8Array.from(this.out);
  }
}

// ---------------------------------------------------------------------------
// Reconstruction, mirrored
// ---------------------------------------------------------------------------

const clamp255 = (value: number) => value < 0 ? 0 : value > 255 ? 255 : value;

/**
 * A plane with the format's own borders: 127 above the frame, 129 to its left,
 * and 127 in the corner. Prediction reads them like any other neighbour, so an
 * encoder that leaves them out disagrees with every decoder about the first
 * macroblock and about every left edge after it.
 */
class Plane {
  readonly stride: number;
  readonly data: Uint8Array;
  readonly origin: number;

  constructor(readonly width: number, readonly height: number) {
    this.stride = width + 8;
    this.data = new Uint8Array(this.stride * (height + 1) + 8);
    this.origin = this.stride + 1;
    for (let y = 0; y < height; y++) this.data[this.origin + y * this.stride - 1] = 129;
    this.data.fill(127, this.origin - this.stride - 1,
      this.origin - this.stride + width + 4);
  }

  at(x: number, y: number): number {
    return this.data[this.origin + y * this.stride + x];
  }

  set(x: number, y: number, value: number): void {
    this.data[this.origin + y * this.stride + x] = value;
  }
}

// ---------------------------------------------------------------------------
// Tokens — RFC 6386 section 13
// ---------------------------------------------------------------------------

const CAT_3456 = [CAT_PROBS[2], CAT_PROBS[3], CAT_PROBS[4], CAT_PROBS[5]];

/** Write one coefficient magnitude, mirroring the reader's escape ladder. */
function writeMagnitude(encoder: BoolEncoder, probabilities: number[], at: number,
  magnitude: number): void {
  const probability = (offset: number) => probabilities[at + offset];
  if (magnitude === 1) { encoder.bit(probability(2), 0); return; }
  encoder.bit(probability(2), 1);

  if (magnitude <= 4) {
    encoder.bit(probability(3), 0);
    if (magnitude === 2) { encoder.bit(probability(4), 0); return; }
    encoder.bit(probability(4), 1);
    encoder.bit(probability(5), magnitude === 4 ? 1 : 0);
    return;
  }
  encoder.bit(probability(3), 1);

  if (magnitude <= 10) {
    encoder.bit(probability(6), 0);
    if (magnitude <= 6) {
      encoder.bit(probability(7), 0);
      encoder.bit(CAT_PROBS[0][0], magnitude - 5);
      return;
    }
    encoder.bit(probability(7), 1);
    const offset = magnitude - 7;
    encoder.bit(CAT_PROBS[1][0], offset >> 1);
    encoder.bit(CAT_PROBS[1][1], offset & 1);
    return;
  }
  encoder.bit(probability(6), 1);

  let category = 0;
  while (category < 3
    && magnitude >= 3 + (8 << category) + (1 << CAT_3456[category].length)) {
    category += 1;
  }
  const highBit = category >> 1;
  const lowBit = category & 1;
  encoder.bit(probability(8), highBit);
  encoder.bit(probability(9 + highBit), lowBit);
  const extra = magnitude - (3 + (8 << category));
  const bits = CAT_3456[category];
  for (let i = 0; i < bits.length; i++) {
    encoder.bit(bits[i], (extra >> (bits.length - 1 - i)) & 1);
  }
}

/**
 * Write one 4x4 block's quantised coefficients, in zigzag order.
 *
 * The shape is the reader's, inverted: ONE end-of-block flag per run, then a
 * flag per zero coefficient, then the value — not a flag per coefficient. The
 * probability context moves with it (0 after a zero, 1 after a one, 2 after
 * anything larger), and getting that wrong desynchronises the arithmetic coder
 * rather than producing a wrong number, which is why it is written out here
 * rather than folded into a loop.
 *
 * Returns whether the block carried anything, which is the context its
 * neighbours are read from.
 */
function writeBlock(
  encoder: BoolEncoder, probabilities: number[], type: number, context: number,
  first: number, coefficients: Int32Array,
): boolean {
  const bandAt = (position: number, ctx: number) =>
    (((type * 8) + COEFF_BANDS[position]) * 3 + ctx) * 11;

  let last = -1;
  for (let n = first; n < 16; n++) if (coefficients[n] !== 0) last = n;

  let n = first;
  let ctx = context;
  for (;;) {
    let at = bandAt(n, ctx);
    if (n > last) {
      encoder.bit(probabilities[at], 0);      // end of block
      return last >= first;
    }
    encoder.bit(probabilities[at], 1);        // something follows
    while (coefficients[n] === 0) {
      encoder.bit(probabilities[at + 1], 0);  // and it is a zero
      n += 1;
      ctx = 0;
      at = bandAt(n, 0);
    }
    encoder.bit(probabilities[at + 1], 1);
    const magnitude = Math.abs(coefficients[n]);
    writeMagnitude(encoder, probabilities, at, magnitude);
    encoder.bit(128, coefficients[n] < 0 ? 1 : 0);
    ctx = magnitude === 1 ? 1 : 2;
    n += 1;
    if (n === 16) return true;
  }
}

/**
 * The forward 4x4 DCT, RFC 6386's own integer form.
 *
 * Written from the specification rather than derived from the decoder's
 * inverse: an encoder that inverts its own reader's arithmetic proves only that
 * the two agree with each other.
 */
function forwardDct(residual: Int32Array, out: Int32Array): void {
  const temp = new Int32Array(16);
  for (let i = 0; i < 4; i++) {
    const row = i * 4;
    const a1 = (residual[row] + residual[row + 3]) * 8;
    const b1 = (residual[row + 1] + residual[row + 2]) * 8;
    const c1 = (residual[row + 1] - residual[row + 2]) * 8;
    const d1 = (residual[row] - residual[row + 3]) * 8;
    temp[row] = a1 + b1;
    temp[row + 2] = a1 - b1;
    temp[row + 1] = (c1 * 2217 + d1 * 5352 + 14500) >> 12;
    temp[row + 3] = (d1 * 2217 - c1 * 5352 + 7500) >> 12;
  }
  for (let i = 0; i < 4; i++) {
    const a1 = temp[i] + temp[12 + i];
    const b1 = temp[4 + i] + temp[8 + i];
    const c1 = temp[4 + i] - temp[8 + i];
    const d1 = temp[i] - temp[12 + i];
    out[i] = (a1 + b1 + 7) >> 4;
    out[8 + i] = (a1 - b1 + 7) >> 4;
    out[4 + i] = ((c1 * 2217 + d1 * 5352 + 12000) >> 16) + (d1 !== 0 ? 1 : 0);
    out[12 + i] = (d1 * 2217 - c1 * 5352 + 51000) >> 16;
  }
}

/**
 * The inverse the DECODER will apply, modelled here.
 *
 * An encoder has to reconstruct exactly what its reader will, or its next
 * prediction is taken from pixels that will not exist and the error compounds
 * across the frame. This is the specification's inverse transform, held
 * separately from the decoder's copy so neither is written against the other.
 */
function inverseDct(block: Int32Array, out: Int32Array): void {
  const high = (value: number, constant: number) => Math.floor((value * constant) / 65536);
  const temp = new Int32Array(16);
  for (let i = 0; i < 4; i++) {
    const a1 = block[i] + block[8 + i];
    const b1 = block[i] - block[8 + i];
    const c1 = high(block[4 + i], 35468) - (block[12 + i] + high(block[12 + i], 20091));
    const d1 = (block[4 + i] + high(block[4 + i], 20091)) + high(block[12 + i], 35468);
    temp[i] = a1 + d1;
    temp[12 + i] = a1 - d1;
    temp[4 + i] = b1 + c1;
    temp[8 + i] = b1 - c1;
  }
  for (let i = 0; i < 4; i++) {
    const row = i * 4;
    const a1 = temp[row] + temp[row + 2];
    const b1 = temp[row] - temp[row + 2];
    const c1 = high(temp[row + 1], 35468) - (temp[row + 3] + high(temp[row + 3], 20091));
    const d1 = (temp[row + 1] + high(temp[row + 1], 20091)) + high(temp[row + 3], 35468);
    out[row] = (a1 + d1 + 4) >> 3;
    out[row + 3] = (a1 - d1 + 4) >> 3;
    out[row + 1] = (b1 + c1 + 4) >> 3;
    out[row + 2] = (b1 - c1 + 4) >> 3;
  }
}

/**
 * Transform, quantise, write, and reconstruct one 4x4 block.
 *
 * All four in one place because they are one decision: what is written and what
 * the encoder then believes is on the page have to be the same thing.
 */
function codeBlock(
  encoder: BoolEncoder, probabilities: number[], type: number, context: number,
  residual: Int32Array, dcQuant: number, acQuant: number,
  reconstructed: Int32Array,
): boolean {
  const transformed = new Int32Array(16);
  forwardDct(residual, transformed);

  const quantised = new Int32Array(16);
  const dequantised = new Int32Array(16);
  for (let n = 0; n < 16; n++) {
    const quantiser = n === 0 ? dcQuant : acQuant;
    const level = Math.round(transformed[ZIGZAG[n]] / quantiser);
    quantised[n] = level;
    dequantised[ZIGZAG[n]] = level * quantiser;
  }

  const nonZero = writeBlock(encoder, probabilities, type, context, 0, quantised);
  inverseDct(dequantised, reconstructed);
  return nonZero;
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/** BT.601 studio range, the inverse of what the decoder converts back. */
function toYuv(picture: Picture) {
  const { width, height, pixels } = picture;
  const luma = new Uint8Array(width * height);
  const cbSum = new Float64Array(((width + 1) >> 1) * ((height + 1) >> 1));
  const crSum = new Float64Array(cbSum.length);
  const counts = new Float64Array(cbSum.length);
  const chromaWidth = (width + 1) >> 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      const r = pixels[at];
      const g = pixels[at + 1];
      const b = pixels[at + 2];
      luma[y * width + x] = clamp255(
        Math.round(16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255));
      const index = (y >> 1) * chromaWidth + (x >> 1);
      cbSum[index] += 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255;
      crSum[index] += 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255;
      counts[index] += 1;
    }
  }

  const cb = new Uint8Array(cbSum.length);
  const cr = new Uint8Array(crSum.length);
  for (let i = 0; i < cb.length; i++) {
    cb[i] = clamp255(Math.round(cbSum[i] / Math.max(1, counts[i])));
    cr[i] = clamp255(Math.round(crSum[i] / Math.max(1, counts[i])));
  }
  return { luma, cb, cr, chromaWidth, chromaHeight: (height + 1) >> 1 };
}

/** The quantiser index. Low, so the DCs land close to what was asked for. */
const BASE_QUANTISER_INDEX = 20;

export function lossyWebpOf(picture: Picture): Uint8Array {
  const { width, height } = picture;
  const mbWidth = (width + 15) >> 4;
  const mbHeight = (height + 15) >> 4;
  const source = toYuv(picture);

  const y1dc = DC_QLOOKUP[BASE_QUANTISER_INDEX];
  const y1ac = AC_QLOOKUP[BASE_QUANTISER_INDEX];
  const uvdc = Math.min(132, DC_QLOOKUP[BASE_QUANTISER_INDEX]);
  const uvac = AC_QLOOKUP[BASE_QUANTISER_INDEX];

  // ── header partition ─────────────────────────────────────────────────────
  const header = new BoolEncoder();
  header.literal(0, 1);   // colour space
  header.literal(0, 1);   // clamping type
  header.bit(128, 0);     // segmentation disabled
  header.literal(0, 1);   // filter type
  header.literal(0, 6);   // loop filter level 0 — nothing to deblock
  header.literal(0, 3);   // sharpness
  header.bit(128, 0);     // no loop filter deltas
  header.literal(0, 2);   // one token partition
  header.literal(BASE_QUANTISER_INDEX, 7);
  for (let i = 0; i < 5; i++) header.bit(128, 0); // no quantiser deltas
  header.literal(1, 1);   // refresh entropy probabilities
  // No probability updates: one zero bit at each update probability, all 1,056
  // of which the decoder must read to stay in step.
  for (let i = 0; i < COEFF_UPDATE_PROBS.length; i++) header.bit(COEFF_UPDATE_PROBS[i], 0);
  header.bit(128, 0);     // mb_no_coeff_skip disabled, so no per-macroblock flag

  const probabilities = DEFAULT_COEFF_PROBS;

  // ── modes ────────────────────────────────────────────────────────────────
  for (let mb = 0; mb < mbWidth * mbHeight; mb++) {
    // B_PRED is the leaf "0" of the key-frame luma tree.
    header.bit(KF_YMODE_PROBS[0], 0);
    // Sixteen sub-blocks, every one B_DC_PRED — the leaf "0" of the b-mode
    // tree. Its context is (above, left), and with every neighbour B_DC_PRED
    // that is always (0, 0).
    for (let i = 0; i < 16; i++) header.bit(KF_BMODE_PROBS[0], 0);
    // DC_PRED chroma is the leaf "0" of the chroma tree.
    header.bit(KF_UV_MODE_PROBS[0], 0);
  }

  // ── tokens ───────────────────────────────────────────────────────────────
  const tokens = new BoolEncoder();
  const yPlane = new Plane(mbWidth * 16, mbHeight * 16);
  const uPlane = new Plane(mbWidth * 8, mbHeight * 8);
  const vPlane = new Plane(mbWidth * 8, mbHeight * 8);

  const aboveY = new Uint8Array(mbWidth * 4);
  const aboveU = new Uint8Array(mbWidth * 2);
  const aboveV = new Uint8Array(mbWidth * 2);
  const leftY = new Uint8Array(4);
  const leftU = new Uint8Array(2);
  const leftV = new Uint8Array(2);

  /** The sixteen luma samples the source wants in this 4x4 block. */
  const readLuma = (x: number, y: number, out: Int32Array) => {
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const sx = Math.min(width - 1, x + dx);
        const sy = Math.min(height - 1, y + dy);
        out[dy * 4 + dx] = source.luma[sy * width + sx];
      }
    }
  };

  const readChroma = (plane: Uint8Array, x: number, y: number, out: Int32Array) => {
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const sx = Math.min(source.chromaWidth - 1, x + dx);
        const sy = Math.min(source.chromaHeight - 1, y + dy);
        out[dy * 4 + dx] = plane[sy * source.chromaWidth + sx];
      }
    }
  };

  const wanted = new Int32Array(16);
  const residual = new Int32Array(16);
  const reconstructed = new Int32Array(16);

  for (let mbY = 0; mbY < mbHeight; mbY++) {
    leftY.fill(0); leftU.fill(0); leftV.fill(0);
    for (let mbX = 0; mbX < mbWidth; mbX++) {
      const px = mbX * 16;
      const py = mbY * 16;

      // ── luma: sixteen B_DC_PRED sub-blocks ───────────────────────────────
      for (let block = 0; block < 16; block++) {
        const bx = (block & 3) * 4;
        const by = (block >> 2) * 4;
        const x = px + bx;
        const y = py + by;

        // B_DC_PRED: the mean of the four samples above and the four to the
        // left, both taken from the RECONSTRUCTION, which is all the decoder
        // will have.
        let sum = 0;
        for (let i = 0; i < 4; i++) sum += yPlane.at(x + i, y - 1) + yPlane.at(x - 1, y + i);
        const prediction = (sum + 4) >> 3;

        readLuma(x, y, wanted);
        for (let i = 0; i < 16; i++) residual[i] = wanted[i] - prediction;

        const context = aboveY[mbX * 4 + (block & 3)] + leftY[block >> 2];
        const nonZero = codeBlock(tokens, probabilities, 3, context, residual,
          y1dc, y1ac, reconstructed);
        aboveY[mbX * 4 + (block & 3)] = nonZero ? 1 : 0;
        leftY[block >> 2] = nonZero ? 1 : 0;

        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            yPlane.set(x + dx, y + dy, clamp255(prediction + reconstructed[dy * 4 + dx]));
          }
        }
      }

      // ── chroma: one DC_PRED per 8x8, four DC-coded 4x4 blocks ────────────
      const cx = mbX * 8;
      const cy = mbY * 8;
      for (const [plane, target, above, left] of [
        [uPlane, source.cb, aboveU, leftU],
        [vPlane, source.cr, aboveV, leftV],
      ] as const) {
        let sum = 0;
        let shift = 2;
        if (mbY > 0) {
          for (let i = 0; i < 8; i++) sum += plane.at(cx + i, cy - 1);
          shift += 1;
        }
        if (mbX > 0) {
          for (let i = 0; i < 8; i++) sum += plane.at(cx - 1, cy + i);
          shift += 1;
        }
        const prediction = (mbY > 0 || mbX > 0) ? (sum + (1 << (shift - 1))) >> shift : 128;

        for (let block = 0; block < 4; block++) {
          const bx = (block & 1) * 4;
          const by = (block >> 1) * 4;
          readChroma(target, cx + bx, cy + by, wanted);
          for (let i = 0; i < 16; i++) residual[i] = wanted[i] - prediction;

          const context = above[mbX * 2 + (block & 1)] + left[block >> 1];
          const nonZero = codeBlock(tokens, probabilities, 2, context, residual,
            uvdc, uvac, reconstructed);
          above[mbX * 2 + (block & 1)] = nonZero ? 1 : 0;
          left[block >> 1] = nonZero ? 1 : 0;

          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++) {
              plane.set(cx + bx + dx, cy + by + dy,
                clamp255(prediction + reconstructed[dy * 4 + dx]));
            }
          }
        }
      }
    }
    // The rightmost macroblock's sub-blocks still ask for four samples past the
    // frame's right edge; the reference decoder answers with the last pixel of
    // the row repeated, so the encoder has to predict from the same thing.
    for (let row = 0; row < 16; row++) {
      const y = mbY * 16 + row;
      const last = yPlane.at(yPlane.width - 1, y);
      for (let i = 0; i < 4; i++) yPlane.set(yPlane.width + i, y, last);
    }
  }

  // ── assemble ─────────────────────────────────────────────────────────────
  const headerBytes = header.bytes();
  const tokenBytes = tokens.bytes();
  const body = new Uint8Array(10 + headerBytes.length + tokenBytes.length);
  const tag = 0 | (0 << 1) | (1 << 4) | (headerBytes.length << 5);
  body[0] = tag & 0xff;
  body[1] = (tag >> 8) & 0xff;
  body[2] = (tag >> 16) & 0xff;
  body[3] = 0x9d; body[4] = 0x01; body[5] = 0x2a;
  body[6] = width & 0xff;
  body[7] = (width >> 8) & 0x3f;
  body[8] = height & 0xff;
  body[9] = (height >> 8) & 0x3f;
  body.set(headerBytes, 10);
  body.set(tokenBytes, 10 + headerBytes.length);

  return riff('VP8 ', body);
}

/** Wrap a bitstream in the RIFF container a `.webp` file is. */
export function riff(fourcc: string, body: Uint8Array): Uint8Array {
  const padded = body.length + (body.length & 1);
  const out = new Uint8Array(12 + 8 + padded);
  const view = new DataView(out.buffer);
  const put = (offset: number, text: string) => {
    for (let i = 0; i < 4; i++) out[offset + i] = text.charCodeAt(i);
  };
  put(0, 'RIFF');
  view.setUint32(4, 4 + 8 + padded, true);
  put(8, 'WEBP');
  put(12, fourcc);
  view.setUint32(16, body.length, true);
  out.set(body, 20);
  return out;
}
