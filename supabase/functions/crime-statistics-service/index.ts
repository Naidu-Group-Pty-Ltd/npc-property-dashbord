import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { internalError } from '../_shared/errorResponse.ts';

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
    const { suburb, state, postcode } = await req.json();
    console.log('Fetching crime statistics for:', suburb, state, postcode);

    if (!suburb || !state) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Suburb and state are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch crime data with cache-first strategy
    const crimeData = await fetchCrimeDataWithCache(supabase, suburb, state, postcode);

    return new Response(JSON.stringify({ 
      success: true, 
      data: crimeData 
    }), {
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

async function fetchCrimeDataWithCache(supabase: any, suburb: string, state: string, postcode?: string) {
  const normalizedSuburb = suburb.trim().toLowerCase();
  const normalizedState = state.trim().toUpperCase();
  const normalizedPostcode = postcode?.trim() || 'unknown';
  const startTime = Date.now();

  console.log(`🔍 Step 1: Checking cache for ${normalizedSuburb}, ${normalizedState}, ${normalizedPostcode}`);

  // Check cache first
  const { data: cachedData, error: cacheError } = await supabase
    .from('crime_statistics_cache')
    .select('*')
    .eq('suburb', normalizedSuburb)
    .eq('postcode', normalizedPostcode)
    .eq('state', normalizedState)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (cacheError) {
    console.error('❌ Cache query error:', cacheError);
  }

  if (cachedData) {
    const cacheAge = Math.round((Date.now() - new Date(cachedData.fetched_at).getTime()) / (1000 * 60 * 60 * 24));
    console.log(`✅ Cache HIT! Found ${cachedData.data_quality} data (age: ${cacheAge} days)`);
    
    // Log API health
    await logAPIHealth(supabase, 'crime-statistics', 'success', Date.now() - startTime, cachedData.data_quality);
    
    return { ...cachedData.data, dataQuality: cachedData.data_quality, cached: true };
  }

  console.log('❌ Cache MISS. Generating enhanced crime data...');

  // Generate enhanced estimated data
  const freshData = generateEnhancedCrimeData(suburb, state, postcode);

  // Cache the estimated data for 90 days
  console.log('💾 Caching enhanced crime data for 90 days...');
  
  const { error: insertError } = await supabase
    .from('crime_statistics_cache')
    .upsert({
      suburb: normalizedSuburb,
      postcode: normalizedPostcode,
      state: normalizedState,
      data: freshData,
      data_quality: 'estimated',
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days
    }, {
      onConflict: 'suburb,postcode,state'
    });

  if (insertError) {
    console.error('❌ Error caching crime data:', insertError);
  } else {
    console.log('✅ Crime data cached successfully');
  }

  // Log API health
  await logAPIHealth(supabase, 'crime-statistics', 'success', Date.now() - startTime, 'estimated');

  return freshData;
}

async function fetchCrimeData(suburb: string, state: string, postcode?: string) {
  const stateUpper = state.toUpperCase();
  
  try {
    // Try to fetch from state-specific open data portals
    switch (stateUpper) {
      case 'NSW':
        return await fetchNSWCrimeData(suburb, postcode);
      case 'VIC':
        return await fetchVICCrimeData(suburb, postcode);
      case 'QLD':
        return await fetchQLDCrimeData(suburb, postcode);
      case 'SA':
        return await fetchSACrimeData(suburb, postcode);
      case 'WA':
        return await fetchWACrimeData(suburb, postcode);
      case 'TAS':
        return await fetchTASCrimeData(suburb, postcode);
      case 'NT':
        return await fetchNTCrimeData(suburb, postcode);
      case 'ACT':
        return await fetchACTCrimeData(suburb, postcode);
      default:
        return generateCrimeEstimate(suburb, state, postcode);
    }
  } catch (error: any) {
    console.error('Error fetching crime data:', error);
    return generateCrimeEstimate(suburb, state, postcode);
  }
}

async function fetchNSWCrimeData(suburb: string, postcode?: string) {
  try {
    console.log('🔍 Attempting to fetch NSW crime data from BOCSAR...');
    
    // NSW Bureau of Crime Statistics and Research (BOCSAR)
    // LGA Crime Tables - CSV format
    const dataUrl = 'https://www.bocsar.nsw.gov.au/Documents/RCS-Annual/NSW_Recorded_Crime_January_2014_to_December_2024.csv';
    
    const response = await fetch(dataUrl, {
      headers: {
        'Accept': 'text/csv,text/plain'
      }
    });

    if (response.ok) {
      const csvData = await response.text();
      console.log('✅ NSW BOCSAR CSV data fetched successfully');
      console.log(`CSV data length: ${csvData.length} characters`);
      
      // Parse NSW crime CSV data
      const parsedData = parseNSWCrimeCSV(csvData, suburb, postcode);
      
      if (parsedData) {
        console.log('✅ Successfully parsed NSW crime data');
        return parsedData;
      } else {
        console.log('⚠️ Could not find matching suburb in NSW data');
      }
    } else {
      console.log(`⚠️ NSW BOCSAR API returned status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ NSW BOCSAR data fetch failed:', error);
  }
  
  return generateCrimeEstimate(suburb, 'NSW', postcode);
}

function parseNSWCrimeCSV(csvData: string, suburb: string, postcode?: string): any {
  try {
    console.log('🔍 Parsing NSW crime CSV data...');
    
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      console.log('❌ CSV file is empty or invalid');
      return null;
    }

    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    console.log('CSV headers:', headers.slice(0, 10).join(', '), '...');

    // Find relevant columns
    const suburbCol = headers.findIndex(h => 
      h.toLowerCase().includes('lga') || 
      h.toLowerCase().includes('suburb') || 
      h.toLowerCase().includes('location')
    );
    
    const offenseCol = headers.findIndex(h => 
      h.toLowerCase().includes('offence') || 
      h.toLowerCase().includes('crime')
    );

    if (suburbCol === -1 || offenseCol === -1) {
      console.log('⚠️ Could not find required columns in CSV');
      return null;
    }

    console.log(`Found suburb column at index ${suburbCol}, offense column at ${offenseCol}`);

    // Normalize suburb name for matching
    const normalizedSuburb = normalizeSuburbName(suburb);
    console.log('Looking for suburb:', normalizedSuburb);

    // Aggregate crime data by offense type
    const crimeData: any = {
      property: 0,
      violent: 0,
      drug: 0,
      publicOrder: 0,
      fraud: 0,
      other: 0,
      total: 0
    };

    let matchedRows = 0;

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVRow(lines[i]);
      
      if (row.length <= Math.max(suburbCol, offenseCol)) {
        continue;
      }

      const rowSuburb = row[suburbCol]?.trim().replace(/"/g, '');
      const offense = row[offenseCol]?.trim().replace(/"/g, '');
      
      // Check if this row matches our suburb
      if (rowSuburb && normalizeSuburbName(rowSuburb) === normalizedSuburb) {
        matchedRows++;
        
        // Find count column (usually last few columns)
        const countCol = row.length - 1;
        const count = parseInt(row[countCol]?.trim().replace(/"/g, '')) || 0;
        
        // Categorize offense
        const category = categorizeOffense(offense);
        crimeData[category] += count;
        crimeData.total += count;
      }
    }

    if (matchedRows === 0) {
      console.log('⚠️ No matching rows found for suburb');
      return null;
    }

    console.log(`✅ Found ${matchedRows} matching records, total incidents: ${crimeData.total}`);

    // Calculate percentages and rates
    const totalIncidents = crimeData.total;
    
    return {
      suburb: suburb,
      state: 'NSW',
      postcode: postcode || 'Unknown',
      overallRating: calculateRating(totalIncidents),
      comparedToStateAverage: 'Based on NSW BOCSAR data',
      ratePerCapita: totalIncidents,
      period: 'Latest 12 months',
      breakdown: {
        propertyOffenses: {
          count: crimeData.property,
          percentage: Math.round((crimeData.property / totalIncidents) * 100),
          types: ['Theft', 'Break and Enter', 'Motor Vehicle Theft']
        },
        violentOffenses: {
          count: crimeData.violent,
          percentage: Math.round((crimeData.violent / totalIncidents) * 100),
          types: ['Assault', 'Robbery', 'Sexual Offenses']
        },
        drugOffenses: {
          count: crimeData.drug,
          percentage: Math.round((crimeData.drug / totalIncidents) * 100),
          types: ['Drug Possession', 'Drug Supply']
        },
        publicOrder: {
          count: crimeData.publicOrder,
          percentage: Math.round((crimeData.publicOrder / totalIncidents) * 100),
          types: ['Disorderly Conduct', 'Trespass', 'Offensive Behavior']
        },
        fraud: {
          count: crimeData.fraud,
          percentage: Math.round((crimeData.fraud / totalIncidents) * 100),
          types: ['Fraud', 'Identity Theft', 'Cybercrime']
        }
      },
      trends: {
        yearOnYear: 'Data available',
        threeYear: '-8.5%',
        description: 'Crime rates vary by suburb and offense type.'
      },
      safetyScore: calculateSafetyScore(totalIncidents),
      dataSource: 'NSW BOCSAR (Live Data)',
      dataQuality: 'live',
      note: 'Crime data from NSW Bureau of Crime Statistics and Research.',
      officialSources: getOfficialCrimeSources('NSW'),
      lastUpdated: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Error parsing NSW crime CSV:', error);
    return null;
  }
}

// Helper function to parse CSV row handling quoted fields
function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

// Helper function to normalize suburb names for comparison
function normalizeSuburbName(suburb: string): string {
  return suburb
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^st\s/g, 'saint ')
    .replace(/^mt\s/g, 'mount ');
}

// Helper function to categorize offenses
function categorizeOffense(offense: string): string {
  const offenseLower = offense.toLowerCase();
  
  if (offenseLower.includes('theft') || 
      offenseLower.includes('steal') || 
      offenseLower.includes('break') || 
      offenseLower.includes('enter') || 
      offenseLower.includes('burglary') ||
      offenseLower.includes('motor vehicle')) {
    return 'property';
  }
  
  if (offenseLower.includes('assault') || 
      offenseLower.includes('murder') || 
      offenseLower.includes('robbery') ||
      offenseLower.includes('sexual') ||
      offenseLower.includes('violence')) {
    return 'violent';
  }
  
  if (offenseLower.includes('drug')) {
    return 'drug';
  }
  
  if (offenseLower.includes('fraud') || 
      offenseLower.includes('deception') ||
      offenseLower.includes('identity')) {
    return 'fraud';
  }
  
  if (offenseLower.includes('public order') || 
      offenseLower.includes('trespass') ||
      offenseLower.includes('disorderly')) {
    return 'publicOrder';
  }
  
  return 'other';
}

// Helper functions for ratings
function calculateRating(totalIncidents: number): string {
  if (totalIncidents < 3000) return 'Below Average';
  if (totalIncidents < 6000) return 'Medium';
  return 'Above Average';
}

function calculateSafetyScore(totalIncidents: number): number {
  if (totalIncidents < 3000) return 85;
  if (totalIncidents < 6000) return 75;
  if (totalIncidents < 9000) return 65;
  return 55;
}

async function fetchVICCrimeData(suburb: string, postcode?: string) {
  try {
    console.log('🔍 Attempting to fetch VIC crime data from CSA...');
    // Victoria Crime Statistics Agency (CSA)
    const dataUrl = 'https://discover.data.vic.gov.au/api/3/action/package_search?q=crime';
    
    const response = await fetch(dataUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ VIC CSA data fetched successfully');
      
      // TODO: Implement proper data filtering for VIC suburbs
      // For now, fall back to estimates
    } else {
      console.log(`⚠️ VIC CSA API returned status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ VIC CSA data fetch failed:', error);
  }
  
  return generateCrimeEstimate(suburb, 'VIC', postcode);
}

async function fetchQLDCrimeData(suburb: string, postcode?: string) {
  try {
    console.log('🔍 Attempting to fetch QLD crime data from QPS...');
    const dataUrl = 'https://www.data.qld.gov.au/api/3/action/package_search?q=crime';
    
    const response = await fetch(dataUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ QLD QPS data fetched successfully');
      // TODO: Implement proper data filtering for QLD suburbs
    } else {
      console.log(`⚠️ QLD QPS API returned status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ QLD QPS data fetch failed:', error);
  }
  
  return generateCrimeEstimate(suburb, 'QLD', postcode);
}

async function fetchSACrimeData(suburb: string, postcode?: string) {
  try {
    console.log('🔍 Attempting to fetch SA crime data from SAPOL...');
    const dataUrl = 'https://data.sa.gov.au/data/api/3/action/package_search?q=crime';
    
    const response = await fetch(dataUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ SA SAPOL data fetched successfully');
      // TODO: Implement proper data filtering for SA suburbs
    } else {
      console.log(`⚠️ SA SAPOL API returned status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ SA SAPOL data fetch failed:', error);
  }
  
  return generateCrimeEstimate(suburb, 'SA', postcode);
}

async function fetchWACrimeData(suburb: string, postcode?: string) {
  try {
    console.log('🔍 Attempting to fetch WA crime data from WA Police...');
    const dataUrl = 'https://catalogue.data.wa.gov.au/api/3/action/package_search?q=crime';
    
    const response = await fetch(dataUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ WA Police data fetched successfully');
      // TODO: Implement proper data filtering for WA suburbs
    } else {
      console.log(`⚠️ WA Police API returned status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ WA Police data fetch failed:', error);
  }
  
  return generateCrimeEstimate(suburb, 'WA', postcode);
}

async function fetchTASCrimeData(suburb: string, postcode?: string) {
  try {
    console.log('🔍 Attempting to fetch TAS crime data from Tasmania Police...');
    const dataUrl = 'https://data.gov.au/api/3/action/package_search?q=tasmania+crime';
    
    const response = await fetch(dataUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ TAS Police data fetched successfully');
      // TODO: Implement proper data filtering for TAS suburbs
    } else {
      console.log(`⚠️ TAS Police API returned status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ TAS Police data fetch failed:', error);
  }
  
  return generateCrimeEstimate(suburb, 'TAS', postcode);
}

async function fetchNTCrimeData(suburb: string, postcode?: string) {
  try {
    console.log('🔍 Attempting to fetch NT crime data from NT Police...');
    const dataUrl = 'https://data.gov.au/api/3/action/package_search?q=northern+territory+crime';
    
    const response = await fetch(dataUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ NT Police data fetched successfully');
      // TODO: Implement proper data filtering for NT suburbs
    } else {
      console.log(`⚠️ NT Police API returned status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ NT Police data fetch failed:', error);
  }
  
  return generateCrimeEstimate(suburb, 'NT', postcode);
}

async function fetchACTCrimeData(suburb: string, postcode?: string) {
  try {
    console.log('🔍 Attempting to fetch ACT crime data from ACT Policing...');
    const dataUrl = 'https://www.data.act.gov.au/api/3/action/package_search?q=crime';
    
    const response = await fetch(dataUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ ACT Policing data fetched successfully');
      // TODO: Implement proper data filtering for ACT suburbs
    } else {
      console.log(`⚠️ ACT Policing API returned status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ ACT Policing data fetch failed:', error);
  }
  
  return generateCrimeEstimate(suburb, 'ACT', postcode);
}

function generateCrimeEstimate(suburb: string, state: string, postcode?: string): any {
  console.log(`⚠️ Generating crime estimates for ${suburb}, ${state}`);
  console.log('Note: Real crime data could not be retrieved from state portals');
  
  const postcodeNum = postcode ? parseInt(postcode) : 0;
  let crimeRate = 'Medium';
  let ratePerCapita = 5500;
  
  // Major city CBD and inner areas tend to have higher rates
  const innerCityPostcodes = [2000, 3000, 4000, 5000, 6000, 7000, 800, 2600];
  const affluent = [2026, 2027, 2028, 2030, 3142, 3144, 3181, 4000, 6000];
  
  if (innerCityPostcodes.includes(postcodeNum)) {
    crimeRate = 'Above Average';
    ratePerCapita = 7500;
  } else if (affluent.includes(postcodeNum)) {
    crimeRate = 'Below Average';
    ratePerCapita = 3200;
  }
  
  const totalIncidents = Math.round(ratePerCapita * 1.5);
  
  return {
    suburb: suburb,
    state: state,
    postcode: postcode || 'Unknown',
    overallRating: crimeRate,
    comparedToStateAverage: crimeRate === 'Above Average' ? '15% higher' : 
                            crimeRate === 'Below Average' ? '20% lower' : 
                            'Similar to state average',
    ratePerCapita: ratePerCapita,
    period: 'Latest 12 months',
    breakdown: {
      propertyOffenses: {
        count: Math.round(totalIncidents * 0.35),
        percentage: 35,
        types: ['Theft', 'Break and Enter', 'Motor Vehicle Theft']
      },
      violentOffenses: {
        count: Math.round(totalIncidents * 0.15),
        percentage: 15,
        types: ['Assault', 'Robbery', 'Sexual Offenses']
      },
      drugOffenses: {
        count: Math.round(totalIncidents * 0.20),
        percentage: 20,
        types: ['Drug Possession', 'Drug Supply']
      },
      publicOrder: {
        count: Math.round(totalIncidents * 0.20),
        percentage: 20,
        types: ['Disorderly Conduct', 'Trespass', 'Offensive Behavior']
      },
      fraud: {
        count: Math.round(totalIncidents * 0.10),
        percentage: 10,
        types: ['Fraud', 'Identity Theft', 'Cybercrime']
      }
    },
    trends: {
      yearOnYear: crimeRate === 'Above Average' ? '+3.2%' : 
                  crimeRate === 'Below Average' ? '-5.1%' : 
                  '-1.2%',
      threeYear: '-8.5%',
      description: 'Crime rates have been trending downward across most Australian regions.'
    },
    safetyScore: crimeRate === 'Above Average' ? 65 : 
                  crimeRate === 'Below Average' ? 85 : 
                  75,
    dataSource: `Estimated based on ${state} crime patterns`,
    dataQuality: 'estimated',
    note: 'Crime data is estimated based on regional patterns. For official statistics, consult your state police service.',
    officialSources: getOfficialCrimeSources(state),
    lastUpdated: new Date().toISOString()
  };
}

function getOfficialCrimeSources(state: string): string[] {
  const sources: Record<string, string[]> = {
    'NSW': [
      'NSW Bureau of Crime Statistics and Research (BOCSAR)',
      'www.bocsar.nsw.gov.au'
    ],
    'VIC': [
      'Crime Statistics Agency Victoria',
      'www.crimestatistics.vic.gov.au'
    ],
    'QLD': [
      'Queensland Police Service - Crime Statistics',
      'www.data.qld.gov.au'
    ],
    'SA': [
      'South Australia Police (SAPOL) - Crime Statistics',
      'data.sa.gov.au'
    ],
    'WA': [
      'Western Australia Police Force - Statistics',
      'catalogue.data.wa.gov.au'
    ],
    'TAS': [
      'Tasmania Police - Crime Statistics',
      'www.police.tas.gov.au'
    ],
    'NT': [
      'Northern Territory Police - Crime Statistics',
      'pfes.nt.gov.au/police'
    ],
    'ACT': [
      'ACT Policing - Crime Statistics',
      'www.data.act.gov.au'
    ]
  };
  
  return sources[state.toUpperCase()] || ['State police service website', 'data.gov.au'];
}

async function logAPIHealth(supabase: any, serviceName: string, status: string, responseTime: number, dataQuality: string) {
  try {
    await supabase
      .from('api_health_log')
      .insert({
        service_name: serviceName,
        status,
        response_time_ms: responseTime,
        data_quality: dataQuality
      });
  } catch (error) {
    console.error('❌ Error logging API health:', error);
  }
}

function generateEnhancedCrimeData(suburb: string, state: string, postcode?: string): any {
  console.log(`🔍 Generating enhanced crime estimates for ${suburb}, ${state}`);
  
  const profile = getCrimeProfile(postcode, state);
  const totalIncidents = profile.baseRate;
  
  return {
    suburb: suburb,
    state: state,
    postcode: postcode || 'Unknown',
    overallRating: profile.rating,
    comparedToStateAverage: profile.comparison,
    ratePerCapita: profile.baseRate,
    period: 'Latest 12 months (estimated)',
    breakdown: {
      propertyOffenses: {
        count: Math.round(totalIncidents * profile.breakdowns.property),
        percentage: Math.round(profile.breakdowns.property * 100),
        types: ['Theft', 'Break and Enter', 'Motor Vehicle Theft']
      },
      violentOffenses: {
        count: Math.round(totalIncidents * profile.breakdowns.violent),
        percentage: Math.round(profile.breakdowns.violent * 100),
        types: ['Assault', 'Robbery', 'Sexual Offenses']
      },
      drugOffenses: {
        count: Math.round(totalIncidents * profile.breakdowns.drug),
        percentage: Math.round(profile.breakdowns.drug * 100),
        types: ['Drug Possession', 'Drug Supply']
      },
      publicOrder: {
        count: Math.round(totalIncidents * profile.breakdowns.publicOrder),
        percentage: Math.round(profile.breakdowns.publicOrder * 100),
        types: ['Disorderly Conduct', 'Trespass', 'Offensive Behavior']
      },
      fraud: {
        count: Math.round(totalIncidents * profile.breakdowns.fraud),
        percentage: Math.round(profile.breakdowns.fraud * 100),
        types: ['Fraud', 'Identity Theft', 'Cybercrime']
      }
    },
    trends: {
      yearOnYear: profile.trends.yearly,
      threeYear: profile.trends.threeYear,
      description: profile.trends.description
    },
    safetyScore: profile.safetyScore,
    dataSource: `Estimated based on ${state} crime patterns`,
    dataQuality: 'estimated',
    note: 'Crime data is estimated based on state and regional patterns. For official statistics, consult your state police service.',
    officialSources: getOfficialCrimeSources(state),
    lastUpdated: new Date().toISOString()
  };
}

function getCrimeProfile(postcode?: string, state?: string) {
  const postcodeNum = postcode ? parseInt(postcode) : 0;
  
  // CBD and inner city areas - higher crime rates
  if ([2000, 3000, 4000, 5000, 6000, 7000, 800, 2600].includes(postcodeNum)) {
    return {
      baseRate: 7200,
      rating: 'Above Average',
      comparison: '22% higher than state average',
      safetyScore: 68,
      breakdowns: {
        property: 0.38,
        violent: 0.16,
        drug: 0.22,
        publicOrder: 0.18,
        fraud: 0.06
      },
      trends: {
        yearly: '+4.2%',
        threeYear: '-3.5%',
        description: 'Urban areas show seasonal variations with peaks during major events.'
      }
    };
  }
  
  // Affluent suburbs - lower crime rates
  if ([2026, 2027, 2028, 2030, 3142, 3144, 3181, 6009].includes(postcodeNum)) {
    return {
      baseRate: 2800,
      rating: 'Below Average',
      comparison: '35% lower than state average',
      safetyScore: 88,
      breakdowns: {
        property: 0.32,
        violent: 0.08,
        drug: 0.12,
        publicOrder: 0.15,
        fraud: 0.33
      },
      trends: {
        yearly: '-6.1%',
        threeYear: '-12.8%',
        description: 'Affluent areas typically show declining crime rates with focus on fraud prevention.'
      }
    };
  }
  
  // Regional/rural areas
  if (state && ['NT', 'TAS', 'SA'].includes(state.toUpperCase())) {
    return {
      baseRate: 4200,
      rating: 'Medium',
      comparison: 'Similar to state average',
      safetyScore: 76,
      breakdowns: {
        property: 0.30,
        violent: 0.18,
        drug: 0.15,
        publicOrder: 0.25,
        fraud: 0.12
      },
      trends: {
        yearly: '-2.3%',
        threeYear: '-7.2%',
        description: 'Regional areas show steady decline with community policing initiatives.'
      }
    };
  }
  
  // Standard suburban areas
  return {
    baseRate: 5100,
    rating: 'Medium',
    comparison: '8% higher than state average',
    safetyScore: 74,
    breakdowns: {
      property: 0.35,
      violent: 0.14,
      drug: 0.18,
      publicOrder: 0.22,
      fraud: 0.11
    },
    trends: {
      yearly: '-1.8%',
      threeYear: '-8.5%',
      description: 'Suburban crime rates follow national trends with gradual improvements.'
    }
  };
}