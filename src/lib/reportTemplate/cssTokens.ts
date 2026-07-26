/**
 * Token → CSS variables compiler.
 *
 * Compiles `template.tokens.*` into a `:root { … }` block so HTML/CSS-rendered
 * templates (WeasyPrint preview + final PDF) reference them as:
 *   var(--color-primary), var(--font-heading), var(--space-gutter),
 *   var(--radius-md), var(--shadow-card), var(--gradient-hero), var(--text-base)
 *
 * Phase 1 extends the original 3 categories (colors/fonts/spacing) with
 * radii, shadows, gradients, and a numeric type-scale. All emit safely
 * even if absent.
 */
import type { Tokens } from './templateSchema';

function safeKey(k: string): string {
  return k.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function escapeCssString(value: unknown): string {
  return String(value).replace(/[\\'\n\r\f<>]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `);
}

function isRemoteFontUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFontSource(value: string): boolean {
  return isRemoteFontUrl(value)
    || /^data:font\/(?:woff2?|ttf|otf|opentype);base64,[a-z0-9+/]+={0,2}$/i.test(value);
}

function safeFontWeight(value: unknown): string {
  const weight = String(value ?? 'normal');
  return /^(?:normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?$/.test(weight)
    ? weight
    : 'normal';
}

export function tokensToCssVariables(tokens: Tokens): string {
  const lines: string[] = [':root {'];
  for (const [k, v] of Object.entries(tokens.colors || {})) {
    lines.push(`  --color-${safeKey(k)}: ${v};`);
  }
  for (const [k, v] of Object.entries(tokens.fonts || {})) {
    lines.push(`  --font-${safeKey(k)}: ${v};`);
  }
  for (const [k, v] of Object.entries(tokens.spacing || {})) {
    lines.push(`  --space-${safeKey(k)}: ${v}px;`);
  }
  for (const [k, v] of Object.entries(tokens.radii || {})) {
    lines.push(`  --radius-${safeKey(k)}: ${v}px;`);
  }
  for (const [k, v] of Object.entries(tokens.shadows || {})) {
    lines.push(`  --shadow-${safeKey(k)}: ${v};`);
  }
  for (const [k, v] of Object.entries(tokens.gradients || {})) {
    lines.push(`  --gradient-${safeKey(k)}: ${v};`);
  }
  for (const [k, v] of Object.entries(tokens.typeScale || {})) {
    lines.push(`  --text-${safeKey(k)}: ${v}pt;`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * Phase 5 — emit @import / @font-face declarations from tokens.fontFaces so
 * the renderer can use custom or Google Fonts without manual setup.
 */
export function tokensToFontFaceCss(tokens: Tokens): string {
  const faces = (tokens as any).fontFaces as Array<any> | undefined;
  if (!faces || !faces.length) return '';
  const imports: string[] = [];
  const declarations: string[] = [];
  for (const f of faces) {
    if (f?.cssUrl) {
      const cssUrl = String(f.cssUrl);
      if (isRemoteFontUrl(cssUrl)) imports.push(`@import url('${escapeCssString(cssUrl)}');`);
      continue;
    }
    if (f?.src && f?.family) {
      // Match both file extensions (.woff2) and data: MIME types (data:font/woff2)
      // so embedded/captured fonts (R0, data: src) get the right format() hint.
      const src = String(f.src);
      if (!isFontSource(src)) continue;
      const fmt = /woff2/i.test(src) ? 'woff2'
        : /woff/i.test(src) ? 'woff'
        : /(otf|opentype)/i.test(src) ? 'opentype'
        : /(ttf|truetype)/i.test(src) ? 'truetype' : '';
      declarations.push(`@font-face {
  font-family: '${escapeCssString(f.family)}';
  src: url('${escapeCssString(src)}')${fmt ? ` format('${fmt}')` : ''};
  font-weight: ${safeFontWeight(f.weight)};
  font-style: ${f.style ?? 'normal'};
  font-display: ${f.display ?? 'swap'};
}`);
    }
  }
  return [imports.join('\n'), declarations.join('\n')].filter(Boolean).join('\n');
}
