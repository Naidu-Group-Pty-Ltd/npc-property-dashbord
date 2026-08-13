/**
 * AML activation client search — pure matching + projection logic.
 *
 * Extracted from the `search_clients` op in `supabase/functions/aml-cases/index.ts`
 * so the tokenised full-name matching is unit-testable from vitest (the edge
 * function itself only runs under Deno). No I/O in this module.
 *
 * Contract (directive §13.4 + activation-pathway fix):
 *  - A full name ("Rugesh Naidu") never matches a single name column, so the
 *    query is split into tokens and every token must appear somewhere in the
 *    same person's assembled name (primary or secondary applicant).
 *  - Matching is case-insensitive and tolerant of repeated whitespace.
 *  - Both active AND inactive clients are returned: the activation form is the
 *    place an authorised user confirms an existing client is active, so the
 *    picker must be able to offer inactive records (clearly labelled).
 *  - The projection carries identification data only (name, email, mobile,
 *    active flag, open-case flag) — never financial information.
 */

/** Raw row shape selected from `public.clients` for the picker. */
export interface ClientSearchRow {
  id: string;
  is_active: boolean | null;
  primary_first_name?: string | null;
  primary_middle_name?: string | null;
  primary_surname?: string | null;
  secondary_first_name?: string | null;
  secondary_middle_name?: string | null;
  secondary_surname?: string | null;
  primary_email?: string | null;
  primary_mobile?: string | null;
}

/** Picker projection returned to the activation dialog. */
export interface ActivationClientResult {
  id: string;
  label: string;
  email: string | null;
  mobile: string | null;
  is_active: boolean;
  has_open_case: boolean;
}

export const CLIENT_SEARCH_NAME_COLUMNS = [
  'primary_first_name', 'primary_middle_name', 'primary_surname',
  'secondary_first_name', 'secondary_middle_name', 'secondary_surname',
] as const;

/** Columns the search op selects — identification only, no financials. */
export const CLIENT_SEARCH_SELECT = [
  'id', 'is_active', 'primary_email', 'primary_mobile',
  ...CLIENT_SEARCH_NAME_COLUMNS,
].join(', ');

export const CLIENT_SEARCH_RESULT_LIMIT = 20;

/**
 * Strip characters that carry meaning inside a PostgREST `or=` filter
 * (`%`, `,`, `(`, `)`, backslash) and collapse repeated whitespace.
 */
export function sanitizeClientSearchQuery(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[%,()\\.*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a sanitised query into matching tokens. Single-character tokens are
 * dropped (too noisy) unless nothing longer survives, in which case the whole
 * sanitised query is used as one term. Capped at 4 tokens.
 */
export function tokenizeClientSearch(sanitized: string): string[] {
  const tokens = sanitized.split(/\s+/).filter((t) => t.length >= 2).slice(0, 4);
  return tokens.length > 0 ? tokens : (sanitized ? [sanitized] : []);
}

/**
 * PostgREST `or=` candidate filter: any token in any name column. This is a
 * deliberately wide database-side pre-filter; `matchesAllTerms` applies the
 * strict all-tokens-in-one-person rule afterwards.
 */
export function buildClientSearchOrFilter(terms: string[]): string {
  return terms
    .flatMap((t) => CLIENT_SEARCH_NAME_COLUMNS.map((c) => `${c}.ilike.%${t}%`))
    .join(',');
}

/** Assemble one applicant's display name off the row it is actually stored in. */
export function clientDisplayName(
  row: ClientSearchRow,
  prefix: 'primary' | 'secondary',
): string {
  const r = row as unknown as Record<string, string | null | undefined>;
  return [r[`${prefix}_first_name`], r[`${prefix}_middle_name`], r[`${prefix}_surname`]]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when every token appears (case-insensitively) in the primary applicant's
 * assembled name, or every token appears in the secondary applicant's name.
 * "Rugesh Naidu" therefore matches `primary_first_name = Rugesh`,
 * `primary_surname = Naidu`.
 */
export function matchesAllTerms(row: ClientSearchRow, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const primary = clientDisplayName(row, 'primary').toLowerCase();
  const secondary = clientDisplayName(row, 'secondary').toLowerCase();
  const lower = terms.map((t) => t.toLowerCase());
  return lower.every((t) => primary.includes(t))
    || (secondary.length > 0 && lower.every((t) => secondary.includes(t)));
}

export function toActivationClientResult(
  row: ClientSearchRow,
  hasOpenCase: boolean,
): ActivationClientResult {
  return {
    id: row.id,
    label: clientDisplayName(row, 'primary')
      || clientDisplayName(row, 'secondary')
      || 'Unnamed client',
    email: row.primary_email ?? null,
    mobile: row.primary_mobile ?? null,
    is_active: row.is_active === true,
    has_open_case: hasOpenCase,
  };
}

/**
 * Full in-memory pipeline over the candidate rows the database returned:
 * strict tokenised matching, stable active-first ordering (surname order is
 * preserved within each group as delivered by the query), capped result set.
 * Inactive clients are included and selectable — the activation form is where
 * they get confirmed active.
 */
export function selectActivationMatches(
  rows: ClientSearchRow[],
  query: string,
  limit: number = CLIENT_SEARCH_RESULT_LIMIT,
): ClientSearchRow[] {
  const terms = tokenizeClientSearch(sanitizeClientSearchQuery(query));
  if (terms.length === 0) return [];
  const matched = rows.filter((r) => matchesAllTerms(r, terms));
  const active = matched.filter((r) => r.is_active === true);
  const inactive = matched.filter((r) => r.is_active !== true);
  return [...active, ...inactive].slice(0, limit);
}
