import { investmentReportAdapter } from './investmentReportAdapter';
import { borrowingCapacityAdapter } from './borrowingCapacityAdapter';
import { portfolioAdapter } from './portfolioAdapter';
import { comparisonAdapter } from './comparisonAdapter';
import { cashFlowAdapter } from './cashFlowAdapter';
import { clientDetailsAdapter } from './clientDetailsAdapter';
import type { ReportTemplateAdapter } from './types';

function previewOnlyAdapter(reportType: string, label: string, reason = 'Production adapter has not been configured yet.'): ReportTemplateAdapter {
  return {
    reportType,
    label,
    supportsProduction: false,
    legacyFallback: { label: `${label} legacy generator`, reason },
    async resolveRoutingContext() { return null; },
    async buildBindingContext() { return null; },
  };
}

export const REPORT_TEMPLATE_ADAPTERS: ReportTemplateAdapter[] = [
  investmentReportAdapter,
  // Second production adapter. `borrowing_capacity_assessments` is a typed table
  // with 143 real rows, so these templates can render an actual assessment
  // rather than only a preview. See `borrowingCapacityAdapter.ts`.
  borrowingCapacityAdapter,
  // Third production adapter, reading `portfolio_analysis_reports` (21 rows).
  portfolioAdapter,
  // Fourth, reading `property_comparisons` (50 rows) through the normaliser the
  // format's own render route already uses.
  comparisonAdapter,
  // Fifth, and the only one that does not read the table named after it:
  // `cash_flow_analyses` holds 0 rows by design, so this reads the stored
  // `financial_calculations.projections` on `investment_reports` (162 of 1,182)
  // and returns null for the rest. See `cashFlowAdapter.ts`.
  cashFlowAdapter,
  // Sixth. Nine tables through the normaliser the format's own render route
  // uses — 742 of the 775 clients hold nothing financial, which is what the
  // masters are built around rather than in spite of.
  clientDetailsAdapter,
  previewOnlyAdapter('qa', 'Q&A Export'),
  previewOnlyAdapter('suburb', 'Suburb Analysis'),
  previewOnlyAdapter('postcode', 'Postcode Analysis'),
  previewOnlyAdapter('statewide', 'Statewide Analysis'),
  previewOnlyAdapter('market_intelligence', 'Market Intelligence'),
];

const ALIASES: Record<string, string> = {
  compass: 'investment',
  investment_compass: 'investment',
  investment_report: 'investment',
  property_investment: 'investment',
  borrowing: 'borrowing_capacity',
  // Both spellings reach `PRODUCTION_REPORT_TEMPLATE_TYPES` in the broker,
  // which matches the raw `report_type` and does not run it through this map.
  // Without the alias the two gates would disagree about `cash_flow`.
  cash_flow: 'cashflow',
  clientdetails: 'client_details',
  formara: 'client_details',
};

export function normaliseReportType(reportType?: string | null): string {
  const key = String(reportType ?? '').trim().toLowerCase();
  return ALIASES[key] ?? key;
}

export function getAdapter(reportType?: string | null): ReportTemplateAdapter | null {
  const key = normaliseReportType(reportType);
  if (!key) return null;
  return REPORT_TEMPLATE_ADAPTERS.find((adapter) => adapter.reportType === key) ?? null;
}

export function listAdapters(): ReportTemplateAdapter[] {
  return [...REPORT_TEMPLATE_ADAPTERS];
}

export function supportsProduction(reportType?: string | null): boolean {
  return !!getAdapter(reportType)?.supportsProduction;
}

export type { BrandContext, LegacyFallbackDescriptor, ReportTemplateAdapter, RoutingContext, TemplateBindingContext } from './types';
