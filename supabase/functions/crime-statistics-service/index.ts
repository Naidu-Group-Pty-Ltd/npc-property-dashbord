import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import { LocalityRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';

/**
 * Crime statistics — honestly: no real source is integrated yet.
 *
 * What this service used to do: `getCrimeProfile` sorted every postcode in
 * Australia into a handful of bands (a literal list of CBD postcodes, then
 * everything else) and from the band invented **counts of offences** — so a
 * client's report carried "Break and Enter: N incidents", "22% higher than
 * state average", a "safetyScore" and a trend narrative, none of which any
 * police service ever published. Its per-state "fetchers" did call the open
 * data catalogues (data.nsw, CSA, QPS…), then discarded whatever came back
 * at a `// TODO` and fell through to the invention. Results were cached for
 * **90 days** (`crime_statistics_cache` held **140 rows at removal; not one
 * live**) and each request logged a `success` to `api_health_log`.
 *
 * An invented crime figure is worse than most of this class: it defames a
 * suburb or falsely reassures a buyer, in a document a client pays for.
 *
 * The rule: **a source that cannot answer says so.** Both report pipelines
 * attach crime data only on `success && data`, so this envelope makes the
 * section absent instead of invented.
 *
 * Real acquisition, when built: BOCSAR (NSW) publishes LGA/suburb offence
 * tables; the Crime Statistics Agency (VIC), QPS (QLD), SAPOL, WAPOL and
 * the territories publish equivalents — each a downloadable table with its
 * own reference period, loaded and read locally per the pattern in
 * `abs-data-service/index.ts`'s header. Coverage varies by state and must
 * be disclosed per source, never averaged across them.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  console.log('Crime Statistics service invoked');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // WP-24: bounded and shape-checked. This endpoint takes no session,
    // so a bare req.json() read whatever was sent.
    const __parsed = await parseJsonBody(req, LocalityRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const { suburb, state, postcode } = __parsed.data;
    console.log('Crime statistics requested for:', suburb, state, postcode);

    if (!suburb || !state) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Suburb and state are required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(sourceUnavailable(
      'crime-statistics',
      'source_not_integrated',
      'No state crime data source is integrated for this deployment — crime figures are unavailable rather than estimated from postcode patterns. Official sources: BOCSAR (NSW), CSA (VIC), QPS (QLD) and state police equivalents.',
    )), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in Crime Statistics service:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'crime-statistics-service'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
