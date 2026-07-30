import { useEffect, useMemo, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { PropertyListing } from '@/lib/airtable';

export interface ResolvedPoint {
  lat: number;
  lng: number;
  source: 'record' | 'cache' | 'geocoded';
}

const BATCH_SIZE = 150;

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValid(lat: number | null, lng: number | null): boolean {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Resolves map coordinates for listings entirely server-side.
 * The browser never contacts a third-party location provider directly.
 */
export function useListingCoordinates(listings: PropertyListing[]) {
  const [points, setPoints] = useState<Record<string, ResolvedPoint>>({});
  const [isResolving, setIsResolving] = useState(false);
  const requestedRef = useRef<Set<string>>(new Set());

  const payload = useMemo(
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

  useEffect(() => {
    let cancelled = false;

    // Immediately surface listings that already carry coordinates.
    const immediate: Record<string, ResolvedPoint> = {};
    payload.forEach((row) => {
      const lat = numeric(row.latitude);
      const lng = numeric(row.longitude);
      if (isValid(lat, lng)) {
        immediate[row.id] = { lat: lat as number, lng: lng as number, source: 'record' };
      }
    });
    if (Object.keys(immediate).length > 0) {
      setPoints((prev) => ({ ...immediate, ...prev }));
    }

    const outstanding = payload.filter(
      (row) => !immediate[row.id] && !requestedRef.current.has(row.id),
    );
    if (outstanding.length === 0) return;

    outstanding.forEach((row) => requestedRef.current.add(row.id));

    (async () => {
      setIsResolving(true);
      try {
        for (let i = 0; i < outstanding.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = outstanding.slice(i, i + BATCH_SIZE);
          const { data, error } = await invokeSecureFunction('resolve-listing-coordinates', {
            listings: batch,
          });
          if (error || cancelled) continue;
          const resolved = (data?.results ?? []) as Array<{
            id: string;
            lat: number;
            lng: number;
            source: ResolvedPoint['source'];
          }>;
          if (resolved.length === 0) continue;
          setPoints((prev) => {
            const next = { ...prev };
            resolved.forEach((r) => {
              if (isValid(r.lat, r.lng)) next[r.id] = { lat: r.lat, lng: r.lng, source: r.source };
            });
            return next;
          });
        }
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [payload]);

  return { points, isResolving };
}
