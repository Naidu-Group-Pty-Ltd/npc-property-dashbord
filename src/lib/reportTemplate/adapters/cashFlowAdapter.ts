/**
 * The 10 Year Cash Flow Analysis's Template Builder adapter.
 *
 * The fifth production report type. It is the only one of the five that does
 * **not** read the table named after it, and that is deliberate rather than an
 * oversight: `cash_flow_analyses` holds 0 rows and `cash_flow_renders` is a
 * ledger with no payload, because — as `docs/reports/CASH_FLOW.md` records —
 * the adviser's overrides live in `CashFlowAnalysisModal` and are never
 * persisted. There is no stored artefact for a template to render.
 *
 * What *is* stored is `investment_reports.financial_calculations.projections`:
 * three scenarios of ten years, on 162 of the 1,182 reports. That is this
 * format's source, and `cashFlowProjection.pure.ts` explains what it publishes
 * and, more importantly, the one thing it refuses to.
 *
 * ## A report without a stored projection returns null, and that is the point
 *
 * 1,020 of the 1,182 investment reports carry no `projections` object. Rendering
 * one of them through this format would produce a document whose entire subject
 * — a ten-year series — is missing, with every year's row blank. So
 * `buildBindingContext` returns null, `resolveRoutingContext` returns null, and
 * the caller falls through to `legacyFallback` exactly as it does for a report
 * id that does not exist. The legacy generator keeps those 1,020.
 *
 * That check has to happen in *both* methods. Routing resolves before binding,
 * and a routing context that resolves for a report the binding cannot serve
 * would show an operator a ready-looking template that renders empty.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  applyCashFlowProjection,
  projectCashFlow,
  DEFAULT_SCENARIO,
  type ScenarioName,
} from '../../../../supabase/functions/_shared/cashFlowProjection.pure';
import type {
  BrandContext, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

/**
 * The columns the projection reads, and nothing else.
 *
 * `financial_calculations` is a large JSON blob and `investment_reports` has
 * wide model-authored text columns beside it (`report_content` alone runs to
 * tens of kilobytes); selecting `*` here would pull the whole generated report
 * across the wire to read one nested object.
 *
 * There is no `client_name` on this table — see the projection's header. A
 * misspelt or absent column is not a silent empty here, it is a PostgREST
 * `42703` that fails the whole statement, which is how the Finance Portal's
 * notification feed returned 500 for three weeks.
 */
const COLUMNS = 'id, property_address, financial_calculations, created_at, updated_at';

async function loadReport(reportId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('investment_reports')
    .select(COLUMNS)
    .eq('id', reportId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

/**
 * The scenario a caller asked for, when it is one of the three.
 *
 * An unrecognised name silently becomes `moderate` rather than throwing or
 * rendering an empty series: the scenario is a presentation choice, and a
 * mistyped one should not cost the document.
 */
function resolveScenario(variant?: string | null): ScenarioName {
  const key = String(variant ?? '').trim().toLowerCase();
  if (key === 'conservative' || key === 'optimistic' || key === 'moderate') return key;
  return DEFAULT_SCENARIO;
}

export const cashFlowAdapter: ReportTemplateAdapter = {
  reportType: 'cashflow',
  label: 'Cash Flow Analysis',
  supportsProduction: true,
  legacyFallback: {
    label: 'Cash Flow Analysis legacy generator',
    reason:
      'The pdf-lib generator remains the default until a template is activated for this report type, '
      + 'and stays permanently for the reports that store no projection.',
  },

  async resolveRoutingContext({ reportId, variant }): Promise<RoutingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;
    // A report with no stored series cannot be served by this format at all.
    if (!projectCashFlow(row, resolveScenario(variant)).hasProjections) return null;
    return {
      reportId,
      reportType: 'cashflow',
      variant: variant ?? null,
      tier: null,
      title: row.property_address
        ? `10 Year Cash Flow — ${row.property_address}`
        : '10 Year Cash Flow Analysis',
      fileLabel: 'cash-flow-analysis',
      sourceTable: 'investment_reports',
      legacyFallback: cashFlowAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, variant, brand }: { reportId: string; variant?: string | null; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;

    const scenario = resolveScenario(variant);
    if (!projectCashFlow(row, scenario).hasProjections) return null;

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: 'cashflow',
        generated_at: row.updated_at ?? row.created_at,
      },
      // As with the other adapters, the raw row stays bound under its own column
      // names so anything already keyed on one keeps resolving.
      analysis: row,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyCashFlowProjection(data, row, scenario);

    return {
      data,
      meta: { reportId, reportType: 'cashflow', variant: variant ?? null, tier: null },
    };
  },
};
