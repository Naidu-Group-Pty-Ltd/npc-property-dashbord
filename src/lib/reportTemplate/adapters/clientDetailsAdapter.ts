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
import { buildClientDetails, composeClientName } from '@/lib/reports/clientDetails/normalise.pure';
import { applyClientDetailsProjection } from '../../../../supabase/functions/_shared/clientDetailsProjection.pure';
import { CLIENT_NAME_COLUMNS } from '../../../../supabase/functions/_shared/clientName';
import { applyOrganisationAndBrand } from './organisation';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
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

/**
 * The columns a name is composed from, for the two reads that only need one.
 *
 * `CLIENT_NAME_COLUMNS` is the sanctioned spelling of the four name columns
 * and is used rather than restated — this function shipped selecting
 * `first_name, last_name`, and **neither column exists on `clients`**, so
 * PostgREST answered `42703` for the whole statement, the error branch
 * returned null, and routing declined every client in the database while
 * `buildBindingContext` (which selects `*`) worked in every harness. The same
 * misspelling 404'd `render-borrowing-capacity-pdf` for every client once
 * before, which is why that constant exists.
 *
 * The middle names are added on top of it: the document composes its subject's
 * name from all three parts, and this read exists to say what the document
 * will say. They are not in the shared constant because
 * `clientDisplayName` — the Borrowing Capacity Snapshot's cover — deliberately
 * prints two parts, and widening the constant would quietly change what a
 * different format's caller receives.
 */
const NAME_COLUMNS =
  `${CLIENT_NAME_COLUMNS}, primary_middle_name, secondary_middle_name`;

/**
 * The clients who have any financial record at all, for the picker's ordering.
 *
 * Five reads of one column each, against the five sparse tables — 794 rows in
 * total today, resolving to 34 distinct clients. A table this caller cannot
 * read contributes nothing rather than failing the list: the ordering is a
 * preference, and a picker ordered by recency is still a picker.
 *
 * The identifiers are capped before they become an `.in(...)` filter, because
 * that clause is a query string and an unbounded one is a 414 rather than a
 * slow request. At the current size the cap is never reached; it is here so
 * that the day these tables fill, the picker degrades to "the first 200
 * clients with records" instead of failing outright.
 */
const MAX_RECORDED_IDS = 200;

async function clientIdsWithRecords(): Promise<string[]> {
  const [properties, assets, liabilities, employment, expenses] = await Promise.all([
    supabase.from('client_properties').select('client_id'),
    supabase.from('client_assets').select('client_id'),
    supabase.from('client_liabilities').select('client_id'),
    supabase.from('client_employment').select('client_id'),
    supabase.from('client_expenses').select('client_id'),
  ]);

  const ids = new Set<string>();
  for (const res of [properties, assets, liabilities, employment, expenses]) {
    if (res.error || !res.data) continue;
    for (const row of res.data as Array<{ client_id?: unknown }>) {
      if (typeof row.client_id === 'string' && row.client_id) ids.add(row.client_id);
    }
  }
  return [...ids].slice(0, MAX_RECORDED_IDS);
}

/** Just the client row, for routing — nine reads to decide a title is waste. */
async function loadClientRow(clientId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('clients')
    .select(`${NAME_COLUMNS}, updated_at, created_at`)
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

  /**
   * Recent clients, the ones with something to show first.
   *
   * Ordering by `updated_at` alone made this picker nearly useless for its own
   * purpose. **34 of the 775 clients have any property, asset, liability,
   * employment or expense record at all**, so twenty of the most recently
   * touched are twenty documents of empty tables — and the whole reason to
   * preview against a real record is to see how the design holds your own
   * numbers.
   *
   * It is not sorted *entirely* by that, because a client with a name and
   * nothing else is not an edge case in this format, it is the ordinary one
   * (see D5 in `docs/reports/CLIENT_DETAILS.md`) and the masters are built
   * around it. So most of the list is clients with records and the rest is
   * whatever is most recent, which keeps both shapes one click away.
   */
  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      const listing = (row: Record<string, any>): ReportListing => ({
        id: String(row.id),
        // The document's own name for its subject, so the picker and the page
        // it renders agree.
        label: composeClientName(row),
        savedAt: (row.updated_at as string) ?? (row.created_at as string) ?? null,
      });

      const recorded = await clientIdsWithRecords();
      const withRecords: Record<string, any>[] = [];
      if (recorded.length > 0) {
        const { data } = await supabase
          .from('clients')
          .select(`${NAME_COLUMNS}, updated_at, created_at`)
          .in('id', recorded)
          .order('updated_at', { ascending: false })
          .limit(Math.max(1, Math.floor(limit * 0.75)));
        withRecords.push(...((data ?? []) as Record<string, any>[]));
      }

      const { data: recent, error } = await supabase
        .from('clients')
        .select(`${NAME_COLUMNS}, updated_at, created_at`)
        .order('updated_at', { ascending: false })
        .limit(limit);
      // The recorded half is a preference, not a requirement: if that read
      // failed there is still a picker, and if this one failed there is not.
      if (error && withRecords.length === 0) return [];

      const out: ReportListing[] = [];
      const seen = new Set<string>();
      for (const row of [...withRecords, ...((recent ?? []) as Record<string, any>[])]) {
        const id = String(row.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(listing(row));
        if (out.length >= limit) break;
      }
      return out;
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadClientRow(reportId);
    if (!row) return null;
    // The document's own composition, not a second one: the middle name the
    // eleven records that carry one print, the household's `A & B` for the
    // thirteen that describe two people, and the same casing. A file titled
    // for a different person than the pages name is a small wrong that is
    // very visible on a document sent to a broker.
    const name = composeClientName(row);
    return {
      reportId,
      reportType: 'client_details',
      variant: null,
      tier: null,
      title: name !== 'Client' ? `Client details — ${name}` : 'Client details',
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
    await applyOrganisationAndBrand(data);

    return {
      data,
      meta: { reportId, reportType: 'client_details', variant: null, tier: null },
    };
  },
};
