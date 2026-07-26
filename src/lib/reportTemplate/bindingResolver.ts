/**
 * Binding & token resolution for report templates.
 *
 * Supports:
 *   "literal value"                          → returned as-is
 *   "token:primary"                          → tokens.colors.primary or tokens.fonts.primary etc.
 *   "{{property.address}}"                   → data.property.address
 *   "{{financials.weeklyRent | currency}}"   → with filter
 *   "{{=netYield}}"                          → computed field (tokens.computed[name])
 *   "{{= price * 0.052 | currency}}"         → inline expression
 *   "Hello {{name}}, you owe {{amt | currency}}"
 *
 * Conditional expressions (`block.conditional`, `page.conditional`) are
 * evaluated via a tiny safe-ish expression evaluator: only a small allow-list
 * of operators is supported. NEVER pass user input to this function unsanitised.
 */
import type { Tokens, ComputedField } from './templateSchema';

export interface ResolveContext {
  data: Record<string, any>;
  tokens: Tokens;
}

// ─── Filters ──────────────────────────────────────────────────────────────────
type Filter = (value: any, ...args: string[]) => any;

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export const FILTERS: Record<string, Filter> = {
  // Money / numeric formatting
  currency: (v, decimals) => {
    const n = num(v);
    if (Number.isNaN(n)) return String(v ?? '');
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: decimals != null ? Number(decimals) : 0 }).format(n);
  },
  number: (v, decimals) => {
    const n = num(v);
    if (Number.isNaN(n)) return String(v ?? '');
    return new Intl.NumberFormat('en-AU', { maximumFractionDigits: decimals != null ? Number(decimals) : 0 }).format(n);
  },
  percent: (v, decimals) => {
    const n = num(v);
    if (Number.isNaN(n)) return String(v ?? '');
    return `${n.toFixed(decimals != null ? Number(decimals) : 2)}%`;
  },
  fixed: (v, decimals) => {
    const n = num(v); return Number.isNaN(n) ? String(v ?? '') : n.toFixed(Number(decimals ?? 2));
  },
  round: (v) => { const n = num(v); return Number.isNaN(n) ? v : Math.round(n); },
  abs: (v) => { const n = num(v); return Number.isNaN(n) ? v : Math.abs(n); },

  // Arithmetic (chainable)
  add: (v, x) => num(v) + num(x),
  sub: (v, x) => num(v) - num(x),
  mul: (v, x) => num(v) * num(x),
  div: (v, x) => { const d = num(x); return d === 0 ? 0 : num(v) / d; },
  mod: (v, x) => { const d = num(x); return d === 0 ? 0 : num(v) % d; },
  min: (v, x) => Math.min(num(v), num(x)),
  max: (v, x) => Math.max(num(v), num(x)),

  // Dates
  date: (v, fmt) => {
    if (!v) return '';
    const d = new Date(v as any);
    if (Number.isNaN(d.getTime())) return String(v);
    if (fmt === 'iso') return d.toISOString().slice(0, 10);
    if (fmt === 'short') return d.toLocaleDateString('en-AU');
    if (fmt === 'long') return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  },
  dateRel: (v) => {
    if (!v) return '';
    const d = new Date(v as any);
    if (Number.isNaN(d.getTime())) return String(v);
    const diff = (Date.now() - d.getTime()) / 1000;
    const abs = Math.abs(diff);
    const sign = diff >= 0 ? 'ago' : 'from now';
    if (abs < 60) return `just now`;
    if (abs < 3600) return `${Math.round(abs / 60)}m ${sign}`;
    if (abs < 86400) return `${Math.round(abs / 3600)}h ${sign}`;
    if (abs < 2592000) return `${Math.round(abs / 86400)}d ${sign}`;
    return `${Math.round(abs / 2592000)}mo ${sign}`;
  },

  // Strings
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  capitalize: (v) => { const s = String(v ?? ''); return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; },
  title: (v) => String(v ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
  trim: (v) => String(v ?? '').trim(),
  truncate: (v, len, suffix) => {
    const s = String(v ?? ''); const n = Number(len ?? 80);
    return s.length > n ? s.slice(0, n) + (suffix ?? '…') : s;
  },
  replace: (v, find, repl) => String(v ?? '').split(String(find ?? '')).join(String(repl ?? '')),
  slice: (v, start, end) => String(v ?? '').slice(Number(start ?? 0), end != null ? Number(end) : undefined),
  pluralize: (v, singular, plural) => {
    const n = num(v); const s = singular ?? ''; const p = plural ?? `${s}s`;
    return `${n} ${n === 1 ? s : p}`;
  },
  join: (v, sep) => Array.isArray(v) ? v.join(sep ?? ', ') : String(v ?? ''),
  first: (v) => Array.isArray(v) ? v[0] : v,
  last: (v) => Array.isArray(v) ? v[v.length - 1] : v,
  count: (v) => Array.isArray(v) ? v.length : (v == null ? 0 : 1),
  sum: (v, path) => {
    if (!Array.isArray(v)) return num(v) || 0;
    return v.reduce((acc, item) => acc + num(path ? getByPath(item, path) : item) || 0, 0);
  },
  avg: (v, path) => {
    if (!Array.isArray(v) || v.length === 0) return 0;
    const total = v.reduce((acc, item) => acc + (num(path ? getByPath(item, path) : item) || 0), 0);
    return total / v.length;
  },

  // Conditional / fallback
  default: (v, fallback) => (v === null || v === undefined || v === '' ? (fallback ?? '') : v),
  fallback: (v, fallback) => (v === null || v === undefined || v === '' ? (fallback ?? '') : v),
  if: (v, truthy, falsy) => (v ? (truthy ?? '') : (falsy ?? '')),
  eq: (v, x) => String(v) === String(x),
  neq: (v, x) => String(v) !== String(x),
  gt: (v, x) => num(v) > num(x),
  lt: (v, x) => num(v) < num(x),
  gte: (v, x) => num(v) >= num(x),
  lte: (v, x) => num(v) <= num(x),

  // Encoding
  json: (v) => { try { return JSON.stringify(v); } catch { return String(v ?? ''); } },
  urlencode: (v) => encodeURIComponent(String(v ?? '')),
};

// ─── Path access ──────────────────────────────────────────────────────────────
// Supports dotted paths, with array index syntax: "properties[0].price" or "properties.0.price"
function getByPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.');
  return parts.reduce((acc, key) => (acc == null ? acc : acc[key.trim()]), obj);
}

// ─── Computed field evaluation ────────────────────────────────────────────────
const SAFE_EXPR_RE = /^[\s\w.@$'"=!<>&|()+\-*/%?:,\[\]]*$/;

function evalExpression(expr: string, ctx: ResolveContext): any {
  if (!SAFE_EXPR_RE.test(expr)) {
    console.warn('[binding] Rejected unsafe expression:', expr);
    return '';
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('data', 'tokens', '$', `"use strict"; with (data) { return (${expr}); }`);
    return fn(ctx.data, ctx.tokens, ctx.data);
  } catch (e) {
    console.warn('[binding] Expression eval failed:', expr, e);
    return '';
  }
}

function resolveComputed(name: string, ctx: ResolveContext): any {
  const cf: ComputedField | undefined = (ctx.tokens.computed ?? []).find((c) => c.name === name);
  if (!cf) return undefined;
  const value = evalExpression(cf.expr, ctx);
  // Apply default format if specified and no inline filter follows
  if (cf.format && cf.format !== 'raw') {
    const fn = FILTERS[cf.format];
    if (fn) return fn(value);
  }
  return value;
}

// ─── Bindable string resolution ───────────────────────────────────────────────
const BINDING_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function applyFilters(value: any, filterParts: string[]): any {
  for (const f of filterParts) {
    // Parse filter:arg1:arg2 with support for quoted args containing colons
    const m = f.match(/^([a-zA-Z_]\w*)\s*(?::\s*(.*))?$/);
    if (!m) continue;
    const name = m[1];
    const argsRaw = m[2] ?? '';
    const args = argsRaw
      ? argsRaw.match(/'[^']*'|"[^"]*"|[^:]+/g)?.map((a) => a.trim().replace(/^['"]|['"]$/g, '')) ?? []
      : [];
    const fn = FILTERS[name];
    if (fn) value = fn(value, ...args);
  }
  return value;
}

export function resolveBindable(
  input: unknown,
  ctx: ResolveContext,
  transformResolvedValue: (value: string) => string = (value) => value,
): string {
  if (input == null) return '';
  const s = String(input);

  // token:xxx → look up in tokens (colors > fonts > spacing)
  if (s.startsWith('token:')) {
    const key = s.slice(6);
    return (
      ctx.tokens.colors[key] ??
      ctx.tokens.fonts[key] ??
      (ctx.tokens.spacing[key] != null ? String(ctx.tokens.spacing[key]) : s)
    );
  }

  if (!s.includes('{{')) return s;

  return s.replace(BINDING_RE, (_match, expr: string) => {
    const trimmed = expr.trim();
    const [headRaw, ...filterParts] = trimmed.split('|').map((p) => p.trim());
    let value: any;

    if (headRaw.startsWith('=')) {
      // Inline expression OR computed reference: "= name" or "= price * 0.06"
      const body = headRaw.slice(1).trim();
      // bare identifier → computed field lookup
      if (/^[a-zA-Z_]\w*$/.test(body)) {
        value = resolveComputed(body, ctx);
        if (value === undefined) value = evalExpression(body, ctx);
      } else {
        value = evalExpression(body, ctx);
      }
    } else if (headRaw.startsWith('@')) {
      value = resolveComputed(headRaw.slice(1).trim(), ctx);
    } else {
      value = getByPath(ctx.data, headRaw);
    }

    value = applyFilters(value, filterParts);
    return value == null ? '' : transformResolvedValue(String(value));
  });
}

export function resolveTokenReference(input: unknown, ctx: ResolveContext): string {
  if (input == null) return '';
  const s = String(input);
  if (!s.startsWith('token:')) return resolveBindable(input, ctx);
  const key = s.slice(6);
  return (
    ctx.tokens.colors[key] ??
    ctx.tokens.fonts[key] ??
    (ctx.tokens.spacing[key] != null ? String(ctx.tokens.spacing[key]) : '')
  );
}

/** Resolve a numeric bindable (font sizes, etc.). */
export function resolveBindableNumber(input: unknown, ctx: ResolveContext, fallback = 0): number {
  if (typeof input === 'number') return input;
  const resolved = resolveBindable(input, ctx);
  const n = Number(resolved);
  return Number.isFinite(n) ? n : fallback;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function byteToHex(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0');
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  if (sat === 0) {
    const v = clampByte(light * 255);
    return { r: v, g: v, b: v };
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: clampByte(channel(hue + 1 / 3) * 255), g: clampByte(channel(hue) * 255), b: clampByte(channel(hue - 1 / 3) * 255) };
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  transparent: 'transparent',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  gray: '#808080',
  grey: '#808080',
  navy: '#000080',
  teal: '#008080',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  brown: '#a52a2a',
};

function normaliseCssColor(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
  if (v.startsWith('#')) {
    const h = v.slice(1);
    if (/^[0-9a-fA-F]{3,8}$/.test(h)) return `#${h}`;
    return null;
  }
  if (/^[0-9a-fA-F]{3,8}$/.test(v)) return `#${v}`;

  const rgb = lower.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const nums = parts.slice(0, 3).map((part) => part.endsWith('%') ? Number(part.slice(0, -1)) * 2.55 : Number(part));
      if (nums.every(Number.isFinite)) return `#${byteToHex(nums[0])}${byteToHex(nums[1])}${byteToHex(nums[2])}`;
    }
  }

  const hsl = lower.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const parts = hsl[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const h = Number(parts[0].replace(/deg$/, ''));
      const sat = parts[1].endsWith('%') ? Number(parts[1].slice(0, -1)) / 100 : Number(parts[1]);
      const light = parts[2].endsWith('%') ? Number(parts[2].slice(0, -1)) / 100 : Number(parts[2]);
      if ([h, sat, light].every(Number.isFinite)) {
        const { r, g, b } = hslToRgb(h, sat, light);
        return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
      }
    }
  }

  return null;
}

/** Resolve a colour, accepting hex plus common CSS rgb/rgba/hsl/named forms and returning a renderer-safe value. */
export function resolveBindableColor(input: unknown, ctx: ResolveContext, fallback = '#000000'): string {
  const v = resolveBindable(input, ctx);
  if (!v) return fallback;
  return normaliseCssColor(v) ?? fallback;
}

// ─── Conditional expressions ──────────────────────────────────────────────────
const SAFE_EXPR = /^[\s\w.'"=!<>&|()+\-*/%?:,\[\]@]*$/;

export function evalConditional(expr: string | undefined, ctx: ResolveContext): boolean {
  if (!expr) return true;
  if (!SAFE_EXPR.test(expr)) {
    console.warn('[conditional] Rejected unsafe expression:', expr);
    return false;
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('data', 'tokens', `"use strict"; with (data) { return (${expr}); }`);
    return Boolean(fn(ctx.data, ctx.tokens));
  } catch (e) {
    console.warn('[conditional] Eval failed:', expr, e);
    return false;
  }
}

/** Exported list of filter names, kept in sync for validation. */
export const FILTER_NAMES = Object.keys(FILTERS);
