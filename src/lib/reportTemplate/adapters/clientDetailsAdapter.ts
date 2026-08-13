/**
 * The Client Details Form's Template Builder adapter.
 *
 * The sixth production report type, and the second — after the Property
 * Comparison — that does almost nothing itself. The format already has a
 * normaliser feeding `render-client-details-pdf`, and every hard question about
 * this record is answered there: which of nine tables a figure comes from, that
 * stored aggregates like `clients.total_portfolio_value` are never read, that
 * frequencies are converted through one function, that council and water rates
 * are annual despite their `monthly_` prefix. So this loads the nine tables,
 * hands them to `buildClientDetails`, and projects the result.
 *
 * `docs/reports/CLIENT_DETAILS.md` is the contract.
 *
 * ## Nine reads, and the error is checked before the data on every one
 *
 * A failed query returns no rows, and for this format an empty result is
 * indistinguishable from a client who genuinely has none — 742 of the 775
 * clients have no property, no employment, no asset, no liability and no
 * expense. So a read that *errors* must not be treated as a read that returned
 * nothing: that would print a client's document with their liabilities silently
 * missing, on a document whose entire purpose is being sent to a broker.
 *
 * The render route makes the same check for the same reason, in the same words.
 *
 * ## The clock is passed in
 *
 * `buildClientDetails` takes `now` because nothing in the pure modules reads a
 * clock. The adapter is the edge, so the adapter supplies it.
 */
import { supabase } from '@/integrations/supabase/client';
import { buildClientDetails } from '@/lib/reports/clientDetails/normalise.pure';
import { applyClientDetailsProjection } from '../../../../supabase/functions/_shared/clientDetailsProjection.pure';
import { applyOrganisationProjection } from '../../../../supabase/functions/_shared/organisationProjection.pure';
import { loadOrganisation } from './organisation';
import type {
  BrandContext, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

interface ClientRecord {
  client: Record<string, any>;
  properties: unknown;
  employment: unknown;
  income: unknown;
  incomeSources: unknown;
  assets: unknown;
  liabilities: unknown;
  expenses: unknown;
  addressHistory: unknown;
}

/**
 * The nine tables, or null.
 *
 * Null on a missing client and null on **any** read error — see the header. The
 * caller turns that into the legacy fallback, which is the right outcome: a
 * document that cannot be shown to be complete must not be produced at all.
 */
async function loadClientRecord(clientId: string): Promise<ClientRecord | null> {
  const [
    clientRes, propertiesRes, employmentRes, incomeRes, incomeSourcesRes,
    assetsRes, liabilitiesRes, expensesRes, historyRes,
  ] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
    supabase.from('client_properties').select('*').eq('client_id', clientId),
    supabase.from('client_employment').select('*').eq('client_id', clientId),
    supabase.from('client_income').select('*').eq('client_id', clientId),
    supabase.from('client_income_sources').select('*').eq('client_id', clientId).eq('is_active', true),
    supabase.from('client_assets').select('*').eq('client_id', clientId),
    supabase.from('client_liabilities').select('*').eq('client_id', clientId),
    supabase.from('client_expenses').select('*').eq('client_id', clientId),
    supabase.from('client_address_history').select('*').eq('client_id', clientId),
  ]);

  for (const res of [
    clientRes, propertiesRes, employmentRes, incomeRes, incomeSourcesRes,
    assetsRes, liabilitiesRes, expensesRes, historyRes,
  ]) {
    if (res.error) return null;
  }
  if (!clientRes.data) return null;

  return {
    client: clientRes.data as Record<string, any>,
    properties: propertiesRes.data ?? [],
    employment: employmentRes.data ?? [],
    income: incomeRes.data ?? [],
    incomeSources: incomeSourcesRes.data ?? [],
    assets: assetsRes.data ?? [],
    liabilities: liabilitiesRes.data ?? [],
    expenses: expensesRes.data ?? [],
    addressHistory: historyRes.data ?? [],
  };
}

/** Just the client row, for routing — nine reads to decide a title is waste. */
async function loadClientRow(clientId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, first_name, last_name, updated_at, created_at')
    .eq('id', clientId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

export const clientDetailsAdapter: ReportTemplateAdapter = {
  reportType: 'client_details',
  label: 'Client Details',
  supportsProduction: true,
  legacyFallback: {
    label: 'Client Details legacy generator',
    reason:
      'FormaraPDFGenerator remains the default until a template is activated for this report type. '
      + 'It rasterises every page, so nothing in its output is selectable — which is the whole of '
      + 'this migration’s value.',
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadClientRow(reportId);
    if (!row) return null;
    const name = [row.first_name, row.last_name]
      .map((p) => String(p ?? '').trim()).filter(Boolean).join(' ');
    return {
      reportId,
      reportType: 'client_details',
      variant: null,
      tier: null,
      title: name ? `Client details — ${name}` : 'Client details',
      fileLabel: 'client-details',
      sourceTable: 'clients',
      legacyFallback: clientDetailsAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const record = await loadClientRecord(reportId);
    if (!record) return null;

    let details;
    try {
      details = buildClientDetails({
        client: record.client,
        properties: record.properties,
        employment: record.employment,
        income: record.income,
        incomeSources: record.incomeSources,
        assets: record.assets,
        liabilities: record.liabilities,
        expenses: record.expenses,
        addressHistory: record.addressHistory,
        now: new Date().toISOString(),
      });
    } catch {
      // `ClientDetailsPayloadError` — a record the normaliser refuses is a
      // record this format must not draw a document from.
      return null;
    }

    const data: Record<string, any> = {
      report: {
        id: record.client.id,
        type: 'client_details',
        generated_at: record.client.updated_at ?? record.client.created_at,
      },
      // The raw row stays bound under its own column names, as with the other
      // adapters, so anything already keyed on one keeps resolving.
      record: record.client,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyClientDetailsProjection(data, details);
    applyOrganisationProjection(data, await loadOrganisation());

    return {
      data,
      meta: { reportId, reportType: 'client_details', variant: null, tier: null },
    };
  },
};
