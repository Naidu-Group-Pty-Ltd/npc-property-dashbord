/**
 * Builder stock — turning a stored image into something measurable.
 *
 * The marketplace has to answer one question about a picture it is about to
 * put on a client's card: is this a photograph of a house, or a marketing tile
 * with a status ribbon set across it? That question cannot be answered from
 * the filename, the column, the size or the hash — only from the pixels — so
 * something has to decode them.
 *
 * WHAT THIS IS NOT. It is not an image library and must never grow into one.
 * It produces ONE thing: a small RGB thumbnail, at most `TARGET_EDGE` on its
 * long side, for `marketingOverlay.pure.ts` to measure. Nothing it returns is
 * ever stored, served, or used to alter the image the builder supplied — the
 * source bytes are immutable and are uploaded exactly as they arrived.
 *
 * TWO DECODERS, BOTH DELIBERATELY PARTIAL:
 *
 *   PNG   is decoded properly, because it is most of what builders publish
 *         and inflate is already here for the PDF path.
 *   JPEG  is decoded as baseline sequential only — Huffman, dequantise,
 *         inverse DCT, upsample. An eighth-scale DC-only reading was tried
 *         first and is not enough: at one sample per 8×8 block a pill's own
 *         caption shreds it into fragments too small to measure, and the live
 *         Lot 13 tile read as carrying no graphic at all.
 *
 * Anything else — WebP, GIF, progressive JPEG, 16-bit, interlaced PNG —
 * returns null, and null means "no measurement", never "rejected". An image
 * this cannot read keeps whatever eligibility it would have had; refusing to
 * display a builder's photograph because we could not parse its container
 * would be a worse defect than the one this exists to fix.
 */
import { inflate } from './rasterPng.ts';

/** The long side of the thumbnail everything is measured on. */
export const TARGET_EDGE = 200;

/** A tiny RGB image: three bytes per pixel, row-major, no padding. */
export interface Thumbnail {
  width: number;
  height: number;
  /** RGB triples. */
  pixels: Uint8Array;
  /** The full-resolution size, for the record. */
  sourceWidth: number;
  sourceHeight: number;
}

/** Bytes above this are not read at all: a measurement is not worth a stall. */
const MAX_DECODE_BYTES = 12 * 1024 * 1024;
/** And a ceiling on what is worth reconstructing in an edge worker. */
const MAX_DECODE_PIXELS = 40_000_000;

/**
 * A thumbnail of an image we can read, or null.
 *
 * Null is the honest answer for every container this does not implement, and
 * every caller must treat it as "unknown" rather than as a verdict.
 */
export async function decodeThumbnail(bytes: Uint8Array): Promise<Thumbnail | null> {
  if (!bytes?.length || bytes.length > MAX_DECODE_BYTES) return null;
  try {
    if (isPng(bytes)) return await decodePng(bytes);
    if (isJpeg(bytes)) return decodeJpegDc(bytes);
  } catch {
    // A malformed image measures as nothing, exactly like an unsupported one.
  }
  return null;
}

const isPng = (b: Uint8Array) =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

async function decodePng(bytes: Uint8Array): Promise<Thumbnail | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const body = offset + 8;
    if (body + length > bytes.length) break;

    if (type === 'IHDR') {
      width = view.getUint32(body);
      height = view.getUint32(body + 4);
      depth = bytes[body + 8];
      colour = bytes[body + 9];
      interlace = bytes[body + 12];
    } else if (type === 'PLTE') {
      palette = bytes.slice(body, body + length);
    } else if (type === 'IDAT') {
      idat.push(bytes.slice(body, body + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = body + length + 4;
  }

  // Interlaced and sub-byte images are rare enough in builder artwork that
  // implementing them would be carrying code for no measured case.
  if (!width || !height || interlace !== 0) return null;
  if (depth !== 8 && depth !== 16) return null;
  const channels = CHANNELS[colour];
  if (!channels) return null;
  if (colour === 3 && !palette) return null;

  let total = 0;
  for (const part of idat) total += part.length;
  const stream = new Uint8Array(total);
  let at = 0;
  for (const part of idat) { stream.set(part, at); at += part.length; }

  const raw = await inflate(stream);
  const sampleBytes = depth === 16 ? 2 : 1;
  const bpp = channels * sampleBytes;
  const rowBytes = width * bpp;
  if (raw.length < (rowBytes + 1) * height) return null;

  // Unfilter in place, row by row, exactly as the specification defines it.
  const image = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const prior = dst - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const value = raw[src + x];
      const a = x >= bpp ? image[dst + x - bpp] : 0;
      const b = y > 0 ? image[prior + x] : 0;
      const c = x >= bpp && y > 0 ? image[prior + x - bpp] : 0;
      let out: number;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + a; break;
        case 2: out = value + b; break;
        case 3: out = value + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return null;
      }
      image[dst + x] = out & 0xff;
    }
  }

  const read = (x: number, y: number): [number, number, number] => {
    const at = y * rowBytes + x * bpp;
    const s = (index: number) => image[at + index * sampleBytes];
    if (colour === 3) {
      const entry = s(0) * 3;
      return [palette![entry], palette![entry + 1], palette![entry + 2]];
    }
    if (colour === 0 || colour === 4) { const g = s(0); return [g, g, g]; }
    return [s(0), s(1), s(2)];
  };

  return box(width, height, read);
}

// ---------------------------------------------------------------------------
// Baseline JPEG
// ---------------------------------------------------------------------------

/** Zig-zag order: where each coefficient index lands in the 8×8 block. */
const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

/** Separable 8-point inverse DCT, rows then columns, straight from the maths. */
const COS = (() => {
  const table = new Float32Array(64);
  for (let x = 0; x < 8; x++) {
    for (let u = 0; u < 8; u++) {
      table[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return table;
})();

function inverseDct(block: Int32Array, out: Uint8Array): void {
  const rows = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) sum += COS[x * 8 + u] * block[y * 8 + u];
      rows[y * 8 + x] = sum / 2;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) sum += COS[y * 8 + v] * rows[v * 8 + x];
      const value = Math.round(sum / 2) + 128;
      out[y * 8 + x] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
}

interface HuffTable { lookup: Map<number, number> }

/** `code|length` packed so one map serves every code length. */
function buildHuffman(counts: Uint8Array, symbols: Uint8Array): HuffTable {
  const lookup = new Map<number, number>();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < counts[length - 1]; i++) {
      lookup.set((length << 16) | code, symbols[k++]);
      code += 1;
    }
    code <<= 1;
  }
  return { lookup };
}

function decodeJpegDc(bytes: Uint8Array): Thumbnail | null {
  const dcTables: Record<number, HuffTable> = {};
  const acTables: Record<number, HuffTable> = {};
  let frame: {
    width: number; height: number;
    components: Array<{
      id: number; h: number; v: number;
      quantiser: number; dcTable: number; acTable: number;
    }>;
  } | null = null;
  const quantisers: Record<number, Int32Array> = {};
  let restartInterval = 0;
  let scanStart = -1;
  let scanComponents: number[] = [];

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const body = offset + 4;

    if (marker === 0xc0 || marker === 0xc1) {
      const height = (bytes[body + 1] << 8) | bytes[body + 2];
      const width = (bytes[body + 3] << 8) | bytes[body + 4];
      const count = bytes[body + 5];
      const components = [];
      for (let i = 0; i < count; i++) {
        const at = body + 6 + i * 3;
        components.push({
          id: bytes[at],
          h: bytes[at + 1] >> 4,
          v: bytes[at + 1] & 15,
          quantiser: bytes[at + 2],
          dcTable: 0,
          acTable: 0,
        });
      }
      frame = { width, height, components };
    } else if (marker === 0xc2 || (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8)) {
      // Progressive and the arithmetic/lossless modes: not implemented.
      return null;
    } else if (marker === 0xc4) {
      let at = body;
      while (at < body + length - 2) {
        const spec = bytes[at];
        const counts = bytes.slice(at + 1, at + 17);
        let total = 0;
        for (const c of counts) total += c;
        const symbols = bytes.slice(at + 17, at + 17 + total);
        const table = buildHuffman(counts, symbols);
        if (spec >> 4) acTables[spec & 15] = table;
        else dcTables[spec & 15] = table;
        at += 17 + total;
      }
    } else if (marker === 0xdb) {
      let at = body;
      while (at < body + length - 2) {
        const precision = bytes[at] >> 4;
        const id = bytes[at] & 15;
        const table = new Int32Array(64);
        for (let i = 0; i < 64; i++) {
          table[ZIGZAG[i]] = precision
            ? (bytes[at + 1 + i * 2] << 8) | bytes[at + 2 + i * 2]
            : bytes[at + 1 + i];
        }
        quantisers[id] = table;
        at += 1 + (precision ? 128 : 64);
      }
    } else if (marker === 0xdd) {
      restartInterval = (bytes[body] << 8) | bytes[body + 1];
    } else if (marker === 0xda) {
      if (!frame) return null;
      const count = bytes[body];
      scanComponents = [];
      for (let i = 0; i < count; i++) {
        const id = bytes[body + 1 + i * 2];
        const tables = bytes[body + 2 + i * 2];
        const component = frame.components.find((c) => c.id === id);
        if (!component) return null;
        component.dcTable = tables >> 4;
        component.acTable = tables & 15;
        scanComponents.push(frame.components.indexOf(component));
      }
      scanStart = body + length - 2;
      break;
    }
    offset = body + length - 2;
  }

  if (!frame || scanStart < 0) return null;
  // One scan carrying every component: a baseline sequential JPEG. Anything
  // else would need the scans merged, which is beyond what a thumbnail needs.
  if (scanComponents.length !== frame.components.length) return null;

  const maxH = Math.max(...frame.components.map((c) => c.h));
  const maxV = Math.max(...frame.components.map((c) => c.v));
  if (!maxH || !maxV) return null;
  const mcusX = Math.ceil(frame.width / (8 * maxH));
  const mcusY = Math.ceil(frame.height / (8 * maxV));

  if (frame.width * frame.height > MAX_DECODE_PIXELS) return null;

  // Full-resolution samples per component, on the component's own grid.
  const planes = frame.components.map((c) => ({
    width: mcusX * c.h * 8,
    height: mcusY * c.v * 8,
    data: new Uint8Array(mcusX * c.h * 8 * mcusY * c.v * 8),
  }));
  const block = new Int32Array(64);
  const spatial = new Uint8Array(64);

  let position = scanStart;
  let bitBuffer = 0;
  let bitCount = 0;

  const nextBit = (): number => {
    if (bitCount === 0) {
      if (position >= bytes.length) throw new Error('eof');
      let byte = bytes[position++];
      if (byte === 0xff) {
        const next = bytes[position];
        if (next === 0x00) position += 1;
        else if (next >= 0xd0 && next <= 0xd7) { position += 1; byte = bytes[position++]; }
        else throw new Error('marker');
      }
      bitBuffer = byte;
      bitCount = 8;
    }
    bitCount -= 1;
    return (bitBuffer >> bitCount) & 1;
  };

  const decodeSymbol = (table: HuffTable): number => {
    let code = 0;
    for (let length = 1; length <= 16; length++) {
      code = (code << 1) | nextBit();
      const symbol = table.lookup.get((length << 16) | code);
      if (symbol !== undefined) return symbol;
    }
    throw new Error('huffman');
  };

  const receiveExtend = (size: number): number => {
    if (size === 0) return 0;
    let value = 0;
    for (let i = 0; i < size; i++) value = (value << 1) | nextBit();
    return value < (1 << (size - 1)) ? value - (1 << size) + 1 : value;
  };

  const predictions = new Int32Array(frame.components.length);
  let sinceRestart = 0;

  try {
    for (let my = 0; my < mcusY; my++) {
      for (let mx = 0; mx < mcusX; mx++) {
        if (restartInterval && sinceRestart === restartInterval) {
          // Byte-align, step over the RSTn marker, and reset the predictors.
          bitCount = 0;
          while (position + 1 < bytes.length
            && !(bytes[position] === 0xff && bytes[position + 1] >= 0xd0
              && bytes[position + 1] <= 0xd7)) position += 1;
          position += 2;
          predictions.fill(0);
          sinceRestart = 0;
        }
        sinceRestart += 1;

        for (let ci = 0; ci < frame.components.length; ci++) {
          const component = frame.components[ci];
          const plane = planes[ci];
          const quantiser = quantisers[component.quantiser];
          for (let by = 0; by < component.v; by++) {
            for (let bx = 0; bx < component.h; bx++) {
              block.fill(0);
              const size = decodeSymbol(dcTables[component.dcTable]);
              predictions[ci] += receiveExtend(size);
              block[0] = predictions[ci] * (quantiser ? quantiser[0] : 1);

              for (let k = 1; k < 64;) {
                const rs = decodeSymbol(acTables[component.acTable]);
                const run = rs >> 4;
                const magnitude = rs & 15;
                if (magnitude === 0) {
                  if (run !== 15) break;
                  k += 16;
                  continue;
                }
                k += run;
                if (k > 63) break;
                const position = ZIGZAG[k];
                block[position] = receiveExtend(magnitude)
                  * (quantiser ? quantiser[position] : 1);
                k += 1;
              }

              inverseDct(block, spatial);
              const originX = (mx * component.h + bx) * 8;
              const originY = (my * component.v + by) * 8;
              for (let row = 0; row < 8; row++) {
                plane.data.set(
                  spatial.subarray(row * 8, row * 8 + 8),
                  (originY + row) * plane.width + originX);
              }
            }
          }
        }
      }
    }
  } catch {
    // A truncated scan still measures on what it decoded, provided it got far
    // enough to be representative. Anything less is no measurement at all.
    if (mcusY < 2) return null;
  }

  const width = frame.width;
  const height = frame.height;
  if (width < 4 || height < 4) return null;

  /**
   * A component's own grid, read at image coordinates.
   *
   * Chroma is usually subsampled, so this is also the upsample — nearest
   * neighbour, which is all a measurement of large flat blocks needs.
   */
  const sample = (index: number, x: number, y: number): number => {
    const plane = planes[index];
    const component = frame!.components[index];
    const px = Math.min(plane.width - 1, Math.floor(x * component.h / maxH));
    const py = Math.min(plane.height - 1, Math.floor(y * component.v / maxV));
    return plane.data[py * plane.width + px];
  };

  const read = (x: number, y: number): [number, number, number] => {
    const Y = sample(0, x, y);
    if (planes.length < 3) { const g = clamp(Y); return [g, g, g]; }
    const cb = sample(1, x, y) - 128;
    const cr = sample(2, x, y) - 128;
    return [
      clamp(Y + 1.402 * cr),
      clamp(Y - 0.344136 * cb - 0.714136 * cr),
      clamp(Y + 1.772 * cb),
    ];
  };

  const thumb = box(width, height, read);
  return thumb && { ...thumb, sourceWidth: frame.width, sourceHeight: frame.height };
}

const clamp = (value: number) => value < 0 ? 0 : value > 255 ? 255 : value;

// ---------------------------------------------------------------------------
// Downscale
// ---------------------------------------------------------------------------

/**
 * Box-filter down to `TARGET_EDGE` on the long side.
 *
 * Averaging rather than sampling, so a one-pixel line cannot masquerade as a
 * flat region and a dithered gradient cannot masquerade as texture.
 */
function box(
  width: number,
  height: number,
  read: (x: number, y: number) => [number, number, number],
): Thumbnail | null {
  if (width < 4 || height < 4) return null;
  const scale = Math.max(1, Math.max(width, height) / TARGET_EDGE);
  const outW = Math.max(1, Math.floor(width / scale));
  const outH = Math.max(1, Math.floor(height / scale));
  const pixels = new Uint8Array(outW * outH * 3);

  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * height / outH);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / outH));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * width / outW);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / outW));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1 && sy < height; sy++) {
        for (let sx = x0; sx < x1 && sx < width; sx++) {
          const [pr, pg, pb] = read(sx, sy);
          r += pr; g += pg; b += pb; n += 1;
        }
      }
      const at = (y * outW + x) * 3;
      pixels[at] = Math.round(r / n);
      pixels[at + 1] = Math.round(g / n);
      pixels[at + 2] = Math.round(b / n);
    }
  }

  return { width: outW, height: outH, pixels, sourceWidth: width, sourceHeight: height };
}
