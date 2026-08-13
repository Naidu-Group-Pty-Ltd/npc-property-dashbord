/**
 * Reading a report's financial position out of the two places it is stored.
 *
 * ## Why this is a module rather than a `useMemo`
 *
 * It was one. `CashFlowAnalysisModal` built this object inline for the report
 * the adviser had open, and nothing built it for the properties they compared
 * that report against — so the comparison's metrics were computed from a
 * *different, shorter* reading (`compBaseData`), and the two disagreed in two
 * ways that a client would never have been able to see:
 *
 *  - **LMI.** The inline reading has `lmiAmount`; `compBaseData` has no such key.
 *    `totalInitialInvestment` is deposit + stamp duty + legal + LMI, and it is
 *    the denominator of return on capital, cash-on-cash and the equity multiple.
 *    So the property the adviser opened had its returns divided by a larger cost
 *    base than every property it was ranked against.
 *  - **Purchase price.** `compBaseData` reads
 *    `mo.purchasePrice || fc.purchasePrice || fc.propertyValue`, missing
 *    `initialCosts.propertyValue` — which the peer's own *projection* does read.
 *    Where the two differ, capital gain was measured from a base the projection
 *    never used. The `||` also turns a legitimate `0` into a fallback, which
 *    `??` does not.
 *
 * One implementation, called once per property, makes every column of a
 * comparison comparable by construction rather than by care. The modal's
 * `baseFinancialData` is this function; nothing about the report it has open
 * changed.
 *
 * ## The cascades are not tidy, and are not this module's to tidy
 *
 * `purchasePrice` has four sources and `capitalGrowth` has three because the
 * same figure has been saved under different shapes over the life of the
 * product. The order is load-bearing — it is the order the projection engine
 * itself resolves them in — so it is reproduced exactly rather than
 * rationalised. Changing it here changes every projection in the product.
 */
import type { LoanType, RepaymentFrequency } from '@/utils/mortgageCalculations';

/** The two jsonb columns this reads, and nothing else. */
export interface ReadableReport {
  // deno-lint-ignore no-explicit-any
  financial_calculations?: any;
  // deno-lint-ignore no-explicit-any
  manual_overrides?: any;
}

/**
 * A report's financial position.
 *
 * `currentYear` is passed in rather than read from the clock so the result is a
 * function of its inputs — the projections built from it are compared against
 * each other, and a value that changes at midnight is not something two
 * properties should be able to disagree about.
 */
export function readBaseFinancials(report: ReadableReport, currentYear: number) {
  const fc = report.financial_calculations || {};
  const mo = report.manual_overrides || {};
  const cashFlow = fc.cashFlow || {};
  const assumptions = fc.assumptions || {};
  const initialCosts = fc.initialCosts || {};

  // Check if depreciation should be included in cash flow analysis
  const includeDepreciation = mo.includeDepreciationInCashFlow !== false;

  // CRITICAL: capitalGrowth may be stored in multiple locations:
  // 1. manual_overrides.capitalGrowth (flat override - highest priority)
  // 2. financial_calculations.assumptions.capitalGrowth (nested from save mapping)
  // 3. financial_calculations.capitalGrowth (root - legacy)
  const capitalGrowthValue = mo.capitalGrowth ?? assumptions.capitalGrowth ?? fc.capitalGrowth ?? 5;

  // CRITICAL: marketValueNow/propertyValue may be stored in multiple locations:
  // 1. manual_overrides.marketValueNow (flat override - highest priority for current value)
  // 2. cashFlow.marketValueNow (nested)
  // 3. manual_overrides.purchasePrice (purchase time value)
  // 4. initialCosts.propertyValue (nested from save mapping)
  // 5. financial_calculations.purchasePrice (root - legacy)
  const purchasePrice = mo.purchasePrice ?? initialCosts.propertyValue ?? fc.purchasePrice ?? fc.propertyValue ?? 0;
  const marketValueNow = mo.marketValueNow ?? cashFlow.marketValueNow ?? purchasePrice;

  return {
    // Purchase & Loan
    purchasePrice,
    landPrice: mo.landPrice ?? initialCosts.landPrice ?? fc.landPrice ?? 0,
    buildPrice: mo.buildPrice ?? initialCosts.buildPrice ?? fc.buildPrice ?? 0,
    marketValueNow,
    depositValue: mo.depositValue ?? initialCosts.deposit ?? fc.depositValue ?? 0,
    // Loan amount: use override, or cash flow value, or dynamically calculate from purchase price × LVR
    loanAmount: mo.loanAmount ?? cashFlow.loanAmount ??
      (purchasePrice * ((mo.loanToValueRatio ?? fc.loanToValueRatio ?? 80) / 100)),
    loanToValueRatio: mo.loanToValueRatio ?? fc.loanToValueRatio ?? 80,
    loanType: (mo.loanType ?? cashFlow.loanType ?? 'interest_only') as LoanType,
    loanTermYears: mo.loanTermYears ?? cashFlow.loanTermYears ?? 30,
    interestRate: mo.interestRate ?? fc.interestRate ?? 5.5,
    capitalGrowth: capitalGrowthValue,

    // New mortgage calculator fields
    interestOnlyPeriodYears: mo.interestOnlyPeriodYears ?? 0,
    repaymentFrequency: (mo.repaymentFrequency ?? 'monthly') as RepaymentFrequency,
    extraRepaymentPerMonth: mo.extraRepaymentPerMonth ?? 0,
    offsetBalance: mo.offsetBalance ?? 0,

    // Rental Income
    weeklyRent: mo.weeklyRent ?? fc.weeklyRent ?? 0,
    occupancyRate: mo.occupancyRate ?? cashFlow.occupancyRate ?? 52,

    // Expenses
    stampDuty: mo.stampDuty ?? fc.stampDuty ?? 0,
    bodyCorporateFees: mo.bodyCorporateFees ?? fc.bodyCorporateFees ?? 0,
    landTax: mo.landTax ?? fc.landTax ?? 0,
    councilRates: mo.councilRates ?? fc.councilRates ?? 0,
    waterRates: mo.waterRates ?? fc.waterRates ?? 0,
    solicitorFees: mo.solicitorFees ?? fc.solicitorFees ?? 0,
    buildingLandlordInsurance: mo.buildingLandlordInsurance ?? fc.buildingLandlordInsurance ?? 0,
    propertyManagementFees: mo.propertyManagementFees ?? fc.propertyManagementFees ?? 7,
    repairsMaintenance: mo.repairsMaintenance ?? fc.repairsMaintenance ?? 0,
    lettingFees: mo.lettingFees ?? fc.lettingFees ?? 0,
    agentFee: mo.agentFee ?? fc.agentFee ?? 0,

    // Tax & Growth
    // CPI Growth: independent macro indicator — fallback to 2.5% (RBA target midpoint)
    cpiGrowthRate: mo.cpiGrowthRate ?? cashFlow.cpiGrowthRate ?? 2.5,
    depreciation: includeDepreciation ? (mo.depreciation ?? cashFlow.depreciation ?? 6000) : 0,
    taxRate: mo.taxRate ?? cashFlow.taxRate ?? 30,
    constructionYear: mo.constructionYear ?? cashFlow.constructionYear ?? currentYear,

    // 10-Year Depreciation Schedule (from calculator)
    depreciationSchedule: mo.depreciationSchedule as Record<number, number> | undefined,
    depreciationMethod: mo.depreciationMethod as 'dv' | 'pc' | undefined,

    // Construction Settings
    constructionDurationMonths: mo.constructionDurationMonths ?? 7,

    // LMI (one-off Year 1 acquisition cost)
    lmiAmount: mo.lmiAmount ?? 0,

    // Toggle state
    includeDepreciationInCashFlow: includeDepreciation,
  };
}

export type BaseFinancials = ReturnType<typeof readBaseFinancials>;
