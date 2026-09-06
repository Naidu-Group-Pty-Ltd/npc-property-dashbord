import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('RBA data service invoked with method:', req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[rba-data-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[rba-data-service] Authenticated user: ${userId}`);

    const rbaData = await fetchRBADataWithCache(supabase);

    if (!rbaData) {
      // The live retrieval failed and there is no honest substitute. The old
      // `getFallbackData()` answered here with a cash rate hard-coded at
      // 4.10% and stamped with TODAY'S date — over a year stale by the time
      // it was removed, presented as current, and nothing anywhere read the
      // `isFallback` flag it carried. A stale rate wearing today's date is
      // worse than no rate: every financial projection downstream inherits
      // it invisibly.
      return new Response(JSON.stringify(sourceUnavailable(
        'rba-economics',
        'provider_error',
        'Live RBA/ABS economic indicators could not be retrieved — economic data is unavailable for this request rather than served stale.',
      )), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      data: rbaData 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in RBA data service:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch RBA data';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function fetchRBADataWithCache(supabase: any) {
  console.log('🔍 Checking economic data cache...');

  // Cache for 24 hours (economic data changes frequently)
  const { data: cachedData, error: cacheError } = await supabase
    .from('economic_data_cache')
    .select('*')
    .eq('data_type', 'rba_indicators')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (cacheError) {
    console.error('❌ Cache query error:', cacheError);
  }

  if (cachedData) {
    const ageHours = Math.round((Date.now() - new Date(cachedData.fetched_at).getTime()) / (1000 * 60 * 60));
    console.log(`✅ Cache HIT! RBA data age: ${ageHours} hours`);
    return { ...cachedData.data, cached: true, lastCached: cachedData.fetched_at };
  }

  console.log('❌ Cache MISS. Fetching live economic data via Perplexity...');

  const freshData = await fetchLiveEconomicData();

  // Nothing real arrived, so there is nothing to cache and nothing to serve.
  // Caching a failure for 24 hours would pin the outage; caching a fallback
  // was how a hard-coded rate got served as a fresh cache hit.
  if (!freshData) return null;

  // Cache for 24 hours
  console.log('💾 Caching economic data for 24 hours...');
  const { error: insertError } = await supabase
    .from('economic_data_cache')
    .upsert({
      data_type: 'rba_indicators',
      data: freshData,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }, {
      onConflict: 'data_type'
    });

  if (insertError) {
    console.error('❌ Error caching data:', insertError);
  } else {
    console.log('✅ Economic data cached successfully');
  }

  return { ...freshData, cached: false };
}

async function fetchLiveEconomicData() {
  const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY');
  
  if (!perplexityApiKey) {
    console.warn('⚠️ PERPLEXITY_API_KEY not set — economic data unavailable');
    return null;
  }

  try {
    console.log('🌐 Querying Perplexity for live Australian economic data...');
    
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const response = await callLLMRaw({
      agentKey: 'rba_data_service',
      messages: [
        {
          role: 'system',
          content: 'You are a financial data extraction tool. Return ONLY the requested JSON with exact current values. No commentary.',
        },
        {
          role: 'user',
          content: `What are the current Australian economic indicators as of today? I need the exact current values for:
1. RBA Official Cash Rate (the current target cash rate set by the Reserve Bank of Australia)
2. The previous cash rate before the most recent change
3. Annual CPI inflation rate (latest ABS quarterly figure, headline All Groups CPI)
4. Trimmed mean (core) inflation rate
5. Unemployment rate (latest ABS labour force)
6. GDP annual growth rate
7. Labour force participation rate

Also provide the best available CPI PROJECTIONS for the next 10 years. Use:
- RBA Statement on Monetary Policy (SMP) forecasts for years 1-3
- Federal Treasury Budget Economic Outlook for years 1-4
- For years beyond available forecasts, project convergence toward the RBA target midpoint of 2.5%

Return ONLY valid JSON in this exact format, no other text:
{
  "cashRate": {"current": 0.00, "previous": 0.00, "lastDecisionDate": "YYYY-MM-DD"},
  "inflation": {"annual": 0.0, "core": 0.0, "quarterly": 0.0},
  "labour": {"unemploymentRate": 0.0, "participationRate": 0.0},
  "gdpGrowth": 0.0,
  "cpiProjections": [
    {"year": 1, "cpiPercent": 0.0, "source": "RBA SMP / Treasury forecast"},
    {"year": 2, "cpiPercent": 0.0, "source": "RBA SMP / Treasury forecast"},
    {"year": 3, "cpiPercent": 0.0, "source": "RBA SMP forecast"},
    {"year": 4, "cpiPercent": 0.0, "source": "Treasury Budget forecast"},
    {"year": 5, "cpiPercent": 0.0, "source": "Convergence to RBA target"},
    {"year": 6, "cpiPercent": 0.0, "source": "Convergence to RBA target"},
    {"year": 7, "cpiPercent": 0.0, "source": "Convergence to RBA target"},
    {"year": 8, "cpiPercent": 0.0, "source": "Convergence to RBA target"},
    {"year": 9, "cpiPercent": 0.0, "source": "Convergence to RBA target"},
    {"year": 10, "cpiPercent": 0.0, "source": "Convergence to RBA target"}
  ]
}`,
        },
      ],
      temperature: 0.0,
      maxTokens: 2000,
      extraBody: {
        search_domain_filter: ['rba.gov.au', 'abs.gov.au', 'treasury.gov.au', 'reuters.com', 'afr.com'],
        search_recency_filter: 'month',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('❌ Perplexity API error:', response.status, errText);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    console.log('📊 Perplexity raw response:', content.substring(0, 500));
    console.log('📎 Citations:', citations.slice(0, 5));

    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ Could not extract JSON from Perplexity response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate the parsed data has reasonable values
    if (!parsed.cashRate?.current || parsed.cashRate.current < 0 || parsed.cashRate.current > 20) {
      console.error('❌ Parsed cash rate seems invalid:', parsed.cashRate?.current);
      return null;
    }

    const today = new Date().toISOString().split('T')[0];
    
    // Process CPI projections - validate and fill gaps
    const cpiProjections = processCpiProjections(parsed.cpiProjections, parsed.inflation?.annual);
    
    const result = {
      cashRate: {
        current: parsed.cashRate.current,
        previous: parsed.cashRate.previous || parsed.cashRate.current,
        change: Number((parsed.cashRate.current - (parsed.cashRate.previous || parsed.cashRate.current)).toFixed(2)),
        lastDecisionDate: parsed.cashRate.lastDecisionDate || today,
        lastUpdate: today,
        source: 'RBA Official Cash Rate (via Perplexity real-time search)',
        citations: citations.slice(0, 3),
      },
      inflation: {
        annual: parsed.inflation?.annual || 0,
        quarterly: parsed.inflation?.quarterly || 0,
        core: parsed.inflation?.core || 0,
        target: 2.5, // RBA target band midpoint (always 2-3%)
        lastUpdate: today,
        source: 'ABS Consumer Price Index (via Perplexity real-time search)',
      },
      cpiProjections,
      indicators: {
        gdpGrowth: parsed.gdpGrowth || 0,
        unemploymentRate: parsed.labour?.unemploymentRate || 0,
        participationRate: parsed.labour?.participationRate || 0,
        lastUpdate: today,
        source: 'ABS / RBA (via Perplexity real-time search)',
      },
      retrievedAt: new Date().toISOString(),
    };

    console.log('✅ Live economic data retrieved:', {
      cashRate: result.cashRate.current,
      inflation: result.inflation.annual,
      unemployment: result.indicators.unemploymentRate,
      cpiProjectionsCount: result.cpiProjections.length,
    });

    return result;

  } catch (error) {
    console.error('❌ Error fetching live economic data:', error);
    return null;
  }
}

/**
 * Process and validate CPI projections from Perplexity.
 * Ensures all 10 years are present with reasonable values.
 * Falls back to convergence model if projections are missing or invalid.
 */
function processCpiProjections(
  rawProjections: any[] | undefined, 
  currentAnnualCpi: number | undefined
): Array<{ year: number; cpiPercent: number; source: string }> {
  const currentCpi = currentAnnualCpi || 2.5;
  const target = 2.5;
  const projections: Array<{ year: number; cpiPercent: number; source: string }> = [];
  
  for (let year = 1; year <= 10; year++) {
    const raw = rawProjections?.find((p: any) => p.year === year);
    
    if (raw && typeof raw.cpiPercent === 'number' && raw.cpiPercent >= 0 && raw.cpiPercent <= 15) {
      projections.push({
        year,
        cpiPercent: Math.round(raw.cpiPercent * 10) / 10,
        source: raw.source || (year <= 3 ? 'RBA SMP forecast' : 'Projected'),
      });
    } else {
      // Generate convergence projection
      const convergenceFactor = 1 - Math.pow(0.8, year);
      const projected = currentCpi + (target - currentCpi) * convergenceFactor;
      projections.push({
        year,
        cpiPercent: Math.round(projected * 10) / 10,
        source: year <= 3 ? 'Near-term convergence estimate' : 'Long-term convergence to RBA target',
      });
    }
  }
  
  return projections;
}
