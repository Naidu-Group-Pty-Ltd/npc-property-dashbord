/**
 * Market Intelligence on the Investment Compass families.
 *
 * ## Eight layers of model-authored Markdown
 *
 * The report is composed of eight named layers, each Markdown as the model
 * wrote it, and each drawn by `markdown-block` — the same block Report Q&A uses
 * and for the same reason: it renders source through the programme's
 * escape-first renderer, so it cannot emit markup the model chose.
 *
 * ## The page budget is fitted to what the record actually holds
 *
 * Measured across the six stored reports, 48 layer bodies:
 *
 * | | |
 * | --- | --- |
 * | absent entirely | **8** |
 * | `layer1_rba` median | 2,291 chars |
 * | `layer8_competitive_edge` median | **15,055** chars |
 * | largest single layer | **244,332** chars — about ninety-nine pages |
 *
 * No fixed sequence carries that range. Each layer therefore gets one page plus
 * two conditional continuations, and where the allocation bites the projection
 * publishes a whole sentence naming the pages not shown. That is this format's
 * own contract rather than an invention: it is the one that clips a section and
 * says so on the page.
 *
 * Empty layers are dropped by the projection rather than carried, so
 * `layers.0…n` are all real and a master needs one conditional per position
 * instead of one per position *and* one per layer. What was asked for and came
 * back empty is named in `layersOmitted` instead, so the document still says it.
 *
 * ## The call to action is not here
 *
 * `prose.ctaContent` exists on the payload and is deliberately unbound. It is
 * the generator's copy for the email the legacy attached this PDF to; a "book a
 * call" panel in the middle of a market report reads as an advertisement.
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
  disclaimerPage,
  flow,
  markdown,
  MARKDOWN_LINES_PER_PAGE,
  page,
  prose,
  sectionHeading,
  table,
  textHeight,
  withFurniture,
  type PageDef,
} from './blocks';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

const FOOTER = '{{marketIntel.meta.reportPeriod}} · Market Intelligence';
const DOCUMENT_LABEL = 'Market Intelligence';

/** Layers a master draws, and pages each is allowed. Mirrors the projection's CAPS. */
const LAYERS = 8;
const LAYER_PAGES = 3;

const ROWS = {
  events: 10,
  upcoming: 6,
  citations: 12,
} as const;

const LENGTHS = {
  narrative: 700,
  // Fitted against the seed builder's overflow guard on the two spacious
  // families (pb-03, le-03), which set the same characters into more vertical
  // space than the rest. A declared height that is too small does not overflow
  // the page — it prints over the next block, which `flow()` cannot see.
  executiveSummary: 1080,
  keyInsights: 1100,
  strategy: 1100,
} as const;

const MARKET_INTELLIGENCE_FORMAT: ReportFormat = {
  key: 'market-intelligence',
  reportType: 'market_intelligence',
  /*
   * `statewide`, not `market`.
   *
   * `market` is in the TypeScript `TemplateLibraryCategory` union but **not** in
   * `template_library_entries_category_check`, which accepts `suburb`,
   * `postcode` and `statewide` instead. The two vocabularies have diverged, and
   * the column is the one that decides — the Client Details masters were
   * rejected mid-apply for the same class of mistake, and the seed builder's
   * category guard exists because of it. It caught this one at build time.
   *
   * Of what the column does accept, `statewide` is the only market-analysis
   * category at a broad geographic scope, which is what a national macro report
   * is closest to. Adding `market` to the constraint would be the better fix and
   * is a migration rather than a template change.
   */
  category: 'statewide',
  tier: 'compass',
  label: 'Market Intelligence',
  extraTags: ['market', 'intelligence', 'macro', 'rba', 'outlook'],
};

const HAS_INTEL = 'marketIntel';

function eventRow(collection: string, i: number): string[] {
  return [
    `{{marketIntel.${collection}.${i}.date}}`,
    `{{marketIntel.${collection}.${i}.event}}`,
    `{{marketIntel.${collection}.${i}.impact}}`,
  ];
}

/**
 * One layer: a titled opening page plus two conditional continuations.
 *
 * The title is bound rather than written, because which layer sits at position
 * `i` depends on which ones came back empty — the projection drops those, so
 * position is not layer identity.
 */
function layerPages(index: number, bodyHeight: number, firstHeight: number): PageDef[] {
  const out: PageDef[] = [];
  const source = `{{marketIntel.layers.${index}.content}}`;

  out.push({
    ...withFurniture(page(`Layer ${index + 1}`, [
      ...flow([
        sectionHeading({
          eyebrow: 'Market intelligence',
          heading: `{{marketIntel.layers.${index}.title}}`,
        }),
        markdown(source, 0, firstHeight, MARKDOWN_LINES_PER_PAGE),
      ], contentTop()),
    ]), FOOTER),
    conditional: `marketIntel && marketIntel.layers && marketIntel.layers.${index}`,
  });

  for (let p = 1; p < LAYER_PAGES; p += 1) {
    out.push({
      ...withFurniture(page(`Layer ${index + 1} (${p + 1})`, [
        ...flow([
          markdown(source, p, bodyHeight, MARKDOWN_LINES_PER_PAGE),
        ], contentTop()),
      ]), FOOTER),
      conditional: `marketIntel && marketIntel.layers && marketIntel.layers.${index}`
        + ` && marketIntel.layers.${index}.pages > ${p}`,
    });
  }

  // Where the allocation bites, the page says so. The projection publishes this
  // as a whole sentence, and only when there is something to say.
  out.push({
    ...withFurniture(page(`Layer ${index + 1} — continues`, [
      ...flow([
        callout('This section continues', `{{marketIntel.layers.${index}.omissionNote}}`),
      ], contentTop()),
    ]), FOOTER),
    conditional: `marketIntel && marketIntel.layers && marketIntel.layers.${index}`
      + ` && marketIntel.layers.${index}.omissionNote`,
  });

  return out;
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const pages: PageDef[] = [];

  // ── Cover ────────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Market Intelligence',
    tagline: 'Your dedicated property partner',
    marker: DOCUMENT_LABEL,
    eyebrow: '{{marketIntel.meta.reportTypeLabel}}',
    title: '{{marketIntel.meta.reportPeriod}}',
    standfirst:
      'Where the market stands this period, across rates, housing, sentiment, '
      + 'policy and the corridors we watch — and what it means for the next '
      + 'ninety days.',
    locations: 'Prepared {{marketIntel.meta.preparedOn | date}}',
    facts: [
      { label: 'Period', value: '{{marketIntel.meta.reportPeriod}}' },
      { label: 'Edition', value: '{{marketIntel.meta.audienceSegment}}' },
      { label: 'Sections', value: '{{marketIntel.meta.layersShown | fixed:0}}' },
      { label: 'Sources', value: '{{marketIntel.citationCount | fixed:0}}' },
    ],
  }));

  // ── Where it stands ──────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('Where it stands', [
      ...flow([
        sectionHeading({ eyebrow: 'This period', heading: 'Where the market stands' }),
        prose('{{marketIntel.narrative}}', textHeight(LENGTHS.narrative)),
        prose('{{marketIntel.prose.executiveSummary}}', textHeight(LENGTHS.executiveSummary)),
        {
          ...callout('Not every section returned', '{{marketIntel.layersOmitted}}'),
          conditional: 'marketIntel && marketIntel.layersOmitted',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: HAS_INTEL,
  });

  // ── What stands out ──────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('What stands out', [
      ...flow([
        sectionHeading({ eyebrow: 'This period', heading: 'Key insights' }),
        prose('{{marketIntel.prose.keyInsights}}', textHeight(LENGTHS.keyInsights)),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.prose && marketIntel.prose.keyInsights',
  });

  // ── The eight layers ─────────────────────────────────────────────────────
  const firstHeight = c.contentBottom - contentTop() - c.spacing.headingGap - 104;
  const contHeight = c.contentBottom - contentTop() - 12;
  for (let i = 0; i < LAYERS; i += 1) {
    pages.push(...layerPages(i, contHeight, firstHeight));
  }

  // ── What happened, and what is coming ────────────────────────────────────
  pages.push({
    ...withFurniture(page('The calendar', [
      ...flow([
        sectionHeading({ eyebrow: 'Dated', heading: 'What moved the market' }),
        table({
          headers: ['Date', 'Event', 'Impact'],
          rows: Array.from({ length: ROWS.events }, (_, i) => eventRow('events', i)),
          columnWidths: [80, c.contentWidth - 200, 120],
          numeric: [],
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.events',
  });

  pages.push({
    ...withFurniture(page('What is coming', [
      ...flow([
        sectionHeading({ eyebrow: 'Ahead', heading: 'What to watch' }),
        table({
          headers: ['Date', 'Event', 'Impact'],
          rows: Array.from({ length: ROWS.upcoming }, (_, i) => eventRow('upcoming', i)),
          columnWidths: [80, c.contentWidth - 200, 120],
          numeric: [],
        }),
        prose('{{marketIntel.prose.strategy}}', textHeight(LENGTHS.strategy)),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.upcoming',
  });

  // ── Sources ──────────────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('What it read', [
      ...flow([
        sectionHeading({ eyebrow: 'Grounding', heading: 'Sources' }),
        table({
          headers: ['Source'],
          rows: Array.from({ length: ROWS.citations }, (_, i) => [
            `{{marketIntel.citations.${i}.name}}`,
          ]),
          columnWidths: [c.contentWidth],
          numeric: [],
        }),
        {
          ...callout('Further sources', '{{marketIntel.citationsOmitted}}'),
          conditional: 'marketIntel && marketIntel.citationsOmitted',
        },
        {
          ...callout('What the budget did not show', '{{marketIntel.truncationNote}}'),
          conditional: 'marketIntel && marketIntel.truncationNote',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.citations',
  });

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({
    family, variant, manifest, c, pages, format: MARKET_INTELLIGENCE_FORMAT,
  });
}

/** Every Market Intelligence master, by family, in catalogue order. */
export const MARKET_INTELLIGENCE_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
