/**
 * The Borrowing Capacity Snapshot's Template Builder adapter.
 *
 * ## Why this exists
 *
 * Until now every report type but `investment` was a `previewOnlyAdapter`: a
 * stub whose `buildBindingContext` returns `null`. That is what
 * `supportsProduction` gates and what `deriveEntryFacts` reads to decide
 * `production_ready`, so a Borrowing Capacity template could be browsed, previewed
 * and copied but could never render a real client's assessment. Seeding a design
 * catalogue for the format without this would have shipped 50 templates that look
 * finished and cannot do the job.
 *
 * It is the natural second format to make real. `borrowing_capacity_assessments`
 * is a **typed, columnar table** — 35 columns, mostly numeric — rather than the
 * loose jsonb blob `investment_reports` keeps its figures in, and it holds 143
 * real assessments. The projection reads that shape rather than guessing it; see
 * `borrowingCapacityProjection.pure.ts`, and `docs/reports/BORROWING_CAPACITY.md`
 * for what guessing it cost the last time somebody tried.
 *
 * ## What this does NOT do
 *
 * It does not calculate anything. Every figure it exposes is one the calculator
 * already stored on the row, restated in the vocabulary a template binds. The
 * one exception is unit conversion — monthly to annual, and gross-minus-shaded —
 * which is arithmetic on stored values, not a second opinion about someone's
 * borrowing capacity. `docs/reports/BORROWING_CAPACITY.md` describes five
 * separate PDF implementations of this format; this adds no sixth calculator.
 */
import { supabase } from '@/integrations/supabase/client';
import { applyBorrowingCapacityProjection } from '../../../../supabase/functions/_shared/borrowingCapacityProjection.pure';
import {
  CLIENT_NAME_COLUMNS, type ClientNameRow,
} from '../../../../supabase/functions/_shared/clientName';
import { applyOrganisationProjection } from '../../../../supabase/functions/_shared/organisationProjection.pure';
import { loadOrganisation } from './organisation';
import type {
  BrandContext, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

async function loadAssessment(reportId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('borrowing_capacity_assessments')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

/**
 * The client behind an assessment.
 *
 * The projection deliberately will not guess a name from a `client_id`, so the
 * join is done here — and it asks for `CLIENT_NAME_COLUMNS` rather than naming
 * columns itself. That constant exists because both legacy render routes
 * invented their own spelling of this table, and one of them selected three
 * columns that do not exist and so 404'd for every client in the database.
 *
 * All 143 stored assessments carry a `client_id` that resolves to a real row.
 * A failed lookup still returns null rather than throwing: the document is
 * about the capacity, and losing the name off the cover is not a reason to fail
 * the whole render.
 */
async function loadClient(clientId: unknown): Promise<ClientNameRow | null> {
  if (typeof clientId !== 'string' || !clientId) return null;
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_NAME_COLUMNS)
    .eq('id', clientId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ClientNameRow;
}

export const borrowingCapacityAdapter: ReportTemplateAdapter = {
  reportType: 'borrowing_capacity',
  label: 'Borrowing Capacity',
  supportsProduction: true,
  legacyFallback: {
    label: 'Borrowing Capacity Snapshot legacy generator',
    reason: 'The jsPDF Snapshot remains the default until a template is activated for this report type.',
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadAssessment(reportId);
    if (!row) return null;
    return {
      reportId,
      reportType: 'borrowing_capacity',
      // The format has no variant or tier axis; the columns do not exist.
      variant: null,
      tier: null,
      title: 'Borrowing Capacity Snapshot',
      fileLabel: 'borrowing-capacity-snapshot',
      sourceTable: 'borrowing_capacity_assessments',
      legacyFallback: borrowingCapacityAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const row = await loadAssessment(reportId);
    if (!row) return null;

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: 'borrowing_capacity',
        generated_at: row.updated_at ?? row.created_at,
      },
      // The raw row stays available under its own column names, exactly as the
      // investment adapter keeps `property_specs` beside the projected view.
      // Anything already bound to a column name keeps resolving.
      assessment: row,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyBorrowingCapacityProjection(data, row, await loadClient(row.client_id));
    // The letterhead — the wordmark on the cover and the contact block on the
    // disclaimer page every template ends with. Nothing published `org` until
    // August 2026, so both printed blank on every report this product has ever
    // generated. See `organisationProjection.pure.ts`.
    applyOrganisationProjection(data, await loadOrganisation());


    return {
      data,
      meta: { reportId, reportType: 'borrowing_capacity', variant: null, tier: null },
    };
  },
};
