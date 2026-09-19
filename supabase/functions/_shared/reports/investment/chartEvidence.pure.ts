/**
 * What a quantitative visual has to be able to point at, and what happens when
 * it cannot.
 *
 * ── Why this module exists ───────────────────────────────────────────────
 *
 * The Investment Compass for 48 Redfern Street, Cowra draws 33 directives. 20
 * of them carry figures. The number that bind to a producer the record holds
 * is **zero** — `demographics_data` is NULL, `location_intelligence` is NULL,
 * `data_sources.marketData` is null, there is no planning source at all, the
 * scoring engine issued no grade, and `market_fact_snapshot` records
 * population as `absent` with the ruling "not client safe" while page 11
 * charts it anyway. Meanwhile the one dataset the record genuinely holds —
 * crime, with real BOCSAR counts — appears in no chart at all.
 *
 * Nothing reported any of it. `_generationQuality` scored every section 100 of
 * 100 and the document passed.
 *
 * Three guards already existed for parts of this (`suppressUnrecordedScores`,
 * `suppressUnrecordedVerdictVisuals`, `suppressUnevidencedMarketSeries`) and
 * every one of them runs in `generate-investment-report` and nowhere else —
 * not the fork, not the condensation, not either render path. So a stored
 * document keeps its unsupported figures for ever, and so does every child
 * forked from it.
 *
 * ── The two halves of the contract ───────────────────────────────────────
 *
 * 1. **A visual must DECLARE a basis.** `findFiguresWithoutABasis` does that,
 *    and a declaration is cheap to write and cheap to fake.
 *
 * 2. **The declaration must be TRUE of this record.** That is this module.
 *    A nearby year, a "Source:" line or `unit=%` is not verification; what
 *    verifies is that the class of evidence the figure needs is one the record
 *    actually carries. `data_sources` says which producers answered, and a
 *    `null` there is the platform's own statement that nobody did.
 *
 * ── What it may and may not do ───────────────────────────────────────────
 *
 * It never invents a figure, never rescales one, and never deletes a finding.
 * A visual it withholds becomes the table of its own labels and values — the
 * rule `vizDirectiveTables` already holds, and the reason the Cowra amenity
 * chart's four dropped rows came back. The prose around a visual is untouched,
 * because the prose is where the finding and the next action live.
 *
 * It is deliberately NARROW. Only three classes are withheld, and each is one
 * where the record contradicts the drawing rather than merely failing to
 * confirm it:
 *
 *   - a RATING the scoring engine did not record (the existing rule, now on
 *     every path rather than one);
 *   - a SHARE of a population the record does not hold;
 *   - a SERIES of a quantity the record's own gate marked withheld.
 *
 * Everything else is reported and drawn. A warning that fires on two-thirds of
 * a corpus teaches people to ignore warnings, and this module's whole purpose
 * is to be believed.
 *
 * Deno-compatible: siblings and `_shared` only, explicit `.ts` extensions.
 */
import { parseVizDirectives, type VizDirective } from '../vizDirectives.pure.ts';
import { recordedScoreValues, suppressUnrecordedVerdictVisuals } from './scoreClaims.pure.ts';

/** What kind of claim a visual is making, which decides what can verify it. */
export type ChartClaim = 'rating' | 'share' | 'series' | 'measurement' | 'qualitative';

/** Why a visual could not be verified, or that it was. */
export type ChartVerdict = 'supported' | 'unrecorded_rating' | 'population_not_held' | 'series_withheld';

export interface EvidenceInventory {
  /** Every value the scoring engine recorded, which is what a rating may assert. */
  recordedScores: number[];
  /** Did a demographics producer answer for this report? */
  demographics: boolean;
  /** Did a market producer answer? */
  marketData: boolean;
  /** Did a location producer answer? */
  location: boolean;
  /** Facts the report-time snapshot marked absent, by name. */
  withheldFacts: string[];
}

export interface ChartEvidenceFinding {
  verdict: Exclude<ChartVerdict, 'supported'>;
  claim: ChartClaim;
  kind: string;
  directive: string;
  /** One sentence naming what the record holds, for the operator, not the client. */
  reason: string;
}

export interface ChartEvidenceResult {
  markdown: string;
  findings: ChartEvidenceFinding[];
}

/**
 * Read the inventory off a stored report row.
 *
 * Three things are read and nothing is inferred. `data_sources` is the
 * platform's own record of which producers answered, written by the generator
 * at the end of a run; a `null` entry is not "we did not check", it is "this
 * producer did not answer". `investment_score` carries what the engine
 * recorded. `market_fact_snapshot` carries what the client-safe gate refused,
 * with its own ruling attached.
 */
export function readEvidenceInventory(row: Record<string, unknown> | null | undefined): EvidenceInventory {
  const sources = (row?.data_sources ?? {}) as Record<string, unknown>;
  const answered = (key: string): boolean => {
    const v = sources[key];
    return v !== null && v !== undefined && typeof v === 'object';
  };
  const snapshot = row?.market_fact_snapshot as { facts?: Array<Record<string, unknown>> } | null | undefined;
  const withheldFacts = (snapshot?.facts ?? [])
    .filter((f) => f && f.status === 'absent')
    .map((f) => String(f.name ?? ''))
    .filter(Boolean);
  return {
    recordedScores: recordedScoreValues(row?.investment_score),
    demographics: answered('demographics'),
    marketData: answered('marketData'),
    location: answered('locationIntelligence') || answered('location'),
    withheldFacts,
  };
}

/**
 * What a directive is CLAIMING, which is not the same as what it is drawn as.
 *
 * A `bars` can be a measured series (three medians), a composition (three
 * shares of a hundred) or a minted scorecard, and the three need different
 * evidence. The declaration is the tell, as `scoreClaims` already found: a
 * genuine measured series does not announce that it is out of a hundred.
 */
export function claimOf(d: VizDirective): ChartClaim {
  if (d.kind === 'gauge' || d.kind === 'wheel') return 'rating';
  if (d.kind === 'donut' || d.kind === 'pictograph') return 'share';
  if (d.kind === 'margin') return 'series';
  if (d.kind === 'glance' || d.kind === 'tiles' || d.kind === 'timeline') return 'qualitative';
  // `radar` is named in `scoreClaims`' rating list but is not a directive kind
  // the parser produces, so there is nothing here to judge it on. The Deno
  // gate caught the dead branch that tsc admitted.
  if (d.kind === 'bars' || d.kind === 'heatmap') {
    const pct = 'unit' in d && typeof d.unit === 'string' && d.unit.trim() === '%';
    const hundred = 'max' in d && d.max === 100;
    if (hundred && !pct) return 'rating';
    if (pct) return 'share';
  }
  return 'measurement';
}

/**
 * A `share` names a POPULATION, and the population is the denominator.
 *
 * "Family renters 45, Local owner-occupiers 35, Professionals & small
 * households 20" describes households in a suburb; "Detached houses 80, Small
 * units 10, Rural lifestyle lots 10" describes dwellings. Both need a census
 * table and neither names one. A share of something the report itself
 * measured — a cost breakdown, an evidence count — is a different thing, and
 * is recognised by its own vocabulary rather than assumed.
 */
const SELF_MEASURED_SHARE =
  /\b(?:cost|expense|outgoing|repayment|deposit|equity|debt|loan|rent|yield|cash|fee|rate|charge|evidence|source|coverage|section|page|check|step|item)\b/i;
const POPULATION_SHARE =
  /\b(?:household|resident|population|tenant|renter|occupier|owner|dwelling|family|famil|demograph|age|income\s+band|sale|transaction|buyer|people|person)\b/i;

function shareDescribesAPopulation(d: VizDirective): boolean {
  const text = [
    'title' in d ? d.title ?? '' : '',
    'label' in d ? d.label ?? '' : '',
    'sub' in d ? d.sub ?? '' : '',
    'segments' in d ? d.segments.map((s) => s.label).join(' ') : '',
    'items' in d && Array.isArray(d.items)
      ? d.items.map((i) => ('label' in i ? String(i.label) : '')).join(' ')
      : '',
  ].join(' ');
  if (SELF_MEASURED_SHARE.test(text) && !POPULATION_SHARE.test(text)) return false;
  return POPULATION_SHARE.test(text);
}

/** A `margin` spark of a quantity the client-safe gate refused to publish. */
const SERIES_SUBJECT: Array<{ re: RegExp; fact: RegExp }> = [
  { re: /\b(?:population|ERP|resident|demograph)\b/i, fact: /demograph/i },
];

function seriesIsWithheld(d: VizDirective, inv: EvidenceInventory): string | null {
  if (d.kind !== 'margin') return null;
  const text = `${d.heading ?? ''} ${d.label ?? ''} ${d.note ?? ''}`;
  for (const s of SERIES_SUBJECT) {
    if (!s.re.test(text)) continue;
    const withheld = inv.withheldFacts.find((n) => s.fact.test(n));
    if (withheld) return withheld;
  }
  return null;
}

/**
 * Judge every directive in a document against what its record holds.
 *
 * Reports, and does not change anything. `enforceChartEvidence` is what acts.
 */
export function assessChartEvidence(
  markdown: string,
  inv: EvidenceInventory,
): ChartEvidenceFinding[] {
  const out: ChartEvidenceFinding[] = [];
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{{')) continue;
    const parsed = parseVizDirectives(t);
    if (!parsed.length) continue;
    const d = parsed[0];
    const claim = claimOf(d);
    const directive = t.length > 190 ? `${t.slice(0, 189)}…` : t;

    if (claim === 'share' && shareDescribesAPopulation(d) && !inv.demographics) {
      out.push({
        verdict: 'population_not_held',
        claim,
        kind: d.kind,
        directive,
        reason:
          'The shares describe a population — households, dwellings, occupiers or transactions — and '
          + 'no demographics producer answered for this report, so there is no table behind the '
          + 'denominator and no period the shares belong to.',
      });
      continue;
    }

    const withheld = seriesIsWithheld(d, inv);
    if (withheld) {
      out.push({
        verdict: 'series_withheld',
        claim,
        kind: d.kind,
        directive,
        reason:
          `The report-time snapshot records "${withheld}" as absent, which is this platform's own `
          + 'refusal to publish that quantity. A chart of it restores what the gate withheld.',
      });
    }
  }

  // Ratings are judged by the rule that already exists, so the two cannot
  // drift: one implementation, extended to every path rather than copied.
  const ratings = suppressUnrecordedVerdictVisuals(markdown, { recorded: inv.recordedScores });
  for (const r of ratings.removed) {
    out.push({
      verdict: 'unrecorded_rating',
      claim: 'rating',
      kind: r.kind,
      directive: r.directive.length > 190 ? `${r.directive.slice(0, 189)}…` : r.directive,
      reason:
        `The scoring engine did not record ${r.values.join(', ')}. `
        + (inv.recordedScores.length
          ? `What it recorded is ${inv.recordedScores.join(', ')}.`
          : 'It issued no grade at all for this report, so no rating on the page can be its own.'),
    });
  }
  return out;
}

/**
 * Withhold the drawing and keep the data.
 *
 * A directive this refuses is not deleted: it is left in place for
 * `renderVizDirective` to set as a table of its own labels and values, by the
 * same route a chart with a refused item already takes. The reader still gets
 * every label the section promised; what leaves is the claim that those
 * numbers were measured.
 *
 * The one exception is a RATING, which is removed outright, because a gauge's
 * data IS its verdict — tabulating "72 out of 100" states the same
 * unsupported thing in a narrower column.
 */
export function enforceChartEvidence(
  markdown: string,
  inv: EvidenceInventory,
): ChartEvidenceResult {
  const findings = assessChartEvidence(markdown, inv);
  if (!findings.length) return { markdown, findings };

  const ratings = new Set(
    findings.filter((f) => f.verdict === 'unrecorded_rating').map((f) => f.directive),
  );
  const tabulate = new Set(
    findings.filter((f) => f.verdict !== 'unrecorded_rating').map((f) => f.directive),
  );

  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    const key = t.length > 190 ? `${t.slice(0, 189)}…` : t;
    if (ratings.has(key)) continue;
    out.push(tabulate.has(key) ? withholdDrawing(t) : line);
  }
  return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'), findings };
}

/**
 * Mark a directive so the renderer tabulates rather than draws it.
 *
 * `refused=1` rides in the directive's own option syntax, which every parser
 * on every path already reads, so this needs no second channel and no change
 * to the four render call sites. The values stay exactly as the model wrote
 * them — this withholds a DRAWING, not a figure.
 */
export const WITHHELD_DRAWING_OPTION = 'basis=withheld';

function withholdDrawing(directive: string): string {
  if (directive.includes(WITHHELD_DRAWING_OPTION)) return directive;
  return directive.replace(/\}\}\s*$/, ` | ${WITHHELD_DRAWING_OPTION}}}`);
}
