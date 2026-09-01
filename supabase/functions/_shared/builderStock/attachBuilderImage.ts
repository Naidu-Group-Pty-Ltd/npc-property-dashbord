/**
 * BUILDER STOCK — WRITING A PICTURE THE BUILDER HANDED OVER.
 *
 * One module, three callers: a builder attaching a render to one property, a
 * builder attaching one render to a design, and the Command Centre doing
 * either on their behalf. They must not be able to disagree about what a
 * builder-supplied image IS, which is the whole reason this is not written
 * three times.
 *
 * WHAT IT WRITES, AND WHY THAT SHAPE. An ordinary `builder_stock_item_images`
 * row, `uploaded_document` / `source_supplied`, carrying a role assignment —
 * which means it travels every existing rule unchanged rather than around
 * them: `isDisplayableSourceImage` admits it, `rankImage` puts it in the
 * builder's own tier, `chooseCardImage` orders it by the evidence level the
 * role carries, and the marketplace eligibility sweep judges its pixels like
 * any other. A render with "$25,000 REBATE" set over it is refused here
 * exactly as it is inside a brochure.
 *
 * WHAT IT NEVER DOES. It does not set `primary_image_id`. Nothing here decides
 * which picture a card draws — `enforceStrictPrimaryImages` does, from the
 * roles and levels, on its own sweep. An attach that wrote the pointer itself
 * would be a second implementation of the one decision this subsystem has.
 */
import {
  SOURCE_SUPPLIED_STAGE, SOURCE_SUPPLIED_VERIFICATION,
} from './primaryImage.ts';
import {
  roleDetail, roleFromBuilderDesign, type SourceImageRoleAssignment,
} from './sourceImageRole.pure.ts';
import {
  designImageKey, designOfStoredRow,
} from './builderSuppliedImage.pure.ts';
import { isMissingCapability } from './itemWorkClaim.ts';

/** What a caller must give us, and nothing it can decide for itself. */
export interface AttachBuilderImageInput {
  organisationId: string;
  stockItemId: string;
  uploadId: string | null;
  storageBucket: string;
  storagePath: string;
  contentType: string;
  byteSize: number | null;
  sha256: string | null;
  /** The role this image carries FOR THIS PROPERTY. */
  role: SourceImageRoleAssignment;
  /**
   * Set where the row came from a design render, so the fan-out can be
   * re-derived and withdrawn as one act. Absent for a per-property attach.
   */
  designImageId?: string | null;
  designKey?: string | null;
}

/**
 * A stable identity for a builder-supplied row, so attaching twice replaces
 * rather than accumulates.
 *
 * The reference is the storage path for a per-property image and the design's
 * own id for a fan-out row — in both cases the thing that, if it arrives
 * again, means "this same picture" rather than "another one". Without it a
 * builder who re-uploaded a corrected render would leave the old one in the
 * gallery, still eligible, still competing for the card.
 */
export function builderImageReference(input: {
  designImageId?: string | null;
  storagePath: string;
}): string {
  return input.designImageId
    ? `builder-design:${input.designImageId}`
    : `builder-supplied:${input.storagePath}`;
}

/**
 * Write (or replace) one builder-supplied image against one property.
 *
 * Returns the row id, or null when the write failed — which the caller reports
 * rather than swallowing, because an image the builder believes they supplied
 * and which is not stored is the worst outcome available here.
 */
export async function attachBuilderImage(
  // Typed loosely for the same reason every other writer in this package is:
  // the client's own generics describe a schema this repo generates by hand,
  // and a narrower signature here is a second opinion about it that goes stale.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: AttachBuilderImageInput,
): Promise<{ id: string } | { error: string }> {
  const reference = builderImageReference({
    designImageId: input.designImageId ?? null,
    storagePath: input.storagePath,
  });

  const { data, error } = await db.from('builder_stock_item_images').upsert({
    stock_item_id: input.stockItemId,
    organisation_id: input.organisationId,
    upload_id: input.uploadId,
    source_stage: SOURCE_SUPPLIED_STAGE,
    verification_status: SOURCE_SUPPLIED_VERIFICATION,
    processing_status: 'ready',
    source_reference: reference,
    source_provider: 'builder_supplied',
    storage_bucket: input.storageBucket,
    storage_path: input.storagePath,
    content_type: input.contentType,
    byte_size: input.byteSize,
    /*
     * `position` 0 puts it first in the gallery, which is where a picture the
     * builder chose belongs. It is NOT how the card is decided — see the
     * header — but it is what a person scrolling the property's images
     * expects to see at the front.
     */
    position: 0,
    source_detail: {
      ...roleDetail(input.role),
      supplied_directly: true,
      ...(input.designImageId ? { design_image_id: input.designImageId } : {}),
      ...(input.designKey ? { design_key: input.designKey } : {}),
      ...(input.sha256 ? { stored_sha256: input.sha256 } : {}),
    },
    /*
     * The table's own uniqueness, `(stock_item_id, source_stage,
     * source_reference)`, is the conflict target — so a builder who uploads a
     * corrected render REPLACES the one before it instead of leaving it in the
     * gallery, still eligible, still competing for the card.
     */
  }, { onConflict: 'stock_item_id,source_stage,source_reference' }).select('id').maybeSingle();

  if (error || !data) {
    return { error: String((error as { message?: string })?.message ?? 'the image could not be stored') };
  }

  /*
   * AND THE PROPERTY GOES BACK IN FRONT OF THE LADDER, as part of the act
   * rather than as something each caller must remember.
   *
   * A property that has been through the ladder once is left `settled`, which
   * the settler reads as "nothing further to try" — so a picture supplied for
   * such a property would sit in the table, correct and eligible, and never be
   * promoted to the card. Every caller had to requeue it, and a caller that
   * forgot would fail silently in exactly the way that is hardest to notice:
   * the operator sees "saved" and the card stays blank.
   *
   * It also belongs here for a boundary reason. The Command Centre's function
   * SERVES the marketplace, and a standing contract test forbids it naming
   * `image_work_stage` at all — serving is decided by lifecycle alone, never
   * by how far image work got. Performing the requeue inside the shared act
   * keeps that true while still letting staff supply a picture.
   *
   * A failure here is not a failure of the attach: the image IS stored, and
   * the next sweep or the next supply will requeue it. Reported, never thrown.
   */
  const { error: requeueError } = await db.from('builder_stock_items').update({
    enrichment_status: 'pending',
    image_work_stage: 'source',
    image_work_claim_until: null,
    image_work_next_attempt_at: new Date().toISOString(),
    image_work_updated_at: new Date().toISOString(),
  }).eq('id', input.stockItemId).eq('organisation_id', input.organisationId);
  if (requeueError) {
    console.error('[builder-stock] supplied image stored but not requeued', {
      phase: 'builder_supplied_image',
      stock_item_id: input.stockItemId,
      message: String((requeueError as { message?: string })?.message ?? requeueError).slice(0, 200),
    });
  }

  return { id: String((data as { id: string }).id) };
}

/**
 * Give ONE property the design render its builder already supplied, if there
 * is one and the property has no picture of its own yet.
 *
 * WHY THE SETTLER CALLS THIS AND NOT ONLY THE UPLOAD. A render is supplied
 * once and the stock keeps arriving: next month's list adds four more `DK 22B`
 * lots, and a builder who has already handed over that render should not have
 * to hand it over again. Applying it here — on the sweep that already visits
 * every property — is what makes "three uploads, for ever" true rather than
 * "three uploads, for the rows that existed that day".
 *
 * It is idempotent by the same upsert the fan-out uses, so a property that
 * already carries the render costs one indexed read and no write.
 *
 * IT NEVER OUTRANKS A DOCUMENT. The assignment is `DESIGN_EVIDENCE_LEVEL`, so
 * a brochure page naming this lot takes the card back the moment one is read —
 * which is exactly what a builder means by supplying a stand-in.
 */
export async function applyDesignRenderFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  item: { id: string; organisation_id: string; upload_id?: string | null; source_row?: unknown },
): Promise<{ applied: boolean; design?: string }> {
  try {
    return await applyDesignRender(db, item);
  } catch (error) {
    /*
     * IT CAN NEVER FAIL THE ACT IT ACCOMPANIES. This runs inside the settler's
     * per-property sweep, before the stage that property was actually claimed
     * for. A design render is an enrichment: a database fault, a table not yet
     * migrated, a client that cannot serve this read — none of them is a
     * reason to abandon settling the property, and every one of them would
     * have, because a throw here escapes the stage's own try.
     *
     * Said out loud rather than swallowed: a render that stopped arriving is a
     * fault somebody has to see, and it is invisible in the outcome (the
     * property simply has no picture, which is the state it was already in).
     */
    console.error('[builder-stock] design render could not be applied', {
      phase: 'design_render',
      stock_item_id: item?.id,
      message: String((error as { message?: string })?.message ?? error).slice(0, 200),
    });
    return { applied: false };
  }
}

async function applyDesignRender(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  item: { id: string; organisation_id: string; upload_id?: string | null; source_row?: unknown },
): Promise<{ applied: boolean; design?: string }> {
  /*
   * READ THE ROW WHERE THE CALLER DOES NOT CARRY IT, rather than answering
   * "no design" for a property that has one.
   *
   * The settler's claimed item comes back from `claim_builder_stock_image_work`
   * and that function returns the work columns, not `source_row` — so trusting
   * the argument alone would make this a no-op on the one caller that matters
   * most, and a no-op that looks exactly like a builder who supplied nothing.
   */
  let sourceRow = item?.source_row;
  let uploadId = item?.upload_id ?? null;
  if (sourceRow === undefined) {
    const { data: row, error: rowError } = await db
      .from('builder_stock_items')
      .select('source_row, upload_id')
      .eq('id', item.id)
      .eq('organisation_id', item.organisation_id)
      .maybeSingle();
    // A read that FAILED is not a row that states no design.
    if (rowError || !row) return { applied: false };
    sourceRow = row.source_row;
    uploadId = (row.upload_id as string | null) ?? null;
  }

  const design = designOfStoredRow(sourceRow);
  const key = designImageKey(design);
  if (!key) return { applied: false };

  const { data: render, error } = await db
    .from('builder_design_images')
    .select('id, design_key, design_label, storage_bucket, storage_path, content_type, byte_size, sha256')
    .eq('organisation_id', item.organisation_id)
    .eq('design_key', key)
    .maybeSingle();
  /*
   * AN UNDEPLOYED MIGRATION IS NOT A FAULT. `builder_design_images` arrives
   * with a migration and this code arrives with a deploy, and the two do not
   * land at the same instant — so an edge function that treated "no such
   * table" as an error would log one for every property on every sweep for as
   * long as the skew lasted, and bury anything real.
   *
   * And a read that FAILED for any other reason is not a render that is
   * ABSENT: nothing is written and nothing is recorded, so the next sweep asks
   * again rather than banking a verdict from a database that was busy.
   */
  if (error) {
    if (isMissingCapability(error)) return { applied: false };
    throw error;
  }
  if (!render) return { applied: false };

  const attached = await attachBuilderImage(db, {
    organisationId: item.organisation_id,
    stockItemId: item.id,
    uploadId,
    storageBucket: String(render.storage_bucket),
    storagePath: String(render.storage_path),
    contentType: String(render.content_type),
    byteSize: (render.byte_size as number | null) ?? null,
    sha256: (render.sha256 as string | null) ?? null,
    role: roleFromBuilderDesign({
      suppliedBy: 'builder',
      design: String(render.design_label),
    }),
    designImageId: String(render.id),
    designKey: String(render.design_key),
  });
  return 'error' in attached
    ? { applied: false }
    : { applied: true, design: String(render.design_label) };
}
