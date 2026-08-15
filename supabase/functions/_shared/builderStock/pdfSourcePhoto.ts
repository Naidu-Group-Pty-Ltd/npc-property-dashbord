/**
 * Builder stock — taking the property's photograph out of a PDF.
 *
 * ONE implementation, two callers. A package PDF reached through a Notion
 * row's own Drive link and a PDF a builder uploads straight into the portal
 * are the same problem once the bytes are in hand: which raster on which page
 * is the property, and can we prove it came from here. `packageImages.ts`
 * still owns finding and downloading a linked document; this owns everything
 * that happens to the bytes afterwards.
 *
 * It exists because the direct-upload path had NO answer at all. `extract.ts`
 * read a PDF's text and then warned the builder that its pictures were not
 * read and that imagery of the location would stand in for them — which
 * stopped being true the moment imagery of the location stopped being
 * displayable. A builder uploading their own brochure got a property with no
 * picture and a message promising one that could never appear. The sentence
 * itself is quoted, and forbidden, in `builderStockPdfSourceImages.test.ts`.
 *
 * WHAT IS TAKEN, AND WHAT IS REFUSED. Two ways, in order, and no third:
 *
 *   1. THE EMBEDDED ASSET. The page's own drawing instructions say where each
 *      picture is placed and how large it appears; the largest photographic
 *      raster on the page is the one the layout leads with, and its bytes are
 *      copied out exactly as the builder stored them.
 *   2. THE FLATTENED PAGE. When the whole page is one raster, the photograph
 *      is cut out of it — cropped, never generated — and re-encoded losslessly.
 *
 * Anything else returns nothing, and nothing means the card shows no image.
 */
import {
  flattenedPageImageFrom, parseImagePlacements, readPdfPage, resolveDrawnForms,
  resolveDrawnImages, selectPropertyPhotographFrom, IDENTITY,
  type DrawnImage, type Matrix, type PdfScope,
} from './pdfPageImages.pure.ts';
import { isolatePhotographBand } from './pdfFlattenedPhoto.pure.ts';
import { cropRows, encodePng, inflate, sha256Hex } from './rasterPng.ts';
import { validateSourceImageBytes } from './sourceAssets.pure.ts';

/** Everything needed to prove a picture came out of a particular document. */
export interface PdfPhotoProvenance {
  /** 1-based, the way a person counts pages. */
  page: number;
  /** `embedded_raster` copies the asset out untouched; `page_crop` cuts a
   *  rectangle of the builder's own pixels out of a flattened page. */
  method: 'embedded_raster' | 'page_crop';
  objectNumber: number | null;
  resourceName: string | null;
  sourceWidth: number;
  sourceHeight: number;
  /** Hash of the bytes as they sit in the builder's document. */
  sourceSha256: string;
  /** Hash of what we stored. Equal to the above unless a crop happened. */
  storedSha256: string;
  crop: {
    top: number; bottom: number; left: number; right: number;
    pageWidth: number; pageHeight: number;
    distinctColours: number;
  } | null;
  /** Share of the page the picture covers, when the layout stated it. */
  pageAreaShare: number | null;
  /** What the transformation was, when there was one. */
  transformation: string | null;
}

export interface PdfPhoto {
  bytes: Uint8Array;
  contentType: string;
  provenance: PdfPhotoProvenance;
}

/** Pages a single document may be searched through for its lead photograph. */
const MAX_PAGES_SEARCHED = 12;
/** Form streams one page may have inflated. A cost guard, not a rule. */
const MAX_FORMS_PER_PAGE = 48;

/**
 * Every picture the page draws, wherever it is drawn FROM.
 *
 * A page rarely holds its own images. Every serious exporter emits the whole
 * layout as one form XObject and puts the pictures in the form's resources, so
 * a reader that stops at the page's own `/XObject` sees an empty brochure —
 * which is exactly what the live Donnybrook contract looked like. This
 * descends: each form's stream is inflated, interpreted under the matrix that
 * drew it, and its own pictures reported in PAGE coordinates.
 *
 * Names stay scoped to the resources that drew them, so `/X0` in one form and
 * `/X0` in another remain two different pictures.
 */
async function collectDrawnImages(
  bytes: Uint8Array,
  scope: PdfScope,
  content: string,
  base: Matrix,
  depth: number,
  budget = { forms: 0 },
): Promise<DrawnImage[]> {
  const placements = parseImagePlacements(content, base);
  const out: DrawnImage[] = resolveDrawnImages(scope, placements);
  if (depth >= 4) return out;

  for (const { form, base: formBase } of resolveDrawnForms(scope, placements)) {
    if (budget.forms >= MAX_FORMS_PER_PAGE) break;
    budget.forms += 1;
    const raw = bytes.slice(form.start, form.end);
    let text: string;
    try {
      text = new TextDecoder('latin1').decode(form.flate ? await inflate(raw) : raw);
    } catch {
      continue; // a form we cannot inflate simply contributes nothing
    }
    out.push(...await collectDrawnImages(bytes, form, text, formBase, depth + 1, budget));
  }
  return out;
}

/**
 * The photograph ONE page of a PDF presents, or null.
 *
 * `pageIndex` is zero-based; the provenance reports the page 1-based.
 */
export async function extractPdfPagePhoto(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<PdfPhoto | null> {
  const page = readPdfPage(bytes, pageIndex);
  if (!page) return null;

  // The page's drawing instructions, inflated where the document compressed
  // them. Without them nothing can be said about what the page leads with.
  let content = '';
  for (const slice of page.contents) {
    const raw = bytes.slice(slice.start, slice.end);
    try {
      const decoded = slice.flate ? await inflate(raw) : raw;
      content += new TextDecoder('latin1').decode(decoded);
    } catch {
      /* an unreadable content stream simply contributes nothing */
    }
  }
  const drawn = await collectDrawnImages(bytes, page, content, IDENTITY, 0);

  // (1) The photograph the layout leads with.
  const chosen = selectPropertyPhotographFrom(drawn, page.width, page.height);
  if (chosen) {
    const raw = bytes.slice(chosen.image.start, chosen.image.end);
    const asset = chosen.image.filters[0] === 'FlateDecode'
      ? await inflate(raw).catch(() => null)
      : raw;
    if (asset) {
      const check = validateSourceImageBytes(asset);
      if (check.ok === true) {
        const hash = await sha256Hex(asset);
        return {
          bytes: asset,
          contentType: check.contentType,
          provenance: {
            page: pageIndex + 1,
            method: 'embedded_raster',
            objectNumber: chosen.image.objectNumber,
            resourceName: chosen.image.name,
            sourceWidth: chosen.image.width,
            sourceHeight: chosen.image.height,
            sourceSha256: hash,
            // Nothing was done to the bytes, so the two hashes are one hash.
            storedSha256: hash,
            crop: null,
            pageAreaShare: Number(chosen.pageAreaShare.toFixed(4)),
            transformation: null,
          },
        };
      }
    }
  }

  // (2) A flattened page: cut the photograph out of the builder's own pixels.
  const flattened = flattenedPageImageFrom(drawn, page.width, page.height);
  if (!flattened) return null;

  /**
   * No guessing at the colour space. Cropping RGB bytes as if they were CMYK
   * shears the picture into stripes, and a plausible-looking wrong image is
   * exactly what this whole path exists to prevent.
   */
  const components = flattened.image.components;
  if (components !== 1 && components !== 3) return null;

  const pixels = await inflate(bytes.slice(flattened.image.start, flattened.image.end))
    .catch(() => null);
  if (!pixels) return null;

  const band = isolatePhotographBand(pixels, {
    width: flattened.image.width,
    height: flattened.image.height,
    components,
  });
  if (!band) return null;

  const cropped = cropRows(pixels,
    { width: flattened.image.width, height: flattened.image.height, components }, band);
  const png = await encodePng(cropped.pixels, {
    width: cropped.width, height: cropped.height, components,
  });
  if (!png) return null;

  const check = validateSourceImageBytes(png);
  if (check.ok !== true) return null;

  return {
    bytes: png,
    contentType: check.contentType,
    provenance: {
      page: pageIndex + 1,
      method: 'page_crop',
      objectNumber: flattened.image.objectNumber,
      resourceName: flattened.image.name,
      sourceWidth: flattened.image.width,
      sourceHeight: flattened.image.height,
      // The page as the builder stored it, and the rectangle taken out of it.
      sourceSha256: await sha256Hex(pixels),
      storedSha256: await sha256Hex(png),
      crop: {
        top: band.top,
        bottom: band.bottom,
        left: 0,
        right: flattened.image.width,
        pageWidth: flattened.image.width,
        pageHeight: flattened.image.height,
        distinctColours: band.distinctColours,
      },
      pageAreaShare: null,
      // Stated rather than hidden: the pixels are the builder's, the container
      // is ours, and the crop rectangle above reproduces it.
      transformation: 'cropped to the isolated photograph and re-encoded '
        + 'losslessly as PNG; no pixel values changed',
    },
  };
}

/**
 * The photograph a document presents, and the page it presents it on.
 *
 * For a document that IS one property — a package reached through a row's own
 * link, a single-property brochure a builder uploaded — this is the picture it
 * leads with: pages are read in the document's own order and the FIRST that
 * presents a photograph is the answer. Later pages are not searched, so a lot
 * plan on page 4 and an estate masterplan on page 5 are never reached.
 */
export async function extractExactSourcePhotoFromPdf(
  bytes: Uint8Array,
  options: { maxPages?: number } = {},
): Promise<PdfPhoto | null> {
  const limit = Math.max(1, Math.min(options.maxPages ?? MAX_PAGES_SEARCHED, MAX_PAGES_SEARCHED));
  for (let index = 0; index < limit; index++) {
    const photo = await extractPdfPagePhoto(bytes, index);
    if (photo) return photo;
  }
  return null;
}

/**
 * The photograph EACH page presents, for a document that may hold several
 * properties.
 *
 * One entry per page that presents exactly one photograph; a page that
 * presents none is absent rather than null, because the caller attributes by
 * page number and an absent page attributes nothing.
 */
export async function extractPdfPhotosByPage(
  bytes: Uint8Array,
  options: { maxPages?: number } = {},
): Promise<Array<{ page: number; photo: PdfPhoto }>> {
  const limit = Math.max(1, Math.min(options.maxPages ?? MAX_PAGES_SEARCHED, MAX_PAGES_SEARCHED));
  const out: Array<{ page: number; photo: PdfPhoto }> = [];
  for (let index = 0; index < limit; index++) {
    const photo = await extractPdfPagePhoto(bytes, index);
    if (photo) out.push({ page: index + 1, photo });
  }
  return out;
}
