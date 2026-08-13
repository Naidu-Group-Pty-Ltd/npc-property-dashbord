/**
 * Project a stored `investment_reports` row into the binding vocabulary the
 * seeded template catalogue actually uses.
 *
 * ## Why this exists
 *
 * The catalogue and the adapter disagreed about names, and nothing said so.
 * Measured against the 50 Investment Compass masters and 1,182 production
 * reports: **79 of their 80 bindings resolved to nothing**. The only survivor
 * was `property.zoning`, because that is the one key whose spelling happened to
 * match. Three independent causes:
 *
 *  - **Case.** Templates bind `property.yearBuilt`, `property.type`,
 *    `property.landArea`; `property_specs` stores `year_built`,
 *    `property_type`, `land_size_sqm`.
 *  - **Depth.** Templates bind `financials.grossYield` and
 *    `financials.weeklyRent`; the stored object nests those under
 *    `keyMetrics.grossRentalYield` and `income.weeklyRent`. The adapter's
 *    `flatten()` is `{ ...obj }` — a shallow spread that never flattened a path.
 *  - **Location.** Templates bind `property.address`; the adapter publishes it
 *    as `report.address`.
 *
 * This is why `docs/reports/COVERAGE.md` records **zero of 1,162 investment
 * reports** rendered by this system: the templates were never wrong-looking in
 * preview, because preview runs on `SAMPLE_REPORT_DATA`, which is written in
 * the catalogue's vocabulary rather than the database's.
 *
 * The projection is **additive**. Callers merge it over the raw namespaces, so
 * `property.year_built` and `financials.keyMetrics` keep working for anything
 * already bound to them.
 *
 * ## The rule this module is built on
 *
 * **Project what exists; leave absent what does not.** A key is emitted only
 * when its source is present, so an unmapped binding renders empty exactly as
 * it does today rather than printing a fabricated number. "A misread number in
 * a client's financial report is this programme's top risk" — inventing one is
 * strictly worse than leaving the line blank.
 *
 * Deliberately NOT projected, because no source exists in the row (verified
 * against production, not assumed — do not "helpfully" fill these in):
 *
 *  - `financials.breakEvenRent` — derivable in principle, but it is a NEW
 *    financial claim rather than a restatement of a stored one. It belongs in
 *    the calculator that owns the numbers, not in a display projection.
 *  - `financials.narrative`, `financials.fundingNote`, `summary.narrative`,
 *    `property.rationale` — prose with no dedicated column.
 *  - `market.*` — `location_intelligence` holds amenities, commute,
 *    coordinates, healthcare, lifestyle, schools, transport and walkScore. It
 *    carries no postcode, state, suburb count or market narrative.
 *  - `assumptions.rentalGrowth` — `assumptions` holds capitalGrowth, cpiGrowth
 *    and occupancyWeeks. CPI is not rental growth and must not stand in for it.
 *  - `assumptions.taxRate` — `cashFlow.taxRate` is null across the sample.
 *  - `assumptions.sellingCosts`, `financials.loanFees` — no source. (LMI is not
 *    a loan fee.)
 *  - `risks.N.why`, `risks.N.action`, `recommendation.rationale` —
 *    `investment_score.risks` is an array of plain **strings** and
 *    `investment_score.recommendation` is a single **string**. There is no
 *    second field to put in those columns.
 *  - `property.suburb`, `property.condition`, `property.tenancy` — no column.
 *    Suburb is parseable from the address string, and that is exactly the kind
 *    of guess that puts the wrong suburb on a client's report.
 *  - `org.*`, `author.*`, `client.*` — organisation and people data lives
 *    outside this row. A caller that has it should merge it in.
 *  - `property.images.*` — no adapter emits photographs; see
 *    `docs/template-library/07-investment-compass-families.md`.
 *
 * ## Units
 *
 * Percentages are stored as whole-number percent (gross yield 0–7.51, interest
 * rate 3.0–6.5, capital growth 0–26.6 across 400 sampled reports), and the
 * `percent` filter formats without multiplying (`6.5` → `"6.50%"`). So
 * percentages pass through untouched. Getting this backwards is a 100× error on
 * a client's financial report, which is why it was measured rather than
 * inferred.
 *
 * Weekly figures are `annual / 52` — a unit conversion, not a model. The one
 * modelled value is `annualRent`, which uses the report's own stated
 * `occupancyWeeks` rather than assuming 52.
 */

/** Loose row shape — the caller passes the `investment_reports` row as stored. */
export interface InvestmentReportRowLike {
  property_address?: string | null;
  property_specs?: Record<string, unknown> | null;
  financial_calculations?: Record<string, unknown> | null;
  investment_score?: Record<string, unknown> | null;
  updated_at?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
}

const WEEKS_PER_YEAR = 52;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** A finite number, or undefined. Strings are accepted because jsonb numerics arrive as either. */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** A non-empty trimmed string, or undefined. */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
}

/** Per-week from a per-year figure. Undefined in, undefined out. */
function weekly(annual: number | undefined): number | undefined {
  return annual === undefined ? undefined : annual / WEEKS_PER_YEAR;
}

/**
 * Assign only defined values.
 *
 * This is the whole "absent stays absent" rule in one function: writing
 * `undefined` onto the object would still create the key, and a template that
 * finds the key renders whatever it holds rather than falling through to empty.
 */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/** `3 bed · 2 bath · 1 car`, from whichever parts are present. */
function configuration(specs: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  const bed = num(specs.bedrooms);
  const bath = num(specs.bathrooms);
  const car = num(specs.parking);
  if (bed !== undefined) parts.push(`${bed} bed`);
  if (bath !== undefined) parts.push(`${bath} bath`);
  if (car !== undefined) parts.push(`${car} car`);
  return parts.length ? parts.join(' · ') : undefined;
}

export interface ProjectedNamespaces {
  property: Record<string, unknown>;
  financials: Record<string, unknown>;
  assumptions: Record<string, unknown>;
  recommendation: Record<string, unknown>;
  summary: Record<string, unknown>;
  risks: Record<string, unknown>[];
  report: Record<string, unknown>;
}

/**
 * Build the catalogue-vocabulary view of one stored report.
 *
 * Every namespace returned is partial by design; merge it over the raw ones.
 */
export function projectInvestmentReport(row: InvestmentReportRowLike): ProjectedNamespaces {
  const specs = obj(row.property_specs);
  const fin = obj(row.financial_calculations);
  const score = obj(row.investment_score);

  const initial = obj(fin.initialCosts);
  const income = obj(fin.income);
  const metrics = obj(fin.keyMetrics);
  const loan = obj(fin.loanDetails);
  const costs = obj(fin.annualCosts);
  const assumptions = obj(fin.assumptions);

  // ── property ──────────────────────────────────────────────────────────────
  const property: Record<string, unknown> = {};
  put(property, 'address', str(row.property_address));
  put(property, 'type', str(specs.property_type));
  put(property, 'yearBuilt', num(specs.year_built) ?? str(specs.year_built));
  put(property, 'landArea', num(specs.land_size_sqm));
  put(property, 'buildingArea', num(specs.building_size_sqm));
  put(property, 'zoning', str(specs.zoning));
  put(property, 'council', str(specs.council_area));
  put(property, 'configuration', configuration(specs));

  // ── financials ────────────────────────────────────────────────────────────
  const annualRates = num(costs.councilRates);
  const annualInsurance = num(costs.landlordInsurance);
  const annualManagement = num(costs.propertyManagement);
  const annualMaintenance = num(costs.maintenance);
  const weeklyRent = num(income.weeklyRent);
  const occupancyWeeks = num(assumptions.occupancyWeeks);
  const monthlyPayment = num(loan.monthlyPayment);

  const financials: Record<string, unknown> = {};
  put(financials, 'purchasePrice', num(initial.propertyValue));
  put(financials, 'stampDuty', num(initial.stampDuty));
  put(financials, 'legalFees', num(initial.legalFees));
  put(financials, 'inspectionFees', num(initial.inspectionFees));
  put(financials, 'totalCost', num(initial.totalUpfront));
  put(financials, 'deposit', num(initial.deposit));
  put(financials, 'loanAmount', num(loan.loanAmount) ?? num(initial.loanAmount));
  put(financials, 'weeklyRent', weeklyRent);
  // The report's own occupancy assumption, not a flat 52 weeks.
  put(financials, 'annualRent', weeklyRent !== undefined && occupancyWeeks !== undefined
    ? weeklyRent * occupancyWeeks
    : undefined);
  put(financials, 'grossYield', num(metrics.grossRentalYield));
  put(financials, 'netYield', num(metrics.netRentalYield));
  put(financials, 'cashOnCash', num(metrics.cashOnCashReturn));
  put(financials, 'weeklyNet', num(metrics.weeklyNet));
  put(financials, 'annualNet', num(metrics.annualNet));
  put(financials, 'lvr', num(metrics.lvr) ?? num(loan.lvr));
  put(financials, 'totalInvestment', num(metrics.totalInvestment));
  put(financials, 'weeklyRepayment', num(loan.weeklyPayment));
  put(financials, 'annualRepayment', monthlyPayment === undefined ? undefined : monthlyPayment * 12);
  put(financials, 'annualRates', annualRates);
  put(financials, 'weeklyRates', weekly(annualRates));
  put(financials, 'annualInsurance', annualInsurance);
  put(financials, 'weeklyInsurance', weekly(annualInsurance));
  put(financials, 'annualManagement', annualManagement);
  put(financials, 'weeklyManagement', weekly(annualManagement));
  put(financials, 'annualMaintenance', annualMaintenance);
  put(financials, 'weeklyMaintenance', weekly(annualMaintenance));
  put(financials, 'annualCosts', num(costs.totalAnnual));

  // ── assumptions ───────────────────────────────────────────────────────────
  const assumptionsOut: Record<string, unknown> = {};
  put(assumptionsOut, 'capitalGrowth', num(assumptions.capitalGrowth));
  put(assumptionsOut, 'interestRate', num(loan.interestRate));
  put(assumptionsOut, 'occupancyWeeks', occupancyWeeks);
  // Vacancy as whole-number percent, matching how every other rate is stored.
  put(assumptionsOut, 'vacancy', occupancyWeeks === undefined
    ? undefined
    : ((WEEKS_PER_YEAR - occupancyWeeks) / WEEKS_PER_YEAR) * 100);

  // ── verdict, risks, summary ───────────────────────────────────────────────
  // `investment_score.recommendation` is one string; there is no rationale
  // field, so `recommendation.rationale` stays absent rather than echoing the
  // headline back at the reader.
  const recommendation: Record<string, unknown> = {};
  put(recommendation, 'headline', str(score.recommendation));
  put(recommendation, 'grade', str(score.grade));
  put(recommendation, 'score', num(score.totalScore));

  const strengths = strArray(score.strengths);
  const weaknesses = strArray(score.weaknesses);
  const summary: Record<string, unknown> = {};
  if (strengths.length) summary.strength = strengths;
  if (weaknesses.length) summary.watch = weaknesses;

  // Objects rather than bare strings, because the catalogue binds `risks.N.risk`.
  const risks = strArray(score.risks).map((risk) => ({ risk }));

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(row.updated_at) ?? str(row.created_at));

  return { property, financials, assumptions: assumptionsOut, recommendation, summary, risks, report };
}

/**
 * Merge the projection over an existing binding-context `data` object.
 *
 * Raw namespaces win nothing and lose nothing: existing keys are preserved and
 * projected keys are layered on top, so `property.year_built` and
 * `property.yearBuilt` both resolve afterwards.
 */
export function applyInvestmentProjection(
  data: Record<string, any>,
  row: InvestmentReportRowLike,
): Record<string, any> {
  const p = projectInvestmentReport(row);
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    data[key] = { ...obj(data[key]), ...extra };
  };
  merge('property', p.property);
  merge('financials', p.financials);
  merge('assumptions', p.assumptions);
  merge('recommendation', p.recommendation);
  merge('summary', p.summary);
  merge('report', p.report);
  if (p.risks.length) data.risks = p.risks;
  return data;
}
