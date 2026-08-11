/**
 * Template Library — pure decision logic, Deno-free.
 *
 * Everything here is a total function over plain data: no Deno APIs, no
 * network, no Supabase client. That is deliberate. The rules encoded below are
 * the ones that decide whether a template can reach a customer's report, and a
 * source-scanning test can only prove a literal has not changed — it cannot
 * prove the control flow still holds. Keeping the rules here lets the frontend
 * test suite execute them directly, the same way
 * `claudeReconstruct.pure.ts` and `pdfCacheContract.pure.ts` already are.
 *
 * `manage-template-library/index.ts` is the I/O shell around this module.
 */
import { SUPPORTED_TEMPLATE_SCHEMA_VERSION } from './templateSchemaVersion.ts';
import {
  PRODUCTION_SAFE_BLOCK_TYPES,
  PRODUCTION_REPORT_TEMPLATE_TYPES,
} from './productionBlockTypes.ts';
import {
  applyColourwayToSchema,
  defaultColourwayFor,
  findColourway,
  type ApprovedColourway,
} from './templateColourways.pure.ts';

// ── Operations and authorisation ─────────────────────────────────────────────

export type LibraryOperation =
  | 'list' | 'get' | 'instantiate' | 'promote' | 'save_draft'
  | 'publish' | 'deprecate' | 'archive' | 'restore' | 'events';

export type RequiredAuthz =
  | { kind: 'module'; permission: 'can_view' | 'can_edit' }
  | { kind: 'superadmin' };

const READ_OPERATIONS: ReadonlySet<string> = new Set(['list', 'get']);
const EDIT_OPERATIONS: ReadonlySet<string> = new Set(['instantiate']);

/**
 * What an operation requires. Deny-by-default: anything not explicitly a read
 * or an edit is a control-plane action, so a NEW operation is superadmin-only
 * until somebody deliberately lowers it.
 */
export function requiredAuthzFor(operation: string): RequiredAuthz {
  if (READ_OPERATIONS.has(operation)) return { kind: 'module', permission: 'can_view' };
  if (EDIT_OPERATIONS.has(operation)) return { kind: 'module', permission: 'can_edit' };
  return { kind: 'superadmin' };
}

/**
 * Columns returned by `list`. Never includes the heavy `schema` payload.
 *
 * `design_meta` is small — a manifest of ~21 short strings plus ten colourway
 * ids — and the browse card reads family, variant axis, density, ground and
 * recommended use straight off it, so leaving it out would cost one detail
 * fetch per visible card.
 */
export const LIST_COLUMNS: readonly string[] = [
  'id', 'family_id', 'slug', 'version', 'name', 'description',
  'category', 'report_type', 'tier', 'variant', 'industry', 'tags', 'style',
  'orientation', 'page_size', 'page_count',
  'preview_schema', 'thumbnail_path', 'preview_image_paths',
  'supported_modules', 'required_bindings', 'brand_safe', 'production_ready',
  'compatibility_version', 'status', 'access_tier', 'visibility', 'engine',
  'source_template_id', 'created_at', 'updated_at', 'published_at',
  'usage_count', 'last_used_at', 'design_meta',
];

export const LIST_SELECT = LIST_COLUMNS.join(',');

// ── Schema inspection ────────────────────────────────────────────────────────

export function pagesOf(schema: unknown): any[] {
  const pages = (schema as any)?.pages;
  return Array.isArray(pages) ? pages : [];
}

/** Distinct block types used anywhere in the template, sorted. */
export function blockTypesOf(schema: unknown): string[] {
  const types = new Set<string>();
  for (const page of pagesOf(schema)) {
    for (const block of Array.isArray(page?.blocks) ? page.blocks : []) {
      const t = String(block?.type ?? '').trim();
      if (t) types.add(t);
    }
  }
  return [...types].sort();
}

export function unsupportedBlocks(schema: unknown): string[] {
  return blockTypesOf(schema).filter((t) => !PRODUCTION_SAFE_BLOCK_TYPES.has(t));
}

/**
 * Every `{{path}}` referenced in the template, filters stripped and sorted.
 *
 * `{{=name}}` is a computed field evaluated from other data, not a binding the
 * report has to supply, so it is excluded — listing it would tell a user to
 * provide something the template calculates for itself.
 */
export function requiredBindingsOf(schema: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)) {
        const path = m[1].trim();
        if (path && !path.startsWith('=')) found.add(path);
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(schema);
  return [...found].sort();
}

const COLOUR_KEY = /(colou?r|fill|stroke|bg|background|accent|shadow|border)/i;
const COLOUR_LITERAL = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;

/**
 * True when no colour is hard-coded, so a partner brand applies in full.
 *
 * `token:*` and `{{binding}}` values are brand-safe by definition. The
 * `tokens` map is skipped — literal colours are exactly what a token
 * definition is for, and flagging them would make every template unsafe.
 */
export function isBrandSafe(schema: unknown): boolean {
  let safe = true;
  const walk = (node: unknown, key?: string): void => {
    if (!safe) return;
    if (typeof node === 'string') {
      if (key && COLOUR_KEY.test(key) && COLOUR_LITERAL.test(node.trim())) safe = false;
      return;
    }
    if (Array.isArray(node)) { node.forEach((v) => walk(v, key)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  };
  const { tokens: _skip, ...rest } = (schema && typeof schema === 'object' ? schema : {}) as Record<string, unknown>;
  walk(rest);
  return safe;
}

/**
 * Whether a copy of this template could ever be activated for live report
 * generation. Both conditions are enforced elsewhere by `manage-templates`;
 * evaluating them here is what lets the library say so on the card instead of
 * letting a user find out from a 422 after an afternoon of edits.
 */
export function isProductionReady(reportType: unknown, schema: unknown): boolean {
  const key = String(reportType ?? '').trim().toLowerCase();
  if (!key || !PRODUCTION_REPORT_TEMPLATE_TYPES.has(key)) return false;
  return unsupportedBlocks(schema).length === 0;
}

/** Page-1-only schema with base64 payloads stripped, for the SVG card thumbnail. */
export function buildPreviewSchema(schema: unknown): unknown {
  const first = pagesOf(schema)[0];
  if (!first) return null;
  const strip = (node: unknown): unknown => {
    if (typeof node === 'string') return node.startsWith('data:') ? '' : node;
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, strip(v)]));
    }
    return node;
  };
  return {
    version: SUPPORTED_TEMPLATE_SCHEMA_VERSION,
    tokens: (schema as any)?.tokens ?? {},
    pages: [strip(first)],
  };
}

export function slugify(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'template';
}

// ── Derived facts ────────────────────────────────────────────────────────────

export interface DerivedEntryFacts {
  page_count: number;
  supported_modules: string[];
  required_bindings: string[];
  brand_safe: boolean;
  production_ready: boolean;
  compatibility_version: number;
  orientation: 'portrait' | 'landscape';
  preview_schema: unknown;
}

/**
 * Recompute every derived field from the schema.
 *
 * Always called server-side on write, never populated from the request body: a
 * caller that could set `production_ready` could make a preview-only template
 * claim it drives live reports.
 */
export function deriveEntryFacts(entry: Record<string, unknown>): DerivedEntryFacts {
  const schema = entry?.schema ?? {};
  const first = pagesOf(schema)[0];
  const width = Number(first?.size?.width ?? 595);
  const height = Number(first?.size?.height ?? 842);
  return {
    page_count: pagesOf(schema).length,
    supported_modules: blockTypesOf(schema),
    required_bindings: requiredBindingsOf(schema),
    brand_safe: isBrandSafe(schema),
    production_ready: isProductionReady(entry?.report_type, schema),
    compatibility_version: SUPPORTED_TEMPLATE_SCHEMA_VERSION,
    orientation: width > height ? 'landscape' : 'portrait',
    preview_schema: buildPreviewSchema(schema),
  };
}

// ── Publish gate ─────────────────────────────────────────────────────────────

export interface PublishProblem {
  code: string;
  message: string;
  detail?: unknown;
}

/** Blocking problems that stop an entry being published. Null when it may go. */
export function validateForPublish(entry: Record<string, unknown>): PublishProblem | null {
  const schema = entry?.schema;
  if (!schema || typeof schema !== 'object') {
    return { code: 'library_schema_invalid', message: 'Entry has no template schema.' };
  }
  if (pagesOf(schema).length === 0) {
    return { code: 'library_schema_empty', message: 'A published template must have at least one page.' };
  }
  const unsupported = unsupportedBlocks(schema);
  if (unsupported.length > 0) {
    return {
      code: 'library_renderer_blocked',
      message: 'Template contains block types without production renderer support.',
      detail: unsupported.slice(0, 20),
    };
  }
  if (!String(entry?.name ?? '').trim()) {
    return { code: 'library_name_required', message: 'A published template must have a name.' };
  }
  if (!String(entry?.slug ?? '').trim()) {
    return { code: 'library_slug_required', message: 'A published template must have a slug.' };
  }
  return null;
}

// ── Working-copy payload ─────────────────────────────────────────────────────

/** Metadata a superadmin may set on a draft. Everything else is derived or fixed. */
export const EDITABLE_ENTRY_KEYS: ReadonlySet<string> = new Set([
  'name', 'description', 'long_description', 'category', 'report_type', 'tier',
  'variant', 'industry', 'tags', 'style', 'page_size', 'access_tier',
  'schema', 'config', 'custom_css', 'thumbnail_path', 'preview_image_paths',
  'design_meta',
]);

export function pickEditable(input: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (EDITABLE_ENTRY_KEYS.has(k)) out[k] = v;
  }
  return out;
}

// ── Colourway selection ──────────────────────────────────────────────────────

/** The design family an entry belongs to, or null if it is not a family entry. */
export function familyKeyOf(entry: Record<string, unknown>): string | null {
  const meta = entry?.design_meta;
  if (!meta || typeof meta !== 'object') return null;
  const key = (meta as Record<string, unknown>).familyKey;
  return typeof key === 'string' && key ? key : null;
}

/** The colourway ids this entry offers, in the approved order. */
export function offeredColourwayIds(entry: Record<string, unknown>): string[] {
  const meta = entry?.design_meta;
  if (!meta || typeof meta !== 'object') return [];
  const ids = (meta as Record<string, unknown>).colourways;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export interface ColourwaySelection {
  colourway: ApprovedColourway | null;
  problem: PublishProblem | null;
}

/**
 * Resolve the colourway a copy should be baked in.
 *
 * Validated against **this entry's own curated list**, not against the global
 * registry. A colourway id is only meaningful inside the family that curated
 * it, and accepting any known id would let a request paint a Private Banking
 * master in a palette from a family that never approved the pairing.
 *
 * Three outcomes, all deliberate:
 *   - no id requested → the family default, or null for a non-family entry
 *     (which then keeps whatever tokens its schema already carries);
 *   - a requested id the entry offers → that colourway;
 *   - anything else → a problem. Never a silent fallback to the default:
 *     a user who picked Oxblood Night and got Gold on Obsidian would only
 *     find out after opening the copy in the Builder.
 */
export function resolveRequestedColourway(
  entry: Record<string, unknown>,
  requestedId: unknown,
): ColourwaySelection {
  const familyKey = familyKeyOf(entry);
  const requested = typeof requestedId === 'string' ? requestedId.trim() : '';

  if (!familyKey) {
    if (requested) {
      return {
        colourway: null,
        problem: {
          code: 'colourway_not_supported',
          message: 'This template does not belong to a design family, so it has no colourways.',
        },
      };
    }
    return { colourway: null, problem: null };
  }

  if (!requested) {
    return { colourway: defaultColourwayFor(familyKey), problem: null };
  }

  if (!offeredColourwayIds(entry).includes(requested)) {
    return {
      colourway: null,
      problem: {
        code: 'colourway_not_offered',
        message: `"${requested}" is not one of this template's colourways.`,
      },
    };
  }

  const colourway = findColourway(familyKey, requested);
  if (!colourway) {
    return {
      colourway: null,
      problem: {
        code: 'colourway_unknown',
        message: `Colourway "${requested}" is not registered for family "${familyKey}".`,
      },
    };
  }
  return { colourway, problem: null };
}

export interface WorkingCopyRequest {
  /** Verified session user id. Never taken from the request body. */
  userId: string;
  /** User-supplied display name, already trimmed. */
  name: string;
  /** User-supplied description, optional. */
  description?: string | null;
  /** The published library entry being copied. */
  entry: Record<string, unknown>;
  /** Validated + migrated schema. */
  schema: unknown;
  /**
   * Colourway to bake into the copy's tokens. Resolved server-side by
   * `resolveRequestedColourway`; never taken from the request body directly.
   */
  colourway?: ApprovedColourway | null;
}

/**
 * The row inserted into `report_templates` for a working copy.
 *
 * Every field that could make a template reach a customer is fixed here rather
 * than being merged from the caller. `manage-templates`' generic insert branch
 * performs no validation — `validateReportTemplateUpdate` is wired only into
 * `update` — so a client-built payload could name its own `is_active`,
 * `scope` or `owner_user_id`. Building the row server-side removes that
 * possibility instead of relying on the client to behave.
 */
export function buildWorkingCopyPayload(req: WorkingCopyRequest): Record<string, unknown> {
  const { entry } = req;

  // Bake the colourway into the copy's own tokens rather than referencing it.
  //
  // That is what makes the choice survive everywhere without any downstream
  // system needing to know colourways exist: the Template Builder, the
  // WeasyPrint PDF and live report generation all see an ordinary template that
  // happens to be that colour. A reference would have meant teaching three
  // pipelines to resolve one, and a copy whose appearance could change later —
  // which is exactly what the library's snapshot rule exists to prevent.
  const schema = req.colourway
    ? applyColourwayToSchema(req.schema, req.colourway)
    : req.schema;

  const meta = (entry.design_meta && typeof entry.design_meta === 'object')
    ? entry.design_meta as Record<string, unknown>
    : {};

  const baseConfig = (entry.config && typeof entry.config === 'object')
    ? entry.config as Record<string, unknown>
    : {};

  // Lineage a person can read months later, on the copy itself. The library's
  // own `template_library_instantiations` row records which ENTRY was copied;
  // this records what it was copied AS — the family, the variant and the
  // colourway — which that row cannot know.
  //
  // Written ONLY for a design-family entry. A copy of one of the forty voice
  // templates has no family, no variant axis and no colourway, so a lineage
  // block there would be eleven null fields added to a column other code
  // round-trips — a behaviour change with nothing to show for it.
  const config = meta.familyKey
    ? {
      ...baseConfig,
      libraryLineage: {
        entryId: entry.id ?? null,
        entrySlug: entry.slug ?? null,
        entryVersion: entry.version ?? null,
        familyKey: meta.familyKey ?? null,
        familyName: meta.familyName ?? null,
        templateCode: meta.templateCode ?? null,
        variantAxis: meta.variantAxis ?? null,
        density: meta.density ?? null,
        colourway: req.colourway?.id ?? null,
        colourwayName: req.colourway?.name ?? null,
        ground: req.colourway?.ground ?? null,
      },
    }
    : baseConfig;

  return {
    name: req.name,
    description: req.description ?? (entry.description as string | null) ?? null,
    schema,
    // report_templates.config is NOT NULL.
    config,
    custom_css: entry.custom_css ?? null,
    report_type: entry.report_type ?? null,
    tier: entry.tier ?? null,
    variant: entry.variant ?? null,
    engine: entry.engine ?? 'weasyprint',

    // Nothing about a fresh copy is live.
    version: 1,
    is_active: false,
    is_default: false,
    is_draft: true,
    approval_status: 'draft',
    locked_for_review: false,
    locked_at: null,
    locked_by: null,
    priority: 0,

    // parent_template_id is an FK to report_templates; a library entry is not
    // in that table, so lineage lives in template_library_instantiations.
    parent_template_id: null,

    // created_by is an FK to auth.users, and this platform's custom-auth ids
    // are not in auth.users — stamping one violates the constraint. Same
    // decision as TemplateBranchingDialog.tsx:91-94.
    created_by: null,

    // The copy belongs to whoever made it. owner_user_id has no FK, so a
    // custom_users id is valid, and applyReportTemplateReadScope in
    // manage-templates already limits non-superadmin reads to
    // `scope='global' OR (scope='user' AND owner_user_id = me)`.
    scope: 'user',
    owner_user_id: req.userId,
    agency_id: null,
  };
}

// ── Name validation ──────────────────────────────────────────────────────────

export const MAX_WORKING_COPY_NAME = 200;

export function validateWorkingCopyName(raw: unknown): PublishProblem | null {
  const name = String(raw ?? '').trim();
  if (!name) return { code: 'name_required', message: 'A name for the working copy is required.' };
  if (name.length > MAX_WORKING_COPY_NAME) {
    return {
      code: 'name_too_long',
      message: `Name must be ${MAX_WORKING_COPY_NAME} characters or fewer.`,
    };
  }
  return null;
}

// ── Draft transitions ────────────────────────────────────────────────────────

export type EntryStatus = 'draft' | 'in_review' | 'published' | 'deprecated' | 'archived';

/**
 * Whether editing this entry must fork a new version rather than mutate in
 * place. Published entries are immutable so a copy already taken always points
 * at an unchanging snapshot.
 */
export function editRequiresNewVersion(status: unknown): boolean {
  return status === 'published';
}

/** The next-version draft row created when a published entry is edited. */
export function buildNextVersionDraft(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  userId: string | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...current,
    ...patch,
    version: Number(current.version ?? 1) + 1,
    status: 'draft',
    published_at: null,
    deprecated_at: null,
    // Usage belongs to the version that earned it.
    usage_count: 0,
    last_used_at: null,
    created_by_user_id: userId,
  };
  delete next.id;
  delete next.created_at;
  delete next.updated_at;
  Object.assign(next, deriveEntryFacts(next));
  return next;
}

export function statusForLifecycleOperation(operation: string): EntryStatus | null {
  if (operation === 'archive') return 'archived';
  if (operation === 'deprecate') return 'deprecated';
  if (operation === 'restore') return 'draft';
  return null;
}
