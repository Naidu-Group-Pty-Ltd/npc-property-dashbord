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
  table,
  verdict,
  withFurniture,
  beginCompassTemplate,
  type PageDef,
} from './blocks';
import { hasContents, imageSlotPlan, kpiPlan, type ImagePlate } from './resolvers';
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
  designMeta: CompassDesignMeta;
  schema: {
    version: 1;
    name: string;
    tokens: Record<string, unknown>;
    pages: PageDef[];
  };
}

/**
 * The catalogue's `style` axis, per family.
 *
 * The library's existing Style filter predates the family system and has to
 * keep returning something sensible for these entries. Each family is mapped to
 * the voice whose subject matter it shares — not to a voice it is built in,
 * which it is not.
 */
const FAMILY_STYLE: Record<string, string> = {
  private_banking: 'luxury',
  institutional_research: 'technical',
  luxury_editorial: 'editorial',
  modern_fintech: 'minimal',
  architectural_property: 'minimal',
  swiss_minimal: 'minimal',
  corporate_advisory: 'corporate',
  wealth_management: 'corporate',
  data_analyst: 'technical',
  dark_executive: 'technical',
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Google Fonts stylesheet URL.
 *
 * Written here rather than taken from `fontCatalog` because that helper emits a
 * fixed weight axis, and these ten families need different ones — Playfair
 * needs its italic axis for the standfirst, Cinzel has none, Lato ships a 300
 * and Noto Serif an italic.
 */
function googleFontsCss(family: string, axis: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axis}&display=swap`;
}

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
    standfirst: '{{summary.narrative}}',
    locations: '{{property.suburb}} · {{market.postcode}} · {{market.state}}',
    facts: [
      { label: 'Verdict', value: '{{recommendation.headline}}' },
      { label: 'Prepared', value: '{{report.generatedDate}}' },
      { label: 'Prepared for', value: '{{client.name}}' },
      { label: 'Adviser', value: '{{author.name}}' },
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
    { label: 'Break-even rent', value: '{{financials.breakEvenRent | currency}}', note: 'Weekly, to hold at nil' },
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
        body: '{{recommendation.rationale}}',
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
            ['Tenancy', '{{property.tenancy}}'],
            ['Loan amount', '{{financials.loanAmount | currency}}'],
            ['Annual repayment', '{{financials.annualRepayment | currency}}'],
          ],
          columnWidths: [0.42, 0.58],
          numeric: [],
        }),
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
      ...furniture(DOCUMENT_LABEL, nextPart('The property'), 'The property'),
      ...flow([
        sectionHeading({
          eyebrow: 'The asset',
          heading: 'What is being bought',
          numeral: nextNumeral(),
          standfirst: '{{property.rationale}}',
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
      ], contentTop()),
    ]), FOOTER));
  }

  // Outside the `splitSnapshot` branch on purpose: not every variant gives the
  // property its own page, and a plate that exists only when it does would be
  // dropped from four of the ten plated masters without anything saying so.
  pages.push(...platesFor('property'));

  // ── 03 Narrative ─────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Investment thesis', [
    ...furniture(DOCUMENT_LABEL, nextPart('Thesis'), 'Investment thesis'),
    ...flow([
      sectionHeading({
        eyebrow: 'The case',
        heading: '{{market.conclusion.headline}}',
        numeral: nextNumeral(),
      }),
      prose('{{market.narrative}}', manifest.density === 'compact' ? 96 : 120),
      rule(),
      prose('{{market.conclusion.body}}', 92),
      callout('Why this suburb', '{{property.rationale}}'),
    ], contentTop()),
  ]), FOOTER));
  pages.push(...platesFor('thesis'));

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
        callout('The funding structure', '{{financials.fundingNote}}'),
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
        { term: 'Rental growth', definition: '{{assumptions.rentalGrowth | percent}} per annum' },
        { term: 'Interest rate', definition: '{{assumptions.interestRate | percent}}' },
        { term: 'Vacancy allowance', definition: '{{assumptions.vacancy | percent}}' },
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
    ...furniture(DOCUMENT_LABEL, nextPart('Sources'), 'Sources and methodology'),
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
  pages.push(...platesFor('sources'));

  // The plates that belong to no section — `six_with_bleed`'s two extras. They
  // close the narrative rather than following one of its pages.
  pages.push(...platesFor('page'));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  // ── Tokens ───────────────────────────────────────────────────────────────
  const defaultColourway = defaultColourwayFor(family.key);
  if (!defaultColourway) throw new Error(`Family "${family.key}" has no colourways`);

  const faces = [
    { role: 'display' as const, family: c.type.display },
    { role: 'heading' as const, family: c.type.heading },
    { role: 'body' as const, family: c.type.body },
    { role: 'mono' as const, family: c.type.mono },
  ];
  // A family that sets one face for every role must not load it four times.
  const uniqueFaces = faces.filter(
    (f, i) => faces.findIndex((g) => g.family === f.family) === i,
  );

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
        mono: `${c.type.mono}, ${c.type.monoGeneric}`,
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
      // Without these the template names a face and WeasyPrint silently renders
      // the engine default, which is a serif that is not it.
      fontFaces: uniqueFaces.map((f) => ({
        family: f.family,
        cssUrl: googleFontsCss(f.family, c.type.axes[f.role] ?? 'wght@400;500;600;700'),
      })),
    },
    pages,
  };

  const axis = axisFor(family, variant);
  const bucket = useBucketFor(variant.code);
  const style = FAMILY_STYLE[family.key];
  if (!style) throw new Error(`No style axis mapped for family "${family.key}"`);

  return {
    slug: `investment-compass-${variant.code}-${slugify(variant.name)}`,
    name: variant.name,
    description: variant.description,
    longDescription:
      `${variant.description} ${family.name} is ${family.note.toLowerCase()}. `
      + `Recommended use: ${variant.use.toLowerCase()}. `
      + `Ten colourways compose with this layout.`,
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
    style,
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
      // The ids this entry offers, in the approved order. Stored on the row so
      // the server can validate a requested colourway against *this template's*
      // curated set — an id is only meaningful inside its own family.
      colourways: colourwaysForFamily(family.key).map((cw) => cw.id),
      archetypeCoverage: Object.keys(variant.overrides).length === 0 ? 'built' : 'manifest',
      source: 'claude-design/investment-compass-template-catalogue',
    },
    schema,
  };
}

/** Every Investment Compass master, by family, in catalogue order. */
export const INVESTMENT_COMPASS_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);

/** The five Private Banking masters, kept as a named export for the pilot specs. */
export const PRIVATE_BANKING_TEMPLATES: CompassSeedTemplate[] =
  INVESTMENT_COMPASS_TEMPLATES.filter((t) => t.designMeta.familyKey === 'private_banking');
