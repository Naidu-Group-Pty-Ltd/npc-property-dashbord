/**
 * The Borrowing Capacity Snapshot, drawn in the ten Investment Compass families.
 *
 * ## Why a second composer rather than a parameter on the first
 *
 * The family system is format-agnostic by construction — typography, density,
 * margins, KPI arrangement, table treatment and colourway carry no subject
 * matter — so all ten designs serve this format unchanged, and `master.ts`
 * compiles both catalogues through one shell. What is *not* shared is the
 * document: an Investment Compass report argues about a property and ends on a
 * ten-year projection; a Snapshot argues about a household's income and ends on
 * what a lender would advance against it. Bending one page sequence to cover
 * both with conditionals would produce a template that is neither.
 *
 * ## The pages
 *
 * Follows the structure `docs/reports/BORROWING_CAPACITY.md` records for the
 * shipping generator, minus the pages whose data does not exist:
 *
 *  | Snapshot page                    | Here                                  |
 *  |----------------------------------|---------------------------------------|
 *  | Cover                            | Cover                                 |
 *  | Summary, KPIs, assumptions, LMI  | Capacity summary (+ conditional LMI)  |
 *  | Income analysis                  | Income analysis                       |
 *  | Expenses & liabilities           | Commitments                           |
 *  | Capacity breakdown, warnings     | Serviceability, recommendations       |
 *  | How this was calculated          | **omitted** — `explanation` is null   |
 *  | Audit trail                      | **omitted** — see below               |
 *  | Closing                          | Important information                 |
 *
 * Two pages are deliberately absent. `explanation` is null on all 143 stored
 * assessments, so a "How this was calculated" page would render empty on every
 * report. The audit trail is a raw-versus-assessed ledger whose row count is
 * unbounded, and this page model is fixed-position with no reflow — a
 * twelve-entry trail would run off the paper. Both belong in the format's own
 * generator, which can paginate, rather than in a fixed template pretending to.
 *
 * ## Bindings
 *
 * Every figure binds the vocabulary `borrowingCapacityProjection.pure.ts`
 * publishes, which is itself read off the live table. Nothing here binds a
 * column name directly: the projection is the contract, and it is what keeps
 * `capacity.dti` a multiple rather than the percentage a reader would assume
 * from the column name.
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
  table,
  verdict,
  withFurniture,
  type KpiItem,
  type PageDef,
} from './blocks';
import { hasContents } from './resolvers';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

/** The running foot on every content page. */
const FOOTER = '{{client.name}} · Borrowing capacity snapshot';
/** The left half of the running head. */
const DOCUMENT_LABEL = 'Borrowing Capacity Snapshot';

/**
 * The longest each bound prose field runs across the 143 stored assessments.
 *
 * Measured, because a height that is too small does not overflow the page — it
 * lays one block over the next, and the arithmetic guard in `flow()` cannot see
 * that. See `textHeight` in `blocks.ts`. Everything else this format binds is a
 * figure, a date or a lender name, and fits the one-line default.
 */
const LENGTHS = {
  /** 270 stored recommendations, 43-70 characters. */
  recommendation: 70,
  /** 63 stored warnings, 35-59. */
  warning: 59,
} as const;

const BORROWING_CAPACITY_FORMAT: ReportFormat = {
  key: 'borrowing-capacity',
  // Resolved by the adapter registry to `borrowingCapacityAdapter`, which reads
  // `borrowing_capacity_assessments`. That is what makes these production-ready
  // rather than preview-only.
  reportType: 'borrowing_capacity',
  category: 'finance',
  tier: 'compass',
  label: 'Borrowing Capacity Snapshot',
  extraTags: ['borrowing-capacity', 'serviceability', 'lending'],
};

/**
 * The figures across the top of the summary.
 *
 * Ordered by what a client asks first. `capacity.dti` is a **multiple** of
 * income, not a percentage — the column is `dti_ratio` and reads like a rate,
 * which is exactly why it is set with `| fixed` and labelled "× income".
 */
const SUMMARY_KPIS: KpiItem[] = [
  {
    label: 'Borrowing capacity',
    value: '{{capacity.borrowing | currency}}',
    note: 'At the assessment rate',
  },
  {
    label: 'Stress tested',
    value: '{{capacity.stressTested | currency}}',
    note: 'With the buffer applied',
  },
  {
    label: 'Monthly surplus',
    value: '{{capacity.monthlySurplus | currency}}',
    note: '{{capacity.annualSurplus | currency}} p.a.',
  },
  {
    label: 'Debt to income',
    value: '{{capacity.dti | fixed:1}}',
    note: '× assessable income',
  },
  {
    label: 'Proposed loan',
    value: '{{loan.proposed | currency}}',
    note: '{{loan.lvr | percent}} LVR',
  },
  {
    label: 'Assessment rate',
    value: '{{loan.assessmentRate | percent}}',
    note: '{{loan.interestRate | percent}} + {{loan.bufferRate | percent}} buffer',
  },
];

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
    wordmarkBottom: 'Borrowing Capacity',
    tagline: 'Your dedicated property partner',
    marker: 'Borrowing Capacity',
    eyebrow: 'Borrowing capacity snapshot',
    title: '{{client.name}}',
    standfirst: 'What a lender would advance on the income, commitments and buffer stated inside.',
    locations: 'Prepared {{report.generatedDate}}',
    facts: [
      { label: 'Capacity', value: '{{capacity.borrowing | currency}}' },
      { label: 'Position', value: '{{capacity.bandLabel}}' },
      { label: 'Assessment rate', value: '{{loan.assessmentRate | percent}}' },
      { label: 'Lender', value: '{{loan.lender}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this snapshot', heading: 'Contents', numeral: nextNumeral() }),
        contents([
          'The position and the figures behind it',
          'Income analysis',
          'Commitments',
          'Serviceability and recommendations',
          'Important information',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 Capacity summary ──────────────────────────────────────────────────
  pages.push(withFurniture(page('Capacity summary', [
    ...furniture(DOCUMENT_LABEL, nextPart('Position'), 'Capacity summary'),
    ...flow([
      sectionHeading({
        eyebrow: 'The position',
        heading: '{{capacity.bandLabel}}',
        numeral: nextNumeral(),
      }),
      verdict({
        eyebrow: 'Assessed capacity',
        heading: '{{capacity.borrowing | currency}}',
        body: 'Assessed on {{income.shaded | currency}} of shaded income against '
          + '{{expenses.annual | currency}} of living expenses and '
          + '{{liabilities.annual | currency}} of existing commitments, at an assessment '
          + 'rate of {{loan.assessmentRate | percent}}.',
      }),
      kpis(SUMMARY_KPIS.slice(0, kpiCapacity())),
      callout(
        'What this means',
        'Capacity is what a lender would advance at the stated assessment rate, not a '
        + 'pre-approval. It moves with the rate, with your commitments, and with the '
        + 'lender\'s own policy.',
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 03 Income ────────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Income analysis', [
    ...furniture(DOCUMENT_LABEL, nextPart('Income'), 'Income analysis'),
    ...flow([
      sectionHeading({
        eyebrow: 'Assessable income',
        heading: 'What counts, and what is shaded',
        numeral: nextNumeral(),
        standfirst: 'Lenders discount income they consider less certain. The shaded column '
          + 'is what the assessment actually used.',
      }),
      table({
        headers: ['Component', 'Gross', 'Shading', 'Assessed'],
        rows: [
          ['{{income.items.0.component}}', '{{income.items.0.grossAmount | currency}}', '{{income.items.0.shadingRate | percent:0}}', '{{income.items.0.shadedAmount | currency}}'],
          ['{{income.items.1.component}}', '{{income.items.1.grossAmount | currency}}', '{{income.items.1.shadingRate | percent:0}}', '{{income.items.1.shadedAmount | currency}}'],
          ['{{income.items.2.component}}', '{{income.items.2.grossAmount | currency}}', '{{income.items.2.shadingRate | percent:0}}', '{{income.items.2.shadedAmount | currency}}'],
          ['{{income.items.3.component}}', '{{income.items.3.grossAmount | currency}}', '{{income.items.3.shadingRate | percent:0}}', '{{income.items.3.shadedAmount | currency}}'],
          ['Total assessable', '{{income.gross | currency}}', '', '{{income.shaded | currency}}'],
        ],
        columnWidths: [0.43, 0.19, 0.15, 0.23],
        totals: [4],
      }),
      callout(
        'Shading applied',
        '{{income.shadingApplied | currency}} of gross income was discounted before '
        + 'the assessment. The rate against each component is the lender\'s, not ours.',
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 04 Commitments ───────────────────────────────────────────────────────
  pages.push(withFurniture(page('Commitments', [
    ...furniture(DOCUMENT_LABEL, nextPart('Commitments'), 'Commitments'),
    ...flow([
      sectionHeading({
        eyebrow: 'Outgoings',
        heading: 'Living expenses and existing debt',
        numeral: nextNumeral(),
      }),
      table({
        headers: ['Living expenses', 'Monthly', 'Annual'],
        rows: [
          ['{{expenses.methodLabel}}', '{{expenses.monthly | currency}}', '{{expenses.annual | currency}}'],
          ['Declared', '{{expenses.declared | currency}}', ''],
          ['HEM benchmark', '{{expenses.hemBenchmark | currency}}', ''],
        ],
        columnWidths: [0.5, 0.25, 0.25],
      }),
      table({
        headers: ['Liability', 'Balance', 'Limit', 'Monthly'],
        rows: [
          ['{{liabilities.items.0.type}}', '{{liabilities.items.0.balance | currency}}', '{{liabilities.items.0.limit | currency}}', '{{liabilities.items.0.monthlyServicing | currency}}'],
          ['{{liabilities.items.1.type}}', '{{liabilities.items.1.balance | currency}}', '{{liabilities.items.1.limit | currency}}', '{{liabilities.items.1.monthlyServicing | currency}}'],
          ['{{liabilities.items.2.type}}', '{{liabilities.items.2.balance | currency}}', '{{liabilities.items.2.limit | currency}}', '{{liabilities.items.2.monthlyServicing | currency}}'],
          ['Total servicing', '', '', '{{liabilities.monthly | currency}}'],
        ],
        columnWidths: [0.37, 0.21, 0.21, 0.21],
        totals: [3],
      }),
    ], contentTop()),
  ]), FOOTER));

  // ── 05 Serviceability ────────────────────────────────────────────────────
  pages.push(withFurniture(page('Serviceability', [
    ...furniture(DOCUMENT_LABEL, nextPart('Serviceability'), 'Serviceability'),
    ...flow([
      sectionHeading({
        eyebrow: 'How the assessment was set',
        heading: 'The rate, the buffer and the term',
        numeral: nextNumeral(),
      }),
      // Every definition here is a figure or a lender name — one line, which is
      // the default reserve. Measured, not assumed: `assumptions
      // .selectedLenderName` is at most 30 characters.
      definitions('Assessment basis', [
        { term: 'Lender', definition: '{{loan.lender}}' },
        { term: 'Interest rate used', definition: '{{loan.interestRate | percent}}' },
        { term: 'Serviceability buffer', definition: '{{loan.bufferRate | percent}}' },
        { term: 'Assessment rate', definition: '{{loan.assessmentRate | percent}}' },
        { term: 'Loan term', definition: '{{loan.termYears}} years' },
        { term: 'Expense method', definition: '{{expenses.methodLabel}}' },
      ]),
      // 3 of 143 assessments carry LMI. The page must not print an empty panel
      // for the other 140, so the whole block is conditional on the projection
      // having emitted an LMI namespace at all.
      {
        ...callout(
          'Lenders mortgage insurance',
          'LMI of {{lmi.amount | currency}} applies above {{lmi.lvrTrigger | percent}} LVR '
          + 'and is included in the figures above.',
        ),
        conditional: 'lmi && lmi.amount',
      },
      rule(),
      prose(
        'Capacity is assessed at a rate above the one you would pay, so the loan stays '
        + 'serviceable if rates move. It is not a pre-approval and not an offer.',
        spacious ? 92 : 76,
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 06 Recommendations ───────────────────────────────────────────────────
  pages.push(withFurniture(page('Recommendations', [
    ...furniture(DOCUMENT_LABEL, nextPart('Recommendations'), 'Recommendations'),
    ...flow([
      sectionHeading({
        eyebrow: 'What would move this',
        heading: 'Recommendations',
        numeral: nextNumeral(),
      }),
      // 43-70 characters an item across the 270 stored recommendations, which
      // is one to two lines at this measure — not the single line a definition
      // list reserves by default. See `textHeight` in `blocks.ts`: a height
      // that is too small does not overflow the page, it lays this block over
      // the one below it, and the arithmetic guard cannot see that.
      definitions('Actions', [
        { term: 'First', definition: '{{recommendations.0}}' },
        { term: 'Second', definition: '{{recommendations.1}}' },
        { term: 'Third', definition: '{{recommendations.2}}' },
      ], LENGTHS.recommendation),
      // Warnings are present on 41 of 143 assessments.
      {
        ...definitions('Warnings', [
          { term: 'Note', definition: '{{warnings.0}}' },
          { term: 'Note', definition: '{{warnings.1}}' },
        ], LENGTHS.warning),
        conditional: 'warnings && warnings[0]',
      },
      recommendation(
        '{{capacity.bandLabel}}',
        'Assessed capacity of {{capacity.borrowing | currency}}, stress tested to '
        + '{{capacity.stressTested | currency}}.',
      ),
    ], contentTop()),
  ]), FOOTER));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: BORROWING_CAPACITY_FORMAT });
}

/** Every Borrowing Capacity master, by family, in catalogue order. */
export const BORROWING_CAPACITY_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
