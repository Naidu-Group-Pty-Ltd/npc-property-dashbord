/**
 * The investment financial engine — every figure the calculator service
 * publishes, as pure arithmetic with no IO. `financial-calculator-service`
 * orchestrates (stamp duty schedule, live CPI cache, HTTP) and delegates all
 * calculation here; `generate-investment-report` derives its prompt-narrative
 * figures from the same helpers so the prose and the tables it introduces
 * cannot disagree.
 *
 * Why this module exists at all: the projections used to fold
 * `Object.values(annualCosts)` — an object that carries its own totals
 * (`totalAnnual`, `totalAnnualExcludingLandTax`) and a percentage beside the
 * line items — so every year of every stored 10-year series charged the
 * operating costs roughly three times over. Measured on a production row
 * ($1.19M property): stored year-1 operating expenses $59,931 against real
 * annual costs of $21,418, overstating the year-1 holding cost by ~$38k and
 * the 10-year cumulative position by ~$370k, while the headline metrics used
 * a different (un-inflated, land-tax-excluded) base — a $43,885/yr
 * contradiction printed on one page. The arithmetic lives once now, against
 * one cost base, and is pinned by `financialEngine.spec.ts` with that
 * production row.
 *
 * The one deliberate asymmetry: net rental YIELD excludes land tax (it is a
 * property-comparison metric and land tax depends on the owner's aggregated
 * landholdings, not the property), while every CASH FLOW figure includes it
 * (the money leaves the owner's account). Reports state the exclusion.
 */

export interface LoanCalculationInput {
  propertyValue: number;
  deposit: number;
  interestRate?: number; // Optional — the service fetches live rates if not provided
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

export interface FinancialProjection {
  year: number;
  propertyValue: number;
  loanBalance: number;
  equity: number;
  annualRent: number;
  cashFlow: number;
  cumulativeCashFlow: number;
  roi: number;
}

export interface InterestRateInfo {
  rate: number;
  lvrTier: string;
  rateType: string;
  source: string;
  lmiRequired: boolean;
  lmiEstimate: number;
}

export interface CpiProjection {
  year: number;
  cpiPercent: number;
}

// LVR-based interest rate tiers (based on current market rates Dec 2024)
export const LVR_RATE_TIERS = {
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

export function getInterestRateByLVR(
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

export function calculateLMI(lvr: number): number {
  // Simplified LMI calculation based on typical LMI rates
  // Actual LMI varies by lender, loan amount, and LVR
  if (lvr <= 80) return 0;
  if (lvr <= 85) return 3500;
  if (lvr <= 90) return 8500;
  if (lvr <= 95) return 15000;
  return 25000;
}

export function calculateMonthlyPayment(loanAmount: number, monthlyRate: number, totalPayments: number): number {
  if (monthlyRate === 0) return loanAmount / totalPayments;

  return loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments)) /
         (Math.pow(1 + monthlyRate, totalPayments) - 1);
}

export function calculateAnnualCosts(propertyValue: number, weeklyRent: number, state: string, propertyType: string) {
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

export function calculateLandTax(propertyValue: number, state: string): number {
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

/**
 * The annual operating cost base (loan payments excluded) shared by the
 * projections, the sensitivity analysis and the headline cash-flow metrics.
 * One base is the point: a report quotes these figures beside each other and
 * a careful reader must be able to reconcile them.
 *
 * Never fold `Object.values(annualCosts)`: the object carries its own totals
 * and a percentage beside the line items, so a blind numeric sum charges
 * every cost roughly three times over (`3×totalAnnual − landTax + percent`)
 * — the defect that inflated every stored projection series.
 */
export function operatingExpensesFrom(annualCosts: any): number {
  const footed = annualCosts?.totalAnnual;
  if (typeof footed === 'number' && Number.isFinite(footed)) return footed;
  const LINE_ITEMS = [
    'councilRates', 'waterRates', 'landlordInsurance',
    'propertyManagement', 'maintenance', 'landTax', 'strataFees',
  ];
  return LINE_ITEMS.reduce(
    (sum, key) => sum + (typeof annualCosts?.[key] === 'number' ? annualCosts[key] : 0),
    0,
  );
}

export function generateProjections(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any,
  capitalGrowthRate: number,
  rentGrowthRate: number,
  customCpiGrowth: number | null,
  cpiProjections: CpiProjection[],
): FinancialProjection[] {

  const projections: FinancialProjection[] = [];
  let currentPropertyValue = input.propertyValue;
  let currentRent = input.weeklyRent * 52;
  let loanBalance = input.propertyValue - input.deposit;
  let cumulativeCashFlow = 0;

  const loanPaymentsAnnual = monthlyPayment * 12;
  let currentOperatingExpenses = operatingExpensesFrom(annualCosts);

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

export function getDefaultCpiProjections(): CpiProjection[] {
  return generateConvergenceProjections(2.5);
}

export function generateConvergenceProjections(currentCpi: number): CpiProjection[] {
  const target = 2.5;
  const projections = [];
  for (let year = 1; year <= 10; year++) {
    const convergenceFactor = 1 - Math.pow(0.8, year);
    const projected = currentCpi + (target - currentCpi) * convergenceFactor;
    projections.push({ year, cpiPercent: Math.round(projected * 10) / 10 });
  }
  return projections;
}

export function calculateKeyMetrics(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any,
  totalUpfront: number
) {
  const annualRent = input.weeklyRent * 52;
  // Cash flow shares the projections' cost base (all costs, land tax in);
  // yield keeps the owner-independent base and the report says so.
  const cashFlowCosts = operatingExpensesFrom(annualCosts);
  const yieldCosts = typeof annualCosts?.totalAnnualExcludingLandTax === 'number'
    ? annualCosts.totalAnnualExcludingLandTax
    : cashFlowCosts;

  const grossYield = (annualRent / input.propertyValue) * 100;
  const netYield = ((annualRent - yieldCosts) / input.propertyValue) * 100;
  const netCashFlow = annualRent - cashFlowCosts - (monthlyPayment * 12);

  return {
    grossRentalYield: Math.round(grossYield * 100) / 100,
    netRentalYield: Math.round(netYield * 100) / 100,
    weeklyNet: Math.round(netCashFlow / 52),
    annualNet: Math.round(netCashFlow),
    lvr: Math.round(((input.propertyValue - input.deposit) / input.propertyValue) * 100),
    // The denominator is the same figure initialCosts publishes as
    // totalUpfront — deposit, duty, LMI and the fee lines — never a second
    // derivation that can drift from the number printed above it.
    totalInvestment: totalUpfront,
    cashOnCashReturn: totalUpfront > 0
      ? Math.round((netCashFlow / totalUpfront) * 100 * 100) / 100
      : 0
  };
}

export function calculateSensitivityAnalysis(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any
) {
  // Same single cost base as the projections and headline metrics — see
  // operatingExpensesFrom for why the raw object must never be folded.
  const baseNetCashFlow = (input.weeklyRent * 52) -
    operatingExpensesFrom(annualCosts) -
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

export function calculateImpact(input: LoanCalculationInput & { interestRate: number }, newRate: number, annualCosts: any) {
  const loanAmount = input.propertyValue - input.deposit;
  const monthlyRate = newRate / 100 / 12;
  const totalPayments = input.loanTerm * 12;
  const newMonthlyPayment = calculateMonthlyPayment(loanAmount, monthlyRate, totalPayments);

  return (input.weeklyRent * 52) - operatingExpensesFrom(annualCosts) - (newMonthlyPayment * 12);
}

// ---------------------------------------------------------------------------
// Series-derived narrative helpers.
//
// A report's prose introduces the projections table it prints; every number
// the prose quotes about that table is derived FROM the series here, so the
// two cannot disagree whatever wrote the series.
// ---------------------------------------------------------------------------

/**
 * The operating costs a projection row implies: rent − loan payments − cash
 * flow. Holds by construction for every row `generateProjections` writes,
 * and doubles as the detector for historic rows written by the pre-fix fold
 * (implied opex ≈ 2–3× the recorded annual costs).
 */
export function impliedOpexFromSeries(row: any, annualLoanPayments: number): number | null {
  if (!row || typeof row.annualRent !== 'number' || typeof row.cashFlow !== 'number') return null;
  if (typeof annualLoanPayments !== 'number' || !Number.isFinite(annualLoanPayments) || annualLoanPayments <= 0) return null;
  return Math.round(row.annualRent - annualLoanPayments - row.cashFlow);
}

/**
 * Accounting sign convention that keeps the sign: a negative cash flow in
 * parentheses, a positive one as plain dollars. Wrapping `Math.abs` in
 * parentheses unconditionally — the previous formatting — rendered POSITIVE
 * cash flow as a loss.
 */
export function fmtCashFlow(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return v < 0 ? `($${Math.abs(v).toLocaleString('en-AU')})` : `$${v.toLocaleString('en-AU')}`;
}

/**
 * LVR for a projection row, computed from the balances the row carries. The
 * rows have no `lvr` field; binding one printed the literal placeholder
 * "XX%" into produced reports.
 */
export function seriesLvrPercent(row: any): string {
  if (!row || typeof row.loanBalance !== 'number' || typeof row.propertyValue !== 'number' || !row.propertyValue) return 'XX';
  return ((row.loanBalance / row.propertyValue) * 100).toFixed(1);
}

/** Sum of a scenario's yearly cash flows; 0 when the series is absent. */
export function cumulativeCashFlow(rows: unknown): number {
  return Array.isArray(rows)
    ? rows.reduce((sum: number, p: any) => sum + (typeof p?.cashFlow === 'number' ? p.cashFlow : 0), 0)
    : 0;
}
