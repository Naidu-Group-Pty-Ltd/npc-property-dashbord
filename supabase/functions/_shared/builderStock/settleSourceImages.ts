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

/** An upload the sweep may pick up, as the queue read returns it. */
export interface SettlementCandidate {
  id: string;
  organisation_id: string;
}

export interface SettlementTickOutcome {
  /** Uploads this tick called the repair for. */
  attempted: number;
  /** Uploads this tick brought to the current version. */
  settled: number;
  /** The organisations actually touched, for the primary-image enforcement. */
  organisations: string[];
}

/**
 * One tick of the sweep: settle what fits, in the order given.
 *
 * THE CAP IS ON WORK FINISHED, NOT ON UPLOADS LOOKED AT, and that distinction
 * is the whole reason this is a function rather than three lines in a handler.
 * A tick always starts at the oldest outstanding upload, so capping ATTEMPTS
 * let a source that can never settle — bytes that no longer parse, a document
 * too large to finish inside one wall clock — hold one of the six places for
 * ever and starve every upload behind it. The sweep would then never reach the
 * rest, and never unschedule itself, which is the one thing a repair that
 * describes itself as a deployment step must not do.
 *
 * Capping settlements instead costs a stuck upload a single attempt per tick
 * and lets the queue behind it drain. The wall clock is what bounds the tick;
 * the cap only stops it doing more than a tick's worth of successful work.
 */
export async function runSettlementTick(
  outstanding: SettlementCandidate[],
  options: { maxSettled: number; deadlineAt: number; now?: () => number },
  settle: (candidate: SettlementCandidate) => Promise<SettlementOutcome>,
): Promise<SettlementTickOutcome> {
  const now = options.now ?? (() => Date.now());
  const organisations = new Set<string>();
  let attempted = 0;
  let settled = 0;

  for (const candidate of outstanding) {
    if (now() > options.deadlineAt) break;
    if (settled >= options.maxSettled) break;
    attempted += 1;
    // Collected as the loop goes, so it names what was ATTEMPTED rather than
    // what was planned: a tick that stops on its wall clock used to enforce
    // primaries for organisations it never reached.
    organisations.add(String(candidate.organisation_id));
    const outcome = await settle(candidate);
    if (outcome.settled) settled += 1;
  }

  return { attempted, settled, organisations: [...organisations] };
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
