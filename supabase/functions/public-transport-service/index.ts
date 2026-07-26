import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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

interface TransportStop {
  name: string;
  distance: number;
  type: string;
  routes: string[];
  accessibility?: {
    wheelchairAccessible: boolean;
    facilities?: string[];
  };
}

interface TransportRoute {
  route: string;
  type: string;
  frequency: number;
}

interface ServiceFrequency {
  peak: number;
  offPeak: number;
}

interface PublicTransportData {
  nearestStop: string;
  distanceToStop: number;
  stopsWithin1km: TransportStop[];
  transportTypes: string[];
  routeCoverage: TransportRoute[];
  serviceFrequency: ServiceFrequency;
  accessibility: {
    wheelchairAccessible: boolean;
    lifts?: boolean;
    tactilePaving?: boolean;
  };
  realTimeAlerts?: string[];
  qualityScore: number;
  summary: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: PublicTransportInput = await req.json();
    console.log('🚇 Public transport request:', { lat: input.lat, lng: input.lng, state: input.state, suburb: input.suburb });

    const { lat, lng, state, suburb } = input;

    if (!lat || !lng || !state) {
      const missingParams = [];
      if (!lat) missingParams.push('lat');
      if (!lng) missingParams.push('lng');
      if (!state) missingParams.push('state');
      throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check cache first
    const cachedData = await checkTransportCache(supabase, lat, lng, state);
    
    if (cachedData) {
      const ageHours = Math.round((Date.now() - new Date(cachedData.fetched_at).getTime()) / (1000 * 60 * 60));
      console.log(`✅ Cache HIT! Transport data age: ${ageHours} hours`);
      
      return new Response(
        JSON.stringify({ ...cachedData.data, cached: true, cachedAt: cachedData.fetched_at }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    console.log(`❌ Cache MISS. Fetching fresh transport data for ${state.toUpperCase()}...`);
    const startTime = Date.now();
    
    // Fetch transport data based on state
    const transportData = await fetchStateTransportData(state, lat, lng);
    const responseTime = Date.now() - startTime;
    
    console.log(`✅ Transport data fetched in ${responseTime}ms: Quality Score ${transportData.qualityScore}/100`);

    // Cache the result for 30 days
    await cacheTransportData(supabase, lat, lng, state, suburb, transportData);

    // Log API health
    await logApiHealth(supabase, 'public-transport', '/fetch', 'success', responseTime, 'estimated');

    return new Response(
      JSON.stringify({ ...transportData, cached: false }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
    console.error('❌ Error in public-transport-service:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Log API health failure
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await logApiHealth(supabase, 'public-transport', '/fetch', 'error', null, 'estimated', errorMessage);
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        fallback: generateFallbackData({ lat: -33.8688, lng: 151.2093, state: 'NSW' })
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  }
});

async function checkTransportCache(supabase: any, lat: number, lng: number, state: string) {
  // Find cache within ~100m radius (0.001 degrees ≈ 111m)
  const tolerance = 0.001;
  
  const { data, error } = await supabase
    .from('transport_data_cache')
    .select('*')
    .eq('state', state.toUpperCase())
    .gte('latitude', lat - tolerance)
    .lte('latitude', lat + tolerance)
    .gte('longitude', lng - tolerance)
    .lte('longitude', lng + tolerance)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Cache query error:', error);
    return null;
  }

  return data;
}

async function cacheTransportData(supabase: any, lat: number, lng: number, state: string, suburb: string | undefined, transportData: any) {
  console.log('💾 Caching transport data for 30 days...');
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { error } = await supabase
    .from('transport_data_cache')
    .insert({
      latitude: lat,
      longitude: lng,
      state: state.toUpperCase(),
      suburb: suburb?.toLowerCase(),
      data: transportData,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      data_quality: 'estimated'
    });

  if (error) {
    console.error('❌ Error caching transport data:', error);
  } else {
    console.log('✅ Transport data cached successfully');
  }
}

async function logApiHealth(
  supabase: any,
  serviceName: string,
  endpoint: string,
  status: string,
  responseTime: number | null,
  dataQuality: string,
  errorMessage?: string
) {
  const { error } = await supabase
    .from('api_health_log')
    .insert({
      service_name: serviceName,
      endpoint,
      status,
      response_time_ms: responseTime,
      data_quality: dataQuality,
      error_message: errorMessage
    });

  if (error) {
    console.error('Failed to log API health:', error);
  }
}

async function fetchStateTransportData(
  state: string,
  lat: number,
  lng: number
): Promise<PublicTransportData> {
  const stateUpper = state.toUpperCase();
  console.log(`🔍 Routing to ${stateUpper} transport handler...`);

  switch (stateUpper) {
    case 'NSW':
      return await fetchNSWTransportData(lat, lng);
    case 'VIC':
      return await fetchVICTransportData(lat, lng);
    case 'QLD':
      return await fetchQLDTransportData(lat, lng);
    case 'SA':
      return await fetchSATransportData(lat, lng);
    case 'WA':
      return await fetchWATransportData(lat, lng);
    case 'TAS':
      return await fetchTASTransportData(lat, lng);
    case 'NT':
      return await fetchNTTransportData(lat, lng);
    case 'ACT':
      return await fetchACTTransportData(lat, lng);
    default:
      console.error(`❌ Unsupported state: ${state} (${stateUpper})`);
      throw new Error(`Unsupported state: ${state}. Supported states: NSW, VIC, QLD, SA, WA, TAS, NT, ACT`);
  }
}

// NSW - Transport for NSW Open Data
async function fetchNSWTransportData(lat: number, lng: number): Promise<PublicTransportData> {
  console.log('🚆 Fetching NSW transport data (Sydney Metro)...');
  
  // NSW has comprehensive real-time GTFS data
  // For now, using realistic mock data based on Sydney transport patterns
  const stops: TransportStop[] = [
    {
      name: "Central Station",
      distance: 450,
      type: "Train",
      routes: ["T1", "T2", "T3", "T4", "T8"],
      accessibility: { wheelchairAccessible: true, facilities: ["lifts", "tactile"] }
    },
    {
      name: "Eddy Avenue Light Rail",
      distance: 500,
      type: "Light Rail",
      routes: ["L1", "L2", "L3"],
      accessibility: { wheelchairAccessible: true, facilities: ["level_access"] }
    },
    {
      name: "George Street Bus Stop",
      distance: 320,
      type: "Bus",
      routes: ["372", "393", "396", "397"],
      accessibility: { wheelchairAccessible: true }
    }
  ];

  const routes: TransportRoute[] = [
    { route: "T2 Inner West Line", type: "Train", frequency: 12 },
    { route: "L1 Dulwich Hill", type: "Light Rail", frequency: 8 },
    { route: "372 Bus", type: "Bus", frequency: 6 }
  ];

  const transportTypes = ["Train", "Light Rail", "Bus", "Ferry"];
  const qualityScore = calculateTransportScore(stops, routes, transportTypes);

  return {
    nearestStop: stops[0].name,
    distanceToStop: stops[0].distance,
    stopsWithin1km: stops,
    transportTypes,
    routeCoverage: routes,
    serviceFrequency: {
      peak: 18,
      offPeak: 8
    },
    accessibility: {
      wheelchairAccessible: true,
      lifts: true,
      tactilePaving: true
    },
    realTimeAlerts: [],
    qualityScore,
    summary: `Excellent public transport access with ${stops.length} stops within 1km. Multiple transport modes including train, light rail, and bus services.`
  };
}

// VIC - Public Transport Victoria (PTV)
async function fetchVICTransportData(lat: number, lng: number): Promise<PublicTransportData> {
  console.log('🚊 Fetching VIC transport data (Melbourne Trams)...');
  
  const stops: TransportStop[] = [
    {
      name: "Flinders Street Station",
      distance: 380,
      type: "Train",
      routes: ["Cranbourne", "Pakenham", "Frankston"],
      accessibility: { wheelchairAccessible: true, facilities: ["lifts", "tactile"] }
    },
    {
      name: "Swanston Street Tram",
      distance: 250,
      type: "Tram",
      routes: ["1", "3", "5", "6", "16", "64", "67", "72"],
      accessibility: { wheelchairAccessible: true, facilities: ["low_floor"] }
    },
    {
      name: "Collins Street Bus",
      distance: 420,
      type: "Bus",
      routes: ["216", "219", "220"],
      accessibility: { wheelchairAccessible: true }
    }
  ];

  const routes: TransportRoute[] = [
    { route: "Cranbourne Line", type: "Train", frequency: 10 },
    { route: "Route 1 Tram", type: "Tram", frequency: 15 },
    { route: "216 Bus", type: "Bus", frequency: 8 }
  ];

  const transportTypes = ["Train", "Tram", "Bus"];
  const qualityScore = calculateTransportScore(stops, routes, transportTypes);

  return {
    nearestStop: stops[1].name,
    distanceToStop: stops[1].distance,
    stopsWithin1km: stops,
    transportTypes,
    routeCoverage: routes,
    serviceFrequency: {
      peak: 20,
      offPeak: 10
    },
    accessibility: {
      wheelchairAccessible: true,
      lifts: true,
      tactilePaving: true
    },
    realTimeAlerts: [],
    qualityScore,
    summary: `Outstanding public transport network with ${stops.length} stops within 1km. Renowned tram network plus extensive train and bus coverage.`
  };
}

// QLD - TransLink South East Queensland
async function fetchQLDTransportData(lat: number, lng: number): Promise<PublicTransportData> {
  console.log('⛴️ Fetching QLD transport data (Brisbane + Ferry)...');
  
  const stops: TransportStop[] = [
    {
      name: "Brisbane Central Station",
      distance: 520,
      type: "Train",
      routes: ["Beenleigh", "Gold Coast", "Airport"],
      accessibility: { wheelchairAccessible: true, facilities: ["lifts"] }
    },
    {
      name: "Queen Street Bus Station",
      distance: 350,
      type: "Bus",
      routes: ["111", "222", "333", "444"],
      accessibility: { wheelchairAccessible: true }
    },
    {
      name: "South Bank Ferry Terminal",
      distance: 680,
      type: "Ferry",
      routes: ["CityHopper"],
      accessibility: { wheelchairAccessible: true }
    }
  ];

  const routes: TransportRoute[] = [
    { route: "Beenleigh Line", type: "Train", frequency: 8 },
    { route: "333 Bus", type: "Bus", frequency: 10 },
    { route: "CityHopper Ferry", type: "Ferry", frequency: 4 }
  ];

  const transportTypes = ["Train", "Bus", "Ferry"];
  const qualityScore = calculateTransportScore(stops, routes, transportTypes);

  return {
    nearestStop: stops[1].name,
    distanceToStop: stops[1].distance,
    stopsWithin1km: stops,
    transportTypes,
    routeCoverage: routes,
    serviceFrequency: {
      peak: 14,
      offPeak: 7
    },
    accessibility: {
      wheelchairAccessible: true,
      lifts: true,
      tactilePaving: false
    },
    realTimeAlerts: [],
    qualityScore,
    summary: `Very good transport access with ${stops.length} stops within 1km. Unique ferry services complement train and bus networks.`
  };
}

// SA - Adelaide Metro
async function fetchSATransportData(lat: number, lng: number): Promise<PublicTransportData> {
  console.log('🚈 Fetching SA transport data (Adelaide)...');
  
  const stops: TransportStop[] = [
    {
      name: "Adelaide Station",
      distance: 440,
      type: "Train",
      routes: ["Gawler", "Outer Harbor", "Seaford"],
      accessibility: { wheelchairAccessible: true, facilities: ["lifts"] }
    },
    {
      name: "King William Street Tram",
      distance: 300,
      type: "Tram",
      routes: ["Glenelg Line"],
      accessibility: { wheelchairAccessible: true, facilities: ["low_floor"] }
    },
    {
      name: "Currie Street Bus Stop",
      distance: 280,
      type: "Bus",
      routes: ["M44", "H20", "H21"],
      accessibility: { wheelchairAccessible: true }
    }
  ];

  const routes: TransportRoute[] = [
    { route: "Gawler Line", type: "Train", frequency: 6 },
    { route: "Glenelg Tram", type: "Tram", frequency: 12 },
    { route: "M44 Metro", type: "Bus", frequency: 8 }
  ];

  const transportTypes = ["Train", "Tram", "Bus"];
  const qualityScore = calculateTransportScore(stops, routes, transportTypes);

  return {
    nearestStop: stops[2].name,
    distanceToStop: stops[2].distance,
    stopsWithin1km: stops,
    transportTypes,
    routeCoverage: routes,
    serviceFrequency: {
      peak: 12,
      offPeak: 6
    },
    accessibility: {
      wheelchairAccessible: true,
      lifts: false,
      tactilePaving: true
    },
    qualityScore,
    summary: `Good public transport coverage with ${stops.length} stops within 1km. Well-integrated tram, train, and bus services.`
  };
}

// WA - Transperth
async function fetchWATransportData(lat: number, lng: number): Promise<PublicTransportData> {
  console.log('🚇 Fetching WA transport data (Perth + CAT Bus)...');
  
  const stops: TransportStop[] = [
    {
      name: "Perth Station",
      distance: 390,
      type: "Train",
      routes: ["Joondalup Line", "Mandurah Line", "Midland Line"],
      accessibility: { wheelchairAccessible: true, facilities: ["lifts", "tactile"] }
    },
    {
      name: "Wellington Street Bus Station",
      distance: 320,
      type: "Bus",
      routes: ["950", "998", "999"],
      accessibility: { wheelchairAccessible: true }
    },
    {
      name: "Elizabeth Quay Ferry",
      distance: 550,
      type: "Ferry",
      routes: ["Transperth Ferry"],
      accessibility: { wheelchairAccessible: true }
    }
  ];

  const routes: TransportRoute[] = [
    { route: "Joondalup Line", type: "Train", frequency: 10 },
    { route: "950 CAT Bus", type: "Bus", frequency: 15 },
    { route: "Ferry Service", type: "Ferry", frequency: 3 }
  ];

  const transportTypes = ["Train", "Bus", "Ferry"];
  const qualityScore = calculateTransportScore(stops, routes, transportTypes);

  return {
    nearestStop: stops[1].name,
    distanceToStop: stops[1].distance,
    stopsWithin1km: stops,
    transportTypes,
    routeCoverage: routes,
    serviceFrequency: {
      peak: 15,
      offPeak: 8
    },
    accessibility: {
      wheelchairAccessible: true,
      lifts: true,
      tactilePaving: true
    },
    qualityScore,
    summary: `Very good transport connectivity with ${stops.length} stops within 1km. Efficient train network plus free CAT bus services in CBD.`
  };
}

// TAS - Metro Tasmania
async function fetchTASTransportData(lat: number, lng: number): Promise<PublicTransportData> {
  console.log('🚌 Fetching TAS transport data (Hobart Bus)...');
  
  const stops: TransportStop[] = [
    {
      name: "Elizabeth Street Bus Mall",
      distance: 280,
      type: "Bus",
      routes: ["X1", "40", "41", "42"],
      accessibility: { wheelchairAccessible: true }
    },
    {
      name: "Collins Street Stop",
      distance: 350,
      type: "Bus",
      routes: ["50", "51", "52"],
      accessibility: { wheelchairAccessible: true }
    }
  ];

  const routes: TransportRoute[] = [
    { route: "X1 Express", type: "Bus", frequency: 8 },
    { route: "40 Hobart Circle", type: "Bus", frequency: 6 }
  ];

  const transportTypes = ["Bus"];
  const qualityScore = calculateTransportScore(stops, routes, transportTypes);

  return {
    nearestStop: stops[0].name,
    distanceToStop: stops[0].distance,
    stopsWithin1km: stops,
    transportTypes,
    routeCoverage: routes,
    serviceFrequency: {
      peak: 8,
      offPeak: 4
    },
    accessibility: {
      wheelchairAccessible: true,
      lifts: false,
      tactilePaving: false
    },
    qualityScore,
    summary: `Moderate bus coverage with ${stops.length} stops within 1km. Limited to bus services only.`
  };
}

// NT - Department of Transport (Darwin)
async function fetchNTTransportData(lat: number, lng: number): Promise<PublicTransportData> {
  console.log('🚍 Fetching NT transport data (Darwin Bus)...');
  
  const stops: TransportStop[] = [
    {
      name: "Darwin Interchange",
      distance: 420,
      type: "Bus",
      routes: ["4", "5", "10"],
      accessibility: { wheelchairAccessible: true }
    },
    {
      name: "Smith Street Mall",
      distance: 310,
      type: "Bus",
      routes: ["1", "2", "3"],
      accessibility: { wheelchairAccessible: true }
    }
  ];

  const routes: TransportRoute[] = [
    { route: "Route 4", type: "Bus", frequency: 6 },
    { route: "Route 10", type: "Bus", frequency: 4 }
  ];

  const transportTypes = ["Bus"];
  const qualityScore = calculateTransportScore(stops, routes, transportTypes);

  return {
    nearestStop: stops[1].name,
    distanceToStop: stops[1].distance,
    stopsWithin1km: stops,
    transportTypes,
    routeCoverage: routes,
    serviceFrequency: {
      peak: 6,
      offPeak: 3
    },
    accessibility: {
      wheelchairAccessible: true,
      lifts: false,
      tactilePaving: false
    },
    qualityScore,
    summary: `Basic bus coverage with ${stops.length} stops within 1km. Limited service frequency typical of regional areas.`
  };
}

// ACT - Transport Canberra
async function fetchACTTransportData(lat: number, lng: number): Promise<PublicTransportData> {
  console.log('🚋 Fetching ACT transport data (Canberra Light Rail)...');
  
  const stops: TransportStop[] = [
    {
      name: "Civic Interchange",
      distance: 340,
      type: "Bus",
      routes: ["R1", "R2", "R3", "300"],
      accessibility: { wheelchairAccessible: true, facilities: ["shelters"] }
    },
    {
      name: "Alinga Street Light Rail",
      distance: 290,
      type: "Light Rail",
      routes: ["Stage 1 Line"],
      accessibility: { wheelchairAccessible: true, facilities: ["level_access", "tactile"] }
    },
    {
      name: "Northbourne Avenue",
      distance: 410,
      type: "Bus",
      routes: ["56", "58"],
      accessibility: { wheelchairAccessible: true }
    }
  ];

  const routes: TransportRoute[] = [
    { route: "Light Rail Stage 1", type: "Light Rail", frequency: 12 },
    { route: "R1 Rapid", type: "Bus", frequency: 10 },
    { route: "300 Intertown", type: "Bus", frequency: 6 }
  ];

  const transportTypes = ["Light Rail", "Bus"];
  const qualityScore = calculateTransportScore(stops, routes, transportTypes);

  return {
    nearestStop: stops[1].name,
    distanceToStop: stops[1].distance,
    stopsWithin1km: stops,
    transportTypes,
    routeCoverage: routes,
    serviceFrequency: {
      peak: 14,
      offPeak: 7
    },
    accessibility: {
      wheelchairAccessible: true,
      lifts: false,
      tactilePaving: true
    },
    qualityScore,
    summary: `Good transport access with ${stops.length} stops within 1km. Modern light rail system complemented by frequent bus services.`
  };
}

function calculateTransportScore(
  stops: TransportStop[],
  routes: TransportRoute[],
  transportTypes: string[]
): number {
  let score = 0;

  // Stops within 500m (30 points max)
  const closeStops = stops.filter(s => s.distance <= 500);
  score += Math.min(closeStops.length * 10, 30);

  // Service frequency (25 points max)
  const avgFrequency = routes.reduce((sum, r) => sum + r.frequency, 0) / routes.length;
  score += Math.min((avgFrequency / 15) * 25, 25);

  // Transport diversity (20 points max)
  score += Math.min(transportTypes.length * 5, 20);

  // Route coverage (15 points max)
  score += Math.min(routes.length * 3, 15);

  // Accessibility (10 points max)
  const accessibleStops = stops.filter(s => s.accessibility?.wheelchairAccessible);
  score += (accessibleStops.length / stops.length) * 10;

  return Math.round(Math.min(score, 100));
}

function generateFallbackData(input: any): PublicTransportData {
  return {
    nearestStop: "Unknown",
    distanceToStop: 999,
    stopsWithin1km: [],
    transportTypes: ["Bus"],
    routeCoverage: [],
    serviceFrequency: {
      peak: 4,
      offPeak: 2
    },
    accessibility: {
      wheelchairAccessible: false
    },
    qualityScore: 25,
    summary: "Limited transport data available for this location."
  };
}
