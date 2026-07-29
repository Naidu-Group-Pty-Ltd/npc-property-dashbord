/**
 * Map a Docling `DoclingDocument` into the existing `RawImportBlock[]` IR,
 * grouped by page. The downstream reconciliation/plan builders already know
 * how to turn `RawImportBlock` into editor overlays — so this is the single
 * bridge between Docling's schema and our import pipeline.
 *
 * Coordinate convention: our overlays use top-left origin in PDF points.
 * Docling bboxes may be either TOPLEFT or BOTTOMLEFT — we normalise to
 * TOPLEFT using the page height when needed.
 *
 * Phase A enrichments:
 *   - Reading order is preserved from the Docling document iteration order
 *     (DocLayNet → reading-order model). Final per-page sort is by that
 *     index, not raw y/x, so 2-column layouts flow correctly.
 *   - Heading levels (`section_header` H1–H6) drive font size + meta.headingLevel.
 *   - Contiguous `list_item` runs are tagged with a shared `listGroupId`.
 *   - Tables expose the full cell grid via `meta.tableData` so downstream
 *     overlay builders can populate `TableOverlay.columns/rows` instead of
 *     just a preview string.
 */
import type {
  RawImportBlock,
  RawImportBlockSource,
  RawImportBlockType,
  ImportBBox,
} from '@/lib/reportTemplate/ingestion/reconciliation';
import { resolveSourceFontFamily, lookupEmbeddedFamily } from '../fontResolver';
import { deriveWeight } from '../fontFaceBuilder';
import type {
  DoclingBBox,
  DoclingDocument,
  DoclingPageInfo,
  DoclingPictureItem,
  DoclingProvenance,
  DoclingRef,
  DoclingTableCell,
  DoclingTableItem,
  DoclingTextItem,
  DoclingTextLabel,
  DoclingVectorItem,
} from './doclingTypes';

/** Resolve a Docling ref ($ref / cref / string) to the string self_ref form. */
function refToString(ref: DoclingRef | string | undefined): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'string') return ref;
  return ref.$ref ?? ref.cref;
}

/** Pick the top classifier label from either schema variant. */
function topPictureClass(picture: DoclingPictureItem): string | undefined {
  const c = picture.classification;
  if (!c) return undefined;
  if (c.predicted_class) return c.predicted_class;
  if (Array.isArray(c.predicted_classes) && c.predicted_classes.length) {
    const sorted = [...c.predicted_classes].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
    );
    return sorted[0]?.class_name;
  }
  return undefined;
}

/** First VLM description annotation, if present. */
function pictureAltText(picture: DoclingPictureItem): string | undefined {
  const ann = (picture.annotations ?? []).find(
    (a) => (a.kind ?? '').toLowerCase().includes('descr') && (a.text ?? '').trim().length > 0,
  );
  return ann?.text?.trim();
}

const DEFAULT_FONT_FAMILY = 'Helvetica';

function nearestDesignFont(family: string | undefined, label?: DoclingTextLabel): string {
  const f = (family ?? '').toLowerCase();
  if (label === 'code' || /mono|courier|consolas|menlo|source code/.test(f)) return 'Menlo, Consolas, monospace';
  if (/serif|times|georgia|garamond|playfair|cambria/.test(f)) return 'Georgia, "Times New Roman", serif';
  if (/inter|arial|helvetica|roboto|lato|open sans|source sans|calibri/.test(f)) return 'Inter, Arial, sans-serif';
  return label === 'title' || label === 'section_header' ? 'Inter, Arial, sans-serif' : DEFAULT_FONT_FAMILY;
}

function bboxToTopLeft(bbox: DoclingBBox, pageHeight: number): ImportBBox {
  const width = Math.max(0, bbox.r - bbox.l);
  const height = Math.max(0, bbox.t - bbox.b !== 0 ? Math.abs(bbox.t - bbox.b) : 0);
  if (bbox.coord_origin === 'BOTTOMLEFT') {
    const top = Math.max(0, pageHeight - Math.max(bbox.t, bbox.b));
    return { x: bbox.l, y: top, width, height };
  }
  const top = Math.min(bbox.t, bbox.b);
  return { x: bbox.l, y: top, width, height };
}

function pickProv(prov: DoclingProvenance[] | undefined, pageNo: number): DoclingProvenance | null {
  if (!prov || prov.length === 0) return null;
  const onPage = prov.find((p) => p.page_no === pageNo);
  return onPage ?? prov[0];
}

function labelToBlockType(label: DoclingTextLabel | undefined): RawImportBlockType {
  if (label === 'formula' || label === 'equation') return 'formula';
  if (label === 'code') return 'code';
  return 'text';
}

function labelDefaultWeight(label: DoclingTextLabel | undefined): 'bold' | 'normal' {
  if (label === 'title' || label === 'section_header' || label === 'page_header') return 'bold';
  return 'normal';
}

/**
 * Map heading depth → font size. Mirrors a typical doc rhythm (22/18/15/13/12/11).
 * For `title` we always use H1.
 */
function headingFontSize(level: number): number {
  const clamped = Math.max(1, Math.min(6, Math.round(level)));
  return [22, 18, 15, 13, 12, 11][clamped - 1];
}

function labelDefaultFontSize(label: DoclingTextLabel | undefined, level?: number): number {
  if (label === 'title') return headingFontSize(1);
  if (label === 'section_header') return headingFontSize(level ?? 2);
  switch (label) {
    case 'page_header':
    case 'page_footer':
    case 'caption':
    case 'footnote': return 9;
    default: return 11;
  }
}

function normaliseWeight(value: unknown): number | 'normal' | 'bold' | undefined {
  if (value === 'bold' || value === 'normal') return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n >= 600 ? 'bold' : 'normal';
  return undefined;
}

/**
 * Phase 6E — numeric weight from a font family / PostScript name (e.g.
 * "OpenSans-Light" → 300, "Inter-SemiBold" → 600). Used only when the text item
 * carries no explicit weight AND the name actually encodes one — `deriveWeight`
 * returns its 400 default for plain names, which we treat as "no signal" so a
 * heading's label-default weight is never clobbered.
 */
function weightFromFamilyName(family?: string): number | undefined {
  if (!family) return undefined;
  const w = deriveWeight(family, false);
  return w !== 400 ? w : undefined;
}

function blockId(prefix: string, pageNo: number, index: number): string {
  return `docling-${prefix}-p${pageNo}-${index.toString(36)}`;
}

/**
 * Docling emits `GLYPH<n>` placeholder tokens when a font has no usable
 * ToUnicode map (each unmapped glyph becomes an 8+ char token interleaved with
 * the recoverable characters). Left in place they balloon the text to many
 * times its true width, wrap across everything below, and read as garbage —
 * strip the tokens, keep the recoverable characters, and flag the block so it
 * is confidence-capped (locked in hybrid) and surfaced as a page warning.
 */
const GLYPH_ARTIFACT = /GLYPH<[^>]{0,16}>/g;

function sanitizeExtractedText(raw: string | undefined): { text: string | undefined; hadGlyphArtifacts: boolean } {
  if (!raw || !raw.includes('GLYPH<')) return { text: raw, hadGlyphArtifacts: false };
  const stripped = raw
    .replace(GLYPH_ARTIFACT, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { text: stripped, hadGlyphArtifacts: true };
}

/** Confidence ceiling for blocks whose text carried GLYPH extraction artifacts. */
const GLYPH_ARTIFACT_MAX_CONFIDENCE = 0.5;

interface MapOptions {
  defaultConfidence?: number;
  source?: RawImportBlockSource;
  /** Phase 3: source-font-name → embedded `@font-face` family (for full fonts). */
  embeddedFontFamilies?: Record<string, string>;
}

function textItemToBlock(
  item: DoclingTextItem,
  pageInfo: DoclingPageInfo,
  index: number,
  readingOrder: number,
  listGroupId: string | undefined,
  opts: MapOptions,
): RawImportBlock | null {
  const prov = pickProv(item.prov, pageInfo.page_no);
  if (!prov) return null;
  const bbox = bboxToTopLeft(prov.bbox, pageInfo.size.height);
  if (bbox.width <= 0 || bbox.height <= 0) return null;
  const headingLevel = item.label === 'title'
    ? 1
    : item.label === 'section_header'
      ? Math.max(1, Math.min(6, Math.round(item.level ?? 2)))
      : undefined;
  const fontSize = item.font?.size ?? labelDefaultFontSize(item.label, headingLevel);
  const fontWeight = normaliseWeight(item.font?.weight)
    ?? weightFromFamilyName(item.font?.family)
    ?? labelDefaultWeight(item.label);
  const fontStyle = item.font?.italic ? 'italic' : 'normal';
  // Phase B: tag page furniture so the plan builder can route it to a master page.
  const pageRegion: 'header' | 'footer' | undefined =
    item.label === 'page_header' ? 'header'
    : item.label === 'page_footer' ? 'footer'
    : undefined;
  const masterGroupId = pageRegion
    ? `docling-master-${pageRegion}-p${pageInfo.page_no}`
    : undefined;
  const blockType = labelToBlockType(item.label);
  // Phase D: prefer LaTeX when this is a formula; preserve raw text otherwise.
  const latex = item.latex ?? item.equation;
  const codeLanguage = item.code_language;
  const sanitized = sanitizeExtractedText(item.text);
  const displayText = blockType === 'formula' && latex ? latex : sanitized.text;
  // Nothing recoverable after stripping GLYPH artifacts → no overlay at all
  // (hybrid keeps the raster reference; semantic drops the garbage cleanly).
  if (!displayText || !displayText.trim()) return null;
  // Phase D: capture explicit cross-reference if exactly one ref present.
  const refList = (item.refs ?? []).map((r) => (typeof r === 'string' ? r : (r.$ref ?? r.cref))).filter(Boolean) as string[];
  const xref = refList.length === 1 ? refList[0] : undefined;
  // Phase 3: preserve the source font family (→ Google Fonts via the catalog)
  // instead of bucketing into the tiny design catalog; fall back to the
  // label-aware design font only when the source font isn't catalog-known.
  const sourceFont = item.font?.family;
  const fontResolution = sourceFont ? resolveSourceFontFamily(sourceFont) : undefined;
  // Phase 3: prefer an embedded (full, non-subset) program when available; else
  // the catalog/web-font match; else the label-aware design fallback.
  const embeddedFamily = sourceFont
    ? lookupEmbeddedFamily(sourceFont, opts.embeddedFontFamilies)
    : undefined;
  const fontFamily = embeddedFamily
    ? `"${embeddedFamily}", ${fontResolution?.family ?? nearestDesignFont(sourceFont, item.label)}`
    : fontResolution && !fontResolution.substituted
      ? fontResolution.family
      : nearestDesignFont(sourceFont, item.label);
  return {
    id: blockId(String(item.label ?? 'text'), pageInfo.page_no, index),
    type: blockType,
    text: displayText,
    bbox,
    style: {
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      color: item.font?.color ?? '#111111',
      // Phase 2: prefer real alignment/leading/tracking from the PyMuPDF pass.
      textAlign: item.text_align ?? 'left',
      ...(typeof item.font?.line_height === 'number' ? { lineHeight: item.font.line_height } : {}),
      ...(typeof item.font?.letter_spacing === 'number' ? { letterSpacing: item.font.letter_spacing } : {}),
    },
    confidence: Math.min(
      typeof item.confidence === 'number' ? item.confidence : opts.defaultConfidence ?? 0.85,
      sanitized.hadGlyphArtifacts ? GLYPH_ARTIFACT_MAX_CONFIDENCE : 1,
    ),
    source: opts.source ?? 'pdf-text',
    meta: {
      label: item.label,
      ...(sanitized.hadGlyphArtifacts ? { glyphArtifacts: true } : {}),
      headingLevel,
      listGroupId,
      readingOrder,
      pageRegion,
      groupId: masterGroupId,
      latex,
      codeLanguage,
      language: item.language,
      xref,
      ...(sourceFont ? { sourceFont } : {}),
      ...(!embeddedFamily && fontResolution?.substituted ? { fontSubstituted: true } : {}),
    },
  };
}

type DoclingMappedTableCell = {
  text: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  columnHeader?: boolean;
  rowHeader?: boolean;
};

// Docling output is derived from uploaded PDFs, so table dimensions and cell
// coordinates must be treated as untrusted input. Keep enough cells for useful
// editing while preventing a malformed document from forcing a huge dense grid.
const MAX_TABLE_ROWS = 1_000;
const MAX_TABLE_COLS = 100;
const MAX_TABLE_CELLS = 10_000;

function boundedTableDimension(value: unknown, maximum: number): number {
  const dimension = Number(value);
  if (!Number.isFinite(dimension) || dimension <= 0) return 0;
  return Math.min(Math.floor(dimension), maximum);
}

function boundedCellOffset(value: unknown, fallback: number, maximum: number): number {
  const offset = Number(value);
  if (!Number.isFinite(offset)) return fallback;
  return Math.max(0, Math.min(Math.floor(offset), maximum));
}

/** Build a dense row-major string grid from Docling's sparse `table_cells`. */
function buildTableGrid(item: DoclingTableItem): {
  rows: string[][];
  cells: DoclingMappedTableCell[];
  headerRows: number;
  numRows: number;
  numCols: number;
  hadGlyphArtifacts: boolean;
} {
  let hadGlyphArtifacts = false;
  const numRows = boundedTableDimension(item.data?.num_rows, MAX_TABLE_ROWS);
  const requestedCols = boundedTableDimension(item.data?.num_cols, MAX_TABLE_COLS);
  const numCols = numRows > 0
    ? Math.min(requestedCols, Math.floor(MAX_TABLE_CELLS / numRows))
    : requestedCols;
  const grid: string[][] = Array.from({ length: numRows }, () => Array<string>(numCols).fill(''));
  const cells: DoclingTableCell[] = item.data?.table_cells?.slice(0, MAX_TABLE_CELLS)
    ?? (item.data?.grid
      ? item.data.grid.slice(0, numRows).flatMap((row) => row.slice(0, numCols))
      : []);
  const structuralCells: DoclingMappedTableCell[] = [];

  for (const [idx, cell] of cells.entries()) {
    const hasExplicitPosition = cell.start_row_offset_idx !== undefined || cell.start_col_offset_idx !== undefined;
    const inferredRow = numCols > 0 ? Math.floor(idx / numCols) : 0;
    const inferredCol = numCols > 0 ? idx % numCols : 0;
    const r0 = boundedCellOffset(
      cell.start_row_offset_idx,
      hasExplicitPosition ? 0 : inferredRow,
      Math.max(0, numRows - 1),
    );
    const c0 = boundedCellOffset(
      cell.start_col_offset_idx,
      hasExplicitPosition ? 0 : inferredCol,
      Math.max(0, numCols - 1),
    );
    const r1 = boundedCellOffset(
      cell.end_row_offset_idx,
      r0 + boundedCellOffset(cell.row_span, 1, numRows),
      numRows,
    );
    const c1 = boundedCellOffset(
      cell.end_col_offset_idx,
      c0 + boundedCellOffset(cell.col_span, 1, numCols),
      numCols,
    );
    const cellSanitized = sanitizeExtractedText(cell.text ?? '');
    if (cellSanitized.hadGlyphArtifacts) hadGlyphArtifacts = true;
    const text = (cellSanitized.text ?? '').trim();
    structuralCells.push({
      text,
      row: r0,
      col: c0,
      rowSpan: Math.max(1, r1 - r0),
      colSpan: Math.max(1, c1 - c0),
      ...(cell.column_header ? { columnHeader: true } : {}),
      ...(cell.row_header ? { rowHeader: true } : {}),
    });
    for (let r = r0; r < r1 && r < numRows; r += 1) {
      for (let c = c0; c < c1 && c < numCols; c += 1) {
        // Only the anchor cell gets the text; merged spans leave duplicates blank
        // so downstream renderers can detect spans if they care.
        if (r === r0 && c === c0) grid[r][c] = text;
      }
    }
  }

  // Header row count = max(column_header rows) — count contiguous rows from top
  // where every populated cell is flagged column_header.
  let headerRows = 0;
  if (cells.length) {
    const headerRowSet = new Set<number>();
    for (const cell of cells) {
      if (cell.column_header) headerRowSet.add(cell.start_row_offset_idx ?? 0);
    }
    if (headerRowSet.size) {
      // Take contiguous header rows starting at 0.
      for (let r = 0; r < numRows; r += 1) {
        if (headerRowSet.has(r)) headerRows = r + 1;
        else break;
      }
    }
  }

  return { rows: grid, cells: structuralCells, headerRows, numRows, numCols, hadGlyphArtifacts };
}

function tableItemToBlock(
  item: DoclingTableItem,
  pageInfo: DoclingPageInfo,
  index: number,
  readingOrder: number,
  captionGroupId: string | undefined,
  opts: MapOptions,
): RawImportBlock | null {
  const prov = pickProv(item.prov, pageInfo.page_no);
  if (!prov) return null;
  const bbox = bboxToTopLeft(prov.bbox, pageInfo.size.height);
  if (bbox.width <= 0 || bbox.height <= 0) return null;
  const { hadGlyphArtifacts, ...tableData } = buildTableGrid(item);
  const previewCells: string[] = [];
  for (const row of tableData.rows) {
    for (const cell of row) {
      if (cell) previewCells.push(cell);
      if (previewCells.length === 12) break;
    }
    if (previewCells.length === 12) break;
  }
  const preview = previewCells.join(' · ');
  return {
    id: blockId('table', pageInfo.page_no, index),
    type: 'table',
    text: preview || '[table]',
    bbox,
    style: {
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: 9,
      fontWeight: 'normal',
      color: '#111111',
    },
    confidence: Math.min(
      typeof item.confidence === 'number' ? item.confidence : opts.defaultConfidence ?? 0.7,
      hadGlyphArtifacts ? GLYPH_ARTIFACT_MAX_CONFIDENCE : 1,
    ),
    source: opts.source ?? 'pdf-text',
    meta: {
      label: 'table',
      readingOrder,
      tableData,
      caption: item.caption,
      groupId: captionGroupId,
      ...(hadGlyphArtifacts ? { glyphArtifacts: true } : {}),
    },
  };
}

function pictureItemToBlock(
  item: DoclingPictureItem,
  pageInfo: DoclingPageInfo,
  index: number,
  readingOrder: number,
  captionGroupId: string | undefined,
  opts: MapOptions,
): RawImportBlock | null {
  const prov = pickProv(item.prov, pageInfo.page_no);
  if (!prov) return null;
  const bbox = bboxToTopLeft(prov.bbox, pageInfo.size.height);
  if (bbox.width <= 0 || bbox.height <= 0) return null;
  const altText = pictureAltText(item);
  const pictureClass = topPictureClass(item);
  const imageUri = item.image?.uri;
  const imageDiagnosticsPath = item.image?.diagnostics_path;
  const displayText = altText || item.caption || (pictureClass ? `[${pictureClass}]` : '[image]');
  return {
    id: blockId('picture', pageInfo.page_no, index),
    type: 'image',
    text: displayText,
    bbox,
    style: { backgroundColor: '#00000000' },
    confidence: typeof item.confidence === 'number' ? item.confidence : opts.defaultConfidence ?? 0.6,
    source: opts.source ?? 'pdf-text',
    meta: {
      label: 'picture',
      readingOrder,
      caption: item.caption,
      altText,
      pictureClass,
      groupId: captionGroupId,
      imageUri,
      imageDiagnosticsPath,
    },
  };
}

function vectorItemToBlock(
  item: DoclingVectorItem,
  pageInfo: DoclingPageInfo,
  index: number,
  readingOrder: number,
  opts: MapOptions,
): RawImportBlock | null {
  const prov = pickProv(item.prov, pageInfo.page_no);
  if (!prov) return null;
  const bbox = bboxToTopLeft(prov.bbox, pageInfo.size.height);
  if (bbox.width <= 0 || bbox.height <= 0) return null;
  const paths = (item.paths ?? []).filter((p) => typeof p?.d === 'string' && p.d.trim().length > 0);
  if (!paths.length) return null;
  // viewBox defaults to the item bbox so the SVG paths (page-point coords) align
  // with the overlay box; the sidecar normally supplies an explicit page viewBox.
  const viewBox = item.viewBox ?? `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`;
  return {
    id: blockId('vector', pageInfo.page_no, index),
    type: 'vector',
    bbox,
    // Geometry is exact, so vectors are high-confidence (stay editable in hybrid).
    confidence: typeof item.confidence === 'number' ? item.confidence : opts.defaultConfidence ?? 0.9,
    source: opts.source ?? 'detected',
    meta: {
      label: 'vector',
      readingOrder,
      vector: { viewBox, paths },
    },
  };
}

export interface MappedDoclingBlocks {
  byPage: Record<number, RawImportBlock[]>;
  all: RawImportBlock[];
  pages: DoclingPageInfo[];
  /** Phase D: document outline / TOC. */
  outline: Array<{ title: string; level: number; page_no?: number | null }>;
}

export function mapDoclingToRawBlocks(
  doc: DoclingDocument,
  opts: MapOptions = {},
): MappedDoclingBlocks {
  const pages = Object.values(doc.pages ?? {}).sort((a, b) => a.page_no - b.page_no);
  const byPage: Record<number, RawImportBlock[]> = {};
  const orderCounters: Record<number, number> = {};
  for (const page of pages) {
    byPage[page.page_no] = [];
    orderCounters[page.page_no] = 0;
  }

  const nextOrder = (pageNo: number): number => {
    const n = orderCounters[pageNo] ?? 0;
    orderCounters[pageNo] = n + 1;
    return n;
  };

  // --- Text items: iterate in document order so reading order is preserved.
  // Contiguous list_item runs share a listGroupId.
  // Phase B: track text blocks by self_ref so figures/tables can link captions.
  const textBlocksBySelfRef = new Map<string, RawImportBlock>();
  /** Per-page caption pool keyed for proximity fallback. */
  const captionPool: Record<number, Array<{ block: RawImportBlock; text: DoclingTextItem }>> = {};
  let textIdx = 0;
  let activeListPage: number | null = null;
  let activeListId: string | null = null;
  let listSeq = 0;
  for (const text of doc.texts ?? []) {
    const prov = pickProv(text.prov, text.prov?.[0]?.page_no ?? 0);
    if (!prov) { textIdx += 1; continue; }
    const page = pages.find((p) => p.page_no === prov.page_no);
    if (!page) { textIdx += 1; continue; }

    let listGroupId: string | undefined;
    if (text.label === 'list_item') {
      if (activeListPage !== page.page_no || !activeListId) {
        listSeq += 1;
        activeListId = `docling-list-p${page.page_no}-${listSeq}`;
        activeListPage = page.page_no;
      }
      listGroupId = activeListId;
    } else {
      activeListPage = null;
      activeListId = null;
    }

    const order = typeof text.reading_order === 'number' ? text.reading_order : nextOrder(page.page_no);
    const block = textItemToBlock(text, page, textIdx, order, listGroupId, opts);
    if (block) {
      byPage[page.page_no]?.push(block);
      if (text.self_ref) textBlocksBySelfRef.set(text.self_ref, block);
      if (text.label === 'caption') {
        (captionPool[page.page_no] ??= []).push({ block, text });
      }
    }
    textIdx += 1;
  }

  /** Resolve a figure's caption refs (or fall back to the nearest caption-labeled text). */
  const PROXIMITY_PT = 36;
  let captionGroupSeq = 0;
  function pairCaption(
    refs: Array<DoclingRef | string> | undefined,
    pageNo: number,
    figureBBox: ImportBBox,
  ): string | undefined {
    // 1) explicit refs from the parser
    const explicit: RawImportBlock[] = [];
    for (const ref of refs ?? []) {
      const key = refToString(ref);
      if (!key) continue;
      const t = textBlocksBySelfRef.get(key);
      if (t && t.meta?.label === 'caption') explicit.push(t);
    }
    if (explicit.length) {
      captionGroupSeq += 1;
      const gid = `docling-figure-p${pageNo}-${captionGroupSeq}`;
      for (const t of explicit) {
        t.meta = { ...(t.meta ?? {}), groupId: gid };
      }
      return gid;
    }
    // 2) proximity fallback — nearest caption above/below within PROXIMITY_PT
    const pool = captionPool[pageNo] ?? [];
    let best: { block: RawImportBlock; dist: number } | null = null;
    for (const entry of pool) {
      if (entry.block.meta?.groupId) continue; // already paired
      const cy = entry.block.bbox.y + entry.block.bbox.height / 2;
      const fyTop = figureBBox.y;
      const fyBot = figureBBox.y + figureBBox.height;
      const dist = cy < fyTop ? fyTop - cy : cy > fyBot ? cy - fyBot : 0;
      if (dist <= PROXIMITY_PT && (!best || dist < best.dist)) {
        best = { block: entry.block, dist };
      }
    }
    if (best) {
      captionGroupSeq += 1;
      const gid = `docling-figure-p${pageNo}-${captionGroupSeq}`;
      best.block.meta = { ...(best.block.meta ?? {}), groupId: gid };
      return gid;
    }
    return undefined;
  }

  // --- Tables (preserve their relative document order on each page).
  let tableIdx = 0;
  for (const table of doc.tables ?? []) {
    const prov = pickProv(table.prov, table.prov?.[0]?.page_no ?? 0);
    if (!prov) { tableIdx += 1; continue; }
    const page = pages.find((p) => p.page_no === prov.page_no);
    if (!page) { tableIdx += 1; continue; }
    const order = typeof table.reading_order === 'number' ? table.reading_order : nextOrder(page.page_no);
    const figureBBox = bboxToTopLeft(prov.bbox, page.size.height);
    const captionGid = pairCaption(table.captions, page.page_no, figureBBox);
    const block = tableItemToBlock(table, page, tableIdx, order, captionGid, opts);
    if (block) byPage[page.page_no]?.push(block);
    tableIdx += 1;
  }

  // --- Pictures.
  let pictureIdx = 0;
  for (const picture of doc.pictures ?? []) {
    const prov = pickProv(picture.prov, picture.prov?.[0]?.page_no ?? 0);
    if (!prov) { pictureIdx += 1; continue; }
    const page = pages.find((p) => p.page_no === prov.page_no);
    if (!page) { pictureIdx += 1; continue; }
    const order = typeof picture.reading_order === 'number' ? picture.reading_order : nextOrder(page.page_no);
    const figureBBox = bboxToTopLeft(prov.bbox, page.size.height);
    const captionGid = pairCaption(picture.captions, page.page_no, figureBBox);
    const block = pictureItemToBlock(picture, page, pictureIdx, order, captionGid, opts);
    if (block) byPage[page.page_no]?.push(block);
    pictureIdx += 1;
  }

  // --- Vectors (Phase 2): geometry primitives from the PyMuPDF pass.
  let vectorIdx = 0;
  for (const vector of doc.vectors ?? []) {
    const prov = pickProv(vector.prov, vector.prov?.[0]?.page_no ?? 0);
    if (!prov) { vectorIdx += 1; continue; }
    const page = pages.find((p) => p.page_no === prov.page_no);
    if (!page) { vectorIdx += 1; continue; }
    const order = nextOrder(page.page_no);
    const block = vectorItemToBlock(vector, page, vectorIdx, order, opts);
    if (block) byPage[page.page_no]?.push(block);
    vectorIdx += 1;
  }

  // Final sort: reading order first (Docling document order), then y/x as a
  // deterministic tiebreaker for blocks without a meta index.
  for (const pageNo of Object.keys(byPage)) {
    byPage[Number(pageNo)].sort((a, b) => {
      const ao = a.meta?.readingOrder ?? Number.POSITIVE_INFINITY;
      const bo = b.meta?.readingOrder ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x);
    });
  }

  const all = Object.values(byPage).flat();
  // Phase D: surface document outline (TOC). Prefer sidecar-provided `doc.outline`,
  // fall back to deriving from title/section_header text items.
  const outline: MappedDoclingBlocks['outline'] = Array.isArray(doc.outline) && doc.outline.length
    ? doc.outline.map((n) => ({ title: n.title ?? '', level: n.level ?? 1, page_no: n.page_no ?? null }))
    : (doc.texts ?? [])
        .filter((t) => t.label === 'title' || t.label === 'section_header')
        .map((t) => ({
          title: t.text ?? '',
          level: t.label === 'title' ? 1 : Math.max(1, Math.min(6, Math.round(t.level ?? 2))),
          page_no: t.prov?.[0]?.page_no ?? null,
        }));
  return { byPage, all, pages, outline };
}
