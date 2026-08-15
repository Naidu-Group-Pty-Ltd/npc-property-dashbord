/**
 * Builder stock lists — what a builder may upload, and how each kind is read.
 *
 * This is NOT a PDF pipeline with other formats bolted on. A stock list
 * arrives as whatever the builder's sales team keeps it in, and the four
 * shapes below cover what actually turns up: a spreadsheet, a delimited
 * export, a word-processed schedule, and a rendered document or photograph.
 *
 * The declared content type is a claim by the uploader. It is used to reject
 * early and cheaply; the DETECTED type (from the bytes, via
 * `_shared/immutableDocuments.ts`) is what decides how the file is read.
 */

/** 25 MB, matching MAX_BUILDER_DOCUMENT_BYTES and the bucket's own ceiling. */
export const MAX_STOCK_FILE_BYTES = 25 * 1024 * 1024;

export const STOCK_LIST_BUCKET = 'builder-stock-lists';
export const STOCK_IMAGE_BUCKET = 'builder-stock-images';
export const STOCK_LIST_STORAGE_PREFIX = 'stock-lists/';

/** How a file will be read. */
export type StockFileKind =
  | 'delimited'    // .csv .tsv .txt — parsed directly
  | 'spreadsheet'  // .xlsx .xlsm .xls — parsed directly, media extracted
  | 'word'         // .docx .doc — tables parsed directly, prose read by a model
  | 'pdf'          // text extracted, then read by a model
  | 'image'        // read by a model with vision
  | 'unsupported';

export interface StockFileClassification {
  kind: StockFileKind;
  extension: string;
  /** Present when kind is 'unsupported'. Safe to show the uploader. */
  reason?: string;
}

/**
 * Extensions we accept, grouped by how they are read. The browser's file
 * picker is generated from this list, so the two cannot drift.
 */
export const STOCK_EXTENSIONS: Record<Exclude<StockFileKind, 'unsupported'>, string[]> = {
  delimited: ['csv', 'tsv', 'txt'],
  spreadsheet: ['xlsx', 'xlsm', 'xls'],
  word: ['docx', 'doc'],
  pdf: ['pdf'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
};

/** Declared content types the upload endpoint will accept. Advisory only. */
export const STOCK_ALLOWED_DECLARED_MIME: ReadonlySet<string> = new Set([
  'text/csv', 'text/tab-separated-values', 'text/plain', 'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  // Browsers routinely send this for a file they cannot type. The bytes
  // decide, so refusing it here would reject valid spreadsheets.
  'application/octet-stream', '',
]);

export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Reject traversal, absolute paths and anything outside the stock prefix.
 * A storage path is caller-supplied, so it is treated as hostile.
 */
export function isAcceptableStockStoragePath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return false;
  if (path.length > 400) return false;
  return path.startsWith(STOCK_LIST_STORAGE_PREFIX);
}

/** A filename that is safe to put in an object path. */
export function safeObjectName(filename: string): string {
  const extension = extensionOf(filename);
  const stem = filename.replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${stem || 'stock-list'}${extension ? `.${extension}` : ''}`;
}

/**
 * Decide how to read the file.
 *
 * The detected MIME wins where it is decisive. Two cases it cannot settle,
 * both real:
 *   • legacy Office containers (`d0cf11e0…`) are one signature for .xls and
 *     .doc alike, so the extension breaks the tie;
 *   • a .tsv is plain text and indistinguishable from prose by signature.
 */
export function classifyStockFile(
  filename: string,
  detectedMime: string | null,
  detectionReason?: string,
): StockFileClassification {
  const extension = extensionOf(filename);

  if (detectedMime === 'application/pdf') return { kind: 'pdf', extension };
  if (detectedMime && detectedMime.startsWith('image/')) {
    if (detectedMime === 'image/tiff') {
      return { kind: 'unsupported', extension, reason: 'TIFF images cannot be read. Save the page as PNG, JPG or PDF.' };
    }
    return { kind: 'image', extension };
  }
  if (detectedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return { kind: 'spreadsheet', extension };
  }
  if (detectedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { kind: 'word', extension };
  }
  if (detectedMime === 'text/csv' || detectedMime === 'text/plain') {
    // A .txt that is really a stock list is delimited; anything else here is
    // prose and the delimited reader will simply find no header row, at which
    // point the model reads it as text.
    return { kind: 'delimited', extension };
  }

  if (detectionReason === 'ambiguous_legacy_office_container') {
    if (STOCK_EXTENSIONS.spreadsheet.includes(extension)) return { kind: 'spreadsheet', extension };
    if (STOCK_EXTENSIONS.word.includes(extension)) return { kind: 'word', extension };
    return {
      kind: 'unsupported', extension,
      reason: 'This looks like an old Office file we cannot identify. Save it as .xlsx, .docx or .pdf and upload again.',
    };
  }

  if (detectionReason === 'executable_signature') {
    return { kind: 'unsupported', extension, reason: 'That file is a program, not a document.' };
  }

  // Nothing in the bytes was decisive. Fall back to the extension rather than
  // refusing outright — a UTF-16 CSV, for instance, sniffs as binary.
  for (const [kind, extensions] of Object.entries(STOCK_EXTENSIONS)) {
    if (extensions.includes(extension)) return { kind: kind as StockFileKind, extension };
  }

  return {
    kind: 'unsupported', extension,
    reason: 'That file type cannot be read. Upload a spreadsheet, CSV, Word document, PDF or image.',
  };
}

/** The `accept` attribute for the upload control. Derived, never typed twice. */
export function stockFileAcceptAttribute(): string {
  return Object.values(STOCK_EXTENSIONS).flat().map((extension) => `.${extension}`).join(',');
}
