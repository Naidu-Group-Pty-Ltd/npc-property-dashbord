import { supabase } from '@/integrations/supabase/client';
import type {
  BrandContext, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';
import {
  buildCapacitySnapshot,
} from '../../../../supabase/functions/_shared/reports/commercialCapacity/normalise.pure';
import {
  isReportable,
} from '../../../../supabase/functions/_shared/reports/commercialCapacity/route.pure';
import {
  applyCommercialCapacityProjection,
} from '../../../../supabase/functions/_shared/commercialCapacityProjection.pure';
import { applyOrganisationAndBrand } from './organisation';

/**
 * Commercial & Industrial Capacity, from the stored calculation run.
 *
 * `buildCapacitySnapshot` is the same normaliser `render-commercial-capacity-pdf`
 * calls, so a template and the flowing route describe one assessment the same
 * way. The format's first rule — every figure comes from the stored run and
 * never from a recomputation — is kept by construction: this adapter reads
 * `outputs` and `inputs_snapshot` off the run and computes nothing.
 *
 * ## It declines most assessments, and that is correct
 *
 * Of the sixteen assessments in production, **thirteen have no calculation
 * run** — seven `draft`, four `archived`, two `data_entry`. There are no figures
 * for a document to carry, so this returns `null` rather than a document full of
 * blanks. That is the Cash Flow adapter's behaviour and for the same reason.
 *
 * ## Reportability follows the render route rather than the run
 *
 * A run is necessary but not sufficient: `isReportable` is the route's own
 * policy and this defers to it, so a template cannot produce a document the
 * flowing route would refuse. That costs one assessment today — a `calculated`
 * row carrying a complete run and outcome — and the alternative is two parts of
 * one product disagreeing about whether a deal may be sent to a client, which is
 * worse than a row you have to link first.
 */

const ASSESSMENT_COLUMNS =
  'id, reference, title, status, segment, assessment_type, payload, requested_loan, '
  + 'maximum_indicative_loan, proposed_lvr, proposed_dscr, outcome, binding_constraint, '
  + 'client_id, current_calculation_id, version, created_at, updated_at';

const RUN_COLUMNS =
  'id, assessment_id, engine_version, policy_version, scenario_key, inputs_snapshot, '
  + 'policy_snapshot, outputs, outcome, binding_constraint, maximum_indicative_loan, '
  + 'analysis, created_at';

async function loadAssessment(id: string) {
  const { data, error } = await supabase
    .from('commercial_industrial_assessments')
    .select(ASSESSMENT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

async function loadRun(runId: string) {
  const { data, error } = await supabase
    .from('commercial_industrial_calculation_runs')
    .select(RUN_COLUMNS)
    .eq('id', runId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

/**
 * The linked client's display name, when there is one.
 *
 * An assessment need not be linked — the C&I workflow allows one to be built
 * standalone — so an absent name is normal and the snapshot falls back to the
 * assessment's own title. `clients` is queried for the columns that exist on it;
 * this is the mistake that cost the Comparison adapter a working cover, where
 * `client_name` was read off a table that has never had the column.
 */
async function loadClientName(clientId: string | null): Promise<string | null> {
  if (!clientId) return null;
  const { data, error } = await supabase
    .from('clients')
    .select('primary_first_name, primary_surname')
    .eq('id', clientId)
    .maybeSingle();
  if (error || !data) return null;
  const name = [data.primary_first_name, data.primary_surname]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || null;
}

async function loadSnapshotInputs(reportId: string) {
  const assessment = await loadAssessment(reportId);
  if (!assessment) return null;
  if (!isReportable(assessment.status)) return null;

  const runId = assessment.current_calculation_id as string | null;
  if (!runId) return null;
  const run = await loadRun(runId);
  if (!run || !run.outputs) return null;

  return { assessment, run };
}

export const commercialCapacityAdapter: ReportTemplateAdapter = {
  reportType: 'commercial_capacity',
  label: 'Commercial & Industrial Capacity',
  supportsProduction: true,
  legacyFallback: {
    label: 'Commercial & Industrial Capacity report',
    route: 'render-commercial-capacity-pdf',
    reason:
      'The archetype route renders the full assessment including the method trail. '
      + 'A template carries the assessment and its analysis, and stays available for '
      + 'an assessment with a stored calculation run.',
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const loaded = await loadSnapshotInputs(reportId);
    if (!loaded) return null;
    const { assessment } = loaded;
    return {
      reportId,
      reportType: 'commercial_capacity',
      variant: (assessment.segment as string) ?? null,
      tier: null,
      title: (assessment.title as string) || 'Commercial & Industrial Capacity',
      fileLabel: 'commercial-industrial-capacity',
      sourceTable: 'commercial_industrial_assessments',
      legacyFallback: commercialCapacityAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const loaded = await loadSnapshotInputs(reportId);
    if (!loaded) return null;
    const { assessment, run } = loaded;

    const snapshot = buildCapacitySnapshot({
      assessment,
      outputs: run.outputs,
      inputs: run.inputs_snapshot,
      clientName: await loadClientName(assessment.client_id ?? null),
      // Reused from the run, never regenerated here. A re-issued report must say
      // what the first one said, and a template render is not the place to spend
      // a metered model call.
      analysis: (run.analysis ?? null) as never,
    });

    const data: Record<string, any> = {
      report: {
        id: assessment.id,
        type: 'commercial_capacity',
        generated_at: assessment.updated_at ?? assessment.created_at,
      },
      assessment,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyCommercialCapacityProjection(data, snapshot);
    await applyOrganisationAndBrand(data);

    return {
      data,
      meta: {
        reportId,
        reportType: 'commercial_capacity',
        variant: (assessment.segment as string) ?? null,
        tier: null,
      },
    };
  },
};
