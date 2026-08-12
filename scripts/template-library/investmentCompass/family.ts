/**
 * Investment Compass — design families.
 *
 * ## What this module is
 *
 * A transcription of the approved Claude Design catalogue's family model, in a
 * shape the seed builder can compile. The catalogue expresses a family as a
 * `base` manifest of ~21 keys plus, per variant, a sparse override object; the
 * resolved manifest for a template is `Object.assign({}, base, overrides)`.
 * That is reproduced exactly here, because it is what makes fifty masters
 * describable rather than fifty hand-drawn documents.
 *
 * ## What is transcribed and what is interpreted
 *
 * **Transcribed verbatim** from `Template Catalogue.dc.html`: family key, name,
 * note, faces, every manifest key and value, every variant's name, id, ground,
 * density, architecture, recommended use and description, and the exact
 * override sets. `assertManifestMatchesSource()` and the spec suite hold these
 * to the source.
 *
 * **Interpreted**: the point sizes, margins and rhythm in `PRIVATE_BANKING_TYPE`
 * and `SPACING_SCALES`. The catalogue names typography as a preset
 * (`cinzel_playfair_inter`) and spacing as a scale name (`generous`); the actual
 * measurements come from the seven drawn A4 pages in
 * `Private Banking Archetypes.dc.html`, which is the only place they exist. Each
 * value below cites the archetype element it was measured from.
 *
 * ## Only one family is drawn
 *
 * The catalogue marks archetype coverage `BUILT` for `axisIndex === 0` and
 * `MANIFEST` for the rest — so Chancery (`pb-01`) has seven composed pages and
 * `pb-02`…`pb-05` are specified as overrides on it. That is the source's stated
 * intent: "This is the family reference. The other four variants are expressed
 * as overrides on it." The builders in `privateBanking.ts` follow that: one
 * composition, parameterised by the resolved manifest.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. The manifest vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/** Resolved manifest for one master template. Keys mirror the approved source. */
export interface TemplateManifest {
  design_family: string;
  typography_preset: string;
  numeric_typography: string;
  cover_overlay: string;
  section_header_style: string;
  kpi_layout: string;
  callout_style: string;
  table_style: string;
  chart_style: string;
  navigation_style: string;
  risk_display: string;
  recommendation_style: string;
  radius: string;
  border_treatment: string;
  spacing_scale: string;
  page_margin_preset: string;
  toc_style: string;
  footer_style: string;
  density: string;
  print_density: string;
}

export type Density = 'compact' | 'balanced' | 'spacious';
export type Ground = 'light' | 'dark';

/**
 * The five variant axes, in the catalogue's order.
 *
 * Positional: the axis is assigned by index, so the first variant of every
 * family is its reference and the fifth its presentation cut.
 */
export const AXES = [
  'A · reference',
  'B · condensed',
  'C · expansive',
  'D · architecture',
  'E · presentation',
] as const;

/** The seven report archetypes every family must cover. */
export const ARCHETYPES = [
  'Cover',
  'Executive dashboard',
  'Narrative',
  'Dense data',
  'Chart and scenario',
  'Risk and recommendation',
  'Sources and appendix',
] as const;

/**
 * The catalogue's five recommended-use buckets, and which templates fall in
 * each. Transcribed from `USE_MATCH`; only Private Banking ids are kept, since
 * the other nine families are not in this pilot.
 */
export const USE_BUCKETS: Readonly<Record<string, readonly string[]>> = {
  'Client-facing': ['pb-01', 'pb-03'],
  'Portfolio review': ['pb-02'],
  'Handover and audit': ['pb-04', 'pb-05'],
};

export function useBucketFor(templateCode: string): string | null {
  for (const [bucket, ids] of Object.entries(USE_BUCKETS)) {
    if (ids.includes(templateCode)) return bucket;
  }
  return null;
}

export interface VariantDefinition {
  /** Approved template name, e.g. "Sovereign Folio". */
  name: string;
  /** Approved catalogue code, e.g. "pb-03". */
  code: string;
  ground: Ground;
  density: Density;
  /** Page architecture: band / grid / bleed / rail / stack. */
  architecture: string;
  /** The approved one-line recommended use. */
  use: string;
  /** The approved description. */
  description: string;
  /** Sparse manifest overrides on the family base. */
  overrides: Partial<TemplateManifest>;
}

export interface DesignFamily {
  /** Stable key, matching the manifest's `design_family`. */
  key: string;
  /** Catalogue code, e.g. "pb". */
  code: string;
  /** Catalogue ordinal, e.g. "01". */
  ordinal: string;
  name: string;
  /** The approved one-line family note. */
  note: string;
  /** The approved face list, as displayed. */
  faces: string;
  base: TemplateManifest;
  variants: readonly VariantDefinition[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Private Banking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Family 01 — Private Banking.
 *
 * Transcribed from `FAMILIES[0]` in the approved catalogue. Do not edit a value
 * here to fix a rendering problem: the manifest is the design decision and the
 * renderer is what implements it.
 */
export const PRIVATE_BANKING: DesignFamily = {
  key: 'private_banking',
  code: 'pb',
  ordinal: '01',
  name: 'Private Banking',
  note: 'Gold on obsidian, editorial ledger, restrained accent',
  faces: 'Cinzel · Playfair · Inter · Plex Mono',
  base: {
    design_family: 'private_banking',
    typography_preset: 'cinzel_playfair_inter',
    numeric_typography: 'playfair_lining_tabular',
    cover_overlay: 'obsidian_full',
    section_header_style: 'eyebrow_rule_display',
    kpi_layout: 'four_column_ruled',
    callout_style: 'tinted_gold_bar',
    table_style: 'ledger_hairline',
    chart_style: 'line_editorial',
    navigation_style: 'print_only',
    risk_display: 'rated_table',
    recommendation_style: 'obsidian_card',
    radius: '0',
    border_treatment: 'hairline',
    spacing_scale: 'generous',
    page_margin_preset: '20mm',
    toc_style: 'none',
    footer_style: 'rule_page_number',
    density: 'balanced',
    print_density: 'standard',
  },
  variants: [
    {
      name: 'Chancery',
      code: 'pb-01',
      ground: 'light',
      density: 'balanced',
      architecture: 'band',
      use: 'Client-facing flagship for private clients',
      description:
        'The reference expression: obsidian cover, four ruled KPI columns, gold used once per page.',
      overrides: {},
    },
    {
      name: 'Chancery Compact',
      code: 'pb-02',
      ground: 'light',
      density: 'compact',
      architecture: 'grid',
      use: 'Portfolio reviews covering several properties',
      description:
        'Six KPI columns and tight ledger rules fit two properties per spread without losing the hierarchy.',
      overrides: {
        density: 'compact',
        page_margin_preset: '16mm',
        kpi_layout: 'six_column_ruled',
        spacing_scale: 'tight',
        table_style: 'ledger_tight',
        print_density: 'dense',
      },
    },
    {
      name: 'Sovereign Folio',
      code: 'pb-03',
      ground: 'light',
      density: 'spacious',
      architecture: 'bleed',
      use: 'Single-asset pitch and presentation',
      description:
        'Full-bleed portrait cover, oversized section numerals, KPIs paired two by two at display size.',
      overrides: {
        density: 'spacious',
        cover_overlay: 'obsidian_bleed_portrait',
        section_header_style: 'full_bleed_numeral',
        kpi_layout: 'two_by_two_display',
        spacing_scale: 'luxurious',
        page_margin_preset: '26mm',
      },
    },
    {
      name: 'Bullion Rail',
      code: 'pb-04',
      ground: 'light',
      density: 'balanced',
      architecture: 'rail',
      use: 'Long reports where orientation matters',
      description:
        'A gold rail carries part number and section name down every page; KPIs stack against it.',
      overrides: {
        navigation_style: 'vertical_rail',
        section_header_style: 'rail_marker',
        kpi_layout: 'stacked_rail',
        footer_style: 'rail_number',
        cover_overlay: 'obsidian_rail',
      },
    },
    {
      name: 'Discretion Ledger',
      code: 'pb-05',
      ground: 'light',
      density: 'balanced',
      architecture: 'stack',
      use: 'Clients who read the numbers first',
      description:
        'Statement rules with double-rule totals, severity bars for risk, and recommendations set as a ruled statement.',
      overrides: {
        table_style: 'double_rule_statement',
        kpi_layout: 'ledger_rows',
        risk_display: 'severity_bars',
        callout_style: 'margin_note',
        chart_style: 'stepped_area',
        recommendation_style: 'ruled_statement',
      },
    },
  ],
};

/** Families in the pilot. The remaining nine land in later stages. */
export const DESIGN_FAMILIES: readonly DesignFamily[] = [PRIVATE_BANKING];

export function resolveManifest(family: DesignFamily, variant: VariantDefinition): TemplateManifest {
  // Mirrors the catalogue's own resolution, including its explicit re-assertion
  // of `density` after the spread.
  return {
    ...family.base,
    ...variant.overrides,
    density: variant.overrides.density ?? family.base.density,
  };
}

export function axisFor(family: DesignFamily, variant: VariantDefinition): string {
  const index = family.variants.indexOf(variant);
  return AXES[index] ?? AXES[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Typography — measured from the drawn archetypes
// ─────────────────────────────────────────────────────────────────────────────

export interface FamilyTypography {
  /** Cover title face. Cinzel: the wordmark and the cover line. */
  display: string;
  displayGeneric: 'serif' | 'sans-serif';
  /** Section headings, KPI values, evidence figures. */
  heading: string;
  headingGeneric: 'serif' | 'sans-serif';
  /** Body copy, table cells, list items. */
  body: string;
  bodyGeneric: 'serif' | 'sans-serif';
  /** Eyebrows, running heads, reference codes, table column labels. */
  mono: string;
}

/**
 * `typography_preset: cinzel_playfair_inter`, resolved.
 *
 * Four faces, each with one job, all measured off the archetype pages:
 *
 *   - **Cinzel** — the wordmark (11pt / 0.26em) and the cover title
 *     (41pt / weight 400 / line-height 1.12). Nothing else. It is an
 *     inscriptional capital and wrong for anything that runs on.
 *   - **Playfair Display** — every heading and every figure: the verdict
 *     (29pt), section headings (22-26pt), KPI values (23pt), evidence figures
 *     (21pt), and the italic cover standfirst (15pt italic).
 *   - **Inter** — body copy (9-10pt) and table cells (8-8.6pt).
 *   - **IBM Plex Mono** — every uppercase label: eyebrows (6-7pt), the running
 *     head (6.2pt), table column heads (6pt), reference codes (9.5pt), footer
 *     (6pt).
 *
 * Playfair setting the FIGURES rather than a mono face is what
 * `numeric_typography: playfair_lining_tabular` means, and it is the family's
 * most distinctive decision — a private-banking statement sets its numbers in
 * the same serif as its prose, with lining tabular figures so columns align.
 */
export const PRIVATE_BANKING_TYPE: FamilyTypography = {
  display: 'Cinzel',
  displayGeneric: 'serif',
  heading: 'Playfair Display',
  headingGeneric: 'serif',
  body: 'Inter',
  bodyGeneric: 'sans-serif',
  mono: 'IBM Plex Mono',
};

/** Point sizes, measured from the archetype pages. */
export interface TypeScale {
  /** Cover title. Archetype: 41pt Cinzel. */
  coverTitle: number;
  /** Cover eyebrow. Archetype: 7pt Plex Mono at 0.34em. */
  coverEyebrow: number;
  /** Cover standfirst. Archetype: 15pt Playfair italic. */
  coverStandfirst: number;
  /** The verdict heading on the dashboard. Archetype: 29pt Playfair. */
  verdict: number;
  /** Ordinary section heading. Archetype: 22pt Playfair (26pt on narrative). */
  heading: number;
  /** Section eyebrow. Archetype: 6.6pt Plex Mono at 0.26em. */
  eyebrow: number;
  /** Running head. Archetype: 6.2pt Plex Mono at 0.2em. */
  runningHead: number;
  /** Body copy. Archetype: 10pt lead, 9pt narrative columns. */
  body: number;
  /** Table cells and list items. Archetype: 8.6pt dashboard, 8pt projections. */
  cell: number;
  /** KPI value. Archetype: 23pt Playfair. */
  kpiValue: number;
  /** KPI label. Archetype: 6pt Plex Mono at 0.18em. */
  kpiLabel: number;
  /** KPI note under the value. Archetype: 7.4pt Inter. */
  kpiNote: number;
  /** Table column head. Archetype: 6pt Plex Mono at 0.1em. */
  columnHead: number;
  /** Section numeral on narrative pages. Archetype: 38pt Playfair in rule. */
  numeral: number;
}

/**
 * The three density steps.
 *
 * `balanced` is measured directly from the archetype. `compact` and `spacious`
 * apply the catalogue's own margin presets (16mm / 26mm against 20mm) and its
 * spacing scale names, stepping the type with them — a 26mm margin at balanced
 * type is not a spacious document, it is a narrower one.
 */
export const TYPE_SCALES: Record<Density, TypeScale> = {
  compact: {
    coverTitle: 34,
    coverEyebrow: 6.5,
    coverStandfirst: 12.5,
    verdict: 23,
    heading: 18,
    eyebrow: 6.2,
    runningHead: 6,
    body: 8.6,
    cell: 7.6,
    kpiValue: 16,
    kpiLabel: 5.6,
    kpiNote: 6.6,
    columnHead: 5.6,
    numeral: 30,
  },
  balanced: {
    coverTitle: 41,
    coverEyebrow: 7,
    coverStandfirst: 15,
    verdict: 29,
    heading: 22,
    eyebrow: 6.6,
    runningHead: 6.2,
    body: 9.6,
    cell: 8.4,
    kpiValue: 23,
    kpiLabel: 6,
    kpiNote: 7.4,
    columnHead: 6,
    numeral: 38,
  },
  spacious: {
    coverTitle: 48,
    coverEyebrow: 7.6,
    coverStandfirst: 17,
    verdict: 33,
    heading: 27,
    eyebrow: 7,
    runningHead: 6.4,
    body: 10.4,
    cell: 9,
    kpiValue: 30,
    kpiLabel: 6.4,
    kpiNote: 8,
    columnHead: 6.4,
    numeral: 52,
  },
};

/** Tracking, in em. The brand signature is the wide uppercase eyebrow. */
export const TRACKING = {
  /** Archetype cover eyebrow: 0.34em. */
  coverEyebrow: 0.34,
  /** Archetype wordmark: 0.26em. */
  wordmark: 0.26,
  /** Archetype section eyebrow: 0.26em. */
  eyebrow: 0.26,
  /** Archetype running head: 0.2em. */
  runningHead: 0.2,
  /** Archetype KPI label: 0.18em. */
  label: 0.18,
  /** Archetype table column head: 0.1em. */
  columnHead: 0.1,
} as const;

/**
 * Page margins, in points, from `page_margin_preset`.
 *
 * The catalogue states these in millimetres. 1mm = 72/25.4 pt, so 20mm is
 * 56.7pt — rounded to whole points because every other geometry value in a
 * `ReportTemplate` is a whole point and a fractional margin makes every
 * downstream `y` fractional too.
 */
export const MARGIN_PRESETS: Record<string, number> = {
  '16mm': 45,
  '20mm': 57,
  '24mm': 68,
  '26mm': 74,
  '28mm': 79,
};

export function marginFor(manifest: TemplateManifest): number {
  const margin = MARGIN_PRESETS[manifest.page_margin_preset];
  // Throwing rather than defaulting: a preset this module does not know is a
  // transcription error, and silently falling back to 20mm would ship a
  // "spacious" template at reference margins with nothing to show for it.
  if (!margin) {
    throw new Error(`No margin for page_margin_preset "${manifest.page_margin_preset}"`);
  }
  return margin;
}

/** Vertical rhythm, in points, from `spacing_scale`. */
export interface SpacingScale {
  /** Space between flowed blocks. */
  gap: number;
  /** Space between a section heading and its content. */
  headingGap: number;
  /** Space above a new section. */
  sectionGap: number;
  /** Table row height. */
  rowHeight: number;
  /** Table cell padding. */
  cellPadding: number;
}

export const SPACING_SCALES: Record<string, SpacingScale> = {
  tight: { gap: 11, headingGap: 7, sectionGap: 16, rowHeight: 14, cellPadding: 3 },
  generous: { gap: 16, headingGap: 10, sectionGap: 24, rowHeight: 18, cellPadding: 4.5 },
  luxurious: { gap: 22, headingGap: 14, sectionGap: 34, rowHeight: 22, cellPadding: 6 },
};

export function spacingFor(manifest: TemplateManifest): SpacingScale {
  const scale = SPACING_SCALES[manifest.spacing_scale];
  if (!scale) throw new Error(`No spacing scale for "${manifest.spacing_scale}"`);
  return scale;
}

/** Corner radius in points. Private Banking is `radius: '0'` throughout. */
export function radiusFor(manifest: TemplateManifest): number {
  const radius = Number(manifest.radius);
  return Number.isFinite(radius) ? radius : 0;
}

/**
 * Hairline weight in points, from `border_treatment`.
 *
 * The archetype draws three weights and means something different by each:
 * 1px hairline for table rows and the running-head rule, 1.5px for the rule
 * over a KPI band and under a table's column heads, and a doubled 1.5+1 for a
 * statement total.
 */
export const RULE_WEIGHTS = {
  hairline: 0.75,
  emphasis: 1.5,
  total: 1.5,
} as const;
