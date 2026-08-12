import { investmentReportAdapter } from './investmentReportAdapter';
import { borrowingCapacityAdapter } from './borrowingCapacityAdapter';
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
  previewOnlyAdapter('portfolio', 'Portfolio Analysis'),
  previewOnlyAdapter('cashflow', 'Cash Flow'),
  previewOnlyAdapter('qa', 'Q&A Export'),
  previewOnlyAdapter('suburb', 'Suburb Analysis'),
  previewOnlyAdapter('postcode', 'Postcode Analysis'),
  previewOnlyAdapter('statewide', 'Statewide Analysis'),
  previewOnlyAdapter('comparison', 'Comparison Report'),
  previewOnlyAdapter('client_details', 'Client Details'),
  previewOnlyAdapter('market_intelligence', 'Market Intelligence'),
  previewOnlyAdapter('formara', 'Formara / Client Form'),
];

const ALIASES: Record<string, string> = {
  compass: 'investment',
  investment_compass: 'investment',
  investment_report: 'investment',
  property_investment: 'investment',
  borrowing: 'borrowing_capacity',
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
