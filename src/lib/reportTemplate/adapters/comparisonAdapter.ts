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
import { applyOrganisationProjection } from '../../../../supabase/functions/_shared/organisationProjection.pure';
import { loadOrganisation } from './organisation';
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
 * ## There is no client name to resolve, and this used to try
 *
 * A comparison is stored against `report_ids` and nothing else, so the obvious
 * move is to read the name off the reports it compares — taking it only when
 * exactly one resolves, since naming the wrong client is worse than naming
 * none. That is what this adapter did.
 *
 * It cannot work: **`investment_reports` has no `client_name` column.** The
 * request was a PostgREST `42703`, the error branch returned `undefined`, and
 * the cover title bound to `{{client.name}}` rendered as the empty string on
 * every comparison — the same failure mode as the Finance Portal's notification
 * feed, where a filter on three columns that did not exist failed the whole
 * statement and returned 500 for three weeks.
 *
 * So the masters name the subject instead of the client, and this function is
 * gone rather than fixed. `comparison_client_identity` in
 * `comparisonCatalogue.spec.ts` keeps it gone.
 */
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
      // Deliberately absent — see the note above.
      clientName: undefined,
      notes,
      now: new Date().toISOString(),
    });
    // The letterhead — the wordmark on the cover and the contact block on the
    // disclaimer page every template ends with. Nothing published `org` until
    // August 2026, so both printed blank on every report this product has ever
    // generated. See `organisationProjection.pure.ts`.
    applyOrganisationProjection(data, await loadOrganisation());


    return {
      data,
      meta: { reportId, reportType: 'comparison', variant: null, tier: null },
    };
  },
};
