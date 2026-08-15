import type { InvestmentReport } from './types';

export interface CashFlowFinancialSummary {
  purchasePrice: number | null;
  weeklyRent: number | null;
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === 'string') {
    const normalised = value.replace(/[$,\s]/g, '');
    if (!normalised) return null;
    const parsed = Number(normalised);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function firstPositive(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toPositiveNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * Resolve the two headline figures using the same precedence as the cash-flow
 * engine. List responses expose pre-resolved scalars; detail responses retain
 * the historical JSON shapes, so this also supports every persisted alias.
 */
export function resolveCashFlowFinancialSummary(report: InvestmentReport): CashFlowFinancialSummary {
  const financials = report.financial_calculations ?? {};
  const overrides = report.manual_overrides ?? {};

  return {
    purchasePrice: firstPositive(
      report.cash_flow_purchase_price,
      overrides.purchasePrice,
      financials.initialCosts?.propertyValue,
      financials.purchasePrice,
      financials.propertyValue,
      financials.purchase_price,
    ),
    weeklyRent: firstPositive(
      report.cash_flow_weekly_rent,
      overrides.weeklyRent,
      financials.income?.weeklyRent,
      financials.weeklyRent,
      financials.weekly_rent,
    ),
  };
}