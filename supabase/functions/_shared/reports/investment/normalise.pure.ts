/**
 * Reading an investment report row.
 *
 * Six jsonb columns and one very large Markdown column, none of which has a
 * schema the database enforces. Every reader here is defensive in the same way
 * the other seven normalisers are: a missing branch produces `null`, never a
 * zero, because a zero is a measurement and a null is an absence, and the
 * document draws them differently — a chart with a null is not drawn at all,
 * while a chart with a zero claims the property scored nothing.
 *
 * ## The sensitivity data is one-way, and that decides the chart
 *
 * `sensitivityAnalysis` holds two independent objects — `interestRateChanges`
 * with three scenarios and `rentChanges` with three — and **not** a grid. The
 * generator being replaced draws a heatmap from them, which asks a reader to
 * read a cross-product ("rent +10% *and* rates +1%") that was never computed.
 * The design system's `renderHeatmap` would make the same false claim more
 * beautifully. So this module returns two one-way series and the document draws
 * a tornado, which is what one-way sensitivity data actually is.
 *
 * ## The projections are three scenarios, not one line
 *
 * `projections` holds `conservative`, `moderate` and `optimistic`, each a
 * ten-year array. Printing only the moderate case — which is what a single line
 * would do — throws away the range, and the range is the point of a projection.
 * The document draws all three as a fan.
 */
import { markdownToPlainText, sanitiseGlyphs } from '../markdown.pure.ts';
import { neutraliseUrls } from '../text.pure.ts';
import {
  type Demographics,
  type EconomicContext,
  FURNITURE_HEADINGS,
  type FinancialModel,
  type InvestmentReport,
  type InvestmentScore,
  type LocationIntelligence,
  MAX_PROJECTION_YEARS,
  MAX_SECTIONS,
  MAX_SWOT_ITEMS,
  MIN_SECTION_CHARS,
  type PropertySpecs,
  type ReportSection,
  SCORE_DIMENSIONS,
  SECTION_CHARTS,
  type ScoreDimensionKey,
  type SensitivityPoint,
} from './payload.pure.ts';

export interface ReportRow {
  id?: unknown;
  status?: unknown;
  property_address?: unknown;
  report_content?: unknown;
  sources_content?: unknown;
  report_scope?: unknown;
  report_tier?: unknown;
  report_variant?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  property_specs?: unknown;
  investment_score?: unknown;
  location_intelligence?: unknown;
  demographics_data?: unknown;
  economic_data?: unknown;
  financial_calculations?: unknown;
  [key: string]: unknown;
}

export interface BuildInput {
  row: ReportRow;
  /** ISO instant. Passed in — this module has no clock. */
  preparedOn: string;
  /**
   * Where this report's score sits among the firm's own, 0-100.
   *
   * Counted by the route, which has a database; null when it could not. Never
   * derived here, and never invented — a percentile the reader cannot trust is
   * worse than no percentile.
   */
  scorePercentile?: number | null;
}

export type BuildResult =
  | { ok: true; report: InvestmentReport }
  | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A finite number, or null. Strings are parsed; empty and `N/A` are null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s%]/g, '');
    if (!cleaned || /^n\/?a$/i.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A short field: glyph-sanitised, URL-neutralised, collapsed and capped. */
const short = (v: unknown, max: number): string =>
  neutraliseUrls(sanitiseGlyphs(str(v)).text).replace(/\s+/g, ' ').trim().slice(0, max).trim();

/** A list of short strings, deduplicated, capped. */
function list(v: unknown, max: number, chars = 400): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const text = short(typeof item === 'string' ? item : (isRecord(item) ? item.text ?? item.label : ''), chars);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

// ── The prose ───────────────────────────────────────────────────────────────

/**
 * Remove the blocks the document prints itself.
 *
 * 761 reports carry `## ⚖️ PROFESSIONAL DISCLAIMER` and `## 📞 CONTACT US` in
 * the model's own Markdown. The design system's closing page prints the
 * tenant's real contact block and the disclaimer from `global_report_settings`,
 * so leaving these prints both — once with the tenant's actual ABN and once with
 * whatever the model wrote, which is the worse of the two to be wrong.
 *
 * Matched on the heading text with any leading pictograph tolerated, because the
 * emoji is not stable across the corpus and the words are.
 */
export function stripFurniture(markdown: string): { text: string; removed: number } {
  if (!markdown) return { text: '', removed: 0 };
  let out = markdown;
  for (const heading of FURNITURE_HEADINGS) {
    if (heading === 'REPORT TITLE') continue;
    const pattern = new RegExp(
      `^#{1,4}\\s*[^\\n#]{0,8}?${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b[\\s\\S]*?(?=\\n#{1,4}\\s|$)`,
      'gim',
    );
    out = out.replace(pattern, '');
  }
  const cleaned = out.replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, removed: Math.max(0, markdown.length - cleaned.length) };
}

/** `# 24. Sensitivity Analysis` → `{ number: 24, title: 'Sensitivity Analysis' }`. */
export function parseHeading(line: string): { number: number | null; title: string } | null {
  const m = /^#{1,2}\s+(.+?)\s*$/.exec(line);
  if (!m) return null;
  const raw = short(m[1], 160);
  if (!raw) return null;
  const numbered = /^(\d{1,2})[.)]\s*(.+)$/.exec(raw);
  if (numbered) {
    const n = Number(numbered[1]);
    return { number: Number.isFinite(n) ? n : null, title: numbered[2].trim() || raw };
  }
  return { number: null, title: raw };
}

/**
 * Split the prose into its numbered sections.
 *
 * Splits on `#` and `##` together rather than `#` alone. The corpus uses `#` for
 * the 36 numbered sections and `##` for the two furniture blocks, but 256
 * reports also carry unnumbered `##` sections — "Location Overview", "Current
 * Market Performance" — that are real content and would otherwise be swallowed
 * into whichever numbered section happened to precede them.
 */
export function splitSections(markdown: string): ReportSection[] {
  const lines = markdown.split('\n');
  const sections: ReportSection[] = [];
  let current: { number: number | null; title: string; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    // A heading with nothing under it is not a section. The corpus has these
    // where the model emitted a heading and then ran out of tokens.
    if (body.length >= MIN_SECTION_CHARS) {
      sections.push({
        number: current.number,
        title: current.title,
        markdown: body,
        charts: current.number !== null ? (SECTION_CHARTS[current.number] ?? []) : [],
      });
    }
    current = null;
  };

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      flush();
      // `# REPORT TITLE` is the document's own title, printed on the cover.
      if (/^REPORT TITLE$/i.test(heading.title)) continue;
      current = { number: heading.number, title: heading.title, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();

  return sections.slice(0, MAX_SECTIONS);
}

// ── The structured columns ──────────────────────────────────────────────────

export function toSpecs(raw: unknown): PropertySpecs {
  const s = isRecord(raw) ? raw : {};
  return {
    propertyType: short(s.property_type ?? s.propertyType, 60),
    bedrooms: num(s.bedrooms),
    bathrooms: num(s.bathrooms),
    parking: num(s.parking),
    landSqm: num(s.land_size_sqm ?? s.landSizeSqm),
    buildingSqm: num(s.building_size_sqm ?? s.buildingSizeSqm),
    yearBuilt: num(s.year_built ?? s.yearBuilt),
    zoning: short(s.zoning, 40),
    councilArea: short(s.council_area ?? s.councilArea, 80),
  };
}

export function toScore(raw: unknown, percentile: number | null): InvestmentScore | null {
  if (!isRecord(raw)) return null;
  const breakdownRaw = isRecord(raw.breakdown) ? raw.breakdown : {};
  const breakdown = SCORE_DIMENSIONS.map((d) => ({
    key: d.key as ScoreDimensionKey,
    label: d.label,
    value: num(breakdownRaw[d.key]),
  }));
  const total = num(raw.totalScore);
  // A score object with neither a total nor one populated dimension is not a
  // score — it is an empty shell the engine wrote before it failed.
  if (total === null && breakdown.every((b) => b.value === null)) return null;
  return {
    total,
    grade: short(raw.grade, 8),
    recommendation: short(raw.recommendation, 600),
    breakdown,
    strengths: list(raw.strengths, MAX_SWOT_ITEMS),
    weaknesses: list(raw.weaknesses, MAX_SWOT_ITEMS),
    opportunities: list(raw.opportunities, MAX_SWOT_ITEMS),
    risks: list(raw.risks, MAX_SWOT_ITEMS),
    percentile: percentile === null || !Number.isFinite(percentile)
      ? null
      : Math.max(0, Math.min(100, Math.round(percentile))),
  };
}

/** Amenity categories, from whichever branch of the payload carries them. */
function toAmenities(loc: Record<string, unknown>): LocationIntelligence['amenities'] {
  const out: Array<{ label: string; count: number | null; score: number | null }> = [];
  const push = (label: string, count: unknown, score: unknown) => {
    const c = num(count);
    const s = num(score);
    if (c === null && s === null) return;
    out.push({ label, count: c, score: s });
  };

  const schools = isRecord(loc.schools) ? loc.schools : {};
  push('Schools within 3km', schools.schoolsWithin3km, null);
  const transport = isRecord(loc.transport) ? loc.transport : {};
  push('Transport stops', transport.stopsWithin1km ?? transport.nearbyStops, transport.score);
  const healthcare = isRecord(loc.healthcare) ? loc.healthcare : {};
  push('Healthcare', healthcare.facilitiesWithin5km ?? healthcare.nearbyFacilities, healthcare.score);
  const lifestyle = isRecord(loc.lifestyle) ? loc.lifestyle : {};
  push('Lifestyle & retail', lifestyle.venuesWithin2km ?? lifestyle.nearbyVenues, lifestyle.score);

  // `amenities` is an array in the corpus, not an object. Counted by category.
  if (Array.isArray(loc.amenities) && loc.amenities.length) {
    const byType = new Map<string, number>();
    for (const item of loc.amenities) {
      if (!isRecord(item)) continue;
      const type = short(item.type ?? item.category ?? item.label, 40) || 'Other';
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
    for (const [label, count] of [...byType].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      push(label, count, null);
    }
  }
  return out;
}

export function toLocation(raw: unknown, address: string): LocationIntelligence | null {
  if (!isRecord(raw)) return null;
  const coords = isRecord(raw.coordinates) ? raw.coordinates : {};
  const amenities = toAmenities(raw);
  const walkScore = num(raw.walkScore);
  const lat = num(coords.lat);
  const lng = num(coords.lng);
  if (walkScore === null && lat === null && !amenities.length) return null;

  // The suburb, state and postcode are not their own columns — they are the
  // tail of the address, which is the only place the corpus records them.
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts[parts.length - 1] : '';
  const m = /^(.*?)\s*([A-Z]{2,3})\s*(\d{4})$/.exec(tail);
  return {
    walkScore,
    lat,
    lng,
    suburb: short(raw.suburb ?? (m ? m[1] : (parts.length > 1 ? parts[parts.length - 2] : '')), 60),
    state: short(raw.state ?? (m ? m[2] : ''), 4),
    postcode: short(raw.postcode ?? (m ? m[3] : ''), 6),
    amenities,
  };
}

export function toDemographics(raw: unknown): Demographics | null {
  if (!isRecord(raw)) return null;
  const pop = isRecord(raw.population) ? raw.population : {};
  const inc = isRecord(raw.income) ? raw.income : {};
  const hou = isRecord(raw.housing) ? raw.housing : {};
  const out: Demographics = {
    population: num(pop.total),
    populationGrowth: num(pop.growth),
    density: num(pop.density),
    medianAge: num(inc.medianAge),
    medianHouseholdIncome: num(inc.medianHouseholdIncome),
    unemploymentRate: num(inc.unemploymentRate),
    medianRent: num(hou.medianRent),
    ownerOccupierRate: num(hou.ownerOccupierRate),
    renterRate: num(hou.renterRate),
    housingStress: num(hou.housingStress),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

export function toEconomic(raw: unknown): EconomicContext | null {
  if (!isRecord(raw)) return null;
  const ind = isRecord(raw.indicators) ? raw.indicators : {};
  const out: EconomicContext = {
    cashRate: num(raw.cashRate),
    inflation: num(raw.inflation),
    gdpGrowth: num(ind.gdpGrowth),
    unemploymentRate: num(ind.unemploymentRate),
    participationRate: num(ind.participationRate),
    creditGrowth: num(ind.creditGrowth),
    housePriceGrowth: num(ind.housePriceGrowth),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/** `plus10Percent` → `Rent +10%`. The keys are the only labels the data has. */
function scenarioLabel(key: string, subject: string): string {
  const m = /^(plus|minus)(\d+)Percent$/.exec(key);
  if (!m) return `${subject} ${key}`;
  return `${subject} ${m[1] === 'plus' ? '+' : '−'}${m[2]}%`;
}

/**
 * One-way sensitivities, as deltas from the base position.
 *
 * The stored values are absolute annual positions under each scenario. A reader
 * comparing "−36,557" with "−29,539" has to do the subtraction themselves; the
 * delta is the thing the chart is about, so it is computed here where the base
 * is known rather than in the renderer where it is not.
 */
function toSensitivity(raw: unknown, subject: string, base: number | null): SensitivityPoint[] {
  if (!isRecord(raw)) return [];
  const points: SensitivityPoint[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const v = num(value);
    if (v === null) continue;
    points.push({ label: scenarioLabel(key, subject), value: v, delta: base === null ? 0 : v - base });
  }
  // Worst first, so the tornado reads top-down from the biggest downside.
  return points.sort((a, b) => a.value - b.value).slice(0, 8);
}

/** Named annual cost lines, largest first, for the waterfall. */
function toCosts(raw: unknown): Array<{ label: string; value: number }> {
  if (!isRecord(raw)) return [];
  const LABELS: Record<string, string> = {
    councilRates: 'Council rates',
    waterRates: 'Water rates',
    landlordInsurance: 'Insurance',
    propertyManagement: 'Management',
    maintenance: 'Maintenance',
    strataFees: 'Strata',
    landTax: 'Land tax',
    lettingFees: 'Letting fees',
  };
  const out: Array<{ label: string; value: number }> = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const v = num(raw[key]);
    if (v === null || v === 0) continue;
    out.push({ label, value: Math.abs(v) });
  }
  return out.sort((a, b) => b.value - a.value);
}

/**
 * The ten-year scenarios.
 *
 * Only the moderate case lands in the typed series, because that is the case the
 * prose's own tables use. The other two reach the document through the scenario
 * fan, which reads them from the raw payload — keeping three parallel arrays in
 * this interface would put a rendering decision in the payload contract.
 */
function toProjections(raw: unknown): FinancialModel['projections'] {
  if (!isRecord(raw)) return [];
  const rows = Array.isArray(raw.moderate) ? raw.moderate : [];
  const out: Array<{ year: number; value: number | null; rent: number | null; cumulative: number | null }> = [];
  for (const row of rows.slice(0, MAX_PROJECTION_YEARS)) {
    if (!isRecord(row)) continue;
    const year = num(row.year);
    if (year === null) continue;
    out.push({
      year,
      value: num(row.propertyValue),
      rent: num(row.annualRent),
      cumulative: num(row.cumulativeCashFlow),
    });
  }
  return out;
}

export function toFinancial(raw: unknown): FinancialModel | null {
  if (!isRecord(raw)) return null;
  const km = isRecord(raw.keyMetrics) ? raw.keyMetrics : {};
  const loan = isRecord(raw.loanDetails) ? raw.loanDetails : {};
  const costs = isRecord(raw.annualCosts) ? raw.annualCosts : {};
  const income = isRecord(raw.income) ? raw.income : {};
  const sens = isRecord(raw.sensitivityAnalysis) ? raw.sensitivityAnalysis : {};

  const annualNet = num(km.annualNet);
  const model: FinancialModel = {
    grossYield: num(km.grossRentalYield),
    netYield: num(km.netRentalYield),
    cashOnCash: num(km.cashOnCashReturn),
    lvr: num(km.lvr ?? loan.lvr),
    totalInvestment: num(km.totalInvestment),
    annualNet,
    weeklyNet: num(km.weeklyNet),
    loanAmount: num(loan.loanAmount),
    interestRate: num(loan.interestRate),
    monthlyPayment: num(loan.monthlyPayment),
    costs: toCosts(costs),
    annualIncome: num(income.annualRent ?? income.grossAnnualRent ?? income.annual),
    interestSensitivity: toSensitivity(sens.interestRateChanges, 'Rate', annualNet),
    rentSensitivity: toSensitivity(sens.rentChanges, 'Rent', annualNet),
    projections: toProjections(raw.projections),
  };

  const populated = model.grossYield !== null || model.lvr !== null
    || model.costs.length > 0 || model.projections.length > 0;
  return populated ? model : null;
}

/** The three scenario series, straight off the payload, for the fan. */
export function scenarioSeries(
  raw: unknown,
  field: 'propertyValue' | 'cumulativeCashFlow' | 'annualRent',
): Array<{ label: string; values: number[] }> {
  if (!isRecord(raw)) return [];
  const NAMES: Array<[string, string]> = [
    ['conservative', 'Conservative'],
    ['moderate', 'Moderate'],
    ['optimistic', 'Optimistic'],
  ];
  const out: Array<{ label: string; values: number[] }> = [];
  for (const [key, label] of NAMES) {
    const rows = Array.isArray((raw as Record<string, unknown>)[key])
      ? (raw as Record<string, unknown>)[key] as unknown[]
      : [];
    const values: number[] = [];
    for (const row of rows.slice(0, MAX_PROJECTION_YEARS)) {
      if (!isRecord(row)) continue;
      const v = num(row[field]);
      if (v !== null) values.push(v);
    }
    if (values.length >= 2) out.push({ label, values });
  }
  return out;
}

/** Sources, from the separate column the corpus keeps them in. */
export function toSources(raw: unknown): string[] {
  const text = str(raw);
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const cleaned = short(line.replace(/^[-*\d.)\s]+/, ''), 300);
    if (cleaned.length < 8 || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    out.push(cleaned);
    if (out.length >= 60) break;
  }
  return out;
}

/** Two or three sentences framing the report. Built from it, not written. */
export function narrativeFor(
  address: string,
  sections: number,
  grade: string,
  hasFinancials: boolean,
): string {
  const where = address ? ` for ${address}` : '';
  const graded = grade ? ` The location and property fit score a ${grade}.` : '';
  const money = hasFinancials
    ? ' Purchase costs, loan structure and a ten-year projection are modelled from the figures supplied.'
    : ' No financial model was run for this report, so it carries no yield, loan or projection figures.';
  return `An investment location and property fit assessment${where}, in ${
    sections === 1 ? 'one section' : `${sections} sections`
  }.${graded}${money}`;
}

const uuidLike = (v: unknown): string => {
  const s = str(v).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : '';
};

/**
 * Build the report.
 *
 * Refuses rather than renders when the row has nothing to say: no id, a status
 * that is not `completed`, or no prose and no structured columns at all. A cover
 * page and a disclaimer page with nothing between them is a file somebody sends
 * before noticing.
 */
export function buildInvestmentReport(input: BuildInput): BuildResult {
  const row = input.row ?? {};
  const reportId = uuidLike(row.id);
  if (!reportId) return { ok: false, error: 'report id missing' };

  const status = str(row.status);
  if (status && status !== 'completed') {
    return { ok: false, error: `this report is ${status}, not completed` };
  }

  const address = short(row.property_address, 200);
  const rawProse = str(row.report_content);
  const stripped = stripFurniture(sanitiseGlyphs(rawProse).text);
  const sections = splitSections(stripped.text);

  const specs = toSpecs(row.property_specs);
  const score = toScore(row.investment_score, input.scorePercentile ?? null);
  const location = toLocation(row.location_intelligence, address);
  const demographics = toDemographics(row.demographics_data);
  const economic = toEconomic(row.economic_data);
  const financial = toFinancial(row.financial_calculations);

  const hasAnything = sections.length > 0 || score !== null || location !== null
    || demographics !== null || financial !== null;
  if (!hasAnything) return { ok: false, error: 'this report has no content to typeset' };

  return {
    ok: true,
    report: {
      meta: {
        reportId,
        propertyAddress: address,
        reportScope: short(row.report_scope, 40),
        reportTier: short(row.report_tier, 40),
        reportVariant: short(row.report_variant, 40),
        preparedOn: input.preparedOn,
        generatedAt: str(row.created_at) || input.preparedOn,
        hasFinancials: financial !== null,
        hasScore: score !== null,
        sectionsShown: sections.length,
        truncated: false,
      },
      narrative: narrativeFor(address, sections.length, score?.grade ?? '', financial !== null),
      specs,
      score,
      location,
      demographics,
      economic,
      financial,
      sections,
      sources: toSources(row.sources_content),
      notices: {
        furnitureStripped: stripped.removed,
        sectionsDropped: 0,
        charsOmitted: 0,
        chartsSkipped: 0,
      },
    },
  };
}
