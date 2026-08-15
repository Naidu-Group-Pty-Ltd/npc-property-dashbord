/**
 * Builder stock — finding the PROPERTY PHOTOGRAPH inside a builder's brochure.
 *
 * `extract.ts` refuses to take rasters out of a PDF, and it is right to: an
 * image XObject in an estate brochure cannot be tied to a stock row. This
 * module exists for the one case where the document itself IS the row — a
 * package PDF named for one lot and one house design, reached through that
 * row's own link.
 *
 * WHAT CHANGED, AND WHY. The first version took "the first JPEG on page one",
 * which is a statement about object order rather than about the document. A
 * brochure page holds a logo, a QR code, icons, a floorplan and a photograph,
 * and object order says nothing about which is which. This reads the page's
 * own CONTENT STREAM instead — the drawing instructions — so every candidate
 * is judged on where it is actually drawn and how big it actually appears:
 *
 *   • the photograph is the largest raster DRAWN on the page, by drawn area,
 *     not by object order, pixel count or position in the file;
 *   • it has to cover a real share of the page, so a logo, an icon, a QR code
 *     and a footer rule are excluded by measurement rather than by name;
 *   • it has to be a photographic encoding (DCT), which is what separates a
 *     render or a photograph from the line art a floorplan or a site plan is
 *     drawn as;
 *   • and it has to be on the page the document LEADS with, which is what
 *     keeps the estate masterplan on page 5 out of it.
 *
 * Anything unparseable yields NOTHING. An empty result means no image is
 * attached at all, which is a correct outcome; a wrong image is not.
 *
 * Pure: no imports, no IO, no clock. The one thing it cannot do is inflate a
 * compressed content stream — the caller does that and passes the text back in.
 */

/** A rectangle in PDF user space, y up from the bottom-left of the page. */
export interface Rect { x: number; y: number; width: number; height: number }

/** An image XObject the page's resources name. */
export interface PdfImage {
  /** The resource name the content stream draws it by (`/X13`). */
  name: string;
  objectNumber: number;
  width: number;
  height: number;
  /** Offsets of the raw stream data in the PDF bytes. */
  start: number;
  end: number;
  filters: string[];
  /** Component count implied by the colour space, when it is a plain one. */
  components: number | null;
  bitsPerComponent: number;
}

/** Where the content stream actually drew one of them. */
export interface PdfPlacement {
  name: string;
  /** The image's rectangle on the page, in points. */
  drawn: Rect;
  /** The clip in force when it was drawn, when the page set one. */
  clip: Rect | null;
  /** Order of appearance in the content stream. */
  index: number;
}

export interface PdfFirstPage {
  /** `/MediaBox`, normalised so width and height are positive. */
  width: number;
  height: number;
  images: PdfImage[];
  /** Content stream slices, in order. The caller inflates what needs it. */
  contents: Array<{ start: number; end: number; flate: boolean }>;
}

const decoder = new TextDecoder('latin1');

interface PdfObject { number: number; start: number; end: number; header: string }

/**
 * Every `N 0 obj … endobj`, as offsets plus a decoded header.
 *
 * Only the first 4 KB of each object is decoded: a dictionary is small and an
 * image stream is megabytes, and decoding those to text would cost more than
 * the rest of the import put together.
 */
export function indexPdfObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const text = decoder.decode(bytes);
  const objects = new Map<number, PdfObject>();
  const pattern = /(?:^|[^0-9])(\d{1,7})\s+(\d{1,5})\s+obj\b/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const number = Number(match[1]);
    const start = match.index + match[0].indexOf(match[1]);
    const endIndex = text.indexOf('endobj', start);
    const end = endIndex < 0 ? text.length : endIndex;
    objects.set(number, { number, start, end, header: text.slice(start, Math.min(start + 4096, end)) });
  }
  return objects;
}

function firstReference(fragment: string): number | null {
  const match = /(\d{1,7})\s+\d{1,5}\s+R/.exec(fragment);
  return match ? Number(match[1]) : null;
}

/**
 * The body of the `<< … >>` that begins at `from`, with nesting honoured.
 *
 * A lazy `<<([\s\S]*?)>>` stops at the first `>>` it meets, which in a real
 * page is the end of `/ExtGState << … >>` — so the `/XObject` entry two keys
 * later is never seen and the page appears to draw nothing. Depth counting is
 * the difference between reading a brochure and concluding it has no pictures.
 */
function balancedDictionary(text: string, from: number): string {
  const open = text.indexOf('<<', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < text.length - 1; i++) {
    if (text[i] === '<' && text[i + 1] === '<') { depth += 1; i += 1; continue; }
    if (text[i] === '>' && text[i + 1] === '>') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 2, i);
      i += 1;
    }
  }
  return '';
}

/** Resolve `/Key 12 0 R` or an inline `<< … >>` to a dictionary's text. */
function dictionaryFor(
  header: string,
  key: string,
  objects: Map<number, PdfObject>,
): string {
  const at = new RegExp(`/${key}\\b`).exec(header);
  if (!at) return '';

  const after = header.slice(at.index + at[0].length);
  const indirect = /^\s*(\d{1,7})\s+\d{1,5}\s+R/.exec(after);
  if (indirect) {
    const target = objects.get(Number(indirect[1]))?.header ?? '';
    return balancedDictionary(target, 0);
  }
  return balancedDictionary(header, at.index);
}

/**
 * The first page, by the catalogue's own page tree.
 *
 * Not the first `/Type /Page` object in the file: object order and page order
 * are different things, and a brochure whose pages were written out of order
 * would otherwise be read from the middle.
 */
function firstPageObject(objects: Map<number, PdfObject>): PdfObject | null {
  let node: PdfObject | null = null;
  for (const object of objects.values()) {
    if (!/\/Type\s*\/Catalog\b/.test(object.header)) continue;
    const pages = /\/Pages\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(object.header);
    if (pages) node = objects.get(Number(pages[1])) ?? null;
    break;
  }
  if (!node) {
    // A catalogue we could not follow: fall back to the lowest-numbered page
    // object, which is the best available statement of "first".
    const pages = [...objects.values()]
      .filter((object) => /\/Type\s*\/Page\b(?!s)/.test(object.header))
      .sort((a, b) => a.number - b.number);
    return pages[0] ?? null;
  }

  for (let depth = 0; depth < 16; depth++) {
    if (/\/Type\s*\/Page\b(?!s)/.test(node.header)) return node;
    const kids = /\/Kids\s*\[([\s\S]{0,4000}?)\]/.exec(node.header);
    if (!kids) return null;
    const first = firstReference(kids[1]);
    const next = first === null ? null : objects.get(first);
    if (!next) return null;
    node = next;
  }
  return null;
}

/** `/MediaBox [0 0 594.96 841.92]`, inherited from the page tree if absent. */
function mediaBoxOf(page: PdfObject, objects: Map<number, PdfObject>): Rect | null {
  let node: PdfObject | null = page;
  for (let depth = 0; depth < 8 && node; depth++) {
    const box = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(node.header);
    if (box) {
      const [x1, y1, x2, y2] = box.slice(1, 5).map(Number);
      return {
        x: Math.min(x1, x2), y: Math.min(y1, y2),
        width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
      };
    }
    const parent = /\/Parent\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(node.header);
    node = parent ? objects.get(Number(parent[1])) ?? null : null;
  }
  return null;
}

function streamSlice(
  object: PdfObject,
  bytes: Uint8Array,
): { start: number; end: number; flate: boolean } | null {
  const streamMatch = /stream\r?\n/.exec(object.header);
  if (!streamMatch) return null;
  const start = object.start + streamMatch.index + streamMatch[0].length;

  const window = Math.max(start, object.end - 64);
  const tail = decoder.decode(bytes.subarray(window, object.end));
  const endstream = tail.lastIndexOf('endstream');
  let end = endstream < 0 ? object.end : window + endstream;
  while (end > start && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end -= 1;
  if (end <= start) return null;

  return { start, end, flate: /\/FlateDecode\b/.test(object.header) };
}

const COMPONENTS_BY_COLOUR_SPACE: Record<string, number> = {
  DeviceRGB: 3, DeviceGray: 1, DeviceCMYK: 4, CalRGB: 3, CalGray: 1,
};

/**
 * The first page: its size, the images its resources name, and the content
 * streams that draw them.
 */
export function readFirstPage(bytes: Uint8Array): PdfFirstPage | null {
  if (bytes.length < 32) return null;

  let objects: Map<number, PdfObject>;
  try {
    objects = indexPdfObjects(bytes);
  } catch {
    return null;
  }

  const page = firstPageObject(objects);
  if (!page) return null;
  const box = mediaBoxOf(page, objects);
  if (!box || box.width <= 0 || box.height <= 0) return null;

  const resources = dictionaryFor(page.header, 'Resources', objects);
  const xobjects = dictionaryFor(resources || page.header, 'XObject', objects);

  const images: PdfImage[] = [];
  const pattern = /\/([^\s/<>[\]]+)\s+(\d{1,7})\s+\d{1,5}\s+R/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xobjects)) !== null) {
    const object = objects.get(Number(match[2]));
    if (!object || !/\/Subtype\s*\/Image\b/.test(object.header)) continue;

    const width = Number(/\/Width\s+(\d+)/.exec(object.header)?.[1] ?? 0);
    const height = Number(/\/Height\s+(\d+)/.exec(object.header)?.[1] ?? 0);
    if (!width || !height) continue;

    const slice = streamSlice(object, bytes);
    if (!slice) continue;

    /**
     * How many bytes a pixel is.
     *
     * Named colour spaces say so directly; an ICC profile says so through its
     * `/N`. Getting this wrong on a crop would shear the picture into stripes,
     * so an unresolvable colour space stays null and the caller refuses rather
     * than assuming.
     */
    let colourSpace = /\/ColorSpace\s*\/(\w+)/.exec(object.header)?.[1] ?? '';
    let components: number | null = COMPONENTS_BY_COLOUR_SPACE[colourSpace] ?? null;
    if (components === null) {
      // `/ColorSpace 5 0 R` → `[ /ICCBased 10 0 R ]` → `<< /N 3 … >>`. Two
      // hops, because that is how a real exporter writes it.
      let profile = '';
      const indirect = /\/ColorSpace\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(object.header);
      if (indirect) profile = objects.get(Number(indirect[1]))?.header ?? '';
      const icc = /\/ICCBased\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(profile);
      if (icc) profile = objects.get(Number(icc[1]))?.header ?? profile;

      const named = /\/(DeviceRGB|DeviceGray|DeviceCMYK|CalRGB|CalGray)\b/.exec(profile)?.[1] ?? '';
      const n = Number(/\/N\s+(\d)\b/.exec(profile)?.[1] ?? 0);
      if (n === 1 || n === 3 || n === 4) components = n;
      else if (named) { colourSpace = named; components = COMPONENTS_BY_COLOUR_SPACE[named]; }
    }

    images.push({
      name: match[1],
      objectNumber: object.number,
      width,
      height,
      start: slice.start,
      end: slice.end,
      filters: [...object.header.matchAll(/\/(DCTDecode|FlateDecode|JPXDecode|CCITTFaxDecode|LZWDecode|RunLengthDecode|ASCII85Decode)\b/g)]
        .map((entry) => entry[1]),
      components,
      bitsPerComponent: Number(/\/BitsPerComponent\s+(\d+)/.exec(object.header)?.[1] ?? 8),
    });
  }

  const contents: Array<{ start: number; end: number; flate: boolean }> = [];
  const contentsRef = /\/Contents\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(page.header);
  const contentsArray = /\/Contents\s*\[([\s\S]{0,2000}?)\]/.exec(page.header);
  const numbers: number[] = [];
  if (contentsRef) numbers.push(Number(contentsRef[1]));
  if (contentsArray) {
    for (const entry of contentsArray[1].matchAll(/(\d{1,7})\s+\d{1,5}\s+R/g)) {
      numbers.push(Number(entry[1]));
    }
  }
  for (const number of numbers) {
    const object = objects.get(number);
    const slice = object ? streamSlice(object, bytes) : null;
    if (slice) contents.push(slice);
  }

  return { width: box.width, height: box.height, images, contents };
}

// ---------------------------------------------------------------------------
// Where the page actually draws them
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

/** The unit square through a matrix, as an axis-aligned rectangle. */
function unitSquareRect(matrix: Matrix): Rect {
  const corners = [apply(matrix, 0, 0), apply(matrix, 1, 0), apply(matrix, 0, 1), apply(matrix, 1, 1)];
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Read the page's drawing instructions and report where each image landed.
 *
 * A minimal interpreter: the operand stack, `q`/`Q`, `cm`, `re … W n` for the
 * clip, and `Do`. Text, paths, shadings and colour are ignored — this is not a
 * renderer, it answers one question, which is how big each picture appears.
 */
export function parseImagePlacements(content: string): PdfPlacement[] {
  const placements: PdfPlacement[] = [];
  const stack: Array<{ ctm: Matrix; clip: Rect | null }> = [];
  let ctm: Matrix = IDENTITY;
  let clip: Rect | null = null;
  let operands: string[] = [];
  let pendingRect: Rect | null = null;

  // Strings and inline dictionaries are skipped so a `(Do)` inside a text run
  // cannot be read as an operator.
  const tokens = content.match(/\([^)]*\)|<[^>]*>|\/[^\s/<>[\]()]+|-?[\d.]+|[A-Za-z*'"]+/g) ?? [];

  for (const token of tokens) {
    if (/^-?[\d.]+$/.test(token)) { operands.push(token); continue; }
    if (token.startsWith('/') || token.startsWith('(') || token.startsWith('<')) {
      operands.push(token);
      continue;
    }

    switch (token) {
      case 'q':
        stack.push({ ctm, clip });
        break;
      case 'Q': {
        const previous = stack.pop();
        if (previous) { ctm = previous.ctm; clip = previous.clip; }
        break;
      }
      case 'cm': {
        const numbers = operands.slice(-6).map(Number);
        if (numbers.length === 6 && numbers.every(Number.isFinite)) {
          ctm = multiply(numbers as Matrix, ctm);
        }
        break;
      }
      case 're': {
        const numbers = operands.slice(-4).map(Number);
        if (numbers.length === 4 && numbers.every(Number.isFinite)) {
          const [x, y, width, height] = numbers;
          const corner = apply(ctm, x, y);
          const opposite = apply(ctm, x + width, y + height);
          pendingRect = {
            x: Math.min(corner[0], opposite[0]),
            y: Math.min(corner[1], opposite[1]),
            width: Math.abs(opposite[0] - corner[0]),
            height: Math.abs(opposite[1] - corner[1]),
          };
        }
        break;
      }
      case 'W':
      case 'W*':
        if (pendingRect) clip = pendingRect;
        break;
      case 'Do': {
        const name = operands[operands.length - 1];
        if (name && name.startsWith('/')) {
          placements.push({
            name: name.slice(1),
            drawn: unitSquareRect(ctm),
            clip,
            index: placements.length,
          });
        }
        break;
      }
      default:
        break;
    }
    operands = [];
  }
  return placements;
}

// ---------------------------------------------------------------------------
// Which of them is the property's photograph
// ---------------------------------------------------------------------------

/** Photographic encodings. A plan, a logo and a QR code are not drawn as JPEG. */
const PHOTOGRAPHIC_FILTERS = new Set(['DCTDecode', 'JPXDecode']);

/** A picture smaller than this on the page is a logo, an icon or a rule. */
const MIN_PAGE_AREA_SHARE = 0.06;
/** Below this it is not a photograph of a house whatever else it is. */
const MIN_PIXELS = { width: 600, height: 400 };
/** A banner or a spine, not a photograph. */
const MIN_ASPECT = 0.3;
const MAX_ASPECT = 4;

export interface PhotographChoice {
  image: PdfImage;
  placement: PdfPlacement;
  /** Share of the page the picture covers, for the provenance record. */
  pageAreaShare: number;
}

/**
 * The page's principal photograph, or nothing.
 *
 * Largest DRAWN area wins, which is what "the picture this page leads with"
 * means in a layout. Everything else is a floor: too small on the page, too
 * few pixels, too extreme a shape, or not a photographic encoding at all.
 */
export function selectPropertyPhotograph(
  page: PdfFirstPage,
  placements: PdfPlacement[],
): PhotographChoice | null {
  const byName = new Map(page.images.map((image) => [image.name, image]));
  const pageArea = page.width * page.height;
  if (pageArea <= 0) return null;

  let best: PhotographChoice | null = null;
  for (const placement of placements) {
    const image = byName.get(placement.name);
    if (!image) continue;
    if (!image.filters.some((filter) => PHOTOGRAPHIC_FILTERS.has(filter))) continue;
    if (image.width < MIN_PIXELS.width || image.height < MIN_PIXELS.height) continue;

    const aspect = image.width / image.height;
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) continue;

    const drawnArea = placement.drawn.width * placement.drawn.height;
    const share = drawnArea / pageArea;
    if (share < MIN_PAGE_AREA_SHARE) continue;

    if (!best || share > best.pageAreaShare) {
      best = { image, placement, pageAreaShare: share };
    }
  }
  return best;
}

/**
 * Is this page a single flattened raster rather than a composed layout?
 *
 * A brochure exported as page images draws one picture over the whole page and
 * nothing else that matters. Recognising that is what allows the photograph to
 * be looked for INSIDE the pixels — see `pdfFlattenedPhoto.pure.ts` — rather
 * than the whole page being served as if it were a photograph of a house.
 */
export function flattenedPageImage(
  page: PdfFirstPage,
  placements: PdfPlacement[],
): { image: PdfImage; placement: PdfPlacement } | null {
  const byName = new Map(page.images.map((image) => [image.name, image]));
  const pageArea = page.width * page.height;
  if (pageArea <= 0) return null;

  const covering = placements
    .map((placement) => ({ placement, image: byName.get(placement.name) }))
    .filter((entry): entry is { placement: PdfPlacement; image: PdfImage } => !!entry.image)
    .filter((entry) =>
      (entry.placement.drawn.width * entry.placement.drawn.height) / pageArea >= 0.9);

  if (covering.length !== 1) return null;
  const only = covering[0];
  // Raw pixels only: a flattened page we cannot decode without a JPEG decoder
  // is one we will not be cropping.
  if (only.image.filters.some((filter) => filter !== 'FlateDecode')) return null;
  if (only.image.bitsPerComponent !== 8) return null;
  return only;
}
