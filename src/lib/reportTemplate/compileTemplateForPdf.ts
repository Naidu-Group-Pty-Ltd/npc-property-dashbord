/**
 * compileTemplateForPdf — the ONE way to turn a template into HTML for the
 * server-side PDF renderer.
 *
 * ## Why this exists
 *
 * A PDF-imported page whose output is the source raster does not carry that
 * raster. `background.imageUrl` is stripped when the template is saved
 * (`stripTransientRasterUrls`); what remains is `meta.sourceRasterRef`, a
 * storage PATH. The URL is signed at render time by `preloadImages(…, { mode:
 * 'reference' })`. Skip that step and the page has no raster — and, because a
 * raster-only page also suppresses its native layers, it renders as nothing.
 *
 * Three call sites compiled HTML for the renderer and only one of them ran the
 * step:
 *
 *   - `useWeasyPdfPreview` ran it. Its renders carried the rasters: one
 *     produced a 7.2 MB PDF from 237,477 bytes of HTML.
 *   - "Render with WeasyPrint" in the editor called `renderTemplateToHtml`
 *     directly.
 *   - `ExportPipelineDialog` ran it only `if (assetSummary.images.length)` —
 *     and that count walks the template for `https://…png|jpg` strings, which
 *     a stored import has none of, precisely because the raster URLs were
 *     stripped. So it was skipped for exactly the templates that need it.
 *
 * Both of those emitted 234,052 bytes of HTML — the same document with five
 * empty pages — and WeasyPrint returned a 64 KB PDF that is blank from page 2
 * on. That is the "I can't see anything on the WeasyPrint render" report, and
 * the byte counts in `template_render_jobs` name the responsible call site.
 *
 * So the resolution step is no longer something a caller can remember to do.
 * It is part of compiling a template for the renderer.
 *
 * Callers also get `unresolvedRasterPages`: the pages that still have no
 * raster after resolution. Those pages are not lost — the renderer falls back
 * to their reconstruction (see `shouldFallBackToNativeBlocks`) — but the
 * output is a degraded page, and shipping it silently is how this went
 * unnoticed. Surface it.
 */
import { preloadImages } from './imagePreloader';
import { renderTemplateToHtml, type HtmlRenderOptions } from './htmlRenderer';
import { resolvePageOutputPolicy } from './rendering/pdfImportPagePolicy';
import type { Page, ReportTemplate } from './templateSchema';

export interface CompiledTemplatePdfHtml {
  html: string;
  /** 1-based page numbers whose source raster could not be resolved. */
  unresolvedRasterPages: number[];
}

/** Pages that need a raster to render, and did not get one. */
function findUnresolvedRasterPages(template: ReportTemplate): number[] {
  const out: number[] = [];
  template.pages.forEach((page, index) => {
    const policy = resolvePageOutputPolicy(page as unknown as Page);
    if (policy.outputStrategy !== 'raster-only') return;
    const imageUrl = (page.background as { imageUrl?: unknown } | undefined)?.imageUrl;
    if (typeof imageUrl !== 'string' || !imageUrl) out.push(index + 1);
  });
  return out;
}

/**
 * Resolve every render-time asset, then compile the template to HTML.
 *
 * `reference` mode is deliberate: page rasters become signed URLs that
 * WeasyPrint fetches itself, while smaller assets still inline. Inlining the
 * rasters instead would blow the renderer's 25 MB payload ceiling at about two
 * pages.
 *
 * ## `fontSource: 'container'` is forced, not defaulted
 *
 * The same argument as the raster resolution above, and it cost the same kind
 * of silence. `render-template-pdf` asserts the HTML can make no network
 * request before it calls the engine, and every one of the 500 seeded masters
 * declares its typefaces with a Google Fonts `cssUrl` — so one `@import`
 * failed the entire document, before a `template_render_jobs` row was even
 * written, and the caller fell through to its legacy generator with a chosen
 * template silently unused. It is overridden here rather than merged from
 * `options` because there is no PDF render for which `'remote'` is correct:
 * the engine has the faces, and asking it to fetch one is the failure.
 * See `printFontPolicy.pure.ts`.
 */
export async function compileTemplateHtmlForPdf(
  template: ReportTemplate,
  options: HtmlRenderOptions = {},
): Promise<CompiledTemplatePdfHtml> {
  const prepared = await preloadImages(template, { mode: 'reference' });
  const { html } = renderTemplateToHtml(prepared, { ...options, fontSource: 'container' });
  return { html, unresolvedRasterPages: findUnresolvedRasterPages(prepared) };
}

/** Human-readable warning for a partially-resolved render, or null. */
export function describeUnresolvedRasterPages(pages: number[]): string | null {
  if (!pages.length) return null;
  const list = pages.length > 6 ? `${pages.slice(0, 6).join(', ')}…` : pages.join(', ');
  return `Source image unavailable for page${pages.length === 1 ? '' : 's'} ${list}; `
    + 'rendered from the rebuilt content instead.';
}
