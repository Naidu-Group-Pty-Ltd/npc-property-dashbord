/**
 * What `generate-brand-design-system` accepts, and what it answers.
 *
 * Three actions, and the split between them is the whole design:
 *
 * - **`audit`** resolves a palette and checks it. No model, no write. The form
 *   calls it on every change, so a person dragging a brand colour sees the
 *   contrast verdict before they commit to anything.
 * - **`generate`** asks Claude for a design system from a brief and returns the
 *   draft **without saving it**. A model's first answer is a proposal.
 * - **`save`** writes one. Authored or accepted-generated, same path, same
 *   validation.
 *
 * `generate` deliberately does not persist. A route that generated *and* saved
 * would fill the picker with every attempt somebody made at a brief, and the
 * picker is a list a person chooses a house style from — not a log of drafting.
 *
 * Everything testable about the route lives here. The function around it does
 * auth, one model call, a resolve, an audit and one write.
 */
import {
  type BrandDesignSystem,
  type BrandSystemAudit,
  MAX_BRIEF_CHARS,
  readBrandDesignSystem,
} from './system.pure.ts';

export type BrandRouteAction = 'audit' | 'generate' | 'save' | 'list';

export interface BrandAuditRequest {
  action: 'audit';
  /** The candidate, in the same shape `readBrandDesignSystem` reads. */
  system: BrandDesignSystem;
}

export interface BrandGenerateRequest {
  action: 'generate';
  brief: string;
  /** Printed into the prompt so the model knows whose document it is. */
  companyName: string;
}

export interface BrandSaveRequest {
  action: 'save';
  system: BrandDesignSystem;
  /** Update in place when the caller names an existing row. */
  id: string | null;
  isActive: boolean;
}

/**
 * List the saved systems.
 *
 * This exists because the browser cannot read the table.
 *
 * `brand_design_systems` is granted to `authenticated` only, and this app's
 * browser Supabase client is permanently anonymous — identity lives in an
 * HttpOnly cookie the custom auth flow owns, so `persistSession` is off and no
 * GoTrue session is ever created. A direct `supabase.from('brand_design_systems')`
 * is therefore refused at the *grant* level before RLS is even consulted, and
 * the picker it feeds renders empty for everybody.
 *
 * The route is the only thing holding a service-role client that has already
 * verified the cookie, so the read has to happen here. It is the same shape the
 * repo already uses for `template_imports` (`TemplateBuilder.tsx`) and linked
 * imports (`TemplateBuilderEdit.tsx`).
 */
export interface BrandListRequest {
  action: 'list';
  /** Inactive systems are hidden from pickers but kept for auditing. */
  includeInactive: boolean;
}

export type BrandRouteRequest =
  | BrandAuditRequest
  | BrandGenerateRequest
  | BrandSaveRequest
  | BrandListRequest;

export type BrandRequestParse =
  | { ok: true; request: BrandRouteRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A brief shorter than this is not a brief, it is a word. */
export const MIN_BRIEF_CHARS = 12;

/**
 * Read a request body.
 *
 * A malformed system is refused here rather than defaulted, because
 * `readBrandDesignSystem` is the one place that decides what a legal design
 * system is and this route has no business having a second opinion.
 */
export function parseBrandRequest(body: unknown): BrandRequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;
  const action = typeof b.action === 'string' ? b.action.trim() : '';

  // Before `audit` and `save`, which both run `readBrandDesignSystem(b.system)`
  // and would refuse a listing request for having no design system in it.
  if (action === 'list') {
    return { ok: true, request: { action: 'list', includeInactive: b.includeInactive === true } };
  }

  if (action === 'generate') {
    const brief = typeof b.brief === 'string' ? b.brief.trim().slice(0, MAX_BRIEF_CHARS) : '';
    if (brief.length < MIN_BRIEF_CHARS) {
      return {
        ok: false,
        error: `a brief needs at least ${MIN_BRIEF_CHARS} characters — say what the documents are for and who reads them`,
      };
    }
    return {
      ok: true,
      request: {
        action: 'generate',
        brief,
        companyName: typeof b.companyName === 'string' ? b.companyName.trim().slice(0, 120) : '',
      },
    };
  }

  if (action === 'audit' || action === 'save') {
    const read = readBrandDesignSystem(b.system);
    if (read.ok === false) return { ok: false, error: read.error };
    if (action === 'audit') return { ok: true, request: { action: 'audit', system: read.system } };

    const rawId = typeof b.id === 'string' ? b.id.trim() : '';
    if (rawId && !UUID.test(rawId)) return { ok: false, error: 'id must be a uuid' };
    return {
      ok: true,
      request: {
        action: 'save',
        system: read.system,
        id: rawId || null,
        isActive: b.isActive !== false,
      },
    };
  }

  return {
    ok: false,
    error: `unknown action "${action.slice(0, 40)}" — expected audit, generate, save or list`,
  };
}

/** What comes back from every action. `id` is set only by `save`. */
export interface BrandRouteResponse {
  action: BrandRouteAction;
  system: BrandDesignSystem;
  /** The resolved palette, so the UI can paint a swatch without re-deriving. */
  audit: {
    ok: boolean;
    problems: BrandSystemAudit['problems'];
    /** `describeAuditProblems`, or empty. Ready to put in front of a person. */
    summary: string;
    accentOnPaper: string;
    accentOnField: string;
    paper: string;
    field: string;
  };
  id: string | null;
  slug: string;
  /** Present on `generate`: what the model was told, for the review screen. */
  brief: string;
  durationMs: number;
}

/** One row of the picker. */
export interface BrandDesignSystemSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  origin: 'authored' | 'generated';
  /** `#RRGGBB`, or null for the house brand. The *requested* hue, not the
   *  resolved accent — the palette is derived per render, never stored. */
  brandHex: string | null;
  isActive: boolean;
  updatedAt: string;
}

/**
 * The listing.
 *
 * A separate interface rather than a member of `BrandRouteResponse`, on
 * purpose. Widening that type into a union would force every existing
 * `.system` / `.audit` / `.id` access in `BrandDesignSystemDialog` to narrow
 * first, for no gain — a listing and a single-system answer have nothing in
 * common but the word "response".
 */
export interface BrandListResponse {
  action: 'list';
  systems: BrandDesignSystemSummary[];
  durationMs: number;
}

/** One database row into one picker row. */
export function readBrandSystemSummary(row: Record<string, unknown>): BrandDesignSystemSummary {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    description: String(row.description ?? ''),
    origin: row.origin === 'generated' ? 'generated' : 'authored',
    brandHex: typeof row.brand_hex === 'string' && row.brand_hex ? row.brand_hex : null,
    isActive: row.is_active !== false,
    updatedAt: String(row.updated_at ?? ''),
  };
}

/**
 * Pull the first JSON object out of a model's reply.
 *
 * Claude is asked for one JSON object and usually returns exactly that, but a
 * fenced block or a sentence of preamble is common enough that failing on it
 * would make the feature flaky for no reason. Brace-matching rather than a
 * regex, because a design system's `description` can contain a brace and a lazy
 * `\{.*\}` would cut the object in half.
 *
 * Returns `null` rather than throwing: the caller has a better error to give
 * than "unexpected token".
 */
export function extractJsonObject(text: string): unknown {
  const source = String(text ?? '');
  const start = source.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
