/**
 * Investment Compass — block helpers driven by a resolved manifest.
 *
 * ## How this differs from `scripts/template-library/blocks.ts`
 *
 * That module compiles the *voice* system: five studio voices keyed to the
 * catalogue's `style` axis, which is what the forty original seeded templates
 * are built in. This one compiles the *family* system from the approved
 * Investment Compass catalogue, where a template's look is a resolved manifest
 * of ~21 keys rather than a voice name.
 *
 * They are deliberately separate modules over one shared renderer. Merging them
 * would mean either bending the manifest keys into voice fields — losing the
 * distinctions the catalogue draws — or rewriting forty working templates to
 * prove a point. The renderer, the schema, the publish gate and the seed
 * pipeline are all shared; only the authoring vocabulary differs.
 *
 * ## The rules that hold
 *
 *  1. **Geometry is computed.** `flow()` stacks from the manifest's own margin,
 *     so a density change moves every block rather than needing 300 `y` values
 *     re-entered. Overflow past the footer is recorded and fails the build.
 *  2. **No literal colours.** Every colour is `token:*`, which is what lets a
 *     colourway repaint the document and keeps `isBrandSafe()` true.
 *  3. **Type comes from the manifest.** A helper never takes a point size from
 *     its call site; it reads the family's scale at the template's density.
 *  4. **Every value a report supplies is a `{{binding}}`.** Nothing a customer
 *     would want to change is hard-coded.
 */
import {
  MARGIN_PRESETS,
  PRIVATE_BANKING_TYPE,
  RULE_WEIGHTS,
  TRACKING,
  TYPE_SCALES,
  marginFor,
  radiusFor,
  spacingFor,
  type Density,
  type DesignFamily,
  type FamilyTypography,
  type SpacingScale,
  type TemplateManifest,
  type TypeScale,
  type VariantDefinition,
} from './family';

export const PAGE = { width: 595, height: 842 } as const;

/**
 * Height reserved at the foot of a content page.
 *
 * The archetype's footer is a hairline with the running foot under it, well
 * under this. The reserve is deliberately larger than the ink so a block that
 * ends exactly at the limit still has air beneath it.
 */
export const FOOTER_RESERVE = 30;

export interface BlockDef {
  id: string;
  type: string;
  props: Record<string, unknown>;
  overlays: never[];
  name?: string;
}

export interface PageDef {
  id: string;
  name: string;
  size: { width: number; height: number };
  background: { color: string };
  blocks: BlockDef[];
}

export interface FlowItem {
  block: (y: number) => BlockDef;
  height: number;
  /** Extra space after this block. Defaults to the manifest's spacing scale. */
  gap?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overflow log
// ─────────────────────────────────────────────────────────────────────────────

export interface Overflow {
  template: string;
  page: string;
  bottom: number;
  overBy: number;
}

const overflows: Overflow[] = [];
const UNNAMED = '(unnamed)';

/**
 * Drain the overflow log.
 *
 * The seed builder refuses to write a migration when this is non-empty. Without
 * it, a density or type-scale change pushes content under the footer on some
 * subset of the catalogue and the only symptom is a customer's report with a
 * truncated table.
 */
export function takeCompassOverflows(): Overflow[] {
  return overflows.splice(0, overflows.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// The compass context
// ─────────────────────────────────────────────────────────────────────────────

export interface Compass {
  family: DesignFamily;
  variant: VariantDefinition;
  manifest: TemplateManifest;
  type: FamilyTypography;
  scale: TypeScale;
  spacing: SpacingScale;
  density: Density;
  margin: number;
  /** Usable width inside the margins, less any navigation rail. */
  contentWidth: number;
  /** Left edge of content, past any navigation rail. */
  contentLeft: number;
  contentBottom: number;
  radius: number;
}

/** Width of the lane a vertical navigation rail occupies, including its gutter. */
export const RAIL_LANE = 30;

let counter = 0;
let active: Compass | null = null;

/** Deterministic ids: a regenerated migration must produce identical SQL. */
function id(type: string): string {
  counter += 1;
  return `ic-${type}-${counter.toString(36)}`;
}

export function beginCompassTemplate(
  family: DesignFamily,
  variant: VariantDefinition,
  manifest: TemplateManifest,
): Compass {
  counter = 0;
  const margin = marginFor(manifest);
  const railed = manifest.navigation_style === 'vertical_rail';
  const compass: Compass = {
    family,
    variant,
    manifest,
    type: PRIVATE_BANKING_TYPE,
    scale: TYPE_SCALES[manifest.density as Density] ?? TYPE_SCALES.balanced,
    spacing: spacingFor(manifest),
    density: manifest.density as Density,
    margin,
    contentLeft: margin + (railed ? RAIL_LANE : 0),
    contentWidth: PAGE.width - margin * 2 - (railed ? RAIL_LANE : 0),
    contentBottom: PAGE.height - margin - FOOTER_RESERVE,
    radius: radiusFor(manifest),
  };
  active = compass;
  return compass;
}

function ctx(): Compass {
  if (!active) throw new Error('beginCompassTemplate() must be called before any block helper');
  return active;
}

function block(type: string, props: Record<string, unknown>, name?: string): BlockDef {
  return { id: id(type), type, props, overlays: [], ...(name ? { name } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow
// ─────────────────────────────────────────────────────────────────────────────

/** Stack items down the page from `startY`, honouring the spacing scale. */
export function flow(items: FlowItem[], startY?: number): BlockDef[] {
  const c = ctx();
  let y = startY ?? c.margin;
  const out: BlockDef[] = [];
  for (const item of items) {
    out.push(item.block(y));
    y += item.height + (item.gap ?? c.spacing.gap);
  }
  const last = items[items.length - 1];
  const bottom = last ? y - (last.gap ?? c.spacing.gap) : y;
  if (bottom > c.contentBottom) {
    overflows.push({
      template: c.variant.code,
      page: UNNAMED,
      bottom,
      overBy: Math.round(bottom - c.contentBottom),
    });
  }
  return out;
}

export function page(name: string, blocks: BlockDef[], background = 'token:surface'): PageDef {
  for (let i = overflows.length - 1; i >= 0; i -= 1) {
    if (overflows[i].page !== UNNAMED) break;
    overflows[i].page = name;
  }
  return {
    id: id('page'),
    name,
    size: { width: PAGE.width, height: PAGE.height },
    background: { color: background },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page furniture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The running head — the two-part rule across the top of every content page.
 *
 * Left names the document and the asset, right names the part. The archetype
 * sets both in IBM Plex Mono at 6.2pt / 0.2em over a hairline. It is emitted as
 * two text blocks plus a divider rather than one element because the two halves
 * align to opposite edges, and there is no primitive that sets a line with a
 * left and a right end.
 */
export function runningHead(documentLabel: string, part: string): BlockDef[] {
  const c = ctx();
  // The document label carries `{{property.address}}`, which is one line for
  // "Lot 60448 Cloverton" and two for a strata address with a building name.
  // Two thirds of the measure keeps the common case on one line, and the rule
  // below reserves the second either way — a rule struck through the running
  // head is the kind of defect that only appears on somebody's real address.
  const labelWidth = Math.floor(c.contentWidth * 0.66);
  const y = c.margin;
  return [
    block('text-block', {
      body: documentLabel,
      bodySize: c.scale.runningHead,
      bodyFont: 'token:mono',
      bodyTracking: TRACKING.runningHead,
      bodyLineHeight: 1.35,
      color: 'token:muted',
      x: c.contentLeft, y, width: labelWidth,
    }, 'Running head'),
    block('text-block', {
      body: part,
      bodySize: c.scale.runningHead,
      bodyFont: 'token:mono',
      bodyAlign: 'right',
      color: 'token:muted',
      x: c.contentLeft + labelWidth, y, width: c.contentWidth - labelWidth,
    }, 'Part marker'),
    block('divider', {
      color: 'token:line',
      thickness: RULE_WEIGHTS.hairline,
      x: c.contentLeft, y: runningHeadBottom(), width: c.contentWidth,
    }),
  ];
}

/** Where the running head's rule sits — below two lines of label. */
function runningHeadBottom(): number {
  const c = ctx();
  return c.margin + Math.round(c.scale.runningHead * 1.35 * 2) + 5;
}

/** First usable y below the running head. */
export function contentTop(): number {
  const c = ctx();
  return runningHeadBottom() + c.spacing.sectionGap;
}

/**
 * The standing footer.
 *
 * `footer_style: rule_page_number` is a hairline with the foot under it.
 * `rail_number` moves the page number onto the rail, so the footer carries only
 * the reference and the number sits beside the rail marker.
 */
export function footer(text: string): BlockDef {
  const c = ctx();
  return block('footer', {
    text,
    // Left, because the page number takes the right end of the same line. The
    // archetype's foot is one rule with the reference at one end and the folio
    // at the other, not two stacked centred lines.
    align: 'left',
    bg: 'token:surface',
    color: 'token:muted',
    ruleColor: 'token:line',
    // Inset to the template's own margin so the footer rule spans exactly the
    // measure the content above it does.
    inset: c.margin,
    fontSize: c.scale.runningHead,
    height: FOOTER_HEIGHT,
  });
}

/** Height of the footer band. */
const FOOTER_HEIGHT = 22;

export function pageNumber(): BlockDef {
  const c = ctx();
  return block('page-number', {
    color: 'token:muted',
    align: 'right',
    inset: c.margin,
    size: c.scale.runningHead,
    // Vertically centred in the footer band, so it reads as the other end of
    // the footer line rather than as a separate element floating above it.
    y: PAGE.height - FOOTER_HEIGHT + (FOOTER_HEIGHT - c.scale.runningHead) / 2 - 1,
  });
}

/**
 * The vertical navigation rail — Bullion Rail's defining element.
 *
 * A gold rule down the full text block with the part number set against it at
 * the top. `navigation_style: vertical_rail` is the only manifest value that
 * produces it, and `RAIL_LANE` is already subtracted from `contentWidth`, so
 * body content never collides with it.
 */
export function navigationRail(part: string, section: string): BlockDef[] {
  const c = ctx();
  const top = c.margin;
  const height = c.contentBottom - top;
  return [
    block('divider', {
      orientation: 'vertical',
      color: 'token:primary',
      thickness: 2,
      x: c.margin, y: top, height,
    }, 'Navigation rail'),
    // The marker sits in the content column beside the rail, not in the 30pt
    // lane — horizontal type does not fit a 30pt measure, and rotating it is
    // not something the block vocabulary can express. It occupies the band a
    // running head would, because on this variant it IS the running head.
    block('text-block', {
      eyebrow: part,
      eyebrowSize: c.scale.eyebrow,
      eyebrowFont: 'token:mono',
      eyebrowTracking: TRACKING.eyebrow,
      eyebrowColor: 'token:primary',
      body: section,
      bodySize: c.scale.runningHead,
      bodyFont: 'token:mono',
      bodyTracking: TRACKING.runningHead,
      color: 'token:muted',
      x: c.contentLeft, y: top, width: c.contentWidth,
    }, 'Rail marker'),
  ];
}

/** Attach the furniture a content page needs, given the manifest. */
export function withFurniture(p: PageDef, footerText: string): PageDef {
  const c = ctx();
  const railNumber = c.manifest.footer_style === 'rail_number';
  return {
    ...p,
    blocks: [...p.blocks, footer(footerText), ...(railNumber ? [] : [pageNumber()])],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverOptions {
  /** The wordmark, set in the display face. Two lines. */
  wordmarkTop: string;
  wordmarkBottom: string;
  tagline: string;
  /** Top-right marker, e.g. "Investment Compass". */
  marker: string;
  eyebrow: string;
  title: string;
  standfirst: string;
  /** The location line under the standfirst. */
  locations: string;
  /** The four facts across the foot of the cover. */
  facts: Array<{ label: string; value: string }>;
}

/**
 * The cover.
 *
 * Composed from primitives rather than the `cover` block, on purpose. That
 * block anchors its title at 55% of the page, fixes the eyebrow at 10pt/0.08em
 * and draws a 60×3pt accent bar — a reasonable general cover, and not the one
 * this family approved. The approved composition is a wordmark and tagline at
 * the head, a tracked gold eyebrow over a Cinzel title at the optical centre, a
 * full-width hairline, an italic standfirst, and a ruled four-fact band at the
 * foot. Every one of those is an ordinary absolutely-positioned block, so the
 * page needs no renderer of its own.
 *
 * `cover_overlay` chooses the geometry:
 *   - `obsidian_full` — the reference: margins as declared.
 *   - `obsidian_bleed_portrait` — the title block runs to a wider measure and
 *     sits lower, for a single-asset presentation.
 *   - `obsidian_rail` — a gold rail down the binding edge.
 */
export function cover(opts: CoverOptions): PageDef {
  const c = ctx();
  const overlay = c.manifest.cover_overlay;
  const bleed = overlay === 'obsidian_bleed_portrait';
  const railed = overlay === 'obsidian_rail';

  const left = c.margin + (railed ? RAIL_LANE : 0);
  const width = PAGE.width - c.margin * 2 - (railed ? RAIL_LANE : 0);

  // ── Geometry, computed upward from the foot ──────────────────────────────
  //
  // The title is `{{property.address}}`, whose length is unknowable at build
  // time — "Lot 60448 Cloverton" is one line and "Unit 14B, Level 3, The
  // Sebastopol Residences, 1188-1200 Wentworthville Parade" is three. So the
  // title gets a RESERVED area two lines deep and everything below it is placed
  // against the fact band rather than against the title.
  //
  // Laying this out downward from a fixed title top is what put the gold
  // hairline through the second line of a two-line address.
  const factsHeight = c.density === 'spacious' ? 92 : c.density === 'compact' ? 68 : 78;
  const factsTop = PAGE.height - c.margin - factsHeight;

  const locationsHeight = 12;
  const locationsTop = factsTop - c.spacing.sectionGap - locationsHeight;

  // Three lines of standfirst: the summary narrative is a sentence or two, and
  // reserving for one line is the same mistake in a different place.
  const standfirstHeight = Math.round(c.scale.coverStandfirst * 1.4 * 3);
  const standfirstTop = locationsTop - 14 - standfirstHeight;

  const ruleY = standfirstTop - 16;

  // Two lines of title, plus the eyebrow above it and the h2's own 8pt margin.
  const titleHeight = Math.round(c.scale.coverTitle * 1.12 * 2) + 8;
  const eyebrowHeight = Math.round(c.scale.coverEyebrow + 12);
  const titleTop = ruleY - 14 - titleHeight - eyebrowHeight;

  const blocks: BlockDef[] = [];

  if (railed) {
    blocks.push(block('divider', {
      orientation: 'vertical',
      color: 'token:primary',
      thickness: 2,
      x: c.margin, y: c.margin, height: PAGE.height - c.margin * 2,
    }, 'Cover rail'));
  }

  // ── Head: wordmark, rule, tagline, marker ────────────────────────────────
  blocks.push(block('text-block', {
    body: `${opts.wordmarkTop}\n${opts.wordmarkBottom}`,
    bodySize: 11,
    bodyFont: 'token:display',
    bodyTracking: TRACKING.wordmark,
    bodyLineHeight: 1.35,
    color: 'token:text',
    x: left, y: c.margin, width: width - 140,
  }, 'Wordmark'));

  blocks.push(block('divider', {
    color: 'token:primary',
    thickness: 1,
    x: left, y: c.margin + 38, width: 74,
  }));

  blocks.push(block('text-block', {
    body: opts.tagline,
    bodySize: 6.4,
    bodyFont: 'token:mono',
    bodyTracking: 0.24,
    color: 'token:muted',
    x: left, y: c.margin + 46, width: width - 140,
  }, 'Tagline'));

  blocks.push(block('text-block', {
    body: opts.marker,
    bodySize: 6.4,
    bodyFont: 'token:mono',
    bodyAlign: 'right',
    color: 'token:muted',
    x: left + width - 140, y: c.margin, width: 140,
  }, 'Cover marker'));

  // ── Title block ──────────────────────────────────────────────────────────
  blocks.push(block('text-block', {
    eyebrow: opts.eyebrow,
    eyebrowSize: c.scale.coverEyebrow,
    eyebrowFont: 'token:mono',
    eyebrowTracking: TRACKING.coverEyebrow,
    eyebrowColor: 'token:primary',
    heading: opts.title,
    headingSize: c.scale.coverTitle,
    headingFont: 'token:display',
    headingWeight: 400,
    headingLineHeight: 1.12,
    headingColor: 'token:text',
    x: left, y: titleTop, width: bleed ? width : Math.round(width * 0.86),
  }, 'Cover title'));

  blocks.push(block('divider', {
    color: 'token:primary',
    thickness: RULE_WEIGHTS.hairline,
    x: left, y: ruleY, width,
  }));

  blocks.push(block('text-block', {
    body: opts.standfirst,
    bodySize: c.scale.coverStandfirst,
    bodyFont: 'token:heading',
    bodyStyle: 'italic',
    bodyLineHeight: 1.4,
    color: 'token:muted',
    x: left, y: standfirstTop, width: Math.round(width * 0.86),
  }, 'Standfirst'));

  blocks.push(block('text-block', {
    body: opts.locations,
    bodySize: 7,
    bodyFont: 'token:mono',
    bodyTracking: 0.16,
    color: 'token:muted',
    x: left, y: locationsTop, width,
  }, 'Locations'));

  // ── Foot: the ruled fact band ────────────────────────────────────────────
  blocks.push(block('kpi-grid', {
    variant: 'ruled',
    items: opts.facts,
    columns: opts.facts.length,
    valueFont: 'token:heading',
    labelFont: 'token:mono',
    labelSize: 6,
    labelTracking: TRACKING.label,
    valueSize: c.density === 'spacious' ? 14 : 11,
    valueColor: 'token:text',
    labelColor: 'token:muted',
    ruleColor: 'token:line',
    emphasisColor: 'token:line',
    x: left, y: factsTop, width, height: factsHeight,
  }, 'Cover facts'));

  return page('Cover', blocks, 'token:bg');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section furniture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A section opener.
 *
 * `section_header_style` decides the shape:
 *   - `eyebrow_rule_display` — tracked gold eyebrow over a Playfair heading.
 *   - `full_bleed_numeral` — an oversized numeral in the rule colour beside the
 *     heading, for the expansive cut.
 *   - `rail_marker` — the eyebrow moves to the rail, so the opener is heading
 *     only and the page reads from the rail inwards.
 */
export function sectionHeading(opts: {
  eyebrow: string;
  heading: string;
  numeral?: string;
  height?: number;
}): FlowItem {
  const c = ctx();
  const style = c.manifest.section_header_style;
  const height = opts.height ?? (style === 'full_bleed_numeral' ? 82 : 62);

  if (style === 'full_bleed_numeral' && opts.numeral) {
    return {
      height,
      block: (y) => block('two-column', {
        leftHeading: opts.numeral,
        leftBody: opts.eyebrow,
        rightHeading: opts.heading,
        rightBody: '',
        ratio: 0.26,
        gap: 26,
        headingSize: c.scale.heading,
        headingColor: 'token:ink',
        bodySize: c.scale.eyebrow,
        bodyColor: 'token:primary',
        x: c.contentLeft, y, width: c.contentWidth,
      }, 'Section opener'),
    };
  }

  return {
    height,
    block: (y) => block('text-block', {
      ...(style === 'rail_marker' ? {} : {
        eyebrow: opts.eyebrow,
        eyebrowSize: c.scale.eyebrow,
        eyebrowFont: 'token:mono',
        eyebrowTracking: TRACKING.eyebrow,
        eyebrowColor: 'token:primary',
      }),
      heading: opts.heading,
      headingSize: c.scale.heading,
      headingFont: 'token:heading',
      headingWeight: 400,
      headingLineHeight: 1.14,
      headingColor: 'token:ink',
      x: c.contentLeft, y, width: c.contentWidth,
    }, 'Section opener'),
  };
}

/** The verdict heading — the dashboard's oversized statement. */
export function verdict(opts: { eyebrow: string; heading: string; body: string }): FlowItem {
  const c = ctx();
  return {
    height: c.density === 'compact' ? 108 : c.density === 'spacious' ? 168 : 132,
    block: (y) => block('text-block', {
      eyebrow: opts.eyebrow,
      eyebrowSize: c.scale.eyebrow,
      eyebrowFont: 'token:mono',
      eyebrowTracking: TRACKING.eyebrow,
      eyebrowColor: 'token:primary',
      heading: opts.heading,
      headingSize: c.scale.verdict,
      headingFont: 'token:heading',
      headingWeight: 400,
      headingLineHeight: 1.1,
      headingColor: 'token:ink',
      body: opts.body,
      bodySize: c.scale.body,
      bodyFont: 'token:body',
      bodyLineHeight: 1.6,
      color: 'token:ink',
      x: c.contentLeft, y, width: c.contentWidth,
    }, 'Verdict'),
  };
}

export function prose(body: string, height?: number): FlowItem {
  const c = ctx();
  return {
    height: height ?? 56,
    block: (y) => block('text-block', {
      body,
      bodySize: c.scale.body,
      bodyFont: 'token:body',
      bodyLineHeight: 1.62,
      bodyAlign: 'justify',
      color: 'token:ink',
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

export function rule(weight: number = RULE_WEIGHTS.hairline): FlowItem {
  const c = ctx();
  return {
    height: 2,
    gap: c.spacing.headingGap,
    block: (y) => block('divider', {
      color: 'token:line',
      style: 'solid',
      thickness: weight,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────────────────────────────────────────

export interface KpiItem {
  label: string;
  value: string;
  note?: string;
  accent?: string;
}

/**
 * The KPI band, in whichever arrangement the manifest declares.
 *
 * This is the family's principal structural variable, and the one place where
 * the five Private Banking masters most visibly diverge: the same four figures
 * are a ruled four-column band on Chancery, a six-column band on Chancery
 * Compact, a two-up display grid on Sovereign Folio, a stack against the rail
 * on Bullion Rail, and a ledger of label/figure rows on Discretion Ledger.
 */
export function kpis(items: KpiItem[]): FlowItem {
  const c = ctx();
  const layout = c.manifest.kpi_layout;

  const shared = {
    items,
    valueFont: 'token:heading',
    labelFont: 'token:mono',
    noteFont: 'token:body',
    labelSize: c.scale.kpiLabel,
    noteSize: c.scale.kpiNote,
    labelTracking: TRACKING.label,
    valueColor: 'token:ink',
    labelColor: 'token:muted',
    ruleColor: 'token:line',
    emphasisColor: 'token:ink',
    valueWeight: 400,
    x: c.contentLeft,
    width: c.contentWidth,
  };

  if (layout === 'two_by_two_display') {
    const height = 84 + Math.ceil(Math.min(items.length, 4) / 2) * 58;
    return {
      height,
      block: (y) => block('kpi-grid', {
        ...shared, variant: 'display', columns: 2,
        valueSize: c.scale.kpiValue, y, height,
      }, 'KPI display'),
    };
  }

  if (layout === 'ledger_rows') {
    const height = 12 + items.length * (c.scale.kpiValue + 16);
    return {
      height,
      block: (y) => block('kpi-grid', {
        ...shared, variant: 'rows',
        valueSize: Math.round(c.scale.kpiValue * 0.72), y, height,
      }, 'KPI ledger'),
    };
  }

  if (layout === 'stacked_rail') {
    const height = items.length * (c.scale.kpiValue + 26);
    return {
      height,
      block: (y) => block('kpi-grid', {
        ...shared, variant: 'stacked',
        accent: 'token:primary',
        valueSize: Math.round(c.scale.kpiValue * 0.8), y, height,
      }, 'KPI stack'),
    };
  }

  // four_column_ruled / six_column_ruled
  const columns = layout === 'six_column_ruled' ? 6 : 4;
  const height = c.density === 'compact' ? 66 : 82;
  return {
    height,
    block: (y) => block('kpi-grid', {
      ...shared, variant: 'ruled', columns,
      // Six columns give each figure ~78pt of measure; a formatted currency
      // value overruns the four-column size there, so the band steps down.
      valueSize: columns === 6 ? Math.round(c.scale.kpiValue * 0.66) : c.scale.kpiValue,
      y, height,
    }, 'KPI band'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ledger table.
 *
 * `table_style` decides the treatment. All three Private Banking values are
 * unfilled statements — the difference is padding and how a total is closed:
 *   - `ledger_hairline` — hairline between rows, heavy rule under the heads.
 *   - `ledger_tight` — the same at compact padding.
 *   - `double_rule_statement` — totals closed by a doubled rule.
 */
export function table(opts: {
  headers: string[];
  rows: string[][];
  columnWidths?: number[];
  /** Indices of rows that close a total. */
  totals?: number[];
  numeric?: number[];
  stripe?: boolean;
}): FlowItem {
  const c = ctx();
  const style = c.manifest.table_style;
  const tight = style === 'ledger_tight';
  const rowHeight = tight ? c.spacing.rowHeight - 3 : c.spacing.rowHeight;
  const numericColumns = opts.numeric ?? opts.headers.map((_, i) => i).slice(1);

  return {
    height: 24 + opts.rows.length * rowHeight,
    block: (y) => block('data-table', {
      headers: opts.headers,
      rows: opts.rows.map((cells) => ({ cells })),
      ...(opts.columnWidths ? { columnWidths: opts.columnWidths } : {}),
      // A statement has no filled header band.
      headerStyle: 'rule',
      headerFont: 'token:mono',
      headerSize: c.scale.columnHead,
      headerTracking: TRACKING.columnHead,
      numericFont: 'token:heading',
      numericColumns,
      ...(opts.totals?.length ? { totalRows: opts.totals } : {}),
      rowRule: true,
      outerBorder: false,
      stripeBg: opts.stripe === false ? 'transparent' : 'token:panel',
      cellFg: 'token:ink',
      borderColor: 'token:line',
      emphasisColor: 'token:ink',
      negativeColor: 'token:negative',
      fontSize: c.scale.cell,
      cellPadding: tight ? c.spacing.cellPadding - 1.5 : c.spacing.cellPadding,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Callouts, risk, recommendation
// ─────────────────────────────────────────────────────────────────────────────

/** A callout in whichever treatment `callout_style` declares. */
export function callout(title: string, body: string, height?: number): FlowItem {
  const c = ctx();
  const margin = c.manifest.callout_style === 'margin_note';
  return {
    height: height ?? (margin ? 58 : 72),
    block: (y) => block('callout', {
      title,
      body,
      variant: 'info',
      style: margin ? 'margin' : 'bar',
      accent: 'token:primary',
      titleColor: 'token:primary',
      bg: margin ? 'transparent' : 'token:panel',
      ruleColor: 'token:primary',
      color: 'token:ink',
      titleFont: 'token:mono',
      bodyFont: 'token:body',
      titleSize: c.scale.kpiLabel,
      titleTracking: TRACKING.label,
      bodySize: c.scale.cell,
      radius: c.radius,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

/** The risk presentation, per `risk_display`. */
export function risks(
  title: string,
  items: Array<{ risk: string; rating: string; confidence: string; why: string; ddAction: string; note?: string }>,
): FlowItem {
  const c = ctx();
  const bars = c.manifest.risk_display === 'severity_bars';
  return {
    height: bars ? 26 + items.length * 24 : 44 + items.length * 46,
    block: (y) => block('risk-register', {
      title,
      items,
      ...(bars ? { display: 'bars' } : {}),
      titleBg: 'token:bg',
      titleFg: 'token:primary',
      headerBg: 'token:panel',
      headerFg: 'token:muted',
      stripeBg: 'token:panel',
      rowBg: 'token:surface',
      cellFg: 'token:ink',
      mutedColor: 'token:muted',
      borderColor: 'token:line',
      negativeColor: 'token:negative',
      cautionColor: 'token:caution',
      positiveColor: 'token:positive',
      labelFont: 'token:mono',
      bodyFont: 'token:body',
      eyebrowFont: 'token:mono',
      labelTracking: TRACKING.columnHead,
      eyebrowTracking: TRACKING.label,
      fontSize: c.scale.cell,
      titleSize: c.scale.eyebrow,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

/**
 * The recommendation.
 *
 * `obsidian_card` sets it on the field colour — the one place a content page
 * carries the cover's ground. `ruled_statement` sets it as ruled type on paper,
 * for the reader who wants the recommendation to read like the rest of the
 * statement rather than like a panel.
 */
export function recommendation(heading: string, body: string): FlowItem {
  const c = ctx();
  const ruled = c.manifest.recommendation_style === 'ruled_statement';
  if (ruled) {
    return {
      height: 96,
      block: (y) => block('text-block', {
        eyebrow: 'Recommendation',
        eyebrowSize: c.scale.kpiLabel,
        eyebrowFont: 'token:mono',
        eyebrowTracking: TRACKING.label,
        eyebrowColor: 'token:primary',
        heading,
        headingSize: Math.round(c.scale.heading * 0.72),
        headingFont: 'token:heading',
        headingWeight: 400,
        headingLineHeight: 1.2,
        headingColor: 'token:ink',
        body,
        bodySize: c.scale.body,
        bodyFont: 'token:body',
        bodyLineHeight: 1.55,
        color: 'token:ink',
        x: c.contentLeft, y, width: c.contentWidth,
      }, 'Recommendation'),
    };
  }
  // `obsidian_card`: the recommendation on the cover's own ground. `maxWords` is
  // lifted because the default 60-word cap silently truncates an adviser's
  // recommendation, and a client-facing sentence ending in an ellipsis is worse
  // than a longer card.
  return {
    height: 96,
    block: (y) => block('decision-box', {
      heading,
      body,
      maxWords: 90,
      accent: 'token:primary',
      bg: 'token:bg',
      color: 'token:text',
      headingColor: 'token:primary',
      headingFont: 'token:mono',
      headingSize: c.scale.kpiLabel,
      headingTracking: TRACKING.label,
      bodyFont: 'token:body',
      bodySize: c.scale.body,
      radius: c.radius,
      barWidth: 2,
      x: c.contentLeft, y, width: c.contentWidth,
    }, 'Recommendation'),
  };
}

export function strengthsWatch(strengths: string[], watch: string[]): FlowItem {
  const c = ctx();
  return {
    height: 36 + Math.max(strengths.length, watch.length) * 32,
    block: (y) => block('strengths-watch', {
      strengthsTitle: 'Strengths',
      strengths,
      watchTitle: 'Considerations',
      watch,
      positiveColor: 'token:positive',
      cautionColor: 'token:negative',
      onFillColor: 'token:surface',
      color: 'token:ink',
      radius: c.radius,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

export function definitions(
  title: string,
  items: Array<{ term: string; definition: string }>,
): FlowItem {
  const c = ctx();
  return {
    height: 30 + items.length * 26,
    block: (y) => block('definition-list', {
      title, items, x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scenario chart.
 *
 * `chart_style: line_editorial` is a plain line with an editorial caption;
 * `stepped_area` is the same series as a filled area, for the ledger cut that
 * wants the accumulation shown rather than the trajectory.
 */
export function scenarioChart(opts: {
  title: string;
  caption: string;
  dataPath: string;
  data: Array<{ label: string; value: number }>;
  height?: number;
}): FlowItem {
  const c = ctx();
  const area = c.manifest.chart_style === 'stepped_area';
  const height = opts.height ?? (c.density === 'compact' ? 158 : c.density === 'spacious' ? 224 : 186);
  return {
    height,
    block: (y) => block(area ? 'chart-area' : 'chart-line', {
      title: opts.title,
      caption: opts.caption,
      dataPath: opts.dataPath,
      data: opts.data,
      labelKey: 'label',
      valueKey: 'value',
      accent: 'token:primary',
      x: c.contentLeft, y, width: c.contentWidth, height,
    }),
  };
}

export function barChart(opts: {
  title: string;
  caption: string;
  dataPath: string;
  data: Array<{ label: string; value: number }>;
  height?: number;
}): FlowItem {
  const c = ctx();
  const height = opts.height ?? (c.density === 'compact' ? 150 : 178);
  return {
    height,
    block: (y) => block('chart-bar', {
      title: opts.title,
      caption: opts.caption,
      dataPath: opts.dataPath,
      data: opts.data,
      labelKey: 'label',
      valueKey: 'value',
      accent: 'token:primary',
      x: c.contentLeft, y, width: c.contentWidth, height,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Appendix
// ─────────────────────────────────────────────────────────────────────────────

export function disclaimerPage(text: string): PageDef {
  return page('Important information', [
    block('disclaimer', {
      companyName: '{{org.name}}',
      abn: '{{org.abn}}',
      address: '{{org.address}}',
      phone: '{{org.phone}}',
      email: '{{org.email}}',
      website: '{{org.website}}',
      disclaimerText: text,
      fontSize: 8,
    }),
  ]);
}

export { MARGIN_PRESETS };
