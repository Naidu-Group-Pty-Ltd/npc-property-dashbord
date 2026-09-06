import { internalError } from '../_shared/errorResponse.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import { LocalityRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';

/**
 * Climate data — honestly: no real source is integrated yet.
 *
 * What this service used to do: its one "fetch" path was
 * `generateClimateEstimate`, a hard-coded per-state table — every property
 * in NSW shared one annual rainfall (1,150mm), one average temperature and
 * one humidity, from Bourke to Bondi — plus a per-state "extreme weather
 * risk" and a computed "comfort index" over the invented inputs. Its own
 * comment conceded the source: "BoM's open data delivery is currently
 * suspended … We'll use climate zone patterns and historical data for
 * now". The results were cached for **365 days** (`climate_data_cache`
 * held **1,237 rows at removal; not one live**) and `api_health_log`
 * recorded each request as a `success` for a fetch that never happened.
 *
 * The rule: **a source that cannot answer says so.** Both report pipelines
 * attach climate data only on `success && data`, so this envelope makes
 * the section absent instead of a state-wide constant presented as local
 * measurement.
 *
 * Real acquisition, when built: the Bureau of Meteorology publishes
 * long-term climate statistics per observation station (climate averages
 * tables), and station coordinates are published alongside — nearest-station
 * lookup from a loaded table is the pattern, per the header of
 * `abs-data-service/index.ts`.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // WP-24: bounded and shape-checked. This endpoint takes no session,
    // so a bare req.json() read whatever was sent.
    const __parsed = await parseJsonBody(req, LocalityRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const { suburb, state, postcode } = __parsed.data;

    if (!state) {
      return new Response(JSON.stringify({
        success: false,
        error: 'State parameter is required',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`🌡️ Climate data request: ${suburb || 'N/A'}, ${state}, ${postcode || 'N/A'}`);

    return new Response(JSON.stringify(sourceUnavailable(
      'climate-data',
      'source_not_integrated',
      'No climate data source is integrated for this deployment — climate figures are unavailable rather than estimated from state-wide patterns.',
    )), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('❌ Error in climate-data-service:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'climate-data-service'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
