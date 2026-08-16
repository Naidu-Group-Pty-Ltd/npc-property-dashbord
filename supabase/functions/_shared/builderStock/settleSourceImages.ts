/**
 * Builder stock — bringing an upload's imagery up to the CURRENT rules, once.
 *
 * WHY THIS EXISTS. `repairSourceImagesForUpload` has always been able to read a
 * source again and attach exactly the right picture. What it never had was
 * anything that ran it. It sat behind a "Source images" button in the Builder
 * Portal, so a stock list whose images were written under older rules kept
 * showing an empty frame until a person went and pressed it — and a person who
 * has just uploaded a stock list has no reason to think they should.
 *
 * So the repair becomes a STEP with a terminal marker rather than a command:
 *
 *   An upload is SETTLED at provenance version N when its imagery has been
 *   re-derived under the rules of version N. `source_images_settled_version`
 *   records it. An upload below the current version has work outstanding; an
 *   upload at it has none, however few images it ended up with.
 *
 * THE MARKER IS WHAT MAKES IT SAFE TO RUN AUTOMATICALLY. Without it the only
 * available test is "does this upload have properties with no picture", which is
 * true for ever of a spreadsheet that carries no imagery — so every pass would
 * re-read every source, and a loop driving it would never converge. With it,
 * each upload is re-read once per rules change and then left alone.
 *
 * NOTHING HERE IS AN IMPORT. No stock item is created, no property field is
 * written, no price, availability, selection or linkage is touched. The only
 * writes are `builder_stock_item_images` rows, the `primary_image_id` those
 * rows earn, and this marker.
 */
import { repairSourceImagesForUpload, type RepairOutcome } from './repairSourceImages.ts';
import { enforceStrictPrimaryImages } from './primaryImage.ts';
import { PROVENANCE_VERSION, type SourceImageFetcher } from './sourceImages.ts';
import type { PackageFetcher } from './packageImages.ts';

/** The column that records how far an upload's imagery has been brought. */
export const SETTLED_VERSION_COLUMN = 'source_images_settled_version';

export interface SettlementOutcome {
  uploadId: string;
  /** True when this upload is now at the current provenance version. */
  settled: boolean;
  /** The repair's own report, when one ran. */
  repair?: RepairOutcome;
  /** Safe to surface: why settlement could not complete. */
  error?: string;
}

/**
 * Which of an organisation's uploads still have imagery outstanding.
 *
 * Ordered oldest first so a budgeted sweep makes deterministic progress rather
 * than revisiting whichever upload happened to sort first this time.
 *
 * The column is PROBED rather than required: a deployment whose migration has
 * not run yet must keep importing stock, so an unreadable marker means "treat
 * every upload as settled" and the manual repair remains available. Silently
 * re-reading every source on every pass would be worse than doing nothing.
 */
export async function uploadsNeedingSettlement(
  db: any,
  input: { organisationId: string; uploadId?: string | null; limit?: number },
): Promise<string[]> {
  let query = db
    .from('builder_stock_uploads')
    .select(`id, ${SETTLED_VERSION_COLUMN}`)
    .eq('organisation_id', input.organisationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(input.limit ?? 25, 200)));
  if (input.uploadId) query = query.eq('id', input.uploadId);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? [])
    .filter((row: Record<string, unknown>) =>
      Number(row[SETTLED_VERSION_COLUMN] ?? 0) < PROVENANCE_VERSION)
    .map((row: { id: string }) => row.id);
}

/**
 * Bring ONE upload's imagery up to the current rules.
 *
 * Budgeted and resumable in exactly the way the repair already is: a run that
 * hits the wall clock reports `settled: false`, leaves the marker alone, and the
 * next pass continues where it stopped. Only a complete pass writes the marker,
 * so a half-finished run can never be mistaken for a finished one.
 */
export async function settleUploadSourceImages(
  db: any,
  input: { organisationId: string; uploadId: string; deadlineAt?: number },
  deps: {
    fetchPackage?: PackageFetcher;
    fetchImage?: SourceImageFetcher;
    readPageTexts?: (bytes: Uint8Array) => Promise<string[]>;
  } = {},
): Promise<SettlementOutcome> {
  let repair: RepairOutcome;
  try {
    repair = await repairSourceImagesForUpload(db, {
      organisationId: input.organisationId,
      uploadId: input.uploadId,
      deadlineAt: input.deadlineAt,
    }, deps);
  } catch (error) {
    const message = String((error as { safeMessage?: string; message?: string })?.safeMessage
      ?? (error as { message?: string })?.message ?? error).slice(0, 300);
    console.warn('[builderStock] source image settlement failed', {
      upload_id: input.uploadId,
      phase: 'source_image_settlement',
      message,
    });
    return { uploadId: input.uploadId, settled: false, error: message };
  }

  if (repair.problems.length) {
    // Server-side only: a problem line can name a source object path.
    console.warn('[builderStock] source image settlement problems', {
      upload_id: input.uploadId,
      phase: 'source_image_recovery',
      problems: repair.problems.slice(0, 10),
    });
  }

  /**
   * A source that cannot be read again is SETTLED, not retried for ever.
   *
   * A deleted Notion page, a revoked Drive share and a snapshot we can no longer
   * decode all produce the same thing on every future pass, so leaving the
   * marker clear would make the sweep re-fetch them until somebody noticed. The
   * failure is logged and the manual repair still exists for when the source
   * comes back.
   */
  if (repair.incomplete) {
    return { uploadId: input.uploadId, settled: false, repair };
  }
  if (repair.error) {
    console.warn('[builderStock] source could not be re-read for settlement', {
      upload_id: input.uploadId,
      phase: 'source_read',
      message: repair.error,
    });
  }

  const { error: markError } = await db
    .from('builder_stock_uploads')
    .update({ [SETTLED_VERSION_COLUMN]: PROVENANCE_VERSION })
    .eq('id', input.uploadId)
    .eq('organisation_id', input.organisationId);
  if (markError) {
    // The column is missing (migration not applied). The work was still done;
    // it will simply be done again next time rather than being skipped.
    console.warn('[builderStock] settlement marker not written', {
      upload_id: input.uploadId,
      phase: 'settlement_marker',
      message: String(markError.message ?? markError).slice(0, 200),
    });
    return { uploadId: input.uploadId, settled: false, repair };
  }

  return { uploadId: input.uploadId, settled: true, repair };
}

/**
 * Settle every outstanding upload an organisation has, within a budget.
 *
 * Returns what is LEFT so a caller driving a loop knows whether to come back.
 * `enforceStrictPrimaryImages` runs once at the end rather than per upload: a
 * property whose source no longer designates an image must end the sweep with
 * no primary rather than the one it had under the old rules, and that is true of
 * properties this sweep never touched.
 */
export async function settleOrganisationSourceImages(
  db: any,
  input: { organisationId: string; deadlineAt?: number; limit?: number },
  deps: {
    fetchPackage?: PackageFetcher;
    fetchImage?: SourceImageFetcher;
    readPageTexts?: (bytes: Uint8Array) => Promise<string[]>;
  } = {},
): Promise<{
  settled: number;
  attempted: number;
  remaining: number;
  outcomes: SettlementOutcome[];
  primaries: { inspected: number; cleared: number; corrected: number };
}> {
  const pending = await uploadsNeedingSettlement(db, {
    organisationId: input.organisationId,
    limit: input.limit,
  });

  const outcomes: SettlementOutcome[] = [];
  let settled = 0;
  for (const uploadId of pending) {
    if (input.deadlineAt && Date.now() > input.deadlineAt) break;
    const outcome = await settleUploadSourceImages(db, {
      organisationId: input.organisationId,
      uploadId,
      deadlineAt: input.deadlineAt,
    }, deps);
    outcomes.push(outcome);
    if (outcome.settled) settled += 1;
  }

  const primaries = await enforceStrictPrimaryImages(db, input.organisationId);
  const remaining = (await uploadsNeedingSettlement(db, {
    organisationId: input.organisationId,
    limit: 200,
  })).length;

  return { settled, attempted: outcomes.length, remaining, outcomes, primaries };
}
