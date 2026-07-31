/**
 * manage-template-library — the Template Library's only write path.
 *
 * Deliberately a separate function from `manage-templates`:
 *
 *  - `manage-templates` is the live Template Builder broker. Adding operations
 *    to it would put library code in the blast radius of every Builder save.
 *  - Its generic `insert` passes the caller's payload straight through to
 *    Postgres. That is fine for the Builder, whose client sets safe values, but
 *    it means a client could name its own `owner_user_id`, `scope` or
 *    `is_active` on a library-created template. Instantiation therefore happens
 *    HERE, server-side, where the payload is constructed from the verified
 *    session and the caller cannot influence a single safety-critical field.
 *
 * Library entries are catalogue data and are never rows in `report_templates`.
 * See docs/architecture/adr/017-template-library-separation.md.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createUnauthorizedResponse,
  createCorsHeaders,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { requireModulePermission, requireSuperadmin } from '../_shared/authz.ts';
import {
  TemplateSchemaVersionError,
  validateAndMigrateTemplateSchemaVersion,
  SUPPORTED_TEMPLATE_SCHEMA_VERSION,
} from '../_shared/templateSchemaVersion.ts';
import {
  PRODUCTION_SAFE_BLOCK_TYPES,
  PRODUCTION_REPORT_TEMPLATE_TYPES,
} from '../_shared/productionBlockTypes.ts';

type Operation =
  | 'list'
  | 'get'
  | 'instantiate'
  | 'promote'
  | 'save_draft'
  | 'publish'
  | 'deprecate'
  | 'archive'
  | 'restore'
  | 'events';

/** Operations a non-superadmin may call, and the module permission each needs. */
const READ_OPERATIONS = new Set<Operation>(['list', 'get']);
const EDIT_OPERATIONS = new Set<Operation>(['instantiate']);

/** Columns safe to return in a list: never the heavy `schema` payload.
 *  The Builder list learned this the hard way — templates imported from PDFs
 *  carry multi-hundred-MB schemas, and selecting them for every row blows past
 *  the statement timeout (see the comment on ReportTemplateListRow). */
const LIST_SELECT = [
  'id', 'family_id', 'slug', 'version', 'name', 'description',
  'category', 'report_type', 'tier', 'variant', 'industry', 'tags', 'style',
  'orientation', 'page_size', 'page_count',
  'preview_schema', 'thumbnail_path', 'preview_image_paths',
  'supported_modules', 'required_bindings', 'brand_safe', 'production_ready',
  'compatibility_version', 'status', 'access_tier', 'visibility',
  'created_at', 'updated_at', 'published_at', 'usage_count', 'last_used_at',
].join(',');

interface RequestBody {
  operation: Operation;
  entryId?: string;
  templateId?: string;
  /** list filters */
  filters?: {
    status?: string;
    category?: string;
    reportType?: string;
    includeUnpublished?: boolean;
  };
  /** instantiate */
  name?: string;
  description?: string;
  /** promote / save_draft */
  entry?: Record<string, unknown>;
  session_token?: string;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function fail(code: string, message: string, status: number, cors: Record<string, string>, extra?: Record<string, unknown>): Response {
  return json({ success: false, error: { code, message, ...(extra ?? {}) } }, status, cors);
}

// ── Schema inspection ────────────────────────────────────────────────────────

function pagesOf(schema: any): any[] {
  return Array.isArray(schema?.pages) ? schema.pages : [];
}

function blockTypesOf(schema: any): string[] {
  const types = new Set<string>();
  for (const page of pagesOf(schema)) {
    for (const block of Array.isArray(page?.blocks) ? page.blocks : []) {
      const t = String(block?.type ?? '').trim();
      if (t) types.add(t);
    }
  }
  return [...types].sort();
}

function unsupportedBlocks(schema: any): string[] {
  return blockTypesOf(schema).filter((t) => !PRODUCTION_SAFE_BLOCK_TYPES.has(t));
}

/** Every `{{path}}` referenced anywhere in the schema, filters stripped. */
function requiredBindingsOf(schema: any): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)) {
        const path = m[1].trim();
        // `{{=name}}` is a computed field, not a data binding.
        if (path && !path.startsWith('=')) found.add(path);
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') { Object.values(node).forEach(walk); }
  };
  walk(schema);
  return [...found].sort();
}

/**
 * True when the design carries no hard-coded colour, so a partner brand fully
 * applies. Values of the form `token:*` and `{{binding}}` are brand-safe;
 * literal hex/rgb/hsl in a colour-ish field is not. Declared token definitions
 * (`schema.tokens`) are excluded — that is where literals belong.
 */
function isBrandSafe(schema: any): boolean {
  const COLOUR_KEY = /(colou?r|fill|stroke|bg|background|accent|shadow|border)/i;
  const LITERAL = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;
  let safe = true;
  const walk = (node: unknown, key?: string): void => {
    if (!safe) return;
    if (typeof node === 'string') {
      if (key && COLOUR_KEY.test(key) && LITERAL.test(node.trim())) safe = false;
      return;
    }
    if (Array.isArray(node)) { node.forEach((v) => walk(v, key)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  };
  // Skip `tokens` — literal colours are the point of a token definition.
  const { tokens: _tokens, ...rest } = (schema && typeof schema === 'object') ? schema : {} as any;
  walk(rest);
  return safe;
}

function isProductionReady(reportType: unknown, schema: any): boolean {
  const key = String(reportType ?? '').trim().toLowerCase();
  if (!key || !PRODUCTION_REPORT_TEMPLATE_TYPES.has(key)) return false;
  return unsupportedBlocks(schema).length === 0;
}

/** Page-1-only schema, image payloads stripped, for the SVG card thumbnail. */
function buildPreviewSchema(schema: any): any {
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
    tokens: schema?.tokens ?? {},
    pages: [strip(first)],
  };
}

/** Validation gate that runs before an entry may be published. */
function validateForPublish(entry: any): { code: string; message: string; detail?: unknown } | null {
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

/** Recompute every derived field from the schema. Never trusts the caller. */
function deriveEntryFacts(entry: any): Record<string, unknown> {
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

function slugify(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'template';
}

/** Fields a superadmin may set on a draft. Everything else is derived or fixed. */
const EDITABLE_ENTRY_KEYS = new Set([
  'name', 'description', 'long_description', 'category', 'report_type', 'tier',
  'variant', 'industry', 'tags', 'style', 'page_size', 'access_tier',
  'schema', 'config', 'custom_css', 'thumbnail_path', 'preview_image_paths',
]);

function pickEditable(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (EDITABLE_ENTRY_KEYS.has(k)) out[k] = v;
  }
  return out;
}

async function recordEvent(
  supabase: any,
  entryId: string,
  eventType: string,
  actorId: string | null,
  summary: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('template_library_events').insert({
      entry_id: entryId,
      event_type: eventType,
      actor_id: actorId,
      summary,
      metadata,
    });
  } catch (e) {
    console.warn('[manage-template-library] event insert failed:', (e as Error).message);
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: RequestBody = await req.json();
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    const operation = body.operation;
    const actor = { userId: userId ?? null, authMethod };

    // ── Authorisation, deny by default ──────────────────────────────────────
    let authz;
    if (READ_OPERATIONS.has(operation)) {
      authz = await requireModulePermission(supabase, actor, 'templates', 'can_view');
    } else if (EDIT_OPERATIONS.has(operation)) {
      // Creating a working copy is exactly as privileged as creating a Builder
      // template, so it needs exactly the same permission.
      authz = await requireModulePermission(supabase, actor, 'templates', 'can_edit');
    } else {
      // Authoring, publishing and lifecycle changes are control-plane actions.
      authz = await requireSuperadmin(supabase, actor);
    }
    if (!authz.ok) return createForbiddenResponse(authz.error ?? 'Not authorised', corsHeaders);

    const isSuperadmin = (await requireSuperadmin(supabase, actor)).ok;

    // ── list ────────────────────────────────────────────────────────────────
    if (operation === 'list') {
      let query = supabase.from('template_library_entries').select(LIST_SELECT);

      // Non-superadmins only ever see published entries, whatever they ask for.
      if (!isSuperadmin || !body.filters?.includeUnpublished) {
        query = query.eq('status', body.filters?.status ?? 'published');
      } else if (body.filters?.status) {
        query = query.eq('status', body.filters.status);
      }
      if (body.filters?.category) query = query.eq('category', body.filters.category);
      if (body.filters?.reportType) query = query.eq('report_type', body.filters.reportType);

      const { data: records, error } = await query.order('updated_at', { ascending: false });
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ success: true, records, count: records?.length ?? 0 }, 200, corsHeaders);
    }

    // ── get ─────────────────────────────────────────────────────────────────
    if (operation === 'get') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);
      let query = supabase.from('template_library_entries').select('*').eq('id', body.entryId);
      if (!isSuperadmin) query = query.eq('status', 'published');

      const { data: record, error } = await query.maybeSingle();
      if (error) return json({ error: error.message }, 500, corsHeaders);
      if (!record) return fail('not_found', 'Template not found.', 404, corsHeaders);
      return json({ success: true, record }, 200, corsHeaders);
    }

    // ── instantiate ─────────────────────────────────────────────────────────
    // Copy a published entry into an independent working copy in
    // report_templates. Every safety-critical field is set here, from the
    // verified session — never from the request body.
    if (operation === 'instantiate') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);
      const name = String(body.name ?? '').trim();
      if (!name) return fail('name_required', 'A name for the working copy is required.', 400, corsHeaders);
      if (name.length > 200) return fail('name_too_long', 'Name must be 200 characters or fewer.', 400, corsHeaders);

      const { data: entry, error: entryErr } = await supabase
        .from('template_library_entries')
        .select('*')
        .eq('id', body.entryId)
        .eq('status', 'published')
        .maybeSingle();
      if (entryErr) return json({ error: entryErr.message }, 500, corsHeaders);
      if (!entry) return fail('not_found', 'Template not found or not published.', 404, corsHeaders);

      // Validate and migrate on the way out of the library, so a stale entry
      // can never inject an unsupported schema into the Builder's table.
      let schema: any;
      try {
        schema = validateAndMigrateTemplateSchemaVersion(
          JSON.parse(JSON.stringify(entry.schema ?? {})),
        );
      } catch (e) {
        if (e instanceof TemplateSchemaVersionError) {
          return fail('unsupported_schema_version', e.message, 422, corsHeaders);
        }
        throw e;
      }

      const insertPayload = {
        name,
        description: body.description ? String(body.description).slice(0, 2000) : (entry.description ?? null),
        schema,
        // report_templates.config is NOT NULL.
        config: entry.config ?? {},
        custom_css: entry.custom_css ?? null,
        report_type: entry.report_type ?? null,
        tier: entry.tier ?? null,
        variant: entry.variant ?? null,
        engine: entry.engine ?? 'weasyprint',

        // Nothing about a fresh copy is live. These are the fields that make a
        // template reach a customer, and all of them start off.
        version: 1,
        is_active: false,
        is_default: false,
        is_draft: true,
        approval_status: 'draft',
        locked_for_review: false,
        locked_at: null,
        locked_by: null,
        priority: 0,

        // parent_template_id is an FK to report_templates; a library entry is
        // not in that table, so lineage goes in template_library_instantiations.
        parent_template_id: null,

        // created_by is an FK to auth.users and this platform's custom-auth ids
        // are not in auth.users — stamping one violates the constraint. See
        // TemplateBranchingDialog.tsx:91-94 for the same decision.
        created_by: null,

        // The working copy belongs to the person who made it. owner_user_id has
        // no FK, so a custom_users id is valid here, and applyReportTemplateReadScope
        // in manage-templates already enforces `scope='user' AND owner_user_id=me`
        // for reads. This is stricter than the Builder's own "New template",
        // which leaves copies globally readable.
        scope: 'user',
        owner_user_id: userId,
        agency_id: null,
      };

      const { data: created, error: insertErr } = await supabase
        .from('report_templates')
        .insert(insertPayload)
        .select('id,name,version')
        .single();
      if (insertErr) return json({ error: insertErr.message }, 500, corsHeaders);

      const { data: lineage, error: lineageErr } = await supabase
        .from('template_library_instantiations')
        .insert({
          entry_id: entry.id,
          entry_version_at_copy: entry.version,
          template_id: created.id,
          created_by_user_id: userId,
        })
        .select('id')
        .single();
      if (lineageErr) {
        console.warn('[manage-template-library] lineage insert failed:', lineageErr.message);
      }

      // Usage counters are best-effort telemetry; never fail a copy over them.
      await supabase
        .from('template_library_entries')
        .update({ usage_count: (entry.usage_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq('id', entry.id)
        .then(() => {}, () => {});

      // The working copy exists, so template_audit_log's NOT NULL FK is satisfied.
      await supabase.from('template_audit_log').insert({
        template_id: created.id,
        actor_id: null,
        action: 'library_instantiated',
        summary: `Created from library template "${entry.name}" v${entry.version}`,
        metadata: { entry_id: entry.id, entry_version: entry.version, entry_slug: entry.slug },
      }).then(() => {}, () => {});

      await recordEvent(supabase, entry.id, 'instantiated', userId, `Copied as "${name}"`, {
        template_id: created.id,
      });

      return json({
        success: true,
        templateId: created.id,
        instantiationId: lineage?.id ?? null,
      }, 200, corsHeaders);
    }

    // ── promote (Builder template → library draft) ──────────────────────────
    if (operation === 'promote') {
      if (!body.templateId) return fail('missing_template_id', 'templateId is required.', 400, corsHeaders);

      const { data: source, error: srcErr } = await supabase
        .from('report_templates')
        .select('id,name,description,schema,config,custom_css,report_type,tier,variant,engine')
        .eq('id', body.templateId)
        .maybeSingle();
      if (srcErr) return json({ error: srcErr.message }, 500, corsHeaders);
      if (!source) return fail('not_found', 'Source template not found.', 404, corsHeaders);

      const overrides = pickEditable(body.entry);
      const name = String(overrides.name ?? source.name ?? 'Untitled template').slice(0, 200);
      const draft: Record<string, unknown> = {
        name,
        slug: slugify(String(overrides.slug ?? name)),
        version: 1,
        description: overrides.description ?? source.description ?? null,
        long_description: overrides.long_description ?? null,
        category: overrides.category ?? 'investment',
        report_type: overrides.report_type ?? source.report_type ?? null,
        tier: overrides.tier ?? source.tier ?? null,
        variant: overrides.variant ?? source.variant ?? null,
        industry: overrides.industry ?? [],
        tags: overrides.tags ?? [],
        style: overrides.style ?? null,
        page_size: overrides.page_size ?? 'A4',
        access_tier: overrides.access_tier ?? 'standard',
        schema: overrides.schema ?? source.schema ?? {},
        config: overrides.config ?? source.config ?? {},
        custom_css: overrides.custom_css ?? source.custom_css ?? null,
        engine: source.engine ?? 'weasyprint',
        status: 'draft',
        visibility: 'global',
        source_template_id: source.id,
        created_by_user_id: userId,
      };
      Object.assign(draft, deriveEntryFacts(draft));

      const { data: record, error } = await supabase
        .from('template_library_entries')
        .insert(draft)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);

      await recordEvent(supabase, record.id, 'promoted', userId,
        `Promoted from Builder template "${source.name}"`, { source_template_id: source.id });

      return json({ success: true, record }, 200, corsHeaders);
    }

    // ── save_draft ──────────────────────────────────────────────────────────
    if (operation === 'save_draft') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);

      const { data: current, error: curErr } = await supabase
        .from('template_library_entries')
        .select('*')
        .eq('id', body.entryId)
        .maybeSingle();
      if (curErr) return json({ error: curErr.message }, 500, corsHeaders);
      if (!current) return fail('not_found', 'Entry not found.', 404, corsHeaders);

      // Published entries are immutable: editing one creates the next version
      // as a fresh draft in the same family, so a copy already taken always
      // points at an unchanging snapshot.
      const patch = pickEditable(body.entry);
      if (Object.keys(patch).length === 0) {
        return fail('nothing_to_update', 'No editable fields supplied.', 400, corsHeaders);
      }

      if (current.status === 'published') {
        const next = {
          ...current,
          ...patch,
          id: undefined,
          version: (current.version ?? 1) + 1,
          status: 'draft',
          published_at: null,
          deprecated_at: null,
          usage_count: 0,
          last_used_at: null,
          created_at: undefined,
          updated_at: undefined,
          created_by_user_id: userId,
        };
        Object.assign(next, deriveEntryFacts(next));
        const { data: record, error } = await supabase
          .from('template_library_entries').insert(next).select('*').single();
        if (error) return json({ error: error.message }, 500, corsHeaders);
        await recordEvent(supabase, record.id, 'version_drafted', userId,
          `Draft v${record.version} created from published v${current.version}`,
          { previous_entry_id: current.id });
        return json({ success: true, record, createdNewVersion: true }, 200, corsHeaders);
      }

      const merged = { ...current, ...patch };
      Object.assign(patch, deriveEntryFacts(merged));
      const { data: record, error } = await supabase
        .from('template_library_entries')
        .update(patch)
        .eq('id', body.entryId)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);
      await recordEvent(supabase, record.id, 'draft_saved', userId, 'Draft updated',
        { fields: Object.keys(patch) });
      return json({ success: true, record, createdNewVersion: false }, 200, corsHeaders);
    }

    // ── publish ─────────────────────────────────────────────────────────────
    if (operation === 'publish') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);

      const { data: entry, error: getErr } = await supabase
        .from('template_library_entries').select('*').eq('id', body.entryId).maybeSingle();
      if (getErr) return json({ error: getErr.message }, 500, corsHeaders);
      if (!entry) return fail('not_found', 'Entry not found.', 404, corsHeaders);
      if (entry.status === 'published') {
        return fail('already_published', 'Entry is already published.', 409, corsHeaders);
      }

      try {
        validateAndMigrateTemplateSchemaVersion(JSON.parse(JSON.stringify(entry.schema ?? {})));
      } catch (e) {
        if (e instanceof TemplateSchemaVersionError) {
          return fail('unsupported_schema_version', e.message, 422, corsHeaders);
        }
        throw e;
      }

      const problem = validateForPublish(entry);
      if (problem) {
        return fail(problem.code, problem.message, 422, corsHeaders, { detail: problem.detail });
      }

      const derived = deriveEntryFacts(entry);
      const { data: record, error } = await supabase
        .from('template_library_entries')
        .update({ ...derived, status: 'published', published_at: new Date().toISOString() })
        .eq('id', body.entryId)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);

      // Publishing a newer version retires the previously published one in the
      // same family. Older versions stay on disk, so rolling back is republishing.
      await supabase
        .from('template_library_entries')
        .update({ status: 'deprecated', deprecated_at: new Date().toISOString() })
        .eq('family_id', record.family_id)
        .eq('status', 'published')
        .neq('id', record.id)
        .then(() => {}, () => {});

      await recordEvent(supabase, record.id, 'published', userId, `Published v${record.version}`, {
        production_ready: record.production_ready,
        brand_safe: record.brand_safe,
        page_count: record.page_count,
      });
      return json({ success: true, record }, 200, corsHeaders);
    }

    // ── deprecate / archive / restore ───────────────────────────────────────
    if (operation === 'deprecate' || operation === 'archive' || operation === 'restore') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);
      const nextStatus = operation === 'restore'
        ? 'draft'
        : operation === 'archive' ? 'archived' : 'deprecated';

      const patch: Record<string, unknown> = { status: nextStatus };
      if (operation === 'deprecate') patch.deprecated_at = new Date().toISOString();
      if (operation === 'restore') { patch.deprecated_at = null; patch.published_at = null; }

      const { data: record, error } = await supabase
        .from('template_library_entries')
        .update(patch)
        .eq('id', body.entryId)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);

      await recordEvent(supabase, record.id, operation, userId, `Entry ${operation}d`, {});
      return json({ success: true, record }, 200, corsHeaders);
    }

    // ── events ──────────────────────────────────────────────────────────────
    if (operation === 'events') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);
      const { data: records, error } = await supabase
        .from('template_library_events')
        .select('*')
        .eq('entry_id', body.entryId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ success: true, records }, 200, corsHeaders);
    }

    return fail('invalid_operation', `Unknown operation: ${String(operation)}`, 400, corsHeaders);
  } catch (error) {
    console.error('[manage-template-library] Error:', error);
    return json(
      { error: 'Internal server error', details: (error as Error).message },
      500,
      corsHeaders,
    );
  }
});
