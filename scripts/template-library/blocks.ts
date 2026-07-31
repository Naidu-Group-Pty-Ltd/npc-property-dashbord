/**
 * Composable page/block helpers for the seeded catalogue.
 *
 * Two rules hold everything together:
 *
 *  1. **Geometry is computed, never guessed.** `flow()` stacks blocks down a
 *     page from a single margin constant, so a template author changes content
 *     without recalculating a column of `y` values — and a block cannot
 *     silently overlap the one above it.
 *  2. **Percentages are supplied in percentage units.** The `percent` filter
 *     formats the number it is given (`3.84` → `"3.84%"`); it does not multiply
 *     by 100. A binding fed a fraction renders `0.04%` in a customer's report.
 *  3. **No literal colours.** Every colour is a `token:*` reference, so the
 *     white-label pipeline can re-skin a template completely and
 *     `isBrandSafe()` reports true. The block renderers already default to
 *     `token:primary` / `token:bg` / `token:muted`, so the safest thing an
 *     author can do is omit a colour entirely.
 */
import { randomUUID } from 'node:crypto';

export const PAGE = { width: 595, height: 842 } as const;
export const MARGIN = 42;
export const CONTENT_WIDTH = PAGE.width - MARGIN * 2; // 511pt

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

/** A block plus the vertical space it should occupy in a flow. */
export interface FlowItem {
  block: (y: number) => BlockDef;
  height: number;
  /** Extra space after this block. */
  gap?: number;
}

let counter = 0;
/** Deterministic ids: a seed migration re-run must produce identical SQL. */
function id(type: string): string {
  counter += 1;
  return `seed-${type}-${counter.toString(36)}`;
}

export function resetIds(): void {
  counter = 0;
}

function block(type: string, props: Record<string, unknown>, name?: string): BlockDef {
  return { id: id(type), type, props, overlays: [], ...(name ? { name } : {}) };
}

/** Stack items from `startY`, honouring each item's height and gap. */
export function flow(items: FlowItem[], startY = MARGIN): BlockDef[] {
  let y = startY;
  const out: BlockDef[] = [];
  for (const item of items) {
    out.push(item.block(y));
    y += item.height + (item.gap ?? 16);
  }
  return out;
}

export function page(name: string, blocks: BlockDef[], background = 'token:surface'): PageDef {
  return {
    id: id('page'),
    name,
    size: { width: PAGE.width, height: PAGE.height },
    background: { color: background },
    blocks,
  };
}

// ── Cover ────────────────────────────────────────────────────────────────────

export function cover(opts: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  footnote?: string;
  titleSize?: number;
}): PageDef {
  return page('Cover', [
    block('cover', {
      eyebrow: opts.eyebrow,
      title: opts.title,
      subtitle: opts.subtitle ?? '',
      footnote: opts.footnote ?? '',
      titleSize: opts.titleSize ?? 40,
      bg: 'token:bg',
      accent: 'token:primary',
      color: 'token:text',
    }),
  ], 'token:bg');
}

// ── Flow-item factories ──────────────────────────────────────────────────────

export function heading(text: string, body?: string, height = 58): FlowItem {
  return {
    height,
    block: (y) => block('text-block', {
      heading: text,
      body: body ?? '',
      headingSize: 17,
      headingColor: 'token:primary',
      bodySize: 9.5,
      color: 'token:ink',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function prose(body: string, height = 52): FlowItem {
  return {
    height,
    block: (y) => block('text-block', {
      body,
      bodySize: 9.5,
      color: 'token:ink',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function rule(height = 2): FlowItem {
  return {
    height,
    gap: 14,
    block: (y) => block('divider', {
      color: 'token:primary', style: 'solid', thickness: 1.5,
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function kpis(items: Array<{ label: string; value: string }>, height = 92): FlowItem {
  return {
    height,
    block: (y) => block('kpi-grid', {
      items,
      columns: Math.min(items.length, 4),
      gap: 12,
      tileBg: 'token:panel',
      accent: 'token:primary',
      labelColor: 'token:muted',
      x: MARGIN, y, width: CONTENT_WIDTH, height,
    }),
  };
}

export function table(
  headers: string[],
  rows: string[][],
  columnWidths?: number[],
  rowHeight = 22,
): FlowItem {
  return {
    height: 30 + rows.length * rowHeight,
    block: (y) => block('data-table', {
      headers,
      rows: rows.map((cells) => ({ cells })),
      ...(columnWidths ? { columnWidths } : {}),
      headerBg: 'token:primary',
      headerFg: 'token:onPrimary',
      stripeBg: 'token:panel',
      cellFg: 'token:ink',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function callout(title: string, body: string, variant = 'info', height = 66): FlowItem {
  return {
    height,
    block: (y) => block('callout', {
      title, body, variant,
      accent: 'token:primary',
      bg: 'token:panel',
      color: 'token:ink',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function twoColumn(
  left: { heading: string; body: string },
  right: { heading: string; body: string },
  height = 130,
): FlowItem {
  return {
    height,
    block: (y) => block('two-column', {
      leftHeading: left.heading, leftBody: left.body,
      rightHeading: right.heading, rightBody: right.body,
      ratio: 0.5, gap: 22,
      headingSize: 12, headingColor: 'token:primary',
      bodySize: 9.5, bodyColor: 'token:ink',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function barChart(opts: {
  title: string;
  caption?: string;
  /** Binding path to the live series, e.g. `market.priceSeries`. */
  dataPath?: string;
  /** Placeholder series drawn when no data is bound (editor + preview). */
  data: Array<{ label: string; value: number }>;
  height?: number;
}): FlowItem {
  const height = opts.height ?? 190;
  return {
    height,
    block: (y) => block('chart-bar', {
      title: opts.title,
      caption: opts.caption ?? '',
      ...(opts.dataPath ? { dataPath: opts.dataPath } : {}),
      data: opts.data,
      labelKey: 'label',
      valueKey: 'value',
      accent: 'token:primary',
      x: MARGIN, y, width: CONTENT_WIDTH, height,
    }),
  };
}

export function lineChart(opts: {
  title: string;
  caption?: string;
  /** Binding path to the live series, e.g. `market.priceSeries`. */
  dataPath?: string;
  /** Placeholder series drawn when no data is bound (editor + preview). */
  data: Array<{ label: string; value: number }>;
  height?: number;
}): FlowItem {
  const height = opts.height ?? 190;
  return {
    height,
    block: (y) => block('chart-line', {
      title: opts.title,
      caption: opts.caption ?? '',
      ...(opts.dataPath ? { dataPath: opts.dataPath } : {}),
      data: opts.data,
      labelKey: 'label',
      valueKey: 'value',
      accent: 'token:primary',
      x: MARGIN, y, width: CONTENT_WIDTH, height,
    }),
  };
}

export function donutChart(opts: {
  title: string;
  caption?: string;
  /** Binding path to the live series, e.g. `market.priceSeries`. */
  dataPath?: string;
  /** Placeholder series drawn when no data is bound (editor + preview). */
  data: Array<{ label: string; value: number }>;
  height?: number;
}): FlowItem {
  const height = opts.height ?? 200;
  return {
    height,
    block: (y) => block('chart-donut', {
      title: opts.title,
      caption: opts.caption ?? '',
      ...(opts.dataPath ? { dataPath: opts.dataPath } : {}),
      data: opts.data,
      labelKey: 'label',
      valueKey: 'value',
      accent: 'token:primary',
      x: MARGIN, y, width: CONTENT_WIDTH, height,
    }),
  };
}

export function scorecard(
  title: string,
  items: Array<{ category: string; rating: string; note?: string }>,
): FlowItem {
  return {
    height: 34 + items.length * 26,
    block: (y) => block('scorecard', {
      title, items, x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function riskRegister(
  title: string,
  items: Array<{ risk: string; rating: string; confidence: string; why: string; ddAction: string }>,
): FlowItem {
  return {
    height: 40 + items.length * 46,
    block: (y) => block('risk-register', {
      title, items, x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function checklist(
  title: string,
  items: Array<{ action: string; owner?: string; timing?: string }>,
): FlowItem {
  return {
    height: 34 + items.length * 24,
    block: (y) => block('dd-checklist', {
      title, items, x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function strengthsWatch(strengths: string[], watch: string[]): FlowItem {
  return {
    height: 40 + Math.max(strengths.length, watch.length) * 20,
    block: (y) => block('strengths-watch', {
      strengthsTitle: 'Strengths',
      strengths,
      watchTitle: 'Watch points',
      watch,
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function decision(heading: string, body: string, height = 88): FlowItem {
  return {
    height,
    block: (y) => block('decision-box', {
      heading, body, accent: 'token:primary',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function processSteps(
  title: string,
  items: Array<{ title: string; body: string }>,
): FlowItem {
  return {
    height: 34 + items.length * 52,
    block: (y) => block('process-steps', {
      title, items, accent: 'token:primary',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function definitions(
  title: string,
  items: Array<{ term: string; definition: string }>,
): FlowItem {
  return {
    height: 34 + items.length * 30,
    block: (y) => block('definition-list', {
      title, items, x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function featureList(
  title: string,
  items: Array<{ icon?: string; title: string; body: string }>,
  columns = 2,
): FlowItem {
  return {
    height: 34 + Math.ceil(items.length / columns) * 54,
    block: (y) => block('feature-list', {
      title, items, columns, accent: 'token:primary',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function timeline(
  title: string,
  items: Array<{ label: string; date: string; note?: string }>,
): FlowItem {
  return {
    height: 110,
    block: (y) => block('timeline', {
      title, items, accent: 'token:primary',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function signature(signerName: string, signerRole: string): FlowItem {
  return {
    height: 90,
    block: (y) => block('signature', {
      signerName, signerRole, dateLabel: 'Date',
      color: 'token:ink', lineColor: 'token:muted', mutedColor: 'token:muted',
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

export function contents(entries: string): FlowItem {
  return {
    height: 400,
    block: (y) => block('toc', {
      title: entries,
      titleSize: 22,
      titleColor: 'token:primary',
      color: 'token:ink',
      indexColor: 'token:primary',
      size: 10.5,
      lineHeight: 20,
      x: MARGIN, y, width: CONTENT_WIDTH,
    }),
  };
}

// ── Page furniture ───────────────────────────────────────────────────────────

export function footer(text: string): BlockDef {
  return block('footer', {
    text,
    align: 'center',
    bg: 'token:bg',
    color: 'token:muted',
    height: 26,
  });
}

export function pageNumber(): BlockDef {
  return block('page-number', {
    color: 'token:muted',
    x: PAGE.width - MARGIN - 60,
    y: PAGE.height - 46,
    width: 60,
  });
}

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

/** Attach standard furniture to a content page. */
export function withFurniture(p: PageDef, footerText: string): PageDef {
  return { ...p, blocks: [...p.blocks, footer(footerText), pageNumber()] };
}

export { randomUUID };
