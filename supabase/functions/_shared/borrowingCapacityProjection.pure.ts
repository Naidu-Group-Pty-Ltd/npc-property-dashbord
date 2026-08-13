/**
 * Project a stored `borrowing_capacity_assessments` row into the binding
 * vocabulary a Borrowing Capacity Snapshot template uses.
 *
 * ## Read from the table, not from a summary of it
 *
 * `docs/reports/BORROWING_CAPACITY.md` records what happens when this is done
 * from memory: four drafts of that format's test fixture invented shapes —
 * `source` for `component`, `liability` for `type`, a percentage where the code
 * wanted a 0–1 fraction, an `lmi_mode` of `capitalised` where the column holds
 * `debt_capitalised` — "and every one produced a page of plausible-looking
 * wrong output". So every shape below was read off the live table across all
 * 143 assessments rather than inferred:
 *
 *  - `income_breakdown` is an **array** of `{ component, grossAmount,
 *    shadedAmount, shadingRate }`. Present on 140 of 143.
 *  - `liability_breakdown` is an **array** of `{ type, balance, limit,
 *    monthlyServicing }`. Present on 117 of 143.
 *  - `expense_breakdown` is an **object** of `{ declaredExpenses, hemBenchmark }`.
 *  - `recommendations` is an **array of plain strings**, on all 143.
 *  - `warnings` is a Postgres `text[]`, non-empty on 41.
 *  - `assumptions` is an object carrying `selectedLenderName`, `calculationMode`,
 *    `dtiCapEnabled`, `dtiCapLimit`, `isFirstHomeBuyer`, `lmiMode`,
 *    `lmiDepositAmount`, `lmiPropertyValue`, `proposedRentalIncome`.
 *  - `explanation` is **null on every row**, so the format's "How this was
 *    calculated" page has no source. It is not projected, and a template that
 *    wants that page must make it conditional.
 *
 * ## Units
 *
 * Rates are stored as whole-number percent, measured across all 143 rows:
 * `interest_rate_used` 2.5–6.5, `assessment_rate` 5.5–9.5, `buffer_rate` 0–3,
 * `proposed_lvr` 80, `dti_ratio` 0–11.9. The `percent` filter formats without
 * multiplying, so they pass through untouched. `dti_ratio` is a **multiple**
 * (×11.9 of income), not a percentage — it is projected as a number and should
 * be set with `| fixed` rather than `| percent`.
 *
 * Monetary columns are dollars. `living_expenses_monthly` and
 * `existing_commitments_monthly` are **monthly**, and the annualised forms below
 * are `× 12` — arithmetic, not a model.
 *
 * ## What is deliberately absent
 *
 *  - `net_purchase_capacity` is populated on **3 of 143**, so it is emitted only
 *    when present rather than defaulted to zero. Zero would read as "you can
 *    buy nothing", which is a different claim from "not calculated".
 *  - `explanation.*` — null on every row, as above.
 *
 * ## The applicants
 *
 * `client.*` used to be absent for the reason above — the row carries
 * `client_id` and not a name, and guessing one is not this module's job. The
 * caller does the join and hands the names in, which is the arrangement
 * `comparisonProjection` already uses.
 *
 * It is worth doing here in a way it was not for the investment reports: all
 * **143 of 143** assessments carry a `client_id` that resolves to a real
 * `clients` row, and all 143 of those carry both a first name and a surname.
 *
 * The name itself comes from `clientName.ts` rather than being formatted here.
 * That module already owns the four columns the table actually has — the two
 * legacy routes each invented their own spelling and one of them 404'd every
 * client in the database — and it already decides that the document names the
 * **primary** applicant, falling back to the secondary, because the Snapshot's
 * filename is built from the same call. 33 of the 143 are joint; naming both
 * here would put a different name on the cover from the one on the file.
 */

import { clientDisplayName, type ClientNameRow } from './clientName.ts';

export interface BorrowingCapacityRowLike {
  gross_annual_income?: number | string | null;
  shaded_annual_income?: number | string | null;
  income_breakdown?: unknown;
  living_expenses_monthly?: number | string | null;
  expense_method?: string | null;
  expense_breakdown?: unknown;
  existing_commitments_monthly?: number | string | null;
  liability_breakdown?: unknown;
  interest_rate_used?: number | string | null;
  buffer_rate?: number | string | null;
  assessment_rate?: number | string | null;
  loan_term_years?: number | string | null;
  proposed_loan_amount?: number | string | null;
  proposed_lvr?: number | string | null;
  borrowing_capacity?: number | string | null;
  monthly_surplus?: number | string | null;
  serviceability_band?: string | null;
  stress_tested_capacity?: number | string | null;
  dti_ratio?: number | string | null;
  recommendations?: unknown;
  warnings?: unknown;
  assumptions?: unknown;
  lmi_amount?: number | string | null;
  lmi_mode?: string | null;
  lmi_lvr_trigger?: number | string | null;
  property_value_estimate?: number | string | null;
  deposit_amount?: number | string | null;
  net_purchase_capacity?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [k: string]: unknown;
}

const MONTHS_PER_YEAR = 12;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function strList(v: unknown): string[] {
  return arr(v).map((x) => str(x)).filter((x): x is string => !!x);
}

/** Assign only defined values, so an absent source stays an absent binding. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

export interface ProjectedBorrowingCapacity {
  capacity: Record<string, unknown>;
  income: Record<string, unknown>;
  expenses: Record<string, unknown>;
  liabilities: Record<string, unknown>;
  loan: Record<string, unknown>;
  lmi: Record<string, unknown>;
  assumptions: Record<string, unknown>;
  recommendations: string[];
  warnings: string[];
  report: Record<string, unknown>;
}

export function projectBorrowingCapacity(row: BorrowingCapacityRowLike): ProjectedBorrowingCapacity {
  const assumptions = obj(row.assumptions);
  const expenseBreakdown = obj(row.expense_breakdown);

  const monthlyExpenses = num(row.living_expenses_monthly);
  const monthlyCommitments = num(row.existing_commitments_monthly);

  // ── capacity ──────────────────────────────────────────────────────────────
  const capacity: Record<string, unknown> = {};
  put(capacity, 'borrowing', num(row.borrowing_capacity));
  put(capacity, 'stressTested', num(row.stress_tested_capacity));
  // 3 of 143 rows carry this. Absent is not zero.
  put(capacity, 'netPurchase', num(row.net_purchase_capacity));
  put(capacity, 'monthlySurplus', num(row.monthly_surplus));
  put(capacity, 'annualSurplus', monthlySurplusAnnual(row));
  put(capacity, 'band', str(row.serviceability_band));
  put(capacity, 'bandLabel', bandLabel(str(row.serviceability_band)));
  // A multiple of income, not a percentage. Set it with `| fixed`.
  put(capacity, 'dti', num(row.dti_ratio));
  put(capacity, 'depositAmount', num(row.deposit_amount));
  put(capacity, 'propertyValueEstimate', num(row.property_value_estimate));

  // ── income ────────────────────────────────────────────────────────────────
  const income: Record<string, unknown> = {};
  const gross = num(row.gross_annual_income);
  const shaded = num(row.shaded_annual_income);
  put(income, 'gross', gross);
  put(income, 'shaded', shaded);
  // What the shading cost, stated rather than left for the reader to subtract.
  put(income, 'shadingApplied', gross !== undefined && shaded !== undefined ? gross - shaded : undefined);
  const items = arr(row.income_breakdown).map((raw) => {
    const it = obj(raw);
    const line: Record<string, unknown> = {};
    put(line, 'component', str(it.component));
    put(line, 'grossAmount', num(it.grossAmount));
    put(line, 'shadedAmount', num(it.shadedAmount));
    put(line, 'shadingRate', num(it.shadingRate));
    return line;
  }).filter((l) => Object.keys(l).length > 0);
  if (items.length) income.items = items;

  // ── expenses ──────────────────────────────────────────────────────────────
  const expenses: Record<string, unknown> = {};
  put(expenses, 'monthly', monthlyExpenses);
  put(expenses, 'annual', monthlyExpenses === undefined ? undefined : monthlyExpenses * MONTHS_PER_YEAR);
  put(expenses, 'method', str(row.expense_method));
  put(expenses, 'methodLabel', expenseMethodLabel(str(row.expense_method)));
  put(expenses, 'declared', num(expenseBreakdown.declaredExpenses));
  put(expenses, 'hemBenchmark', num(expenseBreakdown.hemBenchmark));

  // ── liabilities ───────────────────────────────────────────────────────────
  const liabilities: Record<string, unknown> = {};
  put(liabilities, 'monthly', monthlyCommitments);
  put(liabilities, 'annual', monthlyCommitments === undefined ? undefined : monthlyCommitments * MONTHS_PER_YEAR);
  const liabilityItems = arr(row.liability_breakdown).map((raw) => {
    const it = obj(raw);
    const line: Record<string, unknown> = {};
    put(line, 'type', str(it.type));
    put(line, 'balance', num(it.balance));
    put(line, 'limit', num(it.limit));
    put(line, 'monthlyServicing', num(it.monthlyServicing));
    return line;
  }).filter((l) => Object.keys(l).length > 0);
  if (liabilityItems.length) liabilities.items = liabilityItems;

  // ── loan ──────────────────────────────────────────────────────────────────
  const loan: Record<string, unknown> = {};
  put(loan, 'proposed', num(row.proposed_loan_amount));
  put(loan, 'lvr', num(row.proposed_lvr));
  put(loan, 'termYears', num(row.loan_term_years));
  put(loan, 'interestRate', num(row.interest_rate_used));
  put(loan, 'bufferRate', num(row.buffer_rate));
  put(loan, 'assessmentRate', num(row.assessment_rate));
  put(loan, 'lender', str(assumptions.selectedLenderName));

  // ── LMI (3 of 143 rows) ───────────────────────────────────────────────────
  const lmiMode = str(row.lmi_mode);
  const lmi: Record<string, unknown> = {};
  if (lmiMode && lmiMode !== 'none') {
    put(lmi, 'mode', lmiMode);
    put(lmi, 'amount', num(row.lmi_amount));
    put(lmi, 'lvrTrigger', num(row.lmi_lvr_trigger));
    put(lmi, 'depositAmount', num(assumptions.lmiDepositAmount));
    put(lmi, 'propertyValue', num(assumptions.lmiPropertyValue));
  }

  // ── stated assumptions ────────────────────────────────────────────────────
  const assumptionsOut: Record<string, unknown> = {};
  put(assumptionsOut, 'lender', str(assumptions.selectedLenderName));
  put(assumptionsOut, 'calculationMode', str(assumptions.calculationMode));
  put(assumptionsOut, 'dtiCapLimit', num(assumptions.dtiCapLimit));
  put(assumptionsOut, 'proposedRentalIncome', num(assumptions.proposedRentalIncome));
  if (typeof assumptions.dtiCapEnabled === 'boolean') assumptionsOut.dtiCapEnabled = assumptions.dtiCapEnabled;
  if (typeof assumptions.isFirstHomeBuyer === 'boolean') assumptionsOut.isFirstHomeBuyer = assumptions.isFirstHomeBuyer;

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(row.updated_at) ?? str(row.created_at));

  return {
    capacity,
    income,
    expenses,
    liabilities,
    loan,
    lmi,
    assumptions: assumptionsOut,
    recommendations: strList(row.recommendations),
    warnings: strList(row.warnings),
    report,
  };
}

function monthlySurplusAnnual(row: BorrowingCapacityRowLike): number | undefined {
  const m = num(row.monthly_surplus);
  return m === undefined ? undefined : m * MONTHS_PER_YEAR;
}

/**
 * The serviceability band, in words.
 *
 * The column holds `green` / `amber` / `red` across all 143 rows. Those are
 * fine as a state and wrong as a label on a client's page — "red" tells a reader
 * they have failed something without saying what.
 */
function bandLabel(band: string | undefined): string | undefined {
  switch (band) {
    case 'green': return 'Comfortable';
    case 'amber': return 'Serviceable with limited headroom';
    case 'red': return 'Constrained';
    default: return undefined;
  }
}

/** `declared` / `hem` are the two stored methods. */
function expenseMethodLabel(method: string | undefined): string | undefined {
  switch (method) {
    case 'declared': return 'Declared living expenses';
    case 'hem': return 'HEM benchmark';
    default: return undefined;
  }
}

/**
 * Merge the projection into a binding-context `data` object.
 *
 * `client` is supplied by the caller because the assessment row carries a
 * `client_id` and not a name; see the header. It is published only when there
 * is a name to publish, so a template binding `{{client.name}}` renders nothing
 * rather than a fragment when there is not — and, more to the point, an object
 * published with an empty string in it would make a page conditional on
 * `client` draw blank instead of dropping out.
 */
export function applyBorrowingCapacityProjection(
  data: Record<string, any>,
  row: BorrowingCapacityRowLike,
  client?: ClientNameRow | null,
): Record<string, any> {
  const p = projectBorrowingCapacity(row);
  const name = clientDisplayName(client);
  if (name) data.client = { ...obj(data.client), name };
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    data[key] = { ...obj(data[key]), ...extra };
  };
  merge('capacity', p.capacity);
  merge('income', p.income);
  merge('expenses', p.expenses);
  merge('liabilities', p.liabilities);
  merge('loan', p.loan);
  merge('lmi', p.lmi);
  merge('assumptions', p.assumptions);
  merge('report', p.report);
  if (p.recommendations.length) data.recommendations = p.recommendations;
  if (p.warnings.length) data.warnings = p.warnings;
  return data;
}
