/**
 * Commercial & Industrial Capacity on the Investment Compass families.
 *
 * ## Built around a decline, because that is the whole corpus
 *
 * Sixteen assessments exist. Thirteen have no calculation run at all — seven
 * `draft`, four `archived`, two `data_entry` — and the adapter declines those,
 * so no master ever draws them. Of the three that carry figures, **all three are
 * `outside_current_assumptions` and all three are bound by the debt service
 * coverage ratio**.
 *
 * A decline is therefore not an edge case to be handled after the happy path; it
 * is the document. The answer page leads with the outcome, the reason and the
 * binding test, and the shortfall is named as a shortfall rather than printed as
 * a negative number under a heading that says "headroom" — `differenceLabel` and
 * `differenceAbsolute` exist in the projection for exactly that.
 *
 * ## Every figure comes from the stored run
 *
 * The format's first rule. Nothing here derives a number: each bound path
 * resolves to a value the engine wrote, and the two version fields are on the
 * page so a figure can be checked against the pair that produced it.
 *
 * ## The analysis page says a model wrote it
 *
 * The contract's fourth rule is that the page says what it is. The provenance
 * note is bound from `capacity.analysisProvenance`, which the projection
 * publishes with the analysis or not at all — so a master cannot draw the
 * model's prose without the sentence that identifies it. It is placed above the
 * prose, not in a footnote.
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
  contentTop,
  cover,
  definitions,
  disclaimerPage,
  flow,
  kpis,
  page,
  prose,
  sectionHeading,
  table,
  textHeight,
  withFurniture,
  type KpiItem,
  type PageDef,
} from './blocks';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

const FOOTER = '{{capacity.meta.reference}} · Commercial & Industrial Capacity';
const DOCUMENT_LABEL = 'Commercial & Industrial Capacity';

/** Rows a table draws. Mirrors the projection's caps; the record's count is printed. */
const ROWS = {
  constraints: 8,
  transaction: 10,
  income: 10,
  outstanding: 6,
  nextActions: 5,
  findings: 6,
  scenarios: 3,
  questions: 6,
  method: 8,
} as const;

/** Measured against production lengths, not guessed. */
const LENGTHS = {
  narrative: 620,
  outcomeReason: 260,
  interpretation: 900,
  findingDetail: 420,
  scenarioReasoning: 300,
} as const;

const COMMERCIAL_CAPACITY_FORMAT: ReportFormat = {
  key: 'commercial-capacity',
  reportType: 'commercial_capacity',
  category: 'finance',
  tier: 'compass',
  label: 'Commercial & Industrial Capacity',
  extraTags: ['commercial', 'industrial', 'capacity', 'serviceability', 'dscr'],
};

const HAS_CAPACITY = 'capacity';
const HAS_ANALYSIS = 'capacity && capacity.analysis';

const ANSWER_KPIS: KpiItem[] = [
  {
    label: 'Maximum capacity',
    value: '{{capacity.headline.maximumCapacity | currency}}',
    note: 'On current assumptions',
  },
  {
    label: 'Requested',
    value: '{{capacity.headline.requestedLoan | currency}}',
    note: 'What was asked for',
  },
  {
    // Named by the projection, because `difference` is signed and a template
    // cannot branch on a sign.
    label: '{{capacity.headline.differenceLabel}}',
    value: '{{capacity.headline.differenceAbsolute | currency}}',
    note: 'Against the request',
  },
  {
    label: 'Contribution required',
    value: '{{capacity.headline.requiredContribution | currency}}',
    note: 'To reach the request',
  },
];

const SERVICE_KPIS: KpiItem[] = [
  { label: 'Assessment rate', value: '{{capacity.headline.assessmentRate | percent}}', note: 'Sensitised' },
  { label: 'Monthly debt service', value: '{{capacity.headline.monthlyDebtService | currency}}', note: 'On the maximum' },
  { label: 'Surplus', value: '{{capacity.headline.surplus | currency}}', note: 'Before sensitisation' },
  { label: 'Sensitised surplus', value: '{{capacity.headline.sensitisedSurplus | currency}}', note: 'After' },
];

function constraintRow(i: number): string[] {
  return [
    `{{capacity.constraints.${i}.label}}`,
    `{{capacity.constraints.${i}.actual | fixed:2}}`,
    `{{capacity.constraints.${i}.limit | fixed:2}}`,
    `{{capacity.constraints.${i}.status}}`,
  ];
}

function costRow(collection: string, i: number): string[] {
  return [
    `{{capacity.${collection}.lines.${i}.label}}`,
    `{{capacity.${collection}.lines.${i}.amount | currency}}`,
  ];
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const pages: PageDef[] = [];

  // ── Cover ────────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Capacity',
    tagline: 'Your dedicated property partner',
    marker: DOCUMENT_LABEL,
    eyebrow: '{{capacity.meta.segmentLabel}} capacity assessment',
    title: '{{capacity.meta.subject}}',
    standfirst:
      'What this facility can support on current lending assumptions, the test '
      + 'that decides it, and what would have to change.',
    locations: '{{capacity.property.address}}',
    facts: [
      { label: 'Outcome', value: '{{capacity.headline.outcomeLabel}}' },
      { label: 'Binding test', value: '{{capacity.headline.bindingConstraint}}' },
      { label: 'Reference', value: '{{capacity.meta.reference}}' },
      { label: 'Assessed', value: '{{capacity.meta.assessedOn | date}}' },
    ],
  }));

  // ── The answer ───────────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('The answer', [
      ...flow([
        sectionHeading({ eyebrow: 'The answer', heading: '{{capacity.headline.outcomeLabel}}' }),
        prose('{{capacity.headline.outcomeReason}}', textHeight(LENGTHS.outcomeReason)),
        kpis(ANSWER_KPIS),
        {
          ...callout('The binding test', '{{capacity.headline.bindingConstraint}}'),
          conditional: 'capacity && capacity.headline.bindingConstraint',
        },
        prose('{{capacity.narrative}}', textHeight(LENGTHS.narrative)),
      ], contentTop()),
    ]), FOOTER),
    conditional: HAS_CAPACITY,
  });

  // ── The tests ────────────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('The tests', [
      ...flow([
        sectionHeading({ eyebrow: 'How it was measured', heading: 'Every test, and the one that bound' }),
        table({
          headers: ['Test', 'Actual', 'Limit', 'Status'],
          rows: Array.from({ length: ROWS.constraints }, (_, i) => constraintRow(i)),
          columnWidths: [c.contentWidth - 210, 70, 70, 70],
          numeric: [1, 2],
        }),
        {
          ...callout('Not every test is shown', '{{capacity.constraintsOmitted}}'),
          conditional: 'capacity && capacity.constraintsOmitted',
        },
        kpis(SERVICE_KPIS),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.constraints',
  });

  // ── The transaction ──────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('The transaction', [
      ...flow([
        sectionHeading({ eyebrow: 'What is being funded', heading: 'The transaction' }),
        table({
          headers: ['Item', 'Amount'],
          rows: Array.from({ length: ROWS.transaction }, (_, i) => costRow('transaction', i)),
          columnWidths: [c.contentWidth - 120, 120],
        }),
        definitions('Where it lands', [
          { term: 'Total project cost', definition: '{{capacity.transaction.totalProjectCost | currency}}' },
          { term: 'Borrower contribution', definition: '{{capacity.transaction.borrowerContribution | currency}}' },
          { term: 'Funding gap', definition: '{{capacity.transaction.fundingGap | currency}}' },
        ]),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.transaction',
  });

  // ── Income ───────────────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('The income', [
      ...flow([
        sectionHeading({ eyebrow: 'What services the debt', heading: 'Property income' }),
        table({
          headers: ['Line', 'Amount'],
          rows: Array.from({ length: ROWS.income }, (_, i) => costRow('propertyIncome', i)),
          columnWidths: [c.contentWidth - 120, 120],
        }),
        definitions('What the income carries', [
          { term: 'Net operating income', definition: '{{capacity.propertyIncome.netOperatingIncome | currency}}' },
          { term: 'Capitalisation rate', definition: '{{capacity.propertyIncome.capitalisationRate | percent}}' },
          { term: 'Break-even occupancy', definition: '{{capacity.propertyIncome.breakEvenOccupancy | percent}}' },
          { term: 'WALE', definition: '{{capacity.propertyIncome.wale | fixed:1}} years' },
        ]),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.propertyIncome',
  });

  // ── What is outstanding ──────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('What is outstanding', [
      ...flow([
        sectionHeading({ eyebrow: 'Before this can progress', heading: 'Outstanding items' }),
        table({
          headers: ['Item', 'Status'],
          rows: Array.from({ length: ROWS.outstanding }, (_, i) => [
            `{{capacity.outstanding.${i}.label}}`,
            `{{capacity.outstanding.${i}.blocking}}`,
          ]),
          columnWidths: [c.contentWidth - 110, 110],
          numeric: [],
        }),
        table({
          headers: ['Next action'],
          rows: Array.from({ length: ROWS.nextActions }, (_, i) => [
            `{{capacity.nextActions.${i}.label}}`,
          ]),
          columnWidths: [c.contentWidth],
          numeric: [],
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.outstanding',
  });

  // ── The model's reading ──────────────────────────────────────────────────
  //
  // The provenance note is bound above the prose and comes from the projection,
  // which publishes it with the analysis or not at all.
  pages.push({
    ...withFurniture(page('The reading', [
      ...flow([
        sectionHeading({ eyebrow: 'Interpretation', heading: 'How this deal reads' }),
        callout('Written by a language model', '{{capacity.analysisProvenance}}'),
        prose('{{capacity.analysis.interpretation}}', textHeight(LENGTHS.interpretation)),
      ], contentTop()),
    ]), FOOTER),
    conditional: HAS_ANALYSIS,
  });

  pages.push({
    ...withFurniture(page('What stands out', [
      ...flow([
        sectionHeading({ eyebrow: 'Interpretation', heading: 'Findings' }),
        table({
          headers: ['Finding', 'Bearing', 'Detail'],
          rows: Array.from({ length: ROWS.findings }, (_, i) => [
            `{{capacity.analysis.findings.${i}.title}}`,
            `{{capacity.analysis.findings.${i}.significance}}`,
            `{{capacity.analysis.findings.${i}.detail}}`,
          ]),
          columnWidths: [130, 80, c.contentWidth - 210],
          numeric: [],
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.analysis && capacity.analysis.findings',
  });

  pages.push({
    ...withFurniture(page('What could change it', [
      ...flow([
        sectionHeading({ eyebrow: 'Interpretation', heading: 'Scenarios' }),
        table({
          headers: ['Scenario', 'Impact', 'Risk'],
          rows: Array.from({ length: ROWS.scenarios }, (_, i) => [
            `{{capacity.analysis.scenarios.${i}.name}}`,
            `{{capacity.analysis.scenarios.${i}.estimatedImpact}}`,
            `{{capacity.analysis.scenarios.${i}.executionRisk}}`,
          ]),
          columnWidths: [c.contentWidth - 220, 140, 80],
          numeric: [],
        }),
        table({
          headers: ['What a credit assessor would ask'],
          rows: Array.from({ length: ROWS.questions }, (_, i) => [
            `{{capacity.analysis.questions.${i}.label}}`,
          ]),
          columnWidths: [c.contentWidth],
          numeric: [],
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.analysis && capacity.analysis.scenarios',
  });

  // ── How it was calculated ────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('How it was calculated', [
      ...flow([
        sectionHeading({ eyebrow: 'The method', heading: 'How the engine reached this' }),
        table({
          headers: ['Step', 'Detail'],
          rows: Array.from({ length: ROWS.method }, (_, i) => [
            `{{capacity.method.${i}.label}}`,
            `{{capacity.method.${i}.detail}}`,
          ]),
          columnWidths: [160, c.contentWidth - 160],
          numeric: [],
        }),
        definitions('What produced these figures', [
          { term: 'Engine version', definition: '{{capacity.meta.engineVersion}}' },
          { term: 'Policy version', definition: '{{capacity.meta.policyVersion}}' },
          { term: 'Lender profile', definition: '{{capacity.meta.lenderProfile}}' },
        ]),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.method',
  });

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({
    family, variant, manifest, c, pages, format: COMMERCIAL_CAPACITY_FORMAT,
  });
}

/** Every Commercial & Industrial Capacity master, by family, in catalogue order. */
export const COMMERCIAL_CAPACITY_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
