/**
 * Read one area's series from the open-data sales register.
 *
 * Not pure — it takes the service client — but thin: the lookup is by the
 * register's token (`salesAreaToken`), so the cadastre's council name and
 * the boundary service's postcode both resolve in one indexed read, and the
 * publisher's own label comes back on the rows for the adapter to print.
 * The state-wide series travels beside it for the benchmark points.
 *
 * A read that FAILED throws; an area the register does not hold answers no
 * rows — the two are different answers and the caller records them
 * differently (docs/aml/CASE_TENANT_COLUMN.md's rule).
 */
import { type SalesMedianRow, type SalesRegisterState, salesAreaToken } from './openData/salesRegister.pure.ts';

export interface SalesRegisterQuery {
  state: SalesRegisterState;
  areaKind: 'lga' | 'postcode';
  /** The caller's name for the area — a cadastre LGA or a postcode. */
  area: string;
}

export interface SalesRegisterRead {
  rows: SalesMedianRow[];
  benchmarkRows: SalesMedianRow[];
  /** The publisher's own label for the area, or null where nothing matched. */
  areaLabel: string | null;
  /** The newest load stamp on the rows, or null. */
  loadedAt: string | null;
}

/** The publisher's state-wide row, one per register. */
export const BENCHMARK_AREA: Record<SalesRegisterState, string> = {
  QLD: 'Total (all monitored regions)',
  NSW: 'New South Wales',
};

const SELECT = 'area, area_kind, dwelling_type, period, median_price, sales_count, loaded_at';

interface RegisterRow {
  area: string;
  area_kind: string;
  dwelling_type: string;
  period: string;
  median_price: number | string | null;
  sales_count: number | null;
  loaded_at: string | null;
}

function toRow(state: SalesRegisterState, r: RegisterRow): SalesMedianRow {
  return {
    state,
    areaKind: r.area_kind as SalesMedianRow['areaKind'],
    area: r.area,
    dwellingType: r.dwelling_type as SalesMedianRow['dwellingType'],
    period: r.period,
    medianPrice: r.median_price === null ? null : Number(r.median_price),
    salesCount: r.sales_count,
  };
}

// deno-lint-ignore no-explicit-any
export async function readSalesRegister(supabase: any, query: SalesRegisterQuery): Promise<SalesRegisterRead> {
  const token = salesAreaToken(query.areaKind, query.area);
  const { data, error } = await supabase
    .from('market_sales_medians')
    .select(SELECT)
    .eq('state', query.state)
    .eq('area_kind', query.areaKind)
    .eq('area_token', token)
    .limit(1000);
  if (error) throw new Error(`market_sales_medians read failed: ${error.message}`);
  const rows = ((data ?? []) as RegisterRow[]).map((r) => toRow(query.state, r));

  const { data: bench, error: benchError } = await supabase
    .from('market_sales_medians')
    .select(SELECT)
    .eq('state', query.state)
    .eq('area_kind', 'region')
    .eq('area', BENCHMARK_AREA[query.state])
    .limit(1000);
  if (benchError) throw new Error(`market_sales_medians benchmark read failed: ${benchError.message}`);
  const benchmarkRows = ((bench ?? []) as RegisterRow[]).map((r) => toRow(query.state, r));

  const loadedAt = ((data ?? []) as RegisterRow[]).reduce<string | null>(
    (latest, r) => (r.loaded_at && (!latest || r.loaded_at > latest) ? r.loaded_at : latest), null,
  );
  return { rows, benchmarkRows, areaLabel: rows[0]?.area ?? null, loadedAt };
}
