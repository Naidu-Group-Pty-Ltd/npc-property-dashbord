import { describe, expect, it } from 'vitest';
import type { PropertyListing } from '@/lib/airtable';
import {
  buildHeatModel,
  calibrateHeatMax,
  computePriceTiers,
  describeHeatLegend,
  escapeHtml,
  formatCompactAud,
  formatFullAud,
  getStoredListingPoint,
  heatGeometryForZoom,
  listingSetSignature,
  listingTimestamp,
  priceTier,
  propertyGlyph,
  PROPERTY_GLYPHS,
  quantile,
  type WeightedListing,
} from '@/lib/listingsMap';

function makeListing(overrides: Partial<PropertyListing> = {}): PropertyListing {
  return {
    id: overrides.id ?? 'rec1',
    title: 'Listing',
    price: null,
    location: '',
    bedrooms: null,
    bathrooms: null,
    propertyType: 'House',
    listingDate: '',
    status: 'active',
    confidence: null,
    source: 'test',
    description: '',
    images: [],
    agent: '',
    features: [],
    ...overrides,
  } as PropertyListing;
}

function weighted(listings: PropertyListing[]): WeightedListing[] {
  return listings.map((listing, index) => ({
    listing,
    point: { lat: -33.86 + index * 0.01, lng: 151.2 + index * 0.01 },
  }));
}

describe('getStoredListingPoint', () => {
  it('accepts numeric and string coordinates', () => {
    expect(getStoredListingPoint(makeListing({ latitude: -33.87, longitude: 151.2 }))).toEqual({
      lat: -33.87,
      lng: 151.2,
    });
    expect(getStoredListingPoint(makeListing({ latitude: '-33.87', longitude: '151.2' }))).toEqual({
      lat: -33.87,
      lng: 151.2,
    });
  });

  it('rejects missing, non-numeric and out-of-range values', () => {
    expect(getStoredListingPoint(makeListing())).toBeNull();
    expect(getStoredListingPoint(makeListing({ latitude: '', longitude: '' }))).toBeNull();
    expect(getStoredListingPoint(makeListing({ latitude: 'abc', longitude: '151' }))).toBeNull();
    expect(getStoredListingPoint(makeListing({ latitude: 99, longitude: 151 }))).toBeNull();
    expect(getStoredListingPoint(makeListing({ latitude: -33, longitude: 999 }))).toBeNull();
  });

  it('rejects the 0/0 null-island sentinel', () => {
    expect(getStoredListingPoint(makeListing({ latitude: 0, longitude: 0 }))).toBeNull();
  });
});

describe('price tiers', () => {
  it('needs at least four priced listings before banding', () => {
    expect(computePriceTiers([100, 200, 300])).toBeNull();
    expect(computePriceTiers([])).toBeNull();
  });

  it('splits prices into quartile bands', () => {
    const tiers = computePriceTiers([100, 200, 300, 400, 500]);
    expect(tiers).not.toBeNull();
    expect(priceTier(100, tiers)).toBe('low');
    expect(priceTier(250, tiers)).toBe('mid');
    expect(priceTier(350, tiers)).toBe('high');
    expect(priceTier(500, tiers)).toBe('top');
  });

  it('marks unpriced listings as unknown regardless of banding', () => {
    const tiers = computePriceTiers([100, 200, 300, 400]);
    expect(priceTier(null, tiers)).toBe('unknown');
    expect(priceTier(0, tiers)).toBe('unknown');
    expect(priceTier(undefined, null)).toBe('unknown');
  });

  it('ignores zero and negative prices when banding', () => {
    const tiers = computePriceTiers([0, -5, 100, 200, 300, 400]);
    expect(tiers?.q1).toBeGreaterThan(0);
  });
});

describe('propertyGlyph', () => {
  it('maps the common portal vocabularies onto a glyph', () => {
    expect(propertyGlyph('House')).toBe('house');
    expect(propertyGlyph('Townhouse')).toBe('house');
    expect(propertyGlyph('Villa')).toBe('house');
    expect(propertyGlyph('Apartment')).toBe('apartment');
    expect(propertyGlyph('Unit/Apartment')).toBe('apartment');
    expect(propertyGlyph('Vacant Land')).toBe('land');
    expect(propertyGlyph('Semi-Rural Acreage')).toBe('land');
    expect(propertyGlyph('Retail')).toBe('commercial');
  });

  it('falls back to the generic glyph when the type says nothing', () => {
    expect(propertyGlyph('Unknown')).toBe('property');
    expect(propertyGlyph('')).toBe('property');
    expect(propertyGlyph(null)).toBe('property');
    expect(propertyGlyph(undefined)).toBe('property');
    expect(propertyGlyph('Retirement Living')).toBe('property');
  });

  it('resolves mixed types by specificity rather than word order', () => {
    // A strata word beats a structure word, a trade word beats both, and a
    // structure beats a bare parcel.
    expect(propertyGlyph('Apartment Block')).toBe('apartment');
    expect(propertyGlyph('Commercial Land')).toBe('commercial');
    expect(propertyGlyph('House and Land')).toBe('house');
    expect(propertyGlyph('Residential Land')).toBe('land');
  });

  it('does not match a vocabulary word buried inside another word', () => {
    expect(propertyGlyph('Landscaped Estate')).toBe('property');
  });

  it('only ever returns a glyph the pin renderer knows about', () => {
    for (const type of ['House', 'Unit', 'Land', 'Office', 'Gibberish', '']) {
      expect(PROPERTY_GLYPHS).toContain(propertyGlyph(type));
    }
  });
});

describe('quantile', () => {
  it('interpolates between samples', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe('buildHeatModel', () => {
  it('weights every listing equally for density', () => {
    const model = buildHeatModel(weighted([makeListing({ id: 'a', price: 100 }), makeListing({ id: 'b', price: 10_000_000 })]), 'density');
    expect(model.points.map((p) => p.intensity)).toEqual([1, 1]);
    expect(model.scale).toBeNull();
  });

  it('uses a log scale for price so one trophy listing cannot flatten the ramp', () => {
    const rows = weighted([
      makeListing({ id: 'a', price: 500_000 }),
      makeListing({ id: 'b', price: 1_000_000 }),
      makeListing({ id: 'c', price: 50_000_000 }),
    ]);
    const model = buildHeatModel(rows, 'price');
    const [cheap, mid, trophy] = model.points.map((p) => p.intensity);

    expect(trophy).toBeCloseTo(1, 5);
    expect(cheap).toBeLessThan(mid);
    expect(mid).toBeLessThan(trophy);
    // Linear weighting would put the middle listing at ~0.02 of the top.
    expect(mid).toBeGreaterThan(0.3);
    expect(model.scale).toEqual({
      min: 500_000,
      max: 50_000_000,
      median: 1_000_000,
      sampled: 3,
    });
  });

  it('gives unpriced listings the floor weight rather than dropping them', () => {
    const rows = weighted([
      makeListing({ id: 'a', price: 500_000 }),
      makeListing({ id: 'b', price: 900_000 }),
      makeListing({ id: 'c', price: null }),
    ]);
    const model = buildHeatModel(rows, 'price');
    expect(model.points).toHaveLength(3);
    expect(model.points[2].intensity).toBeGreaterThan(0);
    expect(model.points[2].intensity).toBeLessThan(model.points[0].intensity);
  });

  it('falls back to uniform weighting when no listing carries the metric', () => {
    const rows = weighted([makeListing({ id: 'a' }), makeListing({ id: 'b' })]);
    expect(buildHeatModel(rows, 'price').points.every((p) => p.intensity === 1)).toBe(true);
    expect(buildHeatModel(rows, 'recency').points.every((p) => p.intensity === 1)).toBe(true);
  });

  it('scores the newest listing hottest for recency', () => {
    const rows = weighted([
      makeListing({ id: 'old', listingDate: '2024-01-01T00:00:00.000Z' }),
      makeListing({ id: 'new', listingDate: '2026-01-01T00:00:00.000Z' }),
    ]);
    const model = buildHeatModel(rows, 'recency');
    expect(model.points[1].intensity).toBeGreaterThan(model.points[0].intensity);
    expect(model.points[1].intensity).toBeCloseTo(1, 5);
  });

  it('returns an empty model for no rows', () => {
    expect(buildHeatModel([], 'price')).toEqual({
      metric: 'price',
      points: [],
      scale: null,
      minCeiling: 4,
    });
  });

  it('asks for a multi-point ceiling on density and a single-weight ceiling when weighted', () => {
    const rows = weighted([
      makeListing({ id: 'a', price: 500_000 }),
      makeListing({ id: 'b', price: 5_000_000 }),
    ]);
    expect(buildHeatModel(rows, 'density').minCeiling).toBeGreaterThan(1);
    expect(buildHeatModel(rows, 'price').minCeiling).toBeCloseTo(1, 5);
    // A metric with no usable data degrades to uniform weighting *and* its ceiling.
    expect(buildHeatModel(weighted([makeListing({ id: 'x' })]), 'price').minCeiling).toBe(
      buildHeatModel(weighted([makeListing({ id: 'x' })]), 'density').minCeiling,
    );
  });
});

describe('describeHeatLegend', () => {
  it('reports real currency bounds for the price metric', () => {
    const rows = weighted([
      makeListing({ id: 'a', price: 450_000 }),
      makeListing({ id: 'b', price: 900_000 }),
      makeListing({ id: 'c', price: 2_100_000 }),
    ]);
    const legend = describeHeatLegend(buildHeatModel(rows, 'price'));
    expect(legend.title).toBe('Price intensity');
    expect(legend.lowLabel).toBe(formatCompactAud(450_000));
    expect(legend.highLabel).toBe(formatCompactAud(2_100_000));
  });

  it('reports relative ages for the recency metric', () => {
    const now = Date.parse('2026-07-31T00:00:00.000Z');
    const rows = weighted([
      makeListing({ id: 'a', listingDate: '2026-07-01T00:00:00.000Z' }),
      makeListing({ id: 'b', listingDate: '2026-07-30T00:00:00.000Z' }),
    ]);
    const legend = describeHeatLegend(buildHeatModel(rows, 'recency'), now);
    expect(legend.title).toBe('Listing freshness');
    expect(legend.lowLabel).toBe('1 month ago');
    expect(legend.highLabel).toBe('1 day ago');
  });

  it('falls back to a density description', () => {
    const legend = describeHeatLegend(buildHeatModel(weighted([makeListing()]), 'density'));
    expect(legend.title).toBe('Listing density');
    expect(legend.midLabel).toBeNull();
  });
});

describe('heatGeometryForZoom', () => {
  it('grows the radius with zoom so the surface stays legible', () => {
    const country = heatGeometryForZoom(4, 'balanced');
    const suburb = heatGeometryForZoom(15, 'balanced');
    expect(suburb.radius).toBeGreaterThan(country.radius);
    expect(suburb.blur).toBeGreaterThan(country.blur);
  });

  it('clamps to a sane pixel range at both extremes', () => {
    expect(heatGeometryForZoom(0, 'tight').radius).toBeGreaterThanOrEqual(10);
    expect(heatGeometryForZoom(22, 'wide').radius).toBeLessThanOrEqual(62);
  });

  it('scales with the focus setting', () => {
    const tight = heatGeometryForZoom(12, 'tight').radius;
    const balanced = heatGeometryForZoom(12, 'balanced').radius;
    const wide = heatGeometryForZoom(12, 'wide').radius;
    expect(tight).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(wide);
  });

  it('tolerates a non-finite zoom', () => {
    expect(Number.isFinite(heatGeometryForZoom(Number.NaN, 'balanced').radius)).toBe(true);
  });
});

describe('calibrateHeatMax', () => {
  it('returns a neutral ceiling with no points', () => {
    expect(calibrateHeatMax([], 24, 'balanced')).toBe(1);
  });

  it('never returns a ceiling below the heaviest single point', () => {
    const max = calibrateHeatMax([{ x: 10, y: 10, weight: 0.8 }], 24, 'balanced');
    expect(max).toBeGreaterThanOrEqual(0.8);
  });

  it('rises when points pile into the same screen cell', () => {
    const spread = Array.from({ length: 20 }, (_, i) => ({ x: i * 200, y: 0, weight: 1 }));
    const stacked = Array.from({ length: 20 }, () => ({ x: 5, y: 5, weight: 1 }));
    expect(calibrateHeatMax(stacked, 24, 'balanced')).toBeGreaterThan(
      calibrateHeatMax(spread, 24, 'balanced'),
    );
  });

  it('saturates more readily with a wider focus', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      x: (i % 8) * 4,
      y: Math.floor(i / 8) * 4,
      weight: 1,
    }));
    const tight = calibrateHeatMax(points, 24, 'tight');
    const wide = calibrateHeatMax(points, 24, 'wide');
    expect(wide).toBeLessThanOrEqual(tight);
  });

  it('honours the dataset-wide ceiling so zooming into a cheap pocket stays cool', () => {
    // One lightweight point on screen; the dataset elsewhere reaches 1.0.
    const local = [{ x: 40, y: 40, weight: 0.3 }];
    expect(calibrateHeatMax(local, 24, 'balanced')).toBeCloseTo(0.3, 5);
    expect(calibrateHeatMax(local, 24, 'balanced', 1)).toBe(1);
  });

  it('keeps an isolated density point below the density ceiling', () => {
    const lone = [{ x: 40, y: 40, weight: 1 }];
    expect(calibrateHeatMax(lone, 24, 'balanced', 4)).toBe(4);
  });

  it('still lets a dense cluster exceed the dataset ceiling', () => {
    const stacked = Array.from({ length: 12 }, () => ({ x: 5, y: 5, weight: 1 }));
    expect(calibrateHeatMax(stacked, 24, 'balanced', 4)).toBeGreaterThan(4);
  });

  it('ignores non-finite projections', () => {
    const max = calibrateHeatMax(
      [
        { x: Number.NaN, y: 0, weight: 1 },
        { x: 4, y: 4, weight: 0.5 },
      ],
      24,
      'balanced',
    );
    expect(Number.isFinite(max)).toBe(true);
  });
});

describe('listingTimestamp', () => {
  it('prefers the listing date and falls back through the other stamps', () => {
    expect(listingTimestamp(makeListing({ listingDate: '2026-02-01T00:00:00.000Z' }))).toBe(
      Date.parse('2026-02-01T00:00:00.000Z'),
    );
    expect(
      listingTimestamp(makeListing({ listingDate: '', receivedAt: '2026-03-01T00:00:00.000Z' })),
    ).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    expect(listingTimestamp(makeListing({ listingDate: 'not-a-date' }))).toBeNull();
    expect(listingTimestamp(makeListing())).toBeNull();
  });

  it('accepts Date instances', () => {
    const when = new Date('2026-04-01T00:00:00.000Z');
    expect(listingTimestamp(makeListing({ receivedAt: when }))).toBe(when.getTime());
  });
});

describe('listingSetSignature', () => {
  it('is stable for the same set and changes when the set changes', () => {
    const a = listingSetSignature([{ id: 'x' }, { id: 'y' }]);
    expect(listingSetSignature([{ id: 'x' }, { id: 'y' }])).toBe(a);
    expect(listingSetSignature([{ id: 'x' }])).not.toBe(a);
    expect(listingSetSignature([{ id: 'x' }, { id: 'z' }])).not.toBe(a);
  });
});

describe('formatting', () => {
  it('rejects missing and non-positive prices', () => {
    expect(formatCompactAud(null)).toBeNull();
    expect(formatCompactAud(0)).toBeNull();
    expect(formatFullAud(undefined)).toBeNull();
    expect(formatFullAud(Number.NaN)).toBeNull();
  });

  it('produces compact and full currency labels', () => {
    expect(formatCompactAud(1_250_000)).toMatch(/1\.3M|1\.2M/);
    expect(formatFullAud(1_250_000)).toContain('1,250,000');
  });

  it('escapes marker label HTML', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
  });
});
