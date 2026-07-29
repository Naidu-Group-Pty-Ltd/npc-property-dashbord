/**
 * Lightweight browser-side geocoder using OpenStreetMap Nominatim.
 *
 * - Cached in localStorage (12-month TTL) to respect Nominatim usage policy.
 * - Serialised through a shared queue with a 1s+ delay between network calls
 *   so we never fan-out and get the app rate-limited.
 * - Returns { lat, lng } or null when the address can't be geocoded.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface CacheEntry {
  v: GeoPoint | null;
  t: number; // timestamp (ms)
}

const CACHE_PREFIX = 'geocode:v1:';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 12 months
const REQUEST_INTERVAL_MS = 1100;

function readCache(key: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed.t !== 'number') return null;
    if (Date.now() - parsed.t > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: GeoPoint | null) {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ v: value, t: Date.now() } satisfies CacheEntry),
    );
  } catch {
    /* quota errors — ignore, we'll just re-geocode */
  }
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => undefined).then(
    () => new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS)),
  );
  return run;
}

function normaliseKey(q: string) {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const q = query.trim();
  if (!q) return null;
  const key = normaliseKey(q);
  const cached = readCache(key);
  if (cached) return cached.v;

  return enqueue(async () => {
    // Re-check inside the queue in case a parallel caller resolved it first.
    const c = readCache(key);
    if (c) return c.v;

    try {
      const url =
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=' +
        encodeURIComponent(q);
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
      });
      if (!res.ok) {
        writeCache(key, null);
        return null;
      }
      const data = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (!Array.isArray(data) || data.length === 0) {
        writeCache(key, null);
        return null;
      }
      const point: GeoPoint = {
        lat: Number.parseFloat(data[0].lat),
        lng: Number.parseFloat(data[0].lon),
      };
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        writeCache(key, null);
        return null;
      }
      writeCache(key, point);
      return point;
    } catch {
      // Don't cache network errors — they might resolve on retry.
      return null;
    }
  });
}
