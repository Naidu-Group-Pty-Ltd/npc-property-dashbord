/**
 * Print typography.
 *
 * ## The constraint that governs everything here
 *
 * **Only faces installed in the WeasyPrint container render.** The application
 * ships no webfonts at all — `src/branding/brand-fonts.ts` is a list of system
 * stacks — so nothing can be inherited from the UI, and a face named here but
 * absent from the image silently falls back to the engine default. That failure
 * is invisible in code review and obvious in a client's hands.
 *
 * `CONTAINER_INSTALLED_FAMILIES` is therefore a contract with
 * `weasyprint-service/Dockerfile`, asserted by `reportTypography.spec.ts`. If
 * you add a family to a stack, add it to the image in the same change.
 */

/**
 * Families the render container provides.
 *
 * Debian packages installed by `weasyprint-service/Dockerfile`:
 * `fonts-inter`, `fonts-playfair-display`, `fonts-cormorant-garamond`,
 * `fonts-fraunces`, `fonts-ibm-plex`, `fonts-roboto`, `fonts-lato`, plus the
 * DejaVu / Liberation / Noto fallbacks.
 *
 * **Cinzel is deliberately absent.** It is not a Debian package. The TTF is in
 * the repo at `public/fonts/Cinzel-Bold.ttf` and must be `COPY`-ed into the
 * image with an `fc-cache` before any report may name it — see
 * `docs/reports/DESIGN_SYSTEM.md` §10.1.
 */
export const CONTAINER_INSTALLED_FAMILIES = [
  'Inter',
  'Playfair Display',
  'Cormorant Garamond',
  'Fraunces',
  'IBM Plex Sans',
  'IBM Plex Mono',
  'Roboto',
  'Lato',
  'DejaVu Sans',
  'DejaVu Serif',
  'Liberation Sans',
  'Liberation Serif',
  'Noto Sans',
  'Noto Serif',
] as const;

export type InstalledFamily = typeof CONTAINER_INSTALLED_FAMILIES[number];

/**
 * The four roles a report sets type in.
 *
 * Every stack ends in a generic so a missing face degrades to the right *shape*
 * rather than to the engine's serif default — which is how a sans-set technical
 * report silently prints in Times.
 */
export const PRINT_STACK = {
  /**
   * Display — cover titles, chapter openers, pull quotes.
   *
   * Playfair Display is one of the two faces the product ships (the other is
   * Cinzel, pending the image change), so a report cover matches the
   * certificate the same client was issued.
   */
  display: "'Playfair Display', 'Fraunces', Georgia, serif",
  /** Body copy and tables. */
  body: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  /**
   * Figures, eyebrows, running heads, page numbers.
   *
   * A ledger column is only readable if the digits stack, and that needs
   * tabular figures — see `NUMERIC_FEATURES`.
   */
  mono: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
  /** Editorial italic accents — standfirsts, captions with voice. */
  accent: "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
} as const;

/**
 * Applied to every figure in a table, KPI or ledger.
 *
 * `tabular-nums` is the one that matters: proportional digits make a
 * ten-year projection unreadable down the column. `lining-nums` stops an
 * old-style face dropping digits below the baseline in a financial context.
 */
export const NUMERIC_FEATURES = 'font-variant-numeric: tabular-nums lining-nums;';

/**
 * The brand signature in print: a wide uppercase eyebrow over a tight-tracked
 * title. Carried from `--tracking-eyebrow` / `--tracking-tight`.
 */
export const EYEBROW_STYLE = {
  transform: 'uppercase',
  tracking: '0.18em',
  weight: 700,
} as const;

/** Families named by a stack, in declaration order, de-duplicated. */
export function familiesInStack(stack: string): string[] {
  const out: string[] = [];
  for (const raw of stack.split(',')) {
    const family = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!family) continue;
    if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(family)) continue;
    if (!out.includes(family)) out.push(family);
  }
  return out;
}

/**
 * Families a stack names that the container does not provide.
 *
 * Generic keywords and the ubiquitous metric-compatible aliases
 * (`Helvetica Neue`, `Arial`, `Georgia`, `Consolas`, `SFMono-Regular`) are not
 * reported: they are last-resort fallbacks that resolve to a Liberation or
 * DejaVu metric equivalent, never the intended face, and flagging them would
 * make the check noise.
 */
const METRIC_ALIASES = new Set([
  'Helvetica Neue', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Times',
  'Consolas', 'SFMono-Regular', 'Menlo', 'Monaco', 'Courier New',
]);

export function missingFamilies(stack: string): string[] {
  const installed = new Set<string>(CONTAINER_INSTALLED_FAMILIES);
  return familiesInStack(stack).filter((f) => !installed.has(f) && !METRIC_ALIASES.has(f));
}
