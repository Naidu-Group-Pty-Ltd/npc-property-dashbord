/**
 * Builder stock — the builder's OWN imagery, and how it stays tied to the
 * property it came from.
 *
 * Stage 1 of the three-stage enrichment is the only stage whose provenance is
 * the builder's document. It is also the only one that can be WRONG about
 * which property it depicts, because stages 2 and 3 start from an address we
 * already hold while this one starts from a picture sitting somewhere in a
 * file. So the rule this module exists to enforce:
 *
 *   AN IMAGE IS ATTRIBUTED BECAUSE THE SOURCE SAID SO, NEVER BECAUSE THE
 *   COUNTS LINED UP. A Notion row owns its cover; a spreadsheet drawing is
 *   anchored to a cell; a `<img>` sits inside one `<tr>`. Where the format
 *   states the relationship, that statement decides. Ordering is a fallback
 *   for formats that state nothing, and it is switched OFF the moment any
 *   image in the same document carries a real anchor — a render of lot 12
 *   shown against lot 40 is worse than showing nothing at all.
 *
 * ATTRIBUTION IS NOT ROLE. Everything above answers "whose picture is this?".
 * What the source presented the picture AS — its hero, its floorplan, its
 * estate map — is a second and equally necessary fact, and it travels with
 * every asset as `role`. See `sourceImageRole.pure.ts`.
 *
 * Pure: no IO and no clock. Loaded by the edge functions under Deno and by
 * `src/lib/__tests__` under vitest.
 */
import {
  isPrimaryRole, noPrimaryEvidence, roleFromAssetName, roleFromStructuralContainer,
  secondaryRole, type SourceImageRoleAssignment,
} from './sourceImageRole.pure.ts';

/**
 * The reserved column that carries a row's identity from the source into the
 * pipeline.
 *
 * A Notion collection becomes CSV before it is imported, and CSV has no room
 * for "this row was block 374cabf9…". Rather than inventing a second import
 * path that keeps the record map alive, the anchor travels as an ordinary
 * column: it survives the snapshot, it is visible in the stored object a
 * support question would be answered from, and `normaliseStockRow` lifts it
 * off the row instead of filing it under `unmapped`.
 */
export const SOURCE_ANCHOR_HEADER = 'npc_source_anchor';

/** Where a source-supplied asset was found. Recorded, never inferred. */
export type SourceAssetOrigin =
  | 'notion_page_cover'
  | 'notion_file_property'
  | 'notion_image_block'
  | 'notion_link_property'
  | 'stock_list_column'
  | 'html_row_image'
  | 'document_media';

/**
 * One builder-supplied asset, and the row it belongs to.
 *
 * `url` is what we will fetch; `reference` is what the source called it, and
 * is what the image row is keyed on so a re-import refreshes rather than
 * duplicates. The two differ for Notion, whose signed delivery URL changes on
 * every request while `attachment:<id>:<name>` does not.
 */
export interface SourceImageAsset {
  url: string;
  reference: string;
  origin: SourceAssetOrigin;
  /** `notion`, `uploaded_file`, `source_page`, `stock_list_column`. */
  provider: string;
  /** The page the asset was published on, when there is one. */
  pageUrl: string | null;
  /** Order within the row. 0 is the one the marketplace shows. */
  position: number;
  /**
   * May the plain link stand in when the bytes cannot be fetched?
   *
   * True for an ordinary published URL, which a browser can load even where a
   * server-side fetch was refused. FALSE for anything signed or expiring — a
   * Notion attachment resolves through a URL that is dead within the hour, and
   * recording it would put a broken image on a client's page later rather
   * than falling back honestly now.
   */
  linkFallback: boolean;
  /**
   * What the SOURCE presented this image as, and on what evidence.
   *
   * Required rather than optional: an asset whose role nobody stated is an
   * asset that cannot be a card's image, and making the producer say so is what
   * stops a new source type quietly inheriting "any picture will do".
   */
  role: SourceImageRoleAssignment;
}

/** Assets belonging to one row of the source, keyed by that row's anchor. */
export interface AnchoredAssets {
  anchor: string;
  assets: SourceImageAsset[];
}

/**
 * Settle the roles of the assets ONE row of a structured source carries.
 *
 * LEVEL 3, and the rule that makes it safe: a container designates a primary
 * only when, after everything the source NAMES as non-hero is set aside,
 * exactly one candidate is left. A Notion row whose cover is its only picture
 * has designated it; a table row holding three photographs and saying nothing
 * about them has designated nothing, and the answer to that is no primary.
 *
 * `preferred` is the asset the container itself puts first — a row cover, a
 * card's hero — which outranks its siblings where the source has one.
 */
export function settleRowAssetRoles(
  assets: SourceImageAsset[],
  container: { container: string; designation: string; preferredIndex?: number },
): SourceImageAsset[] {
  const all = assets ?? [];
  if (!all.length) return all;

  const named = all.map((asset) => roleFromAssetName(asset.reference));
  const candidates = all
    .map((asset, index) => ({ asset, index }))
    .filter(({ index }) => !named[index]);

  const preferred = container.preferredIndex ?? -1;
  const chosen = candidates.some(({ index }) => index === preferred)
    ? preferred
    : candidates.length === 1 ? candidates[0].index : -1;

  return all.map((asset, index) => {
    if (named[index]) {
      return {
        ...asset,
        role: secondaryRole(named[index]!, `the source names this image "${asset.reference}"`),
      };
    }
    if (index === chosen) {
      return { ...asset, role: roleFromStructuralContainer(container) };
    }
    // A named-hero asset that lost is still property imagery, just not the one.
    if (isPrimaryRole(asset.role?.role)) {
      return {
        ...asset,
        role: secondaryRole('property_secondary',
          'the source carries several photographs on this row and does not say which is '
          + 'the property\'s listing image'),
      };
    }
    return {
      ...asset,
      role: noPrimaryEvidence(
        candidates.length > 1
          ? 'the source carries several photographs on this row and does not say which is '
            + 'the property\'s listing image'
          : 'the source does not present this image as the property\'s listing image'),
    };
  });
}

// ---------------------------------------------------------------------------
// What may be stored
// ---------------------------------------------------------------------------

/**
 * The bucket's own ceiling (`builder-stock-images` is capped at 10 MB) and its
 * own allow-list. Stated here so the fetcher refuses before the upload does,
 * with a reason a human can read.
 */
export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;

/** A 1×1 tracking pixel is a valid PNG. It is not a photograph of a house. */
export const MIN_SOURCE_IMAGE_BYTES = 512;

/**
 * Raster formats the bucket accepts, and nothing else.
 *
 * SVG is absent DELIBERATELY and must not be added: it is a document that can
 * carry script and remote references, and the marketplace serves these bytes
 * back to a browser.
 */
export const ALLOWED_SOURCE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

const EXTENSION_FOR_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * What the BYTES are, ignoring what the server said they were.
 *
 * A declared content type is a claim by whoever served the file; the signature
 * is evidence. HTML served as `image/jpeg` — an error page, a login wall — is
 * the ordinary way a fetched "image" turns out not to be one, and it is
 * rejected here rather than stored and shown to a client.
 */
export function sniffImageContentType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export type SourceImageCheck =
  | { ok: true; contentType: string; extension: string }
  | { ok: false; reason: string };

/**
 * May these bytes become a marketplace image?
 *
 * Signature first, then size. Nothing here trusts the URL's extension or the
 * response's content type: both are attacker-controlled on a link a builder
 * pasted, and neither is evidence about the bytes.
 */
export function validateSourceImageBytes(bytes: Uint8Array): SourceImageCheck {
  if (!bytes.length) return { ok: false, reason: 'That address returned nothing.' };
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES) {
    return { ok: false, reason: 'That image is larger than the 10 MB limit.' };
  }
  const contentType = sniffImageContentType(bytes);
  if (!contentType) {
    return { ok: false, reason: 'That file is not an image we can display.' };
  }
  if (!ALLOWED_SOURCE_IMAGE_TYPES.has(contentType)) {
    return { ok: false, reason: 'That image format cannot be stored.' };
  }
  if (bytes.length < MIN_SOURCE_IMAGE_BYTES) {
    return { ok: false, reason: 'That image is too small to be a property photograph.' };
  }
  return { ok: true, contentType, extension: EXTENSION_FOR_TYPE[contentType] };
}

/** Filenames that are an image, for a link we have not fetched yet. */
export function looksLikeImageUrl(rawUrl: string): boolean {
  const withoutQuery = String(rawUrl ?? '').split(/[?#]/)[0];
  return /\.(jpe?g|png|webp|gif)$/i.test(withoutQuery);
}

/**
 * Where the stored copy lives.
 *
 * Keyed by the source's own reference rather than by position, so re-running
 * an import overwrites the same object instead of accumulating one per run.
 */
export function sourceImageObjectPath(
  organisationId: string,
  stockItemId: string,
  reference: string,
  extension: string,
): string {
  const stem = String(reference)
    .replace(/^https?:\/\//i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(-80) || 'source-image';
  return `${organisationId}/items/${stockItemId}/source/${stem}.${extension}`;
}

/**
 * Settle the roles of the pictures found INSIDE a document, per property.
 *
 * The office formats all state containment and nothing more: a drawing is
 * anchored to a spreadsheet row, a `<w:drawing>` sits in a table row, a picture
 * is on a slide. That is LEVEL 3 — the container designating this property's
 * image — and it holds only while the container designates ONE. A property's
 * section carrying a facade, a floorplan and a kitchen has stated which is
 * which only insofar as it NAMED them; where it named nothing, three
 * photographs is a choice the document did not make, and this does not make it
 * either.
 *
 * `container` is how the record will describe the relationship to a person.
 */
export function settleContainerMediaRoles(input: {
  media: Array<{ name: string; anchor?: string | null }>;
  /** The property each picture reached, index-aligned. Null is unattributed. */
  stockItemIds: Array<string | null>;
  container: string;
}): SourceImageRoleAssignment[] {
  const media = input.media ?? [];
  const named = media.map((entry) => roleFromAssetName(entry.name));

  const byProperty = new Map<string, number[]>();
  media.forEach((_, index) => {
    const itemId = input.stockItemIds[index];
    if (!itemId || named[index]) return;
    const bucket = byProperty.get(itemId) ?? [];
    bucket.push(index);
    byProperty.set(itemId, bucket);
  });

  const primaries = new Set<number>();
  for (const indexes of byProperty.values()) {
    if (indexes.length === 1) primaries.add(indexes[0]);
  }

  return media.map((entry, index) => {
    if (named[index]) {
      return secondaryRole(named[index]!, `the source names this image "${entry.name}"`);
    }
    if (primaries.has(index)) {
      return roleFromStructuralContainer({
        container: entry.anchor ? `${input.container} (${entry.anchor})` : input.container,
        designation: 'property image',
      });
    }
    if (!input.stockItemIds[index]) {
      return noPrimaryEvidence(
        'the source did not tie this image to a property, so it is kept against the '
        + 'upload and shown against nobody');
    }
    return noPrimaryEvidence(
      'the source places several photographs against this property and does not say '
      + 'which is its listing image');
  });
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export interface MediaAttribution {
  /** Null means "kept against the upload", which is a complete state. */
  stockItemId: string | null;
  /** Written to `source_detail.reason`, so the audit record says why. */
  reason: string;
  /** True when the SOURCE stated the relationship. */
  structural: boolean;
}

/**
 * Decide which property each embedded image belongs to.
 *
 * `anchors[i]` is what the container said about image `i` — the sheet row its
 * drawing is anchored to, the table row it sits in, the slide it is on — or
 * null when the format said nothing. `itemIdByAnchor` is the same vocabulary,
 * built from the rows that were actually imported.
 *
 * THE ORDERING FALLBACK IS SWITCHED OFF BY EVIDENCE. If any image in this
 * document carried an anchor, then the document DOES state relationships, and
 * an unanchored image is one the document deliberately did not tie to a row —
 * a letterhead, an estate map, a floor-plan legend. Attributing it by position
 * would contradict the very structure that placed its neighbours.
 */
export function attributeDocumentMedia(input: {
  anchors: Array<string | null>;
  itemIdByAnchor: Record<string, string>;
  itemIdsInOrder: string[];
}): MediaAttribution[] {
  const { anchors, itemIdByAnchor, itemIdsInOrder } = input;

  const anyStructural = anchors.some(
    (anchor) => !!anchor && !!itemIdByAnchor[anchor],
  );

  const orderedAttribution = !anyStructural
    && (itemIdsInOrder.length === 1 || itemIdsInOrder.length === anchors.length);

  return anchors.map((anchor, index) => {
    const anchored = anchor ? itemIdByAnchor[anchor] : undefined;
    if (anchored) {
      return {
        stockItemId: anchored,
        reason: `anchored to ${anchor} in the source document`,
        structural: true,
      };
    }
    if (orderedAttribution) {
      return {
        stockItemId: itemIdsInOrder.length === 1
          ? itemIdsInOrder[0]
          : itemIdsInOrder[index],
        reason: 'one image per property in file order',
        structural: false,
      };
    }
    return {
      stockItemId: null,
      reason: anyStructural
        ? 'the source anchors its images and did not anchor this one; kept against the upload'
        : 'image count does not match property count; kept against the upload',
      structural: false,
    };
  });
}
