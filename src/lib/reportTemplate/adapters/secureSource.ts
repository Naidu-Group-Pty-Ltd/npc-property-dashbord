/**
 * The authenticated read an adapter has to make, and the trap it exists to
 * close.
 *
 * ## The defect this module is the fix for
 *
 * Command Centre identity is a **custom HttpOnly-cookie session**, not a
 * Supabase Auth session. `src/integrations/supabase/client.ts` says so in its
 * own header and creates the client with `persistSession: false` and the anon
 * key — so in the browser `auth.uid()` is **always NULL**.
 *
 * Three of the tables the report adapters read have exactly one non-service
 * SELECT policy, and it is gated on `auth.uid()`:
 *
 * | Table | Policy |
 * | --- | --- |
 * | `investment_reports` | `generated_by = auth.uid()` OR a client join on `auth.uid()` |
 * | `property_comparisons` | `user_id = auth.uid()` |
 * | `clients` | `created_by = auth.uid()` |
 *
 * A `supabase.from(...)` read of any of them from the browser therefore
 * returns **zero rows for every record and every user** — not an error, an
 * empty result. The adapters read `maybeSingle()` and answered `null`, the
 * router read `null` as "this adapter refuses this record", and the caller
 * fell through to the legacy generator. So a person could choose a template,
 * be told the choice was kept, and receive the standard layout every single
 * time — which is what "the final render doesn't follow the template" was.
 *
 * It also explains `docs/reports/COVERAGE.md`: the design system rendered
 * 0.14% of documents, and the one format that ever rendered
 * (`investment_compass`) is the one whose adapter already read through a
 * broker.
 *
 * ## The rule
 *
 * **An adapter never reads a record through the browser client.** Every read
 * goes through an edge function that holds a service-role client and scopes
 * the read to the verified session user — the same treatment every other data
 * path in this app already gets. Two existing brokers cover all three tables,
 * so this adds no new surface and no new authorisation decision:
 *
 * - `get-investment-reports` — `investment_reports` (the `detail` projection,
 *   which carries `financial_calculations`) and `property_comparisons`.
 *   Permission-gated on the `reports` module.
 * - `get-client-data` — `clients` and every `client_*` child in one call,
 *   authorised per client by `canAccessClient`.
 *
 * `adapterSourceReadable.spec.ts` holds the list of invisible tables against
 * the adapters, so a tenth format cannot reintroduce this by reading one of
 * them directly.
 *
 * ## Every failure is still null
 *
 * A refused read, a 404, a broker that is not deployed: all answer `null`, and
 * the caller's next line is the generator that has produced this document for
 * the life of the product. This module never throws.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';

/**
 * Tables whose only non-service SELECT policy is `auth.uid()`-gated, and which
 * are therefore invisible to the browser client under this app's custom auth.
 *
 * Exported so the enforcement spec can assert no adapter reads one directly.
 * Measured against `pg_policies` in production on 2026-08-14.
 */
export const BROWSER_INVISIBLE_TABLES = [
  'investment_reports',
  'property_comparisons',
  'clients',
] as const;

/**
 * One investment report, with `financial_calculations` — the `detail`
 * projection, which `reportId` selects on its own.
 */
export async function loadInvestmentReportRow(
  reportId: string,
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'investment_reports',
      reportId,
    } as any);
    if (error) return null;
    return ((data as any)?.report as Record<string, any>) ?? null;
  } catch {
    return null;
  }
}

/**
 * Recent investment reports, for a picker.
 *
 * The list projection, which omits the heavy blobs by design — a caller that
 * needs `financial_calculations` asks for one report by id.
 */
export async function listInvestmentReportRows(
  limit = 20,
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'investment_reports',
      listMode: true,
      listOptions: { page: 1, pageSize: Math.min(Math.max(limit, 1), 200) },
    } as any);
    if (error) return [];
    const rows = (data as any)?.reports;
    return Array.isArray(rows) ? rows as Record<string, any>[] : [];
  } catch {
    return [];
  }
}

/** One saved property comparison. */
export async function loadPropertyComparisonRow(
  comparisonId: string,
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'property_comparisons',
      reportId: comparisonId,
    } as any);
    if (error) return null;
    return ((data as any)?.report as Record<string, any>) ?? null;
  } catch {
    return null;
  }
}

/**
 * What a client-shaped document needs from a client, in one authorised call.
 *
 * The flags mirror `get-client-data`'s own `include` map. Asking for only what
 * the format binds keeps this from pulling a client's whole file to print a
 * cover: the broker runs one query per included relation.
 */
export interface ClientRecordIncludes {
  properties?: boolean;
  income?: boolean;
  incomeSources?: boolean;
  expenses?: boolean;
  assets?: boolean;
  liabilities?: boolean;
  employment?: boolean;
  addressHistory?: boolean;
}

/**
 * One client and the relations asked for.
 *
 * Returns the broker's flat single-client response — `{ client, properties,
 * income, … }` — or null when the client is not accessible, which the broker
 * answers as a 404 rather than as an empty row, deliberately (it refuses to be
 * an id oracle).
 */
export async function loadClientRecord(
  clientId: string,
  include: ClientRecordIncludes = {},
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await invokeSecureFunction('get-client-data', {
      clientId,
      include,
    } as any);
    if (error) return null;
    const payload = data as Record<string, any> | null;
    if (!payload || payload.success !== true) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Just the client row, for the formats that print a name and nothing more. */
export async function loadClientRow(clientId: string): Promise<Record<string, any> | null> {
  const record = await loadClientRecord(clientId);
  return (record?.client as Record<string, any>) ?? null;
}

/**
 * Clients for a picker, ordered by the caller's column.
 *
 * The broker scopes the list to what this user may see (own or assigned)
 * unless they may see all, which is the same rule the Clients page gets.
 */
export async function listClientRows(
  options: { select?: string; orderBy?: string; limit?: number } = {},
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await invokeSecureFunction('get-client-data', {
      listMode: true,
      listOptions: {
        select: options.select ?? '*',
        orderBy: options.orderBy ?? 'updated_at',
        orderAsc: false,
        ...(options.limit ? { limit: options.limit } : {}),
      },
    } as any);
    if (error) return [];
    const rows = (data as any)?.clients;
    return Array.isArray(rows) ? rows as Record<string, any>[] : [];
  } catch {
    return [];
  }
}

/**
 * Several clients by id, for labelling a list of records that each name one.
 *
 * One list call, indexed here, rather than one call per id: a picker of twenty
 * assessments would otherwise make twenty edge requests to write twenty
 * labels. The broker's `clientIds` parameter is deliberately not used — it
 * refuses the *whole* request when any single id is inaccessible, because it
 * will not be an id oracle, so one stranger's record would cost every label.
 *
 * An id outside the page simply has no entry, and the caller falls back to its
 * generic label: a picker missing one name is a picker, a picker that failed
 * is not.
 */
export async function loadClientRowsByIds(
  clientIds: readonly string[],
  select?: string,
): Promise<Map<string, Record<string, any>>> {
  const wanted = new Set(clientIds.filter(Boolean));
  const out = new Map<string, Record<string, any>>();
  if (!wanted.size) return out;
  const rows = await listClientRows({
    select: select ? `id, ${select}` : '*',
    limit: 200,
  });
  for (const row of rows) {
    const id = String(row.id ?? '');
    if (id && wanted.has(id)) out.set(id, row);
  }
  return out;
}

/** Recent saved comparisons, for a picker. */
export async function listPropertyComparisonRows(
  limit = 20,
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'property_comparisons',
      listMode: true,
      listOptions: { page: 1, pageSize: Math.min(Math.max(limit, 1), 200) },
    } as any);
    if (error) return [];
    const rows = (data as any)?.reports;
    return Array.isArray(rows) ? rows as Record<string, any>[] : [];
  } catch {
    return [];
  }
}
