/**
 * Pure model for the server-side listings cache.
 *
 * The cache mirrors Airtable rather than archiving it: when Airtable prunes a
 * record at 30 days, the cached row goes too. That makes the sync's deletion
 * step the most dangerous code in the feature — it is the one operation that can
 * destroy data for every user at once, and it fires on a schedule with nobody
 * watching. Everything here exists to decide, from evidence, whether a given
 * sync run has earned the right to delete.
 *
 * Free of Deno, Supabase, React and the DOM so both runtimes can share it and
 * the dangerous decisions can be tested directly.
 */

/** One record as it arrives from Airtable. */
export interface AirtableRecordLike {
  id?: unknown;
  createdTime?: unknown;
  fields?: Record<string, unknown> | null;
}

/** One row as it is stored. */
export interface CachedListingRow {
  listing_id: string;
  table_key: string;
  fields: Record<string, unknown>;
  created_time: string | null;
  last_modified_time: string | null;
  fingerprint: string;
  last_verified_at: string;
}

/* -------------------------------------------------------------------------- */
/* Field extraction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Airtable record ids are `rec` + 14 url-safe characters. Bounded rather than
 * exact, matching the check `listing-images` already uses.
 */
export function cleanRecordId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{3,64}$/.test(trimmed) ? trimmed : null;
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * The record's creation time, taken from Airtable's own metadata.
 *
 * Deliberately *not* the value `airtable-proxy` synthesises: that helper
 * coalesces several possible date fields and falls back to `new Date()` when a
 * record has none, which would make an undated record look brand new on every
 * sync — permanently fresh here while Airtable's own 30-day window, which reads
 * the real Created Time, prunes it. The cache and the source have to be looking
 * at the same clock.
 */
export function extractCreatedTime(record: AirtableRecordLike): string | null {
  const fields = record.fields ?? {};
  return (
    isoOrNull(fields['Created Time']) ??
    isoOrNull(fields['Created']) ??
    isoOrNull(record.createdTime)
  );
}

export function extractLastModified(record: AirtableRecordLike): string | null {
  const fields = record.fields ?? {};
  return isoOrNull(fields['Last Modified Time']) ?? isoOrNull(fields['Last Modified']);
}

/**
 * Stable digest of a record's contents.
 *
 * Key order is normalised because Airtable does not promise a stable ordering
 * between reads; without that, every sync would look like every record changed
 * and the cache would rewrite itself in full each time.
 */
export function fingerprintRecord(fields: Record<string, unknown> | null | undefined): string {
  if (!fields) return '0';
  const keys = Object.keys(fields).sort();
  let hash = 0;
  for (const key of keys) {
    const chunk = `${key}=${JSON.stringify(fields[key]) ?? ''}`;
    for (let i = 0; i < chunk.length; i += 1) {
      hash = (hash * 31 + chunk.charCodeAt(i)) | 0;
    }
  }
  return `${keys.length}:${(hash >>> 0).toString(36)}`;
}

/** Maps an Airtable record to a cache row, or null if it has no usable id. */
export function toCacheRow(
  record: AirtableRecordLike,
  tableKey: string,
  verifiedAt: string,
): CachedListingRow | null {
  const listingId = cleanRecordId(record.id);
  if (!listingId) return null;
  const fields = (record.fields ?? {}) as Record<string, unknown>;
  return {
    listing_id: listingId,
    table_key: tableKey,
    fields,
    created_time: extractCreatedTime(record),
    last_modified_time: extractLastModified(record),
    fingerprint: fingerprintRecord(fields),
    last_verified_at: verifiedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Deletion reconciliation                                                     */
/* -------------------------------------------------------------------------- */

export type ReconcileDecision = 'reconcile' | 'skip_incomplete' | 'skip_implausible' | 'skip_empty';

export interface ReconcileVerdict {
  decision: ReconcileDecision;
  allowed: boolean;
  /** Why, in a form worth writing to `last_error` and reading in a log. */
  reason: string;
}

/**
 * The largest *share* of the cache a single sync may delete.
 *
 * A run that suddenly cannot see most of the table is usually describing a
 * failure — a truncated walk, a permissions change, a wrong table name — not a
 * real deletion, and acting on it would take the dashboard down for everyone
 * with no way back, because the cache is the only copy.
 */
export const MAX_DELETION_SHARE = 0.75;

/**
 * The largest *absolute* number of records a single sync may delete regardless
 * of share.
 *
 * This exists because the share test alone would have blocked the exact event
 * it is meant to propagate. Airtable's "Delete Records After 30 Days"
 * automation runs `findRecords` with `limit: 1000`, so one night can legitimately
 * remove a thousand records; against the 1,441 currently held that is 69% of the
 * table, and a purely proportional guard would have refused it and quietly
 * stopped the cache mirroring deletions at all.
 *
 * Tied to that automation's limit plus headroom. If the limit changes upstream,
 * this has to change with it.
 */
export const MAX_DELETION_ABSOLUTE = 1_200;

/** Below this a proportional test is meaningless, so it is not applied. */
export const SMALL_TABLE_FLOOR = 20;

export interface ReconcileInput {
  /** Did the walk reach the end of Airtable's pagination without erroring? */
  walkComplete: boolean;
  /** Distinct records the walk actually saw. */
  fetchedCount: number;
  /** Records held after the last clean sync; 0 or null on a first run. */
  previousCount: number | null;
}

/**
 * Decides whether this sync run may delete the rows it did not see.
 *
 * Reconciliation is the only way an upstream deletion reaches the cache, so this
 * cannot simply refuse when unsure — it has to distinguish "Airtable pruned some
 * records" from "this run did not see the whole table". The evidence available
 * is whether the walk finished and how the count compares to the last known-good
 * one.
 */
export function planReconciliation({
  walkComplete,
  fetchedCount,
  previousCount,
}: ReconcileInput): ReconcileVerdict {
  if (!walkComplete) {
    return {
      decision: 'skip_incomplete',
      allowed: false,
      reason: 'walk did not complete; rows it never reached would look deleted',
    };
  }

  if (fetchedCount === 0) {
    // Either the table really is empty or the read silently returned nothing.
    // The second is far more likely and the first is harmless to defer, so a
    // human gets to make this call rather than a cron job at 3am.
    return {
      decision: 'skip_empty',
      allowed: false,
      reason: 'walk returned no records at all; refusing to empty the cache',
    };
  }

  // Nothing to compare against yet: a first sync has no cache to protect.
  if (previousCount === null || previousCount <= 0) {
    return { decision: 'reconcile', allowed: true, reason: 'first sync for this table' };
  }

  const missing = previousCount - fetchedCount;
  if (missing <= 0) {
    return { decision: 'reconcile', allowed: true, reason: 'no net loss against the last clean sync' };
  }

  if (previousCount < SMALL_TABLE_FLOOR) {
    // On a handful of records "half" is one or two, so proportion says nothing.
    return {
      decision: 'reconcile',
      allowed: true,
      reason: `small table (${previousCount}); proportional guard not meaningful`,
    };
  }

  // Two independent allowances, either of which is enough. The absolute one
  // covers a known nightly prune on a table small enough for it to look
  // disproportionate; the share one covers a proportionate change on a table of
  // any size. Only a loss that fails both looks like a broken read.
  const share = missing / previousCount;
  if (missing > MAX_DELETION_ABSOLUTE && share > MAX_DELETION_SHARE) {
    return {
      decision: 'skip_implausible',
      allowed: false,
      reason:
        `saw ${fetchedCount} of ${previousCount} previously cached records ` +
        `(${missing} missing, ${Math.round(share * 100)}%); that is a failed read, not a deletion`,
    };
  }

  return {
    decision: 'reconcile',
    allowed: true,
    reason: `${missing} of ${previousCount} records gone, within the expected band`,
  };
}

/**
 * Whether the walk's ordering can be trusted.
 *
 * `airtable-proxy` silently retries without sorting when a table rejects the
 * sort field, and says nothing about it in the response. Nothing in this cache
 * depends on order — the sync reads the whole table either way — but a sync that
 * quietly stopped being newest-first is worth surfacing, because the client's
 * incremental path does depend on it.
 */
export function orderLooksSorted(createdTimes: Array<string | null>): boolean {
  const stamps = createdTimes
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Date.parse(value))
    .filter((ms) => Number.isFinite(ms));
  if (stamps.length < 3) return true;
  let descending = 0;
  for (let i = 1; i < stamps.length; i += 1) {
    if (stamps[i] <= stamps[i - 1]) descending += 1;
  }
  // Allow for ties and the odd out-of-order record rather than demanding a
  // perfect sort; this is a smoke signal, not a correctness check.
  // 0.8 tolerates ties and the odd stray while a genuinely unsorted read
  // scores around 0.5.
  return descending / (stamps.length - 1) >= 0.8;
}
