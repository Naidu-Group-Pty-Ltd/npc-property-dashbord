/**
 * Client for the server-side listings cache.
 *
 * Reading the property table from Airtable costs `ceil(N/100)` **sequential**
 * round trips through `airtable-proxy`, because the offset for page N+1 only
 * exists once page N has come back. That cost was paid per user, per device, per
 * visit. The `listings-cache` edge function turns it into a single Postgres read
 * shared by everyone, kept warm by cron.
 *
 * This module is deliberately thin and deliberately fallible: every failure
 * returns `null` rather than throwing, so the caller can fall back to the
 * Airtable walk. The cache is an optimisation, and a dashboard that goes blank
 * because a cache was cold is worse than a slow one.
 */
import type { PropertyListing } from '@/lib/airtable';
import { projectAirtableRecord } from '@/lib/airtableListingTransform';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface CachedListingsSyncState {
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  status: string | null;
  reconciled: boolean | null;
  record_count: number | null;
}

export interface CachedListingsResult {
  listings: PropertyListing[];
  /** The table name the server resolved the request to. */
  tableKey: string;
  sync: CachedListingsSyncState | null;
}

interface CacheReadResponse {
  success?: boolean;
  error?: string;
  tableKey?: string;
  records?: Array<{ id?: unknown; createdTime?: unknown; fields?: Record<string, unknown> | null }>;
  sync?: CachedListingsSyncState | null;
}

/**
 * True once the cache has been populated at least once.
 *
 * An empty result is ambiguous on its own — a table with no listings looks
 * exactly like a cache that has never synced — so the caller needs the sync
 * state to tell them apart. Only the second is worth falling back for.
 */
function hasBeenPopulated(sync: CachedListingsSyncState | null | undefined): boolean {
  return Boolean(sync?.last_full_sync_at);
}

export const listingsCacheApi = {
  /**
   * Reads the whole cached set for a table.
   *
   * Returns `null` when the cache cannot answer — not configured, not deployed,
   * never synced, denied, or erroring — which the caller reads as "walk Airtable
   * instead". It does **not** return null for a genuinely empty table that has
   * synced; that is a real answer.
   */
  async read(tableName?: string): Promise<CachedListingsResult | null> {
    let data: CacheReadResponse | null = null;
    try {
      const response = await invokeSecureFunction<CacheReadResponse>('listings-cache', {
        op: 'read',
        ...(tableName ? { tableName } : {}),
      });
      if (response.error) {
        console.warn('[listingsCache] read failed, falling back to Airtable', response.error.message);
        return null;
      }
      data = response.data ?? null;
    } catch (error) {
      console.warn('[listingsCache] read threw, falling back to Airtable', error);
      return null;
    }

    if (!data || data.success === false || data.error) {
      console.warn('[listingsCache] read rejected, falling back to Airtable', data?.error);
      return null;
    }

    const records = Array.isArray(data.records) ? data.records : [];
    const sync = data.sync ?? null;
    if (records.length === 0 && !hasBeenPopulated(sync)) return null;

    const listings = records
      .filter((record): record is { id: string; createdTime?: unknown; fields?: Record<string, unknown> } =>
        typeof record?.id === 'string' && record.id.length > 0,
      )
      .map((record) => {
        const projected = projectAirtableRecord({
          id: record.id,
          createdTime: typeof record.createdTime === 'string' ? record.createdTime : null,
          fields: record.fields ?? {},
        });
        // Mirrors what `airtable.ts` does with the proxy's response: the extended
        // detail panels read the untouched Airtable record, not the projection.
        return { ...projected, rawFields: record.fields ?? undefined } as unknown as PropertyListing;
      });

    return { listings, tableKey: data.tableKey || tableName || '', sync };
  },
};
