/**
 * The Property Comparison Analysis, drawn in the ten Investment Compass families.
 *
 * The fourth report format on the family system. It shares `master.ts` with the
 * other three and contributes only its own page sequence — see
 * `docs/template-library/07-investment-compass-families.md`.
 *
 * ## This format compares 2 to 5 properties, and the count is not a constant
 *
 * Every other format on this system draws a fixed thing. This one draws a
 * ranking whose length is the comparison's own: 7 of the 50 stored rows compare
 * two properties, 17 compare three, 9 compare four and 17 compare five.
 *
 * A five-row table would print three empty rows on the two-property
 * comparisons, which reads as a document that failed to finish. A two-row table
 * would silently drop three properties, which is `PORTFOLIO.md`'s F4 in a new
 * format. So the ranking is drawn **four times, once per count, each carrying a
 * conditional, all at the same position** — one renders and the rest do not
 * exist. See `FlowItem.block` in `blocks.ts`.
 *
 * The same shape applies to the risk register, the investor matches and the red
 * flags: one block per property, each conditional on that property existing.
 * Those cost their height whether or not they render, which is the price of a
 * conditional in a layout that cannot reflow.
 *
 * ## Nothing here is a figure
 *
 * A comparison carries no deterministic numbers at all — every field was
 * written by a model in one response. The single number, `finalScore`, is on
 * **two scales** across the table, so it is never printed without its
 * denominator beside it. `comparisonProjection.pure.ts` records the rest.
 */
import {
  DESIGN_FAMILIES,
  resolveManifest,
  type DesignFamily,
  type VariantDefinition,
} from './family';
import {
  beginCompassTemplate,
  callout,
  contents,
  contentTop,
  cover,
  definitions,
  disclaimerPage,
  flow,
  furniture,
  ifItFits,
  kpiCapacity,
  kpis,
  page,
  prose,
  rule,
  sectionHeading,
  strengthsWatch,
  table,
  textHeight,
  withFurniture,
  type BlockDef,
  type FlowItem,
  type KpiItem,
  type PageDef,
} from './blocks';
import { hasContents } from './resolvers';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

/**
 * Not `{{client.name}}`. A comparison is stored against `report_ids` and
 * nothing else — and the reports it points at have **no client-name column**,
 * so `resolveClientName` could never have returned one. An unresolved binding
 * renders as the empty string, so the foot of every page read
 * " · Property comparison analysis" and the cover title was blank. Found by the
 * binding audit written for the Cash Flow format; see `cashFlowAdapter.ts`.
 */
const FOOTER = 'Property comparison analysis · {{comparison.propertyCount}} properties';
const DOCUMENT_LABEL = 'Property Comparison Analysis';

/** The observed range across all 50 stored comparisons. */
const MIN_PROPERTIES = 2;
const MAX_PROPERTIES = 5;

/**
 * The longest each bound field runs across the 50 stored comparisons.
 *
 * Measured, because a height that is too small does not overflow the page — it
 * lays one block over the next, invisibly to `flow()`'s arithmetic guard. See
 * `textHeight` in `blocks.ts`.
 *
 * The one that shapes this document is `axisReason` at 604: eleven superlatives
 * at that length is 6,600 characters of prose, which is why the reasons get
 * three pages of their own rather than sitting under the scorecard.
 */
const LENGTHS = {
  summary: 1851,
  axisReason: 604,
  bestOverallReason: 571,
  avoidReason: 400,
  runnerReason: 383,
  scenario: 517,
  investorReasoning: 399,
  rankingBullet: 123,
  bestSuitedFor: 142,
  specificRisk: 106,
  flagConcern: 145,
} as const;

const COMPARISON_FORMAT: ReportFormat = {
  key: 'comparison-analysis',
  reportType: 'comparison',
  category: 'comparison',
  tier: 'compass',
  label: 'Property Comparison Analysis',
  extraTags: ['comparison', 'shortlist', 'ranking'],
};

/**
 * The figures across the top of the verdict page.
 *
 * The top score is set beside its denominator — `88.5 / 100` — and never alone.
 * 17 comparisons score out of 100 and 6 out of 10, and the ten-point group runs
 * to the most recent row in the table, so a bare figure is ambiguous on the
 * page as well as in the record.
 */
const VERDICT_KPIS: KpiItem[] = [
  { label: 'Properties compared', value: '{{comparison.propertyCount}}', note: '{{comparison.statesLine}}' },
  { label: 'Top score', value: '{{comparison.ranked.0.score}} / {{comparison.ranked.0.outOf}}', note: '{{comparison.ranked.0.shortAddress}}' },
  { label: 'Time horizon', value: '{{comparison.basis.timeHorizon}}', note: 'As set for the analysis' },
  { label: 'Risk tolerance', value: '{{comparison.basis.riskTolerance}}', note: 'As set for the analysis' },
  { label: 'Depth', value: '{{comparison.basis.depth}}', note: 'Analysis mode' },
  { label: 'Profile', value: '{{comparison.basis.investorProfile}}', note: 'Investor profile' },
];

/** One ranking row. */
function rankingRow(i: number): string[] {
  return [
    `{{comparison.ranked.${i}.rank}}`,
    `{{comparison.ranked.${i}.address}}`,
    `{{comparison.ranked.${i}.score}} / {{comparison.ranked.${i}.outOf}}`,
    `{{comparison.ranked.${i}.riskLevel}}`,
  ];
}

/**
 * The ranking, drawn once per property count.
 *
 * All four variants sit at the same `y` under mutually exclusive conditionals,
 * so exactly one renders and no comparison prints a blank row or loses a
 * property. The item's height is the tallest variant's.
 */
function rankingTable(): FlowItem {
  const widths = [0.1, 0.52, 0.2, 0.18];
  const headers = ['Rank', 'Property', 'Score', 'Risk'];
  const variants: Array<{ rows: number; when: string }> = [];
  for (let n = MIN_PROPERTIES; n <= MAX_PROPERTIES; n += 1) {
    variants.push({
      rows: n,
      when: n === MIN_PROPERTIES
        ? `comparison && comparison.ranked && comparison.ranked.length <= ${n}`
        : n === MAX_PROPERTIES
          ? `comparison && comparison.ranked && comparison.ranked.length >= ${n}`
          : `comparison && comparison.ranked && comparison.ranked.length === ${n}`,
    });
  }

  const built = variants.map((v) => ({
    when: v.when,
    item: table({
      headers,
      rows: Array.from({ length: v.rows }, (_, i) => rankingRow(i)),
      columnWidths: widths,
      numeric: [0, 2],
    }),
  }));
  const height = Math.max(...built.map((b) => b.item.height));

  return {
    height,
    block: (y): BlockDef[] => built.map((b) => {
      const emitted = b.item.block(y);
      const one = Array.isArray(emitted) ? emitted[0] : emitted;
      return { ...one, conditional: b.when };
    }),
  };
}

/**
 * One block per property, each conditional on that property existing.
 *
 * The register sections carry 2 to 5 entries, and there is no arrangement that
 * suits every count — so every slot is drawn and the absent ones do not render.
 * They still cost their height, because nothing in this model reflows.
 */
function perProperty(
  build: (i: number) => FlowItem,
  exists: (i: number) => string,
): FlowItem[] {
  return Array.from({ length: MAX_PROPERTIES }, (_, i) => ({
    ...build(i),
    conditional: exists(i),
  }));
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);

  let partNo = 0;
  const nextPart = (label: string): string =>
    `Part ${String((partNo += 1)).padStart(2, '0')} · ${label}`;
  const nextNumeral = (): string => String(partNo).padStart(2, '0');

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Comparison',
    tagline: 'Your dedicated property partner',
    marker: 'Comparison',
    eyebrow: 'Property comparison analysis',
    // The subject, not the client — see the note on FOOTER. `propertyCount` is
    // stored on all 50 comparisons.
    title: '{{comparison.propertyCount}} properties, compared',
    standfirst: 'Every property side by side, ranked, and the one the analysis would buy.',
    locations: 'Prepared {{report.generatedDate}}',
    facts: [
      { label: 'Properties', value: '{{comparison.propertyCount}}' },
      { label: 'Ranked first', value: '{{comparison.ranked.0.shortAddress}}' },
      { label: 'Top score', value: '{{comparison.ranked.0.score}} / {{comparison.ranked.0.outOf}}' },
      { label: 'Where', value: '{{comparison.statesLine}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this analysis', heading: 'Contents', numeral: nextNumeral() }),
        contents([
          'The verdict',
          'Executive summary',
          'The ranking',
          'The scorecard',
          'Money · return, cash flow',
          'Location · catchment, amenity',
          'Risk · exposure, reward',
          'Risk register',
          'Who each property suits',
          'What to do',
          'Alternatives and basis',
          'Important information',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 The verdict ───────────────────────────────────────────────────────
  pages.push(withFurniture(page('The verdict', [
    ...furniture(DOCUMENT_LABEL, nextPart('Verdict'), 'The verdict'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'The analysis would buy',
        heading: '{{comparison.recommendations.bestOverall.winner}}',
        numeral: nextNumeral(),
      }),
      callout(
        'Why',
        '{{comparison.recommendations.bestOverall.reason}}',
        textHeight(LENGTHS.bestOverallReason, { size: c.scale.cell, extra: 34 }),
      ),
      kpis(VERDICT_KPIS.slice(0, kpiCapacity())),
    ], [
      // A sentence this format builds itself rather than one the model wrote —
      // how many properties, where, which ranks first and what it scored.
      prose('{{comparison.narrative}}', textHeight(260)),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 03 Executive summary ─────────────────────────────────────────────────
  pages.push(withFurniture(page('Executive summary', [
    ...furniture(DOCUMENT_LABEL, nextPart('Summary'), 'Executive summary'),
    ...flow([
      sectionHeading({
        eyebrow: 'In the analysis’s own words',
        heading: 'Executive summary',
        numeral: nextNumeral(),
      }),
      prose('{{comparison.summary}}', textHeight(LENGTHS.summary, { lineHeight: 1.62 })),
    ], contentTop()),
  ]), FOOTER));

  // ── 04 The ranking ───────────────────────────────────────────────────────
  pages.push(withFurniture(page('The ranking', [
    ...furniture(DOCUMENT_LABEL, nextPart('Ranking'), 'The ranking'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Best first',
        heading: 'How they ranked',
        numeral: nextNumeral(),
        standfirst: 'Scores are shown against the scale the analysis recorded them on. '
          + 'A rank is not always unique — two properties can tie.',
      }),
      rankingTable(),
      // The top two, which every comparison has.
      strengthsWatch(
        ['{{comparison.ranked.0.strengths.0}}', '{{comparison.ranked.0.strengths.1}}', '{{comparison.ranked.0.strengths.2}}'],
        ['{{comparison.ranked.0.concerns.0}}', '{{comparison.ranked.0.concerns.1}}', '{{comparison.ranked.0.concerns.2}}'],
        { strengths: 'Ranked first · strengths', watch: 'Ranked first · concerns' },
        LENGTHS.rankingBullet,
      ),
    ], [
      definitions('Best suited for', [
        { term: '{{comparison.ranked.0.shortAddress}}', definition: '{{comparison.ranked.0.bestSuitedFor}}' },
        { term: '{{comparison.ranked.1.shortAddress}}', definition: '{{comparison.ranked.1.bestSuitedFor}}' },
      ], LENGTHS.bestSuitedFor),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 05 The scorecard ─────────────────────────────────────────────────────
  //
  // All eleven superlatives on one page, as who-won and the figure where the
  // record carries one. The reasons are three pages of prose and follow.
  const scorecardRow = (group: string, i: number): string[] => [
    `{{comparison.axes.${group}.winners.${i}.label}}`,
    `{{comparison.axes.${group}.winners.${i}.winner}}`,
    `{{comparison.axes.${group}.winners.${i}.value}}`,
  ];
  pages.push(withFurniture(page('The scorecard', [
    ...furniture(DOCUMENT_LABEL, nextPart('Scorecard'), 'The scorecard'),
    ...flow([
      sectionHeading({
        eyebrow: 'Who wins what',
        heading: 'Eleven axes, side by side',
        numeral: nextNumeral(),
        standfirst: 'Where the analysis named nobody, the row says so. That is an answer '
          + 'rather than a gap — it happens on about one axis in six.',
      }),
      table({
        headers: ['Axis', 'Winner', 'Figure'],
        rows: [
          ...[0, 1, 2, 3].map((i) => scorecardRow('money', i)),
          ...[0, 1, 2, 3].map((i) => scorecardRow('place', i)),
          ...[0, 1, 2].map((i) => scorecardRow('risk', i)),
        ],
        columnWidths: [0.34, 0.44, 0.22],
        numeric: [2],
      }),
    ], contentTop()),
  ]), FOOTER));

  // ── 06-11 Why, two axes to a page ────────────────────────────────────────
  //
  // Two, not four. A superlative's `reason` runs to 604 characters across the
  // stored comparisons, so four of them is 2,400 characters of set prose plus
  // its labels — more than the roomier families have measure for, and the first
  // draft of this format ran 154pt past the footer on five of them.
  const reasonPage = (
    name: string, eyebrow: string, heading: string, group: string, from: number, count: number,
  ): PageDef => withFurniture(page(name, [
    ...furniture(DOCUMENT_LABEL, nextPart(name), name),
    ...flow([
      sectionHeading({ eyebrow, heading, numeral: nextNumeral() }),
      definitions(
        'In the analysis’s words',
        Array.from({ length: count }, (_, k) => ({
          term: `{{comparison.axes.${group}.winners.${from + k}.label}}`,
          definition: `{{comparison.axes.${group}.winners.${from + k}.reason}}`,
        })),
        LENGTHS.axisReason,
      ),
    ], contentTop()),
  ]), FOOTER);

  pages.push(reasonPage('Money · return', 'Return and yield', 'Who wins on the money, and why', 'money', 0, 2));
  pages.push(reasonPage('Money · cash flow', 'Cash flow and value', 'Who wins on the money, and why', 'money', 2, 2));
  pages.push(reasonPage('Location · catchment', 'Schools and corridor', 'Who wins on location, and why', 'place', 0, 2));
  pages.push(reasonPage('Location · amenity', 'Infrastructure and lifestyle', 'Who wins on location, and why', 'place', 2, 2));
  pages.push(reasonPage('Risk · exposure', 'Lowest and highest', 'Who carries the risk, and why', 'risk', 0, 2));

  // The last axis, with the red flags beside it — a single-axis page would be
  // thin, and a flag is the same kind of statement.
  pages.push(withFurniture(page('Risk · reward', [
    ...furniture(DOCUMENT_LABEL, nextPart('Risk · reward'), 'Risk · reward'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Best rewarded',
        heading: 'Where the risk is paid for',
        numeral: nextNumeral(),
      }),
      definitions('In the analysis’s words', [{
        term: '{{comparison.axes.risk.winners.2.label}}',
        definition: '{{comparison.axes.risk.winners.2.reason}}',
      }], LENGTHS.axisReason),
    ], [
      // Red flags run 2-5 an analysis. Two are drawn where there is room.
      {
        ...definitions('Flagged', [
          { term: '{{comparison.redFlags.0.winner}} · {{comparison.redFlags.0.severity}}', definition: '{{comparison.redFlags.0.concerns.0}}' },
          { term: '{{comparison.redFlags.1.winner}} · {{comparison.redFlags.1.severity}}', definition: '{{comparison.redFlags.1.concerns.0}}' },
        ], LENGTHS.flagConcern),
        conditional: 'comparison && comparison.redFlags && comparison.redFlags[1]',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 09 Risk register ─────────────────────────────────────────────────────
  pages.push(withFurniture(page('Risk register', [
    ...furniture(DOCUMENT_LABEL, nextPart('Register'), 'Risk register'),
    ...flow([
      sectionHeading({
        eyebrow: 'Property by property',
        heading: 'What each one carries',
        numeral: nextNumeral(),
      }),
      ...perProperty(
        (i) => callout(
          '{{comparison.risks.' + i + '.shortAddress}} · {{comparison.risks.' + i + '.level}}',
          `{{comparison.risks.${i}.specificRisks.0}} · {{comparison.risks.${i}.specificRisks.1}}`,
          textHeight(LENGTHS.specificRisk * 2, { size: c.scale.cell, extra: 30 }),
        ),
        (i) => `comparison && comparison.risks && comparison.risks[${i}]`,
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── Who each property suits, three to a page ─────────────────────────────
  //
  // An investor rationale runs to 399 characters and a comparison carries 2-5
  // of them. Three to a page fits every family; five did not.
  const suitsPage = (name: string, from: number, count: number, standfirst?: string): PageDef =>
    withFurniture(page(name, [
      ...furniture(DOCUMENT_LABEL, nextPart('Suitability'), name),
      ...flow([
        sectionHeading({
          eyebrow: 'Investor fit',
          heading: 'Who each property is for',
          numeral: nextNumeral(),
          ...(standfirst ? { standfirst } : {}),
        }),
        ...Array.from({ length: count }, (_, k) => ({
          ...callout(
            `{{comparison.matches.${from + k}.winner}} · {{comparison.matches.${from + k}.investorTypesLine}}`,
            `{{comparison.matches.${from + k}.reasoning}}`,
            textHeight(LENGTHS.investorReasoning, { size: c.scale.cell, extra: 30 }),
          ),
          conditional: `comparison && comparison.matches && comparison.matches[${from + k}]`,
        })),
      ], contentTop()),
    ]), FOOTER);

  pages.push(suitsPage(
    'Who each property suits', 0, 3,
    'The section the legacy generator never printed: its wrapper omitted the field, '
    + 'so investor matching reached neither the PDF nor its fallback.',
  ));
  // Only comparisons of four or five properties have a fourth match to show.
  pages.push({
    ...suitsPage('Who each property suits · continued', 3, 2),
    conditional: 'comparison && comparison.matches && comparison.matches[3]',
  });

  // ── 11 What to do ────────────────────────────────────────────────────────
  //
  // `runners` and `avoid` are empty on some comparisons — minimum 0 across the
  // stored rows — so both are conditional rather than drawn blank.
  pages.push(withFurniture(page('What to do', [
    ...furniture(DOCUMENT_LABEL, nextPart('Actions'), 'What to do'),
    ...flow([
      sectionHeading({
        eyebrow: 'The recommendation',
        heading: '{{comparison.recommendations.bestOverall.winner}}',
        numeral: nextNumeral(),
      }),
      {
        ...definitions('Runners-up', [
          { term: '{{comparison.recommendations.runners.0.winner}}', definition: '{{comparison.recommendations.runners.0.reason}}' },
          { term: '{{comparison.recommendations.runners.1.winner}}', definition: '{{comparison.recommendations.runners.1.reason}}' },
        ], LENGTHS.runnerReason),
        conditional: 'comparison && comparison.recommendations && comparison.recommendations.runners'
          + ' && comparison.recommendations.runners[0]',
      },
      {
        ...definitions('Not recommended', [
          { term: '{{comparison.recommendations.avoid.0.winner}}', definition: '{{comparison.recommendations.avoid.0.reason}}' },
        ], LENGTHS.avoidReason),
        conditional: 'comparison && comparison.recommendations && comparison.recommendations.avoid'
          + ' && comparison.recommendations.avoid[0]',
      },
    ], contentTop()),
  ]), FOOTER));

  // ── 12 Alternatives and basis ────────────────────────────────────────────
  pages.push(withFurniture(page('Alternatives and basis', [
    ...furniture(DOCUMENT_LABEL, nextPart('Basis'), 'Alternatives and basis'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'If the brief changed',
        heading: 'Alternatives, and what this was measured against',
        numeral: nextNumeral(),
      }),
      {
        ...definitions('Alternative scenarios', [
          { term: '{{comparison.recommendations.alternativeScenarios.0.scenario}}', definition: '{{comparison.recommendations.alternativeScenarios.0.reason}}' },
        ], LENGTHS.scenario),
        conditional: 'comparison && comparison.recommendations'
          + ' && comparison.recommendations.alternativeScenarios'
          + ' && comparison.recommendations.alternativeScenarios[0]',
      },
      rule(),
      // The assumptions behind the ranking. `analysis_summary` holds them on 44
      // of the 50 stored rows and no comparison document has ever stated them.
      definitions('Basis of the analysis', [
        { term: 'Time horizon', definition: '{{comparison.basis.timeHorizon}}' },
        { term: 'Risk tolerance', definition: '{{comparison.basis.riskTolerance}}' },
        { term: 'Analysis depth', definition: '{{comparison.basis.depth}}' },
        { term: 'Investor profile', definition: '{{comparison.basis.investorProfile}}' },
        { term: 'Model', definition: '{{comparison.basis.model}}' },
        { term: 'Analysed', definition: '{{comparison.analysedOn}}' },
      ]),
    ], [
      // Present only where the record was cut off and salvaged — a note the
      // reader needs to tell "the analysis said nothing" from "the response was
      // truncated before it got there".
      {
        ...callout(
          'About this record',
          '{{comparison.notes.0}}',
          textHeight(220, { size: c.scale.cell, extra: 30 }),
        ),
        conditional: 'comparison && comparison.notes && comparison.notes[0]',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: COMPARISON_FORMAT });
}

/** Every Property Comparison master, by family, in catalogue order. */
export const COMPARISON_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
