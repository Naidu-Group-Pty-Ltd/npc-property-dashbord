/**
 * Convert mapped Docling blocks → TemplateImportPagePlan[] (the contract the
 * existing reconciliation/plan validators already consume).
 *
 * Mode policy (matches the implementation plan):
 *   - 'semantic'      → no raster background; all overlays editable.
 *   - 'hybrid'        → raster page background + editable overlays for items
 *                       with confidence ≥ 0.7; lower-confidence items locked.
 *   - 'pixel-perfect' → raster background + ALL overlays locked.
 */
import type { Overlay } from '@/lib/reportTemplate/templateSchema';
import { DEFAULT_IMPORT_FONT_STACK } from '@/lib/reportTemplate/rendering/fontNormalization';

type TextOverlay = Extract<Overlay, { type: 'text' }>;
type ImageOverlay = Extract<Overlay, { type: 'image' }>;
type TableOverlay = Extract<Overlay, { type: 'table' }>;
type VectorOverlay = Extract<Overlay, { type: 'vector' }>;
import type {
  ImportWarning,
  RawImportBlock,
  TemplateImportPagePlan,
  TemplateImportPlan,
} from '@/lib/reportTemplate/ingestion/reconciliation';
import type { DoclingDocument, DoclingPageInfo, DoclingRasterByPage } from './doclingTypes';
import { mapDoclingToRawBlocks } from './mapDoclingToRawBlocks';
import { deriveNativeHeaderPolicy, TABLE_PRESERVATION_VERSION } from '../tableArbitration.pure';

export type DoclingPlanMode = 'semantic' | 'hybrid' | 'pixel-perfect';

export interface DoclingPlanOptions {
  importId: string;
  mode: DoclingPlanMode;
  /** Per-page raster URLs (when /raster ran upstream). */
  rastersByPage?: DoclingRasterByPage;
  /** Engine version recorded in importSummary. */
  engineVersion?: string;
  /** Confidence cutoff for hybrid lock policy. */
  lockBelowConfidence?: number;
  /** Phase 3: source-font-name → embedded `@font-face` family (for full fonts). */
  embeddedFontFamilies?: Record<string, string>;
}

// Phase 4: lowered 0.7 → 0.6 now that reconstruction (vectors/typography/fonts) is
// faithful — default-confidence pictures (0.6) and medium-confidence text become
// editable in hybrid instead of locked. Locking only gates editing; the overlay
// still renders identically either way.
const DEFAULT_LOCK_THRESHOLD = 0.6;

function pageId(pageNo: number): string {
  return `docling-page-${pageNo}`;
}

function overlayId(block: RawImportBlock, suffix = 'ov'): string {
  return `${block.id}-${suffix}`;
}

function blockToOverlay(block: RawImportBlock, locked: boolean): Overlay | null {
  // Phase B: prefer alt-text / caption for the human-readable layer label.
  const layerName = block.meta?.altText
    ?? block.meta?.caption
    ?? (block.text ? block.text.slice(0, 64) : block.type);
  const base = {
    id: overlayId(block),
    x: block.bbox.x,
    y: block.bbox.y,
    width: block.bbox.width,
    height: block.bbox.height,
    rotation: 0,
    opacity: 1,
    confidence: block.confidence,
    locked,
    name: layerName,
    ...(block.meta?.groupId ? { groupId: block.meta.groupId } : {}),
  } as const;

  if (block.type === 'text' || block.type === 'formula' || block.type === 'code') {
    const isCode = block.type === 'code';
    const isFormula = block.type === 'formula';
    const fontSize = block.style?.fontSize ?? 11;
    const lineHeight = block.style?.lineHeight ?? (isCode ? 1.4 : 1.3);
    // Single-line source text must never wrap: substituted fonts run slightly
    // wider than the original, and a wrapped second line collides with the
    // block below (the dominant overlap artifact in imported previews). A
    // bbox taller than ~1.6 line-heights indicates a real multi-line
    // paragraph, which keeps normal wrapping.
    const isSingleLine = Boolean(
      (block.text ?? '').trim()
      && !(block.text ?? '').includes('\n')
      && block.bbox.height <= fontSize * lineHeight * 1.6,
    );
    const overlay: TextOverlay = {
      ...base,
      type: 'text',
      content: block.text ?? '',
      fontFamily: isCode ? 'Menlo, Consolas, monospace'
        : isFormula ? 'Times, "Times New Roman", serif'
        : (block.style?.fontFamily ?? DEFAULT_IMPORT_FONT_STACK),
      fontSize,
      // Phase 6E — preserve a numeric weight grade (e.g. 300/600 derived from the
      // source font name) instead of collapsing every weight to bold/normal.
      fontWeight: (typeof block.style?.fontWeight === 'number'
        ? block.style.fontWeight
        : block.style?.fontWeight === 'bold' ? 'bold' : 'normal') as number | 'normal' | 'bold',
      fontStyle: isFormula ? 'italic' : (block.style?.fontStyle ?? 'normal'),
      color: block.style?.color ?? '#111111',
      align: (block.style?.textAlign ?? 'left') as TextOverlay['align'],
      // Phase 2: prefer real leading/tracking from the PyMuPDF span pass.
      lineHeight,
      letterSpacing: block.style?.letterSpacing ?? 0,
      ...(isSingleLine ? { whiteSpace: 'nowrap' as const } : {}),
    } as TextOverlay;
    return overlay;
  }
  if (block.type === 'vector' && block.meta?.vector) {
    const overlay: VectorOverlay = {
      ...base,
      type: 'vector',
      viewBox: block.meta.vector.viewBox,
      paths: block.meta.vector.paths,
    } as VectorOverlay;
    return overlay;
  }
  if (block.type === 'image') {
    const overlay: ImageOverlay = {
      ...base,
      type: 'image',
      // Phase D: wire embedded picture crop URI when the parser provided one.
      src: block.meta?.imageUri ?? '',
      fit: 'contain',
    } as ImageOverlay;
    return overlay;
  }
  if (block.type === 'table') {
    const td = block.meta?.tableData;
    const numCols = td?.numCols ?? 0;
    const headerRows = td?.headerRows ?? 0;
    // E4 — SOURCE-DERIVED header policy. The mapper NO LONGER synthesizes generic
    // `Column N` labels: labels come from the source header row only (a blank stays
    // blank), and `showHeader` follows the source (a header-less table shows no
    // header rather than fabricated column titles). The sidecar arbitration +
    // preservation plan remain authoritative for native-vs-crop; this fixes the
    // visible-header defect at the reconstruction boundary.
    const headerPolicy = deriveNativeHeaderPolicy({ headerRows, numCols, rows: td?.rows ?? [] });
    const columns = Array.from({ length: numCols }, (_, i) => ({
      key: `c${i}`,
      label: headerPolicy.columnLabels[i] ?? '',
      align: 'left' as const,
      format: 'raw' as const,
    }));
    // Skip header rows from `rows` (they live in `columns.label`).
    const bodyRows = (td?.rows ?? []).slice(headerRows).map((row) => {
      const out = row.slice(0, numCols);
      while (out.length < numCols) out.push('');
      return out;
    });
    const overlay: TableOverlay = {
      ...base,
      type: 'table',
      columns,
      rows: bodyRows,
      showHeader: headerPolicy.showHeader,
      headerHeight: 22,
      rowHeight: 20,
      fontSize: block.style?.fontSize ?? 9,
      headerFontWeight: 'bold',
      borderWidth: 0.5,
      cellPadding: 6,
      fitPolicy: headerPolicy.hasSourceHeaders ? 'source-derived' : 'auto',
      // Bounded E4 audit — flags only, never source text or a URL. `renderMode`
      // is intentionally omitted here (the persisted arbitration decides it); the
      // header-safety flags let the review UI surface a generic-header risk.
      tablePreservation: {
        version: TABLE_PRESERVATION_VERSION,
        integrityState: 'unarbitrated',
        genericHeaderInSource: headerPolicy.genericHeaderInSource,
        hasSourceHeaders: headerPolicy.hasSourceHeaders,
      },
      cellSpans: (td?.cells ?? [])
        .filter((cell) => cell.rowSpan > 1 || cell.colSpan > 1)
        .map((cell) => ({
          row: cell.row - headerRows,
          col: cell.col,
          rowSpan: cell.rowSpan,
          colSpan: cell.colSpan,
        }))
        .filter((cell) => cell.row >= -1),
    } as TableOverlay;
    return overlay;
  }
  return null;
}

function pageWarnings(
  pageNo: number,
  blocks: RawImportBlock[],
  lockThreshold: number,
  doc: DoclingDocument,
): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  const pageConfidence = doc.summary?.page_confidence?.find((p) => Number(p.page_no) === pageNo);
  const avgTextConfidence = typeof pageConfidence?.avg_text_confidence === 'number'
    ? pageConfidence.avg_text_confidence
    : null;
  if (avgTextConfidence != null && avgTextConfidence < 0.6) {
    warnings.push({
      code: 'docling.page_low_text_confidence',
      severity: 'warning',
      pageId: pageId(pageNo),
      message: `Page ${pageNo} average text confidence is ${Math.round(avgTextConfidence * 100)}%; manual review is required.`,
    });
  }
  if (doc.summary?.ocr_pages?.includes(pageNo)) {
    warnings.push({
      code: 'docling.page_ocr_detected',
      severity: 'info',
      pageId: pageId(pageNo),
      message: `Page ${pageNo} used OCR text extraction; verify text fidelity against the page image.`,
    });
  }
  // Phase 3: surface non-catalog (substituted) source fonts so designers know
  // which text won't render in its original typeface.
  const substitutedFonts = Array.from(new Set(
    blocks
      .filter((b) => b.meta?.fontSubstituted && b.meta?.sourceFont)
      .map((b) => String(b.meta!.sourceFont).replace(/^[A-Z]{6}\+/, '')),
  ));
  if (substitutedFonts.length) {
    warnings.push({
      code: 'docling.font_substituted',
      severity: 'info',
      pageId: pageId(pageNo),
      message: `Page ${pageNo}: ${substitutedFonts.length} source font(s) are not available as web fonts and were substituted (${substitutedFonts.slice(0, 4).join(', ')}${substitutedFonts.length > 4 ? '…' : ''}).`,
    });
  }
  const glyphArtifactBlocks = blocks.filter((b) => b.meta?.glyphArtifacts).length;
  if (glyphArtifactBlocks > 0) {
    warnings.push({
      code: 'docling.glyph_extraction_artifacts',
      severity: 'warning',
      pageId: pageId(pageNo),
      message: `Page ${pageNo}: ${glyphArtifactBlocks} text block(s) contained GLYPH<n> extraction artifacts (font without a usable character map); the artifacts were stripped but the text needs manual review.`,
    });
  }
  const lowConf = blocks.filter((b) => b.confidence < lockThreshold).length;
  if (!blocks.length) return warnings;
  const ratio = lowConf / blocks.length;
  if (ratio >= 0.2) {
    warnings.push({
      code: 'docling.low_confidence_majority',
      severity: 'warning',
      pageId: pageId(pageNo),
      message: `Docling reported low confidence on ${Math.round(ratio * 100)}% of blocks; review the editable overlays carefully.`,
    });
  }
  return warnings;
}

function pagePlanForPage(
  page: DoclingPageInfo,
  blocks: RawImportBlock[],
  opts: DoclingPlanOptions,
  doc: DoclingDocument,
): TemplateImportPagePlan {
  const lockThreshold = opts.lockBelowConfidence ?? DEFAULT_LOCK_THRESHOLD;
  const raster = opts.rastersByPage?.[page.page_no];
  const overlays: Overlay[] = [];
  for (const block of blocks) {
    let locked: boolean;
    if (block.meta?.pageRegion) {
      // Phase B: page headers/footers always lock — they're master-page furniture
      // and shouldn't be nudged on individual pages.
      locked = true;
    } else if (opts.mode === 'pixel-perfect') locked = true;
    else if (opts.mode === 'hybrid') locked = block.confidence < lockThreshold;
    else locked = false; // semantic
    const ov = blockToOverlay(block, locked);
    if (ov) overlays.push(ov);
  }
  return {
    id: pageId(page.page_no),
    name: `Page ${page.page_no}`,
    width: page.size.width,
    height: page.size.height,
    background: {
      color: '#FFFFFF',
      // Semantic output must not retain the source page raster: opacity only
      // hides it visually and render/export paths can still fetch or extract it.
      imageUrl: opts.mode === 'semantic' ? '' : raster?.dataUrl ?? page.image_uri ?? '',
      // Phase 6B — hybrid demotes the raster to a faint reference underlay (was
      // 0.85, which let the flat raster dominate and ghost the overlays); the
      // reconstruction now leads, with the raster as a dim alignment backdrop.
      // pixel-perfect keeps the full raster; semantic has none.
      opacity: opts.mode === 'pixel-perfect' ? 1 : opts.mode === 'hybrid' ? 0.5 : 0,
      // Full-page source raster must fill the exact page box, never crop/stretch.
      ...(opts.mode === 'semantic' ? {} : { imageFit: 'fill' as const }),
      // Hybrid's raster is an editor-only alignment underlay: the overlays are
      // the printable reconstruction, so preview/print/export must skip the
      // raster or every element renders twice (dim ghost + overlay).
      ...(opts.mode === 'hybrid' ? { underlay: true } : {}),
    },
    overlays,
    sourcePageId: pageId(page.page_no),
    warnings: pageWarnings(page.page_no, blocks, lockThreshold, doc),
  };
}

export function mapDoclingToPagePlan(
  doc: DoclingDocument,
  opts: DoclingPlanOptions,
): TemplateImportPlan {
  const mapped = mapDoclingToRawBlocks(doc, { embeddedFontFamilies: opts.embeddedFontFamilies });
  const pages: TemplateImportPagePlan[] = mapped.pages.map((page) =>
    pagePlanForPage(page, mapped.byPage[page.page_no] ?? [], opts, doc),
  );
  const warnings: ImportWarning[] = pages.flatMap((p) => p.warnings);
  const editableElementsCreated = pages.reduce(
    (acc, p) => acc + p.overlays.filter((o) => !o.locked).length,
    0,
  );
  const lockThreshold = opts.lockBelowConfidence ?? DEFAULT_LOCK_THRESHOLD;
  const allConfidences = mapped.all.map((b) => b.confidence).filter((n) => Number.isFinite(n));
  const meanConfidence = allConfidences.length
    ? allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
    : 0.7;
  return {
    version: 1,
    importId: opts.importId,
    pages,
    warnings,
    confidenceScore: Number(meanConfidence.toFixed(3)),
    importSummary: {
      visualFidelityMode:
        opts.mode === 'semantic' ? 'semantic' : opts.mode === 'pixel-perfect' ? 'background-first' : 'hybrid',
      editableElementsCreated,
      manualReviewRequired:
        warnings.length > 0 || mapped.all.some((b) => b.confidence < lockThreshold),
      repairPassesApplied: 0,
    },
  };
}
