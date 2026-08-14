/**
 * Every column a report path selects must exist on the table it selects from.
 *
 * ## Why this is a test and not a code review
 *
 * PostgREST does not ignore a column it does not have. It fails the **whole
 * statement** with `42703`, supabase-js returns `{ data: null, error }`, and
 * every one of these call sites treats that exactly as "no such row" — which
 * is the correct posture for a missing report and catastrophic for a typo.
 * The failure is invisible in review, invisible in types (the rows are cast
 * to `Record<string, any>` at the boundary), and invisible in any harness that
 * builds its fixtures by hand. It only shows up as a format that silently
 * declines every record in production.
 *
 * That has now happened three times in this programme:
 *
 * 1. `render-borrowing-capacity-pdf` selected `first_name, surname,
 *    company_name` from `clients`. None exists. The route 404'd for every
 *    client in the database and `borrowing_capacity_renders` stayed empty.
 * 2. `comparisonAdapter` read `client_name` off `investment_reports`, which
 *    has never had the column, so every comparison cover bound `{{client.name}}`
 *    to the empty string.
 * 3. `clientDetailsAdapter.resolveRoutingContext` selected `first_name,
 *    last_name` from `clients` — the table stores `primary_first_name` /
 *    `primary_surname` — so routing declined all 775 clients while
 *    `buildBindingContext`, which selects `*`, worked in every harness.
 *
 * Each was found by a person noticing. This is the check that does not need
 * one: the generated `types.ts` mirrors the live schema, so the column names
 * are already in the repo — nothing here talks to a database.
 *
 * ## What it deliberately does not do
 *
 * It resolves literal selects, template literals and same-file or shared
 * column constants, and it skips what it cannot resolve rather than guessing.
 * A silent skip would be worse than no test, so the coverage counts are
 * asserted too: if a refactor makes these selects unreadable to this parser,
 * the count drops and this fails rather than quietly passing on nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const TYPES = join(ROOT, 'src/integrations/supabase/types.ts');

/** The generated schema: table to the columns its `Row` declares. */
function schemaTables(): Map<string, Set<string>> {
  const src = readFileSync(TYPES, 'utf8');
  const tables = new Map<string, Set<string>>();
  // `      <table>: {` then `        Row: {` then `          <col>: <type>`
  // until the block closes. The file is generated, so the shape is stable.
  const tableRe = /^ {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  for (const m of src.matchAll(tableRe)) {
    const cols = new Set<string>();
    for (const c of m[2].matchAll(/^ {10}(\w+)\??:/gm)) cols.add(c[1]);
    if (cols.size > 0) tables.set(m[1], cols);
  }
  return tables;
}

/**
 * `const NAME = '...' + '...';` to the joined string. Multi-line concatenation
 * is how every column constant in this repo is written once it outgrows a
 * line, so a parser that only reads single-line literals would skip exactly
 * the longest and most typo-prone ones.
 */
function stringConstants(source: string, extra?: Map<string, string>): Map<string, string> {
  const consts = new Map<string, string>();
  const declarations = [...source.matchAll(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([\s\S]*?);\n/g,
  )];

  for (const m of declarations) {
    const body = m[2];
    if (!/^[\s'"+\w,.\->()]*$/.test(body)) continue;
    const parts = [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((p) => p[1] ?? p[2]);
    if (parts.length === 0) continue;
    // Only a pure concatenation of literals; anything else is not a column list.
    if (body.replace(/'[^']*'|"[^"]*"/g, '').replace(/[\s+]/g, '') !== '') continue;
    consts.set(m[1], parts.join(''));
  }

  // A second pass for a constant built from another one — `const NAME_COLUMNS =
  // `${CLIENT_NAME_COLUMNS}, primary_middle_name`` — which is how a format
  // extends a shared column list without widening it for every other caller.
  // One pass deep: a chain of these would be harder to read than the query.
  for (const m of declarations) {
    const body = m[2].trim();
    if (consts.has(m[1]) || !/^`[^`]*`$/.test(body)) continue;
    let missing = false;
    const filled = body.slice(1, -1).replace(/\$\{([\w$]+)\}/g, (_all, name: string) => {
      const value = consts.get(name) ?? extra?.get(name) ?? null;
      if (value === null) missing = true;
      return value ?? '';
    });
    if (!missing) consts.set(m[1], filled);
  }
  return consts;
}

const SHARED_CONSTANT_SOURCES = [
  'supabase/functions/_shared/clientName.ts',
  'supabase/functions/_shared/organisationProjection.pure.ts',
].filter((p) => existsSync(join(ROOT, p)));

const sharedConstants = (() => {
  const all = new Map<string, string>();
  for (const rel of SHARED_CONSTANT_SOURCES) {
    for (const [k, v] of stringConstants(readFileSync(join(ROOT, rel), 'utf8'))) all.set(k, v);
  }
  return all;
})();

/** The argument text of the first `.select(...)` after an index. */
function selectArgAfter(source: string, from: number): string | null {
  const at = source.indexOf('.select(', from);
  // Far enough to cross a formatted chain, near enough not to pair a `.from`
  // with the next statement's select.
  if (at === -1 || at - from > 400) return null;
  let depth = 0;
  for (let i = at + '.select('.length - 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(at + '.select('.length, i);
    }
  }
  return null;
}

interface Selection { table: string; columns: string[] }

function selectionsIn(source: string, rel: string): { selections: Selection[]; unresolved: string[] } {
  const consts = stringConstants(source, sharedConstants);
  const lookup = (name: string) => consts.get(name) ?? sharedConstants.get(name) ?? null;
  const selections: Selection[] = [];
  const unresolved: string[] = [];

  for (const m of source.matchAll(/\.from\(\s*'([a-z0-9_]+)'\s*\)/g)) {
    const table = m[1];
    const raw = selectArgAfter(source, m.index! + m[0].length);
    if (raw === null) continue;
    // `.select('id', { count: 'exact', head: true })` asks how many rows match
    // and for none of their bodies. The options are not columns, and the
    // column list never contains a brace, so they come off before parsing —
    // the column still gets checked, which is the point.
    const arg = raw.trim().replace(/,\s*\{[\s\S]*\}$/, '').trim();

    let text: string | null = null;
    if (/^'[^']*'$/.test(arg) || /^"[^"]*"$/.test(arg)) text = arg.slice(1, -1);
    else if (/^`[^`]*`$/.test(arg)) {
      // A flag rather than a sentinel string: a column list is mostly spaces
      // and commas, so there is no character a failed substitution could leave
      // behind that ordinary content does not also contain.
      let missing = false;
      const filled = arg.slice(1, -1).replace(/\$\{([\w$]+)\}/g, (_all, name: string) => {
        const value = lookup(name);
        if (value === null) missing = true;
        return value ?? '';
      });
      text = missing ? null : filled;
    } else if (/^[A-Za-z_$][\w$]*$/.test(arg)) text = lookup(arg);

    // Named, not counted: a skip this parser cannot explain is the one thing
    // that would let the whole check pass on nothing.
    if (text === null) {
      unresolved.push(`${rel}: ${table} <- ${arg.replace(/\s+/g, ' ').slice(0, 80)}`);
    } else if (text.trim() !== '*') {
      const columns: string[] = [];
      for (const piece of text.split(',')) {
        const col = piece.trim();
        if (!col || col === '*') continue;
        // An embedded resource (`clients:client_id(*)`) or a JSON path
        // (`financial_calculations->projections`) is not a plain column.
        if (col.includes('(') || col.includes(':')) continue;
        columns.push(col.split('->')[0].trim());
      }
      if (columns.length > 0) selections.push({ table, columns });
    }

    // Filters are checked even when the select is `*` or unreadable — which is
    // the case that matters, since the nine-table client load is nine
    // `select('*')` reads whose only column references are their filters.
    //
    // A filtered or ordered column is exactly as fatal as a selected one —
    // `42703` is raised for the statement, not for the clause — and a filter
    // is the easier of the two to mistype, because it is written one column at
    // a time rather than copied from a shared constant.
    //
    // Bounded by the next `.from(` as well as the statement's end: nine of
    // these reads sit in one `Promise.all([...])`, where the semicolon is
    // past every sibling query, so a semicolon-only window reads the next
    // table's filters as this one's.
    const after = m.index! + m[0].length;
    const ends = [source.indexOf(';', after), source.indexOf('.from(', after)]
      .filter((i) => i !== -1);
    const chain = source.slice(after, ends.length > 0 ? Math.min(...ends) : source.length);
    const filterColumns: string[] = [];
    for (const f of chain.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|order|not)\(\s*'([a-zA-Z0-9_>-]+)'/g)) {
      const col = f[1].split('->')[0].trim();
      if (col) filterColumns.push(col);
    }
    if (filterColumns.length > 0) selections.push({ table, columns: filterColumns });
  }
  return { selections, unresolved };
}

const ADAPTER_DIR = 'src/lib/reportTemplate/adapters';

function adapterFiles(): string[] {
  return readdirSync(join(ROOT, ADAPTER_DIR))
    .filter((f) => f.endsWith('.ts') && !['index.ts', 'types.ts'].includes(f))
    .map((f) => `${ADAPTER_DIR}/${f}`);
}

function renderRouteFiles(): string[] {
  return readdirSync(join(ROOT, 'supabase/functions'))
    .filter((d) => d.startsWith('render-'))
    .map((d) => `supabase/functions/${d}/index.ts`)
    .filter((p) => existsSync(join(ROOT, p)));
}

function check(files: string[]) {
  const tables = schemaTables();
  const problems: string[] = [];
  let checkedColumns = 0;
  const unresolved: string[] = [];

  for (const rel of files) {
    const { selections, unresolved: u } = selectionsIn(readFileSync(join(ROOT, rel), 'utf8'), rel);
    unresolved.push(...u);
    for (const { table, columns } of selections) {
      const known = tables.get(table);
      // A table absent from the generated types is a stale checkout, not a
      // typo; the schema is the authority on what exists, so say so and move on.
      if (!known) { problems.push(`${rel}: no table \`${table}\` in the generated schema`); continue; }
      for (const col of columns) {
        checkedColumns += 1;
        if (!known.has(col)) {
          problems.push(`${rel}: \`${table}\` has no column \`${col}\``);
        }
      }
    }
  }
  return { problems, checkedColumns, unresolved };
}

describe('the generated schema knows every column these paths select', () => {
  it('parses the generated types into tables and columns', () => {
    const tables = schemaTables();
    expect(tables.size).toBeGreaterThan(100);
    // The columns whose misspelling has each cost this programme a format.
    expect([...tables.get('clients')!]).toEqual(expect.arrayContaining([
      'primary_first_name', 'primary_surname', 'secondary_first_name', 'secondary_surname',
    ]));
    // And the misspellings themselves, so this file fails rather than going
    // vacuous if the schema ever gains one of them.
    expect(tables.get('clients')!.has('first_name')).toBe(false);
    expect(tables.get('clients')!.has('last_name')).toBe(false);
    expect(tables.get('investment_reports')!.has('client_name')).toBe(false);
  });

  it('every column the report adapters select exists', () => {
    const { problems, checkedColumns, unresolved } = check(adapterFiles());
    expect(problems).toEqual([]);
    // Coverage is asserted, because a parser that silently resolved nothing
    // would pass this file for ever. The floor was 170 when every adapter read
    // its own tables directly; it is 100 now because three of those tables —
    // `investment_reports`, `property_comparisons` and `clients` — are
    // invisible to the browser client under this app's custom auth, so those
    // reads moved into `get-investment-reports` and `get-client-data`, whose
    // column lists live in the edge functions. The references that remain are
    // the sixteen tables an adapter may still read for itself, and the test
    // below covers the column lists that travelled to the brokers.
    expect(checkedColumns).toBeGreaterThan(100);
    expect(unresolved).toEqual([]);
  });

  it('every column the adapters ask a broker for exists too', () => {
    // The misspelling protection followed the read. `clientDetailsAdapter` and
    // `borrowingCapacityAdapter` now pass their column list to
    // `get-client-data`, and the investment and cash flow adapters pass theirs
    // to `get-investment-reports`; a `first_name` there is the same 42703 it
    // was on the direct read, just answered by a broker.
    //
    // The table is resolved from the call rather than assumed: the two brokers
    // serve different tables, and checking one list against the other's
    // columns would fail on correct code.
    const tables = schemaTables();
    const tableFor = (fn: string, body: string): string | null => {
      if (fn === 'get-client-data') return 'clients';
      if (fn !== 'get-investment-reports') return null;
      return body.match(/table:\s*['"]([a-z_]+)['"]/)?.[1] ?? 'investment_reports';
    };

    const checked: string[] = [];
    for (const rel of adapterFiles()) {
      const code = readFileSync(join(ROOT, rel), 'utf8');
      for (const call of code.matchAll(
        /invokeSecureFunction\(\s*['"]([a-z-]+)['"]\s*,\s*\{([\s\S]*?)\}\s*as any\)/g,
      )) {
        const [, fn, body] = call;
        const table = tableFor(fn, body);
        if (!table) continue;
        const known = tables.get(table);
        if (!known) continue;
        for (const sel of body.matchAll(/select:\s*[`'"]([^`'"]+)[`'"]/g)) {
          for (const raw of sel[1].split(',')) {
            const col = raw.trim();
            // `${CLIENT_NAME_COLUMNS}` expands to columns asserted above; the
            // interpolation itself is not a column name.
            if (!col || col === '*' || col.includes('${')) continue;
            checked.push(col);
            expect(known.has(col), `\`${table}\` has no column \`${col}\` (${rel})`).toBe(true);
          }
        }
      }
    }
    // The same canary: a regex that matched nothing would pass for ever.
    expect(checked.length).toBeGreaterThan(2);
  });

  it('every column the render routes select exists', () => {
    const { problems, checkedColumns } = check(renderRouteFiles());
    expect(problems).toEqual([]);
    // 129 across the eleven render routes.
    expect(checkedColumns).toBeGreaterThan(120);
  });
});
