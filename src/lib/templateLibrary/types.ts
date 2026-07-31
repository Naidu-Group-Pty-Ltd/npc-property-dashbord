/**
 * Template Library — type declarations.
 *
 * Types only. This module emits no runtime code, has no imports with side
 * effects, and is imported by nothing yet. It exists so the shapes agreed in
 * `docs/template-library/02-architecture.md` are reviewable and reusable before
 * any table, endpoint or component is built.
 *
 * The contract these types describe:
 *   - A `TemplateLibraryEntry` is CATALOGUE data. It is never a row in
 *     `report_templates` and is never resolvable by
 *     `resolve_report_template()`.
 *   - "Use template" performs a snapshot copy into `report_templates` through
 *     the existing `manage-templates` broker, and records the lineage in
 *     `TemplateLibraryInstantiation`.
 *   - Nothing here alters, extends or re-declares any existing Builder type.
 *     `ReportTemplate` from `@/lib/reportTemplate/templateSchema` remains the
 *     single source of truth for template payloads; it is referenced as an
 *     opaque payload here so this module stays free of runtime coupling.
 *
 * See ADR 017 for why the separation exists.
 */

/** Publication lifecycle. Only `published` entries are visible to non-superadmins. */
export type TemplateLibraryStatus =
  | 'draft'
  | 'in_review'
  | 'published'
  | 'deprecated'
  | 'archived';

/** Top-level grouping, mirroring the existing report format groups. */
export type TemplateLibraryCategory =
  | 'investment'
  | 'suburb'
  | 'postcode'
  | 'statewide'
  | 'comparison'
  | 'cash_flow'
  | 'client_form'
  | 'compliance';

export type TemplateLibraryStyle =
  | 'corporate'
  | 'editorial'
  | 'minimal'
  | 'luxury'
  | 'technical';

export type TemplateLibraryOrientation = 'portrait' | 'landscape';

/** Commercial tier. Maps onto plan entitlements when premium packs are introduced. */
export type TemplateLibraryAccessTier = 'standard' | 'premium' | 'enterprise';

/**
 * Audience scope.
 *
 * Only `'global'` is reachable today: this codebase has no organisation,
 * tenant or agency table, and `report_templates.agency_id` is an orphan column
 * with no membership relation (see migration
 * `20260726143000_scope_report_template_reads.sql`). `'agency'` is declared so
 * the shape does not change when a tenancy model arrives — it must not be
 * treated as working tenant isolation before then. Decision D1.
 */
export type TemplateLibraryVisibility = 'global' | 'agency';

/**
 * The template payload, structurally identical to `report_templates.schema`.
 * Kept opaque so this module has no runtime dependency on the Builder's Zod
 * schema; consumers narrow it with `parseTemplate()` at the boundary.
 */
export type TemplateLibrarySchemaPayload = unknown;

/** Why an entry may not be usable for live report generation. */
export interface TemplateLibraryCompatibility {
  /**
   * True when the report type has a production adapter AND every block type is
   * in the renderer's production allow-list. False entries can still be copied
   * and edited — they simply cannot be activated. Decision D2.
   */
  productionReady: boolean;
  /** Block types present in the schema. */
  supportedModules: string[];
  /** Binding paths the template expects, e.g. `property.address`. */
  requiredBindings: string[];
  /** False when the schema hard-codes colours instead of using brand tokens. */
  brandSafe: boolean;
  /** `SUPPORTED_TEMPLATE_SCHEMA_VERSION` at publish time. */
  compatibilityVersion: number;
  /** Renderer the entry is authored against. */
  engine: 'weasyprint' | 'jspdf';
}

/** A master catalogue entry. Immutable once published — a change is a new version. */
export interface TemplateLibraryEntry {
  id: string;
  /** Stable across every version of the same template. */
  familyId: string;
  /** Stable public identifier; unique per (slug, version). */
  slug: string;
  version: number;

  name: string;
  description: string | null;
  longDescription: string | null;

  category: TemplateLibraryCategory;
  /** Must match the `report_templates.report_type` vocabulary. */
  reportType: string | null;
  tier: string | null;
  variant: string | null;
  industry: string[];
  tags: string[];
  style: TemplateLibraryStyle | null;

  orientation: TemplateLibraryOrientation;
  pageSize: string;
  pageCount: number;

  status: TemplateLibraryStatus;
  accessTier: TemplateLibraryAccessTier;
  visibility: TemplateLibraryVisibility;

  compatibility: TemplateLibraryCompatibility;

  /**
   * Storage paths in the public preview bucket — never signed URLs.
   * `render-template-pdf` returns 24-hour signed URLs; persisting one produces
   * a catalogue of broken images the following day.
   */
  thumbnailPath: string | null;
  previewImagePaths: string[];

  /** The Builder template this entry was promoted from, if any. */
  sourceTemplateId: string | null;
  /** A `custom_users.id`. Deliberately NOT named `createdBy`: the
   *  `report_templates.created_by` column is a foreign key to `auth.users`,
   *  which custom-auth ids are not in. */
  createdByUserId: string | null;

  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deprecatedAt: string | null;

  usageCount: number;
  lastUsedAt: string | null;
}

/**
 * List projection. Deliberately omits the heavy `schema` payload.
 *
 * The Builder list learned this the hard way — see the comment on
 * `ReportTemplateListRow` in `src/hooks/useReportTemplates.ts`: templates
 * created from PDF imports carry multi-hundred-MB schemas, and selecting them
 * for every row blows past the Postgres statement timeout. Library list queries
 * must never `select('*')`.
 */
export type TemplateLibraryListEntry = Omit<TemplateLibraryEntry, never> & {
  /** Trimmed page-1 schema, enough to draw an SVG card thumbnail. */
  previewSchema?: TemplateLibrarySchemaPayload | null;
};

/** Full entry including the payload. Fetched only on preview or copy. */
export interface TemplateLibraryEntryDetail extends TemplateLibraryEntry {
  schema: TemplateLibrarySchemaPayload;
  /** `report_templates.config` is NOT NULL, so a copy always needs a value. */
  config: Record<string, unknown>;
  customCss: string | null;
}

/** Lineage from a library entry to a working copy in `report_templates`. */
export interface TemplateLibraryInstantiation {
  id: string;
  entryId: string;
  /** The exact entry version copied. Copies are snapshots, never live links. */
  entryVersionAtCopy: number;
  /** Null once the working copy is deleted — usage history outlives the copy. */
  templateId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

/** Browse-grid query state. Filters compose as AND across axes, OR within one. */
export interface TemplateLibraryFilters {
  search: string;
  categories: TemplateLibraryCategory[];
  reportTypes: string[];
  industries: string[];
  styles: TemplateLibraryStyle[];
  orientations: TemplateLibraryOrientation[];
  /** Restrict to entries that can be activated for live report generation. */
  productionReadyOnly: boolean;
}

/** Input for "Use template". */
export interface CreateWorkingCopyInput {
  entryId: string;
  /** User-supplied; required and non-empty. */
  name: string;
  description?: string;
}

/** Result of a successful copy. `templateId` is an ordinary Builder template. */
export interface CreateWorkingCopyResult {
  templateId: string;
  instantiationId: string;
}
