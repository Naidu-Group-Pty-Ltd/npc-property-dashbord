/**
 * Project a stored `portfolio_analysis_reports` row into the binding vocabulary
 * a Portfolio Performance Review template uses.
 *
 * ## Read from the table, not from a summary of it
 *
 * Every shape below was read off the live table across all 21 stored reports.
 * The prose in particular is not what its names suggest:
 * `analysis.executiveSummary` is an **object**, not a paragraph, and
 * `strategicRecommendations` is an object of four horizon buckets rather than a
 * list. Binding either as a string would have printed `[object Object]` on a
 * client's page — the modern equivalent of the "plausible-looking wrong output"
 * `docs/reports/BORROWING_CAPACITY.md` records.
 *
 *  - `portfolioMetrics` — totalValue, totalEquity, totalDebt, totalProperties,
 *    investmentCount, ownerOccupiedCount, rentalCount, averageLVR,
 *    averageYield, netMonthlyCashflow, totalMonthlyRentalIncome,
 *    totalMonthlyExpenses, personalExpenses, bestPerformer, worstPerformer.
 *  - `propertyAnalyses` — an **array** of per-property objects: address, value,
 *    loan, equity, lvr, grossYield, netMonthlyCashflow, annualCashflow,
 *    cashOnCashReturn, propertyType, lenderName, interestRate,
 *    ownershipPercentage, portfolioContribution, isOwnerOccupied.
 *
 *    Two things about that array are only visible from the data. **`lvr` and
 *    `grossYield` are numeric strings** — `"83.7"`, `"6.74"` — on all 66
 *    elements, so they are coerced rather than read; a projection that took
 *    them as numbers would publish nothing and blank two columns of the
 *    inventory. And **11 of the 66 have `netMonthlyCashflow`, `annualCashflow`
 *    and `monthlyRentalIncome` all JSON null** (owner-occupied holdings with no
 *    rental data). Those stay absent. `$0` a month is a claim, and it is the
 *    wrong one.
 *  - `analysis.executiveSummary` — `{ healthScore, overallHealth, keyStrengths,
 *    keyConcerns, primaryRecommendation }`, where the two `key*` fields are
 *    arrays of strings and `primaryRecommendation` is a string.
 *  - `analysis.financialHealth` — `{ analysis, cashflowStatus,
 *    debtServiceability, equityPosition, lvrRisk }`, all strings.
 *  - `analysis.riskAssessment` — `{ overallRiskLevel, concentrationRisk,
 *    vacancyRisk, interestRateSensitivity }` as strings, plus `marketRisks`
 *    (2-4) and `mitigationStrategies` (4-5) as **arrays** of strings. Nothing
 *    in the names says which is which; this was read off the table.
 *  - `analysis.strategicRecommendations` — `{ priorityActions, shortTerm,
 *    mediumTerm, longTerm }`, **all four arrays** of strings, 3-4 and 1-4.
 *  - `bestPerformer` / `worstPerformer` are whole property rows **or null**, so
 *    they are projected only when present.
 *
 * ## Units
 *
 * Measured across all 21 reports: `average_lvr` 33.17–86.57 and `average_yield`
 * 4.24–10.35 are whole-number percent, and the `percent` filter formats without
 * multiplying, so they pass through untouched. `health_score` is 25–90 — a score
 * **out of 100**, not a percentage; it is projected as a number and labelled
 * "/100" rather than set with `| percent`.
 *
 * ## What is deliberately absent
 *
 *  - `client.*` beyond the stored `client_name`. The row has `client_id`;
 *    resolving a contact is a join the caller can do.
 *  - `analysis.personalizedNarrative` and the other prose objects whose internal
 *    shape is not asserted here — projected only where the leaf is a string, so
 *    an object never reaches a template as `[object Object]`.
 */

export interface PortfolioRowLike {
  client_name?: string | null;
  health_score?: number | string | null;
  overall_health?: string | null;
  portfolio_value?: number | string | null;
  total_equity?: number | string | null;
  net_monthly_cashflow?: number | string | null;
  total_properties?: number | string | null;
  average_lvr?: number | string | null;
  average_yield?: number | string | null;
  report_data?: unknown;
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

/** A string, and only a string. An object here would print `[object Object]`. */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function strList(v: unknown): string[] {
  return arr(v).map((x) => str(x)).filter((x): x is string => !!x);
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/** One row of the property inventory. */
function projectProperty(raw: unknown): Record<string, unknown> {
  const p = obj(raw);
  const line: Record<string, unknown> = {};
  put(line, 'address', str(p.address));
  put(line, 'propertyType', str(p.propertyType));
  put(line, 'value', num(p.value));
  put(line, 'loan', num(p.loan));
  put(line, 'equity', num(p.equity));
  put(line, 'lvr', num(p.lvr));
  put(line, 'grossYield', num(p.grossYield));
  put(line, 'monthlyRentalIncome', num(p.monthlyRentalIncome));
  put(line, 'monthlyExpenses', num(p.monthlyExpenses));
  put(line, 'netMonthlyCashflow', num(p.netMonthlyCashflow));
  put(line, 'annualCashflow', num(p.annualCashflow));
  put(line, 'cashOnCashReturn', num(p.cashOnCashReturn));
  put(line, 'interestRate', num(p.interestRate));
  put(line, 'lenderName', str(p.lenderName));
  put(line, 'ownershipPercentage', num(p.ownershipPercentage));
  put(line, 'portfolioContribution', num(p.portfolioContribution));
  if (typeof p.isOwnerOccupied === 'boolean') line.isOwnerOccupied = p.isOwnerOccupied;
  return line;
}

/** A best/worst performer, which is a whole property row or null. */
function projectPerformer(raw: unknown): Record<string, unknown> {
  const p = obj(raw);
  const out: Record<string, unknown> = {};
  put(out, 'address', str(p.address));
  put(out, 'propertyType', str(p.property_type) ?? str(p.propertyType));
  put(out, 'value', num(p.value));
  put(out, 'netMonthlyCashflow', num(p.net_monthly_cashflow) ?? num(p.netMonthlyCashflow));
  put(out, 'lender', str(p.lender_name) ?? str(p.lenderName));
  return out;
}

/**
 * The voice catalogue's own portfolio vocabulary.
 *
 * `portfolio-review` is a shipping template that predates all of this and binds
 * `portfolio.count`, `portfolio.lvr`, `portfolio.holdings.0.net` and so on. It
 * carries `report_type: 'portfolio'`, so the moment this format gained an
 * adapter it became production-ready — and a production-ready template bound to
 * a vocabulary nothing publishes renders a client's portfolio as blanks. That is
 * the exact defect `docs/reports/COVERAGE.md` records against the Compass
 * masters, and flipping the switch without this would have reintroduced it.
 *
 * Only mechanical restatements are published here. `lvr` and `grossYield` are
 * ratios of two stored totals, which is arithmetic rather than estimation;
 * `holdings` is `propertyAnalyses` under the older key names.
 *
 * Four leaves the template binds are deliberately left unresolved, because the
 * stored analysis has no counterpart and a plausible-looking guess on a client's
 * page is worse than a gap:
 *
 *  - `portfolio.growth12m` — no growth series is stored at portfolio level.
 *  - `portfolio.scores.*` — four rated category notes the analysis never writes.
 *  - `portfolio.recommendation.{headline,body}` — the analysis has one
 *    recommendation string, not a headline and a body, and splitting one into
 *    two invents an emphasis nobody wrote.
 *  - `portfolio.actions.*.{owner,timing}` — `priorityActions` is a list of
 *    strings with no owner and no due date attached.
 *
 * `portfolio-comparison` also carries `report_type: 'portfolio'` and binds
 * `drag.*`, `ranking.*` and `equity.*` — per-property growth, maintenance
 * history and equity-release scenarios. None of that is in
 * `portfolio_analysis_reports` at all, so it stays a preview-only document in
 * practice whatever the card says.
 */
function voiceAliases(
  metrics: Record<string, unknown>,
  exec: Record<string, unknown>,
  fin: Record<string, unknown>,
  recs: Record<string, unknown>,
  properties: Record<string, unknown>[],
  totals: { value?: number; debt?: number; monthlyRentalIncome?: number; annualCashflow?: number },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'count', num(metrics.totalProperties));
  put(out, 'netCashFlow', totals.annualCashflow);

  if (totals.value) {
    put(out, 'lvr', totals.debt === undefined ? undefined : (totals.debt / totals.value) * 100);
    // Weighted on value, which is what "gross yield" means for a portfolio and
    // is not the same number as `averageYield` (the mean of the per-property
    // yields). Both are correct; publishing the mean under this name would be
    // quietly answering a different question.
    put(out, 'grossYield', totals.monthlyRentalIncome === undefined
      ? undefined
      : ((totals.monthlyRentalIncome * MONTHS_PER_YEAR) / totals.value) * 100);
  }

  const holdings = properties.map((p) => {
    const h: Record<string, unknown> = {};
    put(h, 'address', p.address);
    put(h, 'value', p.value);
    put(h, 'debt', p.loan);
    put(h, 'equity', p.equity);
    put(h, 'yield', p.grossYield);
    put(h, 'net', p.annualCashflow);
    return h;
  }).filter((h) => Object.keys(h).length > 0);
  if (holdings.length) out.holdings = holdings;

  const strength = strList(exec.keyStrengths);
  const watch = strList(exec.keyConcerns);
  if (strength.length) out.strength = strength;
  if (watch.length) out.watch = watch;
  put(out, 'narrative', str(fin.analysis));

  const actions = strList(recs.priorityActions);
  if (actions.length) out.actions = actions.map((action) => ({ action }));

  return out;
}

export interface ProjectedPortfolio {
  portfolio: Record<string, unknown>;
  properties: Record<string, unknown>[];
  summary: Record<string, unknown>;
  health: Record<string, unknown>;
  risk: Record<string, unknown>;
  actions: Record<string, unknown>;
  client: Record<string, unknown>;
  report: Record<string, unknown>;
}

export function projectPortfolio(row: PortfolioRowLike): ProjectedPortfolio {
  const data = obj(row.report_data);
  const metrics = obj(data.portfolioMetrics);
  const analysis = obj(data.analysis);
  const exec = obj(analysis.executiveSummary);
  const fin = obj(analysis.financialHealth);
  const riskRaw = obj(analysis.riskAssessment);
  const recs = obj(analysis.strategicRecommendations);

  // ── headline portfolio figures ────────────────────────────────────────────
  const monthlyCashflow = num(row.net_monthly_cashflow) ?? num(metrics.netMonthlyCashflow);
  const portfolio: Record<string, unknown> = {};
  // Typed columns win over the jsonb copy: they are what the list view reads.
  put(portfolio, 'value', num(row.portfolio_value) ?? num(metrics.totalValue));
  put(portfolio, 'equity', num(row.total_equity) ?? num(metrics.totalEquity));
  put(portfolio, 'debt', num(metrics.totalDebt));
  put(portfolio, 'propertyCount', num(row.total_properties) ?? num(metrics.totalProperties));
  put(portfolio, 'investmentCount', num(metrics.investmentCount));
  put(portfolio, 'ownerOccupiedCount', num(metrics.ownerOccupiedCount));
  put(portfolio, 'averageLvr', num(row.average_lvr) ?? num(metrics.averageLVR));
  put(portfolio, 'averageYield', num(row.average_yield) ?? num(metrics.averageYield));
  put(portfolio, 'monthlyCashflow', monthlyCashflow);
  put(portfolio, 'annualCashflow', monthlyCashflow === undefined ? undefined : monthlyCashflow * MONTHS_PER_YEAR);
  put(portfolio, 'monthlyRentalIncome', num(metrics.totalMonthlyRentalIncome));
  put(portfolio, 'monthlyExpenses', num(metrics.totalMonthlyExpenses));

  const best = projectPerformer(metrics.bestPerformer);
  if (Object.keys(best).length) portfolio.bestPerformer = best;
  const worst = projectPerformer(metrics.worstPerformer);
  if (Object.keys(worst).length) portfolio.worstPerformer = worst;

  // ── the inventory ─────────────────────────────────────────────────────────
  const properties = arr(data.propertyAnalyses)
    .map(projectProperty)
    .filter((p) => Object.keys(p).length > 0);

  // ── model-authored assessment ─────────────────────────────────────────────
  // `health_score` is 25-90 across the sample: a score out of 100, NOT a
  // percentage. It is labelled "/100" rather than set with `| percent`.
  const summary: Record<string, unknown> = {};
  put(summary, 'healthScore', num(row.health_score) ?? num(exec.healthScore));
  put(summary, 'overallHealth', str(row.overall_health) ?? str(exec.overallHealth));
  put(summary, 'primaryRecommendation', str(exec.primaryRecommendation));
  const strengths = strList(exec.keyStrengths);
  const concerns = strList(exec.keyConcerns);
  if (strengths.length) summary.strengths = strengths;
  if (concerns.length) summary.concerns = concerns;

  const health: Record<string, unknown> = {};
  put(health, 'analysis', str(fin.analysis));
  put(health, 'cashflowStatus', str(fin.cashflowStatus));
  put(health, 'debtServiceability', str(fin.debtServiceability));
  put(health, 'equityPosition', str(fin.equityPosition));
  put(health, 'lvrRisk', str(fin.lvrRisk));

  // The stored key names are kept verbatim rather than shortened, and that is
  // not laziness. `risk` is a namespace the voice templates already use for the
  // client's risk *profile* — `{{risk.vacancy}}` is "Reaction to 3 months
  // vacancy", a tolerance statement — so publishing a portfolio vacancy-risk
  // assessment under the same leaf would silently replace it wherever both
  // vocabularies share a data object (the preview sample being the obvious one).
  // Mirroring `riskAssessment`'s own names sidesteps every collision and makes
  // each binding traceable back to the column it came from.
  // Four of these are strings and two are **arrays of strings**, measured across
  // all 21 stored reports rather than inferred from the names — and the names
  // do not tell you which is which. `marketRisks` (2-4 entries) and
  // `mitigationStrategies` (4-5) are lists on every row; `concentrationRisk`,
  // `vacancyRisk` and `interestRateSensitivity` are single sentences on every
  // row, despite reading like they would pluralise the same way.
  //
  // Getting this wrong is silent in both directions: bound as prose an array
  // prints `[object Object]`, and refused as a non-string it prints nothing at
  // all. The first draft here did the second, which would have left two of the
  // risk page's five fields blank on every report ever generated.
  const risk: Record<string, unknown> = {};
  put(risk, 'overallRiskLevel', str(riskRaw.overallRiskLevel));
  put(risk, 'concentrationRisk', str(riskRaw.concentrationRisk));
  put(risk, 'vacancyRisk', str(riskRaw.vacancyRisk));
  put(risk, 'interestRateSensitivity', str(riskRaw.interestRateSensitivity));
  const marketRisks = strList(riskRaw.marketRisks);
  const mitigations = strList(riskRaw.mitigationStrategies);
  if (marketRisks.length) risk.marketRisks = marketRisks;
  if (mitigations.length) risk.mitigationStrategies = mitigations;

  // All four are arrays of strings on all 21 rows — the three horizons included,
  // which read like single statements and are not. `priorityActions` runs 3-4
  // entries and each horizon 1-4.
  const actions: Record<string, unknown> = {};
  for (const key of ['priorityActions', 'shortTerm', 'mediumTerm', 'longTerm'] as const) {
    const list = strList(recs[key]);
    if (list.length) actions[key === 'priorityActions' ? 'priority' : key] = list;
  }

  // The older vocabulary the shipping voice template binds. Its names are
  // disjoint from the ones above — `count` against `propertyCount`, `lvr`
  // against `averageLvr`, `netCashFlow` against `annualCashflow` — because they
  // are not always the same statistic, and one key answering two questions is
  // how a portfolio's weighted LVR comes to be printed as its mean.
  Object.assign(portfolio, voiceAliases(metrics, exec, fin, recs, properties, {
    value: num(portfolio.value),
    debt: num(portfolio.debt),
    monthlyRentalIncome: num(portfolio.monthlyRentalIncome),
    annualCashflow: num(portfolio.annualCashflow),
  }));

  const client: Record<string, unknown> = {};
  put(client, 'name', str(row.client_name) ?? str(data.clientName));

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(row.updated_at) ?? str(row.created_at) ?? str(data.generatedAt));

  return { portfolio, properties, summary, health, risk, actions, client, report };
}

/** Merge the projection into a binding-context `data` object. */
export function applyPortfolioProjection(
  data: Record<string, any>,
  row: PortfolioRowLike,
): Record<string, any> {
  const p = projectPortfolio(row);
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    data[key] = { ...obj(data[key]), ...extra };
  };
  merge('portfolio', p.portfolio);
  merge('summary', p.summary);
  merge('health', p.health);
  merge('risk', p.risk);
  merge('actions', p.actions);
  merge('client', p.client);
  merge('report', p.report);
  if (p.properties.length) data.properties = p.properties;
  return data;
}
