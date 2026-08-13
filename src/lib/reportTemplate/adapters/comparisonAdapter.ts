/**
 * The Property Comparison Analysis's Template Builder adapter.
 *
 * The fourth production report type, after `investment`, `borrowing_capacity`
 * and `portfolio`. It reads `property_comparisons` — 50 stored comparisons of
 * two to five properties each.
 *
 * Unlike the other three, this one does almost nothing itself: the format
 * already has a normaliser (`_shared/reports/propertyComparison`), so the
 * adapter loads the row and hands it straight to it. Every hard question about
 * this record — the 27 rows whose response was cut off mid-token, the two score
 * scales, the winner pointers that name nobody — is answered there once, and
 * both this path and the WeasyPrint route get the same answer. See
 * `comparisonProjection.pure.ts`.
 *
 * The clock is passed in rather than read inside the normaliser, which is why
 * `now` appears here: the pure modules take no ambient time.
 */
import { supabase } from '@/integrations/supabase/client';
import { applyComparisonProjection } from '../../../../supabase/functions/_shared/comparisonProjection.pure';
import type {
  BrandContext, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

async function loadComparison(reportId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('property_comparisons')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

/**
 * The client's name, and only when exactly one resolves.
 *
 * A comparison is stored against `report_ids`, not against a client, so the
 * name has to come from the reports it compares. When they disagree — a
 * comparison across two clients' shortlists — the normaliser is given nothing
 * rather than one of the two, because naming the wrong client on the cover of a
 * document is worse than naming none.
 */
async function resolveClientName(reportIds: unknown): Promise<string | undefined> {
  const ids = Array.isArray(reportIds) ? reportIds.filter((v) => typeof v === 'string') : [];
  if (!ids.length) return undefined;
  const { data, error } = await supabase
    .from('investment_reports')
    .select('client_name')
    .in('id', ids as string[]);
  if (error || !data) return undefined;
  const names = [...new Set(
    data.map((r: Record<string, any>) => String(r.client_name ?? '').trim()).filter(Boolean),
  )];
  return names.length === 1 ? names[0] : undefined;
}

export const comparisonAdapter: ReportTemplateAdapter = {
  reportType: 'comparison',
  label: 'Comparison Report',
  supportsProduction: true,
  legacyFallback: {
    label: 'Comparison Analysis legacy generator',
    reason: 'The pdf-lib generator remains the default until a template is activated for this report type.',
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadComparison(reportId);
    if (!row) return null;
    return {
      reportId,
      reportType: 'comparison',
      variant: null,
      tier: null,
      title: row.report_title || 'Property Comparison Analysis',
      fileLabel: 'property-comparison-analysis',
      sourceTable: 'property_comparisons',
      legacyFallback: comparisonAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const row = await loadComparison(reportId);
    if (!row) return null;

    const notes: string[] = [];
    if (row.is_archived) notes.push('This comparison is archived.');

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: 'comparison',
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

    applyComparisonProjection(data, {
      row,
      clientName: await resolveClientName(row.report_ids),
      notes,
      now: new Date().toISOString(),
    });

    return {
      data,
      meta: { reportId, reportType: 'comparison', variant: null, tier: null },
    };
  },
};
