/**
 * What a Market Intelligence template may bind.
 *
 * ## This restates the report, it does not re-read the row
 *
 * `_shared/reports/marketIntelligence/` already builds a
 * `MarketIntelligenceReport` for `render-market-intelligence-pdf` — the eight
 * layers in order, the editorial strips applied, the events, the citations and
 * a notices ledger. This restates that, as every other projection in this
 * programme restates its normaliser.
 *
 * The strips matter: `cleanLayerContent` removes the model's "data limitations"
 * boilerplate, its empty regulatory sections and its duplicated brand tagline.
 * Re-reading `report_data` here would put all three back on a client's page.
 *
 * ## The layers stay Markdown
 *
 * Each layer is Markdown as the model wrote it. It is published as **source**
 * for `markdown-block`, which renders it through the programme's escape-first
 * renderer — the same arrangement Report Q&A uses, and for the same reason:
 * safety belongs to the renderer, so a projection that pre-rendered HTML would
 * move the escaping decision to its caller.
 *
 * ## Only layers with content are published
 *
 * The payload carries empty layers so a document can say it asked. Measured
 * across the six stored reports, **8 of 48 layer bodies are absent** — one
 * housing, two regulatory, one outlook, two suburb, two competitive edge.
 *
 * Publishing them in place would leave holes in the index a template binds by
 * (`layers.3` empty while `layers.4` has content), so a master would need a
 * conditional per layer *and* per position. Instead the empty ones are dropped
 * from `layers` and named in `layersOmitted`, so `layers.0…n` are all real and
 * the document still says what it asked for and did not get.
 *
 * ## Clipping is expected here, not exceptional
 *
 * This is the format that clips a section and says so on the page, and the
 * record shows why: `layer8_competitive_edge` runs 15,055 characters at the
 * median, and one stored `layer5_outlook` is **244,332** — about ninety-nine
 * pages of one section. Each layer therefore publishes the number of pages it
 * needs and, where a master's allocation is smaller, a whole sentence naming
 * what is not shown.
 */
import { renderMarkdown } from './reports/markdown.pure.ts';
import { packMarkdownPages, DEFAULT_LINES_PER_PAGE } from './reports/markdownPaging.pure.ts';
import type {
  MarketIntelligenceReport,
  Layer,
  MarketEvent,
} from './reports/marketIntelligence/payload.pure.ts';

/**
 * Pages a master allocates per layer, and the collection caps.
 *
 * `layerPages` is the number of `markdown-block` pages a master declares for
 * each of the eight layers. Three covers the median of seven of them outright;
 * the eighth (`competitive_edge`, 15,055 characters at p50) is clipped and says
 * so. Raising it multiplies across eight layers and fifty masters, which is a
 * seed-size decision as much as a design one.
 */
export const CAPS = {
  layerPages: 3,
  layers: 8,
  events: 10,
  upcomingEvents: 6,
  citations: 12,
} as const;

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/**
 * How many pages this Markdown needs at the master's line budget.
 *
 * Shared with the block through `packMarkdownPages`, so a master's conditional
 * and the block's output cannot disagree. See `reports/markdownPaging.pure.ts`.
 */
export function layerPageCount(
  markdown: string,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): number {
  const source = str(markdown);
  if (!source) return 0;
  return packMarkdownPages(renderMarkdown(source).blocks, linesPerPage).length;
}

function projectLayer(layer: Layer, linesPerPage: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'key', str(layer.key));
  put(out, 'title', str(layer.title));
  put(out, 'content', str(layer.content));

  const pages = layerPageCount(layer.content, linesPerPage);
  put(out, 'pages', pages || undefined);

  /*
   * A whole sentence, and only when the allocation actually bites.
   *
   * Not a fragment: a template concatenating "…and N more" into a heading is
   * left with a dangling clause when there is nothing to omit. The Cash Flow
   * Comparison's `matched` taught this.
   */
  if (pages > CAPS.layerPages) {
    const hidden = pages - CAPS.layerPages;
    put(out, 'omissionNote',
      `This section continues for ${hidden} further ${hidden === 1 ? 'page' : 'pages'}, `
      + 'which are not shown in this edition.');
  }

  const citations = (layer.citations ?? []).map(str).filter(Boolean) as string[];
  put(out, 'citationCount', citations.length || undefined);
  return out;
}

function projectEvent(event: MarketEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'date', str(event.date));
  put(out, 'event', str(event.event));
  put(out, 'category', str(event.category));
  put(out, 'impact', str(event.impact));
  put(out, 'description', str(event.description));
  // `relevanceScore` is nullable and a null is not a zero — a zero would sort
  // and print as a real judgement of "no relevance", which is not what an
  // absent score means.
  if (typeof event.relevanceScore === 'number' && Number.isFinite(event.relevanceScore)) {
    out.relevanceScore = event.relevanceScore;
  }
  return out;
}

export interface ProjectedMarketIntelligence {
  marketIntel: Record<string, unknown>;
}

export function projectMarketIntelligence(
  report: MarketIntelligenceReport,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): ProjectedMarketIntelligence {
  const marketIntel: Record<string, unknown> = {};
  const r = report as unknown as Record<string, any>;

  const allLayers: Layer[] = Array.isArray(r.layers) ? r.layers : [];
  const filled = allLayers.filter((l) => !l?.empty && str(l?.content));

  // Nothing to describe means nothing published, so a page conditional on
  // `marketIntel` cannot draw blank. `audienceSegment` and `reportTypeLabel` are
  // always present on the payload and would otherwise make this truthy — the
  // defect found in the Report Q&A and Capacity projections.
  const hasContent = filled.length > 0 || Boolean(str(r.narrative));
  if (!hasContent) return { marketIntel };

  const meta: Record<string, unknown> = {};
  put(meta, 'reportPeriod', str(r.meta?.reportPeriod));
  put(meta, 'reportTypeLabel', str(r.meta?.reportTypeLabel));
  put(meta, 'audienceSegment', str(r.meta?.audienceSegment));
  put(meta, 'preparedOn', str(r.meta?.preparedOn));
  put(meta, 'generatedAt', str(r.meta?.generatedAt));
  put(meta, 'layersShown', filled.length || undefined);
  if (Object.keys(meta).length) marketIntel.meta = meta;

  put(marketIntel, 'narrative', str(r.narrative));

  const prose = r.prose ?? {};
  const proseOut: Record<string, unknown> = {};
  put(proseOut, 'executiveSummary', str(prose.executiveSummary));
  put(proseOut, 'keyInsights', str(prose.keyInsightsSnapshot));
  put(proseOut, 'strategy', str(prose.actionableStrategy));
  // `ctaContent` is deliberately not published. It is the generator's
  // call-to-action for the email the legacy attached this PDF to; a template is
  // a document rather than a campaign, and a "book a call" panel in the middle
  // of a market report reads as an advertisement.
  if (Object.keys(proseOut).length) marketIntel.prose = proseOut;

  if (filled.length) {
    marketIntel.layers = filled.slice(0, CAPS.layers).map((l) => projectLayer(l, linesPerPage));
  }

  const empties = allLayers.filter((l) => l?.empty || !str(l?.content));
  if (empties.length) {
    const names = empties.map((l) => str(l?.title)).filter(Boolean) as string[];
    if (names.length) {
      put(marketIntel, 'layersOmitted',
        `${names.length === 1 ? 'One section was' : `${names.length} sections were`} `
        + `requested and returned no content: ${names.join(', ')}.`);
    }
  }

  // ── events ───────────────────────────────────────────────────────────────
  const events: MarketEvent[] = Array.isArray(r.events) ? r.events : [];
  const upcoming = events.filter((e) => e?.upcoming);
  const past = events.filter((e) => !e?.upcoming);
  if (past.length) {
    marketIntel.events = past.slice(0, CAPS.events).map(projectEvent);
    put(marketIntel, 'eventCount', past.length);
  }
  if (upcoming.length) {
    marketIntel.upcoming = upcoming.slice(0, CAPS.upcomingEvents).map(projectEvent);
    put(marketIntel, 'upcomingCount', upcoming.length);
  }

  // ── sources ──────────────────────────────────────────────────────────────
  const citations = (Array.isArray(r.citations) ? r.citations : [])
    .map(str).filter(Boolean) as string[];
  if (citations.length) {
    marketIntel.citations = citations.slice(0, CAPS.citations).map((name) => ({ name }));
    put(marketIntel, 'citationCount', citations.length);
    if (citations.length > CAPS.citations) {
      put(marketIntel, 'citationsOmitted',
        `${citations.length - CAPS.citations} further sources are listed in the full edition.`);
    }
  }

  // ── what the document itself dropped ─────────────────────────────────────
  //
  // The normaliser's own ledger, restated. This format's contract is that it
  // clips and says so, and a notice the reader never sees is the same as no
  // notice at all.
  const notices = r.notices ?? {};
  const dropped = Number(notices.sectionsDropped ?? 0);
  const omitted = Number(notices.charsOmitted ?? 0);
  if (dropped > 0 || omitted > 0) {
    const parts: string[] = [];
    if (dropped > 0) parts.push(`${dropped} ${dropped === 1 ? 'section' : 'sections'}`);
    if (omitted > 0) parts.push(`${omitted.toLocaleString('en-AU')} characters`);
    put(marketIntel, 'truncationNote',
      `The document budget did not show ${parts.join(' and ')}.`);
  }

  return { marketIntel };
}

export function applyMarketIntelligenceProjection(
  target: Record<string, unknown>,
  report: MarketIntelligenceReport,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): void {
  const { marketIntel } = projectMarketIntelligence(report, linesPerPage);
  if (Object.keys(marketIntel).length) target.marketIntel = marketIntel;
}
