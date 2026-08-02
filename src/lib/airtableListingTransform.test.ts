import { describe, expect, it } from 'vitest';
import { projectAirtableRecord } from './airtableListingTransform';

/**
 * This projection used to live inline inside `airtable-proxy`'s request handler
 * and had no coverage at all. It now has two callers on two runtimes — the proxy
 * and the client reading `listings-cache` — so a silent change to it would make
 * a field populated on one path and blank on the other. These lock the mapping.
 */
describe('projectAirtableRecord', () => {
  const at = () => Date.parse('2026-08-02T00:00:00.000Z');

  it('maps the fields the dashboard actually renders', () => {
    const listing = projectAirtableRecord(
      {
        id: 'rec1',
        createdTime: '2026-06-11T07:18:31.000Z',
        fields: {
          Address: '12 Example St',
          Suburb: 'Parramatta, NSW 2150',
          Price: 900_000,
          Beds: '3',
          Baths: 2,
          'Property Type': 'residential home',
          'Agent Name': 'A. Agent',
          'Agency Name': 'Example Realty',
        },
      },
      at,
    );

    expect(listing).toMatchObject({
      id: 'rec1',
      address: '12 Example St',
      // The state/postcode tail is dropped so suburbs group.
      suburb: 'Parramatta',
      location: '12 Example St, Parramatta',
      price: 900_000,
      beds: 3,
      bedrooms: 3,
      baths: 2,
      propertyType: 'House',
      agentName: 'A. Agent',
      agencyName: 'Example Realty',
    });
  });

  it('carries the untouched record through as `fields`', () => {
    // The intake table has 205 columns and only a fraction are mapped above; the
    // extended detail panels read the original.
    const fields = { Address: '1 St', Some_Unmapped_Column: 'kept' };
    expect(projectAirtableRecord({ id: 'rec1', fields }, at).fields).toEqual(fields);
  });

  it('rejects prices that cannot be real rather than skewing every average', () => {
    expect(projectAirtableRecord({ id: 'r', fields: { Price: 0 } }, at).price).toBeNull();
    expect(projectAirtableRecord({ id: 'r', fields: { Price: 9e9 } }, at).price).toBeNull();
    expect(projectAirtableRecord({ id: 'r', fields: { Price: '$1,250,000' } }, at).price).toBe(
      1_250_000,
    );
  });

  it('normalises confidence given as either a fraction or a percentage', () => {
    expect(projectAirtableRecord({ id: 'r', fields: { Confidence: 0.82 } }, at).confidence).toBe(
      0.82,
    );
    expect(projectAirtableRecord({ id: 'r', fields: { Confidence: 82 } }, at).confidence).toBe(0.82);
  });

  it('prefers Created over the record metadata for the display date', () => {
    const listing = projectAirtableRecord(
      {
        id: 'r',
        createdTime: '2020-01-01T00:00:00.000Z',
        fields: { Created: '2026-06-11T07:18:31.000Z' },
      },
      at,
    );
    expect(listing.createdTime).toBe('2026-06-11T07:18:31.000Z');
    expect(listing.listingDate).toBe('2026-06-11T07:18:31.000Z');
  });

  it('falls back to now for an undated record', () => {
    // Display only. `listingsCache.pure.ts#extractCreatedTime` deliberately does
    // not do this — a value that resets on every read would make an undated
    // record permanently fresh in a cache whose retention is a 30-day window.
    expect(projectAirtableRecord({ id: 'r', fields: {} }, at).createdTime).toBe(
      '2026-08-02T00:00:00.000Z',
    );
  });

  it('survives a record with no fields at all', () => {
    const listing = projectAirtableRecord({ id: 'r' }, at);
    expect(listing).toMatchObject({
      id: 'r',
      title: 'Untitled Property',
      address: 'Unknown Address',
      suburb: 'Unknown Suburb',
      agent: 'Unknown Agent',
      propertyType: 'Unknown',
      price: null,
      beds: null,
    });
  });
});
