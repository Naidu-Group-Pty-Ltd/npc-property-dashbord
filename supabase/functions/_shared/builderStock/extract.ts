/**
 * Builder stock lists — reading the file.
 *
 * One entry point, `extractStockFile`, which turns whatever the builder
 * uploaded into at most three things:
 *
 *   rows          a keyed table, when the file HAS a table. Normalised
 *                 deterministically — no model is involved and nothing can be
 *                 invented.
 *   text          prose, when it does not. Read by a model afterwards, under a
 *                 schema, with the same "never invent" rule.
 *   media         imagery the file itself carried. Stage 1 of the three-stage
 *                 enrichment, and the only stage whose provenance is the
 *                 builder's own document.
 *
 * Every parser dependency is imported DYNAMICALLY inside its own branch. A
 * spreadsheet upload must not fail because the PDF library could not be
 * fetched, and this function runs in an edge worker where a cold import is a
 * real failure mode.
 */
import { keyRowsByHeader, parseDelimited } from './table.pure.ts';
import { readHtmlSource } from './htmlSource.pure.ts';
import { readOpenDocument, readPresentation, readRichText, readStructured } from './otherFormats.pure.ts';
import type { StockFileClassification } from './fileTypes.pure.ts';

export interface ExtractedMedia {
  /** Path inside the container, or the filename for a bare image. */
  name: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface StockExtraction {
  /** Recorded on the upload row so a support question has an answer. */
  strategy: string;
  rows: Array<Record<string, unknown>>;
  text: string | null;
  /** Images to show a vision model, base64 without the data: prefix. */
  visionImages: Array<{ base64: string; contentType: string }>;
  media: ExtractedMedia[];
  warnings: string[];
  /** A document/page title, when the format carries one. */
  title?: string | null;
}

const MAX_ROWS = 5000;
const MAX_TEXT_CHARS = 120_000;
const MAX_MEDIA = 40;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** UTF-8, falling back to UTF-16 when the bytes say so. */
function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function mediaContentType(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

/**
 * Pull `xl/media/*` or `word/media/*` out of an OOXML container.
 *
 * Anything that is not a raster image we can serve is skipped: an EMF chart or
 * a WMF logo would store a file the browser cannot render, which is worse than
 * having no stage-1 image.
 */
async function readContainerMedia(bytes: Uint8Array, prefix: string): Promise<ExtractedMedia[]> {
  // esm.sh types the module as the JSZip class itself, so the default export
  // has to be reached through the namespace rather than destructured.
  const zipModule = await import('https://esm.sh/jszip@3.10.1') as unknown as
    { default: { loadAsync(data: Uint8Array): Promise<any> } };
  const JSZip = zipModule.default;
  const zip = await JSZip.loadAsync(bytes);
  const media: ExtractedMedia[] = [];

  const names = Object.keys(zip.files)
    .filter((name) => name.startsWith(prefix) && !zip.files[name].dir)
    .sort();

  for (const name of names) {
    if (media.length >= MAX_MEDIA) break;
    const contentType = mediaContentType(name);
    if (!contentType) continue;
    const content: Uint8Array = await zip.files[name].async('uint8array');
    if (!content.length || content.length > MAX_MEDIA_BYTES) continue;
    media.push({ name, bytes: content, contentType });
  }
  return media;
}

/** The whole document text of a .docx, plus every table it contains. */
async function readDocx(bytes: Uint8Array): Promise<{ tables: string[][][]; text: string }> {
  // esm.sh types the module as the JSZip class itself, so the default export
  // has to be reached through the namespace rather than destructured.
  const zipModule = await import('https://esm.sh/jszip@3.10.1') as unknown as
    { default: { loadAsync(data: Uint8Array): Promise<any> } };
  const JSZip = zipModule.default;
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('word/document.xml');
  if (!entry) return { tables: [], text: '' };
  const xml: string = await entry.async('string');

  const cellText = (cellXml: string): string =>
    (cellXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
      .map((run) => run.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

  const tables: string[][][] = [];
  for (const tableXml of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []) {
    const matrix: string[][] = [];
    for (const rowXml of tableXml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || []) {
      const cells = (rowXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(cellText);
      if (cells.length) matrix.push(cells);
    }
    if (matrix.length > 1) tables.push(matrix);
  }

  // Paragraph text, one line per paragraph, so a schedule laid out as prose
  // still reads sensibly to a model.
  const paragraphs = (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [])
    .map(cellText)
    .filter((line) => line.length > 0);

  return { tables, text: paragraphs.join('\n') };
}

/**
 * Last resort for a legacy binary .doc: pull the printable runs out.
 *
 * Word 97 stores its text largely as readable UTF-16 in the WordDocument
 * stream, so this recovers a usable transcript from most of them. It is
 * explicitly a fallback and says so in `warnings` — the honest answer to an
 * unreadable one is to ask for a .docx.
 */
function readLegacyDocText(bytes: Uint8Array): string {
  const out: string[] = [];
  let run = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code === 13 || code === 10 || code === 7) {
      if (run.trim().length > 3) out.push(run.trim());
      run = '';
      continue;
    }
    if (code >= 32 && code < 0xd800) { run += String.fromCharCode(code); continue; }
    if (run.trim().length > 3) out.push(run.trim());
    run = '';
  }
  if (run.trim().length > 3) out.push(run.trim());
  return out.join('\n').slice(0, MAX_TEXT_CHARS);
}

export async function extractStockFile(
  bytes: Uint8Array,
  filename: string,
  classification: StockFileClassification,
): Promise<StockExtraction> {
  const result: StockExtraction = {
    strategy: classification.kind,
    rows: [],
    text: null,
    visionImages: [],
    media: [],
    warnings: [],
  };

  if (classification.kind === 'delimited') {
    const text = decodeText(bytes);
    const keyed = keyRowsByHeader(parseDelimited(text));
    if (keyed) {
      result.strategy = 'delimited_table';
      result.rows = keyed.rows.slice(0, MAX_ROWS);
    } else {
      result.strategy = 'delimited_text';
      result.text = text.slice(0, MAX_TEXT_CHARS);
      result.warnings.push('No column headings were recognised, so the file was read as text.');
    }
    return result;
  }

  if (classification.kind === 'spreadsheet') {
    const XLSX = await import('https://esm.sh/xlsx@0.18.5');
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    const sheetTexts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      if (result.rows.length >= MAX_ROWS) break;
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1, raw: false, defval: null, blankrows: false,
      }) as unknown[][];
      if (!matrix.length) continue;

      const keyed = keyRowsByHeader(matrix);
      if (keyed) {
        result.rows.push(...keyed.rows.slice(0, MAX_ROWS - result.rows.length));
      } else {
        sheetTexts.push(`# ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`);
      }
    }

    result.strategy = result.rows.length ? 'spreadsheet_table' : 'spreadsheet_text';
    if (!result.rows.length && sheetTexts.length) {
      result.text = sheetTexts.join('\n\n').slice(0, MAX_TEXT_CHARS);
      result.warnings.push('No column headings were recognised, so the sheets were read as text.');
    }

    // Embedded renders and facade photographs live here in a .xlsx. A legacy
    // .xls is not a zip and carries none we can reach.
    try {
      result.media = await readContainerMedia(bytes, 'xl/media/');
    } catch {
      result.warnings.push('Images inside the spreadsheet could not be read.');
    }
    return result;
  }

  if (classification.kind === 'word') {
    let handled = false;
    try {
      const { tables, text } = await readDocx(bytes);
      handled = true;
      for (const matrix of tables) {
        if (result.rows.length >= MAX_ROWS) break;
        const keyed = keyRowsByHeader(matrix);
        if (keyed) result.rows.push(...keyed.rows.slice(0, MAX_ROWS - result.rows.length));
      }
      result.strategy = result.rows.length ? 'word_table' : 'word_text';
      if (!result.rows.length && text) result.text = text.slice(0, MAX_TEXT_CHARS);
      try {
        result.media = await readContainerMedia(bytes, 'word/media/');
      } catch {
        result.warnings.push('Images inside the document could not be read.');
      }
    } catch {
      handled = false;
    }

    if (!handled) {
      const text = readLegacyDocText(bytes);
      result.strategy = 'legacy_word_text';
      result.text = text || null;
      result.warnings.push(
        'This is an older Word format, so only its text could be recovered. A .docx or PDF reads more reliably.',
      );
    }
    return result;
  }

  if (classification.kind === 'pdf') {
    result.strategy = 'pdf_text';
    try {
      const { extractText, getDocumentProxy } = await import('https://esm.sh/unpdf@0.12.1');
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join('\n') : String(text ?? '');
      result.text = merged.trim() ? merged.slice(0, MAX_TEXT_CHARS) : null;
    } catch (error) {
      result.warnings.push('The PDF text layer could not be read.');
      result.text = null;
      throw new StockExtractionError(
        'pdf_text_extraction_failed',
        'This PDF could not be read. If it is a scan, upload the spreadsheet it came from, or a clearer copy.',
        error,
      );
    }
    if (!result.text) {
      throw new StockExtractionError(
        'pdf_no_text_layer',
        'This PDF has no readable text — it looks like a scan. Upload the source spreadsheet or a text-based PDF.',
      );
    }
    // Extracting embedded raster images from a PDF is not attempted: an image
    // XObject cannot be tied to a stock row, and a decorative banner presented
    // as a property photograph is worse than no stage-1 image at all.
    result.warnings.push('Images inside a PDF are not extracted; location and search imagery are used instead.');
    return result;
  }

  if (classification.kind === 'opendocument') {
    // ODS and ODT are zip containers like .docx, read with the same JSZip and
    // the same table-then-prose order.
    const zipModule = await import('https://esm.sh/jszip@3.10.1') as unknown as
      { default: { loadAsync(data: Uint8Array): Promise<any> } };
    const zip = await zipModule.default.loadAsync(bytes);
    const entry = zip.file('content.xml');
    if (!entry) {
      throw new StockExtractionError(
        'opendocument_unreadable',
        'That OpenDocument file could not be read. Save it as XLSX, DOCX or PDF and try again.',
      );
    }
    const xml: string = await entry.async('string');
    const { tables, text } = readOpenDocument(xml);

    for (const matrix of tables) {
      if (result.rows.length >= MAX_ROWS) break;
      const keyed = keyRowsByHeader(matrix);
      if (keyed) result.rows.push(...keyed.rows.slice(0, MAX_ROWS - result.rows.length));
    }
    result.strategy = result.rows.length ? 'opendocument_table' : 'opendocument_text';
    if (!result.rows.length && text) result.text = text.slice(0, MAX_TEXT_CHARS);

    try {
      result.media = await readContainerMedia(bytes, 'Pictures/');
    } catch {
      result.warnings.push('Images inside the document could not be read.');
    }
    return result;
  }

  if (classification.kind === 'presentation') {
    const zipModule = await import('https://esm.sh/jszip@3.10.1') as unknown as
      { default: { loadAsync(data: Uint8Array): Promise<any> } };
    const zip = await zipModule.default.loadAsync(bytes);

    // Slides are numbered files; read them in order so a schedule split over
    // several slides stays in sequence.
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => (Number(/(\d+)/.exec(a)?.[1] ?? 0) - Number(/(\d+)/.exec(b)?.[1] ?? 0)));

    const slideXml: string[] = [];
    for (const name of slideNames) slideXml.push(await zip.files[name].async('string'));
    const { tables, text } = readPresentation(slideXml);

    for (const matrix of tables) {
      if (result.rows.length >= MAX_ROWS) break;
      const keyed = keyRowsByHeader(matrix);
      if (keyed) result.rows.push(...keyed.rows.slice(0, MAX_ROWS - result.rows.length));
    }
    result.strategy = result.rows.length ? 'presentation_table' : 'presentation_text';
    if (!result.rows.length && text) result.text = text.slice(0, MAX_TEXT_CHARS);

    try {
      result.media = await readContainerMedia(bytes, 'ppt/media/');
    } catch {
      result.warnings.push('Images inside the presentation could not be read.');
    }
    return result;
  }

  if (classification.kind === 'richtext') {
    const text = readRichText(decodeText(bytes));
    result.strategy = 'richtext_text';
    // An RTF table is a run of \cell control words rather than a grid, so the
    // deterministic reader is tried on the recovered lines first.
    const keyed = keyRowsByHeader(parseDelimited(text, '\t'));
    if (keyed) {
      result.strategy = 'richtext_table';
      result.rows = keyed.rows.slice(0, MAX_ROWS);
    } else {
      result.text = text.slice(0, MAX_TEXT_CHARS) || null;
    }
    if (!result.rows.length && !result.text) {
      throw new StockExtractionError(
        'richtext_empty', 'No readable text could be recovered from that RTF file.');
    }
    return result;
  }

  if (classification.kind === 'markup') {
    const html = decodeText(bytes);
    const { tables, text, title } = readHtmlSource(html, 'https://example.invalid/');
    for (const matrix of tables) {
      if (result.rows.length >= MAX_ROWS) break;
      const keyed = keyRowsByHeader(matrix);
      if (keyed) result.rows.push(...keyed.rows.slice(0, MAX_ROWS - result.rows.length));
    }
    result.strategy = result.rows.length ? 'html_table' : 'html_text';
    result.title = title;
    if (!result.rows.length && text) result.text = text.slice(0, MAX_TEXT_CHARS);
    if (!result.rows.length && !result.text) {
      throw new StockExtractionError(
        'html_empty', 'That page had no readable content.');
    }
    return result;
  }

  if (classification.kind === 'structured') {
    const raw = decodeText(bytes);
    const { rows, text } = readStructured(raw, classification.extension);
    if (rows.length) {
      result.strategy = 'structured_rows';
      result.rows = rows.slice(0, MAX_ROWS);
    } else {
      result.strategy = 'structured_text';
      result.text = text.slice(0, MAX_TEXT_CHARS) || null;
      if (!result.text) {
        throw new StockExtractionError(
          'structured_empty', 'That file contained no readable records.');
      }
    }
    return result;
  }

  if (classification.kind === 'image') {
    result.strategy = 'image_vision';
    const contentType = mediaContentType(filename) ?? 'image/jpeg';
    result.visionImages.push({ base64: bytesToBase64(bytes), contentType });
    // The uploaded photograph IS the document, so it is also stage-1 imagery.
    result.media.push({ name: filename, bytes, contentType });
    return result;
  }

  throw new StockExtractionError(
    'unsupported_file_type',
    classification.reason ?? 'That file type cannot be read.',
  );
}

/** An extraction failure with a message that is safe to show the uploader. */
export class StockExtractionError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  /** Not `cause`: that is a member of `Error` itself and overriding it here
   *  would need an `override` modifier the Deno check insists on. */
  readonly underlying?: unknown;
  constructor(code: string, safeMessage: string, underlying?: unknown) {
    super(`${code}: ${safeMessage}`);
    this.name = 'StockExtractionError';
    this.code = code;
    this.safeMessage = safeMessage;
    this.underlying = underlying;
  }
}
