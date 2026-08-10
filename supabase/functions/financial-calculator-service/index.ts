import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { calculateStampDuty } from '../_shared/stampDuty/index.pure.ts';
import { coerceState, resolveSchedule } from '../_shared/stampDuty/scheduleStore.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface LoanCalculationInput {
  propertyValue: number;
  deposit: number;
  interestRate?: number; // Now optional - will fetch live rates if not provided
  loanTerm: number;
  weeklyRent: number;
  state: string;
  propertyType: 'house' | 'unit' | 'townhouse';
  isFirstHomeBuyer?: boolean;
  isNewBuild?: boolean;
  borrowerType?: 'owner_occupier' | 'investor';
  // Capital growth rate - if provided, uses this instead of hardcoded scenarios
  // This allows researched capital growth from Perplexity to cascade into projections
  capitalGrowthRate?: number;
  // CPI / expense growth rate - independent macro indicator, NOT tied to capital growth
  cpiGrowthRate?: number;
  // Rent growth rate - optional override (defaults to CPI-aligned)
  rentGrowthRate?: number;
}

interface FinancialProjection {
  year: number;
  propertyValue: number;
  loanBalance: number;
  equity: number;
  annualRent: number;
  cashFlow: number;
  cumulativeCashFlow: number;
  roi: number;
}

interface InterestRateInfo {
  rate: number;
  lvrTier: string;
  rateType: string;
  source: string;
  lmiRequired: boolean;
  lmiEstimate: number;
}

// LVR-based interest rate tiers (based on current market rates Dec 2024)
const LVR_RATE_TIERS = {
  owner_occupier: {
    principal_interest: {
      tier_60: 5.99,    // LVR ≤ 60%
      tier_70: 6.04,    // LVR 60-70%
      tier_80: 6.14,    // LVR 70-80%
      tier_90: 6.44,    // LVR 80-90% (includes risk premium)
      tier_95: 6.74,    // LVR 90-95%
    },
    interest_only: {
      tier_60: 6.34,
      tier_70: 6.44,
      tier_80: 6.54,
      tier_90: 6.84,
      tier_95: 7.14,
    }
  },
  investor: {
    principal_interest: {
      tier_60: 6.19,
      tier_70: 6.29,
      tier_80: 6.44,
      tier_90: 6.74,
      tier_95: 7.04,
    },
    interest_only: {
      tier_60: 6.54,
      tier_70: 6.64,
      tier_80: 6.79,
      tier_90: 7.09,
      tier_95: 7.39,
    }
  }
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('Financial calculator service invoked with method:', req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // SECURITY: Verify authentication
    const body = await req.json();
    const input: LoanCalculationInput = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[financial-calculator-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[financial-calculator-service] Authenticated user: ${userId}`);
    console.log('Calculating financial projections for:', input);

    const calculations = await calculateFinancialProjections(input, supabase);
    
    return new Response(JSON.stringify({ 
      success: true, 
      data: calculations 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in financial calculator service:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to calculate financial projections';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function calculateFinancialProjections(input: LoanCalculationInput, supabase: any) {
  const {
    propertyValue,
    deposit,
    loanTerm,
    weeklyRent,
    state,
    propertyType,
    isFirstHomeBuyer = false,
    isNewBuild = false,
    borrowerType = 'investor'
  } = input;

  // Calculate LVR
  const loanAmount = propertyValue - deposit;
  const lvr = (loanAmount / propertyValue) * 100;

  // Get interest rate - use provided rate or fetch LVR-based rate
  const rateInfo = getInterestRateByLVR(lvr, borrowerType, input.interestRate);
  const interestRate = rateInfo.rate;
  
  const monthlyInterestRate = interestRate / 100 / 12;
  const totalPayments = loanTerm * 12;
  
  // Monthly loan payment (Principal + Interest)
  const monthlyPayment = calculateMonthlyPayment(loanAmount, monthlyInterestRate, totalPayments);
  
  // Calculate stamp duty with FHB concessions
  const stampDutyResult = await calculateStampDutyWithConcessions(
    propertyValue, 
    state, 
    supabase, 
    isFirstHomeBuyer, 
    isNewBuild
  );
  
  // Calculate ongoing costs
  const annualCosts = calculateAnnualCosts(propertyValue, weeklyRent, state, propertyType);
  
  // Generate 10-year projections with scenarios
  // If a custom capital growth rate is provided (e.g., from Perplexity research), use it
  // Otherwise, use standard scenario-based rates
  const customCapitalGrowth = input.capitalGrowthRate ? input.capitalGrowthRate / 100 : null;
  const customRentGrowth = input.rentGrowthRate ? input.rentGrowthRate / 100 : null;
  
  // Fetch live CPI projections from cached economic data
  const cpiProjections = await fetchCpiProjections(supabase);
  const customCpiGrowth = input.cpiGrowthRate ? input.cpiGrowthRate / 100 : null;
  
  const scenarios = customCapitalGrowth !== null ? {
    // When custom rate provided, use it as the "moderate" scenario with ±2% for conservative/optimistic
    conservative: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, Math.max(0, customCapitalGrowth - 0.02), customRentGrowth || 0.025, customCpiGrowth, cpiProjections),
    moderate: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, customCapitalGrowth, customRentGrowth || 0.03, customCpiGrowth, cpiProjections),
    optimistic: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, customCapitalGrowth + 0.02, customRentGrowth || 0.035, customCpiGrowth, cpiProjections)
  } : {
    // Default scenario-based rates when no custom rate provided
    conservative: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, 0.02, 0.02, customCpiGrowth, cpiProjections),
    moderate: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, 0.04, 0.03, customCpiGrowth, cpiProjections),
    optimistic: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, 0.06, 0.04, customCpiGrowth, cpiProjections)
  };

  // Calculate key metrics
  const metrics = calculateKeyMetrics(
    { ...input, interestRate }, 
    monthlyPayment, 
    annualCosts, 
    stampDutyResult.stampDuty
  );

  return {
    initialCosts: {
      propertyValue,
      deposit,
      loanAmount,
      stampDuty: stampDutyResult.stampDuty,
      stampDutyConcession: stampDutyResult.concession,
      stampDutyBeforeConcession: stampDutyResult.originalAmount,
      fhbEligible: stampDutyResult.fhbEligible,
      // Surfaced so a report can state which financial year's schedule it was
      // assessed against rather than presenting the figure as timeless.
      stampDutyScheduleYear: stampDutyResult.scheduleYear,
      stampDutyScheduleSource: stampDutyResult.scheduleSource,
      lmi: rateInfo.lmiEstimate,
      lmiRequired: rateInfo.lmiRequired,
      legalFees: 1500,
      inspectionFees: 500,
      totalUpfront: deposit + stampDutyResult.stampDuty + rateInfo.lmiEstimate + 1500 + 500
    },
    loanDetails: {
      monthlyPayment,
      totalInterest: (monthlyPayment * totalPayments) - loanAmount,
      weeklyPayment: monthlyPayment * 12 / 52,
      lvr: Math.round(lvr * 100) / 100,
      lvrTier: rateInfo.lvrTier,
      interestRate: rateInfo.rate,
      rateSource: rateInfo.source,
      borrowerType
    },
    annualCosts,
    keyMetrics: metrics,
    projections: scenarios,
    sensitivityAnalysis: calculateSensitivityAnalysis({ ...input, interestRate }, monthlyPayment, annualCosts),
    interestRateInfo: rateInfo
  };
}

function getInterestRateByLVR(
  lvr: number, 
  borrowerType: 'owner_occupier' | 'investor',
  providedRate?: number
): InterestRateInfo {
  // If rate is explicitly provided, use it
  if (providedRate !== undefined && providedRate > 0) {
    return {
      rate: providedRate,
      lvrTier: 'custom',
      rateType: 'user_provided',
      source: 'User specified',
      lmiRequired: lvr > 80,
      lmiEstimate: lvr > 80 ? calculateLMI(lvr) : 0
    };
  }

  const rates = LVR_RATE_TIERS[borrowerType].principal_interest;
  let rate: number;
  let tier: string;

  if (lvr <= 60) {
    rate = rates.tier_60;
    tier = '≤60%';
  } else if (lvr <= 70) {
    rate = rates.tier_70;
    tier = '60-70%';
  } else if (lvr <= 80) {
    rate = rates.tier_80;
    tier = '70-80%';
  } else if (lvr <= 90) {
    rate = rates.tier_90;
    tier = '80-90%';
  } else {
    rate = rates.tier_95;
    tier = '90-95%';
  }

  const lmiRequired = lvr > 80;
  const lmiEstimate = lmiRequired ? calculateLMI(lvr) : 0;

  return {
    rate,
    lvrTier: tier,
    rateType: 'principal_interest',
    source: 'Market rates Dec 2024 (LVR-adjusted)',
    lmiRequired,
    lmiEstimate
  };
}

function calculateLMI(lvr: number): number {
  // Simplified LMI calculation based on typical LMI rates
  // Actual LMI varies by lender, loan amount, and LVR
  if (lvr <= 80) return 0;
  if (lvr <= 85) return 3500;
  if (lvr <= 90) return 8500;
  if (lvr <= 95) return 15000;
  return 25000;
}

function calculateMonthlyPayment(loanAmount: number, monthlyRate: number, totalPayments: number): number {
  if (monthlyRate === 0) return loanAmount / totalPayments;
  
  return loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments)) / 
         (Math.pow(1 + monthlyRate, totalPayments) - 1);
}

// ============================================
// STAMP DUTY WITH FIRST HOME BUYER CONCESSIONS
// ============================================

interface StampDutyResult {
  stampDuty: number;
  originalAmount: number;
  concession: number;
  fhbEligible: boolean;
  concessionType: string;
  /** Financial year of the schedule used, so a report can cite its basis. */
  scheduleYear: string;
  /** Whether the figures came from the cache or the schedule shipped in code. */
  scheduleSource: 'cache' | 'built-in';
}

/**
 * Stamp duty for the projection.
 *
 * This used to be ~480 lines: eight bracket functions, eight first-home-buyer
 * concession functions, and a cache reader — a third independent copy of the
 * rates alongside `src/utils/` and the `_shared/` "mirror". All three disagreed
 * with each other and none matched the revenue offices. It now delegates to the
 * one engine, with the cache consulted through `resolveSchedule` so an
 * administrator can publish a correction without a deploy.
 */
async function calculateStampDutyWithConcessions(
  propertyValue: number,
  state: string,
  supabase: any,
  isFirstHomeBuyer: boolean,
  isNewBuild: boolean,
): Promise<StampDutyResult> {
  const jurisdiction = coerceState(state);
  const { schedule, source, rejectedReason } = await resolveSchedule(jurisdiction, supabase);
  if (rejectedReason) {
    console.warn(`[financial-calculator-service] ${jurisdiction} using built-in schedule: ${rejectedReason}`);
  }

  const category = isNewBuild ? 'new' : 'established';

  // Duty before relief, so the response can still report what the concession
  // was worth. The engine is asked twice rather than reverse-engineering the
  // gross figure from the net one.
  const gross = calculateStampDuty({
    propertyValue,
    state: jurisdiction,
    intent: 'owner_occupier',
    category,
    schedule,
  });

  const assessed = calculateStampDuty({
    propertyValue,
    state: jurisdiction,
    intent: 'owner_occupier',
    category,
    isFirstHomeBuyer,
    schedule,
  });

  const concession = Math.max(0, gross.totalDuty - assessed.totalDuty);

  return {
    stampDuty: assessed.totalDuty,
    originalAmount: gross.totalDuty,
    concession,
    fhbEligible: isFirstHomeBuyer && concession > 0,
    concessionType: isFirstHomeBuyer
      ? (concession > 0 ? assessed.notes.join('; ') : `No first home concession applies in ${jurisdiction} at this value`)
      : 'none',
    scheduleYear: assessed.scheduleYear,
    scheduleSource: source,
  };
}

function calculateAnnualCosts(propertyValue: number, weeklyRent: number, state: string, propertyType: string) {
  const annualRent = weeklyRent * 52;
  
  const councilRates = Math.floor(propertyValue * 0.008);
  const waterRates = 800;
  const landlordInsurance = Math.floor(annualRent * 0.01);
  const propertyManagement = Math.floor(annualRent * 0.07);
  const propertyManagementPercent = 7;
  const maintenance = 1500;
  const landTax = calculateLandTax(propertyValue, state);
  const strataFees = propertyType === 'unit' ? 4800 : 0;
  
  const totalAnnual = councilRates + waterRates + landlordInsurance + propertyManagement + maintenance + strataFees + landTax;
  const totalAnnualExcludingLandTax = councilRates + waterRates + landlordInsurance + propertyManagement + maintenance + strataFees;
  
  return {
    councilRates,
    waterRates,
    landlordInsurance,
    propertyManagement,
    propertyManagementPercent,
    maintenance,
    landTax,
    strataFees,
    totalAnnual,
    totalAnnualExcludingLandTax
  };
}

function calculateLandTax(propertyValue: number, state: string): number {
  const thresholds: { [key: string]: number } = {
    'NSW': 755000,
    'VIC': 300000,
    'QLD': 600000,
    'WA': 300000,
    'SA': 391000,
    'TAS': 25000,
    'NT': 0,
    'ACT': 0
  };

  const threshold = thresholds[state.toUpperCase()] || 755000;
  
  if (propertyValue <= threshold) return 0;
  
  return Math.floor((propertyValue - threshold) * 0.015);
}

function generateProjections(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any,
  capitalGrowthRate: number,
  rentGrowthRate: number,
  customCpiGrowth: number | null,
  cpiProjections: Array<{ year: number; cpiPercent: number }>,
): FinancialProjection[] {
  
  const projections: FinancialProjection[] = [];
  let currentPropertyValue = input.propertyValue;
  let currentRent = input.weeklyRent * 52;
  let loanBalance = input.propertyValue - input.deposit;
  let cumulativeCashFlow = 0;
  
  // Base annual costs (before CPI inflation)
  const baseTotalAnnualCosts = Object.values(annualCosts)
    .filter(val => typeof val === 'number')
    .reduce((sum, cost) => sum + cost, 0) + (monthlyPayment * 12);
  
  // Separate loan payments from operating expenses for CPI escalation
  const loanPaymentsAnnual = monthlyPayment * 12;
  let currentOperatingExpenses = baseTotalAnnualCosts - loanPaymentsAnnual;

  for (let year = 1; year <= 10; year++) {
    currentPropertyValue *= (1 + capitalGrowthRate);
    currentRent *= (1 + rentGrowthRate);
    
    // CPI escalation for operating expenses (not loan payments)
    // Use custom override > year-specific projection > fallback 2.5%
    const yearCpi = customCpiGrowth !== null 
      ? customCpiGrowth 
      : (cpiProjections.find(p => p.year === year)?.cpiPercent ?? 2.5) / 100;
    currentOperatingExpenses *= (1 + yearCpi);
    
    const totalAnnualCosts = currentOperatingExpenses + loanPaymentsAnnual;
    
    const annualPrincipalPayment = loanPaymentsAnnual - (loanBalance * input.interestRate / 100);
    loanBalance = Math.max(0, loanBalance - annualPrincipalPayment);
    
    const annualCashFlow = currentRent - totalAnnualCosts;
    cumulativeCashFlow += annualCashFlow;
    
    const equity = currentPropertyValue - loanBalance;
    const roi = (annualCashFlow + (currentPropertyValue - input.propertyValue) / year) / input.deposit * 100;
    
    projections.push({
      year,
      propertyValue: Math.round(currentPropertyValue),
      loanBalance: Math.round(loanBalance),
      equity: Math.round(equity),
      annualRent: Math.round(currentRent),
      cashFlow: Math.round(annualCashFlow),
      cumulativeCashFlow: Math.round(cumulativeCashFlow),
      roi: Math.round(roi * 100) / 100
    });
  }
  
  return projections;
}

/**
 * Fetch CPI projections from the economic_data_cache table.
 * Returns year-by-year CPI forecasts for 10-year projection models.
 */
async function fetchCpiProjections(supabase: any): Promise<Array<{ year: number; cpiPercent: number }>> {
  try {
    const { data: cachedData, error } = await supabase
      .from('economic_data_cache')
      .select('data')
      .eq('data_type', 'rba_indicators')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !cachedData?.data) {
      console.log('[financial-calculator] No cached CPI projections, using defaults');
      return getDefaultCpiProjections();
    }

    const cpiProjections = cachedData.data?.cpiProjections;
    if (Array.isArray(cpiProjections) && cpiProjections.length > 0) {
      console.log(`[financial-calculator] Using ${cpiProjections.length} cached CPI projections`);
      return cpiProjections;
    }

    // Fall back to deriving from current CPI
    const currentCpi = cachedData.data?.inflation?.annual || 2.5;
    return generateConvergenceProjections(currentCpi);
  } catch (err) {
    console.error('[financial-calculator] Error fetching CPI projections:', err);
    return getDefaultCpiProjections();
  }
}

function getDefaultCpiProjections(): Array<{ year: number; cpiPercent: number }> {
  return generateConvergenceProjections(2.5);
}

function generateConvergenceProjections(currentCpi: number): Array<{ year: number; cpiPercent: number }> {
  const target = 2.5;
  const projections = [];
  for (let year = 1; year <= 10; year++) {
    const convergenceFactor = 1 - Math.pow(0.8, year);
    const projected = currentCpi + (target - currentCpi) * convergenceFactor;
    projections.push({ year, cpiPercent: Math.round(projected * 10) / 10 });
  }
  return projections;
}

function calculateKeyMetrics(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any,
  stampDuty: number
) {
  const annualRent = input.weeklyRent * 52;
  const totalAnnualCosts = annualCosts.totalAnnualExcludingLandTax;
    
  const grossYield = (annualRent / input.propertyValue) * 100;
  const netYield = ((annualRent - totalAnnualCosts) / input.propertyValue) * 100;
  const netCashFlow = annualRent - totalAnnualCosts - (monthlyPayment * 12);
  const totalReturn = input.deposit + stampDuty + 2000;
  
  return {
    grossRentalYield: Math.round(grossYield * 100) / 100,
    netRentalYield: Math.round(netYield * 100) / 100,
    weeklyNet: Math.round(netCashFlow / 52),
    annualNet: Math.round(netCashFlow),
    lvr: Math.round(((input.propertyValue - input.deposit) / input.propertyValue) * 100),
    totalInvestment: totalReturn,
    cashOnCashReturn: Math.round((netCashFlow / totalReturn) * 100 * 100) / 100
  };
}

function calculateSensitivityAnalysis(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any
) {
  const baseNetCashFlow = (input.weeklyRent * 52) - 
    Object.values(annualCosts).filter(val => typeof val === 'number').reduce((sum, cost) => sum + cost, 0) - 
    (monthlyPayment * 12);

  return {
    interestRateChanges: {
      'minus1Percent': calculateImpact(input, input.interestRate - 1, annualCosts),
      'plus1Percent': calculateImpact(input, input.interestRate + 1, annualCosts),
      'plus2Percent': calculateImpact(input, input.interestRate + 2, annualCosts)
    },
    rentChanges: {
      'minus10Percent': baseNetCashFlow - (input.weeklyRent * 52 * 0.1),
      'plus10Percent': baseNetCashFlow + (input.weeklyRent * 52 * 0.1),
      'plus20Percent': baseNetCashFlow + (input.weeklyRent * 52 * 0.2)
    }
  };
}

function calculateImpact(input: LoanCalculationInput & { interestRate: number }, newRate: number, annualCosts: any) {
  const loanAmount = input.propertyValue - input.deposit;
  const monthlyRate = newRate / 100 / 12;
  const totalPayments = input.loanTerm * 12;
  const newMonthlyPayment = calculateMonthlyPayment(loanAmount, monthlyRate, totalPayments);
  
  const totalAnnualCosts = Object.values(annualCosts)
    .filter(val => typeof val === 'number')
    .reduce((sum, cost) => sum + cost, 0);
    
  return (input.weeklyRent * 52) - totalAnnualCosts - (newMonthlyPayment * 12);
}
