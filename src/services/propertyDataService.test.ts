import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { airtableService, PropertyListing } from '@/lib/airtable';
import { __setIndexedDBFactory } from '@/lib/listingCache';
import { propertyDataService } from './propertyDataService';

const makeListing = (id: number): PropertyListing => ({
  id: String(id),
  title: `Listing ${id}`,
  price: 500_000,
  location: 'Sydney',
  bedrooms: 2,
  bathrooms: 1,
  propertyType: 'Apartment',
  listingDate: '2026-01-01',
  status: 'active',
  confidence: 1,
  source: 'Airtable',
  description: '',
  images: [],
  agent: '',
  features: [],
});

describe('propertyDataService cache', () => {
  beforeEach(() => {
    propertyDataService.clearCache();
    vi.restoreAllMocks();
    // jsdom has no IndexedDB; these cover the in-memory and network paths.
    __setIndexedDBFactory(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not reuse a limited fetch for a later unlimited request', async () => {
    const records = Array.from({ length: 250 }, (_, index) => makeListing(index));
    const getRecords = vi.spyOn(airtableService, 'getRecords').mockImplementation(async ({ offset }) => {
      const start = offset ? Number(offset) : 0;
      const next = start + 100;

      return {
        records: records.slice(start, next),
        offset: next < records.length ? String(next) : undefined,
        total: records.length,
      };
    });

    const limited = await propertyDataService.fetchAllListings({
      tableName: 'Listings',
      maxRecords: 10,
    });
    const unlimited = await propertyDataService.fetchAllListings({ tableName: 'Listings' });

    expect(limited.listings).toHaveLength(10);
    expect(unlimited.listings).toHaveLength(250);
    expect(unlimited.debugInfo.fromCache).toBe(false);
    expect(getRecords).toHaveBeenCalledTimes(4);
  });
});

/**
 * The network is the entire cost being optimised, so most of what follows counts
 * requests. A cold read is one sequential request per 100 records — every
 * behaviour here exists to avoid making that walk again.
 */
describe('propertyDataService request economy', () => {
  /** Serves `pages` in order, exposing an offset until the last one. */
  function servePages(pages: PropertyListing[][]) {
    let index = 0;
    return vi.spyOn(airtableService, 'getRecords').mockImplementation(async () => {
      const page = pages[Math.min(index, pages.length - 1)] ?? [];
      const hasMore = index < pages.length - 1;
      index += 1;
      return { records: page, offset: hasMore ? `off${index}` : undefined, total: 0 };
    });
  }

  const ids = (listings: PropertyListing[] | null | undefined) => listings?.map((l) => l.id);

  beforeEach(() => {
    propertyDataService.clearCache();
    vi.restoreAllMocks();
    __setIndexedDBFactory(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves concurrent callers from a single walk', async () => {
    // Overview and Listings mount within milliseconds of each other and both ask
    // for the whole table; without coalescing the entire walk ran twice, in
    // parallel, against one rate limit.
    const getRecords = servePages([[makeListing(1)], [makeListing(2)], [makeListing(3)]]);
    const results = await Promise.all([
      propertyDataService.fetchAllListings(),
      propertyDataService.fetchAllListings(),
      propertyDataService.fetchAllListings(),
    ]);
    expect(getRecords).toHaveBeenCalledTimes(3); // three pages, not nine
    expect(ids(results[0].listings)).toEqual(ids(results[1].listings));
    expect(ids(results[1].listings)).toEqual(ids(results[2].listings));
  });

  it('answers a warm cache with no request at all', async () => {
    const getRecords = servePages([[makeListing(1)]]);
    await propertyDataService.fetchAllListings();
    getRecords.mockClear();

    const result = await propertyDataService.fetchAllListings({ includeDebugInfo: true });
    expect(getRecords).not.toHaveBeenCalled();
    expect(result.debugInfo.fromCache).toBe(true);
  });

  it('exposes the set synchronously for a first paint', async () => {
    servePages([[makeListing(1)]]);
    expect(propertyDataService.peek()).toBeNull();
    await propertyDataService.fetchAllListings();
    expect(ids(propertyDataService.peek())).toEqual(['1']);
  });

  it('does not strand later callers when a shared walk fails', async () => {
    vi.spyOn(airtableService, 'getRecords').mockRejectedValueOnce(new Error('airtable down'));
    await expect(propertyDataService.fetchAllListings()).rejects.toThrow('airtable down');
    servePages([[makeListing(1)]]);
    await expect(propertyDataService.fetchAllListings()).resolves.toBeTruthy();
  });

  describe('incremental revalidation', () => {
    /** Warms the cache, then moves the clock past the freshness window. */
    async function warmThenAge(pages: PropertyListing[][], ageMs: number) {
      servePages(pages);
      await propertyDataService.fetchAllListings();
      vi.restoreAllMocks();
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + ageMs);
    }

    it('stops at the first familiar page instead of re-walking the table', async () => {
      await warmThenAge([[makeListing(1), makeListing(2)], [makeListing(3)]], 5 * 60_000);
      const getRecords = servePages([[makeListing(99), makeListing(1)], [makeListing(2)]]);

      const result = await propertyDataService.fetchAllListings({ includeDebugInfo: true });
      // Answered from cache immediately; the refresh happens behind the render.
      expect(result.debugInfo.fromCache).toBe(true);

      await vi.waitFor(() => expect(ids(propertyDataService.peek())).toContain('99'));
      expect(ids(propertyDataService.peek())).toEqual(['99', '1', '2', '3']);
      expect(getRecords.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('costs one request when nothing has been added', async () => {
      await warmThenAge([[makeListing(1), makeListing(2)]], 5 * 60_000);
      const getRecords = servePages([[makeListing(1), makeListing(2)]]);
      await propertyDataService.fetchAllListings();
      await vi.waitFor(() => expect(getRecords).toHaveBeenCalledTimes(1));
      expect(ids(propertyDataService.peek())).toEqual(['1', '2']);
    });

    it('tells subscribers when the background refresh lands', async () => {
      await warmThenAge([[makeListing(1)]], 5 * 60_000);
      const seen: (string[] | undefined)[] = [];
      const unsubscribe = propertyDataService.subscribe(undefined, (result) =>
        seen.push(ids(result.listings)),
      );
      servePages([[makeListing(99), makeListing(1)]]);

      await propertyDataService.fetchAllListings();
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(seen.at(-1)).toEqual(['99', '1']);
      unsubscribe();
    });

    it('escalates to a full read once the last complete read is old enough', async () => {
      // Past the reconcile window an incremental walk could be hiding an edit to
      // an older record, which it cannot see — Airtable sorts on Created.
      await warmThenAge([[makeListing(1)], [makeListing(2)]], 31 * 60_000);
      const getRecords = servePages([[makeListing(1)], [makeListing(2)]]);
      await propertyDataService.fetchAllListings();
      await vi.waitFor(() => expect(getRecords).toHaveBeenCalledTimes(2));
    });

    it('keeps showing the cache when a background refresh fails', async () => {
      await warmThenAge([[makeListing(1)]], 5 * 60_000);
      const getRecords = vi
        .spyOn(airtableService, 'getRecords')
        .mockRejectedValue(new Error('airtable down'));

      const result = await propertyDataService.fetchAllListings();
      expect(ids(result.listings)).toEqual(['1']);
      await vi.waitFor(() => expect(getRecords).toHaveBeenCalled());
      // A failed refresh must never empty what the page is already showing.
      expect(ids(propertyDataService.peek())).toEqual(['1']);
    });
  });
});
