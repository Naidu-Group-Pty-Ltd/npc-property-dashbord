/**
 * Pure model helpers for the listings map.
 *
 * Everything in here is deliberately free of Leaflet/React so the maths that
 * drives pin tiers, heat weighting and heat calibration can be unit tested.
 */
import type { PropertyListing } from '@/lib/airtable';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface HeatPoint {
  lat: number;
  lng: number;
  intensity: number;
}

export type MapMode = 'pins' | 'heat' | 'hybrid';
export type HeatMetric = 'density' | 'price' | 'recency';
/** Controls both the heat radius and how aggressively the colour ramp saturates. */
export type HeatFocus = 'tight' | 'balanced' | 'wide';
export type BasemapId = 'auto' | 'light' | 'dark' | 'satellite';

export const MAP_MODES: MapMode[] = ['pins', 'heat', 'hybrid'];
export const HEAT_METRICS: HeatMetric[] = ['density', 'price', 'recency'];
export const HEAT_FOCUSES: HeatFocus[] = ['tight', 'balanced', 'wide'];
export const BASEMAPS: BasemapId[] = ['auto', 'light', 'dark', 'satellite'];

/* -------------------------------------------------------------------------- */
/* Coordinates                                                                 */
/* -------------------------------------------------------------------------- */

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isPlottable(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // 0/0 is the classic "geocoder gave up" sentinel — it drops pins in the ocean.
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** Coordinates already present on the source record — no lookup involved. */
export function getStoredListingPoint(listing: PropertyListing): GeoPoint | null {
  const lat = toFiniteNumber(listing.latitude);
  const lng = toFiniteNumber(listing.longitude);
  if (!isPlottable(lat, lng)) return null;
  return { lat: lat as number, lng: lng as number };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const compactAud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 1,
  notation: 'compact',
});

const fullAud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export function formatCompactAud(price: number | null | undefined): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return compactAud.format(price);
}

export function formatFullAud(price: number | null | undefined): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return fullAud.format(price);
}

/** Minimal HTML escaping — marker labels are injected as `divIcon` HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDayCount(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

/* -------------------------------------------------------------------------- */
/* Listing timestamps                                                          */
/* -------------------------------------------------------------------------- */

/** Best-effort "when did this listing appear" in epoch ms, newest signal wins. */
export function listingTimestamp(listing: PropertyListing): number | null {
  const candidates: Array<unknown> = [
    listing.listingDate,
    listing.receivedAt,
    listing.createdTime,
    listing.createdAt,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const date = candidate instanceof Date ? candidate : new Date(candidate as string);
    const time = date.getTime();
    if (Number.isFinite(time) && time > 0) return time;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Price tiers (pin colouring)                                                 */
/* -------------------------------------------------------------------------- */

export type PriceTier = 'unknown' | 'low' | 'mid' | 'high' | 'top';

export interface PriceTiers {
  q1: number;
  q2: number;
  q3: number;
}

export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * Math.min(Math.max(q, 0), 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sortedAsc[lower];
  return sortedAsc[lower] + (sortedAsc[upper] - sortedAsc[lower]) * (pos - lower);
}

export function computePriceTiers(prices: number[]): PriceTiers | null {
  const usable = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (usable.length < 4) return null;
  return {
    q1: quantile(usable, 0.25),
    q2: quantile(usable, 0.5),
    q3: quantile(usable, 0.75),
  };
}

export function priceTier(price: number | null | undefined, tiers: PriceTiers | null): PriceTier {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return 'unknown';
  if (!tiers) return 'mid';
  if (price <= tiers.q1) return 'low';
  if (price <= tiers.q2) return 'mid';
  if (price <= tiers.q3) return 'high';
  return 'top';
}

/* -------------------------------------------------------------------------- */
/* Cluster summaries                                                           */
/* -------------------------------------------------------------------------- */

/** Ramp order — cheapest band first, then the band for listings with no price. */
export const PRICE_TIER_ORDER: PriceTier[] = ['low', 'mid', 'high', 'top', 'unknown'];

export interface ClusterMember {
  price: number | null;
  tier: PriceTier;
}

export interface TierShare {
  tier: PriceTier;
  /** Fraction of the cluster sitting in this band, 0–1. */
  share: number;
}

export interface ClusterSummary {
  count: number;
  /** Median of the priced members, or null when nothing in the cluster has a price. */
  median: number | null;
  /** Band of the member at the median, so the colour and the number always agree. */
  medianTier: PriceTier;
  /** Bands present, in ramp order, each with its share of the cluster. */
  mix: TierShare[];
  /** Members carrying no usable price. */
  unpriced: number;
}

/**
 * What a cluster is worth, not just how many listings it hides.
 *
 * A count alone answers "how much stock is here" and nothing else, which is the
 * less interesting half of the question on a property map. The mix drives a
 * band-coloured ring and the median drives a price label, so a collapsed
 * cluster still reads as "twelve listings, mostly upper-mid, around $1.2M".
 */
export function summariseCluster(members: ClusterMember[]): ClusterSummary {
  const count = members.length;
  if (count === 0) {
    return { count: 0, median: null, medianTier: 'unknown', mix: [], unpriced: 0 };
  }

  const priced = members
    .filter(
      (m): m is ClusterMember & { price: number } =>
        typeof m.price === 'number' && Number.isFinite(m.price) && m.price > 0,
    )
    .sort((a, b) => a.price - b.price);

  const median = priced.length ? quantile(priced.map((m) => m.price), 0.5) : null;
  // Take the lower-middle member on an even split, matching how `priceTier`
  // resolves a price sitting exactly on a band boundary.
  const medianTier = priced.length ? priced[Math.floor((priced.length - 1) / 2)].tier : 'unknown';

  const counts = new Map<PriceTier, number>();
  for (const m of members) counts.set(m.tier, (counts.get(m.tier) ?? 0) + 1);

  const mix = PRICE_TIER_ORDER.map((tier) => ({
    tier,
    share: (counts.get(tier) ?? 0) / count,
  })).filter((entry) => entry.share > 0);

  return { count, median, medianTier, mix, unpriced: count - priced.length };
}

/**
 * Conic-gradient stops describing a cluster's band mix.
 *
 * Colours are emitted as `var(--tier-*)` rather than values, so the ramp stays
 * in the stylesheet and re-themes with the tenant brand — nothing here names a
 * colour. The last stop is pinned to 100% because accumulated floats otherwise
 * leave a hairline of backdrop showing through the ring.
 */
export function tierMixGradientStops(mix: TierShare[]): string {
  if (mix.length === 0) return 'var(--tier-unknown) 0% 100%';
  const round = (n: number) => Math.round(n * 10) / 10;
  const parts: string[] = [];
  let at = 0;
  mix.forEach(({ tier, share }, index) => {
    const end = index === mix.length - 1 ? 100 : Math.min(100, at + share * 100);
    parts.push(`var(--tier-${tier}) ${round(at)}% ${round(end)}%`);
    at = end;
  });
  return parts.join(',');
}

/* -------------------------------------------------------------------------- */
/* Property type glyphs (pin iconography)                                      */
/* -------------------------------------------------------------------------- */

export type PropertyGlyph = 'house' | 'apartment' | 'land' | 'commercial' | 'property';

export const PROPERTY_GLYPHS: PropertyGlyph[] = [
  'house',
  'apartment',
  'land',
  'commercial',
  'property',
];

/**
 * `propertyType` is free text copied from whichever portal supplied the listing
 * ("Unit/Apartment", "Vacant Land", "Semi-Rural Acreage"), so this matches on
 * vocabulary rather than an enum.
 *
 * First match wins, and the order encodes the tie-breaks: a strata word beats a
 * structure word ("Apartment Block" is an apartment), a trade word beats both
 * ("Commercial Land" is commercial), and a structure beats a parcel so a
 * "House and Land" package reads as a house while "Residential Land" stays land.
 */
const GLYPH_MATCHERS: Array<[PropertyGlyph, RegExp]> = [
  ['apartment', /\b(apartment|apartments|unit|units|flat|flats|studio|penthouse|condo)\b/],
  [
    'commercial',
    /\b(commercial|office|offices|retail|industrial|warehouse|shop|showroom|medical|hotel|motel)\b/,
  ],
  [
    // "semi" only as the full phrase: "Semi-Rural Acreage" is a parcel, not a
    // semi-detached dwelling.
    'house',
    /\b(house|houses|home|homes|cottage|villa|villas|duplex|townhouse|townhouses|terrace|semi detached)\b/,
  ],
  ['land', /\b(land|block|blocks|vacant|acreage|rural|farm|lot|allotment)\b/],
];

export function propertyGlyph(propertyType: string | null | undefined): PropertyGlyph {
  if (typeof propertyType !== 'string') return 'property';
  // Portals join types with slashes, dashes and underscores; \b needs separators.
  const normalised = propertyType.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!normalised || normalised === 'unknown') return 'property';
  for (const [glyph, pattern] of GLYPH_MATCHERS) {
    if (pattern.test(normalised)) return glyph;
  }
  return 'property';
}

/* -------------------------------------------------------------------------- */
/* Heat weighting                                                              */
/* -------------------------------------------------------------------------- */

export interface HeatScale {
  /** Lowest observed value for the active metric. */
  min: number;
  /** Median observed value. */
  median: number;
  /** Highest observed value. */
  max: number;
  /** Number of points that actually carried a value for the metric. */
  sampled: number;
}

export interface HeatModel {
  metric: HeatMetric;
  points: HeatPoint[];
  scale: HeatScale | null;
  /**
   * Lowest value the colour ceiling may take, whatever the viewport contains.
   *
   * For weighted metrics it is the heaviest weight in the dataset, so a mid-priced
   * listing keeps its mid-ramp colour when you zoom into a cheap pocket. For
   * density it is a small point count, so an isolated listing reads cool instead
   * of claiming to be a hotspot at max zoom.
   */
  minCeiling: number;
}

/** Points-per-cell that counts as a fully saturated density hotspot. */
const DENSITY_MIN_CEILING = 4;

/** Weight floor so the coldest real value still paints something. */
const MIN_WEIGHT = 0.18;
/**
 * Listings missing the active metric sit below the floor: they still register as
 * supply, but must never read as hot as a listing that genuinely scored low.
 */
const UNKNOWN_WEIGHT = 0.1;

export interface WeightedListing {
  listing: PropertyListing;
  point: GeoPoint;
}

function logNormalise(value: number, min: number, max: number): number {
  if (!(max > min)) return 1;
  const lo = Math.log(Math.max(min, 1));
  const hi = Math.log(Math.max(max, Math.max(min, 1) + 1));
  if (!(hi > lo)) return 1;
  const t = (Math.log(Math.max(value, 1)) - lo) / (hi - lo);
  return MIN_WEIGHT + (1 - MIN_WEIGHT) * Math.min(Math.max(t, 0), 1);
}

/**
 * Turns plotted listings into weighted heat points for the requested metric.
 *
 * - `density` weights every listing equally: the map shows where stock is.
 * - `price` uses a log scale so a single trophy listing cannot flatten the ramp.
 * - `recency` fades older stock so fresh supply reads hottest.
 */
export function buildHeatModel(rows: WeightedListing[], metric: HeatMetric): HeatModel {
  if (rows.length === 0) {
    return { metric, points: [], scale: null, minCeiling: DENSITY_MIN_CEILING };
  }

  const uniform = (): HeatModel => ({
    metric,
    points: rows.map(({ point }) => ({ lat: point.lat, lng: point.lng, intensity: 1 })),
    scale: null,
    // Every point weighs the same, so only genuine pile-ups should saturate.
    minCeiling: DENSITY_MIN_CEILING,
  });

  const weighted = (points: HeatPoint[], scale: HeatScale): HeatModel => ({
    metric,
    points,
    scale,
    minCeiling: points.reduce((acc, p) => Math.max(acc, p.intensity), 0) || 1,
  });

  if (metric === 'density') return uniform();

  if (metric === 'price') {
    const prices = rows
      .map(({ listing }) => toFiniteNumber(listing.price))
      .filter((p): p is number => p !== null && p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) return uniform();

    const min = prices[0];
    const max = prices[prices.length - 1];
    return weighted(
      rows.map(({ listing, point }) => {
        const price = toFiniteNumber(listing.price);
        const intensity =
          price !== null && price > 0 ? logNormalise(price, min, max) : UNKNOWN_WEIGHT;
        return { lat: point.lat, lng: point.lng, intensity };
      }),
      { min, max, median: quantile(prices, 0.5), sampled: prices.length },
    );
  }

  // recency
  const stamps = rows
    .map(({ listing }) => listingTimestamp(listing))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  if (stamps.length === 0) return uniform();

  const oldest = stamps[0];
  const newest = stamps[stamps.length - 1];
  const span = newest - oldest;
  return weighted(
    rows.map(({ listing, point }) => {
      const stamp = listingTimestamp(listing);
      let intensity = UNKNOWN_WEIGHT;
      if (stamp !== null) {
        const t = span > 0 ? (stamp - oldest) / span : 1;
        intensity = MIN_WEIGHT + (1 - MIN_WEIGHT) * Math.min(Math.max(t, 0), 1);
      }
      return { lat: point.lat, lng: point.lng, intensity };
    }),
    { min: oldest, max: newest, median: quantile(stamps, 0.5), sampled: stamps.length },
  );
}

export interface HeatLegend {
  title: string;
  lowLabel: string;
  highLabel: string;
  midLabel: string | null;
  hint: string;
}

export function describeHeatLegend(
  model: HeatModel,
  now: number = Date.now(),
): HeatLegend {
  if (model.metric === 'price' && model.scale) {
    return {
      title: 'Price intensity',
      lowLabel: formatCompactAud(model.scale.min) ?? 'Low',
      midLabel: formatCompactAud(model.scale.median),
      highLabel: formatCompactAud(model.scale.max) ?? 'High',
      hint: `${model.scale.sampled} priced listings · log scale`,
    };
  }

  if (model.metric === 'recency' && model.scale) {
    const days = (stamp: number) =>
      formatDayCount(Math.max(0, Math.round((now - stamp) / 86_400_000)));
    return {
      title: 'Listing freshness',
      lowLabel: days(model.scale.min),
      midLabel: days(model.scale.median),
      highLabel: days(model.scale.max),
      hint: `${model.scale.sampled} dated listings`,
    };
  }

  return {
    title: 'Listing density',
    lowLabel: 'Sparse',
    midLabel: null,
    highLabel: 'Concentrated',
    hint: `${model.points.length} plotted listings`,
  };
}

/* -------------------------------------------------------------------------- */
/* Heat rendering geometry                                                     */
/* -------------------------------------------------------------------------- */

const FOCUS_RADIUS_SCALE: Record<HeatFocus, number> = {
  tight: 0.7,
  balanced: 1,
  wide: 1.45,
};

/**
 * Percentile of per-cell weight used as the "fully saturated" value.
 * Tight → only genuine outliers go red. Wide → broad areas glow.
 */
const FOCUS_PERCENTILE: Record<HeatFocus, number> = {
  tight: 0.99,
  balanced: 0.94,
  wide: 0.82,
};

/**
 * Heat radius has to grow with zoom, otherwise the layer reads as disconnected
 * dots when zoomed in and as a single blob when zoomed out.
 */
export function heatGeometryForZoom(
  zoom: number,
  focus: HeatFocus,
): { radius: number; blur: number } {
  const safeZoom = Number.isFinite(zoom) ? zoom : 5;
  // Country-to-state zooms get a deliberately tight, sharp core. At zoom 4 a
  // capital city's entire stock projects into a couple of pixels, and the old
  // radius smeared that mass across the coastline into open water — Melbourne
  // read as a blob in Bass Strait. Nobody is judging density gradients at
  // national scale; they are locating hotspots, and a hotspot should sit on
  // the city that produced it.
  const lowZoom = safeZoom <= 5;
  const base = lowZoom
    ? 10.4 - (5 - Math.max(safeZoom, 3)) * 2.2
    : 13 + (safeZoom - 4) * 2.6;
  const radius = Math.min(Math.max(base * FOCUS_RADIUS_SCALE[focus], lowZoom ? 5 : 10), 62);
  return { radius: Math.round(radius), blur: Math.round(radius * (lowZoom ? 0.55 : 0.72)) };
}

export interface ProjectedWeight {
  x: number;
  y: number;
  weight: number;
}

/**
 * Leaflet.heat clamps each aggregation cell against `options.max` and maps
 * `cellWeight / max` onto the gradient. A fixed `max` means the ramp is either
 * blown out (everything red) or unused (everything green) at most zoom levels.
 *
 * We mirror the plugin's own screen-space bucketing (cell size = r/2) and take a
 * high percentile of the resulting cell weights, so the gradient spans the data
 * that is actually on screen at the current zoom.
 */
export function calibrateHeatMax(
  projected: ProjectedWeight[],
  radius: number,
  focus: HeatFocus,
  /**
   * Dataset-wide floor for the ceiling (see `HeatModel.minCeiling`). Without it
   * the ceiling would collapse to whatever happens to be on screen, so a lone
   * mid-priced listing would glow red and the colours would stop agreeing with
   * the legend. Defaults to the heaviest visible point.
   */
  minCeiling?: number,
): number {
  if (projected.length === 0) return 1;
  const cell = Math.max(1, radius / 2);
  const buckets = new Map<string, number>();
  for (const p of projected) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    buckets.set(key, (buckets.get(key) ?? 0) + p.weight);
  }
  if (buckets.size === 0) return 1;
  const sums = Array.from(buckets.values()).sort((a, b) => a - b);
  const target = quantile(sums, FOCUS_PERCENTILE[focus]);
  const floor = Math.max(
    minCeiling && Number.isFinite(minCeiling)
      ? minCeiling
      : Math.max(...projected.map((p) => p.weight)),
    0.001,
  );
  return Math.max(target, floor);
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cheap order-independent signature for a listing set. Used to decide when the
 * map should re-fit: filter changes should re-frame, marker trickle-in should not.
 */
export function listingSetSignature(listings: Array<{ id: string }>): string {
  let hash = 0;
  for (const { id } of listings) {
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
  }
  return `${listings.length}:${hash}`;
}

export function isMapMode(value: unknown): value is MapMode {
  return typeof value === 'string' && (MAP_MODES as string[]).includes(value);
}

export function isHeatMetric(value: unknown): value is HeatMetric {
  return typeof value === 'string' && (HEAT_METRICS as string[]).includes(value);
}

export function isHeatFocus(value: unknown): value is HeatFocus {
  return typeof value === 'string' && (HEAT_FOCUSES as string[]).includes(value);
}

export function isBasemapId(value: unknown): value is BasemapId {
  return typeof value === 'string' && (BASEMAPS as string[]).includes(value);
}
