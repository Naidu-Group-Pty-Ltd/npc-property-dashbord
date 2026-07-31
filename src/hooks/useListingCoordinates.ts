import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  addressFingerprint,
  readCachedPoint,
  writeCachedPoint,
} from '@/lib/listingCoordinateCache';
import type { PropertyListing } from '@/lib/airtable';

export interface ResolvedPoint {
  lat: number;
  lng: number;
  source: 'record' | 'cache' | 'geocoded';
}

/**
 * Why a pass stopped early. Surfaced so the map can say "the lookup service
 * refused" instead of blaming the listing addresses.
 */
export type CoordinateFailure = 'rate_limited' | 'unavailable' | 'unauthorized' | 'failed';

interface ListingPayload {
  id: string;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

const BATCH_SIZE = 150;
/**
 * The edge function allows 10 calls per actor per minute. Staying under that in
 * a single pass keeps a large dataset from rate-limiting itself into a blank map.
 */
const MAX_REQUESTS_PER_PASS = 8;
/** Give up on a listing the server has fully processed but could not place. */
const MAX_ATTEMPTS = 2;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

const fingerprintOf = (row: ListingPayload): string =>
  addressFingerprint([row.address, row.suburb, row.state, row.postcode]);


function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValid(lat: number | null, lng: number | null): boolean {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Enough of an address for the server to have any chance of placing it. */
function isResolvable(row: ListingPayload): boolean {
  const parts = [row.address, row.suburb, row.state, row.postcode]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0 && p.toLowerCase() !== 'unknown');
  return parts.join(', ').length >= 6;
}

/**
 * Resolves map coordinates for listings entirely server-side.
 * The browser never contacts a third-party location provider directly.
 *
 * The resolution pass is deliberately decoupled from the effect lifecycle. An
 * earlier version marked listings as "requested" up front and aborted the
 * in-flight batch whenever the `listings` prop changed identity — which any
 * react-query refetch, search keystroke, or filter change does. The already
 * fetched results were dropped, and because every id was still flagged as
 * requested, nothing was ever asked for again: the map stayed permanently empty
 * at "0 of N plotted". Now a single pass drains the queue, only true unmount
 * stops it, and ids are recorded as resolved (or exhausted) rather than merely
 * requested.
 */
export function useListingCoordinates(listings: PropertyListing[]) {
  const [points, setPoints] = useState<Record<string, ResolvedPoint>>(() => {
    const seed: Record<string, ResolvedPoint> = {};
    for (const listing of listings) {
      const hit = coordinateCache.get(listing.id);
      if (hit) seed[listing.id] = hit;
    }
    return seed;
  });
  const [isResolving, setIsResolving] = useState(false);
  const [failure, setFailure] = useState<CoordinateFailure | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const payload = useMemo<ListingPayload[]>(
    () =>
      listings.map((l) => ({
        id: l.id,
        address: l.address ?? null,
        suburb: l.suburb ?? null,
        state: l.state ?? null,
        postcode: l.zipCode ?? null,
        latitude: l.latitude ?? null,
        longitude: l.longitude ?? null,
      })),
    [listings],
  );

  // Refs the running pass reads, so it always sees the newest data without
  // being torn down and restarted.
  const payloadRef = useRef<ListingPayload[]>(payload);
  const pointsRef = useRef(points);
  const attemptsRef = useRef(new Map<string, number>());
  const runningRef = useRef(false);
  const restartRef = useRef(false);
  const stoppedRef = useRef(false);
  const unmountedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const transientFailuresRef = useRef(0);

  // `payload` is derived straight from props, so it is always current. `points`
  // is deliberately NOT mirrored here: the running pass advances `pointsRef`
  // itself, and a render landing between that update and React flushing the
  // state would otherwise roll the ref back and re-request resolved listings.
  payloadRef.current = payload;

  useEffect(
    () => () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  // Listings that already carry coordinates need no lookup at all.
  useEffect(() => {
    const immediate: Record<string, ResolvedPoint> = {};
    for (const row of payload) {
      const lat = numeric(row.latitude);
      const lng = numeric(row.longitude);
      if (isValid(lat, lng)) {
        immediate[row.id] = { lat: lat as number, lng: lng as number, source: 'record' };
      }
    }
    const ids = Object.keys(immediate);
    if (ids.length === 0) return;

    pointsRef.current = { ...pointsRef.current, ...immediate };
    setPoints((prev) => {
      // Record coordinates are authoritative, so they win over a cached lookup.
      const changed = ids.some(
        (id) =>
          prev[id]?.lat !== immediate[id].lat ||
          prev[id]?.lng !== immediate[id].lng ||
          prev[id]?.source !== 'record',
      );
      return changed ? { ...prev, ...immediate } : prev;
    });
  }, [payload]);

  useEffect(() => {
    const pending = (): ListingPayload[] =>
      payloadRef.current.filter(
        (row) =>
          !pointsRef.current[row.id] &&
          !isValid(numeric(row.latitude), numeric(row.longitude)) &&
          (attemptsRef.current.get(row.id) ?? 0) < MAX_ATTEMPTS &&
          isResolvable(row),
      );

    const commit = (
      resolved: Array<{ id: string; lat: number; lng: number; source: ResolvedPoint['source'] }>,
    ) => {
      const next: Record<string, ResolvedPoint> = {};
      for (const r of resolved) {
        if (!isValid(r.lat, r.lng)) continue;
        const point: ResolvedPoint = { lat: r.lat, lng: r.lng, source: r.source ?? 'geocoded' };
        next[r.id] = point;
        rememberPoint(r.id, point);
      }
      if (Object.keys(next).length === 0) return;
      // Keep the ref in step immediately: the next batch is queued from it
      // before React has had a chance to re-render.
      pointsRef.current = { ...pointsRef.current, ...next };
      setPoints((prev) => ({ ...prev, ...next }));
    };

    /** One drain of the queue, bounded by the per-minute request budget. */
    const runPass = async () => {
      let budget = MAX_REQUESTS_PER_PASS;

      while (budget > 0 && !unmountedRef.current && !stoppedRef.current) {
        const todo = pending();
        if (todo.length === 0) break;

        const batch = todo.slice(0, BATCH_SIZE);
        budget -= 1;

        const { data, error } = await invokeSecureFunction('resolve-listing-coordinates', {
          listings: batch,
        });
        if (unmountedRef.current) return;

        if (error) {
          // Back off automatically without burning listing attempts. A manual
          // retry remains available, but the map no longer stays empty forever
          // merely because the first request landed during provider pressure.
          if (error.status === 429 || error.status === 503) {
            stoppedRef.current = true;
            setFailure(error.status === 429 ? 'rate_limited' : 'unavailable');
            transientFailuresRef.current += 1;
            const delay = Math.min(
              RETRY_MAX_MS,
              RETRY_BASE_MS * 2 ** Math.min(transientFailuresRef.current - 1, 5),
            );
            if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              if (unmountedRef.current) return;
              stoppedRef.current = false;
              setRetryNonce((n) => n + 1);
            }, delay);
            return;
          }
          if (error.status === 401 || error.status === 403) {
            stoppedRef.current = true;
            setFailure('unauthorized');
            return;
          }
          setFailure('failed');
          batch.forEach((row) =>
            attemptsRef.current.set(row.id, (attemptsRef.current.get(row.id) ?? 0) + 1),
          );
          continue;
        }

        const resolved = (data?.results ?? []) as Array<{
          id: string;
          lat: number;
          lng: number;
          source: ResolvedPoint['source'];
        }>;
        if (resolved.length > 0) setFailure(null);
        transientFailuresRef.current = 0;
        commit(resolved);

        // The server geocodes a bounded number of fresh addresses per call and
        // reports the remainder. Those were never looked at, so they must not
        // count as a failed attempt — the next iteration picks them up.
        const truncated = Number(data?.pendingLookups ?? 0) > 0;
        if (!truncated) {
          const placed = new Set(resolved.map((r) => r.id));
          batch.forEach((row) => {
            if (placed.has(row.id)) return;
            attemptsRef.current.set(row.id, (attemptsRef.current.get(row.id) ?? 0) + 1);
          });
        }
      }
    };

    if (pending().length === 0) return;

    if (runningRef.current) {
      // A pass is already draining; tell it to look again before it finishes.
      restartRef.current = true;
      return;
    }

    runningRef.current = true;
    setIsResolving(true);
    void (async () => {
      try {
        do {
          restartRef.current = false;
          await runPass();
        } while (restartRef.current && !unmountedRef.current && !stoppedRef.current);
      } finally {
        runningRef.current = false;
        if (!unmountedRef.current) setIsResolving(false);
      }
    })();
  }, [payload, retryNonce]);

  /** Clears the back-off so the user can ask for another pass. */
  const retry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    stoppedRef.current = false;
    transientFailuresRef.current = 0;
    attemptsRef.current.clear();
    setFailure(null);
    setRetryNonce((n) => n + 1);
  }, []);

  return { points, isResolving, failure, retry };
}
