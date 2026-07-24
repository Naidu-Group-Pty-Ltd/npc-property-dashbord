/**
 * PDF Template Builder — JSON schema (single source of truth).
 *
 * The same `ReportTemplate` JSON drives:
 *   - the visual editor (tldraw canvas + inspector)
 *   - the PDF renderer (jsPDF / pdf-lib)
 *
 * All positional values use **PDF points** (1pt = 1/72 inch).
 * A4 page = 595 × 842 pt.
 */
import { z } from 'zod';

// ─── Bindings ─────────────────────────────────────────────────────────────────
// A field can be a literal, a brand token, or a data path.
//   "Hello"                       → literal
//   "{{property.address}}"        → data binding
//   "{{financials.weeklyRent | currency}}"  → with filter
//   "token:primary"               → brand token reference
export const BindableStringSchema = z.string();
export const BindableColorSchema = z.string(); // "#hex" or "token:primary" or "{{...}}"
export const BindableNumberSchema = z.union([z.number(), z.string()]);

// ─── Tokens ───────────────────────────────────────────────────────────────────
// Phase 5 — fontFaces entry. Supports either a remote stylesheet (Google Fonts
// CSS URL) via `cssUrl`, or a direct font-file `src` for self-hosting.
export const FontFaceSchema = z.object({
  family: z.string(),                     // e.g. "Playfair Display"
  cssUrl: z.string().optional(),          // https://fonts.googleapis.com/css2?...  (or data:)
  src: z.string().optional(),             // direct .woff2/.otf URL, OR a data: URL (R0 — embedded/captured font)
  weight: z.union([z.number(), z.string()]).optional(),
  style: z.enum(['normal', 'italic']).optional(),
  display: z.enum(['auto', 'swap', 'block', 'fallback', 'optional']).optional(),
  source: z.enum(['url', 'embedded']).optional(),   // 'embedded' = captured from a reference PDF/image (data: src)
});
export type FontFace = z.infer<typeof FontFaceSchema>;

export const ComputedFieldSchema = z.object({
  name: z.string().min(1),                 // exposed as data.@name or {{=name}}
  expr: z.string().min(1),                 // JS-like expression evaluated against data + tokens
  description: z.string().optional(),
  format: z.enum(['raw','currency','number','percent','date']).optional(),
});
export type ComputedField = z.infer<typeof ComputedFieldSchema>;

// ─── Reusable text styles (Section 3) ─────────────────────────────────────────
export const ParagraphStyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  basedOn: z.string().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.number(), z.enum(['normal','bold'])]).optional(),
  fontStyle: z.enum(['normal','italic']).optional(),
  color: z.string().optional(),
  align: z.enum(['left','center','right','justify']).optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  paragraphSpacing: z.number().optional(),
  paragraphIndent: z.number().optional(),
  textTransform: z.enum(['none','uppercase','lowercase','capitalize','small-caps']).optional(),
  textDecoration: z.enum(['none','underline','line-through','overline']).optional(),
  ligatures: z.enum(['none','common','discretionary','historical','contextual','all']).optional(),
  fontFeatureSettings: z.string().optional(),
  fontVariantNumeric: z.enum(['normal','lining-nums','oldstyle-nums','tabular-nums','proportional-nums']).optional(),
  columns: z.number().int().min(1).max(6).optional(),
  columnGap: z.number().optional(),
});
export type ParagraphStyle = z.infer<typeof ParagraphStyleSchema>;

export const CharacterStyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  fontFamily: z.string().optional(),
  fontWeight: z.union([z.number(), z.enum(['normal','bold'])]).optional(),
  fontStyle: z.enum(['normal','italic']).optional(),
  color: z.string().optional(),
  letterSpacing: z.number().optional(),
  textTransform: z.enum(['none','uppercase','lowercase','capitalize','small-caps']).optional(),
  textDecoration: z.enum(['none','underline','line-through','overline']).optional(),
});
export type CharacterStyle = z.infer<typeof CharacterStyleSchema>;

export const ExportPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  variant: z.string(),
  tagged: z.boolean().optional(),
  optimizeImages: z.boolean().optional(),
  mode: z.enum(['preview','final']).optional(),
  themeId: z.string().optional(),
  pageRange: z.string().optional(),
  includeBookmarks: z.boolean().optional(),
});
export type ExportPreset = z.infer<typeof ExportPresetSchema>;

export const TokensSchema = z.object({
  colors: z.record(z.string()).default({}),
  fonts: z.record(z.string()).default({}),
  spacing: z.record(z.number()).default({}),
  radii: z.record(z.number()).optional(),
  shadows: z.record(z.string()).optional(),
  gradients: z.record(z.string()).optional(),
  typeScale: z.record(z.number()).optional(),
  brandKitId: z.string().uuid().optional(),
  activeTheme: z.enum(['light','dark','print','custom']).optional(),
  fontFaces: z.array(FontFaceSchema).optional(),
  computed: z.array(ComputedFieldSchema).optional(),
  // Section 3 — reusable text styles
  paragraphStyles: z.record(ParagraphStyleSchema).optional(),
  characterStyles: z.record(CharacterStyleSchema).optional(),
  // Section 8 — saved export pipeline presets
  exportPresets: z.array(ExportPresetSchema).optional(),
}).default({ colors: {}, fonts: {}, spacing: {} });


export type Tokens = z.infer<typeof TokensSchema>;

// ─── Interaction (Phase 8) ─────────────────────────────────────────────────────
// Links can be: external URL ("https://…"), internal page ("page:<pageId>"),
// or named anchor ("anchor:<name>"). Resolved at render time.
export const LinkSchema = z.object({
  href: BindableStringSchema,                           // url, page:<id>, anchor:<name>
  target: z.enum(['_self','_blank']).optional(),
  title: BindableStringSchema.optional(),
}).optional();

// Bookmark = a named destination for cross-linking + PDF outline entry.
export const BookmarkSchema = z.object({
  name: z.string().min(1),                              // unique within template, used in anchor:<name>
  label: BindableStringSchema.optional(),               // display label (TOC/outline)
  level: z.number().int().min(1).max(6).optional(),     // outline depth
  includeInToc: z.boolean().optional(),
}).optional();

// Phase 17 — overlay-level visual effects (shadow, blur, blend, outline).
// Renderer applies these as CSS box-shadow / filter / mix-blend-mode / outline.
export const OverlayEffectsSchema = z.object({
  shadow: z.object({
    x: z.number().default(0),
    y: z.number().default(2),
    blur: z.number().min(0).max(96).default(8),
    spread: z.number().default(0),
    color: z.string().default('rgba(0,0,0,0.25)'),
    inset: z.boolean().optional(),
  }).optional(),
  blur: z.number().min(0).max(48).optional(),                   // px
  brightness: z.number().min(0).max(3).optional(),              // 1 = normal
  contrast: z.number().min(0).max(3).optional(),
  saturate: z.number().min(0).max(3).optional(),
  grayscale: z.number().min(0).max(1).optional(),
  blendMode: z.enum([
    'normal','multiply','screen','overlay','darken','lighten',
    'color-dodge','color-burn','hard-light','soft-light','difference',
    'exclusion','hue','saturation','color','luminosity',
  ]).optional(),
  outline: z.object({
    color: z.string().default('#BF9B50'),
    width: z.number().min(0).max(24).default(2),
    style: z.enum(['solid','dashed','dotted','double']).default('solid'),
    offset: z.number().min(-12).max(24).default(0),
  }).optional(),
}).optional();
export type OverlayEffects = z.infer<typeof OverlayEffectsSchema>;


// ─── Report cascade anchors ───────────────────────────────────────────────────
// Semantic mapping between a report-structure section/field and the visual
// landing point in the PDF design. These are optional and additive: existing
// templates without anchors parse exactly as before, while new templates can
// explain how generated report output cascades into pages/blocks/overlays.
export const ReportAnchorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['section', 'field', 'repeat', 'slot', 'diagnostic']).default('field'),
  structureTemplateId: z.string().optional(),
  sectionId: z.string().optional(),
  fieldPath: z.string().optional(),
  bindingPath: z.string().optional(),
  label: z.string().optional(),
  required: z.boolean().optional(),
  qaStatus: z.enum(['unreviewed', 'approved', 'needs_changes', 'rejected']).optional(),
  qaOwner: z.string().optional(),
  qaNote: z.string().optional(),
  qaReviewedAt: z.string().optional(),
  renderMode: z.enum(['replace', 'append', 'overlay', 'repeat', 'conditional']).optional(),
  visibility: z.enum(['designer', 'debug_pdf', 'hidden_final']).optional(),
}).refine((a) => Boolean(a.sectionId || a.fieldPath || a.bindingPath), {
  message: 'Anchor must reference a sectionId, fieldPath, or bindingPath',
});
export type ReportAnchor = z.infer<typeof ReportAnchorSchema>;

// ─── Overlays (free-floating shapes inside a page) ────────────────────────────
const BaseOverlay = z.object({
  id: z.string(),
  x: z.number(),       // pt
  y: z.number(),       // pt — origin top-left of page
  width: z.number(),
  height: z.number(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  conditional: z.string().optional(),  // e.g. "tier === 'compass'"
  link: LinkSchema,
  bookmark: BookmarkSchema,
  anchors: z.array(ReportAnchorSchema).optional(),
  // Layout & Structure (Sections 1+2) — editor-only flags, additive/optional
  locked: z.boolean().optional(),         // selectable but immovable
  hidden: z.boolean().optional(),         // skip render + hide in canvas
  groupId: z.string().optional(),         // overlays sharing groupId move together
  zIndex: z.number().int().optional(),    // overlay stacking within its block
  name: z.string().optional(),            // designer label (Layers panel)
  // Import extraction confidence (0–1). Set by the import pipelines; low-
  // confidence elements arrive locked so unreliable extractions cannot be
  // nudged accidentally — unlock from the Layers panel to edit anyway.
  confidence: z.number().min(0).max(1).optional(),
  effects: OverlayEffectsSchema,
  constraints: z.object({                 // pinning for responsive paper-size changes
    left: z.boolean().optional(),
    right: z.boolean().optional(),
    top: z.boolean().optional(),
    bottom: z.boolean().optional(),
    centerH: z.boolean().optional(),
    centerV: z.boolean().optional(),
    width: z.enum(['fixed', 'scale']).optional(),
    height: z.enum(['fixed', 'scale']).optional(),
  }).optional(),
});



export const TextOverlaySchema = BaseOverlay.extend({
  type: z.literal('text'),
  content: BindableStringSchema,
  fontFamily: BindableStringSchema.default('Helvetica'),
  fontSize: BindableNumberSchema.default(12),
  fontWeight: z.preprocess((value) => {
    if (value === 'bold' || value === 'normal') return value;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric >= 600 ? 'bold' : 'normal';
    return 'normal';
  }, z.enum(['normal', 'bold'])).default('normal'),
  fontStyle: z.enum(['normal', 'italic']).default('normal'),
  color: BindableColorSchema.default('#000000'),
  align: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  lineHeight: z.number().default(1.3),
  letterSpacing: z.number().default(0),
  // Phase 5 — advanced typography (all optional, additive)
  rich: z.boolean().optional(),                                   // interpret content as HTML
  // Reconstruction (R0) — precise weight + per-run styling captured from a source PDF/image.
  fontWeightNumeric: z.number().int().min(100).max(900).optional(), // exact weight (renderer prefers this)
  runs: z.array(z.object({
    text: z.string(),
    fontFamily: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.union([z.number(), z.enum(['normal', 'bold'])]).optional(),
    fontStyle: z.enum(['normal', 'italic']).optional(),
    color: BindableColorSchema.optional(),
    letterSpacing: z.number().optional(),
  })).optional(),                                                 // rich-text runs: per-span color/font/weight
  textDecoration: z.enum(['none','underline','line-through','overline']).optional(),
  textTransform: z.enum(['none','uppercase','lowercase','capitalize','small-caps']).optional(),
  textShadow: z.string().optional(),                              // raw CSS
  whiteSpace: z.enum(['normal','nowrap','pre','pre-wrap','pre-line']).optional(),
  hyphens: z.enum(['none','manual','auto']).optional(),
  columns: z.number().int().min(1).max(6).optional(),
  columnGap: z.number().min(0).max(96).optional(),
  paragraphIndent: z.number().min(0).max(96).optional(),          // pt — first-line indent
  paragraphSpacing: z.number().min(0).max(96).optional(),         // pt — gap between <p>
  verticalAlign: z.enum(['top','middle','bottom']).optional(),
  maxLines: z.number().int().min(1).max(50).optional(),           // -webkit-line-clamp
  paddingTop: z.number().min(0).max(96).optional(),
  paddingRight: z.number().min(0).max(96).optional(),
  paddingBottom: z.number().min(0).max(96).optional(),
  paddingLeft: z.number().min(0).max(96).optional(),
  // OpenType
  kerning: z.boolean().optional(),                                // font-kerning
  ligatures: z.enum(['none','common','discretionary','historical','contextual','all']).optional(),
  fontVariantNumeric: z.enum(['normal','lining-nums','oldstyle-nums','tabular-nums','proportional-nums']).optional(),
  fontFeatureSettings: z.string().optional(),                     // raw, advanced override
  fontVariationSettings: z.string().optional(),                   // variable axes
  // ── E5 (typography-fidelity) additive, OPTIONAL, backward-compatible metadata ──
  // Links this native text overlay back to its immutable source typography runs
  // + selected font asset + resolution/preservation state, so the review UI + E0
  // can reconcile it with the fidelity report. Bounded metadata only — never
  // source paragraph text, never a signed URL, never font bytes.
  sourceTypographyRunIds: z.array(z.string()).optional(),
  fontAssetId: z.string().optional(),
  fontResolutionState: z.enum(['exact','embedded-subset','metric-compatible','source-crop','unavailable']).optional(),
  baselineShift: z.number().optional(),
  wordSpacing: z.number().optional(),
  typographyPreservation: z.object({
    version: z.string(),
    renderMode: z.enum(['verified-native-text','source-text-crop','containment-fallback','blocked']).optional(),
    fidelityState: z.string().optional(),
    fidelityScore: z.number().nullable().optional(),
    hardDefectCodes: z.array(z.string()).optional(),
    fontResolutionState: z.string().optional(),
    manualReviewRequired: z.boolean().optional(),
    sourceCropPath: z.string().nullable().optional(),
  }).optional(),
  // Section 3 — reference a paragraph style (overlay-level fields still win)
  styleRef: z.string().optional(),
  // Section 3 — drop cap (rendered as a floated span on the first character)
  dropCap: z.object({
    enabled: z.boolean().default(true),
    lines: z.number().min(2).max(8).default(3),
    color: z.string().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.union([z.number(), z.string()]).optional(),
    marginRight: z.number().min(0).max(48).optional(),
  }).optional(),
  // Baseline alignment — snap top to baseline grid in pt
  snapToBaseline: z.boolean().optional(),
});

export const TextOnPathOverlaySchema = BaseOverlay.extend({
  type: z.literal('textOnPath'),
  content: BindableStringSchema,
  fontFamily: BindableStringSchema.default('Helvetica'),
  fontSize: BindableNumberSchema.default(18),
  fontWeight: z.enum(['normal','bold']).default('normal'),
  color: BindableColorSchema.default('#000000'),
  curve: z.enum(['arc-up','arc-down','wave','circle']).default('arc-up'),
  curvature: z.number().min(-1).max(1).default(0.5),
  letterSpacing: z.number().default(0),
  startOffset: z.number().min(0).max(100).default(0),    // percent along path
});

export const TableColumnSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  width: z.number().optional(),          // pt; omit for auto
  align: z.enum(['left','center','right']).optional(),
  format: z.enum(['raw','currency','number','percent','date']).optional(),
});

export const TableOverlaySchema = BaseOverlay.extend({
  type: z.literal('table'),
  // Bound data path (resolves to an array of objects). Falls back to `rows`.
  data: z.string().optional(),
  columns: z.array(TableColumnSchema).default([]),
  rows: z.array(z.array(z.string())).optional(),       // static fallback when no `data`
  showHeader: z.boolean().default(true),
  headerHeight: z.number().default(22),
  rowHeight: z.number().default(20),
  fontFamily: BindableStringSchema.optional(),
  fontSize: z.number().default(10),
  headerBg: BindableColorSchema.optional(),
  headerColor: BindableColorSchema.optional(),
  headerFontWeight: z.enum(['normal','bold']).default('bold'),
  rowBg: BindableColorSchema.optional(),
  altRowBg: BindableColorSchema.optional(),
  rowColor: BindableColorSchema.optional(),
  borderColor: BindableColorSchema.optional(),
  borderWidth: z.number().default(0.5),
  cellPadding: z.number().default(6),
  maxRows: z.number().int().min(1).max(500).optional(),
  // Per-cell style overrides keyed by row (0-based, header is row -1) + col.
  cellStyles: z.array(z.object({
    row: z.number().int(),
    col: z.number().int(),
    bg: z.string().optional(),
    color: z.string().optional(),
    fontWeight: z.enum(['normal','bold']).optional(),
    align: z.enum(['left','center','right']).optional(),
  })).optional(),
  // Structural spans from source parsers (Docling TableStructurePrediction).
  // Renderers that don't support spans can still use `rows` as a graceful fallback.
  cellSpans: z.array(z.object({
    row: z.number().int(),
    col: z.number().int(),
    rowSpan: z.number().int().min(1).default(1),
    colSpan: z.number().int().min(1).default(1),
  })).optional(),
  // Phase 17 — conditional cell rules (data-driven highlighting).
  // Evaluated per-cell against the bound row. First match wins.
  cellRules: z.array(z.object({
    column: z.string(),                                                // column key
    op: z.enum(['>','>=','<','<=','==','!=','contains','empty','nonempty']),
    value: z.union([z.number(), z.string()]).optional(),
    scope: z.enum(['cell','row']).default('cell').optional(),
    bg: z.string().optional(),
    color: z.string().optional(),
    fontWeight: z.enum(['normal','bold']).optional(),
    icon: z.enum(['none','up','down','flag','star','dot']).optional(),
  })).optional(),
  // ── E4 (table-arbitration) additive, OPTIONAL, backward-compatible metadata ──
  // Links this native table back to its immutable E1 source table region so the
  // review UI + E0 can reconcile it with the arbitration result. Never a URL.
  sourceTableRegionId: z.string().optional(),
  // How the native layout was derived. 'source-derived' when column widths/header
  // policy came from the source topology; 'auto' otherwise. Informational.
  fitPolicy: z.enum(['source-derived','auto']).optional(),
  // Right-align numeric columns only when source evidence supports it.
  numericAlignment: z.boolean().optional(),
  // Bounded readable floor for deterministic font fitting (never below this).
  minFontSize: z.number().optional(),
  // Bounded E4 audit summary (counts/codes/enums only — never source text, never
  // a signed URL). Lets the renderer/review know whether this native table was
  // integrity-verified or is a placeholder pending source-crop preservation.
  tablePreservation: z.object({
    version: z.string(),
    renderMode: z.enum(['verified-native-table','table-source-crop','containment-fallback','blocked']).optional(),
    integrityState: z.string().optional(),
    integrityScore: z.number().nullable().optional(),
    hardDefectCodes: z.array(z.string()).optional(),
    genericHeaderInSource: z.boolean().optional(),
    hasSourceHeaders: z.boolean().optional(),
    manualReviewRequired: z.boolean().optional(),
    selectedCandidateId: z.string().nullable().optional(),
    sourceCropPath: z.string().nullable().optional(),
  }).optional(),
});

export const ImageOverlaySchema = BaseOverlay.extend({
  type: z.literal('image'),
  src: BindableStringSchema,
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  // Manual crop, expressed as percent (0–100) of the source image trimmed
  // from each edge before fit/positioning is applied.
  crop: z.object({
    left: z.number().min(0).max(100).default(0),
    right: z.number().min(0).max(100).default(0),
    top: z.number().min(0).max(100).default(0),
    bottom: z.number().min(0).max(100).default(0),
  }).optional(),
});

export const ShapeOverlaySchema = BaseOverlay.extend({
  type: z.literal('shape'),
  shape: z.enum(['rect', 'line', 'ellipse']).default('rect'),
  fill: BindableColorSchema.optional(),
  stroke: BindableColorSchema.optional(),
  strokeWidth: z.number().default(0),
  borderRadius: z.number().default(0),
});

// Reconstruction (R0) — editable vector geometry (icons/logos/dividers captured as SVG paths).
export const VectorPathSchema = z.object({
  d: z.string(),                                  // SVG path data
  fill: BindableColorSchema.optional(),
  stroke: BindableColorSchema.optional(),
  strokeWidth: z.number().optional(),
  fillRule: z.enum(['nonzero', 'evenodd']).optional(),
  opacity: z.number().min(0).max(1).optional(),
  // Phase 6E — stroke styling captured from the source vector (dashed rules,
  // rounded caps/joins). Optional so older templates parse unchanged.
  strokeDasharray: z.string().optional(),
  strokeLinecap: z.enum(['butt', 'round', 'square']).optional(),
  strokeLinejoin: z.enum(['miter', 'round', 'bevel']).optional(),
});
export type VectorPath = z.infer<typeof VectorPathSchema>;

export const VectorOverlaySchema = BaseOverlay.extend({
  type: z.literal('vector'),
  viewBox: z.string().default('0 0 100 100'),
  preserveAspectRatio: z.string().optional(),     // default xMidYMid meet
  paths: z.array(VectorPathSchema).default([]),
});

export const OverlaySchema = z.discriminatedUnion('type', [
  TextOverlaySchema,
  ImageOverlaySchema,
  ShapeOverlaySchema,
  TextOnPathOverlaySchema,
  TableOverlaySchema,
  VectorOverlaySchema,
]);

export type Overlay = z.infer<typeof OverlaySchema>;

// ─── Blocks ───────────────────────────────────────────────────────────────────
// A "block" is a structured, reusable unit (hero, table, disclaimer, ...).
// Each block has its own `props` shape, validated by the block registry.
// `overlays[]` sit on top of the block (free-form text/image/shape).
// Phase 4 — Block-level style/decoration (additive, all optional).
export const BlockStyleSchema = z.object({
  // Decoration (rendered as a backdrop behind the block bounds)
  backgroundColor: BindableColorSchema.optional(),
  borderColor: BindableColorSchema.optional(),
  borderWidth: z.number().min(0).max(8).optional(),    // pt
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  borderRadius: z.number().min(0).max(48).optional(),  // pt
  shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']).optional(),
  // Padding inset for the decoration backdrop (pt)
  paddingTop: z.number().min(0).max(96).optional(),
  paddingRight: z.number().min(0).max(96).optional(),
  paddingBottom: z.number().min(0).max(96).optional(),
  paddingLeft: z.number().min(0).max(96).optional(),
  // Transform applied to the rendered group (block + overlays)
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().min(-360).max(360).optional(),  // deg
  zIndex: z.number().int().optional(),
}).optional();

// Phase 4 — Repeat from binding (render this block once per item).
export const BlockRepeatSchema = z.object({
  path: z.string().min(1),                      // e.g. "properties" → data.properties[]
  alias: z.string().optional(),                 // default "item" → exposed as data.{alias}
  max: z.number().int().min(1).max(50).optional(),
  spacing: z.number().min(0).max(400).optional(), // pt — vertical offset between repeats
}).optional();

// Phase 4 — Multi-rule visibility (compiles to conditional expression).
export const BlockVisibilitySchema = z.object({
  mode: z.enum(['always', 'when', 'unless']).default('always'),
  expr: z.string().optional(),                   // mirrors `conditional` semantics
}).optional();

export const BlockSchema = z.object({
  id: z.string(),
  type: z.string(),                              // 'disclaimer', 'hero', 'kpi-grid', 'free', ...
  props: z.record(z.unknown()).default({}),      // block-specific
  overlays: z.array(OverlaySchema).default([]),
  conditional: z.string().optional(),
  // Phase 4 additions — all optional, backwards compatible
  style: BlockStyleSchema,
  repeat: BlockRepeatSchema,
  visibility: BlockVisibilitySchema,
  locked: z.boolean().optional(),                // editor-only: prevent selection/drag
  hidden: z.boolean().optional(),                // skip render entirely
  name: z.string().optional(),                   // designer label (Outline)
  // Phase 8 — block-level interactions / outline
  link: LinkSchema,
  bookmark: BookmarkSchema,
  anchors: z.array(ReportAnchorSchema).optional(),
});


export type Block = z.infer<typeof BlockSchema>;

// ─── Pages ────────────────────────────────────────────────────────────────────
export const PageSizeSchema = z.object({
  width: z.number().default(595),   // A4 portrait pt
  height: z.number().default(842),
});

export const PageSchema = z.object({
  id: z.string(),
  name: z.string().default('Page'),
  size: PageSizeSchema.default({ width: 595, height: 842 }),
  background: z.object({
    color: BindableColorSchema.optional(),
    imageUrl: BindableStringSchema.optional(),
    // How the background image is sized. Full-page source rasters (PDF import)
    // must fill the exact page box — 'fill' (background-size:100% 100%) — so the
    // reference never crops/stretches. Decorative images default to 'cover'.
    imageFit: z.enum(['cover', 'contain', 'fill']).optional(),
    // PDF-import reference underlay: the source-page raster kept purely as an
    // alignment aid behind the reconstructed overlays. Rendered ONLY on the
    // editor canvas — preview/print/export renderers must skip it, otherwise
    // every text element prints twice (dim source ghost + editable overlay).
    underlay: z.boolean().optional(),
    // Phase 11 — optional gradient overlay/fill. When present and stops.length>0
    // the HTML renderer composites it above any solid color / image.
    gradient: z.object({
      type: z.enum(['linear', 'radial']).default('linear'),
      angle: z.number().min(0).max(360).default(180),  // deg — linear only
      stops: z.array(z.object({
        color: z.string(),                              // hex (8-digit allowed)
        position: z.number().min(0).max(100),
      })).default([]),
    }).optional(),
    opacity: z.number().min(0).max(1).optional(),       // page bg opacity
  }).default({}),
  blocks: z.array(BlockSchema).default([]),
  conditional: z.string().optional(),
  // Phase 2 — canvas/print furniture (all optional, additive)
  master: z.boolean().optional(),                   // true → reusable master/template page
  masterPageId: z.string().optional(),              // resolve master backdrop at render
  bleed: z.number().min(0).max(36).optional(),      // pt — print bleed
  safeArea: z.number().min(0).max(72).optional(),   // pt — content safe-area margin
  notes: z.string().optional(),                     // designer notes (not rendered)
  // Phase 5 — baseline grid (typography rhythm)
  baselineGrid: z.object({
    size: z.number().min(4).max(64).default(12),    // pt between baselines
    color: z.string().default('rgba(191,155,80,0.20)'),
    show: z.boolean().default(false),
    offset: z.number().min(0).max(72).default(0),
  }).optional(),
  // Phase 9 — page master + numbering overrides per page
  pageMasterId: z.string().optional(),
  numbering: z.object({
    startAt: z.number().int().min(1).optional(),
    restart: z.boolean().optional(),                  // restart counter on this page
    format: z.enum(['decimal','lower-roman','upper-roman','lower-alpha','upper-alpha']).optional(),
    prefix: BindableStringSchema.optional(),
    suffix: BindableStringSchema.optional(),
    hide: z.boolean().optional(),                     // suppress page number for this page
  }).optional(),
  // Phase 10 — per-page theme override (id into template.themes)
  themeId: z.string().optional(),
  // Phase 3 (PDF import) — opaque per-page metadata. Currently used to carry
  // `sourceRasterRef` (Storage path to the rasterised source page); renderers
  // resolve the signed URL on demand and never persist it back to the schema.
  meta: z.object({
    sourceRasterRef: z.object({
      kind: z.literal('pdf_import_raster_ref'),
      jobId: z.string(),
      manifestPath: z.string().nullable().optional(),
      pageNo: z.number(),
      path: z.string(),
      width: z.number(),
      height: z.number(),
      mime: z.string(),
      dpi: z.number().nullable().optional(),
    }).optional(),
    // C5 — pdf-page-output-policy-v1. Authoritative page output policy; the
    // legacy `background.underlay` flag is kept in sync for backward compat.
    pdfImport: z.object({
      version: z.literal('pdf-page-output-policy-v1'),
      finalMode: z.enum(['semantic', 'hybrid', 'pixel-perfect']),
      outputStrategy: z.enum(['native', 'raster-only']),
      sourceRasterRole: z.enum(['none', 'editor-reference', 'final-output']),
      nativeLayerPolicy: z.enum(['editable', 'locked']),
      decision: z.object({
        score: z.number().nullable(),
        action: z.string(),
        reason: z.string(),
        decidedAt: z.string(),
        decidedBy: z.enum(['quality-gate', 'operator', 'migration']),
      }).optional(),
    }).optional(),
    // ── E6 (pdf-region-output-policy-v1) additive, OPTIONAL, backward-compatible.
    // Bounded per-page region-composition summary + a reference to the private
    // region-output manifest. Never inlines source text, full crop maps, font
    // bytes or signed URLs. The page-level `pdfImport` policy stays authoritative
    // for page-wide raster/native output; region policy composes BENEATH it.
    pdfImportRegionOutput: z.object({
      version: z.literal('pdf-region-output-policy-v1'),
      manifestPath: z.string().nullable().optional(),
      automaticPolicyHash: z.string().optional(),
      activeOverrideIds: z.array(z.string()).optional(),
      summary: z.object({
        totalRegionCount: z.number().int().min(0),
        nativeRegionCount: z.number().int().min(0),
        sourceCropRegionCount: z.number().int().min(0),
        nativeReferenceRegionCount: z.number().int().min(0),
        hiddenSemanticRegionCount: z.number().int().min(0),
        pageFallbackRegionCount: z.number().int().min(0),
        blockedRegionCount: z.number().int().min(0),
        operatorOverrideCount: z.number().int().min(0),
        hardDefectCount: z.number().int().min(0),
        mixedRegionOutput: z.boolean(),
      }).optional(),
      complete: z.boolean().optional(),
      problems: z.array(z.string()).optional(),
    }).optional(),
  }).passthrough().optional(),
});


export type Page = z.infer<typeof PageSchema>;

// ─── Top-level template ───────────────────────────────────────────────────────
export const ReportTemplateSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().optional(),
  tokens: TokensSchema,
  pages: z.array(PageSchema).default([]),
  /**
   * Reusable component slots (Header / Footer / etc.). Pages reference a slot
   * via a `slot` block whose `props.slotKey` matches a key here. Edit once,
   * applied wherever referenced.
   */
  slots: z.record(BlockSchema).default({}),
  // Phase 9 — Page Masters (running headers/footers via @page margin boxes)
  pageMasters: z.record(z.object({
    id: z.string(),
    name: z.string(),
    margins: z.object({
      top: z.number().min(0).max(200).default(36),
      right: z.number().min(0).max(200).default(36),
      bottom: z.number().min(0).max(200).default(36),
      left: z.number().min(0).max(200).default(36),
    }).default({ top: 36, right: 36, bottom: 36, left: 36 }),
    // 6 margin boxes; content is a bindable string. Supports {{pageNumber}}, {{pageCount}}
    // plus a tag {{pageCounter}} which uses the active numbering style.
    boxes: z.object({
      topLeft: BindableStringSchema.optional(),
      topCenter: BindableStringSchema.optional(),
      topRight: BindableStringSchema.optional(),
      bottomLeft: BindableStringSchema.optional(),
      bottomCenter: BindableStringSchema.optional(),
      bottomRight: BindableStringSchema.optional(),
    }).default({}),
    style: z.object({
      fontFamily: z.string().optional(),
      fontSize: z.number().min(6).max(24).optional(),
      color: BindableColorSchema.optional(),
      borderTop: z.boolean().optional(),
      borderBottom: z.boolean().optional(),
      borderColor: BindableColorSchema.optional(),
    }).optional(),
    numbering: z.object({
      format: z.enum(['decimal','lower-roman','upper-roman','lower-alpha','upper-alpha']).default('decimal'),
      startAt: z.number().int().min(1).optional(),
      prefix: BindableStringSchema.optional(),
      suffix: BindableStringSchema.optional(),
    }).optional(),
    // Hide running header/footer on the very first page (e.g. cover)
    suppressOnFirstPage: z.boolean().optional(),
  })).optional(),
  defaultPageMasterId: z.string().optional(),
  // Phase 10 — Themes (named partial-token overlays applied atop base tokens).
  themes: z.record(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    kind: z.enum(['light','dark','print','brand','custom']).optional(),
    swatch: z.array(z.string()).optional(),         // up to 4 hex chips for the picker
    tokens: z.object({
      colors: z.record(z.string()).optional(),
      fonts: z.record(z.string()).optional(),
      spacing: z.record(z.number()).optional(),
      radii: z.record(z.number()).optional(),
      shadows: z.record(z.string()).optional(),
      gradients: z.record(z.string()).optional(),
      typeScale: z.record(z.number()).optional(),
    }).default({}),
  })).optional(),
  activeThemeId: z.string().optional(),             // template-level active theme
  // Phase 2 — canvas preferences + saved selections
  canvas: z.object({
    gridSize: z.number().min(2).max(64).default(8),
    showGrid: z.boolean().default(false),
    showRulers: z.boolean().default(true),
    snapToGrid: z.boolean().default(false),
    showBleed: z.boolean().default(false),
    showSafeArea: z.boolean().default(false),
    showBaselineGrid: z.boolean().default(false),
  }).default({}).optional(),
  savedSelections: z.record(z.array(z.string())).optional(),
  // Phase 8 — document metadata, embedded as PDF info dictionary.
  meta: z.object({
    title: BindableStringSchema.optional(),
    author: BindableStringSchema.optional(),
    subject: BindableStringSchema.optional(),
    keywords: BindableStringSchema.optional(),
    lang: z.string().optional(),                  // BCP 47, e.g. "en-AU"
    creator: BindableStringSchema.optional(),
    pdfImport: z.object({
      engine: z.enum(['legacy', 'docling']),
      engineVersion: z.string().optional(),
      mode: z.string().optional(),
      diagnosticsPath: z.string().nullable().optional(),
      /** Legacy `rasters.json` path. Retained for backward-compat; never embedded. */
      rastersPath: z.string().nullable().optional(),
      legacyRastersPath: z.string().nullable().optional(),
      /** Phase 3 — lightweight Storage-backed raster manifest. */
      rastersManifestPath: z.string().nullable().optional(),
      /** Phase 3 — per-page PNG object paths (mirrors manifest order). */
      pageRasterPaths: z.array(z.string()).optional(),
      markdownPath: z.string().nullable().optional(),
      outlinePath: z.string().nullable().optional(),
      doctagsPath: z.string().nullable().optional(),
      jobId: z.string().optional(),
      importedAt: z.string().optional(),
      consumerGuardrailVersion: z.string().optional(),
      parseGuardrails: z.any().optional(),
      artifactGuardrails: z.any().optional(),
      parseArtifactContractVersion: z.any().optional(),
      doclingPageRebaseVersion: z.any().optional(),
      chunkMergeValidationVersion: z.any().optional(),
      terminalStateVersion: z.any().optional(),
    }).optional(),

  }).optional(),
});


export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;

// ─── Defaults / factories ─────────────────────────────────────────────────────
export const EMPTY_TEMPLATE: ReportTemplate = {
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [],
  slots: {},
};

export const DEFAULT_BRAND_TOKENS: Tokens = {
  colors: {
    primary: '#BF9B50',  // gold
    bg: '#141414',
    text: '#FFFFFF',
    muted: '#999999',
  },
  fonts: {
    heading: 'Helvetica',
    body: 'Helvetica',
  },
  spacing: { gutter: 16 },
};

export function makeBlankTemplate(): ReportTemplate {
  return {
    version: 1,
    tokens: DEFAULT_BRAND_TOKENS,
    pages: [
      {
        id: crypto.randomUUID(),
        name: 'Cover',
        size: { width: 595, height: 842 },
        background: { color: 'token:bg' },
        blocks: [],
      },
    ],
  };
}

/**
 * Back-compat: hybrid PDF imports created before `background.underlay` existed
 * persisted the dimmed source raster (opacity < 1, imageFit 'fill') with no
 * flag, so preview/print rendered a ghost copy of every text element behind
 * the reconstructed overlays. Tag those pages as underlays at parse time.
 * Explicit `underlay: false` (or any explicit value) is always respected.
 */
function normaliseImportUnderlays(template: ReportTemplate): ReportTemplate {
  for (const page of template.pages ?? []) {
    const bg = page.background as { imageUrl?: unknown; imageFit?: string; opacity?: number; underlay?: boolean } | undefined;
    if (!bg?.imageUrl || bg.underlay !== undefined) continue;
    const opacity = typeof bg.opacity === 'number' ? bg.opacity : 1;
    const isHybridImportPage = typeof page.notes === 'string'
      && page.notes.includes('Import Reconciliation Engine (hybrid)');
    if (isHybridImportPage && bg.imageFit === 'fill' && opacity < 1) bg.underlay = true;
  }
  return template;
}

/** Parse arbitrary JSON safely; returns EMPTY_TEMPLATE on failure. */
export function parseTemplate(input: unknown): ReportTemplate {
  const result = ReportTemplateSchema.safeParse(input);
  if (!result.success) {
    console.warn('[templateSchema] Failed to parse template, using empty', result.error.flatten());
    const fallback = salvageTemplate(input);
    return fallback ? normaliseImportUnderlays(fallback) : EMPTY_TEMPLATE;
  }
  return normaliseImportUnderlays(result.data);
}

function normaliseFontWeight(value: unknown): 'normal' | 'bold' {
  if (value === 'bold' || value === 'normal') return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 600 ? 'bold' : 'normal';
}

/** Best-effort recovery for older/AI-authored templates with minor schema drift. */
function salvageTemplate(input: unknown): ReportTemplate | null {
  if (!input || typeof input !== 'object') return null;
  try {
    const copy: any = JSON.parse(JSON.stringify(input));
    copy.version = 1;
    copy.tokens = copy.tokens && typeof copy.tokens === 'object' ? copy.tokens : DEFAULT_BRAND_TOKENS;
    copy.tokens.colors = copy.tokens.colors && typeof copy.tokens.colors === 'object' ? copy.tokens.colors : {};
    copy.tokens.fonts = copy.tokens.fonts && typeof copy.tokens.fonts === 'object' ? copy.tokens.fonts : {};
    copy.tokens.spacing = copy.tokens.spacing && typeof copy.tokens.spacing === 'object' ? copy.tokens.spacing : {};
    copy.slots = copy.slots && typeof copy.slots === 'object' ? copy.slots : {};
    copy.pages = Array.isArray(copy.pages) ? copy.pages : [];
    for (const page of copy.pages) {
      page.id = String(page.id || crypto.randomUUID());
      page.name = String(page.name || 'Page');
      page.size = {
        width: Number(page.size?.width) || 595,
        height: Number(page.size?.height) || 842,
      };
      page.background = page.background && typeof page.background === 'object' ? page.background : {};
      page.blocks = Array.isArray(page.blocks) ? page.blocks : [];
      for (const block of page.blocks) {
        block.id = String(block.id || crypto.randomUUID());
        block.type = String(block.type || 'free');
        block.props = block.props && typeof block.props === 'object' ? block.props : {};
        block.overlays = Array.isArray(block.overlays) ? block.overlays : [];
        for (const overlay of block.overlays) {
          overlay.id = String(overlay.id || crypto.randomUUID());
          overlay.x = Number(overlay.x) || 0;
          overlay.y = Number(overlay.y) || 0;
          overlay.width = Number(overlay.width) || 1;
          overlay.height = Number(overlay.height) || 1;
          overlay.rotation = Number(overlay.rotation) || 0;
          overlay.opacity = Math.min(1, Math.max(0, Number(overlay.opacity ?? 1)));
          if (overlay.type === 'text') {
            overlay.content = String(overlay.content ?? '');
            overlay.fontFamily = overlay.fontFamily ?? 'Helvetica';
            overlay.fontSize = overlay.fontSize ?? 12;
            overlay.fontWeight = normaliseFontWeight(overlay.fontWeight);
            overlay.fontStyle = overlay.fontStyle === 'italic' ? 'italic' : 'normal';
            overlay.color = overlay.color ?? '#000000';
            overlay.align = ['left', 'center', 'right', 'justify'].includes(overlay.align) ? overlay.align : 'left';
            overlay.lineHeight = Number(overlay.lineHeight) || 1.3;
            overlay.letterSpacing = Number(overlay.letterSpacing) || 0;
          } else if (overlay.type === 'shape') {
            overlay.shape = ['rect', 'line', 'ellipse'].includes(overlay.shape) ? overlay.shape : 'rect';
            overlay.strokeWidth = Number(overlay.strokeWidth) || 0;
            overlay.borderRadius = Number(overlay.borderRadius) || 0;
          } else if (overlay.type === 'image') {
            overlay.src = String(overlay.src ?? '');
            overlay.fit = ['cover', 'contain', 'fill'].includes(overlay.fit) ? overlay.fit : 'cover';
          } else if (overlay.type === 'textOnPath') {
            overlay.content = String(overlay.content ?? '');
            overlay.fontFamily = overlay.fontFamily ?? 'Helvetica';
            overlay.fontSize = Number(overlay.fontSize) || 18;
            overlay.color = overlay.color ?? '#000000';
            overlay.curve = ['arc-up','arc-down','wave','circle'].includes(overlay.curve) ? overlay.curve : 'arc-up';
            overlay.curvature = Number(overlay.curvature ?? 0.5);
            overlay.letterSpacing = Number(overlay.letterSpacing) || 0;
            overlay.startOffset = Number(overlay.startOffset) || 0;
            overlay.fontWeight = normaliseFontWeight(overlay.fontWeight);
          } else if (overlay.type === 'table') {
            overlay.columns = Array.isArray(overlay.columns) ? overlay.columns : [];
            overlay.showHeader = overlay.showHeader !== false;
            overlay.fontSize = Number(overlay.fontSize) || 10;
            overlay.borderWidth = Number(overlay.borderWidth ?? 0.5);
            overlay.cellPadding = Number(overlay.cellPadding ?? 6);
            overlay.headerHeight = Number(overlay.headerHeight ?? 22);
            overlay.rowHeight = Number(overlay.rowHeight ?? 20);
            overlay.headerFontWeight = overlay.headerFontWeight === 'normal' ? 'normal' : 'bold';
          }
        }
      }
    }
    const retried = ReportTemplateSchema.safeParse(copy);
    if (!retried.success) {
      console.warn('[templateSchema] Salvage failed', retried.error.flatten());
      return null;
    }
    return retried.data;
  } catch (error) {
    console.warn('[templateSchema] Salvage threw', error);
    return null;
  }
}
