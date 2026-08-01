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

  const colgroup = `<colgroup>${widths.map(w => `<col style="width:${w * 100}%;"/>`).join('')}</colgroup>`;
  const thead = `<thead><tr style="background:${headerBg};color:${headerFg};">
    ${headers.map((h, i) => `<th style="padding:6pt 8pt;text-align:${numeric.has(i) ? 'right' : 'left'};font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${esc(h)}</th>`).join('')}
  </tr></thead>`;
  const tbody = `<tbody>${rows.map((row, i) => `
    <tr style="background:${i % 2 ? stripeBg : 'transparent'};color:${cellFg};">
      ${(row.cells || []).map((c, col) => {
    const isNumeric = numeric.has(col);
    const cellStyle = `padding:6pt 8pt;font-size:9pt;font-variant-numeric:tabular-nums;`
      + (isNumeric ? `text-align:right;` : '')
      + (isNumeric && numericFont ? `font-family:${numericFont};` : '');
    return `<td style="${cellStyle}">${esc(resolveBindable(c, ctx))}</td>`;
  }).join('')}
    </tr>`).join('')}</tbody>`;

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
