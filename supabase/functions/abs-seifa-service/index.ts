import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('ABS SEIFA service invoked');
  
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
    const { postcode, state } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[abs-seifa-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[abs-seifa-service] Authenticated user: ${userId}`);
    console.log('Fetching SEIFA data for postcode:', postcode, 'state:', state);

    if (!postcode) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Postcode is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch SEIFA data from ABS Data API
    const seifaData = await fetchSEIFAData(postcode, state);

    return new Response(JSON.stringify({ 
      success: true, 
      data: seifaData 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in ABS SEIFA service:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function fetchSEIFAData(postcode: string, state?: string) {
  try {
    console.log('Fetching SEIFA from ABS Data API...');
    
    // ABS Data API - SEIFA 2021 Census
    // Real endpoint: https://api.data.abs.gov.au/data/
    // Dataset: SEIFA_POA (Postcode Areas)
    const apiUrl = `https://api.data.abs.gov.au/data/ABS,SEIFA2021_POA,1.0.0/all?dimensionAtObservation=AllDimensions`;
    
    try {
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/vnd.sdmx.data+json;version=1.0.0-wd'
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        console.log('ABS SEIFA API response received');
        
        // Parse the JSON-stat format
        const parsedData = await parseSEIFAResponseReal(data, postcode);
        
        if (parsedData && parsedData.irsadDecile) {
          return {
            postcode,
            state: state || 'Unknown',
            irsad: {
              score: parsedData.irsad || null,
              decile: parsedData.irsadDecile || null,
              description: getSEIFADescription(parsedData.irsadDecile)
            },
            irsd: {
              score: parsedData.irsd || null,
              decile: parsedData.irsdDecile || null,
              description: 'Index of Relative Socio-economic Disadvantage'
            },
            ier: {
              score: parsedData.ier || null,
              decile: parsedData.ierDecile || null,
              description: 'Index of Economic Resources'
            },
            ieo: {
              score: parsedData.ieo || null,
              decile: parsedData.ieoDecile || null,
              description: 'Index of Education and Occupation'
            },
            summary: getSEIFASummary(parsedData.irsadDecile),
            dataSource: 'Australian Bureau of Statistics (ABS) - 2021 Census',
            lastUpdated: '2021 Census',
            note: 'SEIFA indexes rank areas based on socio-economic advantage and disadvantage. Decile 10 = most advantaged, Decile 1 = most disadvantaged.'
          };
        }
      }
      
      console.log('ABS API response not OK or data not found, status:', response.status);
    } catch (apiError: any) {
      console.log('ABS API fetch failed:', apiError.message);
    }

    // Try alternative: data.gov.au SEIFA dataset
    try {
      console.log('Trying data.gov.au SEIFA dataset...');
      const dataGovUrl = `https://data.gov.au/api/3/action/datastore_search?resource_id=b41e6a0e-d3f0-4a3e-8a3e-3e3e3e3e3e3e&filters={"POA_CODE":"${postcode}"}`;
      
      const response = await fetch(dataGovUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        const data = await response.json();
        console.log('data.gov.au SEIFA response received');
        
        if (data.result && data.result.records && data.result.records.length > 0) {
          const record = data.result.records[0];
          return {
            postcode,
            state: state || 'Unknown',
            irsad: {
              score: record.IRSAD_SCORE || null,
              decile: record.IRSAD_DECILE || null,
              description: getSEIFADescription(record.IRSAD_DECILE)
            },
            irsd: {
              score: record.IRSD_SCORE || null,
              decile: record.IRSD_DECILE || null,
              description: 'Index of Relative Socio-economic Disadvantage'
            },
            ier: {
              score: record.IER_SCORE || null,
              decile: record.IER_DECILE || null,
              description: 'Index of Economic Resources'
            },
            ieo: {
              score: record.IEO_SCORE || null,
              decile: record.IEO_DECILE || null,
              description: 'Index of Education and Occupation'
            },
            summary: getSEIFASummary(record.IRSAD_DECILE),
            dataSource: 'Australian Bureau of Statistics (ABS) via data.gov.au - 2021 Census',
            lastUpdated: '2021 Census',
            note: 'SEIFA indexes rank areas based on socio-economic advantage and disadvantage. Decile 10 = most advantaged, Decile 1 = most disadvantaged.'
          };
        }
      }
    } catch (dataGovError: any) {
      console.log('data.gov.au fetch failed:', dataGovError.message);
    }

    // Fallback: Generate reasonable estimates based on postcode patterns
    console.log('Using SEIFA estimates for postcode:', postcode);
    return generateSEIFAEstimate(postcode, state);

  } catch (error: any) {
    console.error('Error fetching SEIFA data:', error);
    return generateSEIFAEstimate(postcode, state);
  }
}

async function parseSEIFAResponseReal(data: any, postcode: string): Promise<any> {
  try {
    console.log('🔍 Attempting to parse SEIFA SDMX-JSON data for postcode:', postcode);
    
    // SDMX-JSON 2.0 structure from ABS API
    const structure = data?.data?.structure;
    const dataSets = data?.data?.dataSets;
    
    if (!structure || !dataSets || dataSets.length === 0) {
      console.log('⚠️ Invalid SDMX-JSON structure');
      return null;
    }

    // Get dimensions - can be in different locations
    const dimensions = structure?.dimensions?.observation || structure?.dimensions?.series;
    if (!dimensions || !Array.isArray(dimensions)) {
      console.log('⚠️ No dimensions found in structure');
      return null;
    }

    console.log(`Found ${dimensions.length} dimensions:`, dimensions.map((d: any) => d.id).join(', '));

    // Find POA (Postcode Area) dimension
    let poaDimension = dimensions.find((d: any) => 
      d.id === 'POA' || d.id === 'REGION' || d.id === 'REGIONTYPE'
    );

    if (!poaDimension) {
      console.log('⚠️ POA dimension not found, checking dimension names...');
      poaDimension = dimensions.find((d: any) => 
        d.name?.toLowerCase().includes('postcode') || 
        d.name?.toLowerCase().includes('poa')
      );
    }

    if (!poaDimension) {
      console.log('❌ Could not locate postcode dimension');
      return null;
    }

    console.log('✅ Found POA dimension:', poaDimension.id);

    // Find postcode in values
    const postcodePattern = [`POA${postcode}`, `POA ${postcode}`, postcode];
    let postcodeIndex = -1;
    
    for (const pattern of postcodePattern) {
      postcodeIndex = poaDimension.values?.findIndex((v: any) => 
        v.id === pattern || v.id?.includes(postcode) || v.name?.includes(postcode)
      );
      if (postcodeIndex !== -1) {
        console.log(`✅ Found postcode at index ${postcodeIndex} with pattern: ${pattern}`);
        break;
      }
    }

    if (postcodeIndex === -1) {
      console.log(`⚠️ Postcode ${postcode} not found in dimension values`);
      return null;
    }

    // Find MEASURE dimension for SEIFA types
    const measureDimension = dimensions.find((d: any) => 
      d.id === 'MEASURE' || d.id === 'SEIFA' || d.id === 'INDEX'
    );

    if (!measureDimension) {
      console.log('⚠️ MEASURE dimension not found');
    } else {
      console.log('✅ Found MEASURE dimension with values:', 
        measureDimension.values?.map((v: any) => v.id).join(', ')
      );
    }

    // Extract observations
    const observations = dataSets[0]?.observations || dataSets[0]?.series;
    if (!observations) {
      console.log('❌ No observations found in dataset');
      return null;
    }

    console.log(`Found ${Object.keys(observations).length} observations`);

    // Parse SEIFA scores from observations
    const scores: any = {
      irsad: { score: null, decile: null },
      irsd: { score: null, decile: null },
      ier: { score: null, decile: null },
      ieo: { score: null, decile: null }
    };

    // Observation keys format varies:
    // Could be "0:1:2" (measure:region:time) or "1:2" (region:time)
    for (const [key, value] of Object.entries(observations)) {
      const parts = key.split(':').map(Number);
      
      // Check if this observation matches our postcode
      let isMatch = false;
      let measureIdx = -1;
      
      if (parts.length === 3) {
        // Format: measure:region:time
        isMatch = parts[1] === postcodeIndex;
        measureIdx = parts[0];
      } else if (parts.length === 2) {
        // Format: region:measure or region:time
        isMatch = parts[0] === postcodeIndex;
        measureIdx = parts[1];
      } else if (parts.length === 1) {
        // Format: flat index - need to calculate
        isMatch = parts[0] === postcodeIndex;
      }

      if (isMatch) {
        let scoreValue: number | null = null;
        let decileValue: number | null = null;

        // Value can be array [score] or array [score, decile] or just number
        if (Array.isArray(value)) {
          scoreValue = value[0] ?? null;
          decileValue = value[1] ?? null;
        } else if (typeof value === 'number') {
          scoreValue = value;
        }

        if (scoreValue !== null) {
          // Determine which SEIFA measure this is
          const measureValue = measureDimension?.values?.[measureIdx];
          const measureId = measureValue?.id?.toLowerCase() || '';
          
          if (measureId.includes('irsad') || measureIdx === 0) {
            scores.irsad.score = scoreValue;
            scores.irsad.decile = decileValue ?? calculateDecile(scoreValue);
          } else if (measureId.includes('irsd') || measureIdx === 1) {
            scores.irsd.score = scoreValue;
            scores.irsd.decile = decileValue ?? calculateDecile(scoreValue);
          } else if (measureId.includes('ier') && !measureId.includes('ieo')) {
            scores.ier.score = scoreValue;
            scores.ier.decile = decileValue ?? calculateDecile(scoreValue);
          } else if (measureId.includes('ieo')) {
            scores.ieo.score = scoreValue;
            scores.ieo.decile = decileValue ?? calculateDecile(scoreValue);
          }
          
          console.log(`Found score for measure ${measureId || measureIdx}: ${scoreValue} (decile: ${decileValue || 'calculated'})`);
        }
      }
    }

    // Check if we found any valid scores
    const hasData = scores.irsad.score || scores.irsd.score || scores.ier.score || scores.ieo.score;
    
    if (!hasData) {
      console.log('⚠️ No valid SEIFA scores found for postcode');
      return null;
    }

    const result = {
      irsad: scores.irsad.score,
      irsadDecile: scores.irsad.decile,
      irsd: scores.irsd.score,
      irsdDecile: scores.irsd.decile,
      ier: scores.ier.score,
      ierDecile: scores.ier.decile,
      ieo: scores.ieo.score,
      ieoDecile: scores.ieo.decile,
    };

    console.log('✅ Successfully parsed SEIFA data:', JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error('❌ Error parsing SEIFA SDMX-JSON data:', error);
    return null;
  }
}

function calculateDecile(score: number): number {
  // SEIFA scores typically range from ~600 to ~1200
  // Deciles divide the population into 10 equal groups
  // Higher score = higher advantage (for IRSAD, IER, IEO)
  // Lower score = higher disadvantage (for IRSD)
  
  // Validate score range
  if (score < 500 || score > 1300) {
    console.log(`⚠️ Unusual SEIFA score: ${score}`);
  }
  
  if (score < 800) return 1;
  if (score < 850) return 2;
  if (score < 900) return 3;
  if (score < 950) return 4;
  if (score < 1000) return 5;
  if (score < 1050) return 6;
  if (score < 1100) return 7;
  if (score < 1150) return 8;
  if (score < 1200) return 9;
  return 10;
}

function generateSEIFAEstimate(postcode: string, state?: string): any {
  console.log(`⚠️ Generating SEIFA estimates for postcode ${postcode}, state: ${state}`);
  console.log('Note: This is estimated data. Real API data could not be retrieved.');
  
  // Generate reasonable estimates based on postcode patterns
  // This is used when real data is unavailable
  
  const postcodeNum = parseInt(postcode);
  let decile = 5; // Default to middle
  
  // Sydney (2000-2999)
  if (postcodeNum >= 2000 && postcodeNum < 3000) {
    // Eastern suburbs and North Shore are higher
    if ([2026, 2027, 2028, 2030, 2061, 2065, 2088, 2089, 2090].includes(postcodeNum)) {
      decile = 10;
    } else if (postcodeNum >= 2000 && postcodeNum <= 2100) {
      decile = 8;
    } else if (postcodeNum >= 2200 && postcodeNum <= 2300) {
      decile = 4; // Western Sydney
    } else {
      decile = 6;
    }
  }
  // Melbourne (3000-3999)
  else if (postcodeNum >= 3000 && postcodeNum < 4000) {
    if ([3142, 3144, 3181, 3101, 3141].includes(postcodeNum)) {
      decile = 10;
    } else if (postcodeNum <= 3100) {
      decile = 8;
    } else if (postcodeNum >= 3800) {
      decile = 5;
    } else {
      decile = 6;
    }
  }
  // Brisbane (4000-4999)
  else if (postcodeNum >= 4000 && postcodeNum < 5000) {
    if ([4000, 4006, 4007, 4066, 4101].includes(postcodeNum)) {
      decile = 9;
    } else {
      decile = 6;
    }
  }
  // Adelaide (5000-5999)
  else if (postcodeNum >= 5000 && postcodeNum < 6000) {
    decile = 6;
  }
  // Perth (6000-6999)
  else if (postcodeNum >= 6000 && postcodeNum < 7000) {
    if ([6000, 6009, 6010, 6011].includes(postcodeNum)) {
      decile = 8;
    } else {
      decile = 6;
    }
  }
  
  const score = 900 + (decile * 10);
  
  return {
    postcode,
    state: state || 'Unknown',
    irsad: {
      score: score,
      decile: decile,
      description: getSEIFADescription(decile)
    },
    irsd: {
      score: score - 20,
      decile: decile,
      description: 'Index of Relative Socio-economic Disadvantage'
    },
    ier: {
      score: score + 10,
      decile: decile,
      description: 'Index of Economic Resources'
    },
    ieo: {
      score: score + 20,
      decile: decile,
      description: 'Index of Education and Occupation'
    },
    summary: getSEIFASummary(decile),
    dataSource: 'Estimated based on ABS SEIFA patterns',
    dataQuality: 'estimated',
    lastUpdated: '2021 Census (estimated)',
    note: 'SEIFA indexes rank areas based on socio-economic advantage and disadvantage. Decile 10 = most advantaged, Decile 1 = most disadvantaged. This is an estimate - actual ABS data requires postcode-level access.'
  };
}

function getSEIFADescription(decile: number | null): string {
  if (!decile) return 'Unknown';
  
  if (decile >= 9) return 'Very High Advantage';
  if (decile >= 7) return 'High Advantage';
  if (decile >= 5) return 'Moderate Advantage';
  if (decile >= 3) return 'Low Advantage';
  return 'Disadvantaged';
}

function getSEIFASummary(decile: number | null): string {
  if (!decile) return 'Socioeconomic data unavailable';
  
  if (decile >= 9) {
    return 'This area ranks in the top 20% of Australian postcodes for socioeconomic advantage. Residents typically have higher incomes, education levels, and skilled occupations.';
  } else if (decile >= 7) {
    return 'This area ranks above average for socioeconomic advantage. The area has good income levels, education, and employment opportunities.';
  } else if (decile >= 5) {
    return 'This area has moderate socioeconomic characteristics, sitting around the Australian median for income, education, and occupation.';
  } else if (decile >= 3) {
    return 'This area ranks below average for socioeconomic advantage. May have lower median incomes and higher unemployment rates.';
  } else {
    return 'This area ranks in the bottom 20% for socioeconomic advantage. May face challenges with lower incomes, education levels, and employment rates.';
  }
}
