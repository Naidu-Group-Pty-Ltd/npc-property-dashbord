/**
 * The Portfolio Performance Review's Template Builder adapter.
 *
 * The third production report type, after `investment` and `borrowing_capacity`.
 * It reads `portfolio_analysis_reports` — 21 stored reports, every one carrying
 * a `health_score` and a `report_data` object with the portfolio metrics, the
 * per-property inventory and the model-authored assessment.
 *
 * `portfolio_reviews` is a different table for a different thing (a scheduled
 * adviser review with its own cadence and action items) and is not what
 * `PortfolioAnalysisPDFGenerator` draws. Picking the wrong one would have
 * produced a template bound to a table the format never reads.
 *
 * As with the other adapters, this calculates nothing: every figure is one the
 * analysis already stored, restated in the vocabulary a template binds. The only
 * derivation is monthly × 12.
 */
import { supabase } from '@/integrations/supabase/client';
import { applyPortfolioProjection } from '../../../../supabase/functions/_shared/portfolioProjection.pure';
import { applyOrganisationAndBrand } from './organisation';
import type {
  BrandContext, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

async function loadReport(reportId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('portfolio_analysis_reports')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

export const portfolioAdapter: ReportTemplateAdapter = {
  reportType: 'portfolio',
  label: 'Portfolio Analysis',
  supportsProduction: true,
  legacyFallback: {
    label: 'Portfolio Analysis legacy generator',
    reason: 'The pdf-lib generator remains the default until a template is activated for this report type.',
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;
    return {
      reportId,
      reportType: 'portfolio',
      variant: null,
      tier: null,
      title: 'Portfolio Performance Review',
      fileLabel: 'portfolio-performance-review',
      sourceTable: 'portfolio_analysis_reports',
      legacyFallback: portfolioAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: 'portfolio',
        generated_at: row.updated_at ?? row.created_at,
      },
      // The raw row stays available under its own column names, as with the
      // other adapters, so anything already bound to one keeps resolving.
      analysis: row,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyPortfolioProjection(data, row);
    // The letterhead — the wordmark on the cover and the contact block on the
    // disclaimer page every template ends with. Nothing published `org` until
    // August 2026, so both printed blank on every report this product has ever
    // generated. See `organisationProjection.pure.ts`.
    await applyOrganisationAndBrand(data);


    return {
      data,
      meta: { reportId, reportType: 'portfolio', variant: null, tier: null },
    };
  },
};
