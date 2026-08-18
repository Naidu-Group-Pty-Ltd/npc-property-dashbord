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
import {
  eligibilitySweepCompleted, settleMarketplaceEligibility, type EligibilitySettlement,
} from './settleMarketplaceEligibility.ts';
import { MARKETPLACE_ELIGIBILITY_VERSION } from './marketplaceEligibility.pure.ts';

/** The column that records how far an upload's imagery has been brought. */
export const SETTLED_VERSION_COLUMN = 'source_images_settled_version';

/**
 * And the column that records how far its DISPLAY ELIGIBILITY has been brought.
 *
 * A SECOND MARKER, DELIBERATELY. Provenance and display eligibility are
 * different questions with different algorithms that change at different
 * times: improving the marketing-tile classifier must not re-fetch every
 * Notion page and every Drive package, and re-reading a source must not
 * re-run a classifier that has not changed. One marker each is what keeps the
 * two from dragging each other around.
 */
export const ELIGIBILITY_SETTLED_VERSION_COLUMN = 'marketplace_eligibility_settled_version';

export interface SettlementOutcome {
  uploadId: string;
  /** True when this upload is now at BOTH current versions. */
  settled: boolean;
  /** The repair's own report, when one ran. */
  repair?: RepairOutcome;
  /** The eligibility sweep's report, when one ran. */
  eligibility?: EligibilitySettlement;
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
    .select(QUEUE_COLUMNS)
    .eq('organisation_id', input.organisationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(input.limit ?? 25, 200)));
  if (input.uploadId) query = query.eq('id', input.uploadId);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? [])
    .filter((row: Record<string, unknown>) => uploadHasWorkOutstanding(row))
    .map((row: { id: string }) => row.id);
}

/**
 * Does this upload row still owe either kind of work?
 *
 * Shared by the portal's own read and the autonomous sweep so the two cannot
 * disagree about what "outstanding" means. `eligibilityTarget` defaults to this
 * build's own constant; the sweep passes the DATABASE's target instead, for the
 * reason `readEligibilityTarget` explains.
 */
export function uploadHasWorkOutstanding(
  row: Record<string, unknown>,
  eligibilityTarget: number = MARKETPLACE_ELIGIBILITY_VERSION,
): boolean {
  return Number(row[SETTLED_VERSION_COLUMN] ?? 0) < PROVENANCE_VERSION
    || Number(row[ELIGIBILITY_SETTLED_VERSION_COLUMN] ?? 0) < eligibilityTarget;
}

/** The single-row table that carries the deployment's eligibility target. */
export const SETTLEMENT_TARGET_TABLE = 'builder_stock_settlement_target';

/**
 * The eligibility version PRODUCTION is being brought to, as the database
 * states it.
 *
 * WHY THIS IS NOT SIMPLY THE TYPESCRIPT CONSTANT. The cron job that drives the
 * sweep unschedules itself once nothing is outstanding, and it decides that in
 * SQL. SQL cannot see `MARKETPLACE_ELIGIBILITY_VERSION`, so with the constant as
 * the only authority a later bump changed the classifier and woke nothing: every
 * upload still carried marker 1, the job that would have noticed had already
 * removed itself, and the re-audit simply never happened. A version bump ships
 * the constant and a migration that raises this row in the same deployment, and
 * raising it is what re-schedules the job.
 *
 * THE EFFECTIVE TARGET IS THE LOWER OF THE TWO, because the migration and the
 * functions do not deploy at the same instant. Target ahead of code means the
 * sweep does nothing until the new classifier is actually running — rather than
 * re-measuring every image with the old one and writing a marker that can never
 * reach the target, which is a hot loop over the whole bucket. Code ahead of
 * target means the work waits for the migration, which is the same answer from
 * the other side.
 *
 * A missing table is not an error: a deployment whose migration has not run
 * behaves exactly as it did before this existed.
 */
export async function readEligibilityTarget(db: any): Promise<number> {
  let stated = MARKETPLACE_ELIGIBILITY_VERSION;
  try {
    const { data, error } = await db
      .from(SETTLEMENT_TARGET_TABLE)
      .select('marketplace_eligibility_version')
      .limit(1);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    const value = row?.marketplace_eligibility_version;
    if (!error && typeof value === 'number' && Number.isFinite(value)) stated = value;
  } catch {
    // Table absent or unreadable. The constant stands on its own.
  }
  return Math.min(stated, MARKETPLACE_ELIGIBILITY_VERSION);
}

/** The columns the queue reads. One list, so the two callers cannot drift. */
const QUEUE_COLUMNS = `id, organisation_id, created_at, `
  + `${SETTLED_VERSION_COLUMN}, ${ELIGIBILITY_SETTLED_VERSION_COLUMN}`;

/** An upload row as the queue read returns it. */
export interface OutstandingUploadRow extends Record<string, unknown> {
  id: string;
  organisation_id: string;
}

export interface OutstandingUploads {
  rows: OutstandingUploadRow[];
  /** The eligibility version these rows were selected against. */
  eligibilityTarget: number;
  /** True when the markers could not be read at all (migration not applied). */
  unavailable: boolean;
}

/**
 * The uploads that ACTUALLY have work outstanding, oldest first.
 *
 * THE DEFECT THIS REPLACES. The sweep used to read the oldest 500 uploads and
 * filter them in JavaScript. With 500 settled uploads and outstanding work on
 * the 501st, every tick read the same settled 500, found nothing, and reported
 * the queue empty — for ever. Raising the limit only moves the number at which
 * it happens.
 *
 * So the DATABASE decides what is outstanding, over four narrow reads whose
 * union is exactly the set:
 *
 *   provenance marker IS NULL          never settled
 *   provenance marker  < current       settled under older rules
 *   eligibility marker IS NULL         never judged
 *   eligibility marker < target        judged under an older algorithm
 *
 * Four reads rather than one `.or()` string, deliberately: a filter composed by
 * string interpolation is the shape that cost this codebase a predicate which
 * had never once parsed, and `IS NULL` cannot be folded into a `<` comparison
 * anyway — PostgREST's `lt` excludes nulls, which is precisely the rows that
 * matter most here. Each read is a plain indexed predicate, each is limited,
 * and the union is merged and re-sorted in memory over at most 4 × limit rows.
 */
export async function readOutstandingUploads(
  db: any,
  input: { limit: number; eligibilityTarget?: number },
): Promise<OutstandingUploads> {
  const eligibilityTarget = input.eligibilityTarget ?? MARKETPLACE_ELIGIBILITY_VERSION;
  const limit = Math.max(1, Math.min(input.limit, 500));

  const base = () => db
    .from('builder_stock_uploads')
    .select(QUEUE_COLUMNS)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  const reads = [
    base().is(SETTLED_VERSION_COLUMN, null),
    base().lt(SETTLED_VERSION_COLUMN, PROVENANCE_VERSION),
    base().is(ELIGIBILITY_SETTLED_VERSION_COLUMN, null),
    base().lt(ELIGIBILITY_SETTLED_VERSION_COLUMN, eligibilityTarget),
  ];

  const results = await Promise.all(reads.map(async (read: any) => {
    try {
      return await read;
    } catch (error) {
      return { data: null, error };
    }
  }));

  // Every read failing the same way means the columns are not there yet.
  if (results.every((result: any) => result?.error)) {
    return { rows: [], eligibilityTarget, unavailable: true };
  }

  const byId = new Map<string, OutstandingUploadRow>();
  for (const result of results as any[]) {
    if (result?.error) continue;
    for (const row of (result.data ?? []) as OutstandingUploadRow[]) {
      if (row?.id) byId.set(String(row.id), row);
    }
  }

  /*
   * Re-sorted after the union, because four separately-ordered pages are not
   * one ordered page. Oldest first so a budgeted tick makes deterministic
   * progress instead of revisiting whichever upload happened to sort first.
   */
  const rows = [...byId.values()].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    || String(a.id).localeCompare(String(b.id)));

  return { rows: rows.slice(0, limit), eligibilityTarget, unavailable: false };
}

/** An upload the sweep may pick up, as the queue read returns it. */
export interface SettlementCandidate {
  id: string;
  organisation_id: string;
  /** What this upload owes, so a settled half is not redone. */
  needsProvenance?: boolean;
  needsEligibility?: boolean;
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
  input: {
    organisationId: string;
    uploadId: string;
    deadlineAt?: number;
    /**
     * What this upload actually owes, read from its markers.
     *
     * Both default to true so a caller that has not looked still does the
     * work — but a sweep that HAS looked can settle an upload whose imagery is
     * already current and whose display eligibility is not, without re-reading
     * its Notion page or its Drive package to discover nothing has changed.
     */
    needsProvenance?: boolean;
    needsEligibility?: boolean;
  },
  deps: {
    fetchPackage?: PackageFetcher;
    fetchImage?: SourceImageFetcher;
    readPageTexts?: (bytes: Uint8Array) => Promise<string[]>;
  } = {},
): Promise<SettlementOutcome> {
  const needsProvenance = input.needsProvenance !== false;
  const needsEligibility = input.needsEligibility !== false;

  /**
   * DISPLAY ELIGIBILITY FIRST, and on its own marker.
   *
   * It reads stored objects rather than sources, so it is cheap, and it is
   * what decides whether a card may draw anything at all. Running it before
   * the source repair means an upload whose imagery is already current still
   * gets its verdicts on this pass.
   */
  let eligibility: EligibilitySettlement | undefined;
  if (needsEligibility) {
    eligibility = await settleMarketplaceEligibility(db, input.organisationId, {
      uploadId: input.uploadId,
      deadlineAt: input.deadlineAt,
    });
    /*
     * ONLY A PASS THAT ACTUALLY FINISHED ITS WORK MOVES THE MARKER.
     *
     * `eligibilitySweepCompleted` is false when the budget ran out AND when any
     * row needed a verdict and could not be given one because an operation
     * failed — a missing object, a download error, a rejected write. A written
     * `pending` verdict is NOT such a case: the classifier decided it could not
     * decide, which is a finished decision for this algorithm version.
     *
     * Advancing the marker after a storage outage would have looked exactly
     * like a completed sweep — every card empty, nothing outstanding, and the
     * cron job unscheduling itself with the work undone.
     */
    if (eligibilitySweepCompleted(eligibility)) {
      const { error: markError } = await db
        .from('builder_stock_uploads')
        .update({ [ELIGIBILITY_SETTLED_VERSION_COLUMN]: MARKETPLACE_ELIGIBILITY_VERSION })
        .eq('id', input.uploadId)
        .eq('organisation_id', input.organisationId);
      if (markError) {
        // The column is missing (migration not applied). The work was done; it
        // will simply be done again rather than being skipped.
        console.warn('[builderStock] eligibility marker not written', {
          upload_id: input.uploadId,
          phase: 'eligibility_marker',
          message: String(markError.message ?? markError).slice(0, 200),
        });
        return { uploadId: input.uploadId, settled: false, eligibility };
      }
    } else {
      if (eligibility.unresolved) {
        console.warn('[builderStock] eligibility work unresolved', {
          upload_id: input.uploadId,
          phase: 'eligibility_settlement',
          unresolved: eligibility.unresolved,
        });
      }
      return { uploadId: input.uploadId, settled: false, eligibility };
    }
  }

  if (!needsProvenance) {
    return { uploadId: input.uploadId, settled: true, eligibility };
  }

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
    return { uploadId: input.uploadId, settled: false, eligibility, error: message };
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
    return { uploadId: input.uploadId, settled: false, repair, eligibility };
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
    return { uploadId: input.uploadId, settled: false, repair, eligibility };
  }

  return { uploadId: input.uploadId, settled: true, repair, eligibility };
}
