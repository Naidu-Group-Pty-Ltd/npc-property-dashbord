/**
 * Private Banking — the five approved Investment Compass masters.
 *
 * ## One composition, five manifests
 *
 * The approved catalogue marks archetype coverage `BUILT` for the family
 * reference and `MANIFEST` for the other four, and says so in as many words:
 * "This is the family reference. The other four variants are expressed as
 * overrides on it." So there is one composition here, parameterised by the
 * resolved manifest, rather than five hand-drawn documents. Chancery is that
 * composition with an empty override set; the other four are the same seven
 * archetypes re-expressed through their own manifest values.
 *
 * That is not a shortcut — it is the property the catalogue is built on. A
 * sixth variant is an override object, and a change to the family's section
 * treatment reaches all five.
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
 * Investment Report namespaces. Risk ratings are literal (`Medium` /
 * `Indicative`) following the convention the existing catalogue already sets:
 * the investment adapter emits no rating field, and binding one would print an
 * empty column on every real report.
 */
import {
  PRIVATE_BANKING,
  axisFor,
  resolveManifest,
  useBucketFor,
  type DesignFamily,
  type TemplateManifest,
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
  navigationRail,
  page,
  prose,
  recommendation,
  risks,
  rule,
  runningHead,
  scenarioChart,
  sectionHeading,
  strengthsWatch,
  table,
  verdict,
  withFurniture,
  type BlockDef,
  type PageDef,
} from './blocks';
import { STANDARD_DISCLAIMER } from '../designSystem';
import {
  colourwayColors,
  colourwaysForFamily,
  defaultColourwayFor,
} from '../../../supabase/functions/_shared/templateColourways.pure';

/** The running foot on every content page. */
const FOOTER = '{{property.address}} · {{client.name}}';
/** The left half of the running head. */
const DOCUMENT_LABEL = 'Investment Compass · {{property.address}}';

/**
 * What a family template records about its own design.
 *
 * Mirrors `TemplateDesignMeta` in `src/lib/templateLibrary/types.ts`, which is
 * the browser's view of the same jsonb column.
 */
export interface CompassDesignMeta {
  familyKey: string;
  familyCode: string;
  familyName: string;
  familyNote: string;
  familyOrdinal: string;
  faces: string;
  templateCode: string;
  variantAxis: string;
  architecture: string;
  density: string;
  printDensity: string;
  ground: string;
  recommendedUse: string;
  useBucket: string | null;
  manifest: TemplateManifest;
  overrides: Partial<TemplateManifest>;
  isFamilyReference: boolean;
  defaultColourway: string;
  colourways: string[];
  archetypeCoverage: string;
  source: string;
}

export interface CompassSeedTemplate {
  slug: string;
  name: string;
  description: string;
  longDescription: string;
  category: string;
  reportType: string | null;
  tier?: string | null;
  industry: string[];
  tags: string[];
  style: string;
  accessTier: string;
  /**
   * Design-system metadata; lands in `template_library_entries.design_meta`.
   *
   * Typed rather than `Record<string, unknown>` so a rename in the manifest
   * vocabulary is a compile error here and in every test that reads it, rather
   * than an `undefined` that reaches a card as a blank field.
   */
  designMeta: CompassDesignMeta;
  schema: {
    version: 1;
    name: string;
    tokens: Record<string, unknown>;
    pages: PageDef[];
  };
}

/**
 * Page furniture shared by every content page.
 *
 * On `navigation_style: vertical_rail` the rail REPLACES the running head
 * rather than joining it. The catalogue's description — "a gold rail carries
 * part number and section name down every page" — is a statement about what
 * carries orientation on that variant, and drawing both put the rail marker
 * directly on top of the running head at the same `y`.
 *
 * The rail is emitted first so body content paints over it rather than under:
 * `sortBlocksForPaint` keeps document order for blocks with no explicit
 * z-index, and a 2pt rule under a table cell would show through its stripe.
 */
function furniture(part: string, section: string, railed: boolean): BlockDef[] {
  return railed
    ? navigationRail(part, section)
    : runningHead(DOCUMENT_LABEL, part);
}

/**
 * Compile one master.
 *
 * The `density` branches are the catalogue's own meaning made structural: a
 * spacious template does not shrink its type to fit more on a page, it uses
 * another page. `flow()` records anything that still runs past the footer and
 * the seed build refuses to write a migration while that log is non-empty.
 */
function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const railed = manifest.navigation_style === 'vertical_rail';
  const spacious = manifest.density === 'spacious';
  const compact = manifest.density === 'compact';

  /**
   * Does the KPI arrangement run down the page rather than across it?
   *
   * `stacked_rail` and `ledger_rows` set one figure per row, so they consume
   * roughly four times the height of a ruled band. On those variants the
   * dashboard has room for the verdict, the figures and the callout and
   * nothing else — so the property snapshot takes its own page, exactly as it
   * does on the spacious cut. Trying to fit all four is what
   * `takeCompassOverflows()` caught: 62pt past the footer on Bullion Rail.
   */
  const verticalKpis = manifest.kpi_layout === 'stacked_rail'
    || manifest.kpi_layout === 'ledger_rows';

  /** Variants that give the property snapshot a page of its own. */
  const splitSnapshot = spacious || verticalKpis;

  /**
   * Sequential part numbers.
   *
   * A counter rather than a ternary per page. The five variants spend different
   * numbers of pages on the same seven archetypes, and hand-computing
   * `spacious ? '06' : '04'` at every call site is how a report ends up with
   * two Part 04s — which a reader notices immediately and cannot unsee.
   */
  let partNo = 0;
  const nextPart = (label: string): string =>
    `Part ${String((partNo += 1)).padStart(2, '0')} · ${label}`;
  const nextNumeral = (): string => String(partNo).padStart(2, '0');

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Investment Compass',
    tagline: 'Your dedicated property partner',
    marker: 'Investment Compass',
    eyebrow: 'Investment Compass',
    title: '{{property.address}}',
    standfirst: '{{summary.narrative}}',
    locations: '{{property.suburb}} · {{market.postcode}} · {{market.state}}',
    facts: [
      { label: 'Verdict', value: '{{recommendation.headline}}' },
      { label: 'Prepared', value: '{{report.generatedDate}}' },
      { label: 'Prepared for', value: '{{client.name}}' },
      { label: 'Adviser', value: '{{author.name}}' },
    ],
  }));

  // ── 02 Executive dashboard ───────────────────────────────────────────────
  const headlineKpis = [
    { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}', note: 'Contract, before costs' },
    { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}', note: '{{financials.annualRent | currency}} p.a.' },
    { label: 'Gross yield', value: '{{financials.grossYield | percent}}', note: 'On the purchase price' },
    { label: 'Weekly position', value: '{{financials.weeklyNet | currency}}', note: '{{financials.annualNet | currency}} p.a., before tax' },
  ];
  const sixUpKpis = [
    ...headlineKpis,
    { label: 'Loan amount', value: '{{financials.loanAmount | currency}}', note: 'At settlement' },
    { label: 'Cash on cash', value: '{{financials.cashOnCash | percent}}', note: 'Year one' },
  ];

  pages.push(withFurniture(page('Executive dashboard', [
    ...furniture(nextPart('Verdict'), 'Verdict and dashboard', railed),
    ...flow([
      verdict({
        eyebrow: 'The verdict',
        heading: '{{recommendation.headline}}',
        body: '{{recommendation.rationale}}',
      }),
      kpis(manifest.kpi_layout === 'six_column_ruled' ? sixUpKpis : headlineKpis),
      ...(splitSnapshot ? [] : [
        table({
          headers: ['Property', 'Detail'],
          rows: [
            ['Property type', '{{property.type}}'],
            ['Configuration', '{{property.configuration}}'],
            ['Land area', '{{property.landArea}}'],
            ['Zoning', '{{property.zoning}}'],
            ['Tenancy', '{{property.tenancy}}'],
            ['Loan amount', '{{financials.loanAmount | currency}}'],
            ['Annual repayment', '{{financials.annualRepayment | currency}}'],
          ],
          columnWidths: [0.42, 0.58],
          numeric: [],
          stripe: !compact,
        }),
        // The archetype's dashboard carries strengths and considerations
        // alongside the snapshot. Without it the page ends two thirds down,
        // which on a flagship client document reads as unfinished rather than
        // as restraint.
        strengthsWatch(
          ['{{summary.strength.0}}', '{{summary.strength.1}}'],
          ['{{summary.watch.0}}', '{{summary.watch.1}}'],
        ),
      ]),
      callout('What this means', '{{financials.narrative}}'),
    ], contentTop()),
  ]), FOOTER));

  if (splitSnapshot) {
    pages.push(withFurniture(page('The property', [
      ...furniture(nextPart('The property'), 'The property', railed),
      ...flow([
        sectionHeading({ eyebrow: 'The asset', heading: 'What is being bought', numeral: nextNumeral() }),
        table({
          headers: ['Property', 'Detail'],
          rows: [
            ['Address', '{{property.address}}'],
            ['Property type', '{{property.type}}'],
            ['Configuration', '{{property.configuration}}'],
            ['Land area', '{{property.landArea}}'],
            ['Year built', '{{property.yearBuilt}}'],
            ['Zoning', '{{property.zoning}}'],
            ['Condition', '{{property.condition}}'],
            ['Tenancy', '{{property.tenancy}}'],
          ],
          columnWidths: [0.34, 0.66],
          numeric: [],
        }),
        strengthsWatch(
          ['{{summary.strength.0}}', '{{summary.strength.1}}'],
          ['{{summary.watch.0}}', '{{summary.watch.1}}'],
        ),
        callout('Why this property', '{{property.rationale}}'),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 03 Narrative ─────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Investment thesis', [
    ...furniture(nextPart('Thesis'), 'Investment thesis', railed),
    ...flow([
      sectionHeading({
        eyebrow: 'The case',
        heading: '{{market.conclusion.headline}}',
        numeral: nextNumeral(),
      }),
      prose('{{market.narrative}}', compact ? 96 : 120),
      rule(),
      strengthsWatch(
        ['{{summary.strength.0}}', '{{summary.strength.1}}', '{{summary.strength.2}}'],
        ['{{summary.watch.0}}', '{{summary.watch.1}}'],
      ),
      ...(spacious ? [] : [prose('{{market.conclusion.body}}', 84)]),
    ], contentTop()),
  ]), FOOTER));

  // ── 04 Dense data ────────────────────────────────────────────────────────
  const acquisitionRows = [
    ['Purchase price', '{{financials.purchasePrice | currency}}', 'Contract'],
    ['Stamp duty', '{{financials.stampDuty | currency}}', 'State schedule'],
    ['Legal and conveyancing', '{{financials.legalFees | currency}}', 'Estimate'],
    ['Building and pest', '{{financials.inspectionFees | currency}}', 'Estimate'],
    ['Loan establishment', '{{financials.loanFees | currency}}', 'Lender schedule'],
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
    ...furniture(nextPart('Financials'), 'Financial position', railed),
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
      ...furniture(nextPart('Cash flow'), 'Cash flow', railed),
      ...flow([
        sectionHeading({ eyebrow: 'Holding position', heading: 'The weekly and annual position', numeral: nextNumeral() }),
        table({
          headers: ['Cash flow', 'Weekly', 'Annual'],
          rows: cashflowRows,
          columnWidths: [0.46, 0.27, 0.27],
          totals: [cashflowRows.length - 1],
        }),
        callout('The funding structure', '{{financials.fundingNote}}'),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 05 Chart and scenario ────────────────────────────────────────────────
  pages.push(withFurniture(page('Ten-year projection', [
    ...furniture(nextPart('Projection'), 'Ten-year projection', railed),
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
        { term: 'Rental growth', definition: '{{assumptions.rentalGrowth | percent}} per annum' },
        { term: 'Interest rate', definition: '{{assumptions.interestRate | percent}}' },
        { term: 'Vacancy allowance', definition: '{{assumptions.vacancy | percent}}' },
      ]),
    ], contentTop()),
  ]), FOOTER));

  // ── 06 Risk and recommendation ───────────────────────────────────────────
  pages.push(withFurniture(page('Risk and recommendation', [
    ...furniture(nextPart('Risk'), 'Risk and recommendation', railed),
    ...flow([
      sectionHeading({
        eyebrow: 'Risk register',
        heading: 'Manageable with verification, not without it',
        numeral: nextNumeral(),
      }),
      risks('Hazard · rating · verification', [
        {
          risk: '{{risks.0.risk}}', rating: 'High', confidence: 'Indicative',
          why: '{{risks.0.why}}', ddAction: '{{risks.0.action}}',
        },
        {
          risk: '{{risks.1.risk}}', rating: 'Moderate', confidence: 'Indicative',
          why: '{{risks.1.why}}', ddAction: '{{risks.1.action}}',
        },
        {
          risk: '{{risks.2.risk}}', rating: 'Moderate', confidence: 'Indicative',
          why: '{{risks.2.why}}', ddAction: '{{risks.2.action}}',
        },
      ]),
      recommendation('{{recommendation.headline}}', '{{recommendation.rationale}}'),
    ], contentTop()),
  ]), FOOTER));

  // ── 07 Sources and appendix ──────────────────────────────────────────────
  pages.push(withFurniture(page('Sources and methodology', [
    ...furniture(nextPart('Sources'), 'Sources and methodology', railed),
    ...flow([
      sectionHeading({
        eyebrow: 'Basis of assessment',
        heading: 'How this assessment was reached',
        numeral: nextNumeral(),
      }),
      definitions('Method', [
        { term: 'Prepared by', definition: '{{author.name}}, {{author.title}}' },
        { term: 'Prepared for', definition: '{{client.name}}' },
        { term: 'Date of preparation', definition: '{{report.generatedDate}}' },
        { term: 'Market data', definition: '{{market.postcode}} {{market.state}}, {{market.suburbCount}} suburbs surveyed' },
        { term: 'Tax rate assumed', definition: '{{assumptions.taxRate | percent}}' },
        { term: 'Selling costs assumed', definition: '{{assumptions.sellingCosts | percent}}' },
      ]),
      callout('Scope', '{{financials.fundingNote}}'),
    ], contentTop()),
  ]), FOOTER));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  // ── Tokens ───────────────────────────────────────────────────────────────
  const defaultColourway = defaultColourwayFor(family.key);
  if (!defaultColourway) {
    throw new Error(`Family "${family.key}" has no colourways`);
  }

  const schema = {
    version: 1 as const,
    name: variant.name,
    tokens: {
      // The default colourway is compiled in. Selecting another is a token
      // override at preview time and a bake at copy time — never a second
      // template. See `templateColourways.pure.ts`.
      colors: colourwayColors(defaultColourway),
      fonts: {
        display: `${c.type.display}, ${c.type.displayGeneric}`,
        heading: `${c.type.heading}, ${c.type.headingGeneric}`,
        body: `${c.type.body}, ${c.type.bodyGeneric}`,
        mono: `${c.type.mono}, monospace`,
      },
      spacing: {
        gutter: c.spacing.gap,
        sectionGap: c.spacing.sectionGap,
        padding: c.margin,
      },
      radii: { sm: c.radius, md: c.radius, lg: c.radius },
      typeScale: {
        eyebrow: c.scale.eyebrow,
        body: c.scale.body,
        heading: c.scale.heading,
        cover: c.scale.coverTitle,
      },
      // Without these the template names Cinzel and Playfair and WeasyPrint
      // silently renders the engine default, which is a serif that is not
      // either of them.
      fontFaces: [
        { family: c.type.display, cssUrl: googleFontsCss(c.type.display) },
        { family: c.type.heading, cssUrl: googleFontsCss(c.type.heading, 'ital,wght@0,400;0,500;0,600;1,400') },
        { family: c.type.body, cssUrl: googleFontsCss(c.type.body, 'wght@400;500;600;700') },
        { family: c.type.mono, cssUrl: googleFontsCss(c.type.mono, 'wght@400;500;700') },
      ],
    },
    pages,
  };

  const axis = axisFor(family, variant);
  const bucket = useBucketFor(variant.code);

  return {
    slug: `investment-compass-${variant.code}-${slugify(variant.name)}`,
    name: variant.name,
    description: variant.description,
    longDescription:
      `${variant.description} ${family.name} is ${family.note.toLowerCase()}. `
      + `Recommended use: ${variant.use.toLowerCase()}. `
      + `Ten colourways compose with this layout — six light grounds and four dark.`,
    category: 'investment',
    // Normalised by the adapter registry to the production investment adapter,
    // which is what makes these templates report-ready rather than preview-only.
    reportType: 'investment_compass',
    tier: 'compass',
    industry: ['property', 'finance'],
    tags: [
      'investment-compass',
      family.key.replace(/_/g, '-'),
      variant.code,
      manifest.density,
      axis.split(' ')[0].toLowerCase(),
      ...(bucket ? [bucket.toLowerCase().replace(/\s+/g, '-')] : []),
    ],
    // The catalogue's own `style` axis. Private Banking is the luxury voice's
    // subject matter — a private-client instrument — and the library's existing
    // Style filter has to keep returning something sensible for these entries.
    style: 'luxury',
    accessTier: 'premium',
    designMeta: {
      familyKey: family.key,
      familyCode: family.code,
      familyName: family.name,
      familyNote: family.note,
      familyOrdinal: family.ordinal,
      faces: family.faces,
      templateCode: variant.code,
      variantAxis: axis,
      architecture: variant.architecture,
      density: manifest.density,
      printDensity: manifest.print_density,
      ground: variant.ground,
      recommendedUse: variant.use,
      useBucket: bucket,
      manifest,
      overrides: variant.overrides,
      isFamilyReference: Object.keys(variant.overrides).length === 0,
      defaultColourway: defaultColourway.id,
      // The ids this entry offers, in the approved order. Stored on the row
      // rather than only in the shared registry so the server can validate a
      // requested colourway against *this template's* curated set — a colourway
      // id is only meaningful inside the family that curated it.
      colourways: colourwaysForFamily(family.key).map((cw) => cw.id),
      archetypeCoverage: 'built',
      source: 'claude-design/investment-compass-template-catalogue',
    },
    schema,
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Google Fonts stylesheet URL.
 *
 * Written here rather than imported from `fontCatalog` because that module's
 * helper emits a fixed weight axis, and these four faces need different ones —
 * Playfair needs its italic axis for the standfirst, Cinzel does not have one.
 */
function googleFontsCss(family: string, axis = 'wght@400;500;600;700'): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axis}&display=swap`;
}

/** The five Private Banking masters, in the approved order. */
export const PRIVATE_BANKING_TEMPLATES: CompassSeedTemplate[] =
  PRIVATE_BANKING.variants.map((variant) => buildTemplate(PRIVATE_BANKING, variant));

/** Every Investment Compass master in the pilot. */
export const INVESTMENT_COMPASS_TEMPLATES: CompassSeedTemplate[] = [...PRIVATE_BANKING_TEMPLATES];
