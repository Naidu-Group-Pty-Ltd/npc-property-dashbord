import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { absBoxStyle, esc, type HtmlBlockContext } from './_shared.html';

export function renderDataTableHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const headers = Array.isArray(p.headers) ? (p.headers as string[]) : [];
  const rows = Array.isArray(p.rows) ? (p.rows as Array<{ cells: string[] }>) : [];
  if (headers.length === 0) return '';

  const headerBg = resolveBindableColor(p.headerBg ?? 'token:primary', ctx, '#BF9B50');
  const headerFg = resolveBindableColor(p.headerFg ?? '#FFFFFF', ctx, '#FFFFFF');
  const stripeBg = resolveBindableColor(p.stripeBg ?? '#F4F0E6', ctx, '#F4F0E6');
  const cellFg = resolveBindableColor(p.cellFg ?? '#1A1A1A', ctx, '#1A1A1A');
  const borderColor = resolveBindableColor(p.borderColor ?? '#DCDCDC', ctx, '#DCDCDC');
  const widths = Array.isArray(p.columnWidths) && (p.columnWidths as number[]).length === headers.length
    ? (p.columnWidths as number[])
    : headers.map(() => 1 / headers.length);
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48 });

  // Figure columns are right-aligned so the digits stack, and set in the
  // template's mono face when it declares one. A projection table is only
  // readable down the column if the decimal points line up.
  const numeric = new Set(
    (Array.isArray(p.numericColumns) ? (p.numericColumns as unknown[]) : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
  const numericFont = tokenFont(p.numericFont);
  const fontSize = Number(p.fontSize) > 0 ? Number(p.fontSize) : 9;
  const cellPad = Number(p.cellPadding) >= 0 ? Number(p.cellPadding) : 6;

  // Band rows group a long matrix into named sections (STATISTICS, CASH
  // DEDUCTIONS, …). A ten-year projection is 23 rows deep; without the bands a
  // reader has to count rows to work out which block of figures they are in.
  const sections = new Set(
    (Array.isArray(p.sectionRows) ? (p.sectionRows as unknown[]) : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
  const sectionBg = resolveBindableColor(p.sectionBg ?? stripeBg, ctx, '#F4F0E6');
  const sectionFg = resolveBindableColor(p.sectionFg ?? cellFg, ctx, '#1A1A1A');
  // Negative figures print red. In a cash-flow table the sign is the single
  // most-read piece of information on the page.
  const negativeFg = p.negativeColor
    ? resolveBindableColor(p.negativeColor, ctx, '#B91C1C')
    : null;

  const colgroup = `<colgroup>${widths.map(w => `<col style="width:${w * 100}%;"/>`).join('')}</colgroup>`;
  const thead = `<thead><tr style="background:${headerBg};color:${headerFg};">
    ${headers.map((h, i) => `<th style="padding:${cellPad}pt 8pt;text-align:${numeric.has(i) ? 'right' : 'left'};font-size:${fontSize}pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${esc(h)}</th>`).join('')}
  </tr></thead>`;
  const tbody = `<tbody>${rows.map((row, i) => {
    const cells = row.cells || [];
    if (sections.has(i)) {
      return `<tr><td colspan="${headers.length}" style="background:${sectionBg};color:${sectionFg};padding:${cellPad}pt 8pt;font-size:${fontSize}pt;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">${esc(resolveBindable(cells[0], ctx))}</td></tr>`;
    }
    return `<tr style="background:${i % 2 ? stripeBg : 'transparent'};color:${cellFg};">
      ${cells.map((c, col) => {
    const isNumeric = numeric.has(col);
    const text = resolveBindable(c, ctx);
    const isNegative = negativeFg !== null && /^-\s*[$(]?\d/.test(String(text).trim());
    const cellStyle = `padding:${cellPad}pt 8pt;font-size:${fontSize}pt;font-variant-numeric:tabular-nums;`
      + (isNumeric ? `text-align:right;` : '')
      + (isNumeric && numericFont ? `font-family:${numericFont};` : '')
      + (isNegative ? `color:${negativeFg};font-weight:600;` : '');
    return `<td style="${cellStyle}">${esc(text)}</td>`;
  }).join('')}
    </tr>`;
  }).join('')}</tbody>`;

  return `<div style="${style}"><table style="width:100%;border-collapse:collapse;border:0.5pt solid ${borderColor};">${colgroup}${thead}${tbody}</table></div>`;
}

/**
 * Resolve a font prop to a CSS value.
 *
 * `token:mono` becomes `var(--font-mono)` — the custom property
 * `tokensToCssVariables()` emits from `tokens.fonts.mono`. Anything else is
 * treated as a literal family name. Returns null when unset, so callers can
 * omit the declaration entirely and inherit.
 */
function tokenFont(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.startsWith('token:')) {
    const key = value.slice(6).replace(/[^a-zA-Z0-9_-]/g, '');
    return key ? `var(--font-${key}, inherit)` : null;
  }
  return /^[\w\s'"-]+$/.test(value) ? value : null;
}
