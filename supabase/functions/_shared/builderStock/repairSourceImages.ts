/**
 * Builder stock — recovering source imagery for stock that is ALREADY imported.
 *
 * WHY THIS EXISTS. Seventy live properties were imported from a public Notion
 * stock list while the decoder read only the text of each row, so twenty-five
 * builder-supplied renders sitting on those rows' covers were never seen and
 * every card fell through to a Street View badged "Location imagery". The
 * properties are correct, they are selected against, and they are referenced
 * by clients; the only thing wrong with them is the picture.
 *
 * So this re-reads the SAME source and attaches what it should have attached
 * the first time. It is deliberately not an import:
 *
 *   NOTHING IS CREATED AND NOTHING IS EDITED. No stock item is inserted, no
 *   field is written, no availability is touched, no selection is disturbed.
 *   The only writes are `builder_stock_item_images` rows and the
 *   `primary_image_id` those rows earn.
 *
 *   ROWS ARE MATCHED, NOT RE-IMPORTED. The same two conservative keys
 *   `importStock.ts` matches on — the builder's own reference, and
 *   development + lot/unit with both halves present — decide which existing
 *   property a source row is. A row that matches nothing is skipped, because
 *   inventing a property here would be worse than leaving a card as it is.
 *
 *   THE ORGANISATION IS THE BOUNDARY. Every lookup filters on the upload's own
 *   `organisation_id`, so an asset from one builder's source cannot reach
 *   another builder's stock even if two rows happen to read alike.
 */
import { classifyFetchedSource, classifyStockFile } from './fileTypes.pure.ts';
import { detectDocumentMime } from '../immutableDocuments.ts';
import { extractStockFile } from './extract.ts';
import { keyRowsByHeader } from './table.pure.ts';
import { isNotionUrl } from './urlSource.pure.ts';
import {
  normaliseStockRow, stockMatchKeys, stockRecordLabel, stockRowFingerprint,
  type NormalisedStockRecord,
} from './normalise.pure.ts';
import { SOURCE_ANCHOR_HEADER, type AnchoredAssets, type SourceImageAsset } from './sourceAssets.pure.ts';
import { hasReadySourceImage, storeSourceImageBytes, storeSourceImages } from './sourceImages.ts';
import { driveFileId, driveFolderId } from './drivePackage.pure.ts';
import {
  DriveListingCache, recoverPackageImage, type PackageFetcher,
} from './packageImages.ts';
import { attachDocumentMedia } from './importStock.ts';
import { chooseAndStorePrimaryImage } from './primaryImage.ts';
import type { ExtractedMedia } from './extract.ts';

export interface RepairOutcome {
  uploadId: string;
  /** Rows the source produced this time. */
  rowsRead: number;
  /** Rows that carried imagery. */
  rowsWithImagery: number;
  /** Rows whose imagery reached an EXISTING property. */
  matched: number;
  /** Images stored as bytes in the private bucket. */
  imagesStored: number;
  /** Rows whose image came out of their own linked package document. */
  fromPackage: number;
  /** Rows whose linked package named no image for that exact property. */
  packageNotIdentified: number;
  /** Rows whose linked package could not be read without signing in. */
  packageUnreachable: number;
  /** True when the wall-clock budget ran out; run it again to continue. */
  incomplete: boolean;
  /** Properties whose card now shows the builder's own image. */
  primaryUpdated: number;
  /** Safe to show: why a source could not be re-read at all. */
  error?: string;
  /** Server-side only. */
  problems: Array<{ reference: string; reason: string }>;
}

interface ExistingItem {
  id: string;
  external_reference: string | null;
  development_name: string | null;
  project_name: string | null;
  unit_number: string | null;
  lot_number: string | null;
  /** The normalised record the import wrote. The exact thing to match on. */
  source_row?: Record<string, unknown> | null;
}

function referenceKey(item: ExistingItem): string | null {
  const value = item.external_reference?.trim().toLowerCase();
  return value || null;
}

function developmentUnitKey(item: ExistingItem): string | null {
  const development = (item.development_name ?? item.project_name ?? '').trim().toLowerCase();
  const unit = (item.unit_number ?? item.lot_number ?? '').trim().toLowerCase();
  return development && unit ? `${development}|${unit}` : null;
}

/**
 * Re-read one source and attach the imagery it states.
 *
 * A Notion source is re-fetched live, because the CSV snapshot taken at import
 * time is precisely the artefact that lost the covers. Everything else is
 * re-read from the stored snapshot, which IS the original document.
 */
export async function repairSourceImagesForUpload(
  db: any,
  input: {
    organisationId: string;
    uploadId: string;
    /**
     * When to stop. A package document is a couple of megabytes and there can
     * be one per property, so a repair is budgeted and RESUMABLE rather than
     * unbounded: a row that already holds a source image is skipped, so
     * running this again continues where it left off.
     */
    deadlineAt?: number;
  },
  deps: { fetchPackage?: PackageFetcher } = {},
): Promise<RepairOutcome> {
  const outcome: RepairOutcome = {
    uploadId: input.uploadId,
    rowsRead: 0, rowsWithImagery: 0, matched: 0,
    imagesStored: 0, fromPackage: 0, packageNotIdentified: 0,
    packageUnreachable: 0, incomplete: false, primaryUpdated: 0, problems: [],
  };

  const { data: upload } = await db
    .from('builder_stock_uploads')
    .select('id, organisation_id, source_type, source_url, final_url, original_filename, storage_bucket, storage_path, deleted_at')
    .eq('id', input.uploadId)
    .eq('organisation_id', input.organisationId)
    .maybeSingle();
  if (!upload || upload.deleted_at) {
    return { ...outcome, error: 'That source could not be found.' };
  }

  let rows: Array<Record<string, unknown>> = [];
  let rowAssets: AnchoredAssets[] = [];
  let media: ExtractedMedia[] = [];

  const sourceUrl: string | null = upload.final_url || upload.source_url || null;

  try {
    if (upload.source_type === 'url' && sourceUrl && isNotionUrl(sourceUrl)) {
      // Imported here rather than at the top: both modules reach for
      // `Deno.resolveDns`, and the repair path for an uploaded document must
      // stay loadable — and testable — without the edge runtime.
      const { fetchStockSource } = await import('./fetchSource.ts');
      const { recoverNotionPublicContent } = await import('./notionPublicContent.ts');
      const fetched = await fetchStockSource(sourceUrl);
      const html = new TextDecoder('utf-8', { fatal: false }).decode(fetched.bytes);
      const recovery = await recoverNotionPublicContent(fetched.finalUrl, html);
      if (!recovery.ok) {
        return { ...outcome, error: 'That Notion page could not be read again.' };
      }
      if (!recovery.matrix) {
        return { ...outcome, error: 'That Notion page no longer lists properties in rows.' };
      }
      const keyed = keyRowsByHeader(recovery.matrix);
      rows = keyed?.rows ?? [];
      rowAssets = recovery.assets;
    } else {
      const { data: blob, error: downloadError } = await db.storage
        .from(upload.storage_bucket).download(upload.storage_path);
      if (downloadError || !blob) {
        return { ...outcome, error: 'The stored copy of that source could not be read.' };
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const detection = detectDocumentMime(bytes);
      const classification = upload.source_type === 'url'
        ? classifyFetchedSource({
          detectedMime: detection.mime,
          detectionReason: detection.reason,
          declaredContentType: '',
          finalUrl: sourceUrl ?? '',
          looksLikeHtml: /^\s*<(?:!doctype html|html)/i.test(
            new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 256))),
        })
        : classifyStockFile(upload.original_filename, detection.mime, detection.reason);
      if (classification.kind === 'unsupported') {
        return { ...outcome, error: 'That source cannot be read for imagery.' };
      }
      const extraction = await extractStockFile(
        bytes, upload.original_filename, classification, { baseUrl: sourceUrl ?? undefined });
      rows = extraction.rows;
      rowAssets = extraction.rowAssets;
      media = extraction.media;
    }
  } catch (error) {
    return {
      ...outcome,
      error: String((error as { safeMessage?: string })?.safeMessage
        ?? 'That source could not be read again.'),
    };
  }

  outcome.rowsRead = rows.length;
  if (!rows.length) return outcome;

  // The stock this organisation already holds, and nobody else's.
  const { data: existingRows } = await db
    .from('builder_stock_items')
    .select('id, external_reference, development_name, project_name, unit_number, lot_number, source_row')
    .eq('organisation_id', input.organisationId)
    .eq('lifecycle_status', 'active')
    .order('created_at', { ascending: true })
    .limit(20000);

  const byReference = new Map<string, string>();
  const byDevelopmentUnit = new Map<string, string>();
  /**
   * Properties queued under the fingerprint of the row that produced them.
   *
   * A queue rather than a lookup, and CONSUMED as it matches: a stock list
   * that lists the same lot twice produced two properties, and the second
   * source row must reach the second property rather than overwrite the
   * first's imagery. Where the two rows are identical the picture is the same
   * either way — but the rule has to be stated, not left to whichever entry
   * happened to win the map.
   */
  const byFingerprint = new Map<string, string[]>();
  for (const item of (existingRows ?? []) as ExistingItem[]) {
    const reference = referenceKey(item);
    if (reference) byReference.set(reference, item.id);
    const developmentUnit = developmentUnitKey(item);
    if (developmentUnit) byDevelopmentUnit.set(developmentUnit, item.id);

    // The stored record first: it is what the row normalised to. The columns
    // are the fallback for a property imported before that was written.
    const fingerprint = stockRowFingerprint(
      (item.source_row as Partial<NormalisedStockRecord>) ?? item as Partial<NormalisedStockRecord>);
    const queue = byFingerprint.get(fingerprint) ?? [];
    queue.push(item.id);
    byFingerprint.set(fingerprint, queue);
  }

  const assetsByAnchor = new Map<string, SourceImageAsset[]>();
  for (const anchored of rowAssets) assetsByAnchor.set(anchored.anchor, anchored.assets);

  // One listing per folder per run: 44 of the live rows link the SAME folder,
  // so this is what keeps a repair to a handful of requests instead of one per
  // property.
  const cache = new DriveListingCache(
    deps.fetchPackage ?? (async (url: string) => {
      const { fetchStockSource } = await import('./fetchSource.ts');
      const fetched = await fetchStockSource(url);
      return { bytes: fetched.bytes, finalUrl: fetched.finalUrl };
    }),
  );

  const itemIdByAnchor = new Map<string, string | null>();
  const itemIdsInOrder: string[] = [];
  const touched = new Set<string>();

  for (const raw of rows) {
    const record: NormalisedStockRecord | null = normaliseStockRow(raw);
    if (!record) continue;

    const keys = stockMatchKeys(record);
    const itemId = (keys.reference ? byReference.get(keys.reference) : undefined)
      ?? (keys.developmentUnit
        ? byDevelopmentUnit.get(`${keys.developmentUnit.development}|${keys.developmentUnit.unit}`)
        : undefined)
      ?? byFingerprint.get(stockRowFingerprint(record))?.shift();

    const anchor = record.source_anchor
      ?? (typeof raw[SOURCE_ANCHOR_HEADER] === 'string' ? String(raw[SOURCE_ANCHOR_HEADER]) : null);
    const assets = anchor ? assetsByAnchor.get(anchor) ?? [] : [];
    const linkAssets = record.image_urls.map((url, position): SourceImageAsset => ({
      url,
      reference: url.slice(0, 400),
      origin: 'stock_list_column',
      provider: 'stock_list_column',
      pageUrl: sourceUrl,
      position: assets.length + position,
      linkFallback: true,
    }));
    const all = [...assets, ...linkAssets];
    if (all.length) outcome.rowsWithImagery += 1;

    if (!itemId) continue;
    itemIdsInOrder.push(itemId);
    if (anchor) {
      if (!itemIdByAnchor.has(anchor)) itemIdByAnchor.set(anchor, itemId);
      else if (itemIdByAnchor.get(anchor) !== itemId) itemIdByAnchor.set(anchor, null);
    }

    if (all.length) {
      outcome.matched += 1;
      const stored = await storeSourceImages(db, {
        organisationId: input.organisationId,
        uploadId: upload.id,
        stockItemId: itemId,
        assets: all,
      });
      outcome.imagesStored += stored.stored;
      outcome.problems.push(...stored.problems.slice(0, 5));
      touched.add(itemId);
      continue;
    }

    /**
     * Nothing on the row itself. Its own linked package is the last place a
     * builder-supplied photograph can be — and the only one that has to prove
     * which property it depicts before it is used.
     */
    const packageUrl = solePackageUrl(record.unmapped);
    if (!packageUrl) continue;
    if (input.deadlineAt && Date.now() > input.deadlineAt) { outcome.incomplete = true; break; }
    // A property that already holds one is skipped, which is what makes a
    // budgeted run resumable rather than repetitive.
    if (await hasReadySourceImage(db, itemId)) continue;

    const recovered = await recoverPackageImage(
      { packageUrl, label: stockRecordLabel(record) },
      { fetchPackage: deps.fetchPackage, cache },
    );
    if (recovered.status === 'unreachable') {
      outcome.packageUnreachable += 1;
      continue;
    }
    if (recovered.status !== 'recovered') {
      outcome.packageNotIdentified += 1;
      continue;
    }

    outcome.rowsWithImagery += 1;
    outcome.matched += 1;
    const written = await storeSourceImageBytes(db, {
      organisationId: input.organisationId,
      uploadId: upload.id,
      stockItemId: itemId,
      bytes: recovered.image.bytes,
      contentType: recovered.image.contentType,
      reference: recovered.image.reference,
      provider: 'linked_package',
      origin: 'linked_package_document',
      pageUrl: packageUrl,
      position: 0,
      detail: { document: recovered.image.documentName },
    });
    if (written) {
      outcome.imagesStored += 1;
      outcome.fromPackage += 1;
      touched.add(itemId);
    } else {
      outcome.problems.push({
        reference: recovered.image.reference,
        reason: 'The recovered image could not be stored.',
      });
    }
  }

  // Media embedded in an uploaded document, attributed the same way an import
  // attributes it — structurally where the container said so.
  if (media.length) {
    await attachDocumentMedia(
      db,
      { organisationId: input.organisationId, uploadId: upload.id, media },
      itemIdsInOrder,
      itemIdByAnchor,
    );
    for (const itemId of itemIdsInOrder) touched.add(itemId);
  }

  for (const itemId of touched) {
    const previous = await currentPrimary(db, itemId);
    const primary = await chooseAndStorePrimaryImage(db, itemId);
    if (primary && primary !== previous) outcome.primaryUpdated += 1;
  }

  return outcome;
}

/**
 * The ONE package link a row carries, or nothing.
 *
 * Read from the columns the normaliser could not place — the live list calls
 * it "Complete Package Pack" — rather than from a column name this module
 * would have to know. Two different package links on one row is a row that
 * does not say which package is its own, and the answer to that is no image.
 */
function solePackageUrl(unmapped: Record<string, string>): string | null {
  const links = new Set<string>();
  for (const value of Object.values(unmapped ?? {})) {
    for (const candidate of String(value).split(/\s+/)) {
      if (!/^https?:\/\//i.test(candidate)) continue;
      if (driveFolderId(candidate) || driveFileId(candidate)) links.add(candidate);
    }
  }
  return links.size === 1 ? [...links][0] : null;
}

async function currentPrimary(db: any, stockItemId: string): Promise<string | null> {
  const { data } = await db
    .from('builder_stock_items')
    .select('primary_image_id')
    .eq('id', stockItemId)
    .maybeSingle();
  return data?.primary_image_id ?? null;
}
