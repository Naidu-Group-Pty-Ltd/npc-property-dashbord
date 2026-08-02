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
 * ## What this module learned the hard way
 *
 * The previous version of this file named **Cormorant Garamond** and
 * **Fraunces** in its stacks and listed them as installed, on the strength of
 * the Dockerfile's `apt-get install fonts-cormorant-garamond fonts-fraunces`.
 * Neither package exists in Debian — bookworm or trixie — and neither does
 * `fonts-playfair-display`. `apt-get install -y` exits non-zero on an unknown
 * package, so that `RUN` layer fails and **the image could not be built at
 * all**. The contract was never checked, so nothing said so.
 *
 * It is checked now. `CONTAINER_FONT_PACKAGES` and `CONTAINER_FONT_FILES` are
 * the two ways a face can reach the image, `CONTAINER_INSTALLED_FAMILIES` is
 * their union, and `reportTypography.spec.ts` reads
 * `weasyprint-service/Dockerfile` and fails if any of the three disagree with
 * it — or if a stack names a family none of them provide.
 */

/**
 * Debian packages the image installs, and the families each provides.
 *
 * Every one of these is verified present in **both** bookworm and trixie, so
 * the image builds whichever base `python:3.12-slim` resolves to. Adding a row
 * here without adding the package to the Dockerfile fails the spec, and vice
 * versa.
 */
export const CONTAINER_FONT_PACKAGES: Record<string, readonly string[]> = {
  'fonts-inter': ['Inter'],
  'fonts-ibm-plex': ['IBM Plex Sans', 'IBM Plex Mono'],
  'fonts-roboto': ['Roboto'],
  'fonts-lato': ['Lato'],
  'fonts-dejavu': ['DejaVu Sans', 'DejaVu Serif'],
  'fonts-liberation': ['Liberation Sans', 'Liberation Serif'],
  'fonts-noto': ['Noto Sans', 'Noto Serif'],
  // Not a text face — CJK coverage so a non-Latin client name renders as
  // characters rather than tofu.
  'fonts-noto-cjk': [],
};

/**
 * TTFs the image `COPY`s into `/usr/local/share/fonts/` and `fc-cache`s.
 *
 * The two brand faces are not packaged by any distribution, so they travel with
 * the service. They live in `weasyprint-service/fonts/` rather than
 * `public/fonts/` because Docker cannot `COPY` from outside its build context,
 * and the documented build context is the service directory.
 *
 * They are SIL OFL 1.1; `Cinzel-OFL.txt` and `PlayfairDisplay-OFL.txt` ship
 * beside them, which the licence requires for redistribution in an image.
 */
export const CONTAINER_FONT_FILES: Record<string, readonly string[]> = {
  'Cinzel-Bold.ttf': ['Cinzel'],
  'PlayfairDisplay-Medium.ttf': ['Playfair Display'],
  // The italic is a separate file and a separate decision: the accent role is
  // set in italic, and without this the engine synthesises a slant from the
  // upright — which on a high-contrast didone reads as a printing fault.
  'PlayfairDisplay-MediumItalic.ttf': ['Playfair Display'],
};

/** Every family the container provides, from either route. De-duplicated. */
export const CONTAINER_INSTALLED_FAMILIES: readonly string[] = [
  ...new Set([
    ...Object.values(CONTAINER_FONT_PACKAGES).flat(),
    ...Object.values(CONTAINER_FONT_FILES).flat(),
  ]),
].sort();

export type InstalledFamily = typeof CONTAINER_INSTALLED_FAMILIES[number];

/**
 * The roles a report sets type in.
 *
 * Every stack ends in a generic so a missing face degrades to the right *shape*
 * rather than to the engine's serif default — which is how a sans-set technical
 * report silently prints in Times.
 */
export const PRINT_STACK = {
  /**
   * Cover titles and the closing lockup. `--font-display` in the design system.
   *
   * Cinzel is the brand's cover face and ships Bold only, which is why it is
   * confined to the two places set large and short. At body sizes an all-caps
   * roman like this is unreadable.
   */
  cover: "'Cinzel', 'Playfair Display', Georgia, serif",
  /**
   * Display — chapter titles, section heads, pull quotes. `--font-serif`.
   */
  display: "'Playfair Display', Georgia, serif",
  /** Body copy and tables. */
  body: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  /**
   * Figures, eyebrows, running heads, page numbers.
   *
   * A ledger column is only readable if the digits stack, and that needs
   * tabular figures — see `NUMERIC_FEATURES`.
   */
  mono: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
  /**
   * Editorial italic accents — standfirsts, deks, captions with voice.
   *
   * The same family as `display`, set in italic, rather than a second serif.
   * The previous stack led with Cormorant Garamond, which is not installable on
   * Debian and was therefore silently falling back to the engine's default
   * serif — visible in the first real render as an accent line that was not
   * italic at all. One editorial serif used upright and italic is a system;
   * two serifs where the second never loads is a bug.
   */
  accent: "'Playfair Display', Georgia, serif",
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

/**
 * The first family in a stack that the container actually provides.
 *
 * What the reader will see. Returns `null` when the stack resolves to nothing
 * but its generic — which is the failure this module exists to make loud.
 */
export function effectiveFamily(stack: string): string | null {
  const installed = new Set<string>(CONTAINER_INSTALLED_FAMILIES);
  return familiesInStack(stack).find((f) => installed.has(f)) ?? null;
}
