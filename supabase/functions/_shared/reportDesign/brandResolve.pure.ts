/**
 * Resolve a print-ready palette from the design-system defaults, a design
 * preset and a tenant's white-label brand.
 *
 * The layering is strict and the order matters:
 *
 *   0. NPC print defaults (`tokens.pure.ts`, derived from `src/styles/tokens.css`)
 *   1. the preset — **neutral family only** (paper, ink, rule)
 *   2. the tenant's Category A brand colour, with its on-paper and on-field
 *      variants *re-derived* rather than stored
 *   3. Category B semantics, applied last from a frozen constant
 *
 * Step 3 is last on purpose. `PRINT_SEMANTIC` is frozen and there is no
 * parameter through which a caller can reach it, so "a tenant cannot make risk
 * green" is enforced by the shape of this function rather than by review.
 *
 * Pure: no imports beyond sibling `.pure` modules, no I/O.
 */
import { contrastRatio, ensureContrast, relativeLuminanceFromHex } from './color.pure.ts';
import {
  CONTRAST_FLOOR,
  PRINT_BRAND,
  PRINT_INK,
  PRINT_SEMANTIC,
  PRINT_SURFACE,
} from './tokens.pure.ts';
import { INK_LEGALITY, type ResolvedReportPalette } from './roles.pure.ts';

/** Mirrors `PdfDesignPreset` in src/components/reports/premiumPdfDesign.ts. */
export type ReportPreset = 'signature' | 'editorial_navy' | 'minimal_ink' | 'high_contrast';

/**
 * Neutral families per preset. A preset changes the *paper and ink*, never the
 * brand and never the semantics — so switching preset cannot break a tenant's
 * identity or the meaning of a colour.
 */
const PRESET_NEUTRALS: Record<ReportPreset, Pick<
  ResolvedReportPalette,
  'paper' | 'paperAlt' | 'paperBright' | 'field' | 'rule' | 'bodyInk' | 'mutedInk'
>> = {
  /** The house look: warm ivory stock, graphite ink, obsidian cover. */
  signature: {
    paper: PRINT_SURFACE.paper,
    paperAlt: PRINT_SURFACE.paperAlt,
    paperBright: PRINT_SURFACE.paperBright,
    field: PRINT_SURFACE.field,
    rule: PRINT_SURFACE.rule,
    bodyInk: PRINT_INK.body,
    mutedInk: PRINT_INK.muted,
  },
  /** Cooler stock throughout — for dense, technical documents. */
  editorial_navy: {
    paper: PRINT_SURFACE.paperBright,
    paperAlt: PRINT_SURFACE.paperAlt,
    paperBright: PRINT_SURFACE.paperBright,
    field: PRINT_SURFACE.field,
    rule: PRINT_SURFACE.rule,
    bodyInk: PRINT_INK.body,
    mutedInk: PRINT_INK.muted,
  },
  /** Maximum restraint: the brightest stock, no warm panel. */
  minimal_ink: {
    paper: PRINT_SURFACE.paperBright,
    paperAlt: PRINT_SURFACE.paper,
    paperBright: PRINT_SURFACE.paperBright,
    field: PRINT_SURFACE.field,
    rule: PRINT_SURFACE.rule,
    bodyInk: PRINT_INK.body,
    mutedInk: PRINT_INK.muted,
  },
  /**
   * Accessibility-first: body ink is pushed to the darkest ground available so
   * the document stays legible when photocopied or faxed, which advisory
   * documents genuinely still are.
   */
  high_contrast: {
    paper: PRINT_SURFACE.paperBright,
    paperAlt: PRINT_SURFACE.paperAlt,
    paperBright: PRINT_SURFACE.paperBright,
    field: PRINT_SURFACE.field,
    rule: PRINT_INK.muted,
    bodyInk: PRINT_SURFACE.field,
    mutedInk: PRINT_INK.body,
  },
};

export interface ResolveReportPaletteInput {
  /** Design preset. Defaults to `signature`. */
  preset?: ReportPreset;
  /**
   * The tenant's brand colour as `#RRGGBB`. Comes from the report's brand
   * snapshot, which normalises `whitelabel_settings` (HSL triplet *or* hex) to
   * hex once, at snapshot time.
   *
   * Omit for the NPC brand.
   */
  brandHex?: string | null;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Build the palette.
 *
 * Category B is spread in last and is not reachable from any input — see the
 * module comment.
 */
export function resolveReportPalette(
  input: ResolveReportPaletteInput = {},
): ResolvedReportPalette {
  const preset = input.preset && input.preset in PRESET_NEUTRALS ? input.preset : 'signature';
  const neutrals = PRESET_NEUTRALS[preset];

  const tenantBrand = typeof input.brandHex === 'string' && HEX.test(input.brandHex)
    ? input.brandHex.toUpperCase()
    : null;

  // Category A. The `on*` variants are always re-derived: storing them is how a
  // tenant ends up with a legible colour on one ground and an illegible one on
  // the other.
  //
  // `accentOnPaper` is legal on all three paper grounds, so it must be derived
  // against the WORST of them — the darkest, which gives dark type the least
  // contrast. Deriving against `paper` alone was a real bug: under the
  // `minimal_ink` preset `paper` is porcelain but `paperAlt` is champagne, and a
  // mid-grey tenant brand cleared the first and failed the second.
  const paperGrounds = [neutrals.paper, neutrals.paperAlt, neutrals.paperBright];
  const worstPaper = paperGrounds.reduce((worst, ground) =>
    relativeLuminanceFromHex(ground) < relativeLuminanceFromHex(worst) ? ground : worst);

  const accentFill = tenantBrand ?? PRINT_BRAND.base;
  const accentOnPaper = ensureContrast(
    tenantBrand ?? PRINT_BRAND.onPaper,
    worstPaper,
    CONTRAST_FLOOR.micro,
  );
  const accentOnField = tenantBrand
    ? ensureContrast(tenantBrand, neutrals.field, CONTRAST_FLOOR.display)
    : PRINT_BRAND.onField;

  return {
    ...neutrals,
    onFieldInk: PRINT_INK.onField,
    accentFill,
    accentOnPaper,
    accentOnField,
    // Category B — last, frozen, unreachable from `input`.
    ...PRINT_SEMANTIC,
  };
}

/**
 * Every way the resolved palette fails its own contract.
 *
 * Returns an empty array for a legal palette. Used by `printContrast.spec.ts`
 * and available at runtime so a render can refuse to ship an illegible
 * document rather than printing one.
 */
export function auditPaletteContrast(
  palette: ResolvedReportPalette,
): Array<{ role: string; ground: string; ratio: number; floor: number }> {
  const problems: Array<{ role: string; ground: string; ratio: number; floor: number }> = [];
  for (const [role, rule] of Object.entries(INK_LEGALITY)) {
    const fg = palette[role as keyof ResolvedReportPalette];
    const floor = CONTRAST_FLOOR[rule.floor];
    for (const ground of rule.grounds) {
      const bg = palette[ground as keyof ResolvedReportPalette];
      const ratio = contrastRatio(fg, bg);
      if (ratio < floor) problems.push({ role, ground, ratio, floor });
    }
  }
  return problems;
}
