import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface DomainDataRequest {
  suburb: string;
  state: string;
  postcode?: string;
  propertyCategory?: 'house' | 'unit';
  healthCheck?: boolean;
}

interface SuburbPerformance {
  medianSoldPrice?: number;
  numberSold?: number;
  medianRentListingPrice?: number;
  numberRented?: number;
  daysOnMarket?: number;
  auctionClearanceRate?: number;
  annualGrowth?: number;
  rentalYield?: number;
  dataSource: string;
  dataQuality: 'live' | 'fallback' | 'unavailable';
  lastUpdated: string;
  apiStatus?: string;
}

// Track API health
let lastSuccessfulCall: Date | null = null;
let consecutiveFailures = 0;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[domain-data-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[domain-data-service] Authenticated user: ${userId}`);
    
    const domainApiKey = Deno.env.get('DOMAIN_API_KEY');
    if (!domainApiKey) {
      console.error('❌ DOMAIN_API_KEY not configured in environment');
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Domain API key not configured',
          dataQuality: 'unavailable'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { suburb, state, postcode, propertyCategory = 'house', healthCheck }: DomainDataRequest = body;

    // Health check endpoint
    if (healthCheck) {
      return await performHealthCheck(domainApiKey);
    }

    console.log(`Fetching Domain data for: ${suburb}, ${state}, ${postcode}`);

    // Fetch suburb performance statistics from Domain API
    const domainUrl = `https://api.domain.com.au/v1/suburbPerformanceStatistics/${state}/${suburb}?propertyCategory=${propertyCategory}&chronologicalSpan=12&tPlusFrom=1&tPlusTo=12`;

    console.log(`Domain API request URL: ${domainUrl}`);

    const response = await fetch(domainUrl, {
      method: 'GET',
      headers: {
        'X-Api-Key': domainApiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      consecutiveFailures++;
      
      // Log detailed error information
      const errorDetails = {
        status: response.status,
        statusText: response.statusText,
        suburb,
        state,
        consecutiveFailures,
        lastSuccess: lastSuccessfulCall?.toISOString() || 'Never'
      };
      
      if (response.status === 401) {
        console.error('❌ Domain API: Invalid or expired API key (401 Unauthorized)');
        console.error('Please verify your DOMAIN_API_KEY is correct');
      } else if (response.status === 403) {
        console.error('❌ Domain API: Access forbidden (403). API key may lack required permissions');
      } else if (response.status === 429) {
        console.error('⚠️ Domain API: Rate limit exceeded (429). Consider caching or throttling requests');
      } else if (response.status === 404) {
        console.error(`⚠️ Domain API: Suburb not found (404) - ${suburb}, ${state}`);
      } else {
        console.error(`❌ Domain API error (${response.status}):`, errorText);
      }
      
      console.error('Error details:', JSON.stringify(errorDetails, null, 2));
      
      // Return graceful fallback with detailed status
      return new Response(
        JSON.stringify({
          success: false,
          error: `Domain API error: ${response.status} ${response.statusText}`,
          dataQuality: 'unavailable',
          fallbackData: {
            dataSource: 'Estimated (Domain API Unavailable)',
            dataQuality: 'fallback',
            lastUpdated: new Date().toISOString(),
            apiStatus: `${response.status} - ${getApiStatusMessage(response.status)}`,
            lastSuccessfulFetch: lastSuccessfulCall?.toISOString() || 'Never',
            consecutiveFailures
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Success - reset failure counter and update last successful call
    consecutiveFailures = 0;
    lastSuccessfulCall = new Date();

    const data = await response.json();
    console.log('✅ Domain API response received successfully');
    console.log('Response preview:', JSON.stringify(data).substring(0, 300));

    // Extract relevant metrics from the response
    const series = data?.series;
    const latestData = series && series.seriesInfo && series.seriesInfo.length > 0 
      ? series.seriesInfo[series.seriesInfo.length - 1] 
      : null;

    const performanceData: SuburbPerformance = {
      medianSoldPrice: latestData?.values?.medianSoldPrice,
      numberSold: latestData?.values?.numberSold,
      medianRentListingPrice: latestData?.values?.medianRentListingPrice,
      numberRented: latestData?.values?.numberListedForRent,
      daysOnMarket: latestData?.values?.daysOnMarket,
      auctionClearanceRate: latestData?.values?.auctionClearanceRate,
      annualGrowth: latestData?.values?.medianSoldPricePercentChange,
      rentalYield: latestData?.values?.medianRentListingPrice && latestData?.values?.medianSoldPrice
        ? (latestData.values.medianRentListingPrice * 52 / latestData.values.medianSoldPrice * 100)
        : undefined,
      dataSource: 'Domain API (Live Data)',
      dataQuality: 'live',
      lastUpdated: new Date().toISOString(),
      apiStatus: 'Operational'
    };

    console.log('✅ Processed live performance data from Domain API');
    console.log('Data quality: LIVE | Median price:', performanceData.medianSoldPrice);

    return new Response(
      JSON.stringify({
        success: true,
        data: performanceData,
        suburb,
        state,
        propertyCategory,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    consecutiveFailures++;
    console.error('❌ Unexpected error in domain-data-service:', error);
    console.error('Consecutive failures:', consecutiveFailures);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        dataQuality: 'unavailable',
        fallbackData: {
          dataSource: 'Estimated (Service Error)',
          dataQuality: 'fallback',
          lastUpdated: new Date().toISOString(),
          apiStatus: 'Service Error',
          lastSuccessfulFetch: lastSuccessfulCall?.toISOString() || 'Never',
          consecutiveFailures
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Health check function
async function performHealthCheck(apiKey: string) {
  console.log('🔍 Performing Domain API health check...');
  
  try {
    // Test API with a known suburb
    const testUrl = 'https://api.domain.com.au/v1/suburbPerformanceStatistics/NSW/Sydney?propertyCategory=house&chronologicalSpan=12&tPlusFrom=1&tPlusTo=12';
    
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    const healthStatus = {
      service: 'Domain Data Service',
      apiStatus: response.ok ? 'Operational' : 'Error',
      statusCode: response.status,
      message: getApiStatusMessage(response.status),
      lastSuccessfulCall: lastSuccessfulCall?.toISOString() || 'Never',
      consecutiveFailures,
      timestamp: new Date().toISOString()
    };

    console.log('Health check result:', JSON.stringify(healthStatus, null, 2));

    return new Response(
      JSON.stringify({ success: response.ok, health: healthStatus }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Health check failed:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        health: {
          service: 'Domain Data Service',
          apiStatus: 'Error',
          message: error instanceof Error ? error.message : 'Health check failed',
          timestamp: new Date().toISOString()
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Helper function to get user-friendly status messages
function getApiStatusMessage(statusCode: number): string {
  const messages: Record<number, string> = {
    200: 'API operational - data retrieved successfully',
    401: 'Invalid API key - please verify credentials',
    403: 'Access forbidden - API key lacks required permissions',
    404: 'Suburb not found in Domain database',
    429: 'Rate limit exceeded - too many requests',
    500: 'Domain API server error',
    502: 'Bad gateway - Domain API temporarily unavailable',
    503: 'Service unavailable - Domain API maintenance'
  };
  
  return messages[statusCode] || `Unknown status: ${statusCode}`;
}
