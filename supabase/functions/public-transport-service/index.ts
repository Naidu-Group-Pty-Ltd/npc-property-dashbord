import { parseJsonBody } from '../_shared/validate.ts';
import { PublicTransportRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
import { internalError } from '../_shared/errorResponse.ts';

/**
 * Public transport detail — honestly: no real feed is integrated yet.
 *
 * What this service used to do, kept on record because it is the clearest
 * example of the fabrication class this platform removed: eight per-state
 * "fetchers" that **ignored the coordinate entirely** and returned a
 * hard-coded landmark list. Every NSW property, wherever it stood, was 450m
 * from Central Station with the T1–T8 lines; every VIC property 250m from
 * a Swanston Street tram; and so on for all eight states and territories,
 * each with an invented `qualityScore` and a summary reading "Excellent
 * public transport access". The result was cached for 30 days
 * (`transport_data_cache` held **639 rows at removal; not one live**) and
 * flowed into `location-intelligence-service`, where the invented
 * `qualityScore` drove up to 30 points of every report's walk score and
 * "Nearest Station: Central Station" was printed on properties hundreds of
 * kilometres from it. A `generateFallbackData` beneath it invented a
 * different answer ("Unknown", 999m, score 25) for the error path.
 *
 * The rule: **a source that cannot answer says so.** The one consumer
 * (`location-intelligence-service`) treats this envelope as "no transport
 * detail" and falls back to Google Places `transit_station` results — which
 * are measured from the actual coordinate, and were being *overridden* by
 * this service's fiction whenever it answered.
 *
 * Real acquisition, when built: every state publishes GTFS (Transport for
 * NSW Open Data, PTV, TransLink, Adelaide Metro, Transperth, Metro
 * Tasmania, NT DIPL, Transport Canberra). GTFS `stops.txt` + `stop_times`
 * loaded into a table and queried by distance is the pattern — local,
 * scheduled, verifiable — per `abs-data-service/index.ts`'s header.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface PublicTransportInput {
  lat: number;
  lng: number;
  state: string;
  suburb?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // WP-24: bounded and shape-checked. This endpoint takes no session,
    // so a bare req.json() read whatever was sent.
    const __parsed = await parseJsonBody(req, PublicTransportRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const input: PublicTransportInput = __parsed.data;
    console.log('🚇 Public transport request:', { lat: input.lat, lng: input.lng, state: input.state, suburb: input.suburb });

    const { lat, lng, state } = input;

    if (!lat || !lng || !state) {
      const missingParams = [];
      if (!lat) missingParams.push('lat');
      if (!lng) missingParams.push('lng');
      if (!state) missingParams.push('state');
      return new Response(JSON.stringify({
        success: false,
        error: `Missing required parameters: ${missingParams.join(', ')}`,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(sourceUnavailable(
      'public-transport',
      'source_not_integrated',
      'No state transport feed is integrated for this deployment — transport detail is unavailable rather than invented. Location intelligence falls back to coordinate-measured Google transit results.',
    )), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in public-transport-service:', error);
    return new Response(JSON.stringify({
      success: false,
      ...internalError(error, 'public-transport-service'),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
