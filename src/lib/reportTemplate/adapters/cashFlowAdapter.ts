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
import {
  applyLiveCashFlowProjection,
  wireAsProjectionRow,
} from '@/lib/reports/cashFlow/liveProjectionRow';
import type { WireProjection } from '@/lib/reports/cashFlow/requestCashFlowPdf';
import { applyOrganisationAndBrand } from './organisation';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
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

/**
 * The reviewed series the caller handed over, as a row this adapter can read.
 *
 * The 10 Year Cash Flow is the one format whose contract puts the arithmetic
 * in the browser (`docs/reports/CASH_FLOW.md`): the modal recomputes ten years
 * live, and those overrides are not stored anywhere this adapter could load
 * them from. Without this channel the stored template choice applied only when
 * the screen happened to equal the store — the exception, not the rule.
 *
 * Null when no payload was supplied, or the supplied one is not whole enough
 * to draw — the same refusal shape as a stored row with no projection.
 */
function liveRowFromPayload(
  payload: Record<string, unknown> | null | undefined,
  reportId: string,
  propertyAddress?: string | null,
): Record<string, unknown> | null {
  const wire = payload?.wire as WireProjection | undefined;
  if (!wire) return null;
  return wireAsProjectionRow(wire, { reportId, propertyAddress });
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

  /**
   * Only reports that store a projection — the 162, not the 1,182. The filter
   * is the server-side approximation (`projections` present on the blob);
   * `projectCashFlow`'s structural check still guards the render, so a
   * mis-shaped projection is refused at selection rather than listed out. The
   * blob itself is deliberately not selected here: pulling twenty of them to
   * label a picker is the exact waste `COLUMNS` exists to avoid.
   */
  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      const { data, error } = await supabase
        .from('investment_reports')
        .select('id, property_address, created_at')
        .not('financial_calculations->projections', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return (data as Record<string, any>[]).map((row) => ({
        id: String(row.id),
        label: (row.property_address as string) || '10 Year Cash Flow',
        savedAt: (row.created_at as string) ?? null,
      }));
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId, variant, payload }): Promise<RoutingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;
    // A report with no stored series cannot be served by this format — unless
    // the caller supplied the reviewed series itself, which is this format's
    // documented source of truth. The payload is validated by the same bridge
    // the binding uses, so a routing context can never resolve for a series
    // the binding would then refuse.
    const live = liveRowFromPayload(payload, reportId, row.property_address as string | null);
    if (!live && !projectCashFlow(row, resolveScenario(variant)).hasProjections) return null;
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
    { reportId, variant, brand, payload }: {
      reportId: string; variant?: string | null; brand?: BrandContext | null;
      payload?: Record<string, unknown> | null;
    },
  ): Promise<TemplateBindingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;

    const live = liveRowFromPayload(payload, reportId, row.property_address as string | null);
    const scenario = resolveScenario(variant);
    if (!live && !projectCashFlow(row, scenario).hasProjections) return null;

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

    if (live) {
      // The series the adviser reviewed, published under the same vocabulary
      // by the same producer — and never labelled with a scenario it does not
      // satisfy. See `liveProjectionRow.ts`.
      applyLiveCashFlowProjection(data, live);
    } else {
      applyCashFlowProjection(data, row, scenario);
    }
    // The letterhead — the wordmark on the cover and the contact block on the
    // disclaimer page every template ends with. Nothing published `org` until
    // August 2026, so both printed blank on every report this product has ever
    // generated. See `organisationProjection.pure.ts`.
    await applyOrganisationAndBrand(data);


    return {
      data,
      meta: { reportId, reportType: 'cashflow', variant: variant ?? null, tier: null },
    };
  },
};
