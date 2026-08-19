/**
 * Builder stock — running the overlay repair over images already in the bucket.
 *
 * Ingestion sanitizes as it stores, so everything imported from now on arrives
 * with its derivative made. This is for everything already there: the same
 * repair, from the same bytes, through the same function.
 *
 * THE ORIGINAL IS NEVER REWRITTEN. The stored object is downloaded, read, and
 * left exactly as it was — its bytes, its hashes, its provenance and its
 * display verdict all stand. A repair produces a NEW object beside it and a
 * record naming the original it came from; a card that serves the derivative is
 * one query away from the file the builder actually supplied, which is the
 * whole point of keeping both.
 *
 * WHAT IT PICKS UP. Only a designated primary that the display gate REFUSED for
 * carrying a laid-over graphic. Not a pending one — "we could not read it" is
 * not "there is a badge on it", and repairing a picture nothing could measure
 * would be repairing an imagined defect. Not an eligible one — a clean
 * photograph is served as supplied and must never go through an encoder for no
 * reason. And not a non-primary: an interior or a floorplan cannot reach a card
 * whatever is drawn on it.
 *
 * IT SEPARATES A DECISION FROM A FAILURE TO REACH ONE, exactly as the
 * eligibility sweep does and for the same reason:
 *
 *   the repair refused        the gates said the reconstruction would be a
 *                             guess, the model was unreachable, the validation
 *                             gate rejected the result, or the result still
 *                             measures as annotated
 *                             → a FAILURE RECORD, WRITTEN. That is a completed
 *                               answer for this version: the card shows
 *                               nothing, and a version bump is what revisits it.
 *
 *   the operation failed      no `storage_path`, a download that errored, an
 *                             upload that was rejected, a row write that failed
 *                             → NOTHING WRITTEN, counted as `unresolved`. The
 *                               upload's marker must not advance.
 *
 * AND IT IS CAPPED HARD, because this is the most expensive thing in the whole
 * programme: a full-resolution decode, a reconstruction, up to four model
 * calls, an encode, and a second decode to check the answer. See
 * `MAX_REPAIRS_PER_RUN`.
 */
import { STOCK_IMAGE_BUCKET } from './fileTypes.pure.ts';
import { sanitizeSourceImage } from './sanitizeImage.ts';
import { sha256Hex } from './rasterPng.ts';
import {
  derivativeDetail, failureDetail, sanitizationSettled, storedOriginalSha,
  SANITIZATION_VERSION, type SanitizationFailure, type SanitizedDerivative,
} from './sanitizedDerivative.pure.ts';
import { readMarketplaceState } from './marketplaceEligibility.pure.ts';
import { isPrimaryRole, readStoredRole } from './sourceImageRole.pure.ts';
import { SOURCE_SUPPLIED_STAGE, SOURCE_SUPPLIED_VERIFICATION } from './primaryImage.ts';

export interface SanitizationSettlement {
  scanned: number;
  /** Refused primaries that had not been through the repair at this version. */
  outstanding: number;
  /** Of those, how many this run produced a servable derivative for. */
  repaired: number;
  /** Of those, how many the repair refused — recorded, terminal for now. */
  refused: number;
  /** Rows that needed work and did not get an answer because an OPERATION failed. */
  unresolved: number;
  /** True when the budget, the page ceiling or the repair cap ran out. */
  incomplete: boolean;
}

/** May the caller record this upload as sanitized at the current version? */
export function sanitizationSweepCompleted(outcome: SanitizationSettlement): boolean {
  return !outcome.incomplete && outcome.unresolved === 0;
}

/** Rows read per keyset page. */
const PAGE = 200;
/** A ceiling on pages per call, so one organisation cannot hold the worker. */
const MAX_PAGES = 200;

/**
 * How many pictures one INVOCATION may actually repair.
 *
 * DELIBERATELY VERY SMALL, and fitted the way the other caps in this programme
 * were: against the edge worker's RESOURCE limit rather than against the wall
 * clock. `MAX_ITEMS_RESTORED_PER_RUN` is 4 for work that fetches and parses a
 * document; this work decodes a full-resolution photograph, relaxes a diffusion
 * over it or makes up to four model calls, encodes a PNG and then decodes it
 * again to check. Two is what fits.
 *
 * AND IT IS AN INVOCATION BUDGET, NOT A PER-UPLOAD ONE, which is the mistake
 * every other cap in this area has already been through. A tick settles up to
 * six uploads; a per-upload cap of two is a per-tick cap of twelve, and twelve
 * of these is a `CPU Time exceeded` with nothing written and no marker moved —
 * the exact failure mode that cost this programme its first week. The caller
 * makes ONE budget and threads it through every upload in the tick.
 *
 * The sweep is resumable, so a small budget costs ticks and never coverage.
 */
const MAX_REPAIRS_PER_RUN = 2;

/** A repair allowance shared by every upload in one invocation. */
export interface RepairBudget {
  remaining: number;
}

/** One tick's allowance. Made by the caller, spent by every upload it settles. */
export function newRepairBudget(): RepairBudget {
  return { remaining: MAX_REPAIRS_PER_RUN };
}

interface ImageRow {
  id: string;
  stock_item_id: string | null;
  organisation_id: string;
  source_reference: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  source_detail: Record<string, unknown> | null;
}

/** Where a derivative lives: beside the original, under its version. */
function derivativePath(originalPath: string, imageId: string): string {
  const cut = originalPath.lastIndexOf('/');
  const directory = cut > 0 ? originalPath.slice(0, cut) : originalPath;
  return `${directory}/sanitized/v${SANITIZATION_VERSION}/${imageId}.png`;
}

/**
 * Repair every refused primary that has not been through this version.
 *
 * Keyset by `id` for the reason the eligibility sweep documents: a scan that
 * filters in memory re-reads the same settled page for ever once an
 * organisation is large enough, and a sweep that cannot finish is worse than no
 * sweep because it looks like one.
 */
export async function settleImageSanitization(
  db: any,
  organisationId: string,
  options: {
    deadlineAt?: number;
    uploadId?: string | null;
    /**
     * The invocation's shared repair allowance. Omitted, this upload gets one
     * of its own — which is right for a single call and wrong for a tick, so
     * the tick makes one and passes it to every upload.
     */
    budget?: RepairBudget;
    /** Injected in tests. Production passes nothing and the real repair runs. */
    sanitize?: typeof sanitizeSourceImage;
  } = {},
): Promise<SanitizationSettlement> {
  const outcome: SanitizationSettlement = {
    scanned: 0, outstanding: 0, repaired: 0, refused: 0, unresolved: 0, incomplete: false,
  };
  const sanitize = options.sanitize ?? sanitizeSourceImage;
  const budget = options.budget ?? newRepairBudget();

  let after = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    if (options.deadlineAt && Date.now() > options.deadlineAt) {
      outcome.incomplete = true;
      return outcome;
    }

    let query = db
      .from('builder_stock_item_images')
      .select('id, stock_item_id, organisation_id, source_reference, storage_bucket, '
        + 'storage_path, source_detail')
      .eq('organisation_id', organisationId)
      .eq('source_stage', SOURCE_SUPPLIED_STAGE)
      .eq('verification_status', SOURCE_SUPPLIED_VERIFICATION)
      .eq('processing_status', 'ready')
      .order('id', { ascending: true })
      .limit(PAGE);
    if (options.uploadId) query = query.eq('upload_id', options.uploadId);
    if (after) query = query.gt('id', after);

    const { data, error } = await query;
    if (error) {
      outcome.unresolved += 1;
      outcome.incomplete = true;
      return outcome;
    }
    const rows = (data ?? []) as ImageRow[];
    if (!rows.length) return outcome;

    for (const row of rows) {
      outcome.scanned += 1;
      after = row.id;

      const detail = row.source_detail ?? {};
      if (!isPrimaryRole(readStoredRole(detail))) continue;

      /*
       * ONLY A PICTURE THE GATE CONVICTED. `pending` is not a badge and
       * `eligible` is not a defect; see the header.
       */
      if (readMarketplaceState(detail) !== 'ineligible') continue;
      if (detail.marketplace_rejection_reason !== 'annotated_marketing_tile') continue;

      if (sanitizationSettled(detail, storedOriginalSha(detail))) continue;

      outcome.outstanding += 1;

      if (!row.storage_path) {
        // A designated primary with nowhere to read its bytes from. Not an
        // answer about the picture: left unresolved so a later tick tries.
        outcome.unresolved += 1;
        continue;
      }
      if (budget.remaining <= 0) {
        outcome.incomplete = true;
        return outcome;
      }
      budget.remaining -= 1;
      if (options.deadlineAt && Date.now() > options.deadlineAt) {
        outcome.incomplete = true;
        return outcome;
      }

      const bucket = row.storage_bucket || STOCK_IMAGE_BUCKET;
      const { data: blob, error: downloadError } = await db.storage
        .from(bucket).download(row.storage_path);
      if (downloadError || !blob) {
        outcome.unresolved += 1;
        continue;
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await blob.arrayBuffer());
      } catch {
        outcome.unresolved += 1;
        continue;
      }

      /*
       * THE HASH IS TAKEN OF THE BYTES THAT WERE JUST READ, not of the one
       * recorded in the row.
       *
       * The derivative's whole claim is "this came from those exact bytes", and
       * a claim keyed on a hash nobody re-computed is a claim about what the
       * row SAYS is in the bucket. Where the two disagree the stored hash is
       * the stale one, and keying on it would let a replaced object be served
       * through a derivative made from something else.
       */
      const actualSha = await sha256Hex(bytes);

      const result = await sanitize(bytes, {});

      if (!result.ok) {
        if (result.reason === 'not_annotated') {
          /*
           * The stored verdict says annotated and a fresh reading of the same
           * bytes says otherwise. That is a disagreement between two versions
           * of the classifier, not a repair outcome, and writing a failure for
           * it would blame the repair for something it was never asked to do.
           * Left for the eligibility sweep, whose question it actually is.
           */
          outcome.outstanding -= 1;
          continue;
        }
        const failure: SanitizationFailure = {
          transformation: result.transformation,
          sanitization_version: SANITIZATION_VERSION,
          original_image_id: row.id,
          original_sha256: actualSha,
          reason: result.reason,
          detail: String(result.detail ?? '').slice(0, 300),
          model: result.model,
          failed_at: new Date().toISOString(),
        };
        const { error: writeError } = await db.from('builder_stock_item_images')
          .update({ source_detail: { ...detail, ...failureDetail(failure) } })
          .eq('id', row.id);
        if (writeError) {
          outcome.unresolved += 1;
          continue;
        }
        outcome.refused += 1;
        continue;
      }

      const path = derivativePath(row.storage_path, row.id);
      const { error: uploadError } = await db.storage.from(bucket).upload(
        path,
        // A fresh view, so the storage client cannot retain the repair buffer.
        new Blob([result.bytes as unknown as BlobPart], { type: 'image/png' }),
        { contentType: 'image/png', upsert: true },
      );
      if (uploadError) {
        outcome.unresolved += 1;
        continue;
      }

      const derivative: SanitizedDerivative = {
        transformation: result.transformation,
        sanitization_version: SANITIZATION_VERSION,
        original_image_id: row.id,
        original_sha256: actualSha,
        stock_item_id: String(row.stock_item_id ?? ''),
        organisation_id: String(row.organisation_id ?? organisationId),
        source_reference: row.source_reference ?? null,
        storage_bucket: bucket,
        storage_path: path,
        derivative_sha256: await sha256Hex(result.bytes),
        width: result.width,
        height: result.height,
        repaired_share: result.repairedShare,
        regions_removed: result.regionsRemoved,
        model: result.model,
        generated_at: new Date().toISOString(),
        verdict: result.verdict,
      };

      const { error: recordError } = await db.from('builder_stock_item_images')
        .update({ source_detail: { ...detail, ...derivativeDetail(derivative) } })
        .eq('id', row.id);
      if (recordError) {
        // The bytes are in the bucket and the record is not, so nothing will
        // serve them. Unresolved: the next pass remakes and re-records, and
        // `upsert` means the orphan is overwritten rather than accumulating.
        outcome.unresolved += 1;
        continue;
      }

      outcome.repaired += 1;
    }

    if (rows.length < PAGE) return outcome;
  }

  outcome.incomplete = true;
  return outcome;
}
