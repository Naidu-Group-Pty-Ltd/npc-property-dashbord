import { beforeEach, describe, expect, it, vi } from 'vitest';
import { airtableService, PropertyListing } from '@/lib/airtable';
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
