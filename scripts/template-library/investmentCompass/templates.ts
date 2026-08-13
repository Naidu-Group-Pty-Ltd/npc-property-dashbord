/**
 * The fifty approved Investment Compass masters.
 *
 * ## One composition, fifty manifests
 *
 * The approved catalogue marks archetype coverage `BUILT` for each family's
 * reference and `MANIFEST` for the other four, and says so in as many words:
 * "This is the family reference. The other four variants are expressed as
 * overrides on it." So there is one composition here, parameterised by the
 * resolved manifest, rather than fifty hand-drawn documents.
 *
 * That is not a shortcut — it is the property the catalogue is built on. An
 * eleventh family is a declaration in `source.json`; a sixth variant is an
 * override object; and a change to how a section opener is drawn reaches all
 * fifty at once. What makes the fifty *different* is the manifest: 31 KPI
 * layouts, 30 chart styles, 29 cover overlays, 27 section headers and 26 table
 * treatments, each resolved to a primitive by `resolvers.ts`.
 *
 * ## The seven archetypes
 *
 * Every master covers `ARCHETYPES` in order: Cover, Executive dashboard,
 * Narrative, Dense data, Chart and scenario, Risk and recommendation, Sources
 * and appendix. A spacious template spends more pages on the same material —
 * that is what `density: spacious` means — so page count varies by variant
 * while archetype coverage does not.
 *
 * ## Bindings
 *
 * Every value a report supplies is a `{{binding}}` against the production
 * Investment Report namespaces. Risk ratings are literal, following the
 * convention the existing catalogue already sets: the investment adapter emits
 * no rating field, and binding one would print an empty column on every real
 * report.
 */
import {
  DESIGN_FAMILIES,
  axisFor,
  resolveManifest,
  useBucketFor,
  type DesignFamily,
  type TemplateManifest,
  type VariantDefinition,
} from './family';
import {
  callout,
  contents,
  contentTop,
  cover,
  coverHero,
  definitions,
  disclaimerPage,
  flow,
  furniture,
  ifItFits,
  kpiCapacity,
  kpis,
  page,
  platePage,
  prose,
  recommendation,
  risks,
  rule,
  scenarioChart,
  sectionHeading,
  strengthsWatch,
  textHeight,
  table,
  verdict,
  withFurniture,
  beginCompassTemplate,
  type PageDef,
} from './blocks';
import { hasContents, imageSlotPlan, kpiPlan, type ImagePlate } from './resolvers';
import {
  assembleMaster,
  type CompassSeedTemplate,
  type ReportFormat,
} from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

/** Investment Compass: the format the ten families were drawn for. */
const INVESTMENT_COMPASS_FORMAT: ReportFormat = {
  key: 'investment-compass',
  // Normalised by the adapter registry to the production investment adapter,
  // which is what makes these templates report-ready rather than preview-only.
  reportType: 'investment_compass',
  category: 'investment',
  tier: 'compass',
  label: 'Investment Compass',
};

/** The running foot on every content page. */
/**
 * The running foot.
 *
 * Not `{{client.name}}`: `investment_reports` has no client-name column and
 * `client_property_id` is set on 2 of the 1,182 reports, so every page of every
 * Compass document was footed "<address> · " with a dangling separator. An
 * unresolved binding renders as the empty string, never as a visible `{{…}}`.
 */
const FOOTER = '{{property.address}} · Investment Compass';

/**
 * The longest each bound field runs across the 1,182 stored reports.
 *
 * Measured, because a declared height that is too small does not overflow the
 * page — it lays one block over the next, invisibly to `flow()`'s arithmetic
 * guard. See `textHeight` in `blocks.ts`.
 */
/**
 * `breakdown.<dimension>.details`, per dimension, across the 985 scored reports.
 *
 * Sized individually rather than at the worst case. Reserving risk's 228 for
 * all three ran the assessment page 4pt past the footer on Luxury Editorial's
 * third variant — which the seed builder refused to write, exactly as it
 * should: `location` is 94 at its longest and `yield` is 51, and two thirds of
 * that reservation was for prose those dimensions never write.
 */
const DETAIL_CHARS = { location: 94, yield: 51, risk: 228 } as const;

/** The left half of the running head. */
const DOCUMENT_LABEL = 'Investment Compass · {{property.address}}';

/**
 * Compile one master.
 *
 * The density and layout branches are the catalogue's own meaning made
 * structural: a spacious template does not shrink its type to fit more on a
 * page, it uses another page. `flow()` records anything that still runs past
 * the footer and the seed build refuses to write a migration while that log is
 * non-empty.
 */
function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const spacious = manifest.density === 'spacious';

  /**
   * Does the KPI arrangement run down the page rather than across it?
   *
   * `rows` and `stacked` set one figure per row, so they consume roughly four
   * times the height of a ruled band, and a `display` grid is taller again. On
   * those variants the dashboard has room for the verdict, the figures and the
   * callout and nothing else — so the property snapshot takes its own page.
   * Trying to fit all four is what the overflow guard caught at 62pt past the
   * footer on Bullion Rail.
   */
  const plan = kpiPlan(manifest.kpi_layout);
  const tallKpis = plan.variant === 'rows' || plan.variant === 'stacked'
    || plan.variant === 'display' || plan.items > 6;
  const splitSnapshot = spacious || tallKpis;

  /**
   * Sequential part numbers.
   *
   * A counter rather than a ternary per page. The fifty masters spend different
   * numbers of pages on the same seven archetypes, and hand-computing them at
   * every call site is how a report ends up with two Part 04s — which a reader
   * notices immediately and cannot unsee.
   */
  let partNo = 0;
  const nextPart = (label: string): string =>
    `Part ${String((partNo += 1)).padStart(2, '0')} · ${label}`;
  const nextNumeral = (): string => String(partNo).padStart(2, '0');

  /**
   * The briefed image plates this template declares.
   *
   * Only the two photographic families carry `image_slots`; for every other
   * family this is empty and nothing below emits a thing.
   */
  const slots = imageSlotPlan(manifest.image_slots);
  // Each plate binds a distinct `property.images[n]`, so an operator filling
  // one does not fill them all.
  const plateIndex = new Map<string, number>(
    slots.plates.map((p, i) => [p.id, i]),
  );
  /**
   * The plates that follow a given content page, as pages of their own.
   *
   * Every plate is a page. Inline plates were tried first and cost eight of the
   * ten plated variants their page — "Investment thesis" ran 123pt past the
   * content bottom on `le-03` — because these pages are already full and a slot
   * reserves its height whether or not anything fills it. `platePage` carries
   * the full reasoning.
   */
  let plateNo = 0;
  const platesFor = (placement: ImagePlate['placement']): PageDef[] =>
    slots.plates
      .filter((p) => p.placement === placement)
      .map((p) => {
        plateNo += 1;
        return platePage({
          index: plateIndex.get(p.id)!,
          brief: p.brief,
          // A page name has to distinguish one plate from the next: it is what
          // the reader's page list shows and what the overflow log names.
          name: p.caption ?? `Plate ${String(plateNo).padStart(2, '0')}`,
          caption: p.caption,
          bleed: slots.bleed,
        });
      });

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Investment Compass',
    tagline: 'Your dedicated property partner',
    marker: 'Investment Compass',
    eyebrow: 'Investment Compass',
    title: '{{property.address}}',
    // Was `{{summary.narrative}}`, `{{property.suburb}}`, `{{market.postcode}}`
    // and `{{market.state}}` — none of which any adapter publishes, and none of
    // which has a column to publish from. `location_intelligence` carries
    // amenities, commute, schools and transport; there is no postcode, no state
    // and no market prose anywhere in the row. So the cover said nothing under
    // the address, on every report.
    standfirst: 'What the property is, what it costs to hold, and what the assessment concluded.',
    locations: 'Prepared {{report.generatedDate}}',
    facts: [
      { label: 'Verdict', value: '{{recommendation.headline}}' },
      { label: 'Grade', value: '{{recommendation.grade}}' },
      { label: 'Score', value: '{{recommendation.score | fixed:0}}', },
      { label: 'Weekly position', value: '{{financials.weeklyNet | currency}}' },
    ],
  }));

  // A photographic cover is the plate BEHIND the cover composition, so the
  // wordmark, title and fact band paint over it. Absent, the cover falls back
  // to its field colour — which is exactly the typographic cover the
  // `three_interior` and `none` variants use, so the two are one composition.
  if (slots.coverHero) {
    const hero = slots.plates.find((p) => p.placement === 'cover');
    if (hero) {
      const cv = pages[0];
      pages[0] = {
        ...cv,
        blocks: [...coverHero(plateIndex.get(hero.id)!, hero.brief), ...cv.blocks],
      };
    }
  }

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this report', heading: 'Contents', numeral: nextNumeral() }),
        contents([
          'The verdict and the numbers that carry it',
          'The property',
          'Investment thesis',
          'Financial position',
          'Ten-year projection',
          'Risk and recommendation',
          'Sources and methodology',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 Executive dashboard ───────────────────────────────────────────────
  const allKpis = [
    { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}', note: 'Contract, before costs' },
    { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}', note: '{{financials.annualRent | currency}} p.a.' },
    { label: 'Gross yield', value: '{{financials.grossYield | percent}}', note: 'On the purchase price' },
    { label: 'Weekly position', value: '{{financials.weeklyNet | currency}}', note: '{{financials.annualNet | currency}} p.a., before tax' },
    { label: 'Loan amount', value: '{{financials.loanAmount | currency}}', note: 'At settlement' },
    { label: 'Cash on cash', value: '{{financials.cashOnCash | percent}}', note: 'Year one' },
    { label: 'Total cost', value: '{{financials.totalCost | currency}}', note: 'Including acquisition costs' },
    { label: 'Annual repayment', value: '{{financials.annualRepayment | currency}}', note: 'P&I, modelled rate' },
    // Was `financials.breakEvenRent`, which no column supplies and no
    // derivation can honestly reach. `netYield` is stored on every scored
    // report and is the figure a reader wants beside the gross.
    { label: 'Net yield', value: '{{financials.netYield | percent}}', note: 'After holding costs' },
    { label: 'Capital growth', value: '{{assumptions.capitalGrowth | percent}}', note: 'Base case, per annum' },
    { label: 'Interest rate', value: '{{assumptions.interestRate | percent}}', note: 'Modelled' },
    { label: 'Vacancy', value: '{{assumptions.vacancy | percent}}', note: 'Allowance' },
  ];
  // The arrangement decides how many figures it wants — four for a ruled band,
  // twelve for a console, five for a position strip. Supplying more than it
  // asks for would silently drop them.
  const dashboardKpis = allKpis.slice(0, kpiCapacity());

  pages.push(withFurniture(page('Executive dashboard', [
    ...furniture(DOCUMENT_LABEL, nextPart('Verdict'), 'Verdict and dashboard'),
    ...flow([
      verdict({
        eyebrow: 'The verdict',
        heading: '{{recommendation.headline}}',
        // `investment_score` holds ONE recommendation string and no rationale
        // beside it, so this used to be blank under a heading that promised an
        // explanation. The grade and the weighting are what the record can
        // actually say about how the verdict was reached; the scorecard on the
        // assessment page shows the five dimensions it is composed of.
        body: 'Graded {{recommendation.grade}} at {{recommendation.score | fixed:0}} out of 100, '
          + 'weighted across growth, location, yield, demand and risk.',
      }),
      kpis(dashboardKpis),
      ...(splitSnapshot ? [] : [
        table({
          headers: ['Property', 'Detail'],
          rows: [
            ['Property type', '{{property.type}}'],
            ['Configuration', '{{property.configuration}}'],
            ['Land area', '{{property.landArea}}'],
            ['Zoning', '{{property.zoning}}'],
            // Was `property.tenancy`: `property_specs` has no such key on any
            // of the 1,182 rows. `council_area` is on 1,054 of them.
            ['Council', '{{property.council}}'],
            ['Loan amount', '{{financials.loanAmount | currency}}'],
            ['Annual repayment', '{{financials.annualRepayment | currency}}'],
          ],
          columnWidths: [0.42, 0.58],
          numeric: [],
        }),
        // One each, not two.
        //
        // Across the 985 scored reports `investment_score.strengths` holds at
        // least one on 745 and at least two on **47**; `weaknesses` holds one on
        // 874 and two on **15**. A second row therefore printed a marker with
        // nothing beside it on 95% and 98% of reports respectively.
        strengthsWatch(['{{summary.strength.0}}'], ['{{summary.watch.0}}']),
      ]),
      // No closing callout. It bound `financials.narrative`, which nothing
      // publishes and no column holds, so it printed a titled panel with an
      // empty body on every report.
    ], contentTop()),
  ]), FOOTER));

  if (splitSnapshot) {
    pages.push(withFurniture(page('The property', [
      ...furniture(DOCUMENT_LABEL, nextPart('The property'), 'The property'),
      ...flow([
        sectionHeading({
          eyebrow: 'The asset',
          heading: 'What is being bought',
          numeral: nextNumeral(),
          // No standfirst: `property.rationale` has no column and no producer.
        }),
        table({
          headers: ['Property', 'Detail'],
          rows: [
            ['Address', '{{property.address}}'],
            ['Property type', '{{property.type}}'],
            ['Configuration', '{{property.configuration}}'],
            ['Land area', '{{property.landArea}}'],
            ['Year built', '{{property.yearBuilt}}'],
            ['Zoning', '{{property.zoning}}'],
            // `condition` and `tenancy` are not keys `property_specs` has ever
            // carried; `council_area` and `building_size_sqm` are, on 1,054 of
            // the 1,182 rows.
            ['Council', '{{property.council}}'],
            ['Building area', '{{property.buildingArea}}'],
          ],
          columnWidths: [0.34, 0.66],
          numeric: [],
        }),
        // One each, not two.
        //
        // Across the 985 scored reports `investment_score.strengths` holds at
        // least one on 745 and at least two on **47**; `weaknesses` holds one on
        // 874 and two on **15**. A second row therefore printed a marker with
        // nothing beside it on 95% and 98% of reports respectively.
        strengthsWatch(['{{summary.strength.0}}'], ['{{summary.watch.0}}']),
      ], contentTop()),
    ]), FOOTER));
  }

  // Outside the `splitSnapshot` branch on purpose: not every variant gives the
  // property its own page, and a plate that exists only when it does would be
  // dropped from four of the ten plated masters without anything saying so.
  pages.push(...platesFor('property'));

  // ── 03 The assessment ────────────────────────────────────────────────────
  //
  // This page used to be four bound paragraphs — `market.conclusion.headline`,
  // `market.narrative`, `market.conclusion.body` and `property.rationale` — and
  // **not one of them had a source**. No adapter published `market`, and
  // `location_intelligence` carries amenities, commute, schools and transport
  // rather than prose. So the Investment Compass's central narrative page
  // rendered as white paper under a blank heading on every report ever produced.
  //
  // What the record does hold is `investment_score.breakdown`: five weighted
  // dimensions, each with a score and a `details` sentence. That is the
  // reasoning behind the grade, and it is what this page now shows.
  //
  // Three of the five carry prose and two do not. Measured across the 985
  // scored reports: `riskScore.details` on all 985 (228 characters at its
  // longest), `yieldScore` on all 985 (51), `locationScore` on 965 (94) — while
  // `growthScore` and `demandScore` are scored a flat 50 with no details on 919
  // of the 985, which is why they appear in the scorecard and not in the
  // reasoning beneath it.
  pages.push(withFurniture(page('The assessment', [
    ...furniture(DOCUMENT_LABEL, nextPart('Assessment'), 'The assessment'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'How the grade was reached',
        heading: 'Five dimensions, weighted',
        numeral: nextNumeral(),
        standfirst: 'Each dimension is scored out of 100 and weighted into the total. '
          + 'A dimension the assessment had no data for is scored at the midpoint.',
      }),
      table({
        headers: ['Dimension', 'Score', 'Weight'],
        rows: [0, 1, 2, 3, 4].map((i) => [
          `{{assessment.${i}.label}}`,
          `{{assessment.${i}.score | fixed:0}}`,
          `{{assessment.${i}.weight | fixed:0}}%`,
        ]),
        columnWidths: [0.5, 0.25, 0.25],
        numeric: [1, 2],
      }),
      // Location, yield and risk — the three that say something. Each is
      // conditional on its own `details`, because a dimension with a score and
      // no prose must not print a term with nothing beside it.
      ...[
        { i: 1, term: 'Location', chars: DETAIL_CHARS.location },
        { i: 2, term: 'Yield', chars: DETAIL_CHARS.yield },
        { i: 4, term: 'Risk', chars: DETAIL_CHARS.risk },
      ].map(({ i, term, chars }) => ({
        ...definitions('Why', [
          { term, definition: `{{assessment.${i}.details}}` },
        ], chars),
        conditional: `assessment && assessment[${i}] && assessment[${i}].details`,
      })),
    ], [
      // Opportunities are an array on the scored reports and empty on most of
      // them, so this is drawn only where the variant has room AND the record
      // has one.
      {
        ...definitions('Opportunities', [
          { term: 'Noted', definition: '{{opportunities.0}}' },
        ], 120),
        conditional: 'opportunities && opportunities[0]',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER));
  pages.push(...platesFor('thesis'));

  // ── 04 Dense data ────────────────────────────────────────────────────────
  const acquisitionRows = [
    ['Purchase price', '{{financials.purchasePrice | currency}}', 'Contract'],
    ['Stamp duty', '{{financials.stampDuty | currency}}', 'State schedule'],
    ['Legal and conveyancing', '{{financials.legalFees | currency}}', 'Estimate'],
    ['Building and pest', '{{financials.inspectionFees | currency}}', 'Estimate'],
    // `financials.loanFees` has no column and no producer; the row printed a
    // label, a blank and "Lender schedule" on every report.
    ['LVR at settlement', '{{financials.lvr | percent:0}}', 'Loan over price'],
    ['Total acquisition cost', '{{financials.totalCost | currency}}', 'Sum of the above'],
  ];
  const cashflowRows = [
    ['Rental income', '{{financials.weeklyRent | currency}}', '{{financials.annualRent | currency}}'],
    ['Loan repayments', '{{financials.weeklyRepayment | currency}}', '{{financials.annualRepayment | currency}}'],
    ['Council and water rates', '{{financials.weeklyRates | currency}}', '{{financials.annualRates | currency}}'],
    ['Insurance', '{{financials.weeklyInsurance | currency}}', '{{financials.annualInsurance | currency}}'],
    ['Management', '{{financials.weeklyManagement | currency}}', '{{financials.annualManagement | currency}}'],
    ['Maintenance', '{{financials.weeklyMaintenance | currency}}', '{{financials.annualMaintenance | currency}}'],
    ['Net position', '{{financials.weeklyNet | currency}}', '{{financials.annualNet | currency}}'],
  ];

  pages.push(withFurniture(page('Financial position', [
    ...furniture(DOCUMENT_LABEL, nextPart('Financials'), 'Financial position'),
    ...flow([
      sectionHeading({
        eyebrow: 'Acquisition and holding',
        heading: 'What it costs and what it returns',
        numeral: nextNumeral(),
      }),
      table({
        headers: ['Acquisition', 'Amount', 'Basis'],
        rows: acquisitionRows,
        columnWidths: [0.46, 0.27, 0.27],
        // The last row is the sum of the ones above it, so it is closed by a
        // doubled rule under `double_rule_statement` and reads as an ordinary
        // emphasised row under the other treatments.
        totals: [acquisitionRows.length - 1],
      }),
      ...(spacious ? [] : [
        table({
          headers: ['Cash flow', 'Weekly', 'Annual'],
          rows: cashflowRows,
          columnWidths: [0.46, 0.27, 0.27],
          totals: [cashflowRows.length - 1],
        }),
      ]),
    ], contentTop()),
  ]), FOOTER));

  if (spacious) {
    pages.push(withFurniture(page('Cash flow', [
      ...furniture(DOCUMENT_LABEL, nextPart('Cash flow'), 'Cash flow'),
      ...flow([
        sectionHeading({
          eyebrow: 'Holding position',
          heading: 'The weekly and annual position',
          numeral: nextNumeral(),
        }),
        table({
          headers: ['Cash flow', 'Weekly', 'Annual'],
          rows: cashflowRows,
          columnWidths: [0.46, 0.27, 0.27],
          totals: [cashflowRows.length - 1],
        }),
        // No funding callout: `financials.fundingNote` has no column and no
        // producer, so it printed a titled panel with nothing in it.
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 05 Chart and scenario ────────────────────────────────────────────────
  pages.push(withFurniture(page('Ten-year projection', [
    ...furniture(DOCUMENT_LABEL, nextPart('Projection'), 'Ten-year projection'),
    ...flow([
      sectionHeading({
        eyebrow: 'Projections',
        heading: 'Equity and value over ten years',
        numeral: nextNumeral(),
      }),
      scenarioChart({
        title: 'Projected equity position',
        caption: 'Property value less loan balance, by year',
        dataPath: 'tenYear.equitySeries',
        data: Array.from({ length: 10 }, (_, i) => ({ label: `Yr ${i + 1}`, value: 0 })),
      }),
      definitions('Assumptions', [
        { term: 'Capital growth', definition: '{{assumptions.capitalGrowth | percent}} per annum' },
        { term: 'Interest rate', definition: '{{assumptions.interestRate | percent}}' },
        { term: 'Vacancy allowance', definition: '{{assumptions.vacancy | percent}}' },
        // `assumptions.rentalGrowth` was the fourth row and has no column.
        { term: 'Occupancy', definition: '{{assumptions.occupancyWeeks}} weeks a year' },
      ]),
    ], contentTop()),
  ]), FOOTER));
  pages.push(...platesFor('projection'));

  // ── 06 Risk and recommendation ───────────────────────────────────────────
  pages.push(withFurniture(page('Risk and recommendation', [
    ...furniture(DOCUMENT_LABEL, nextPart('Risk'), 'Risk and recommendation'),
    ...flow([
      sectionHeading({
        eyebrow: 'Risk register',
        heading: 'Manageable with verification, not without it',
        numeral: nextNumeral(),
      }),
      // ONE row, not three, and no `why`/`ddAction` columns.
      //
      // `investment_score.risks` is an array of plain strings whose length runs
      // **0 to 1** across all 1,182 reports — never 2, never 3 — and a string
      // has no `why` and no verification action. So this register drew three
      // rows of which at most one could ever fill, and all three of its prose
      // columns were empty on every report ever produced.
      //
      // The row is conditional because 197 reports carry no score object at all
      // and a further set score zero risks; the assessment page carries the
      // risk dimension's own reasoning either way.
      {
        ...risks('Hazard · rating · verification', [{
          risk: '{{risks.0.risk}}', rating: 'Noted', confidence: 'Indicative',
          why: '{{assessment.4.details}}', ddAction: 'Verify before exchange',
        }], DETAIL_CHARS.risk),
        conditional: 'risks && risks[0] && risks[0].risk',
      },
      recommendation(
        '{{recommendation.headline}}',
        // Was `recommendation.rationale`, which the record does not carry.
        'Graded {{recommendation.grade}} at {{recommendation.score | fixed:0}} out of 100. '
        + 'The five weighted dimensions behind that grade are set out on the assessment page.',
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 07 Sources and appendix ──────────────────────────────────────────────
  pages.push(withFurniture(page('Sources and methodology', [
    ...furniture(DOCUMENT_LABEL, nextPart('Sources'), 'Sources and methodology'),
    ...flow([
      sectionHeading({
        eyebrow: 'Basis of assessment',
        heading: 'How this assessment was reached',
        numeral: nextNumeral(),
      }),
      // Six rows, of which five could never resolve. There is no `profiles`
      // table, so `author.*` has no source; `client.name` has no column;
      // `market.postcode`/`state`/`suburbCount` are published by nothing; and
      // `assumptions.taxRate`/`sellingCosts` have no column either. The method
      // page listed six labelled terms with one value between them.
      definitions('Method', [
        { term: 'Prepared by', definition: '{{org.name}}' },
        { term: 'Date of preparation', definition: '{{report.generatedDate}}' },
        { term: 'Property assessed', definition: '{{property.address}}' },
        { term: 'Assessment grade', definition: '{{recommendation.grade}} · {{recommendation.score | fixed:0}} out of 100' },
        { term: 'Interest rate assumed', definition: '{{assumptions.interestRate | percent}}' },
        { term: 'Capital growth assumed', definition: '{{assumptions.capitalGrowth | percent}} per annum' },
      ], 96),
      callout(
        'Scope',
        'Figures are drawn from the stored assessment and are not re-derived here. '
        + 'No tax position is modelled and no valuation after settlement is assumed.',
        textHeight(150, { extra: 34 }),
      ),
    ], contentTop()),
  ]), FOOTER));
  pages.push(...platesFor('sources'));

  // The plates that belong to no section — `six_with_bleed`'s two extras. They
  // close the narrative rather than following one of its pages.
  pages.push(...platesFor('page'));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: INVESTMENT_COMPASS_FORMAT });
}

/** Every Investment Compass master, by family, in catalogue order. */
export const INVESTMENT_COMPASS_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);

/** The five Private Banking masters, kept as a named export for the pilot specs. */
export const PRIVATE_BANKING_TEMPLATES: CompassSeedTemplate[] =
  INVESTMENT_COMPASS_TEMPLATES.filter((t) => t.designMeta.familyKey === 'private_banking');
