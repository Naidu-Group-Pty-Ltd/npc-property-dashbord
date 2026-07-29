import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { extractStructureHeadings, selectStructureTemplate } from '@/lib/reportTemplate/cascadeMap';
import { chunkReportContent } from '@/lib/reportTemplate/reportSections';
import type { BrandContext, ReportTemplateAdapter, RoutingContext, TemplateBindingContext } from './types';

function flatten(obj: any): Record<string, any> {
  if (!obj || typeof obj !== 'object') return {};
  return { ...obj };
}

/**
 * Best-effort headings of the active report-structure guide for this report's
 * type/tier, so `sections.*` chunk ids line up with the Cascade contract ids.
 * Failures (RLS, offline) degrade to chunking by the report's own headings.
 */
async function loadStructureHeadings(tier: string | null, category: string | null): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('report_structure_templates')
      .select('id,name,parsed_content,report_tier,report_category,priority')
      .eq('template_type', 'ai_structure')
      .eq('is_active', true);
    if (error || !data) return [];
    const row = selectStructureTemplate(data as any[], { tier, category });
    return extractStructureHeadings((row as any)?.parsed_content || '');
  } catch {
    return [];
  }
}

async function loadInvestmentReport(reportId: string): Promise<any | null> {
  const { data: resp, error } = await invokeSecureFunction('get-investment-reports', {
    table: 'investment_reports',
    reportId,
    listOptions: { select: '*' },
  } as any);

  let row: any = (resp as any)?.report ?? null;
  if ((error || !row) && supabase) {
    const r = await supabase
      .from('investment_reports')
      .select('*')
      .eq('id', reportId)
      .maybeSingle();
    row = r.data;
  }
  return row ?? null;
}

function getReportType(row: any): string {
  const tier = String(row?.report_tier ?? '').toLowerCase();
  const variant = String(row?.report_variant ?? '').toLowerCase();
  if (tier === 'compass' || variant === 'compass') return 'investment_compass';

  return String(row?.report_type ?? row?.report_scope ?? 'investment').toLowerCase();
}

export const investmentReportAdapter: ReportTemplateAdapter = {
  reportType: 'investment',
  label: 'Investment Report',
  supportsProduction: true,
  samplePresetIds: ['investment-default'],
  legacyFallback: {
    label: 'Investment legacy PDF generator',
    reason: 'Used when no active WeasyPrint template matches the investment report context.',
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadInvestmentReport(reportId);
    if (!row) return null;
    const reportType = getReportType(row);
    return {
      reportId,
      reportType,
      variant: (row.report_variant ?? null) as string | null,
      tier: (row.report_tier ?? null) as string | null,
      title: row.property_address ?? null,
      fileLabel: row.property_address ?? reportType,
      sourceTable: 'investment_reports',
      legacyFallback: investmentReportAdapter.legacyFallback,
    };
  },

  async buildBindingContext({ reportId, brand }: { reportId: string; brand?: BrandContext | null }): Promise<TemplateBindingContext | null> {
    const row = await loadInvestmentReport(reportId);
    if (!row) return null;

    const reportType = getReportType(row);
    const variant = (row.report_variant ?? null) as string | null;
    const tier = (row.report_tier ?? null) as string | null;
    const structureHeadings = await loadStructureHeadings(tier, reportType);

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: reportType,
        variant,
        tier,
        address: row.property_address ?? '',
        generated_at: row.updated_at ?? row.created_at,
        status: row.status,
      },
      property: flatten(row.property_specs),
      financials: flatten(row.financial_calculations),
      scores: flatten(row.investment_score),
      demographics: flatten(row.demographics_data),
      economic: flatten(row.economic_data),
      location: flatten(row.location_intelligence),
      sections: chunkReportContent(row.report_content, { structureHeadings }),
      sources: flatten(row.sources_content),
      overrides: flatten(row.manual_overrides),
      tier,
      variant,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    return {
      data,
      meta: { reportId, reportType, variant, tier },
    };
  },
};
