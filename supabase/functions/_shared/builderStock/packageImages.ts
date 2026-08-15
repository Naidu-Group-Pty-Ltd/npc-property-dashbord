/**
 * Builder stock — recovering the render out of a row's OWN package document.
 *
 * The last place a builder-supplied photograph can be, once a row has no cover
 * and no file property: the "Complete Package Pack" link the row itself
 * carries. On the live list that is a Google Drive folder shared by 44 rows —
 * so the link attributes nothing, and everything here is about what the
 * library NAMES:
 *
 *   the row      Lot 43 — Tringa Street, Sandpiper Estate … [Stradbroke 180]
 *   the folder   …/Tweed Heads Packages/Lot 43/
 *   the document Lot 43 - Stradbroke 180 - Property Package.pdf
 *   the image    page 1
 *
 * Each step must resolve to EXACTLY ONE candidate or the whole attempt is
 * abandoned. Nothing is ranked, nothing is scored, and there is no "closest
 * match" — an ambiguity is the source declining to say which property a
 * picture belongs to, and the honest answer to that is the existing fallback.
 *
 * SECURITY. Every retrieval goes through `fetchStockSource`: the existing SSRF
 * guard on the original URL and on every redirect hop, http(s) only, 25 MB
 * ceiling, per-hop and total timeouts, and no cookie, Authorization header,
 * Supabase key, builder session or Google credential of any kind — a folder
 * that is not shared publicly simply answers with a page that carries no
 * listing. Descent is bounded and downward only: no id is constructed or
 * followed outside the tree the row pointed at.
 */
import {
  driveDownloadUrl, driveFileId, driveFolderId, driveFolderUrl, isGoogleDriveHost,
  lotAndDesignFrom, parseDriveFolderListing, selectLotFolder, selectPackageDocument,
  DRIVE_FOLDER_MIME, type DriveEntry,
} from './drivePackage.pure.ts';
import {
  flattenedPageImage, parseImagePlacements, readFirstPage, selectPropertyPhotograph,
} from './pdfPageImages.pure.ts';
import { isolatePhotographBand } from './pdfFlattenedPhoto.pure.ts';
import { cropRows, encodePng, inflate, sha256Hex } from './rasterPng.ts';
import { validateSourceImageBytes } from './sourceAssets.pure.ts';

/** Folder listings one repair run may read. Shared and cached across rows. */
const MAX_LISTINGS_PER_RUN = 40;
/** How far below the linked folder a lot folder may be looked for. */
const MAX_DEPTH = 3;

export interface PackageFetcher {
  (url: string): Promise<{ bytes: Uint8Array; finalUrl: string }>;
}

/** The production fetcher, imported lazily so this module stays testable. */
const guardedFetch: PackageFetcher = async (url: string) => {
  const { fetchStockSource } = await import('./fetchSource.ts');
  const fetched = await fetchStockSource(url);
  return { bytes: fetched.bytes, finalUrl: fetched.finalUrl };
};

/** Reads a folder at most once per run, whoever asks for it. */
export class DriveListingCache {
  private readonly entries = new Map<string, DriveEntry[]>();
  private reads = 0;

  constructor(private readonly fetchPackage: PackageFetcher) {}

  get listings(): number { return this.reads; }

  async list(folderId: string): Promise<DriveEntry[]> {
    const cached = this.entries.get(folderId);
    if (cached) return cached;
    if (this.reads >= MAX_LISTINGS_PER_RUN) return [];

    this.reads += 1;
    try {
      const { bytes } = await this.fetchPackage(driveFolderUrl(folderId));
      const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const listing = parseDriveFolderListing(html);
      this.entries.set(folderId, listing);
      return listing;
    } catch {
      // A folder that will not load is a folder we have nothing to say about.
      this.entries.set(folderId, []);
      return [];
    }
  }
}

export interface RecoveredPackageImage {
  bytes: Uint8Array;
  contentType: string;
  /** Names the document and the page, so the row records where it came from. */
  reference: string;
  /** The Drive file the image was taken out of. */
  documentName: string;
  documentUrl: string;
  /**
   * Everything needed to prove this picture came out of this document —
   * which page, which object, how big it was, what it hashes to, and whether
   * anything was done to it.
   */
  provenance: {
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
    /** Set only for a crop. */
    crop: {
      top: number; bottom: number; left: number; right: number;
      pageWidth: number; pageHeight: number;
      distinctColours: number;
    } | null;
    /** Share of the page the picture covers, when the layout stated it. */
    pageAreaShare: number | null;
    /** What the transformation was, when there was one. */
    transformation: string | null;
  };
}

export type PackageOutcome =
  | { status: 'recovered'; image: RecoveredPackageImage }
  /** The link was read and stated nothing that identifies this property. */
  | { status: 'not_identified'; detail: string }
  /** The link could not be read at all without credentials. */
  | { status: 'unreachable'; detail: string };

/**
 * Find, fetch and extract the one image a row's own package document leads with.
 *
 * `label` is the row's own name — it carries both the lot and the house
 * design, and both have to appear on the document before it is accepted.
 */
export async function recoverPackageImage(
  input: { packageUrl: string; label: string },
  deps: { fetchPackage?: PackageFetcher; cache?: DriveListingCache } = {},
): Promise<PackageOutcome> {
  const fetchPackage = deps.fetchPackage ?? guardedFetch;
  const cache = deps.cache ?? new DriveListingCache(fetchPackage);

  let host: string;
  try {
    host = new URL(input.packageUrl).hostname;
  } catch {
    return { status: 'not_identified', detail: 'The package link is not a web address.' };
  }
  if (!isGoogleDriveHost(host)) {
    return { status: 'not_identified', detail: 'That package is not on a source we can read.' };
  }

  const { lot, design } = lotAndDesignFrom(input.label);

  // A link straight to one document: the row named the file itself.
  const directFileId = driveFileId(input.packageUrl);
  if (directFileId) {
    return await extractFromDocument(fetchPackage, directFileId, 'the linked document');
  }

  const rootId = driveFolderId(input.packageUrl);
  if (!rootId) {
    return { status: 'not_identified', detail: 'That package link names neither a folder nor a file.' };
  }
  if (!lot) {
    return { status: 'not_identified', detail: 'This property does not name a lot to look for.' };
  }

  const root = await cache.list(rootId);
  if (!root.length) {
    return { status: 'unreachable', detail: 'That package folder is not readable without signing in.' };
  }

  const lotFolderId = await findLotFolder(cache, root, lot);
  const entries = lotFolderId ? await cache.list(lotFolderId) : root;
  const document = selectPackageDocument(entries, { lot, design });
  if (!document) {
    return {
      status: 'not_identified',
      detail: lotFolderId
        ? 'No single document in that lot folder names this property.'
        : 'That folder names no document for this exact property.',
    };
  }

  return await extractFromDocument(fetchPackage, document.id, document.name);
}

/**
 * The one folder named for this lot, searched downward from the linked folder.
 *
 * Breadth-first and bounded: a library keeps its per-lot folders under a
 * "Packages" folder, and finding it is a descent inside the tree the row
 * linked — never a step outside it.
 */
async function findLotFolder(
  cache: DriveListingCache,
  root: DriveEntry[],
  lot: string,
): Promise<string | null> {
  let level = root;
  let levelIds: string[] = [];

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const hit = selectLotFolder(level, lot);
    if (hit) return hit;

    const children = level
      .filter((entry) => entry.mimeType === DRIVE_FOLDER_MIME)
      .map((entry) => entry.id);
    if (!children.length) return null;

    const next: DriveEntry[] = [];
    levelIds = children;
    for (const id of levelIds) {
      next.push(...await cache.list(id));
    }
    level = next;
  }
  return null;
}

/**
 * Take the property's photograph out of one document.
 *
 * Two ways, in order, and no third:
 *
 *   1. THE EMBEDDED ASSET. The page's own drawing instructions say where each
 *      picture is placed and how large it appears; the largest photographic
 *      raster on the page is the one the layout leads with, and its bytes are
 *      copied out exactly as the builder stored them.
 *   2. THE FLATTENED PAGE. When the whole page is one raster — a brochure
 *      exported as page pictures — the photograph is cut out of it, and only
 *      out of it. Pixels are cropped, never generated.
 *
 * Anything else returns nothing, and nothing means the card shows no image.
 */
async function extractFromDocument(
  fetchPackage: PackageFetcher,
  fileId: string,
  documentName: string,
): Promise<PackageOutcome> {
  const url = driveDownloadUrl(fileId);
  let bytes: Uint8Array;
  try {
    ({ bytes } = await fetchPackage(url));
  } catch (error) {
    return {
      status: 'unreachable',
      detail: String((error as { safeMessage?: string })?.safeMessage ?? 'That document could not be retrieved.'),
    };
  }

  // A share that actually needs a login answers with a sign-in page.
  if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
    return { status: 'unreachable', detail: 'That document is not publicly downloadable.' };
  }

  const page = readFirstPage(bytes);
  if (!page) return { status: 'not_identified', detail: 'That document could not be read.' };

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
  const placements = parseImagePlacements(content);

  // (1) The photograph the layout leads with.
  const chosen = selectPropertyPhotograph(page, placements);
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
          status: 'recovered',
          image: {
            bytes: asset,
            contentType: check.contentType,
            reference: `${documentName}#page1:${chosen.image.name}`,
            documentName,
            documentUrl: url,
            provenance: {
              page: 1,
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
          },
        };
      }
    }
  }

  // (2) A flattened page: cut the photograph out of the builder's own pixels.
  const flattened = flattenedPageImage(page, placements);
  if (!flattened) {
    return { status: 'not_identified', detail: 'That document leads with no photograph.' };
  }
  /**
   * No guessing at the colour space. Cropping RGB bytes as if they were CMYK
   * shears the picture into stripes, and a plausible-looking wrong image is
   * exactly what this whole path exists to prevent.
   */
  const components = flattened.image.components;
  if (components !== 1 && components !== 3) {
    return {
      status: 'not_identified',
      detail: 'That page image is in a colour space we will not re-encode.',
    };
  }
  const raw = bytes.slice(flattened.image.start, flattened.image.end);
  const pixels = await inflate(raw).catch(() => null);
  if (!pixels) {
    return { status: 'not_identified', detail: 'That page image could not be read.' };
  }
  const sourceHash = await sha256Hex(pixels);

  const band = isolatePhotographBand(pixels, {
    width: flattened.image.width,
    height: flattened.image.height,
    components,
  });
  if (!band) {
    return {
      status: 'not_identified',
      detail: 'No single photograph could be isolated on that page.',
    };
  }

  const cropped = cropRows(pixels,
    { width: flattened.image.width, height: flattened.image.height, components }, band);
  const png = await encodePng(cropped.pixels, {
    width: cropped.width, height: cropped.height, components,
  });
  if (!png) {
    return { status: 'not_identified', detail: 'That page image could not be cut out.' };
  }
  const check = validateSourceImageBytes(png);
  if (check.ok !== true) return { status: 'not_identified', detail: check.reason };

  return {
    status: 'recovered',
    image: {
      bytes: png,
      contentType: check.contentType,
      reference: `${documentName}#page1:crop(${band.top}-${band.bottom})`,
      documentName,
      documentUrl: url,
      provenance: {
        page: 1,
        method: 'page_crop',
        objectNumber: flattened.image.objectNumber,
        resourceName: flattened.image.name,
        sourceWidth: flattened.image.width,
        sourceHeight: flattened.image.height,
        // The page as the builder stored it, and the rectangle taken out of it.
        sourceSha256: sourceHash,
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
        // Stated rather than hidden: the pixels are the builder's, the
        // container is ours, and the crop rectangle above reproduces it.
        transformation: 'cropped to the isolated photograph and re-encoded '
          + 'losslessly as PNG; no pixel values changed',
      },
    },
  };
}
