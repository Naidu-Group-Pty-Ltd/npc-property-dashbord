/**
 * Builder stock — the picture a property package LEADS with.
 *
 * `extract.ts` refuses to take rasters out of a PDF, and it is right to: an
 * image XObject in an estate brochure cannot be tied to a stock row. This
 * module exists for the one case where the document itself IS the row — a
 * package PDF named for one lot and one house design, reached through that
 * row's own link — and even there it takes one image and one only.
 *
 * WHY THE FIRST PAGE AND NOTHING ELSE. The live packages carry three JPEGs: a
 * facade render on page 1, that lot's own plan on page 4, and THE ESTATE
 * MASTERPLAN on page 5. Nothing in the file distinguishes the second from the
 * third — both are simply "a later page" — so a rule generous enough to keep
 * the lot plan also keeps a development-level drawing of fifty other lots, and
 * that is exactly the image this programme must never show as a property. The
 * first page is the document's own answer to "what is this?", so that is the
 * only page read.
 *
 * The page is found through the catalogue's own page tree, not by object
 * order: the first `/Type /Page` object in a file is not reliably page one.
 * Anything unparseable yields NOTHING — an empty result means the fallback
 * stages run, which is a correct outcome; a wrong image is not.
 *
 * Pure: no imports, no IO, no clock. Byte-level string work over the PDF,
 * the same shape `readDocx` uses over WordprocessingML.
 */

/** A JPEG image drawn on the page, with the slice of the file that holds it. */
export interface PdfImageSlice {
  width: number;
  height: number;
  /** Offsets into the PDF bytes, for the caller to cut out. */
  start: number;
  end: number;
  /** True when the JPEG is wrapped in a Flate stream and must be inflated. */
  flate: boolean;
}

/** A render smaller than this is a logo, a badge or an icon. */
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

const decoder = new TextDecoder('latin1');

interface PdfObject { number: number; start: number; end: number; header: string }

/**
 * Every `N 0 obj … endobj` in the file, as offsets plus a decoded header.
 *
 * Only the first 4 KB of each object is decoded: a dictionary is small and an
 * image stream is megabytes, and decoding those to text would cost more than
 * the whole import.
 */
function indexObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const text = decoder.decode(bytes);
  const objects = new Map<number, PdfObject>();
  const pattern = /(?:^|[^0-9])(\d{1,7})\s+(\d{1,5})\s+obj\b/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const number = Number(match[1]);
    const start = match.index + match[0].indexOf(match[1]);
    const end = text.indexOf('endobj', start);
    objects.set(number, {
      number,
      start,
      end: end < 0 ? text.length : end,
      header: text.slice(start, Math.min(start + 4096, end < 0 ? text.length : end)),
    });
  }
  return objects;
}

/** `13 0 R` → 13, for the first reference in a fragment. */
function firstReference(fragment: string): number | null {
  const match = /(\d{1,7})\s+\d{1,5}\s+R/.exec(fragment);
  return match ? Number(match[1]) : null;
}

/**
 * The first page of the document, by the catalogue's page tree.
 *
 * `/Root` → `/Pages` → the first `/Kids` entry, descending while that entry is
 * itself a `/Pages` node. Bounded, so a malformed or cyclic tree stops rather
 * than spinning.
 */
function firstPageObject(objects: Map<number, PdfObject>): PdfObject | null {
  let node: PdfObject | null = null;
  for (const object of objects.values()) {
    if (/\/Type\s*\/Catalog\b/.test(object.header)) {
      const pagesRef = /\/Pages\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(object.header);
      if (pagesRef) node = objects.get(Number(pagesRef[1])) ?? null;
      break;
    }
  }
  if (!node) return null;

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

/** The object numbers a page's resources name as XObjects, in dictionary order. */
function pageXObjectRefs(page: PdfObject, objects: Map<number, PdfObject>): number[] {
  let header = page.header;
  // `/Resources 14 0 R` — the dictionary lives in its own object.
  const indirect = /\/Resources\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(header);
  if (indirect) header = objects.get(Number(indirect[1]))?.header ?? header;

  const xobject = /\/XObject\s*<<([\s\S]{0,4000}?)>>/.exec(header);
  let body = xobject?.[1] ?? '';
  if (!body) {
    const xindirect = /\/XObject\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(header);
    if (xindirect) {
      const dictionary = objects.get(Number(xindirect[1]))?.header ?? '';
      body = /<<([\s\S]{0,4000}?)>>/.exec(dictionary)?.[1] ?? dictionary;
    }
  }
  if (!body) return [];

  const out: number[] = [];
  const pattern = /\/[^\s/]+\s+(\d{1,7})\s+\d{1,5}\s+R/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) out.push(Number(match[1]));
  return out;
}

/**
 * The JPEG images the document's FIRST PAGE draws, in the order it names them.
 *
 * Only `DCTDecode` — a JPEG, optionally wrapped in one Flate stream — is
 * returned. Everything else is refused rather than converted: the raw bitmaps
 * a flattened brochure carries are whole scanned pages, and a page of a
 * document is not a photograph of a house.
 */
export function firstPageJpegImages(bytes: Uint8Array): PdfImageSlice[] {
  if (bytes.length < 32) return [];
  let objects: Map<number, PdfObject>;
  try {
    objects = indexObjects(bytes);
  } catch {
    return [];
  }

  const page = firstPageObject(objects);
  if (!page) return [];

  const out: PdfImageSlice[] = [];
  for (const number of pageXObjectRefs(page, objects)) {
    const object = objects.get(number);
    if (!object) continue;
    const header = object.header;
    if (!/\/Subtype\s*\/Image\b/.test(header)) continue;

    const width = Number(/\/Width\s+(\d+)/.exec(header)?.[1] ?? 0);
    const height = Number(/\/Height\s+(\d+)/.exec(header)?.[1] ?? 0);
    if (width < MIN_WIDTH || height < MIN_HEIGHT) continue;

    const filters = [...header.matchAll(/\/(DCTDecode|FlateDecode|JPXDecode|CCITTFaxDecode|LZWDecode|RunLengthDecode)\b/g)]
      .map((entry) => entry[1]);
    if (!filters.includes('DCTDecode')) continue;
    // A JPEG behind anything but a single Flate wrapper is not something to
    // unpick; there is no such image in a package worth guessing at.
    const flate = filters[0] === 'FlateDecode';
    if (filters.some((filter) => filter !== 'DCTDecode' && filter !== 'FlateDecode')) continue;
    if (filters.filter((filter) => filter === 'FlateDecode').length > 1) continue;

    const streamMatch = /stream\r?\n/.exec(header);
    if (!streamMatch) continue;
    const start = object.start + streamMatch.index + streamMatch[0].length;

    const tail = decoder.decode(bytes.subarray(Math.max(start, object.end - 64), object.end));
    const endstream = tail.lastIndexOf('endstream');
    const end = endstream < 0
      ? object.end
      : Math.max(start, object.end - 64) + endstream;

    if (end <= start) continue;
    out.push({ width, height, start, end: trimEol(bytes, start, end), flate });
  }
  return out;
}

/** `endstream` is preceded by an EOL that is not part of the data. */
function trimEol(bytes: Uint8Array, start: number, end: number): number {
  let cursor = end;
  while (cursor > start && (bytes[cursor - 1] === 0x0a || bytes[cursor - 1] === 0x0d)) cursor -= 1;
  return cursor;
}
