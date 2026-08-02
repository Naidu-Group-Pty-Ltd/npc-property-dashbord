/**
 * Pre-loads remote image URLs referenced by image overlays into base64 data
 * URLs so the synchronous jsPDF renderer can embed them.
 */
import type { ReportTemplate } from './templateSchema';
import {
  invalidateArtifactSignedUrl,
  resolveRasterRefUrl,
} from './pdfImport/rasterArtifactRefs';
import type { PdfImportRasterRef } from './pdfImport/docling/doclingTypes';

const cache = new Map<string, string>();

/**
 * Base64 a response body without `FileReader`.
 *
 * `FileReader` only accepts a Blob from its own realm, so a response body read
 * anywhere the fetch and DOM implementations differ (workers, SSR, the test
 * environment) fails on a type check rather than on anything real. Reading the
 * bytes directly works the same way everywhere, and skips FileReader's
 * event-loop round trip on what are full-page rasters.
 *
 * Encoded in chunks because `String.fromCharCode(...bytes)` on a whole page
 * image overflows the call stack.
 */
const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url)!;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = res.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    cache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Phase 3 — resolve a `page.meta.sourceRasterRef` storage path to a signed URL
 * then to a data URL for the synchronous renderer. The resolved data URL is
 * applied ONLY to the in-memory clone returned from `preloadImages`; the
 * persisted template schema continues to carry storage references only.
 */
async function resolveRasterRefDataUrl(ref: PdfImportRasterRef): Promise<string | null> {
  try {
    const signed = await resolveRasterRefUrl(ref);
    const dataUrl = await fetchAsDataUrl(signed);
    if (!dataUrl) invalidateArtifactSignedUrl(ref.path);
    return dataUrl;
  } catch (e) {
    console.warn('[imagePreloader] sourceRasterRef resolution failed', {
      path: ref?.path,
      pageNo: ref?.pageNo,
      error: (e as Error).message,
    });
    return null;
  }
}

/**
 * Walks every image overlay in the template, fetches each remote `src`, and
 * returns a new template with the `src` replaced by a base64 data URL.
 * Bindings (`{{...}}`) are left untouched and resolved at render time.
 */
export async function preloadImages(template: ReportTemplate): Promise<ReportTemplate> {
  const tasks: Array<Promise<void>> = [];
  const next: ReportTemplate = JSON.parse(JSON.stringify(template));

  const IMAGE_PROP_KEYS = ['imageUrl', 'src', 'chartUrl', 'backgroundUrl'];

  for (const page of next.pages) {
    // PDF-import reference underlays never render in the print/export paths
    // that preload images — skip resolving/inlining them (a full-page raster
    // per page would bloat the render payload for nothing).
    const isReferenceUnderlay = Boolean((page.background as any)?.underlay);
    // Phase 3 — Storage-backed source raster reference (hybrid / pixel-perfect).
    // Resolve to a signed URL → data URL only when no explicit bg image is set.
    const rasterRef = (page as any).meta?.sourceRasterRef as PdfImportRasterRef | undefined;
    if (rasterRef && rasterRef.path && !page.background?.imageUrl && !isReferenceUnderlay) {
      tasks.push(
        resolveRasterRefDataUrl(rasterRef).then((dataUrl) => {
          if (!dataUrl) return;
          (page as any).background = { ...((page as any).background ?? {}), imageUrl: dataUrl };
        }),
      );
    }
    // Page background image
    const bgUrl = page.background?.imageUrl;
    if (typeof bgUrl === 'string' && /^https?:\/\//i.test(bgUrl) && !isReferenceUnderlay) {
      tasks.push(fetchAsDataUrl(bgUrl).then((d) => { if (d) page.background.imageUrl = d; }));
    }
    for (const block of page.blocks) {
      // Block-level image-bearing props
      for (const key of IMAGE_PROP_KEYS) {
        const v = (block.props as any)?.[key];
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          tasks.push(fetchAsDataUrl(v).then((d) => { if (d) (block.props as any)[key] = d; }));
        }
      }
      // Gallery / list-style props with item arrays containing { src }
      const items = (block.props as any)?.items;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item && typeof item.src === 'string' && /^https?:\/\//i.test(item.src)) {
            tasks.push(fetchAsDataUrl(item.src).then((d) => { if (d) item.src = d; }));
          }
        }
      }
      for (const overlay of block.overlays) {
        if (overlay.type !== 'image') continue;
        const src = overlay.src;
        if (typeof src !== 'string' || !/^https?:\/\//i.test(src)) continue;
        tasks.push(
          fetchAsDataUrl(src).then((dataUrl) => {
            if (dataUrl) overlay.src = dataUrl;
          }),
        );
      }
    }
  }

  await Promise.all(tasks);
  return next;
}
