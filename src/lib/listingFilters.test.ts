import { describe, expect, it } from 'vitest';
import type { PropertyListing } from '@/lib/airtable';
import {
  activeListingFilterCount,
  DEFAULT_LISTING_FILTERS,
  listingHasPhotos,
  listingIsMappable,
  matchesListingFilters,
  parseLandSizeSqm,
  type ListingFilterState,
} from '@/lib/listingFilters';

const NOW = Date.UTC(2026, 7, 2);
const DAY = 86_400_000;

function makeListing(overrides: Partial<PropertyListing> = {}): PropertyListing {
  return {
    id: 'rec1',
    title: 'Listing',
    price: 900_000,
    location: 'Parramatta NSW',
    bedrooms: 3,
    bathrooms: 2,
    propertyType: 'House',
    listingDate: new Date(NOW - 3 * DAY).toISOString(),
    status: 'Available',
    confidence: 0.9,
    source: 'test',
    description: '',
    images: [],
    agent: '',
    features: [],
    suburb: 'Parramatta',
    state: 'NSW',
    zipCode: '2150',
    beds: 3,
    baths: 2,
    carSpaces: 1,
    ...overrides,
  } as PropertyListing;
}

const filters = (over: Partial<ListingFilterState> = {}): ListingFilterState => ({
  ...DEFAULT_LISTING_FILTERS,
  ...over,
});

const matches = (listing: PropertyListing, over: Partial<ListingFilterState> = {}) =>
  matchesListingFilters(listing, filters(over), { now: NOW });

describe('parseLandSizeSqm', () => {
  it('reads the units the sources actually use', () => {
    expect(parseLandSizeSqm(650)).toBe(650);
    expect(parseLandSizeSqm('650')).toBe(650);
    expect(parseLandSizeSqm('650 m2')).toBe(650);
    expect(parseLandSizeSqm('650m²')).toBe(650);
    expect(parseLandSizeSqm('1,012 sqm')).toBe(1012);
    expect(parseLandSizeSqm('0.25 ha')).toBe(2500);
    expect(parseLandSizeSqm('2 hectares')).toBe(20_000);
    expect(parseLandSizeSqm('1.2 acres')).toBeCloseTo(4856.2, 0);
  });

  it('returns null rather than zero for anything unreadable', () => {
    for (const value of ['', '   ', 'on request', 'TBA', null, undefined, {}, -5, 0]) {
      expect(parseLandSizeSqm(value)).toBeNull();
    }
  });
});

describe('matchesListingFilters — unknown values against a minimum', () => {
  it('excludes a listing with no bedroom count from a bedroom minimum', () => {
    // The old inline predicate guarded on `listing.beds && …`, so "3+ beds"
    // silently also meant "or no idea". A minimum is a requirement.
    const unknown = makeListing({ beds: null, bedrooms: null });
    expect(matches(unknown, { bedsMin: '3' })).toBe(false);
    expect(matches(unknown)).toBe(true);
  });

  it('applies the same rule to baths, cars and land size', () => {
    expect(matches(makeListing({ baths: null, bathrooms: null }), { bathsMin: '2' })).toBe(false);
    expect(matches(makeListing({ carSpaces: null }), { carsMin: '1' })).toBe(false);
    expect(matches(makeListing({ landSize: null }), { landSizeMin: '400' })).toBe(false);
    expect(matches(makeListing({ landSize: 'on request' }), { landSizeMin: '400' })).toBe(false);
  });

  it('still admits unknowns when no bound is set', () => {
    const bare = makeListing({ beds: null, baths: null, carSpaces: null, landSize: null });
    expect(matches(bare)).toBe(true);
  });

  it('falls back to the legacy bedroom/bathroom fields', () => {
    const legacy = makeListing({ beds: null, baths: null, bedrooms: 4, bathrooms: 3 });
    expect(matches(legacy, { bedsMin: '4', bathsMin: '3' })).toBe(true);
    expect(matches(legacy, { bedsMin: '5' })).toBe(false);
  });
});

describe('matchesListingFilters — price', () => {
  it('applies the range to priced listings', () => {
    expect(matches(makeListing({ price: 900_000 }), { priceMin: '800000', priceMax: '1000000' })).toBe(true);
    expect(matches(makeListing({ price: 1_400_000 }), { priceMax: '1000000' })).toBe(false);
    expect(matches(makeListing({ price: 400_000 }), { priceMin: '800000' })).toBe(false);
  });

  it('drops undisclosed prices from a range by default, and admits them on request', () => {
    const undisclosed = makeListing({ price: null });
    expect(matches(undisclosed, { priceMin: '800000' })).toBe(false);
    expect(matches(undisclosed, { priceMin: '800000', includeUndisclosedPrice: true })).toBe(true);
    // With no range at all, the toggle is irrelevant.
    expect(matches(undisclosed)).toBe(true);
  });

  it('treats a zero price as undisclosed, not as free', () => {
    expect(matches(makeListing({ price: 0 }), { priceMax: '1000000' })).toBe(false);
  });

  it('tolerates formatted input in the bounds', () => {
    expect(matches(makeListing({ price: 900_000 }), { priceMin: '$800,000', priceMax: '1 000 000' })).toBe(true);
  });
});

describe('matchesListingFilters — recency', () => {
  it('keeps listings inside the window and drops the rest', () => {
    const fresh = makeListing({ listingDate: new Date(NOW - 2 * DAY).toISOString() });
    const stale = makeListing({ listingDate: new Date(NOW - 45 * DAY).toISOString() });
    expect(matches(fresh, { listedWithinDays: '7' })).toBe(true);
    expect(matches(stale, { listedWithinDays: '7' })).toBe(false);
    expect(matches(stale, { listedWithinDays: '90' })).toBe(true);
  });

  it('excludes an undated listing from a recency window rather than assuming it is fresh', () => {
    const undated = makeListing({ listingDate: '', receivedAt: undefined, createdTime: undefined, createdAt: undefined });
    expect(matches(undated, { listedWithinDays: '7' })).toBe(false);
    expect(matches(undated)).toBe(true);
  });

  it('ignores the window when set to all', () => {
    const ancient = makeListing({ listingDate: new Date(NOW - 900 * DAY).toISOString() });
    expect(matches(ancient, { listedWithinDays: 'all' })).toBe(true);
  });
});

describe('matchesListingFilters — photos and mappability', () => {
  it('finds photos in an Airtable attachment field, not just in string URLs', () => {
    const attachment = makeListing({
      images: [{ id: 'att1', url: 'https://v5.airtableusercontent.com/a.jpg' }] as unknown as string[],
    });
    expect(listingHasPhotos(attachment)).toBe(true);
    expect(matches(attachment, { hasPhotos: true })).toBe(true);
    expect(matches(makeListing({ images: [] }), { hasPhotos: true })).toBe(false);
  });

  it('does not count junk in the image field as a photo', () => {
    const junk = makeListing({ images: ['', 'undefined', 'not a url'] as unknown as string[] });
    expect(listingHasPhotos(junk)).toBe(false);
  });

  it('treats the 0/0 geocoder sentinel as unmappable', () => {
    expect(listingIsMappable(makeListing({ latitude: -33.8, longitude: 151.2 }))).toBe(true);
    expect(listingIsMappable(makeListing({ latitude: 0, longitude: 0 }))).toBe(false);
    expect(listingIsMappable(makeListing({ latitude: null, longitude: null }))).toBe(false);
    expect(matches(makeListing({ latitude: null, longitude: null }), { mappableOnly: true })).toBe(false);
  });
});

describe('matchesListingFilters — categorical', () => {
  it('matches status case-insensitively', () => {
    expect(matches(makeListing({ status: 'Under Offer' }), { status: 'under offer' })).toBe(true);
    expect(matches(makeListing({ status: 'Available' }), { status: 'Under Offer' })).toBe(false);
  });

  it('honours nearby suburbs only when the toggle is on', () => {
    const listing = makeListing({ suburb: 'Harris Park' });
    const ctx = { now: NOW, nearbySuburbs: ['Parramatta', 'Harris Park'] };
    expect(matchesListingFilters(listing, filters({ suburb: 'Parramatta' }), ctx)).toBe(false);
    expect(
      matchesListingFilters(listing, filters({ suburb: 'Parramatta', includeNearbySuburbs: true }), ctx),
    ).toBe(true);
  });

  it('falls back to address extraction for state and postcode', () => {
    const listing = makeListing({ state: undefined, zipCode: undefined, address: '1 Test St, Parramatta NSW 2150' });
    const ctx = {
      now: NOW,
      extractState: () => 'NSW',
      extractPostcode: () => '2150',
    };
    expect(matchesListingFilters(listing, filters({ state: 'NSW' }), ctx)).toBe(true);
    expect(matchesListingFilters(listing, filters({ zipCode: '2150' }), ctx)).toBe(true);
    expect(matchesListingFilters(listing, filters({ state: 'VIC' }), ctx)).toBe(false);
  });

  it('requires every keyword, not just one', () => {
    const listing = makeListing({ summary: 'renovated kitchen with pool' });
    expect(matches(listing, { keywordSearch: 'pool kitchen' })).toBe(true);
    expect(matches(listing, { keywordSearch: 'pool tennis' })).toBe(false);
  });
});

describe('activeListingFilterCount', () => {
  it('counts nothing for the defaults', () => {
    expect(activeListingFilterCount(DEFAULT_LISTING_FILTERS)).toBe(0);
  });

  it('counts each narrowing filter once', () => {
    expect(activeListingFilterCount(filters({ propertyType: 'House' }))).toBe(1);
    expect(activeListingFilterCount(filters({ propertyType: 'House', hasPhotos: true }))).toBe(2);
    expect(activeListingFilterCount(filters({ priceMin: '1', priceMax: '2' }))).toBe(2);
  });

  it('ignores the two modifiers that do not narrow on their own', () => {
    expect(activeListingFilterCount(filters({ includeNearbySuburbs: true }))).toBe(0);
    expect(activeListingFilterCount(filters({ includeUndisclosedPrice: true }))).toBe(0);
  });
});
