/**
 * Phase 6 — shared helpers for data-driven blocks (tables, grids, charts).
 *
 * `resolveDataPath` walks a dotted path against the resolve context's data and
 * tolerates `{{path}}` syntax so designers can paste either form into props.
 * `formatCell` reuses the existing binding pipeline filters via `resolveBindable`
 * when a template-style string is provided, otherwise applies the simple format.
 */
import { formatIsoDate, resolveBindable, type ResolveContext } from '../bindingResolver';

export function resolveDataPath(path: unknown, ctx: ResolveContext): any {
  if (path == null) return undefined;
  let p = String(path).trim();
  if (!p) return undefined;
  // Allow `{{ path }}` shorthand
  const tplMatch = p.match(/^\{\{\s*([^|}]+?)\s*(\|.+)?\}\}$/);
  if (tplMatch) p = tplMatch[1].trim();
  const parts = p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: any = ctx.data;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function toArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'object') return Object.values(value);
  return [value];
}

export function toNumber(value: any, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (value == null || value === '') return fallback;
  const n = Number(String(value).replace(/[^0-9.\-eE]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export type CellFormat = 'auto' | 'number' | 'currency' | 'percent' | 'date' | 'text';

export function formatCell(value: any, format: CellFormat = 'auto'): string {
  if (value == null || value === '') return '';
  if (format === 'currency') {
    const n = toNumber(value, NaN);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
  }
  if (format === 'percent') {
    const n = toNumber(value, NaN);
    if (!Number.isFinite(n)) return String(value);
    return `${(n * (n > 1 ? 1 : 100)).toFixed(1)}%`;
  }
  if (format === 'number') {
    const n = toNumber(value, NaN);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat('en-AU').format(n);
  }
  if (format === 'date') {
    // Read field by field when it is an ISO string, so a cell cannot shift a
    // day with the operator's timezone. See `formatIsoDate`.
    const iso = typeof value === 'string' ? formatIsoDate(value) : null;
    if (iso !== null) return iso;
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (format === 'text') return String(value);
  // auto
  if (typeof value === 'number') return new Intl.NumberFormat('en-AU').format(value);
  if (value instanceof Date) return value.toLocaleDateString('en-AU');
  /*
   * `auto` means "show this the way a reader expects", and a reader never
   * expects `2026-08-16T08:58:56.946Z`. A column that declares `format: 'text'`
   * has asked for the string and still gets it; `autoColumns` declares no
   * format at all, so a table synthesised from a row's own keys — where a
   * `created_at` is most likely to turn up — lands here.
   */
  const auto = typeof value === 'string' ? formatIsoDate(value) : null;
  if (auto !== null) return auto;
  return String(value);
}

export interface ColumnDef {
  key: string;            // dotted path within each row
  label?: string;
  width?: number;         // fractional 0..1
  align?: 'left' | 'center' | 'right';
  format?: CellFormat;
  template?: string;      // optional `{{...}}` style — wins over key
  color?: string;
}

/** Pull a value out of a row given a ColumnDef. */
export function readColumn(row: any, col: ColumnDef, ctx: ResolveContext): any {
  if (col.template) {
    const rowCtx: ResolveContext = { ...ctx, data: { ...ctx.data, row, ...(row ?? {}) } };
    return resolveBindable(col.template, rowCtx);
  }
  if (!col.key) return row;
  const parts = col.key.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: any = row;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Synthesise columns from the first row when none provided. */
export function autoColumns(rows: any[]): ColumnDef[] {
  const first = rows.find((r) => r && typeof r === 'object');
  if (!first) return [{ key: 'value', label: 'Value' }];
  return Object.keys(first).slice(0, 8).map((k) => ({ key: k, label: titleCase(k) }));
}

export function titleCase(k: string): string {
  return k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function colorFromPalette(i: number, palette?: string[]): string {
  const PAL = palette && palette.length ? palette : [
    '#BF9B50', '#7BAEFF', '#7BD4A7', '#F2C14E', '#E27D60', '#9D7BFF', '#6BCBD9', '#D87BB1',
  ];
  return PAL[i % PAL.length];
}
