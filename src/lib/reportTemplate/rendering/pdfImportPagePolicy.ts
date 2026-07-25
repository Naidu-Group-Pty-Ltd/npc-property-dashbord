/**
 * pdf-page-output-policy-v1 (Path-to-100 v2 · C5).
 *
 * Separates four concepts that page rendering previously conflated:
 *   - finalMode         semantic | hybrid | pixel-perfect
 *   - outputStrategy    native | raster-only         (what the FINAL output is)
 *   - sourceRasterRole  none | editor-reference | final-output
 *   - nativeLayerPolicy editable | locked            (editor edit affordance)
 *
 * The single source of truth for "does this page render its source raster or its
 * native blocks in the final output" — so a full raster and duplicate native
 * content can never render together. All renderers resolve policy through here;
 * none of them may use `overlay.locked` as a visibility proxy (locked overlays
 * still render). Pure, no I/O.
 */
import type { Page } from '../templateSchema';

export const PDF_PAGE_OUTPUT_POLICY_VERSION = 'pdf-page-output-policy-v1';

export type PageFinalMode = 'semantic' | 'hybrid' | 'pixel-perfect';
export type PageOutputStrategy = 'native' | 'raster-only';
export type PageSourceRasterRole = 'none' | 'editor-reference' | 'final-output';
export type PageNativeLayerPolicy = 'editable' | 'locked';
export type PagePolicyDecidedBy = 'quality-gate' | 'operator' | 'migration';

export interface PdfImportPagePolicyDecision {
  score: number | null;
  action: string;
  reason: string;
  decidedAt: string;
  decidedBy: PagePolicyDecidedBy;
}

export interface PdfImportPagePolicy {
  version: typeof PDF_PAGE_OUTPUT_POLICY_VERSION;
  finalMode: PageFinalMode;
  outputStrategy: PageOutputStrategy;
  sourceRasterRole: PageSourceRasterRole;
  nativeLayerPolicy: PageNativeLayerPolicy;
  decision?: PdfImportPagePolicyDecision;
}

/** Canonical healthy policies. */
export function nativePolicy(finalMode: PageFinalMode = 'semantic'): PdfImportPagePolicy {
  return {
    version: PDF_PAGE_OUTPUT_POLICY_VERSION,
    finalMode,
    outputStrategy: 'native',
    sourceRasterRole: finalMode === 'hybrid' ? 'editor-reference' : 'none',
    nativeLayerPolicy: 'editable',
  };
}

export function hybridFallbackPolicy(): PdfImportPagePolicy {
  return {
    version: PDF_PAGE_OUTPUT_POLICY_VERSION,
    finalMode: 'hybrid',
    outputStrategy: 'raster-only',
    sourceRasterRole: 'final-output',
    nativeLayerPolicy: 'editable',
  };
}

export function pixelFallbackPolicy(): PdfImportPagePolicy {
  return {
    version: PDF_PAGE_OUTPUT_POLICY_VERSION,
    finalMode: 'pixel-perfect',
    outputStrategy: 'raster-only',
    sourceRasterRole: 'final-output',
    nativeLayerPolicy: 'locked',
  };
}

function isPolicyObject(value: unknown): value is PdfImportPagePolicy {
  const p = value as PdfImportPagePolicy | undefined;
  return Boolean(
    p
    && p.version === PDF_PAGE_OUTPUT_POLICY_VERSION
    && (p.outputStrategy === 'native' || p.outputStrategy === 'raster-only'),
  );
}

/**
 * Resolve the effective output policy for a page. The typed
 * `page.meta.pdfImport` policy is authoritative; otherwise legacy background
 * signals are normalized in memory (never mutating the page):
 *   - `underlay: true` (+ source raster)     → hybrid, native output, editor-reference raster
 *   - full source raster, opaque, not underlay → pixel-perfect, raster-only, locked
 *   - everything else                          → semantic, native output
 * A "full source raster" requires a PDF-import `sourceRasterRef`, so ordinary
 * decorative background images are never mistaken for a raster-only page.
 */
export function resolvePageOutputPolicy(page: Page | null | undefined): PdfImportPagePolicy {
  const meta = (page?.meta ?? {}) as Record<string, unknown>;
  const typed = meta.pdfImport;
  if (isPolicyObject(typed)) return typed;

  const background = (page?.background ?? {}) as Record<string, unknown>;
  const hasImage = typeof background.imageUrl === 'string' && background.imageUrl.length > 0;
  const underlay = background.underlay === true;
  const isPdfImportRaster = Boolean((meta as { sourceRasterRef?: unknown }).sourceRasterRef);

  if (hasImage && underlay) {
    return {
      version: PDF_PAGE_OUTPUT_POLICY_VERSION,
      finalMode: 'hybrid',
      outputStrategy: 'native',
      sourceRasterRole: 'editor-reference',
      nativeLayerPolicy: 'editable',
    };
  }

  if (hasImage && !underlay && isPdfImportRaster) {
    return pixelFallbackPolicy();
  }

  return nativePolicy('semantic');
}

export interface PageRenderPlanOptions {
  /** Editor opt-in: show the reconstructed native layers on a raster-only page. */
  showReconstructedLayers?: boolean;
  /** Editor opt-in: show the editor-reference raster behind native content. */
  showReferenceRaster?: boolean;
}

/**
 * Decide, for a given render surface, whether native page blocks render and
 * whether the source raster is shown. In FINAL output (no editor opt-ins) a
 * raster-only page shows ONLY the raster and a native page shows ONLY native
 * blocks — never both.
 */
export function resolvePageRenderPlan(
  policy: PdfImportPagePolicy,
  options: PageRenderPlanOptions = {},
): { renderNativeBlocks: boolean; showSourceRaster: boolean } {
  if (policy.outputStrategy === 'raster-only') {
    return {
      renderNativeBlocks: Boolean(options.showReconstructedLayers),
      showSourceRaster: true,
    };
  }
  // native output
  return {
    renderNativeBlocks: true,
    showSourceRaster: policy.sourceRasterRole === 'editor-reference' && Boolean(options.showReferenceRaster),
  };
}

/**
 * Apply the PDF-import render plan to the page background without changing the
 * historical behaviour of ordinary decorative background images.
 */
export function shouldRenderPageBackgroundImage(
  page: Page | null | undefined,
  plan: { showSourceRaster: boolean },
): boolean {
  const meta = (page?.meta ?? {}) as Record<string, unknown>;
  const background = (page?.background ?? {}) as Record<string, unknown>;
  const isPdfImportBackground = isPolicyObject(meta.pdfImport)
    || Boolean(meta.sourceRasterRef)
    || background.underlay === true;
  return isPdfImportBackground ? plan.showSourceRaster : true;
}

/**
 * Apply a policy to a page: writes the typed `meta.pdfImport` policy AND keeps
 * the legacy `background` flags consistent so every renderer (typed-aware or
 * legacy) agrees. Returns a new page; never mutates the input.
 */
export function applyPagePolicyToPage<T extends Page>(page: T, policy: PdfImportPagePolicy): T {
  const meta = { ...((page.meta as Record<string, unknown>) ?? {}), pdfImport: policy };
  const background = { ...((page.background as Record<string, unknown>) ?? {}) };

  if (policy.outputStrategy === 'raster-only') {
    // Source raster is the final output.
    background.underlay = false;
    if (background.imageUrl) {
      background.opacity = 1;
      if (!background.imageFit) background.imageFit = 'fill';
    }
  } else if (policy.sourceRasterRole === 'editor-reference') {
    // Hybrid reference: raster is a dim editor-only underlay behind native content.
    if (background.imageUrl) {
      background.underlay = true;
      if (!background.imageFit) background.imageFit = 'fill';
      const opacity = background.opacity;
      if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity >= 1) {
        background.opacity = 0.5;
      }
    }
  }

  return { ...page, meta, background } as T;
}
