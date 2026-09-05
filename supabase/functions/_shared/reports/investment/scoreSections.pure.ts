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
export function composeScoreBreakdownSection(
  score: unknown,
  heading: string,
): string | null {
  if (!isRecord(score)) return null;
  const grade = str(score.grade);
  const total = num(score.totalScore);
  if (!grade || total === undefined) return null;

  const lines: string[] = [`## ${heading}`, ''];
  lines.push(`**Grade:** ${grade} · **Score:** ${Math.round(total)}/100`);
  const rec = str(score.recommendation);
  if (rec) lines.push('', `**Recommendation:** ${rec}`);

  const dims = breakdownEntries(score).filter((d) => d.score !== undefined);
  if (dims.length) {
    lines.push('', '| Dimension | Weight | Score |', '| --- | --- | --- |');
    for (const d of dims) {
      const label = d.label.charAt(0).toUpperCase() + d.label.slice(1);
      lines.push(`| ${label} | ${d.weight !== undefined ? `${Math.round(d.weight)}%` : '—'} | ${Math.round(d.score!)}/100 |`);
    }
  }
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
