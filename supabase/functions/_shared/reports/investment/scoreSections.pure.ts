/**
 * Sections composed from the stored `investment_score` record.
 *
 * The score object is the one place the platform records how a verdict was
 * reached — grade, total, weighted dimension breakdown, and the four
 * strengths / weaknesses / opportunities / risks lists. Three surfaces used
 * to restate it by hand and each got something wrong:
 *
 *  - the verdict page's subtitle hardcoded "weighted across growth, location,
 *    yield, demand and risk", which misstates every variant score (the
 *    financial variant weighs cashflow and serviceability; the due-diligence
 *    variant weighs planning risk and liveability) — and printed
 *    "Graded  at  out of 100" with the holes left in whenever the record
 *    carried no score at all, which was every Strategic fork ever produced;
 *  - the Briefing asked a model to tabulate the breakdown from prose that
 *    never states it, and got N/A;
 *  - SWOT existed only as model improvisation, while the record's own four
 *    lists went unread.
 *
 * So the sentence and the sections are composed here, once, from the record —
 * and only when the record can actually say them. An absent score produces
 * no sentence and no section, never a sentence with holes.
 */

import { num, str } from './figures.pure.ts';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** How each breakdown key reads in prose. Unknown keys fall back to a de-camelled label. */
export const DIMENSION_LABELS: Readonly<Record<string, string>> = {
  yieldScore: 'yield',
  growthScore: 'growth',
  locationScore: 'location',
  demandScore: 'demand',
  riskScore: 'risk',
  cashflowScore: 'cash flow',
  serviceabilityScore: 'serviceability',
  tenantFitScore: 'tenant fit',
  planningRiskScore: 'planning risk',
  liveabilityScore: 'liveability',
};

export function dimensionLabel(key: string): string {
  const known = DIMENSION_LABELS[key];
  if (known) return known;
  return key
    .replace(/Score$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

interface BreakdownEntry {
  key: string;
  label: string;
  weight: number | undefined;
  score: number | undefined;
}

/** The dimensions that actually carried data, in stored order. */
function breakdownEntries(score: unknown): BreakdownEntry[] {
  if (!isRecord(score) || !isRecord(score.breakdown)) return [];
  const out: BreakdownEntry[] = [];
  for (const [key, raw] of Object.entries(score.breakdown)) {
    if (!isRecord(raw)) continue;
    // Generator-written breakdowns carry `hasData`; engine-written ones carry
    // `available`. Either being explicitly false means the dimension was not
    // scored and must not be tabulated as though it were.
    const carried = (raw.hasData ?? raw.available) !== false;
    if (!carried) continue;
    const weight = num(raw.weight);
    if (weight !== undefined && weight <= 0) continue;
    out.push({ key, label: dimensionLabel(key), weight, score: num(raw.score) });
  }
  return out;
}

/**
 * "Graded B at 58 out of 100, weighted across growth, location, yield, demand
 * and risk." — or undefined when the record cannot say it. The weighting
 * clause names the dimensions this score actually carries, so a financial or
 * due-diligence variant score describes its own weights rather than the
 * composite's.
 */
export function gradedLine(score: unknown): string | undefined {
  if (!isRecord(score)) return undefined;
  const grade = str(score.grade);
  const total = num(score.totalScore);
  if (!grade || total === undefined) return undefined;
  const head = `Graded ${grade} at ${Math.round(total)} out of 100`;
  const dims = breakdownEntries(score).map((d) => d.label);
  if (dims.length < 2) return `${head}.`;
  const clause = dims.length === 2
    ? `${dims[0]} and ${dims[1]}`
    : `${dims.slice(0, -1).join(', ')} and ${dims[dims.length - 1]}`;
  return `${head}, weighted across ${clause}.`;
}

/** The graded line plus the pointer to the assessment page, for the closing card. */
export function gradedDetailLine(score: unknown): string | undefined {
  const line = gradedLine(score);
  if (!line) return undefined;
  return `${line} The weighted dimensions behind that grade are set out on the assessment page.`;
}

/**
 * `## <heading>` with grade / score / recommendation lines and the weighted
 * dimension table — or null when the record holds no score. Rows appear only
 * for dimensions that carried data (a labelled row is a promise).
 */
/**
 * The verdict itself — grade, score, the record's own recommendation, and the
 * coverage note where the score does not rest on every dimension.
 *
 * Null when the record carries no grade or no total: a verdict section with no
 * verdict in it is a heading over nothing.
 *
 * The coverage line is not a new disclosure. `InvestmentReportViewer` has
 * always shown `investment_score.coverage.partialLabel` whenever
 * `coverageRatio < 1`, and `InvestmentGradeSummary` shows it too — so staff
 * looking at the record are told the score is partial and the client reading
 * the generated document was not. Same field, same words, one more surface.
 */
function verdictLines(score: Record<string, unknown>): string[] | null {
  const grade = str(score.grade);
  const total = num(score.totalScore);
  if (!grade || total === undefined) return null;

  const lines = [`**Grade:** ${grade} · **Score:** ${Math.round(total)}/100`];
  const rec = str(score.recommendation);
  if (rec) lines.push('', `**Recommendation:** ${rec}`);

  const coverage = isRecord(score.coverage) ? score.coverage : undefined;
  const ratio = coverage ? num(coverage.coverageRatio) : undefined;
  const partial = coverage ? str(coverage.partialLabel) : undefined;
  if (partial && ratio !== undefined && ratio < 1) lines.push('', `_${partial}._`);

  return lines;
}

/** The weighted dimensions table. Empty when the record scored none of them. */
function dimensionLines(score: Record<string, unknown>): string[] {
  const dims = breakdownEntries(score).filter((d) => d.score !== undefined);
  if (!dims.length) return [];
  const rows = ['| Dimension | Weight | Score |', '| --- | --- | --- |'];
  for (const d of dims) {
    const label = d.label.charAt(0).toUpperCase() + d.label.slice(1);
    rows.push(`| ${label} | ${d.weight !== undefined ? `${Math.round(d.weight)}%` : '—'} | ${Math.round(d.score!)}/100 |`);
  }
  return rows;
}

/**
 * Grade, score and recommendation on their own — the Snapshot's `Investment
 * Score` section, which the tier used to ask a model to write.
 *
 * That guide said `Recommendation: [BUY/HOLD/SELL]`. The engine's actual
 * vocabulary is `HOLD` (855 reports), `CAUTION` (99), `HOLD/BUY` (33) and `BUY`
 * (2): **`SELL` is never issued, `CAUTION` is never offered, and `HOLD/BUY`
 * cannot be spelled in three words.** A model asked to choose one of three from
 * a record that says a fourth must change the recommendation to answer.
 */
export function composeVerdictSection(score: unknown, heading: string): string | null {
  if (!isRecord(score)) return null;
  const body = verdictLines(score);
  return body ? [`## ${heading}`, '', ...body].join('\n') + '\n' : null;
}

/**
 * The dimensions table on its own — the Snapshot's `Score Breakdown`.
 *
 * The guide it replaces listed `Growth, Location, Yield, Demand, Risk` with no
 * omission rule beside it, while the two sections either side of it had one.
 * The record withholds a dimension it could not score — `excluded: true`,
 * `weight: 0` and a placeholder `score` of 50 that is not a score — on 16 of
 * the 17 reports generated since August 2026. A model handed three figures and
 * told to produce five rows fills the other two.
 */
export function composeScoreDimensionsSection(score: unknown, heading: string): string | null {
  if (!isRecord(score)) return null;
  const rows = dimensionLines(score);
  return rows.length ? [`## ${heading}`, '', ...rows].join('\n') + '\n' : null;
}

/** Verdict and dimensions under one heading — the Briefing's `scorecard`. */
export function composeScoreBreakdownSection(
  score: unknown,
  heading: string,
): string | null {
  if (!isRecord(score)) return null;
  const body = verdictLines(score);
  if (!body) return null;

  const rows = dimensionLines(score);
  const lines = [`## ${heading}`, '', ...body];
  if (rows.length) lines.push('', ...rows);
  return lines.join('\n') + '\n';
}

/**
 * `## <heading>` with the record's own strengths / weaknesses / opportunities
 * / threats lists — groups with nothing recorded are omitted, and a score
 * carrying none of the four produces no section at all.
 */
export function composeSwotSection(score: unknown, heading: string): string | null {
  if (!isRecord(score)) return null;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
  const groups: Array<[string, string[]]> = [
    ['Strengths', list(score.strengths)],
    ['Weaknesses', list(score.weaknesses)],
    ['Opportunities', list(score.opportunities)],
    ['Threats', list(score.risks)],
  ];
  if (!groups.some(([, items]) => items.length > 0)) return null;

  const lines: string[] = [`## ${heading}`, ''];
  for (const [name, items] of groups) {
    if (!items.length) continue;
    lines.push(`### ${name}`, '');
    for (const item of items) lines.push(`- ${item}`);
    lines.push('');
  }
  return lines.join('\n');
}
