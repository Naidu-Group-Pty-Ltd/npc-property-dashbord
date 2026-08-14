/**
 * The reviewed projection, in the shape the template projection reads.
 *
 * ## Why this exists
 *
 * The 10 Year Cash Flow's contract (`docs/reports/CASH_FLOW.md`) puts the
 * arithmetic in the browser: the adviser overrides any of ten fields in any of
 * ten years, live, and the document must state the series they just reviewed.
 * The template adapter, like every adapter, reads the *stored* record — so a
 * chosen template applied only when the screen happened to equal the store,
 * which for this format is the exception. Every other download quietly fell
 * back to the standard layout, and the choice the picker promised was kept
 * changed nothing.
 *
 * This module is the bridge: it converts the same `WireProjection` the server
 * composer receives into a row shaped like `investment_reports`, so
 * `projectCashFlow` — the format's one projection producer — can publish the
 * reviewed series under the exact vocabulary every master binds. One producer,
 * two sources, zero duplicated derivations.
 *
 * ## The three rules
 *
 * - **Validated like a stored row, refused like one.** A year missing any of
 *   the five fields the series is drawn from returns null, and the caller
 *   falls back to the composer — which runs the same class of validation
 *   server-side. An unresolved binding renders as the empty string, so a
 *   half-shaped series would print blank cells in a client's table rather
 *   than failing.
 * - **The headline figure is the composer's headline figure.** `cashFlow` maps
 *   from `afterTaxAnnual`, because the composer's opening sentence — the first
 *   thing a client reads — is the after-tax weekly position. A templated
 *   document and a composed document of the same projection must lead with the
 *   same number.
 * - **No scenario is claimed that the series does not satisfy.** The stored
 *   scenarios are exact 2/4/6% growth ladders; a reviewed series is whatever
 *   the adviser made it. It is published as `reviewed` / "Adviser-reviewed",
 *   and the stored-scenario side-by-side blocks are withheld — a comparison
 *   of one column labelled "Moderate" would be a claim, not a comparison.
 */
import {
  applyCashFlowProjection,
  type ScenarioName,
} from '../../../../supabase/functions/_shared/cashFlowProjection.pure';
import type { WireProjection } from './requestCashFlowPdf';

/** The scenario key the reviewed series is stored under, inside the pseudo-row. */
const CARRIER_SCENARIO: ScenarioName = 'moderate';

const finiteOrNull = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The wire's years in the stored-series vocabulary, or null when any year is
 * not whole enough to draw.
 */
export function wireYearsAsStoredSeries(
  wire: WireProjection,
): Array<Record<string, number>> | null {
  const years = Array.isArray(wire?.years) ? wire.years : [];
  if (!years.length) return null;

  let cumulative = 0;
  const out: Array<Record<string, number>> = [];
  for (const raw of years) {
    const year = finiteOrNull(raw?.year);
    const propertyValue = finiteOrNull(raw?.propertyValue);
    const loanBalance = finiteOrNull(raw?.loanBalance);
    const annualRent = finiteOrNull(raw?.rentalIncome);
    const cashFlow = finiteOrNull(raw?.afterTaxAnnual);
    if (year === null || propertyValue === null || loanBalance === null
      || annualRent === null || cashFlow === null) {
      return null;
    }
    cumulative += cashFlow;
    out.push({
      year,
      propertyValue,
      loanBalance,
      // Derived the way the stored series derives it, so the equity column and
      // the value/balance columns cannot disagree.
      equity: propertyValue - loanBalance,
      annualRent,
      cashFlow,
      cumulativeCashFlow: cumulative,
    });
  }
  return out;
}

export interface LiveProjectionSource {
  /** The row the document is about — for its id, address and timestamps. */
  reportId: string;
  propertyAddress?: string | null;
  /**
   * The stored scenario this series was proved to equal, when it was.
   *
   * Present only when `matchStoredScenario` named one, so the document may
   * honestly print "Moderate". Absent means the adviser shaped the series by
   * hand and it is labelled "Adviser-reviewed" — never a scenario name the
   * numbers do not satisfy.
   */
  scenario?: string | null;
}

/**
 * A row `projectCashFlow` can read, carrying the reviewed series.
 *
 * Null when the wire cannot be drawn — the refusal, not an empty document.
 */
export function wireAsProjectionRow(
  wire: WireProjection,
  source: LiveProjectionSource,
): Record<string, unknown> | null {
  const series = wireYearsAsStoredSeries(wire);
  if (!series) return null;
  return {
    id: source.reportId,
    property_address: source.propertyAddress ?? null,
    financial_calculations: {
      projections: { [CARRIER_SCENARIO]: series },
    },
  };
}

/**
 * Publish the reviewed series into a binding context.
 *
 * `projectCashFlow` runs over the pseudo-row exactly as it runs over a stored
 * one — same derivations, same vocabulary — and then the scenario claim is
 * corrected: the carrier key was only ever a vehicle, and a document must not
 * say "Moderate" about a series the adviser shaped by hand. `basis` (growth
 * rates read off the series itself) survives because it is an observation;
 * `scenarios` and `scenarioBasis` (the stored three-way comparison) are
 * withheld because there is nothing to compare.
 */
export function applyLiveCashFlowProjection(
  data: Record<string, any>,
  row: Record<string, unknown>,
  scenario?: string | null,
): Record<string, any> {
  applyCashFlowProjection(data, row, CARRIER_SCENARIO);
  const cashflow = data.cashflow;
  if (cashflow && typeof cashflow === 'object') {
    // A proved scenario keeps its own name; anything else is the adviser's.
    const proved = typeof scenario === 'string' && scenario.trim() ? scenario.trim() : null;
    cashflow.scenario = proved ?? 'reviewed';
    cashflow.scenarioLabel = proved
      ? proved.charAt(0).toUpperCase() + proved.slice(1)
      : 'Adviser-reviewed';
    // The stored three-way comparison is withheld either way: only the series
    // on screen was reviewed, and the other two are not in this payload.
    delete cashflow.scenarios;
    delete cashflow.scenarioBasis;
  }
  return data;
}
