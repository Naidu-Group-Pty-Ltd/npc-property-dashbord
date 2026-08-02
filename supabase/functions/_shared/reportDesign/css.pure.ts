/**
 * The report stylesheet, built from a resolved palette and a set of options.
 *
 * This replaces `render-investment-report-pdf/report.css.ts`, which was a single
 * `const` template string over a hardcoded `BRAND` object — one of the eight
 * golds, and unreachable from any tenant. Three things changed in the port:
 *
 *  1. **Every colour is a palette role.** There is not one hex literal below.
 *     `reportSourceHygiene.spec.ts` asserts that, so it stays true.
 *  2. **`@page` rules are generated from `page.pure.ts`.** Page geometry had two
 *     definitions — the `PAGE` token object and the CSS that consumed it — and
 *     the named pages the product actually uses (`chapter-opener`,
 *     `landscape-table`, `disclaimer`) existed in neither. Now the table is the
 *     definition and the CSS is derived.
 *  3. **The layout model is tables, not flexbox.** WeasyPrint's flex support is
 *     partial and version-dependent; its table model is not. A KPI strip that
 *     silently stacks into a column on the render host is the kind of defect
 *     that only shows up in a client's hands. `display: table` costs nothing
 *     here — every one of these rows is a fixed set of equal cells.
 *
 * ## What was deliberately dropped rather than translated
 *
 * `-webkit-font-smoothing` (no meaning in print), `filter: contrast()/saturate()`
 * (unsupported — silently ignored, so it was never doing anything), and
 * `box-shadow` (a screen affordance; on paper an elevation cue reads as a
 * printing artefact). The one gradient that survives is the cover scrim, because
 * it is the only thing keeping cover type legible over arbitrary client-supplied
 * photography, and it is only emitted when there is a photograph under it.
 *
 * Pure: sibling `.pure` imports only, no I/O, deterministic output for a given
 * input — which is what makes `reportGolden.spec.ts` possible.
 */
import { hexToRgb01 } from './color.pure.ts';
import {
  DENSITY_METRICS,
  intensity,
  normalizeReportDesignOptions,
  scaledType,
  type ReportDesignOptions,
} from './options.pure.ts';
import {
  GRID_GUTTER_MM,
  GRID_SPANS,
  NAMED_PAGES,
  PAGE_SIZE,
  marginsFor,
  type NamedPage,
} from './page.pure.ts';
import type { ResolvedReportPalette } from './roles.pure.ts';
import { PRINT_TRACKING } from './tokens.pure.ts';
import { NUMERIC_FEATURES, PRINT_STACK } from './typography.pure.ts';

export interface ReportCssInput {
  /** From `resolveReportPalette()` — or from the report's brand snapshot. */
  palette: ResolvedReportPalette;
  /** Partial and untrusted; normalised on the way in. */
  options?: Partial<ReportDesignOptions> | null;
  /**
   * The running foot, printed on every body page.
   *
   * Comes from the brand snapshot. The prototype hardcoded
   * `"NPC · Investment Intelligence"` into the `@bottom-left` box, which made
   * every white-label tenant's report carry our name.
   */
  masthead: string;
}

/** `#RRGGBB` → `rgba(r,g,b,a)`, so a palette role can carry a tint. */
function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb01(hex);
  const to255 = (v: number) => Math.round(v * 255);
  return `rgba(${to255(r)},${to255(g)},${to255(b)},${Math.min(1, Math.max(0, a))})`;
}

/**
 * A CSS string literal for `content:`.
 *
 * The masthead is tenant-supplied. Without escaping, a company name containing
 * a double quote terminates the string and the remainder of the `@page` block
 * becomes syntactically invalid — which WeasyPrint recovers from by dropping the
 * rule, so the failure is a silently missing footer rather than an error.
 */
function cssString(value: string): string {
  const escaped = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // A literal newline inside a CSS string is a parse error.
    .replace(/[\r\n]+/g, ' ');
  return `"${escaped}"`;
}

/** Trim `10.50pt` to `10.5pt`; keeps the golden readable and the output small. */
function pt(value: number): string {
  return `${Number(value.toFixed(2))}pt`;
}

/**
 * The `@page` block for one named page, expressed as its difference from the
 * base rule. `body` is the base and is emitted separately.
 */
function namedPageRule(page: NamedPage, palette: ResolvedReportPalette): string {
  const spec = NAMED_PAGES[page];
  const m = marginsFor(page);
  const lines: string[] = [];

  if (spec.landscape) lines.push(`    size: ${PAGE_SIZE.name} landscape;`);
  lines.push(`    margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;`);
  if (spec.bleed) lines.push(`    background: ${palette.field};`);

  if (!spec.header) {
    lines.push('    @top-left { content: none; }');
    lines.push('    @top-right { content: none; }');
  }
  if (!spec.footer) {
    lines.push('    @bottom-left { content: none; }');
    lines.push('    @bottom-center { content: none; }');
    lines.push('    @bottom-right { content: none; }');
  }

  return `  /* ${spec.note} */\n  @page ${page} {\n${lines.join('\n')}\n  }`;
}

/** Base `@page` plus one rule per named page, plus the `.page-*` selectors. */
function pageRules(
  palette: ResolvedReportPalette,
  masthead: string,
  type: Record<string, number>,
): string {
  const base = marginsFor('body');
  const named = (Object.keys(NAMED_PAGES) as NamedPage[])
    .filter((p) => p !== 'body')
    .map((p) => namedPageRule(p, palette))
    .join('\n\n');

  // `page: <name>` is how an element claims a named page. Generated from the
  // same table, so a new named page cannot be reachable from CSS but not markup.
  const selectors = (Object.keys(NAMED_PAGES) as NamedPage[])
    .map((p) => `  .page-${p} { page: ${p}; }`)
    .join('\n');

  return `
  @page {
    size: ${PAGE_SIZE.name};
    margin: ${base.top}mm ${base.right}mm ${base.bottom}mm ${base.left}mm;
    background: ${palette.paper};

    @top-left {
      content: string(chapter-eyebrow);
      font-family: ${PRINT_STACK.mono};
      font-size: ${pt(type.micro)};
      letter-spacing: ${PRINT_TRACKING.widest};
      text-transform: uppercase;
      color: ${palette.mutedInk};
    }
    @top-right {
      content: string(chapter-title);
      font-family: ${PRINT_STACK.accent};
      font-style: italic;
      font-size: ${pt(type.caption)};
      color: ${palette.mutedInk};
    }
    @bottom-left {
      content: ${cssString(masthead)};
      font-family: ${PRINT_STACK.mono};
      font-size: ${pt(type.micro)};
      letter-spacing: ${PRINT_TRACKING.widest};
      text-transform: uppercase;
      color: ${palette.mutedInk};
    }
    @bottom-center {
      content: "";
      border-top: 0.4pt solid ${palette.rule};
      width: 18pt;
      height: 0;
      margin: 0 auto;
    }
    @bottom-right {
      content: counter(page, decimal-leading-zero) " / " counter(pages, decimal-leading-zero);
      font-family: ${PRINT_STACK.mono};
      font-size: ${pt(type.micro)};
      letter-spacing: ${PRINT_TRACKING.wide};
      color: ${palette.bodyInk};
    }
  }

${named}

${selectors}`;
}

/**
 * Body-cell selectors.
 *
 * Both `td` and `th[scope="row"]` every time — see the comment in the classic
 * variant. Hoisted so a variant cannot quietly forget one of the two.
 */
const CELL = 'table.data tbody td, table.data tbody th[scope="row"]';
const BAND_CELL = 'table.data tbody tr:nth-child(even) td, '
  + 'table.data tbody tr:nth-child(even) th[scope="row"]';
const LAST_ROW_CELL = 'table.data tbody tr:last-child td, '
  + 'table.data tbody tr:last-child th[scope="row"]';
const TOTAL_CELL = 'table.data tbody tr.total td, table.data tbody tr.total th[scope="row"]';

/** Table rules for the selected `tableStyle`. Only the chosen variant is emitted. */
function tableRules(
  palette: ResolvedReportPalette,
  options: ReportDesignOptions,
  type: Record<string, number>,
): string {
  const d = DENSITY_METRICS[options.density];
  const padY = pt(d.cellPadPt);

  const shared = `
  /*
   * A table may break across pages, and its head repeats when it does — that is
   * what \`display: table-header-group\` below is for.
   *
   * It used to say \`page-break-inside: avoid\` here, which contradicted that
   * and had two consequences. A table that did not fit at the foot of a page
   * moved whole and left a hole; and a table longer than one page could not
   * break at all, so a client with thirty liabilities would lose rows off the
   * bottom. Found by the first render of a data-heavy format.
   *
   * Rows still never split, and a caption never strands from its first row.
   */
  table.data {
    width: 100%;
    border-collapse: collapse;
    margin: ${pt(d.blockGapPt)} 0;
    font-size: ${pt(type.caption + 1)};
  }
  table.data caption {
    caption-side: top;
    text-align: left;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    padding-bottom: 6pt;
  }
  table.data th {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    text-align: left;
    font-weight: 500;
    padding: ${padY} 10pt ${padY} 0;
  }
  table.data td {
    padding: ${padY} 10pt ${padY} 0;
    color: ${palette.bodyInk};
    ${NUMERIC_FEATURES}
  }
  /* The first cell of a row is a header cell — that is what makes the table
     navigable in a tagged PDF — but it must not look like the column head. */
  table.data th[scope="row"] {
    font-family: ${PRINT_STACK.body};
    font-size: inherit;
    font-weight: 500;
    letter-spacing: ${PRINT_TRACKING.normal};
    text-transform: none;
    color: ${palette.bodyInk};
    padding: ${padY} 10pt ${padY} 0;
  }
  /* A caption is a separate box from the table it belongs to, and WeasyPrint
     will happily leave it on the previous page while the table moves. The
     wrapper is what actually keeps them together. */
  .table-block { margin: ${pt(d.blockGapPt)} 0; }
  .table-block table.data { margin: 0; }
  /*
   * A figure never wraps. Line-breaking treats the minus sign and the space
   * before a period suffix as break opportunities, so a narrow column renders
   * "-" on one line and "$10,600 pa" on the next, and the reader has to
   * reassemble the number. With auto table layout the column widens instead,
   * which is the right trade in a financial table.
   */
  table.data td.num, table.data th.num { text-align: right; white-space: nowrap; }
  table.data td.pos { color: ${palette.positive}; }
  table.data td.neg { color: ${palette.negative}; }
  table.data thead { display: table-header-group; }
  table.data tr { page-break-inside: avoid; }
  table.data caption { break-after: avoid; }`;

  if (options.tableStyle === 'ledger') {
    return `${shared}

  /* Ledger — heavy top and bottom rules, hairlines between, no verticals. The
     financial-appendix convention: the block reads as one object. */
  table.data {
    border-top: 1pt solid ${palette.bodyInk};
    border-bottom: 1pt solid ${palette.bodyInk};
  }
  table.data thead th { border-bottom: 0.6pt solid ${palette.bodyInk}; }
  ${CELL} { border-bottom: 0.3pt solid ${alpha(palette.mutedInk, 0.25)}; }
  ${LAST_ROW_CELL} { border-bottom: 0; }
  ${TOTAL_CELL} {
    border-top: 0.6pt solid ${palette.bodyInk};
    font-weight: 600;
  }`;
  }

  if (options.tableStyle === 'minimal') {
    return `${shared}

  /* Minimal — one rule under the head. Everything else is alignment. */
  table.data thead th { border-bottom: 0.6pt solid ${palette.rule}; }
  ${TOTAL_CELL} {
    border-top: 0.6pt solid ${palette.rule};
    font-weight: 600;
  }`;
  }

  return `${shared}

  /* Classic — banded rows. The band is the panel colour, so it survives a
     greyscale print, which a tint of the accent does not.

     Every rule here names both td and th[scope="row"]: the first cell of a row
     is a header cell for the tagged-PDF structure tree, so a td-only selector
     bands four fifths of the row and leaves a pale stripe down the left edge. */
  table.data thead th { border-bottom: 0.6pt solid ${palette.bodyInk}; }
  ${BAND_CELL} { background: ${palette.paperAlt}; }
  ${CELL} { border-bottom: 0.3pt solid ${palette.rule}; }
  ${TOTAL_CELL} {
    border-top: 0.6pt solid ${palette.bodyInk};
    background: ${palette.paperAlt};
    font-weight: 600;
  }`;
}

/** Chapter-header rules for the selected `chapterStyle`. */
function chapterRules(
  palette: ResolvedReportPalette,
  options: ReportDesignOptions,
  type: Record<string, number>,
): string {
  const d = DENSITY_METRICS[options.density];
  const i = intensity(options);

  const shared = `
  /* The running head is set from these attributes, so a chapter cannot be
     opened without naming itself. */
  .chapter {
    page-break-before: always;
    string-set: chapter-eyebrow attr(data-eyebrow),
                chapter-title attr(data-chapter-title);
    /* The chapter title sits low on its opening page, magazine-style — as
       padding on the chapter box rather than as a page margin.
       \`page: chapter-opener\` would apply to every page the chapter spans, so
       the deep margin and the suppressed running head would follow it through
       page nine of a nine-page chapter. Padding applies to the first fragment
       only, which is exactly the intent. */
    padding-top: ${marginsFor('chapter-opener').top - marginsFor('body').top}mm;
  }
  .chapter-header { margin-bottom: ${pt(d.blockGapPt + 4)}; }
  .chapter-header .chapter-no {
    display: ${options.showSectionNumbers ? 'block' : 'none'};
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.caption)};
    letter-spacing: ${PRINT_TRACKING.widest};
    line-height: 1;
    color: ${palette.accentOnPaper};
    margin: 0 0 ${pt(d.blockGapPt)} 0;
  }
  .chapter-header h1 {
    font-size: ${pt(type.h1)};
    line-height: 1.18;
    max-width: 150mm;
    margin: 0;
  }
  .chapter-header .chapter-dek {
    margin-top: ${pt(d.paragraphGapPt + 5)};
    font-family: ${PRINT_STACK.accent};
    font-style: italic;
    font-size: ${pt(type.h3)};
    line-height: 1.35;
    color: ${palette.mutedInk};
    max-width: 140mm;
  }`;

  if (options.chapterStyle === 'opener_band') {
    return `${shared}

  /* Opener band — a tinted plate behind the header. Alpha follows
     visualIntensity so the same markup can read as loud or as barely there. */
  .chapter-header {
    background: ${alpha(palette.accentFill, 0.1 * i)};
    border-top: ${pt(2 * i + 0.5)} solid ${palette.accentFill};
    padding: ${pt(d.blockGapPt)} ${pt(d.blockGapPt)} ${pt(d.blockGapPt)};
    margin-left: -${pt(d.blockGapPt)};
    margin-right: -${pt(d.blockGapPt)};
  }`;
  }

  if (options.chapterStyle === 'minimal') {
    return `${shared}

  /* Minimal — no rule, no plate; the deep top margin of the chapter-opener page
     does the separating. */
  .chapter-header .chapter-no { margin-bottom: ${pt(d.paragraphGapPt)}; }`;
  }

  return `${shared}

  /* Classic — a hairline under the header, the house default. */
  .chapter-header {
    padding-bottom: ${pt(d.blockGapPt - 2)};
    border-bottom: 0.6pt solid ${palette.rule};
  }`;
}

/** Cover rules for the selected `coverStyle`. */
function coverRules(
  palette: ResolvedReportPalette,
  options: ReportDesignOptions,
  type: Record<string, number>,
): string {
  const i = intensity(options);
  // The hero sits under the type, so its opacity has a floor: at intensity 0 the
  // photograph is gone entirely and the cover is a solid plate, which is a
  // legitimate look. Between 0 and 1 it never goes bright enough to fight the
  // title, because the scrim below compensates.
  const heroOpacity = Number((0.25 + 0.45 * i).toFixed(3));

  const shared = `
  .report-cover {
    position: relative;
    box-sizing: border-box;
    width: ${PAGE_SIZE.widthMm}mm;
    height: ${PAGE_SIZE.heightMm}mm;
    background: ${palette.field};
    color: ${palette.onFieldInk};
    overflow: hidden;
    page-break-after: always;
  }
  .report-cover .cover-hero {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    background-size: cover;
    background-position: center;
    opacity: ${heroOpacity};
  }
  /* The only gradient in the sheet. It exists so the title clears its contrast
     floor over a photograph nobody has seen yet. */
  .report-cover .cover-scrim {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    background: linear-gradient(180deg,
      ${alpha(palette.field, 0.2)} 0%,
      ${alpha(palette.field, 0.55)} 55%,
      ${alpha(palette.field, 0.92)} 100%);
  }
  .report-cover .cover-masthead {
    position: absolute;
    top: 22mm; left: 22mm; right: 22mm;
    display: table;
    width: calc(${PAGE_SIZE.widthMm}mm - 44mm);
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro + 0.5)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${palette.accentOnField};
  }
  .report-cover .cover-masthead .mark { display: table-cell; text-align: left; }
  .report-cover .cover-masthead .vol {
    display: table-cell;
    text-align: right;
    color: ${alpha(palette.onFieldInk, 0.7)};
  }
  .report-cover .cover-rule {
    position: absolute;
    top: 30mm; left: 22mm;
    width: 28mm; height: 0;
    border-top: 1pt solid ${palette.accentOnField};
  }
  .report-cover .cover-eyebrow {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.caption)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${palette.accentOnField};
    margin-bottom: 14mm;
  }
  /* Cinzel — the brand's cover face, and the only place it appears. It ships
     Bold alone and sets lowercase as small capitals, which is why it is
     confined to the two places set large and short. */
  .report-cover h1.cover-title {
    font-family: ${PRINT_STACK.cover};
    font-weight: 700;
    font-size: ${pt(type.coverTitle)};
    line-height: 1.02;
    letter-spacing: ${PRINT_TRACKING.snug};
    color: ${palette.onFieldInk};
    margin: 0;
    max-width: 165mm;
  }
  /* The subtitle sets smaller than the title and on its own line. At parity it
     wraps a locality onto a third line, which pushes the meta block into the
     cover footer — seen in a real render before this was corrected. */
  .report-cover .cover-title em {
    display: block;
    margin-top: 3mm;
    font-family: ${PRINT_STACK.accent};
    font-style: italic;
    font-weight: 400;
    font-size: 0.66em;
    line-height: 1.05;
    color: ${palette.accentOnField};
  }
  .report-cover .cover-meta {
    margin-top: 16mm;
    display: table;
    border-spacing: 7mm 0;
    margin-left: -7mm;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro + 0.5)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${alpha(palette.onFieldInk, 0.78)};
  }
  .report-cover .cover-meta .meta-item { display: table-cell; vertical-align: top; }
  .report-cover .cover-meta .lbl {
    display: block;
    color: ${palette.accentOnField};
    margin-bottom: 3mm;
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.widest};
  }
  .report-cover .cover-meta .val {
    font-family: ${PRINT_STACK.body};
    font-size: ${pt(type.body)};
    letter-spacing: ${PRINT_TRACKING.normal};
    text-transform: none;
    color: ${palette.onFieldInk};
    font-weight: 500;
  }
  .report-cover .cover-footer {
    position: absolute;
    bottom: 14mm; left: 22mm; right: 22mm;
    display: table;
    width: calc(${PAGE_SIZE.widthMm}mm - 44mm);
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${alpha(palette.onFieldInk, 0.55)};
  }
  .report-cover .cover-footer .left { display: table-cell; text-align: left; }
  .report-cover .cover-footer .right { display: table-cell; text-align: right; }
  .report-cover .cover-lockup { margin-bottom: 12mm; }`;

  if (options.coverStyle === 'editorial') {
    return `${shared}

  /* Editorial — the title sits low, magazine-style, and the photograph carries
     the top two-thirds. */
  .report-cover .cover-body {
    position: absolute;
    left: 22mm; right: 22mm; bottom: 38mm;
  }`;
  }

  if (options.coverStyle === 'image') {
    return `${shared}

  /* Image-led — the photograph is the cover and the type sits on a solid plinth
     at the foot, so it never depends on what is behind it. */
  .report-cover .cover-scrim { background: none; }
  .report-cover .cover-body {
    position: absolute;
    box-sizing: border-box;
    left: 0; right: 0; bottom: 0;
    padding: 20mm 22mm 26mm;
    background: ${palette.field};
  }
  .report-cover h1.cover-title { font-size: ${pt(type.h1 + 6)}; }`;
  }

  return `${shared}

  /* Title overlay — the house default. Anchored to the FOOT of the sheet, not
     the top: the block grows upward into empty space, so a long address cannot
     push the meta rows down into the cover footer. Both are absolutely
     positioned, so nothing would have stopped it. */
  .report-cover .cover-body {
    position: absolute;
    left: 22mm; right: 22mm; bottom: 40mm;
  }`;
}

/**
 * Build the stylesheet.
 *
 * Deterministic for a given input: same palette, same options, same masthead →
 * byte-identical output.
 */
export function buildReportCss(input: ReportCssInput): string {
  const palette = input.palette;
  const options = normalizeReportDesignOptions(input.options);
  const type = scaledType(options);
  const d = DENSITY_METRICS[options.density];
  const i = intensity(options);

  return `${pageRules(palette, input.masthead, type)}

  /* ── Foundation ─────────────────────────────────────────────────────── */
  html, body {
    margin: 0;
    padding: 0;
    background: ${palette.paper};
    color: ${palette.bodyInk};
    font-family: ${PRINT_STACK.body};
    font-size: ${pt(type.body)};
    line-height: ${d.leading};
    font-feature-settings: "kern" 1, "liga" 1, "calt" 1;
  }

  /* ── Typography ─────────────────────────────────────────────────────── */
  h1, h2, h3 {
    font-family: ${PRINT_STACK.display};
    color: ${palette.bodyInk};
    font-weight: 600;
    letter-spacing: ${PRINT_TRACKING.snug};
    line-height: 1.12;
    margin: 0;
    page-break-after: avoid;
  }
  h1 { font-size: ${pt(type.h1)}; }
  h2 { font-size: ${pt(type.h2)}; margin: ${pt(d.blockGapPt + 10)} 0 ${pt(d.paragraphGapPt + 3)}; }
  h3 { font-size: ${pt(type.h3)}; margin: ${pt(d.blockGapPt)} 0 ${pt(d.paragraphGapPt - 1)}; }
  /* h4 is the mono micro-label, not a smaller heading — it is the same object
     as .eyebrow and shares its colour so the two never drift apart. */
  h4 {
    font-family: ${PRINT_STACK.mono};
    text-transform: uppercase;
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    font-size: ${pt(type.caption)};
    font-weight: 700;
    color: ${palette.accentOnPaper};
    margin: ${pt(d.paragraphGapPt + 5)} 0 ${pt(d.paragraphGapPt - 3)};
    page-break-after: avoid;
  }

  p {
    margin: 0 0 ${pt(d.paragraphGapPt)};
    orphans: 3;
    widows: 3;
    ${options.justifyText ? 'text-align: justify;\n    hyphens: auto;' : 'text-align: left;'}
  }
  strong { font-weight: 600; color: ${palette.bodyInk}; }
  em { font-family: ${PRINT_STACK.accent}; font-style: italic; font-size: 1.05em; }
  a {
    color: ${palette.accentOnPaper};
    text-decoration: none;
    border-bottom: 0.3pt solid ${alpha(palette.accentOnPaper, 0.4)};
  }
  ul, ol { margin: 0 0 ${pt(d.paragraphGapPt)}; padding-left: 14pt; }
  li { margin-bottom: ${pt(d.paragraphGapPt / 2)}; }
${options.showDropCaps
    ? `
  /* A raised initial on the chapter's first body paragraph — NOT a floated drop
     cap.

     The floated ::first-letter was tried and rejected against a real render:
     WeasyPrint places the float but does not shorten the first line box around
     it, so the initial lands on top of the words it opens. Lines two and three
     indent correctly, which makes the defect look like a near-miss rather than
     the unsupported construct it is. A raised initial needs no float, sets on
     the baseline, and is the device most financial print uses anyway.

     Never on .lede: a standfirst is already set larger and in the italic accent
     face, and an initial in front of it reads as a mistake. */
  .chapter-body > p:first-of-type:not(.lede)::first-letter,
  .chapter-body > .lede + p::first-letter {
    font-family: ${PRINT_STACK.display};
    font-size: 2.1em;
    line-height: 1;
    padding-right: 1pt;
    color: ${palette.accentOnPaper};
  }
`
    : ''}
  /* ── Eyebrow — the brand's typographic signature ────────────────────── */
  .eyebrow {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.caption)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    font-weight: 700;
    color: ${palette.accentOnPaper};
    margin-bottom: ${pt(d.paragraphGapPt + 1)};
  }
  .eyebrow::before { content: "— "; }
  .eyebrow.on-field { color: ${palette.accentOnField}; }

  /* ── Pull quote ─────────────────────────────────────────────────────── */
  .pull-quote {
    font-family: ${PRINT_STACK.display};
    font-style: italic;
    font-size: ${pt(type.pullQuote)};
    line-height: 1.25;
    color: ${palette.bodyInk};
    margin: ${pt(d.blockGapPt + 4)} 0;
    padding: 0 0 0 14pt;
    border-left: 2pt solid ${palette.accentFill};
    page-break-inside: avoid;
    text-align: left;
  }
  .pull-quote cite {
    display: block;
    margin-top: ${pt(d.paragraphGapPt - 1)};
    font-family: ${PRINT_STACK.mono};
    font-style: normal;
    font-size: ${pt(type.caption)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
  }

  /* ── KPI strip ──────────────────────────────────────────────────────── */
  .kpi-strip {
    display: table;
    table-layout: fixed;
    width: 100%;
    border-top: 0.6pt solid ${palette.bodyInk};
    border-bottom: 0.6pt solid ${palette.bodyInk};
    margin: ${pt(d.blockGapPt)} 0 ${pt(d.blockGapPt + 4)};
    page-break-inside: avoid;
  }
  .kpi-strip .kpi {
    display: table-cell;
    vertical-align: top;
    padding: ${pt(d.cellPadPt + 5)} ${pt(d.cellPadPt + 7)};
    border-right: 0.3pt solid ${palette.rule};
  }
  .kpi-strip .kpi:last-child { border-right: 0; }
  .kpi .kpi-label {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    margin-bottom: 6pt;
  }
  .kpi .kpi-value {
    font-family: ${PRINT_STACK.display};
    font-size: ${pt(type.h2 + 2)};
    line-height: 1;
    color: ${palette.bodyInk};
    ${NUMERIC_FEATURES}
  }
  .kpi .kpi-value.pos { color: ${palette.positive}; }
  .kpi .kpi-value.neg { color: ${palette.negative}; }
  .kpi .kpi-foot {
    margin-top: 4pt;
    font-size: ${pt(type.caption)};
    color: ${palette.mutedInk};
  }

  /* ── Columns and the asymmetric grid ────────────────────────────────── */
  .two-col {
    column-count: 2;
    column-gap: 8mm;
    column-rule: 0.3pt solid ${palette.rule};
    margin: ${pt(d.paragraphGapPt + 3)} 0;
  }
  .two-col p { break-inside: avoid-column; }

  /* Percentage cells rather than a 12-track grid: WeasyPrint has no CSS Grid,
     and the four spans below are the only ones the layouts use. */
  .grid-12 {
    display: table;
    table-layout: fixed;
    width: 100%;
    border-spacing: ${GRID_GUTTER_MM}mm 0;
    margin: ${pt(d.blockGapPt)} -${GRID_GUTTER_MM}mm;
  }
  .grid-12 > .col { display: table-cell; vertical-align: top; }
${(Object.entries(GRID_SPANS) as Array<[string, number]>)
    .map(([span, pct]) => `  .grid-12 > .col-${span} { width: ${pct}%; }`).join('\n')}

  /* ── Sidenote, callout, decision box ────────────────────────────────── */
  .sidenote {
    background: ${palette.paperAlt};
    border-left: 2pt solid ${palette.accentFill};
    padding: ${pt(d.cellPadPt + 5)} ${pt(d.cellPadPt + 7)};
    font-size: ${pt(type.caption + 1)};
    line-height: 1.5;
    color: ${palette.bodyInk};
    page-break-inside: avoid;
    margin: ${pt(d.blockGapPt)} 0;
  }
  .sidenote .sidenote-label {
    display: block;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
    margin-bottom: 4pt;
  }

  /* Callout — tone carries meaning, so the left rule is a Category B colour and
     the ground is a wash of the same. Never the brand: "risk" must not change
     colour when a tenant does. */
  .callout {
    padding: ${pt(d.cellPadPt + 5)} ${pt(d.cellPadPt + 7)};
    margin: ${pt(d.blockGapPt)} 0;
    border-left: 2pt solid ${palette.rule};
    background: ${palette.paperAlt};
    page-break-inside: avoid;
    font-size: ${pt(type.caption + 1)};
  }
  .callout .callout-label {
    display: block;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    margin-bottom: 4pt;
  }
  .callout.tone-positive { border-left-color: ${palette.positive}; }
  .callout.tone-positive .callout-label { color: ${palette.positive}; }
  .callout.tone-caution { border-left-color: ${palette.caution}; }
  .callout.tone-caution .callout-label { color: ${palette.caution}; }
  .callout.tone-negative { border-left-color: ${palette.negative}; }
  .callout.tone-negative .callout-label { color: ${palette.negative}; }
  .callout.tone-informative { border-left-color: ${palette.informative}; }
  .callout.tone-informative .callout-label { color: ${palette.informative}; }
  .callout.tone-neutral .callout-label { color: ${palette.mutedInk}; }

  /* Decision box — "What this means". One per section, by the compass rules. */
  .decision-box {
    border: 0.6pt solid ${palette.accentFill};
    background: ${alpha(palette.accentFill, 0.07 * i)};
    padding: ${pt(d.cellPadPt + 7)} ${pt(d.cellPadPt + 9)};
    margin: ${pt(d.blockGapPt + 2)} 0;
    page-break-inside: avoid;
  }
  .decision-box .decision-label {
    display: block;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
    margin-bottom: 6pt;
  }
  .decision-box p:last-child { margin-bottom: 0; }

  /* ── Contents ───────────────────────────────────────────────────────── */
  .contents { display: table; width: 100%; margin-top: ${pt(d.blockGapPt)}; }
  .contents .toc-row { display: table-row; }
  .contents .toc-row > * {
    display: table-cell;
    padding: ${pt(d.cellPadPt)} 0;
    border-bottom: 0.3pt solid ${palette.rule};
  }
  .contents .toc-no {
    width: 12%;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.wide};
    color: ${palette.accentOnPaper};
  }
  .contents .toc-title { color: ${palette.bodyInk}; }
  .contents .toc-note {
    width: 34%;
    font-size: ${pt(type.caption)};
    color: ${palette.mutedInk};
  }
  .contents .toc-page {
    width: 8%;
    text-align: right;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    color: ${palette.mutedInk};
    ${NUMERIC_FEATURES}
  }

  /* ── Brand lockup ───────────────────────────────────────────────────── */
  .brand-lockup { display: table; }
  .brand-lockup .lockup-mark { display: table-cell; vertical-align: middle; }
  .brand-lockup .lockup-mark img { display: block; height: 13mm; width: auto; }
  .brand-lockup .lockup-text {
    display: table-cell;
    vertical-align: middle;
    padding-left: 4mm;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro + 0.5)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
  }
  .brand-lockup.on-field .lockup-text { color: ${palette.accentOnField}; }
  .brand-lockup.mark-lg .lockup-mark img { height: 22mm; }

  /* ── Closing company page — full-bleed field ────────────────────────── */
  /* Full-bleed: the disclaimer page carries no @page margin, so the block is
     the whole sheet and its own padding is the margin. Without border-box the
     padding is added to the 210mm width and the contact block runs off the
     right edge of the paper. */
  .company-page {
    position: relative;
    box-sizing: border-box;
    width: ${PAGE_SIZE.widthMm}mm;
    height: ${PAGE_SIZE.heightMm}mm;
    background: ${palette.field};
    color: ${palette.onFieldInk};
    padding: 24mm 22mm;
    page-break-before: always;
  }
  .company-page .company-name {
    font-family: ${PRINT_STACK.cover};
    /* Cinzel ships Bold alone. Stating 700 is not decoration: an unstated
       weight is a 400 request, and a request the image cannot answer exactly is
       how a face gets synthesised. */
    font-weight: 700;
    font-size: ${pt(type.h1 - 4)};
    line-height: 1.05;
    color: ${palette.accentOnField};
    margin: 0 0 ${pt(d.blockGapPt + 6)};
    letter-spacing: ${PRINT_TRACKING.snug};
  }
  .company-page .company-name .tail {
    display: block;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.h3 - 1)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    margin-top: 3mm;
    color: ${alpha(palette.onFieldInk, 0.85)};
  }
  .company-page .contact { display: table; width: 100%; margin-bottom: ${pt(d.blockGapPt + 8)}; }
  .company-page .contact-row { display: table-row; }
  .company-page .contact-row > * { display: table-cell; padding: ${pt(d.cellPadPt)} 0; }
  .company-page .contact-label {
    width: 26mm;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.accentOnField};
  }
  .company-page .contact-value {
    font-size: ${pt(type.caption + 1)};
    color: ${palette.onFieldInk};
  }
  .company-page .disclaimer {
    border-top: 0.4pt solid ${alpha(palette.onFieldInk, 0.25)};
    padding-top: ${pt(d.blockGapPt)};
    color: ${alpha(palette.onFieldInk, 0.72)};
    line-height: 1.5;
    text-align: left;
  }
  .company-page .disclaimer p { margin: 0 0 ${pt(d.paragraphGapPt - 2)}; text-align: left; }
  .company-page .disclaimer p:last-child { margin-bottom: 0; }

  /* ── Charts ─────────────────────────────────────────────────────────── */
  .chart-figure {
    margin: ${pt(d.blockGapPt)} 0;
    page-break-inside: avoid;
  }
  /* The SVG carries its own viewBox and scales to the measure; the width here
     is what fixes the printed size, and therefore what the point sizes in
     charts.pure.ts are computed against. */
  .chart-figure svg { display: block; width: 100%; height: auto; }
  .chart-figure figcaption {
    margin-top: 6pt;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
  }
  /* A sparkline that flows inside a line of body copy keeps its own size. */
  .spark-inline { display: inline; width: auto; height: 1em; vertical-align: -0.15em; }

  /* ── Utilities ──────────────────────────────────────────────────────── */
  .avoid-break { page-break-inside: avoid; }
  .break-before { page-break-before: always; }
  .num { ${NUMERIC_FEATURES} }
  .muted { color: ${palette.mutedInk}; }
  .lede {
    font-family: ${PRINT_STACK.accent};
    font-style: italic;
    font-size: ${pt(type.bodyLg + 1)};
    line-height: 1.4;
    color: ${palette.mutedInk};
    margin-bottom: ${pt(d.blockGapPt)};
    text-align: left;
  }
${tableRules(palette, options, type)}
${chapterRules(palette, options, type)}
${coverRules(palette, options, type)}
`;
}
