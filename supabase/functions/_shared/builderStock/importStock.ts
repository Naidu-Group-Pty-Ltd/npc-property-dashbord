/**
 * Builder stock lists — writing the rows.
 *
 * Takes what `extract.ts` read, normalises it, and matches each record against
 * the stock this organisation already has before deciding to insert or update.
 *
 * Two rules carry this module:
 *
 *   MATCHING IS CONSERVATIVE. Only two keys count — the builder's own
 *   reference, and development + lot/unit with both halves present. Anything
 *   fuzzier can merge two different properties, and a merged property is a
 *   defect nobody can see. A duplicate row, by contrast, is visible and can be
 *   archived.
 *
 *   AN UPDATE NEVER ERASES. A second upload of a thinner file must not blank
 *   the fields the first one filled, so only values the new file actually
 *   carries are written. That includes availability: a row whose status column
 *   we could not read leaves the stored status alone rather than resetting it
 *   to `unknown`.
 */
import {
  normaliseStockRow, stockMatchKeys, stockRecordLabel,
  type NormalisedStockRecord,
} from './normalise.pure.ts';
import { STOCK_IMAGE_BUCKET } from './fileTypes.pure.ts';
import type { ExtractedMedia } from './extract.ts';
import {
  attributeDocumentMedia, type AnchoredAssets, type SourceImageAsset,
} from './sourceAssets.pure.ts';
import { storeSourceImages } from './sourceImages.ts';

export interface ImportOutcome {
  detected: number;
  imported: number;
  updated: number;
  failed: number;
  itemIds: string[];
  /** Safe to show the uploader: a label and a short reason, never a stack. */
  failures: Array<{ label: string; reason: string }>;
}

interface ExistingItem {
  id: string;
  external_reference: string | null;
  development_name: string | null;
  project_name: string | null;
  unit_number: string | null;
  lot_number: string | null;
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

/** Only the fields the record actually carries. Null means "the file was silent". */
function writablePatch(record: NormalisedStockRecord): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (column: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '') patch[column] = value;
  };
  set('external_reference', record.external_reference);
  set('development_name', record.development_name);
  set('project_name', record.project_name);
  set('address_line', record.address_line);
  set('suburb', record.suburb);
  set('state', record.state);
  set('postcode', record.postcode);
  set('lot_number', record.lot_number);
  set('unit_number', record.unit_number);
  set('bedrooms', record.bedrooms);
  set('bathrooms', record.bathrooms);
  set('car_spaces', record.car_spaces);
  set('property_type', record.property_type);
  set('land_size_sqm', record.land_size_sqm);
  set('building_size_sqm', record.building_size_sqm);
  set('price', record.price);
  set('price_display', record.price_display);
  set('expected_completion', record.expected_completion);
  set('description', record.description);
  // `unknown` is the absence of a reading, not a reading of absence.
  if (record.availability_status !== 'unknown') {
    patch.availability_status = record.availability_status;
  }
  return patch;
}

/**
 * Resolve the existing builder project and unit a record names, when the
 * portal already holds them.
 *
 * This is what keeps the feature from duplicating the inventory model: a stock
 * row that IS a `builder_units` row links to it instead of copying it. Nothing
 * is created here — an unmatched record simply carries no unit, which is a
 * complete and correct state.
 */
async function buildInventoryIndex(db: any, organisationId: string): Promise<{
  projectByName: Map<string, string>;
  unitByProjectAndNumber: Map<string, string>;
}> {
  const projectByName = new Map<string, string>();
  const unitByProjectAndNumber = new Map<string, string>();

  const { data: projects } = await db
    .from('builder_projects')
    .select('id, name, project_reference')
    .or(`developer_organisation_id.eq.${organisationId},builder_organisation_id.eq.${organisationId}`)
    .limit(500);

  for (const project of projects ?? []) {
    const name = String(project.name ?? '').trim().toLowerCase();
    if (name) projectByName.set(name, project.id);
    const reference = String(project.project_reference ?? '').trim().toLowerCase();
    if (reference) projectByName.set(reference, project.id);
  }

  const projectIds = Array.from(new Set(Array.from(projectByName.values())));
  if (projectIds.length) {
    const { data: units } = await db
      .from('builder_units')
      .select('id, project_id, unit_number')
      .in('project_id', projectIds)
      .limit(5000);
    for (const unit of units ?? []) {
      const number = String(unit.unit_number ?? '').trim().toLowerCase();
      if (number) unitByProjectAndNumber.set(`${unit.project_id}|${number}`, unit.id);
    }
  }

  return { projectByName, unitByProjectAndNumber };
}

export async function importStockRecords(
  db: any,
  input: {
    organisationId: string;
    uploadId: string;
    builderUserId: string | null;
    rows: Array<Record<string, unknown>>;
    media: ExtractedMedia[];
    /** Imagery the source published against one of its own rows. */
    rowAssets?: AnchoredAssets[];
  },
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    detected: 0, imported: 0, updated: 0, failed: 0, itemIds: [], failures: [],
  };

  /**
   * Anchor → the property it became.
   *
   * An anchor that two properties claim is demoted to null rather than
   * arbitrarily resolved: a slide holding two lots states no relationship
   * between its picture and either of them, and picking one would be exactly
   * the mis-attribution this whole path exists to prevent.
   */
  const itemIdByAnchor = new Map<string, string | null>();
  const claimAnchor = (anchor: string | null, itemId: string) => {
    if (!anchor) return;
    if (!itemIdByAnchor.has(anchor)) { itemIdByAnchor.set(anchor, itemId); return; }
    if (itemIdByAnchor.get(anchor) !== itemId) itemIdByAnchor.set(anchor, null);
  };

  // Normalise first, so `detected` counts properties and not spreadsheet lines.
  const records: NormalisedStockRecord[] = [];
  for (const row of input.rows) {
    const record = normaliseStockRow(row);
    if (record) records.push(record);
  }
  outcome.detected = records.length;
  if (!records.length) return outcome;

  const { data: existingRows } = await db
    .from('builder_stock_items')
    .select('id, external_reference, development_name, project_name, unit_number, lot_number')
    .eq('organisation_id', input.organisationId)
    .limit(20000);

  const byReference = new Map<string, string>();
  const byDevelopmentUnit = new Map<string, string>();
  for (const item of (existingRows ?? []) as ExistingItem[]) {
    const reference = referenceKey(item);
    if (reference) byReference.set(reference, item.id);
    const developmentUnit = developmentUnitKey(item);
    if (developmentUnit) byDevelopmentUnit.set(developmentUnit, item.id);
  }

  const inventory = await buildInventoryIndex(db, input.organisationId);
  const now = new Date().toISOString();

  for (const record of records) {
    const label = stockRecordLabel(record);
    try {
      const keys = stockMatchKeys(record);
      const existingId = (keys.reference ? byReference.get(keys.reference) : undefined)
        ?? (keys.developmentUnit
          ? byDevelopmentUnit.get(`${keys.developmentUnit.development}|${keys.developmentUnit.unit}`)
          : undefined);

      const patch = writablePatch(record);

      // Link, never copy.
      const projectName = (record.project_name ?? record.development_name ?? '').trim().toLowerCase();
      const projectId = projectName ? inventory.projectByName.get(projectName) : undefined;
      if (projectId) {
        patch.builder_project_id = projectId;
        const unitNumber = (record.unit_number ?? record.lot_number ?? '').trim().toLowerCase();
        const unitId = unitNumber
          ? inventory.unitByProjectAndNumber.get(`${projectId}|${unitNumber}`)
          : undefined;
        if (unitId) patch.builder_unit_id = unitId;
      }

      let itemId: string;
      if (existingId) {
        const { data, error } = await db
          .from('builder_stock_items')
          .update({
            ...patch,
            upload_id: input.uploadId,
            source_row: record as unknown as Record<string, unknown>,
            lifecycle_status: 'active',
            last_seen_at: now,
          })
          .eq('id', existingId)
          .eq('organisation_id', input.organisationId)
          .select('id')
          .single();
        if (error) throw error;
        itemId = data.id;
        outcome.updated += 1;
      } else {
        const { data, error } = await db
          .from('builder_stock_items')
          .insert({
            ...patch,
            organisation_id: input.organisationId,
            upload_id: input.uploadId,
            first_upload_id: input.uploadId,
            created_by_builder_user_id: input.builderUserId,
            source_row: record as unknown as Record<string, unknown>,
            availability_status: patch.availability_status ?? 'unknown',
            last_seen_at: now,
          })
          .select('id')
          .single();
        if (error) throw error;
        itemId = data.id;
        outcome.imported += 1;

        // Keep the in-memory index current so two rows in ONE file that match
        // each other update rather than colliding on the unique index.
        const reference = keys.reference;
        if (reference) byReference.set(reference, itemId);
        if (keys.developmentUnit) {
          byDevelopmentUnit.set(
            `${keys.developmentUnit.development}|${keys.developmentUnit.unit}`, itemId);
        }
      }

      outcome.itemIds.push(itemId);
      claimAnchor(record.source_anchor, itemId);

      /**
       * Image URLs the file itself listed are stage-1 provenance: the builder
       * supplied them, so they are `source_supplied` and not a search result.
       * The BYTES are taken now rather than the link being kept — see
       * `sourceImages.ts` — so the card does not depend on somebody else's
       * server months later.
       */
      if (record.image_urls.length) {
        await storeSourceImages(db, {
          organisationId: input.organisationId,
          uploadId: input.uploadId,
          stockItemId: itemId,
          assets: record.image_urls.map((url, position): SourceImageAsset => ({
            url,
            reference: url.slice(0, 400),
            origin: 'stock_list_column',
            provider: 'stock_list_column',
            pageUrl: null,
            position,
            linkFallback: true,
          })),
        });
      }
    } catch (error) {
      outcome.failed += 1;
      if (outcome.failures.length < 25) {
        outcome.failures.push({ label, reason: safeFailureReason(error) });
      }
    }
  }

  /**
   * Imagery the SOURCE tied to one of its rows — a Notion row's cover, an
   * `<img>` inside a stock table's row. The anchor came out of the source and
   * travelled with the row; nothing here matches by order or by name.
   */
  for (const anchored of input.rowAssets ?? []) {
    const itemId = itemIdByAnchor.get(anchored.anchor);
    if (!itemId) continue;
    await storeSourceImages(db, {
      organisationId: input.organisationId,
      uploadId: input.uploadId,
      stockItemId: itemId,
      assets: anchored.assets,
    });
  }

  await attachDocumentMedia(db, input, outcome.itemIds, itemIdByAnchor);
  return outcome;
}

/**
 * Store the imagery found INSIDE the document.
 *
 * ATTRIBUTION IS STRUCTURAL FIRST. Every office format states where a picture
 * sits — a spreadsheet drawing is anchored to a cell, a `<w:drawing>` lives
 * inside a `<w:tr>`, a slide holds one property's schedule — and where the
 * container said so, that statement decides. Counting is what remains for a
 * format that stated nothing, and `attributeDocumentMedia` switches even that
 * off once any image in the same document carried a real anchor.
 *
 * Anything unattributed is kept against the UPLOAD with no property attached:
 * source information is never deleted, and a render of lot 12 shown against
 * lot 40 is worse than showing nothing.
 */
export async function attachDocumentMedia(
  db: any,
  input: { organisationId: string; uploadId: string; media: ExtractedMedia[] },
  itemIdsInOrder: string[],
  itemIdByAnchor: Map<string, string | null>,
): Promise<void> {
  if (!input.media.length) return;

  const resolvedAnchors: Record<string, string> = {};
  for (const [anchor, itemId] of itemIdByAnchor.entries()) {
    if (itemId) resolvedAnchors[anchor] = itemId;
  }
  const attributions = attributeDocumentMedia({
    anchors: input.media.map((media) => media.anchor ?? null),
    itemIdByAnchor: resolvedAnchors,
    itemIdsInOrder,
  });

  for (const [index, media] of input.media.entries()) {
    const path = `${input.organisationId}/${input.uploadId}/document/${index}-${media.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-60)}`;
    try {
      const { error: uploadError } = await db.storage
        .from(STOCK_IMAGE_BUCKET)
        .upload(path, media.bytes, { contentType: media.contentType, upsert: true });
      if (uploadError) throw uploadError;

      const attribution = attributions[index];
      const stockItemId = attribution.stockItemId;

      await db.from('builder_stock_item_images').upsert({
        stock_item_id: stockItemId,
        upload_id: input.uploadId,
        organisation_id: input.organisationId,
        source_stage: 'uploaded_document',
        source_reference: media.name.slice(0, 400),
        source_provider: 'uploaded_file',
        storage_bucket: STOCK_IMAGE_BUCKET,
        storage_path: path,
        content_type: media.contentType,
        byte_size: media.bytes.length,
        verification_status: 'source_supplied',
        confidence: stockItemId ? 1 : null,
        processing_status: 'ready',
        position: index,
        source_detail: {
          attributed: !!stockItemId,
          structural: attribution.structural,
          anchor: media.anchor ?? null,
          reason: attribution.reason,
        },
      }, { onConflict: 'stock_item_id,source_stage,source_reference' });
    } catch {
      // A document image that will not store must not fail the import. The
      // property is already saved and stages 2 and 3 still run.
    }
  }
}

function safeFailureReason(error: unknown): string {
  const message = String((error as { message?: string })?.message ?? error ?? '');
  if (/duplicate key/i.test(message)) return 'A matching property already exists in your stock.';
  if (/violates check constraint/i.test(message)) return 'A value in this row is outside the allowed range.';
  if (/invalid input syntax/i.test(message)) return 'A value in this row could not be read.';
  return 'This row could not be saved.';
}
