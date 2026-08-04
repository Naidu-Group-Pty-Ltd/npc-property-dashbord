import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createForbiddenResponse, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { assessAuPoint } from '../_shared/auGeoSanity.pure.ts';
import { assessAuPostcodePoint } from '../_shared/auPostcodeGeo.pure.ts';
import {
  enforceGlobalDailyQuota,
  fetchWithTimeout,
  killSwitchActive,
  redactError,
} from '../_shared/publicAbuseControls.ts';

// Resolves map coordinates for property listings WITHOUT any browser-side
// geocoding. Order of resolution per listing:
//   1. Coordinates already supplied by the source record (no lookup).
//   2. Cache hit in public.listing_geocodes.
//   3. Google Geocoding API (server key), result written to the cache.

interface ListingInput {
  id: string;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

const MAX_BATCH = 300;
const MAX_LOOKUPS_PER_REQUEST = 40;
const CIRCUIT_SCOPE = 'google_listing_geocoding';

function clean(value: unknown, max = 160): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function buildQuery(listing: ListingInput): string {
  const parts = [
    clean(listing.address),
    clean(listing.suburb, 80),
    clean(listing.state, 12),
    clean(listing.postcode, 8),
  ].filter((p) => p && p.toLowerCase() !== 'unknown' && p.toLowerCase() !== 'unknown address' && p.toLowerCase() !== 'unknown suburb');
  return parts.join(', ');
}

async function hashQuery(query: string): Promise<string> {
  const bytes = new TextEncoder().encode(query.toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validPoint(lat: number | null, lng: number | null): boolean {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const j = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body as { session_token?: string });
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    const permission = await requireModulePermission(supabase, { userId, authMethod }, 'listings', 'can_view');
    if (!permission.ok) return createForbiddenResponse(permission.error || 'Listings access required', corsHeaders);

    const rawListings = Array.isArray((body as { listings?: unknown }).listings)
      ? ((body as { listings: ListingInput[] }).listings).slice(0, MAX_BATCH)
      : [];

    if (rawListings.length === 0) return j({ success: true, results: [] });

    const results: Array<{
      id: string;
      lat: number;
      lng: number;
      source: string;
      precision?: string | null;
    }> = [];
    const pending: Array<{
      id: string;
      query: string;
      hash: string;
      state: string | null;
      postcode: string | null;
    }> = [];

    for (const listing of rawListings) {
      const id = clean(listing.id, 120);
      if (!id) continue;

      const lat = numeric(listing.latitude);
      const lng = numeric(listing.longitude);
      if (validPoint(lat, lng)) {
        results.push({ id, lat: lat as number, lng: lng as number, source: 'record' });
        continue;
      }

      const query = buildQuery(listing);
      if (!query || query.length < 6) continue;
      pending.push({
        id,
        query,
        hash: await hashQuery(query),
        state: clean(listing.state, 60) || null,
        postcode: clean(listing.postcode, 8) || null,
      });
    }

    if (pending.length === 0) return j({ success: true, results });

    // 2. Cache lookup.
    const uniqueHashes = Array.from(new Set(pending.map((p) => p.hash)));
    const { data: cached } = await supabase
      .from('listing_geocodes')
      .select('listing_hash, lat, lng, status, precision')
      .in('listing_hash', uniqueHashes);

    const cacheMap = new Map<
      string,
      { lat: number | null; lng: number | null; status: string; precision: string | null }
    >();
    (cached || []).forEach(
      (row: {
        listing_hash: string;
        lat: number | null;
        lng: number | null;
        status: string;
        precision: string | null;
      }) => {
        cacheMap.set(row.listing_hash, {
          lat: row.lat,
          lng: row.lng,
          status: row.status,
          precision: row.precision ?? null,
        });
      },
    );

    const needsLookup: Array<{ id: string; query: string; hash: string }> = [];
    for (const item of pending) {
      const hit = cacheMap.get(item.hash);
      if (hit) {
        if (
          hit.status === 'ok' &&
          validPoint(hit.lat, hit.lng) &&
          // The Australian-geography gate, against the listing's own state. A
          // stored answer that fails it is never served — a wrong pin with a
          // cache behind it is the most durable kind of wrong.
          assessAuPoint(hit.lat as number, hit.lng as number, item.state).ok &&
          assessAuPostcodePoint(hit.lat as number, hit.lng as number, item.postcode).ok
        ) {
          results.push({
            id: item.id,
            lat: hit.lat as number,
            lng: hit.lng as number,
            source: 'cache',
            precision: hit.precision,
          });
        }
        continue;
      }
      needsLookup.push(item);
    }

    // 3. Provider lookup for the remainder (bounded per request).
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    let remaining = MAX_LOOKUPS_PER_REQUEST;
    const seenHashes = new Set<string>();
    const inserts: Array<Record<string, unknown>> = [];

    if (needsLookup.length === 0) {
      return j({ success: true, results, pendingLookups: 0 });
    }

    if (apiKey && !killSwitchActive('GOOGLE_GEOCODING_KILL_SWITCH')) {
      // This endpoint is already protected by staff authentication and the
      // listings permission. Per-request actor/IP throttles caused normal map
      // pagination to lock itself out and, worse, discarded cache hits with a
      // blanket 429. Provider spend remains bounded by the global daily quota,
      // the per-request lookup cap, and the circuit breaker below.

      const { data: circuitOpen, error: circuitReadError } = await supabase.rpc('provider_circuit_is_open', { p_scope: CIRCUIT_SCOPE });
      if (circuitReadError || circuitOpen === true) return j({ error: 'temporarily_unavailable', success: false }, 503);

      for (const item of needsLookup) {
        if (remaining <= 0) break;
        if (seenHashes.has(item.hash)) continue;

        const globalQuota = await enforceGlobalDailyQuota(
          supabase,
          CIRCUIT_SCOPE,
          Number(Deno.env.get('GOOGLE_GEOCODING_DAILY_LIMIT') ?? '5000'),
        );
        if (!globalQuota.ok) {
          console.warn('[resolve-listing-coordinates] global daily lookup budget exhausted');
          break;
        }
        seenHashes.add(item.hash);
        remaining -= 1;

        try {
          const params = new URLSearchParams({
            address: item.query,
            components: 'country:AU',
            key: apiKey,
          });
          const response = await fetchWithTimeout(
            `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
            {},
            6000,
          );
          const data = await response.json().catch(() => ({}));

          if (data.status === 'OK' && Array.isArray(data.results) && data.results[0]?.geometry?.location) {
            const loc = data.results[0].geometry.location;
            const lat = numeric(loc.lat);
            const lng = numeric(loc.lng);
            const precision = String(data.results[0].geometry.location_type ?? 'UNKNOWN').slice(0, 40);
            const sane =
              validPoint(lat, lng) &&
              assessAuPoint(lat as number, lng as number, item.state).ok &&
              // A geocode in the right state but the wrong end of it — the
              // postcode band is the only gate that can see this.
              assessAuPostcodePoint(lat as number, lng as number, item.postcode).ok;
            if (sane) {
              cacheMap.set(item.hash, { lat, lng, status: 'ok', precision });
              inserts.push({
                listing_hash: item.hash,
                lat,
                lng,
                precision,
                provider: 'google',
                status: 'ok',
                resolved_at: new Date().toISOString(),
              });
            } else if (validPoint(lat, lng)) {
              // Google answered, but outside Australia or the listing's own
              // state — a contaminated locality being taken at its word.
              // Recorded as suspect so the sweep does not retry it forever,
              // and never served as a coordinate.
              cacheMap.set(item.hash, { lat: null, lng: null, status: 'suspect', precision: null });
              inserts.push({
                listing_hash: item.hash,
                lat: null,
                lng: null,
                precision: null,
                provider: 'google',
                status: 'suspect',
                resolved_at: new Date().toISOString(),
              });
            }
          } else if (data.status === 'ZERO_RESULTS') {
            cacheMap.set(item.hash, { lat: null, lng: null, status: 'not_found', precision: null });
            inserts.push({
              listing_hash: item.hash,
              lat: null,
              lng: null,
              precision: null,
              provider: 'google',
              status: 'not_found',
              resolved_at: new Date().toISOString(),
            });
          } else {
            await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
            console.warn('[resolve-listing-coordinates] geocode status', data.status);
            continue;
          }
          await supabase.rpc('provider_circuit_record_success', { p_scope: CIRCUIT_SCOPE });
        } catch (e) {
          await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
          console.warn('[resolve-listing-coordinates] lookup failed', redactError(e));
        }
      }
    } else if (killSwitchActive('GOOGLE_GEOCODING_KILL_SWITCH')) {
      return j({ error: 'temporarily_unavailable', success: false }, 503);
    } else {
      console.warn('[resolve-listing-coordinates] GOOGLE_MAPS_API_KEY not configured');
    }

    if (inserts.length > 0) {
      const { error: cacheError } = await supabase
        .from('listing_geocodes')
        .upsert(inserts, { onConflict: 'listing_hash' });
      if (cacheError) console.warn('[resolve-listing-coordinates] cache write failed', cacheError.message);
    }

    for (const item of needsLookup) {
      const hit = cacheMap.get(item.hash);
      if (hit && hit.status === 'ok' && validPoint(hit.lat, hit.lng)) {
        results.push({
          id: item.id,
          lat: hit.lat as number,
          lng: hit.lng as number,
          source: 'geocoded',
          precision: hit.precision ?? null,
        });
      }
    }

    return j({
      success: true,
      results,
      pendingLookups: Math.max(0, needsLookup.length - seenHashes.size),
    });
  } catch (error) {
    console.error('[resolve-listing-coordinates] error', error);
    return j({ error: 'internal_error', success: false }, 500);
  }
});
