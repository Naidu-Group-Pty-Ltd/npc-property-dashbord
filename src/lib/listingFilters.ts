/**
 * The Listings page filter model.
 *
 * Extracted from `Listings.tsx` for two reasons. The predicate is the one piece
 * of that page whose behaviour is worth asserting — "does a listing with no
 * bedroom count survive a 3-bed minimum" is a real question with a real answer,
 * and it was previously buried in a 90-line inline `.filter()`. And the same
 * predicate now has to serve list, table and map identically; a second copy
 * would be how the map quietly starts disagreeing with the table.
 *
 * Pure: no React, no Supabase, no DOM.
 */
import type { PropertyListing } from '@/lib/airtable';
import { normaliseImageCandidates } from '@/lib/listingImages';
import { listingTimestamp, toFiniteNumber, isPlottable } from '@/lib/listingsMap';

export interface ListingFilterState {
  propertyType: string;
  suburb: string;
  state: string;
  zipCode: string;
  sourceHost: string;
  hasInspection: boolean;
  lowConfidence: boolean;
  offMarket: boolean;
  priceMin: string;
  priceMax: string;
  bedsMin: string;
  bedsMax: string;
  bathsMin: string;
  bathsMax: string;
  carsMin: string;
  carsMax: string;
  agencyName: string;
  keywordSearch: string;
  includeNearbySuburbs: boolean;

  /* --- Added dimensions ------------------------------------------------- */

  /** `'all'`, or a day count: only listings first seen inside that window. */
  listedWithinDays: string;
  /** Land size bounds in square metres. */
  landSizeMin: string;
  landSizeMax: string;
  /** Exact `status` value, or `'all'`. */
  status: string;
  /** Only listings with at least one photo on record. */
  hasPhotos: boolean;
  /** Only listings that can actually be placed on the map. */
  mappableOnly: boolean;
  /**
   * Whether a price range should also admit listings with no price.
   *
   * Off by default, and the reason is a behaviour change: the old predicate
   * dropped unpriced listings from *any* price range, with no way to ask for
   * them back. Making it explicit means "$1M–$2M" can still be told apart from
   * "$1M–$2M, plus anything undisclosed".
   */
  includeUndisclosedPrice: boolean;
}

export const DEFAULT_LISTING_FILTERS: ListingFilterState = {
  propertyType: 'all',
  suburb: 'all',
  state: 'all',
  zipCode: 'all',
  sourceHost: 'all',
  hasInspection: false,
  lowConfidence: false,
  offMarket: false,
  priceMin: '',
  priceMax: '',
  bedsMin: '',
  bedsMax: '',
  bathsMin: '',
  bathsMax: '',
  carsMin: '',
  carsMax: '',
  agencyName: 'all',
  keywordSearch: '',
  includeNearbySuburbs: false,
  listedWithinDays: 'all',
  landSizeMin: '',
  landSizeMax: '',
  status: 'all',
  hasPhotos: false,
  mappableOnly: false,
  includeUndisclosedPrice: false,
};

export const LISTED_WITHIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
];

/* -------------------------------------------------------------------------- */
/* Value parsing                                                               */
/* -------------------------------------------------------------------------- */

const SQM_PER_HECTARE = 10_000;
const SQM_PER_ACRE = 4046.86;

/**
 * Land size as square metres.
 *
 * The field is free text from the source: `650`, `"650 m2"`, `"650m²"`,
 * `"0.25 ha"`, `"1.2 acres"`, `"1,012 sqm"`. Anything that cannot be read as an
 * area returns null, and a null is never silently treated as zero — a listing
 * with an unparseable size must not be filtered out as "too small".
 */
export function parseLandSizeSqm(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.trim().toLowerCase();
  if (!text) return null;

  const match = text.match(/(\d[\d,\s]*(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/[,\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (/\bh(a|ectare)/.test(text)) return amount * SQM_PER_HECTARE;
  if (/\bac(re)?/.test(text)) return amount * SQM_PER_ACRE;
  return amount;
}

/** Numeric filter bound, or null when the field is blank/unusable. */
function bound(value: string): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const n = Number(value.replace(/[,\s$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** A count that is actually on record. Zero is a real answer; null and 0 are not. */
function positiveCount(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 ? n : null;
}

/* -------------------------------------------------------------------------- */
/* Predicate                                                                   */
/* -------------------------------------------------------------------------- */

export interface FilterContext {
  /** Free-text query from the page's search box. */
  searchQuery?: string;
  /** Suburbs to accept when `includeNearbySuburbs` is on. */
  nearbySuburbs?: string[] | null;
  /** Resolves a listing's state when the field is empty. */
  extractState?: (address: string) => string | undefined;
  /** Resolves a listing's postcode when the field is empty. */
  extractPostcode?: (address: string) => string | undefined;
  /** Evaluation time, so "last 7 days" is testable. */
  now?: number;
}

/**
 * Whether a range bound should reject a listing whose value is unknown.
 *
 * It should. A minimum is a requirement — "at least 3 bedrooms" cannot be
 * satisfied by a record that does not say how many bedrooms it has, and the old
 * predicate's `listing.beds && …` guard let every such record through every
 * minimum. That made "3+ beds" quietly mean "3+ beds, or no idea".
 */
function withinRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

export function listingHasPhotos(listing: PropertyListing): boolean {
  return normaliseImageCandidates(listing.images).length > 0;
}

export function listingIsMappable(listing: PropertyListing): boolean {
  return isPlottable(toFiniteNumber(listing.latitude), toFiniteNumber(listing.longitude));
}

export function matchesListingFilters(
  listing: PropertyListing,
  filters: ListingFilterState,
  context: FilterContext = {},
): boolean {
  const { searchQuery, nearbySuburbs, extractState, extractPostcode, now = Date.now() } = context;

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    const haystack = [listing.address, listing.suburb, listing.agencyName, listing.agentName]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.keywordSearch) {
    const keywords = filters.keywordSearch.toLowerCase().split(/[,\s]+/).filter(Boolean);
    const content = [
      listing.summary,
      listing.rawExtract,
      listing.keyEntities,
      listing.description,
      listing.address,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!keywords.every((keyword) => content.includes(keyword))) return false;
  }

  if (filters.propertyType !== 'all' && listing.propertyType !== filters.propertyType) return false;

  if (filters.suburb && filters.suburb !== 'all') {
    if (filters.includeNearbySuburbs && nearbySuburbs) {
      if (!listing.suburb || !nearbySuburbs.includes(listing.suburb)) return false;
    } else if (listing.suburb !== filters.suburb) {
      return false;
    }
  }

  if (filters.state && filters.state !== 'all') {
    const state = listing.state || extractState?.(listing.address || '');
    if (state !== filters.state) return false;
  }

  if (filters.zipCode && filters.zipCode !== 'all') {
    const postcode = listing.zipCode || extractPostcode?.(listing.address || '');
    if (postcode !== filters.zipCode) return false;
  }

  if (filters.sourceHost !== 'all' && listing.sourceHost !== filters.sourceHost) return false;
  if (filters.agencyName !== 'all' && listing.agencyName !== filters.agencyName) return false;

  if (filters.status && filters.status !== 'all') {
    if ((listing.status || '').toLowerCase() !== filters.status.toLowerCase()) return false;
  }

  if (filters.hasInspection && !listing.inspectionStart) return false;

  if (filters.lowConfidence && (listing.confidence === undefined || listing.confidence === null || listing.confidence >= 0.7)) {
    return false;
  }

  if (filters.offMarket) {
    const marker = `${listing.status || ''} ${listing.category || ''}`.toLowerCase();
    if (!marker.includes('off-market') && !marker.includes('off market')) return false;
  }

  if (filters.hasPhotos && !listingHasPhotos(listing)) return false;
  if (filters.mappableOnly && !listingIsMappable(listing)) return false;

  // Price. An unpriced listing is admitted only when explicitly asked for.
  const priceMin = bound(filters.priceMin);
  const priceMax = bound(filters.priceMax);
  if (priceMin !== null || priceMax !== null) {
    const price = positiveCount(listing.price);
    if (price === null) {
      if (!filters.includeUndisclosedPrice) return false;
    } else if (!withinRange(price, priceMin, priceMax)) {
      return false;
    }
  }

  if (!withinRange(positiveCount(listing.beds ?? listing.bedrooms), bound(filters.bedsMin), bound(filters.bedsMax))) {
    return false;
  }
  if (!withinRange(positiveCount(listing.baths ?? listing.bathrooms), bound(filters.bathsMin), bound(filters.bathsMax))) {
    return false;
  }
  if (!withinRange(positiveCount(listing.carSpaces), bound(filters.carsMin), bound(filters.carsMax))) {
    return false;
  }
  if (!withinRange(parseLandSizeSqm(listing.landSize), bound(filters.landSizeMin), bound(filters.landSizeMax))) {
    return false;
  }

  if (filters.listedWithinDays && filters.listedWithinDays !== 'all') {
    const days = Number(filters.listedWithinDays);
    if (Number.isFinite(days) && days > 0) {
      const stamp = listingTimestamp(listing);
      // Same rule as the numeric ranges: an undated listing cannot satisfy a
      // recency window, so it is excluded rather than assumed fresh.
      if (stamp === null) return false;
      if (now - stamp > days * 86_400_000) return false;
    }
  }

  return true;
}

/**
 * How many filters are narrowing the result set.
 *
 * `includeNearbySuburbs` is not counted: on its own it widens rather than
 * narrows, and it does nothing at all without a suburb selected.
 */
export function activeListingFilterCount(filters: ListingFilterState): number {
  let count = 0;
  for (const [key, value] of Object.entries(filters) as Array<
    [keyof ListingFilterState, string | boolean]
  >) {
    if (key === 'includeNearbySuburbs' || key === 'includeUndisclosedPrice') continue;
    const fallback = DEFAULT_LISTING_FILTERS[key];
    if (value !== fallback) count += 1;
  }
  return count;
}
