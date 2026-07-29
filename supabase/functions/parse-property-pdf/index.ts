import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage, extractOpenAIUsage } from '../_shared/logApiUsage.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface ExtractedPropertyData {
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  price?: number;
  weeklyRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSize?: number;
  buildSize?: number;
  propertyType?: string;
  landPrice?: number;
  buildPrice?: number;
  isNewBuild?: boolean;
  councilRates?: number;
  waterRates?: number;
  strataFees?: number;
  insuranceEstimate?: number;
  propertyManagementPercent?: number;
  yearBuilt?: number;
  stampDuty?: number;
  agentFee?: number;
  assetClass?: string;
  assetSubType?: string;
  tenure?: string;
  zoning?: string;
  gfaSqm?: number;
  nlaSqm?: number;
  glaSqm?: number;
  siteAreaSqm?: number;
  parkingBays?: number;
  currentValuation?: number;
  propertyName?: string;
  siteCoverPct?: number;
  officePct?: number;
  hardstandSqm?: number;
  clearanceMetres?: number;
  powerKva?: number;
  dockDoors?: number;
  groundFloorLoadKpa?: number;
  conditionRating?: string;
  // Commercial / industrial enrichment
  detectedAssetClass?: 'residential' | 'commercial' | 'industrial';
  detectedAssetConfidence?: number;
  passingNoiPa?: number;
  marketNoiPa?: number;
  passingCapRatePct?: number;
  marketCapRatePct?: number;
  vendorAdvisedRentPa?: number;
  vendorAdvisedOutgoingsPa?: number;
  outgoingsTotalPa?: number;
  outgoingsRecoverablePa?: number;
  leaseType?: string;
  leaseExpiryDate?: string;
  leaseOptions?: string;
  waleYears?: number;
  tenantNames?: string[];
  gstTreatment?: string;
  truckAccess?: string;
  vendorAdvisedYieldPct?: number;
}

interface StructuredPropertyPayload {
  propertyAddress: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  purchasePrice?: number;
  weeklyRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSize?: number;
  buildSize?: number;
  propertyType?: string;
  landPrice?: number;
  buildPrice?: number;
  isNewBuild: boolean;
  councilRates?: number;
  waterRates?: number;
  strataFees?: number;
  insuranceEstimate?: number;
  propertyManagementPercent?: number;
  yearBuilt?: number;
  stampDuty?: number;
  agentFee?: number;
  assetClass?: string;
  assetSubType?: string;
  tenure?: string;
  zoning?: string;
  gfaSqm?: number;
  nlaSqm?: number;
  glaSqm?: number;
  siteAreaSqm?: number;
  parkingBays?: number;
  currentValuation?: number;
  propertyName?: string;
  siteCoverPct?: number;
  officePct?: number;
  hardstandSqm?: number;
  clearanceMetres?: number;
  powerKva?: number;
  dockDoors?: number;
  groundFloorLoadKpa?: number;
  conditionRating?: string;
  detectedAssetClass?: 'residential' | 'commercial' | 'industrial';
  detectedAssetConfidence?: number;
  passingNoiPa?: number;
  marketNoiPa?: number;
  passingCapRatePct?: number;
  marketCapRatePct?: number;
  vendorAdvisedRentPa?: number;
  vendorAdvisedOutgoingsPa?: number;
  outgoingsTotalPa?: number;
  outgoingsRecoverablePa?: number;
  vendorAdvisedYieldPct?: number;
  gstTreatment?: string;
  leaseType?: string;
  leaseExpiryDate?: string;
  leaseOptions?: string;
  waleYears?: number;
  tenantNames?: string[];
  truckAccess?: string;
}

interface PageImage {
  pageNumber: number;
  base64: string;
  width: number;
  height: number;
}

// ============= VISION EXTRACTION CONFIG =============

/**
 * Max images per single API call. GPT-4o can handle ~20 images but
 * we keep it at 10 to balance coverage, token limits and reliability.
 */
const VISION_BATCH_SIZE = 10;

/**
 * Max concurrent batch calls. We run 4 batches in parallel to keep large
 * documents under the edge-function wall clock while staying within rate limits.
 */
const MAX_PARALLEL_BATCHES = 4;

// ============= SYSTEM PROMPT =============

const EXTRACTION_SYSTEM_PROMPT = `You are an expert Australian property document analyst handling RESIDENTIAL, COMMERCIAL and INDUSTRIAL brochures, Information Memoranda (IMs), contract attachments, rent rolls, lease schedules, and listing flyers.

============= MANDATORY 2-STEP PROCESS =============
STEP 1 — DETECT ASSET CLASS:
  Determine detectedAssetClass ∈ {residential, commercial, industrial} from visual + textual signals across ALL pages:
    • Residential: floor plans with bedrooms/bathrooms, "house & land" branding, suburban photography, builder logos, weekly rent quotes.
    • Commercial: NLA, "office floors", "retail tenancy", "going concern", "WALE", cap rate quoted, named tenants, outgoings schedule, IM cover.
    • Industrial: GLA, hardstand, clearance/eaves height, dock doors, kVA, racking, "warehouse", "logistics estate", zoning codes IN1/IN2/IN3, three-phase power, container access.
  Output detectedAssetClass + detectedAssetConfidence (0–1).

STEP 2 — STRICT EXTRACTION:
  Only extract values explicitly stated in the document. NEVER fabricate. NEVER carry over examples. Return null/omit any field not present.
  Numbers: raw integers/decimals (no $, %, commas). Convert sqft→sqm (×0.0929), ha→sqm (×10000), kW→kVA (×1.25 typical), amps×voltage÷1000→kVA.

============= UNIVERSAL FIELDS =============
- Full street address (incl. lot numbers like "Lot 123"), suburb, state (NSW/VIC/QLD/WA/SA/TAS/ACT/NT), 4-digit postcode.
- Property/package price (total).
- Property type: residential => house/apartment/townhouse/land/house_and_land. Commercial/industrial => office/retail/warehouse/logistics/manufacturing/mixed_use/medical/childcare/hospitality/other.
- Year built, agent/agency, key features, condition rating (A/B/C/D only if graded).

============= RESIDENTIAL ONLY =============
- Bedrooms, bathrooms, car spaces; land size and building size (sqm).
- Weekly rent estimate, council/water/strata, insurance, PM%.
- House & land split: landPrice, buildPrice. isNewBuild = true only if "brand new"/"off the plan"/"house and land"/named builder.
- Stamp duty, agent/buyer's agent fee if calculated.

============= COMMERCIAL & INDUSTRIAL — STRUCTURE =============
- assetClass, assetSubType (e.g. "A-Grade Office", "Distribution Warehouse", "Neighbourhood Childcare"), tenure, zoning, propertyName (estate/building).
- Areas: gfaSqm (Gross Floor Area), nlaSqm (Net Lettable Area — offices/retail), glaSqm (Gross Lettable Area — industrial), siteAreaSqm, hardstandSqm, siteCoverPct, officePct, parkingBays.

============= COMMERCIAL & INDUSTRIAL — INCOME (CRITICAL) =============
Pull these ONLY when the document explicitly states them in financial summaries, rent rolls, vendor advices, or cap-rate panels:
- passingNoiPa: net operating income p.a. as written.
- marketNoiPa: "market" / "fully leased" NOI estimate.
- passingCapRatePct & marketCapRatePct: as percent numbers (e.g. 6.25).
- vendorAdvisedRentPa: gross or net rent p.a. as advised.
- vendorAdvisedOutgoingsPa, outgoingsTotalPa, outgoingsRecoverablePa.
- vendorAdvisedYieldPct: vendor-quoted yield as percent.
- gstTreatment: going_concern | margin_scheme | standard | input_taxed.

============= COMMERCIAL & INDUSTRIAL — LEASE =============
- leaseType: gross | net | semi_gross | triple_net.
- leaseExpiryDate: yyyy-mm-dd.
- leaseOptions: e.g. "3 + 3 + 3 years".
- waleYears: weighted average lease expiry (numeric).
- tenantNames: array of named tenants (max 5).

============= INDUSTRIAL SPECS =============
- clearanceMetres (eaves / internal clearance height).
- powerKva (from kVA, or derive from amps × voltage ÷ 1000 if voltage stated).
- dockDoors (recessed loading docks + roller shutters, summed).
- groundFloorLoadKpa.
- truckAccess: poor | average | good | excellent (only if explicitly characterised).

============= FOCUS AREAS BY PAGE =============
- Hero / cover: address, key headline metrics, asset class hints.
- Floor / lease plans: dimensions, GFA/NLA/GLA, dock doors, office%.
- Financial summary or "Investment Highlights": NOI, cap rate, WALE, yield.
- Rent roll / tenancy schedule: tenant names, lease expiry, options.
- Outgoings schedule: total + recoverable split.
- Vendor advice / disclaimers: GST treatment, going concern statements.

Return ONLY valid JSON with the fields requested (use null for values not found).`;

function buildUserPrompt(imageCount: number, fileName: string, propertyCategory = 'auto', batchInfo?: string): string {
  const batchNote = batchInfo ? `\n${batchInfo}` : '';
  return `Extract all ${propertyCategory} property details from these ${imageCount} page(s) of the document "${fileName}".${batchNote}

Return JSON format:
{
  "address": "full street address including lot number",
  "suburb": "suburb name only",
  "state": "state abbreviation (NSW/VIC/QLD/WA/SA/TAS/ACT/NT)",
  "postcode": "4-digit postcode",
  "price": numeric total price (no $ or commas),
  "weeklyRent": numeric weekly rent,
  "bedrooms": number,
  "bathrooms": number,
  "carSpaces": number,
  "landSize": numeric land size in sqm,
  "buildSize": numeric building size in sqm,
  "propertyType": "house" or "apartment" or "townhouse" or "land" or "house_and_land",
  "landPrice": numeric land component price,
  "buildPrice": numeric build component price,
  "isNewBuild": true if new build or house and land package,
  "councilRates": numeric annual council rates,
  "waterRates": numeric annual water rates,
  "strataFees": numeric annual strata/body corp fees,
  "insuranceEstimate": numeric annual insurance,
  "propertyManagementPercent": numeric percentage (e.g., 8 for 8%),
  "yearBuilt": numeric year of construction,
  "stampDuty": numeric stamp duty amount,
  "agentFee": numeric agent/buyer's agent fee,
  "assetClass": "office/retail/industrial/mixed_use/medical/childcare/hospitality/other",
  "assetSubType": "warehouse/logistics/manufacturing/cold_storage/flex/data_centre/transport_yard/other or listing sub-type",
  "tenure": "freehold/leasehold/strata",
  "zoning": "planning or industrial zoning",
  "gfaSqm": numeric gross floor area,
  "nlaSqm": numeric net lettable area,
  "glaSqm": numeric gross lettable area,
  "siteAreaSqm": numeric site area,
  "parkingBays": numeric parking spaces/bays,
  "currentValuation": numeric valuation if shown,
  "propertyName": "building/estate name",
  "siteCoverPct": numeric site cover percentage,
  "officePct": numeric office percentage,
  "hardstandSqm": numeric hardstand area,
  "clearanceMetres": numeric warehouse clearance height,
  "powerKva": numeric power capacity in kVA,
  "dockDoors": numeric dock doors,
  "groundFloorLoadKpa": numeric floor load in kPa,
  "conditionRating": "A/B/C/D if stated or infer only if explicitly graded",
  "detectedAssetClass": "residential | commercial | industrial (auto-detect from content)",
  "detectedAssetConfidence": numeric 0-1,
  "passingNoiPa": numeric passing NOI p.a.,
  "marketNoiPa": numeric market/stabilised NOI p.a.,
  "passingCapRatePct": numeric passing cap rate as percent (e.g. 6.25),
  "marketCapRatePct": numeric market cap rate as percent,
  "vendorAdvisedRentPa": numeric vendor-quoted rent p.a.,
  "vendorAdvisedOutgoingsPa": numeric vendor-quoted outgoings p.a.,
  "outgoingsTotalPa": numeric total outgoings p.a.,
  "outgoingsRecoverablePa": numeric recoverable outgoings p.a.,
  "vendorAdvisedYieldPct": numeric vendor-quoted yield as percent,
  "gstTreatment": "going_concern | margin_scheme | standard | input_taxed",
  "leaseType": "gross | net | semi_gross | triple_net",
  "leaseExpiryDate": "yyyy-mm-dd",
  "leaseOptions": "e.g. 3 + 3 + 3 years",
  "waleYears": numeric weighted average lease expiry,
  "tenantNames": ["array of named tenants, max 5"],
  "truckAccess": "poor | average | good | excellent"
}`;
}

// ============= GPT-4o VISION EXTRACTION =============

async function extractWithVision(
  images: PageImage[], 
  openaiKey: string, 
  fileName: string,
  propertyCategory = 'auto'
): Promise<ExtractedPropertyData> {
  console.log(`🔍 Analyzing ${images.length} page images with GPT-4o Vision...`);
  
  if (images.length <= VISION_BATCH_SIZE) {
    return await extractWithVisionSingle(images, openaiKey, fileName, propertyCategory);
  }
  
  return await extractWithVisionBatched(images, openaiKey, fileName, propertyCategory);
}

async function extractWithVisionSingle(
  images: PageImage[], 
  openaiKey: string, 
  fileName: string,
  propertyCategory = 'auto',
  batchInfo?: string
): Promise<ExtractedPropertyData> {
  const userContent: any[] = [
    {
      type: "text",
      text: buildUserPrompt(images.length, fileName, propertyCategory, batchInfo),
    }
  ];

  for (const image of images) {
    // Detect format from base64 header or default to jpeg for compressed images
    const mimeType = image.base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${mimeType};base64,${image.base64}`,
        detail: "high"
      }
    });
  }

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const response = await callLLMRaw({
      agentKey: 'pdf_property_extraction',
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent as any },
      ],
      temperature: 0.1,
      maxTokens: 4500,
      responseFormat: { type: 'json_object' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI Vision API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Log API usage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const visionUsage = extractOpenAIUsage(data);
    await logApiUsage(supabase, {
      service_name: 'openai',
      endpoint: '/v1/chat/completions',
      model_used: 'gpt-4o',
      prompt_tokens: visionUsage.prompt_tokens,
      completion_tokens: visionUsage.completion_tokens,
      tokens_used: visionUsage.total_tokens,
      status: 'success',
      metadata: { function: 'parse-property-pdf', action: 'vision-extract', pages: images.length },
    });

    console.log(`📝 GPT-4o Vision response (${images.length} pages):`, content.substring(0, 200));
    
    return parseVisionResponse(content);
    
  } catch (error) {
    console.error('❌ Vision extraction error:', error);
    throw error;
  }
}

/**
 * Process large documents in batches with controlled parallelism.
 * - Splits images into batches of VISION_BATCH_SIZE
 * - Runs up to MAX_PARALLEL_BATCHES concurrently
 * - Merges all results with priority to earlier pages (cover/specs)
 */
async function extractWithVisionBatched(
  images: PageImage[],
  openaiKey: string,
  fileName: string,
  propertyCategory = 'auto'
): Promise<ExtractedPropertyData> {
  // Create batches
  const batches: PageImage[][] = [];
  for (let i = 0; i < images.length; i += VISION_BATCH_SIZE) {
    batches.push(images.slice(i, i + VISION_BATCH_SIZE));
  }
  
  console.log(`📚 Large document: ${images.length} pages → ${batches.length} batches (batch size: ${VISION_BATCH_SIZE}, parallel: ${MAX_PARALLEL_BATCHES})`);
  
  let mergedResult: ExtractedPropertyData = {};
  
  // Process batches with controlled parallelism
  for (let i = 0; i < batches.length; i += MAX_PARALLEL_BATCHES) {
    const parallelBatches = batches.slice(i, i + MAX_PARALLEL_BATCHES);
    
    const promises = parallelBatches.map((batch, offset) => {
      const batchIndex = i + offset;
      const pageRange = `${batch[0].pageNumber}-${batch[batch.length - 1].pageNumber}`;
      const batchInfo = `This is batch ${batchIndex + 1} of ${batches.length} (pages ${pageRange} of a ${images.length}-page document). Extract whatever property information is visible on these pages.`;
      
      console.log(`🔍 Starting batch ${batchIndex + 1}/${batches.length} (pages: ${pageRange})`);
      
      return extractWithVisionSingle(batch, openaiKey, fileName, propertyCategory, batchInfo)
        .then(result => ({ batchIndex, result, error: null as Error | null }))
        .catch(error => {
          console.error(`❌ Batch ${batchIndex + 1} failed:`, error);
          return { batchIndex, result: {} as ExtractedPropertyData, error };
        });
    });
    
    const results = await Promise.all(promises);
    
    for (const { batchIndex, result, error } of results) {
      if (!error) {
        mergedResult = mergeExtractedData(mergedResult, result);
        const fieldCount = Object.values(mergedResult).filter(v => v != null).length;
        console.log(`✅ Batch ${batchIndex + 1} merged (${fieldCount} fields populated)`);
      }
    }
  }
  
  return mergedResult;
}

/**
 * Merge two extraction results.
 * - For the address/suburb/state/postcode: prefer non-null from first result
 * - For numeric fields: prefer the first non-null value (earlier pages are usually more authoritative)
 * - For isNewBuild: true takes precedence (if ANY page indicates it's new build)
 */
function mergeExtractedData(existing: ExtractedPropertyData, incoming: ExtractedPropertyData): ExtractedPropertyData {
  const result: any = { ...existing };
  
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || value === undefined) continue;
    
    // Special handling: isNewBuild — true is sticky
    if (key === 'isNewBuild' && value === true) {
      result[key] = true;
      continue;
    }
    
    // Only fill in missing fields, don't overwrite existing
    if (result[key] == null || result[key] === undefined) {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Parse GPT-4o vision response JSON, handling markdown code blocks
 */
function parseVisionResponse(content: string): ExtractedPropertyData {
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }
  
  try {
    const parsed = JSON.parse(jsonStr);
    
    return {
      address: parsed.address || undefined,
      suburb: parsed.suburb || undefined,
      state: parsed.state || undefined,
      postcode: parsed.postcode?.toString() || undefined,
      price: typeof parsed.price === 'number' ? parsed.price : undefined,
      weeklyRent: typeof parsed.weeklyRent === 'number' ? parsed.weeklyRent : undefined,
      bedrooms: typeof parsed.bedrooms === 'number' ? parsed.bedrooms : undefined,
      bathrooms: typeof parsed.bathrooms === 'number' ? parsed.bathrooms : undefined,
      carSpaces: typeof parsed.carSpaces === 'number' ? parsed.carSpaces : undefined,
      landSize: typeof parsed.landSize === 'number' ? parsed.landSize : undefined,
      buildSize: typeof parsed.buildSize === 'number' ? parsed.buildSize : undefined,
      propertyType: parsed.propertyType || undefined,
      landPrice: typeof parsed.landPrice === 'number' ? parsed.landPrice : undefined,
      buildPrice: typeof parsed.buildPrice === 'number' ? parsed.buildPrice : undefined,
      isNewBuild: parsed.isNewBuild === true,
      councilRates: typeof parsed.councilRates === 'number' ? parsed.councilRates : undefined,
      waterRates: typeof parsed.waterRates === 'number' ? parsed.waterRates : undefined,
      strataFees: typeof parsed.strataFees === 'number' ? parsed.strataFees : undefined,
      insuranceEstimate: typeof parsed.insuranceEstimate === 'number' ? parsed.insuranceEstimate : undefined,
      propertyManagementPercent: typeof parsed.propertyManagementPercent === 'number' ? parsed.propertyManagementPercent : undefined,
      yearBuilt: typeof parsed.yearBuilt === 'number' ? parsed.yearBuilt : undefined,
      stampDuty: typeof parsed.stampDuty === 'number' ? parsed.stampDuty : undefined,
      agentFee: typeof parsed.agentFee === 'number' ? parsed.agentFee : undefined,
      assetClass: typeof parsed.assetClass === 'string' ? parsed.assetClass : undefined,
      assetSubType: typeof parsed.assetSubType === 'string' ? parsed.assetSubType : undefined,
      tenure: typeof parsed.tenure === 'string' ? parsed.tenure : undefined,
      zoning: typeof parsed.zoning === 'string' ? parsed.zoning : undefined,
      gfaSqm: typeof parsed.gfaSqm === 'number' ? parsed.gfaSqm : undefined,
      nlaSqm: typeof parsed.nlaSqm === 'number' ? parsed.nlaSqm : undefined,
      glaSqm: typeof parsed.glaSqm === 'number' ? parsed.glaSqm : undefined,
      siteAreaSqm: typeof parsed.siteAreaSqm === 'number' ? parsed.siteAreaSqm : undefined,
      parkingBays: typeof parsed.parkingBays === 'number' ? parsed.parkingBays : undefined,
      currentValuation: typeof parsed.currentValuation === 'number' ? parsed.currentValuation : undefined,
      propertyName: typeof parsed.propertyName === 'string' ? parsed.propertyName : undefined,
      siteCoverPct: typeof parsed.siteCoverPct === 'number' ? parsed.siteCoverPct : undefined,
      officePct: typeof parsed.officePct === 'number' ? parsed.officePct : undefined,
      hardstandSqm: typeof parsed.hardstandSqm === 'number' ? parsed.hardstandSqm : undefined,
      clearanceMetres: typeof parsed.clearanceMetres === 'number' ? parsed.clearanceMetres : undefined,
      powerKva: typeof parsed.powerKva === 'number' ? parsed.powerKva : undefined,
      dockDoors: typeof parsed.dockDoors === 'number' ? parsed.dockDoors : undefined,
      groundFloorLoadKpa: typeof parsed.groundFloorLoadKpa === 'number' ? parsed.groundFloorLoadKpa : undefined,
      conditionRating: typeof parsed.conditionRating === 'string' ? parsed.conditionRating : undefined,
      detectedAssetClass: (parsed.detectedAssetClass === 'residential' || parsed.detectedAssetClass === 'commercial' || parsed.detectedAssetClass === 'industrial') ? parsed.detectedAssetClass : undefined,
      detectedAssetConfidence: typeof parsed.detectedAssetConfidence === 'number' ? parsed.detectedAssetConfidence : undefined,
      passingNoiPa: typeof parsed.passingNoiPa === 'number' ? parsed.passingNoiPa : undefined,
      marketNoiPa: typeof parsed.marketNoiPa === 'number' ? parsed.marketNoiPa : undefined,
      passingCapRatePct: typeof parsed.passingCapRatePct === 'number' ? parsed.passingCapRatePct : undefined,
      marketCapRatePct: typeof parsed.marketCapRatePct === 'number' ? parsed.marketCapRatePct : undefined,
      vendorAdvisedRentPa: typeof parsed.vendorAdvisedRentPa === 'number' ? parsed.vendorAdvisedRentPa : undefined,
      vendorAdvisedOutgoingsPa: typeof parsed.vendorAdvisedOutgoingsPa === 'number' ? parsed.vendorAdvisedOutgoingsPa : undefined,
      outgoingsTotalPa: typeof parsed.outgoingsTotalPa === 'number' ? parsed.outgoingsTotalPa : undefined,
      outgoingsRecoverablePa: typeof parsed.outgoingsRecoverablePa === 'number' ? parsed.outgoingsRecoverablePa : undefined,
      vendorAdvisedYieldPct: typeof parsed.vendorAdvisedYieldPct === 'number' ? parsed.vendorAdvisedYieldPct : undefined,
      gstTreatment: typeof parsed.gstTreatment === 'string' ? parsed.gstTreatment : undefined,
      leaseType: typeof parsed.leaseType === 'string' ? parsed.leaseType : undefined,
      leaseExpiryDate: typeof parsed.leaseExpiryDate === 'string' ? parsed.leaseExpiryDate : undefined,
      leaseOptions: typeof parsed.leaseOptions === 'string' ? parsed.leaseOptions : undefined,
      waleYears: typeof parsed.waleYears === 'number' ? parsed.waleYears : undefined,
      tenantNames: Array.isArray(parsed.tenantNames) ? parsed.tenantNames.filter((s: unknown) => typeof s === 'string').slice(0, 5) : undefined,
      truckAccess: typeof parsed.truckAccess === 'string' ? parsed.truckAccess : undefined,
    };
  } catch (parseError) {
    console.error('❌ Failed to parse vision response as JSON:', parseError, 'Content:', jsonStr.substring(0, 500));
    return {};
  }
}

// ============= SINGLE IMAGE EXTRACTION =============

async function extractFromSingleImage(
  base64: string,
  mimeType: string,
  openaiKey: string,
  fileName: string,
  propertyCategory = 'auto'
): Promise<ExtractedPropertyData> {
  console.log(`🔍 Analyzing single image with GPT-4o Vision...`);
  
  const { callLLMRaw } = await import('../_shared/llmRouter.ts');
  const response = await callLLMRaw({
    agentKey: 'pdf_property_extraction',
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserPrompt(1, fileName, propertyCategory) },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
        ] as any,
      },
    ],
    temperature: 0.1,
    maxTokens: 4500,
    responseFormat: { type: 'json_object' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ OpenAI Vision API error:', response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  // Log API usage
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(supabaseUrl, supabaseKey);
  const singleUsage = extractOpenAIUsage(data);
  await logApiUsage(sb, {
    service_name: 'openai',
    endpoint: '/v1/chat/completions',
    model_used: 'gpt-4o',
    prompt_tokens: singleUsage.prompt_tokens,
    completion_tokens: singleUsage.completion_tokens,
    tokens_used: singleUsage.total_tokens,
    status: 'success',
    metadata: { function: 'parse-property-pdf', action: 'single-image-extract' },
  });

  console.log('📝 Single image Vision response:', content.substring(0, 200));
  
  return parseVisionResponse(content);
}

// ============= STRUCTURED PAYLOAD =============

function processToStructuredPayload(extractedData: ExtractedPropertyData): StructuredPropertyPayload {
  let propertyAddress = '';
  
  if (extractedData.address) {
    propertyAddress = extractedData.address;
  }
  
  const addressParts: string[] = [];
  
  if (extractedData.suburb && !propertyAddress.toLowerCase().includes(extractedData.suburb.toLowerCase())) {
    addressParts.push(extractedData.suburb);
  }
  
  if (extractedData.state && !propertyAddress.toUpperCase().includes(extractedData.state)) {
    addressParts.push(extractedData.state);
  }
  
  if (extractedData.postcode && !propertyAddress.includes(extractedData.postcode)) {
    addressParts.push(extractedData.postcode);
  }
  
  if (addressParts.length > 0) {
    propertyAddress = propertyAddress 
      ? `${propertyAddress}, ${addressParts.join(' ')}` 
      : addressParts.join(', ');
  }
  
  return {
    propertyAddress: propertyAddress || 'Address Not Found',
    suburb: extractedData.suburb,
    state: extractedData.state,
    postcode: extractedData.postcode,
    purchasePrice: extractedData.price,
    weeklyRent: extractedData.weeklyRent,
    bedrooms: extractedData.bedrooms,
    bathrooms: extractedData.bathrooms,
    carSpaces: extractedData.carSpaces,
    landSize: extractedData.landSize,
    buildSize: extractedData.buildSize,
    propertyType: extractedData.propertyType,
    landPrice: extractedData.landPrice,
    buildPrice: extractedData.buildPrice,
    isNewBuild: extractedData.isNewBuild || false,
    councilRates: extractedData.councilRates,
    waterRates: extractedData.waterRates,
    strataFees: extractedData.strataFees,
    insuranceEstimate: extractedData.insuranceEstimate,
    propertyManagementPercent: extractedData.propertyManagementPercent,
    yearBuilt: extractedData.yearBuilt,
    stampDuty: extractedData.stampDuty,
    agentFee: extractedData.agentFee,
    assetClass: extractedData.assetClass,
    assetSubType: extractedData.assetSubType,
    tenure: extractedData.tenure,
    zoning: extractedData.zoning,
    gfaSqm: extractedData.gfaSqm,
    nlaSqm: extractedData.nlaSqm,
    glaSqm: extractedData.glaSqm,
    siteAreaSqm: extractedData.siteAreaSqm,
    parkingBays: extractedData.parkingBays,
    currentValuation: extractedData.currentValuation,
    propertyName: extractedData.propertyName,
    siteCoverPct: extractedData.siteCoverPct,
    officePct: extractedData.officePct,
    hardstandSqm: extractedData.hardstandSqm,
    clearanceMetres: extractedData.clearanceMetres,
    powerKva: extractedData.powerKva,
    dockDoors: extractedData.dockDoors,
    groundFloorLoadKpa: extractedData.groundFloorLoadKpa,
    conditionRating: extractedData.conditionRating,
    detectedAssetClass: extractedData.detectedAssetClass,
    detectedAssetConfidence: extractedData.detectedAssetConfidence,
    passingNoiPa: extractedData.passingNoiPa,
    marketNoiPa: extractedData.marketNoiPa,
    passingCapRatePct: extractedData.passingCapRatePct,
    marketCapRatePct: extractedData.marketCapRatePct,
    vendorAdvisedRentPa: extractedData.vendorAdvisedRentPa,
    vendorAdvisedOutgoingsPa: extractedData.vendorAdvisedOutgoingsPa,
    outgoingsTotalPa: extractedData.outgoingsTotalPa,
    outgoingsRecoverablePa: extractedData.outgoingsRecoverablePa,
    vendorAdvisedYieldPct: extractedData.vendorAdvisedYieldPct,
    gstTreatment: extractedData.gstTreatment,
    leaseType: extractedData.leaseType,
    leaseExpiryDate: extractedData.leaseExpiryDate,
    leaseOptions: extractedData.leaseOptions,
    waleYears: extractedData.waleYears,
    tenantNames: extractedData.tenantNames,
    truckAccess: extractedData.truckAccess,
  };
}

// ============= GOOGLE MAPS GEOCODING =============

async function completeAddressWithGoogleMaps(
  payload: StructuredPropertyPayload,
  googleMapsApiKey: string,
  originalExtractedAddress: string | undefined
): Promise<StructuredPropertyPayload> {
  const originalStreetAddress = originalExtractedAddress || payload.propertyAddress;
  
  if (payload.suburb && payload.state && payload.postcode) {
    console.log('✅ All address components present, skipping geocoding');
    payload.propertyAddress = buildFullAddress(originalStreetAddress, payload.suburb, payload.state, payload.postcode);
    return payload;
  }
  
  if (!payload.propertyAddress || payload.propertyAddress === 'Address Not Found') {
    return payload;
  }
  
  if (/^Lot\s+\d+$/i.test(payload.propertyAddress.trim())) {
    console.log('⚠️ Address is just a lot number, skipping geocoding');
    return payload;
  }
  
  const parts: string[] = [payload.propertyAddress];
  if (!payload.propertyAddress.toLowerCase().includes('australia')) {
    parts.push('Australia');
  }
  
  const searchQuery = parts.join(', ');
  console.log('🗺️ Geocoding search query:', searchQuery);
  
  try {
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=${googleMapsApiKey}&region=au&components=country:AU`;
    const response = await fetch(geocodeUrl);
    
    if (!response.ok) {
      console.error('Google Maps API error:', response.status);
      return payload;
    }
    
    const data = await response.json();
    
    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.log('No geocoding results. Status:', data.status);
      return payload;
    }
    
    const result = data.results[0];
    const types = result.types || [];
    
    if (types.includes('country') || 
        (types.includes('administrative_area_level_1') && !types.includes('locality'))) {
      console.log('⚠️ Geocoding result too generic, keeping original');
      return payload;
    }
    
    let geocodedSuburb = payload.suburb;
    let geocodedState = payload.state;
    let geocodedPostcode = payload.postcode;
    
    for (const component of result.address_components) {
      const componentTypes = component.types;
      if ((componentTypes.includes('locality') || componentTypes.includes('sublocality')) && !geocodedSuburb) {
        geocodedSuburb = component.long_name;
      } else if (componentTypes.includes('administrative_area_level_1') && !geocodedState) {
        geocodedState = component.short_name;
      } else if (componentTypes.includes('postal_code') && !geocodedPostcode) {
        geocodedPostcode = component.long_name;
      }
    }
    
    payload.suburb = geocodedSuburb || payload.suburb;
    payload.state = geocodedState || payload.state;
    payload.postcode = geocodedPostcode || payload.postcode;
    payload.propertyAddress = buildFullAddress(originalStreetAddress, payload.suburb, payload.state, payload.postcode);
    
    console.log('✅ Final composed address:', payload.propertyAddress);
    
  } catch (error) {
    console.error('Google Maps geocoding error:', error);
  }
  
  return payload;
}

function buildFullAddress(
  streetAddress: string | undefined,
  suburb: string | undefined,
  state: string | undefined,
  postcode: string | undefined
): string {
  const parts: string[] = [];
  
  if (streetAddress && streetAddress !== 'Address Not Found') {
    let cleanStreet = streetAddress;
    if (suburb) cleanStreet = cleanStreet.replace(new RegExp(`,?\\s*${suburb}`, 'gi'), '');
    if (state) cleanStreet = cleanStreet.replace(new RegExp(`,?\\s*${state}\\b`, 'gi'), '');
    if (postcode) cleanStreet = cleanStreet.replace(new RegExp(`,?\\s*${postcode}`, 'g'), '');
    cleanStreet = cleanStreet.replace(/,\s*Australia$/i, '').replace(/,\s*,/g, ',').replace(/,\s*$/,'').trim();
    if (cleanStreet) parts.push(cleanStreet);
  }
  
  if (suburb) parts.push(suburb);
  
  if (state && postcode) {
    parts.push(`${state} ${postcode}`);
  } else if (state) {
    parts.push(state);
  } else if (postcode) {
    parts.push(postcode);
  }
  
  return parts.join(', ') || 'Address Not Found';
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('🏠 Parse property PDF function invoked');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[parse-property-pdf] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[parse-property-pdf] Authenticated user: ${userId}`);
    
    const { 
      pageImages,
      singleImage,
      imageMimeType,
      fileName,
      base64Content,
      propertyCategory = 'auto',
    } = body;
    
    const fileNameToUse = fileName || 'document.pdf';
    console.log('📄 Processing:', fileNameToUse);
    
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const googleMapsApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    
    let extractedData: ExtractedPropertyData;
    let extractionMethod = 'unknown';
    
    // Method 1: Page images from client-side PDF rendering (PREFERRED)
    if (pageImages && Array.isArray(pageImages) && pageImages.length > 0) {
      console.log(`📚 Received ${pageImages.length} page images from client`);
      extractedData = await extractWithVision(pageImages, openaiKey, fileNameToUse, propertyCategory);
      extractionMethod = `gpt-4o-vision-pages-${pageImages.length}`;
    }
    // Method 2: Single image file
    else if (singleImage && imageMimeType) {
      console.log('🖼️ Processing single image file');
      extractedData = await extractFromSingleImage(singleImage, imageMimeType, openaiKey, fileNameToUse, propertyCategory);
      extractionMethod = 'gpt-4o-vision-image';
    }
    // Method 3: Legacy fallback
    else if (base64Content) {
      console.error('❌ Raw PDF base64 received - client must render pages to images first');
      return new Response(JSON.stringify({
        success: false,
        error: 'PDF must be converted to images on the client before sending.',
        hint: 'The client should use convertPdfToImages() to render PDF pages as PNG images before calling this function.',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    else {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No valid content provided.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('📊 Extracted data:', JSON.stringify(extractedData, null, 2));
    
    const originalExtractedStreetAddress = extractedData.address;
    let structuredPayload = processToStructuredPayload(extractedData);
    
    const needsGeocoding = !structuredPayload.postcode || !structuredPayload.state || !structuredPayload.suburb;
    
    if (googleMapsApiKey && needsGeocoding && structuredPayload.propertyAddress !== 'Address Not Found') {
      console.log('🗺️ Attempting to complete address with Google Maps...');
      structuredPayload = await completeAddressWithGoogleMaps(structuredPayload, googleMapsApiKey, originalExtractedStreetAddress);
    } else if (structuredPayload.suburb && structuredPayload.state && structuredPayload.postcode) {
      structuredPayload.propertyAddress = buildFullAddress(originalExtractedStreetAddress, structuredPayload.suburb, structuredPayload.state, structuredPayload.postcode);
      console.log('✅ Built full address without geocoding:', structuredPayload.propertyAddress);
    }

    console.log('✅ Final structured payload:', JSON.stringify(structuredPayload, null, 2));

    return new Response(JSON.stringify({
      success: true,
      extractedData: {
        extractedAddress: structuredPayload.propertyAddress,
        extractedSuburb: structuredPayload.suburb,
        extractedState: structuredPayload.state,
        extractedPostcode: structuredPayload.postcode,
        extractedPrice: structuredPayload.purchasePrice,
        extractedRent: structuredPayload.weeklyRent,
        extractedWeeklyRent: structuredPayload.weeklyRent,
        extractedBedrooms: structuredPayload.bedrooms,
        extractedBathrooms: structuredPayload.bathrooms,
        extractedCarSpaces: structuredPayload.carSpaces,
        extractedLandSize: structuredPayload.landSize,
        extractedBuildSize: structuredPayload.buildSize,
        extractedPropertyType: structuredPayload.propertyType,
        extractedLandPrice: structuredPayload.landPrice,
        extractedBuildPrice: structuredPayload.buildPrice,
        isNewBuild: structuredPayload.isNewBuild,
        extractedIsNewBuild: structuredPayload.isNewBuild,
        extractedAssetClass: structuredPayload.assetClass,
        extractedAssetSubType: structuredPayload.assetSubType,
        extractedTenure: structuredPayload.tenure,
        extractedZoning: structuredPayload.zoning,
        extractedGfaSqm: structuredPayload.gfaSqm,
        extractedNlaSqm: structuredPayload.nlaSqm,
        extractedGlaSqm: structuredPayload.glaSqm,
        extractedSiteAreaSqm: structuredPayload.siteAreaSqm,
        extractedParkingBays: structuredPayload.parkingBays,
        extractedValuation: structuredPayload.currentValuation,
        extractedPropertyName: structuredPayload.propertyName,
        extractedSiteCoverPct: structuredPayload.siteCoverPct,
        extractedOfficePct: structuredPayload.officePct,
        extractedHardstandSqm: structuredPayload.hardstandSqm,
        extractedClearanceMetres: structuredPayload.clearanceMetres,
        extractedPowerKva: structuredPayload.powerKva,
        extractedDockDoors: structuredPayload.dockDoors,
        extractedGroundFloorLoadKpa: structuredPayload.groundFloorLoadKpa,
        extractedConditionRating: structuredPayload.conditionRating,
        detectedAssetClass: structuredPayload.detectedAssetClass,
        detectedAssetConfidence: structuredPayload.detectedAssetConfidence,
        extractedPassingNoiPa: structuredPayload.passingNoiPa,
        extractedMarketNoiPa: structuredPayload.marketNoiPa,
        extractedPassingCapRatePct: structuredPayload.passingCapRatePct,
        extractedMarketCapRatePct: structuredPayload.marketCapRatePct,
        extractedVendorRentPa: structuredPayload.vendorAdvisedRentPa,
        extractedVendorOutgoingsPa: structuredPayload.vendorAdvisedOutgoingsPa,
        extractedOutgoingsTotalPa: structuredPayload.outgoingsTotalPa,
        extractedOutgoingsRecoverablePa: structuredPayload.outgoingsRecoverablePa,
        extractedVendorYieldPct: structuredPayload.vendorAdvisedYieldPct,
        extractedGstTreatment: structuredPayload.gstTreatment,
        extractedLeaseType: structuredPayload.leaseType,
        extractedLeaseExpiryDate: structuredPayload.leaseExpiryDate,
        extractedLeaseOptions: structuredPayload.leaseOptions,
        extractedWaleYears: structuredPayload.waleYears,
        extractedTenantNames: structuredPayload.tenantNames,
        extractedTruckAccess: structuredPayload.truckAccess,
      },
      structuredPayload,
      extractionMethod,
      metadata: {
        fileName: fileNameToUse,
        processedAt: new Date().toISOString(),
        pagesAnalyzed: pageImages?.length || (singleImage ? 1 : 0),
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in parse-property-pdf:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message || 'Failed to parse document',
      details: 'If this error persists, try uploading a clearer image or a different PDF.',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
