/**
 * The Portfolio Performance Review, drawn in the ten Investment Compass families.
 *
 * The third report format on the family system, after Investment Compass and
 * the Borrowing Capacity Snapshot. It shares `master.ts` with both and
 * contributes only its own page sequence — see
 * `docs/template-library/07-investment-compass-families.md`.
 *
 * ## The inventory is bounded on purpose
 *
 * `docs/reports/PORTFOLIO.md` opens on four findings against the shipping
 * generator, and two of them are about this page model failing to hold a
 * portfolio: **F1**, a contents page whose numbers go out of true the moment a
 * table spills; and **F4**, an inventory that silently drops rows because the
 * continuation index is computed at a row height of 20 while the table was
 * drawn at 22, "and the rows in between are never printed… a portfolio needing
 * a third page loses everything past the second, with nothing on the page
 * saying so".
 *
 * This template model cannot paginate at all — blocks are absolutely positioned
 * and nothing reflows — so it must not pretend to. The inventory here is a
 * **fixed four rows**, which is the observed maximum (`total_properties` runs
 * 1–4 across all 21 stored reports), and the page says what it is showing.
 * Silently truncating a fifth property would reproduce F4 in a new generator,
 * which is the one outcome this migration exists to prevent.
 *
 * ## Prose is bound only where the leaf is a string
 *
 * `analysis.executiveSummary` and `strategicRecommendations` are **objects**,
 * not paragraphs. The projection only publishes leaves that are genuinely
 * strings, so nothing here can reach a page as `[object Object]`.
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
  kpiCapacity,
  kpis,
  page,
  prose,
  recommendation,
  rule,
  sectionHeading,
  strengthsWatch,
  table,
  verdict,
  withFurniture,
  type KpiItem,
  type PageDef,
} from './blocks';
import { hasContents } from './resolvers';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

const FOOTER = '{{client.name}} · Portfolio performance review';
const DOCUMENT_LABEL = 'Portfolio Performance Review';

/** The observed maximum across all 21 stored reports. See the header. */
const INVENTORY_ROWS = 4;

const PORTFOLIO_FORMAT: ReportFormat = {
  key: 'portfolio-review',
  reportType: 'portfolio',
  category: 'portfolio',
  tier: 'compass',
  label: 'Portfolio Performance Review',
  extraTags: ['portfolio', 'performance-review', 'holdings'],
};

/**
 * The figures across the top of the summary.
 *
 * `summary.healthScore` is a score **out of 100** (25–90 across the sample), not
 * a percentage — so it is set with `| fixed:0` and labelled, never `| percent`.
 */
const SUMMARY_KPIS: KpiItem[] = [
  { label: 'Portfolio value', value: '{{portfolio.value | currency}}', note: '{{portfolio.propertyCount}} properties' },
  { label: 'Total equity', value: '{{portfolio.equity | currency}}', note: 'Value less debt' },
  { label: 'Health score', value: '{{summary.healthScore | fixed:0}}', note: 'out of 100 · {{summary.overallHealth}}' },
  { label: 'Monthly cash flow', value: '{{portfolio.monthlyCashflow | currency}}', note: '{{portfolio.annualCashflow | currency}} p.a.' },
  { label: 'Average LVR', value: '{{portfolio.averageLvr | percent}}', note: 'Across the portfolio' },
  { label: 'Average yield', value: '{{portfolio.averageYield | percent}}', note: 'Gross, on value' },
];

/** One inventory row, bound by index. */
function propertyRow(i: number): string[] {
  return [
    `{{properties.${i}.address}}`,
    `{{properties.${i}.value | currency}}`,
    `{{properties.${i}.loan | currency}}`,
    `{{properties.${i}.lvr | percent:0}}`,
    `{{properties.${i}.grossYield | percent}}`,
    `{{properties.${i}.netMonthlyCashflow | currency}}`,
  ];
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const spacious = manifest.density === 'spacious';

  let partNo = 0;
  const nextPart = (label: string): string =>
    `Part ${String((partNo += 1)).padStart(2, '0')} · ${label}`;
  const nextNumeral = (): string => String(partNo).padStart(2, '0');

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Portfolio Review',
    tagline: 'Your dedicated property partner',
    marker: 'Portfolio Review',
    eyebrow: 'Portfolio performance review',
    title: '{{client.name}}',
    standfirst: 'How the holdings are performing, what is carrying them, and what would move them.',
    locations: 'Prepared {{report.generatedDate}}',
    facts: [
      { label: 'Portfolio value', value: '{{portfolio.value | currency}}' },
      { label: 'Properties', value: '{{portfolio.propertyCount}}' },
      { label: 'Health', value: '{{summary.overallHealth}}' },
      { label: 'Monthly position', value: '{{portfolio.monthlyCashflow | currency}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this review', heading: 'Contents', numeral: nextNumeral() }),
        contents([
          'The portfolio at a glance',
          'Holdings',
          'Financial health',
          'Risk assessment',
          'Recommended actions',
          'Important information',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 At a glance ───────────────────────────────────────────────────────
  pages.push(withFurniture(page('Portfolio at a glance', [
    ...furniture(DOCUMENT_LABEL, nextPart('Overview'), 'Portfolio at a glance'),
    ...flow([
      sectionHeading({
        eyebrow: 'The position',
        heading: '{{summary.overallHealth}}',
        numeral: nextNumeral(),
      }),
      verdict({
        eyebrow: 'Primary recommendation',
        heading: '{{summary.primaryRecommendation}}',
        body: '{{health.analysis}}',
      }),
      kpis(SUMMARY_KPIS.slice(0, kpiCapacity())),
      strengthsWatch(
        ['{{summary.strengths.0}}', '{{summary.strengths.1}}'],
        ['{{summary.concerns.0}}', '{{summary.concerns.1}}'],
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 03 Holdings ──────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Holdings', [
    ...furniture(DOCUMENT_LABEL, nextPart('Holdings'), 'Holdings'),
    ...flow([
      sectionHeading({
        eyebrow: 'The inventory',
        heading: 'Every property, and what it contributes',
        numeral: nextNumeral(),
        standfirst: `This page draws up to ${INVENTORY_ROWS} holdings. A blank row is a `
          + 'property the portfolio does not have, not one left out here.',
      }),
      table({
        headers: ['Property', 'Value', 'Loan', 'LVR', 'Yield', 'Monthly'],
        rows: Array.from({ length: INVENTORY_ROWS }, (_, i) => propertyRow(i)),
        columnWidths: [0.31, 0.15, 0.15, 0.11, 0.12, 0.16],
      }),
      table({
        headers: ['Portfolio totals', 'Amount'],
        rows: [
          ['Total value', '{{portfolio.value | currency}}'],
          ['Total debt', '{{portfolio.debt | currency}}'],
          ['Total equity', '{{portfolio.equity | currency}}'],
          ['Monthly rental income', '{{portfolio.monthlyRentalIncome | currency}}'],
          ['Monthly expenses', '{{portfolio.monthlyExpenses | currency}}'],
          ['Net monthly position', '{{portfolio.monthlyCashflow | currency}}'],
        ],
        columnWidths: [0.62, 0.38],
        totals: [5],
      }),
      // F4, said out loud. The finding against the shipping generator is not
      // that it truncates — a fixed-position page model has to stop somewhere —
      // it is that it truncates "with nothing on the page saying so". This
      // costs its height whether or not it renders, which is the price of a
      // conditional in a layout that cannot reflow, and it is worth paying.
      {
        ...callout(
          'This page does not show the whole portfolio',
          `The portfolio holds {{portfolio.propertyCount}} properties and the table above draws `
            + `${INVENTORY_ROWS}. The remaining holdings are covered by the totals and by the `
            + 'analysis that follows.',
        ),
        conditional: `portfolio && portfolio.propertyCount > ${INVENTORY_ROWS}`,
      },
    ], contentTop()),
  ]), FOOTER));

  // ── 04 Financial health ──────────────────────────────────────────────────
  pages.push(withFurniture(page('Financial health', [
    ...furniture(DOCUMENT_LABEL, nextPart('Health'), 'Financial health'),
    ...flow([
      sectionHeading({
        eyebrow: 'Serviceability and equity',
        heading: 'How the portfolio is holding up',
        numeral: nextNumeral(),
      }),
      definitions('Assessment', [
        { term: 'Cash flow', definition: '{{health.cashflowStatus}}' },
        { term: 'Debt serviceability', definition: '{{health.debtServiceability}}' },
        { term: 'Equity position', definition: '{{health.equityPosition}}' },
        { term: 'LVR risk', definition: '{{health.lvrRisk}}' },
      ]),
      callout('Best performer', '{{portfolio.bestPerformer.address}} — '
        + '{{portfolio.bestPerformer.netMonthlyCashflow | currency}} a month on a '
        + '{{portfolio.bestPerformer.value | currency}} holding.'),
      callout('Needs attention', '{{portfolio.worstPerformer.address}} — '
        + '{{portfolio.worstPerformer.netMonthlyCashflow | currency}} a month on a '
        + '{{portfolio.worstPerformer.value | currency}} holding.'),
    ], contentTop()),
  ]), FOOTER));

  // ── 05 Risk ──────────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Risk assessment', [
    ...furniture(DOCUMENT_LABEL, nextPart('Risk'), 'Risk assessment'),
    ...flow([
      sectionHeading({
        eyebrow: 'Exposure',
        heading: '{{risk.overallRiskLevel}}',
        numeral: nextNumeral(),
      }),
      // The stored leaf names, not shortened ones. `{{risk.vacancy}}` already
      // means "reaction to three months vacancy" to the voice templates, and
      // one namespace cannot carry both senses — see the note in
      // `portfolioProjection.pure.ts`.
      //
      // These three are single sentences on all 21 stored reports. The other
      // two fields of the same object are LISTS, which is why they are drawn
      // below rather than as two more rows here.
      definitions('Where the exposure sits', [
        { term: 'Concentration', definition: '{{risk.concentrationRisk}}' },
        { term: 'Vacancy', definition: '{{risk.vacancyRisk}}' },
        { term: 'Interest rate', definition: '{{risk.interestRateSensitivity}}' },
      ]),
      rule(),
      // The exposures against what is being done about them: the same
      // positive/caution reading the summary page uses, relabelled. Counts are
      // the observed minimums — 4 mitigations and 2 market risks — so neither
      // column draws a row the analysis did not write.
      strengthsWatch(
        [
          '{{risk.mitigationStrategies.0}}',
          '{{risk.mitigationStrategies.1}}',
          '{{risk.mitigationStrategies.2}}',
          '{{risk.mitigationStrategies.3}}',
        ],
        ['{{risk.marketRisks.0}}', '{{risk.marketRisks.1}}'],
        { strengths: 'Mitigation', watch: 'Market risks' },
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 06 Actions ───────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Recommended actions', [
    ...furniture(DOCUMENT_LABEL, nextPart('Actions'), 'Recommended actions'),
    ...flow([
      sectionHeading({
        eyebrow: 'What would move this',
        heading: 'Recommended actions',
        numeral: nextNumeral(),
      }),
      definitions('Priority', [
        { term: 'First', definition: '{{actions.priority.0}}' },
        { term: 'Second', definition: '{{actions.priority.1}}' },
        { term: 'Third', definition: '{{actions.priority.2}}' },
      ]),
      // Each horizon is a LIST of 1-4 actions, not the single statement its
      // name suggests. One row each is what every stored report can fill; the
      // notice below covers the reports that carry more.
      definitions('By horizon', [
        { term: 'Short term', definition: '{{actions.shortTerm.0}}' },
        { term: 'Medium term', definition: '{{actions.mediumTerm.0}}' },
        { term: 'Long term', definition: '{{actions.longTerm.0}}' },
      ]),
      {
        ...callout(
          'The analysis lists more than this page shows',
          'Where a horizon carries several actions, the first is printed here. '
            + 'The full list is in the analysis this review was drawn from.',
        ),
        conditional: 'actions && (actions.priority.length > 3'
          + ' || actions.shortTerm.length > 1'
          + ' || actions.mediumTerm.length > 1'
          + ' || actions.longTerm.length > 1)',
      },
      recommendation('{{summary.overallHealth}}', '{{summary.primaryRecommendation}}'),
    ], contentTop()),
  ]), FOOTER));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: PORTFOLIO_FORMAT });
}

/** Every Portfolio Performance Review master, by family, in catalogue order. */
export const PORTFOLIO_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
