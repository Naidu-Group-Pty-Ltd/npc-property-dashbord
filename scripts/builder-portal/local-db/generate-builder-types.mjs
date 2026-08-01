#!/usr/bin/env node
/**
 * Generate the Supabase TypeScript type blocks for the Builder Portal tables
 * and splice them into src/integrations/supabase/types.ts.
 *
 * Covers Phase 1 and Phase 2. The BEGIN/END marker text still says "phase-1"
 * so the existing generated block is replaced in place rather than duplicated;
 * the block's contents are whatever this script introspects today.
 *
 * The Supabase MCP `generate_typescript_types` tool reads the PRODUCTION
 * database, which does not have these tables — Phase 1 is not deployed. So the
 * blocks are introspected from the verified local database instead, which keeps
 * nullability and defaults faithful rather than hand-written.
 *
 * Run after the LAST module's verification script, which builds the database
 * this reads — each one is a superset of every earlier module's.
 *
 * Usage: node scripts/builder-portal/local-db/generate-builder-types.mjs [--check]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
// Phase 2's verification database is a superset of Phase 1's, so it is the
// source of truth for introspection. Build it with:
//   node scripts/builder-portal/local-db/verify-phase-2.mjs
const DB = process.env.LOCAL_PG_TYPES_DB
  || process.env.LOCAL_PG_VERIFY_DB_DEL || 'aurixa_delivery_verify';
const checkOnly = process.argv.includes('--check');

const TYPES_PATH = join(root, 'src/integrations/supabase/types.ts');
const ANCHOR = '      bulk_generation_items: {';
const BEGIN = '      // BEGIN builder-portal-phase-1 (generated)';
const END = '      // END builder-portal-phase-1 (generated)';

const TABLES = [
  'builder_allocations',
  'builder_buildings',
  'builder_construction_cases',
  'builder_construction_date_history',
  'builder_construction_milestones',
  'builder_construction_photographs',
  'builder_construction_progress_updates',
  'builder_construction_stages',
  'builder_construction_status_history',
  'builder_defects',
  'builder_delivery_status_history',
  'builder_developments',
  'builder_membership_permissions',
  'builder_onboarding_steps',
  'builder_organisation_memberships',
  'builder_organisations',
  'builder_permission_keys',
  'builder_portal_activity_log',
  'builder_portal_sessions',
  'builder_portal_users',
  'builder_project_access',
  'builder_project_parties',
  'builder_project_status_history',
  'builder_projects',
  'builder_reservation_status_history',
  'builder_reservations',
  'builder_handovers',
  'builder_inspections',
  'builder_practical_completions',
  'builder_progress_claims',
  'builder_role_default_permissions',
  'builder_stages',
  'builder_transaction_parties',
  'builder_transaction_pipeline_stages',
  'builder_transaction_status_history',
  'builder_transactions',
  'builder_unit_holds',
  'builder_unit_pricing',
  'builder_unit_status_history',
  'builder_units',
];

const query = (sql) =>
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-tAF', '-c', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: '' } })
    .trim().split('\n').filter(Boolean).map((line) => line.split(''));

const tsType = (pgType) => {
  if (/^(int|bigint|smallint|numeric|double|real|decimal)/.test(pgType)) return 'number';
  if (/^bool/.test(pgType)) return 'boolean';
  if (/^json/.test(pgType)) return 'Json';
  if (/\[\]$/.test(pgType)) return 'string[]';
  return 'string';
};

const blocks = [];

for (const table of TABLES) {
  const columns = query(`
    SELECT a.attname,
           format_type(a.atttypid, a.atttypmod),
           a.attnotnull::text,
           (pg_get_expr(d.adbin, d.adrelid) IS NOT NULL)::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = '${table}'
    ORDER BY a.attname;`);

  if (!columns.length) {
    console.error(`FATAL: table ${table} not found in ${DB}. Run verify-phase-1.mjs first.`);
    process.exit(1);
  }

  const rowLines = [];
  const insertLines = [];
  const updateLines = [];

  for (const [name, pgType, notNull, hasDefault] of columns) {
    const type = tsType(pgType);
    // psql renders boolean::text as 'true'/'false', not 't'/'f'.
    const nullable = notNull !== 'true';
    const suffix = nullable ? ' | null' : '';
    rowLines.push(`          ${name}: ${type}${suffix}`);
    // Insert: optional when nullable or defaulted.
    const insertOptional = nullable || hasDefault === 'true';
    insertLines.push(`          ${name}${insertOptional ? '?' : ''}: ${type}${suffix}`);
    updateLines.push(`          ${name}?: ${type}${suffix}`);
  }

  const fks = query(`
    SELECT con.conname, parent.relname,
           (SELECT string_agg(quote_ident(att.attname), '","' ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum),
           (SELECT string_agg(quote_ident(att.attname), '","' ORDER BY k.ord)
              FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum)
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
    WHERE n.nspname = 'public' AND child.relname = '${table}' AND con.contype = 'f'
    ORDER BY con.conname;`);

  const relationships = fks.map(([name, parent, cols, refCols]) => [
    '          {',
    `            foreignKeyName: "${name}"`,
    `            columns: ["${(cols ?? '').replace(/"/g, '')}"]`,
    '            isOneToOne: false',
    `            referencedRelation: "${parent}"`,
    `            referencedColumns: ["${(refCols ?? '').replace(/"/g, '')}"]`,
    '          },',
  ].join('\n')).join('\n');

  blocks.push([
    `      ${table}: {`,
    '        Row: {', ...rowLines, '        }',
    '        Insert: {', ...insertLines, '        }',
    '        Update: {', ...updateLines, '        }',
    relationships ? `        Relationships: [\n${relationships}\n        ]` : '        Relationships: []',
    '      }',
  ].join('\n'));
}

const generated = [BEGIN, ...blocks, END, ''].join('\n');

let source = readFileSync(TYPES_PATH, 'utf8');

// Idempotent: replace a previously generated block rather than stacking.
// BEGIN/END contain parentheses, which must be escaped or the marker never
// matches and each run prepends another copy.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const existing = new RegExp(`${escape(BEGIN)}[\\s\\S]*?${escape(END)}\\n`, 'm');
if (existing.test(source)) {
  source = source.replace(existing, generated);
} else {
  if (!source.includes(ANCHOR)) {
    console.error(`FATAL: anchor not found in types.ts: ${ANCHOR}`);
    process.exit(1);
  }
  source = source.replace(ANCHOR, `${generated}${ANCHOR}`);
}

if (checkOnly) {
  const current = readFileSync(TYPES_PATH, 'utf8');
  if (current !== source) {
    console.error('Supabase types are out of date. Run: node scripts/builder-portal/local-db/generate-builder-types.mjs');
    process.exit(1);
  }
  console.log('Supabase types are up to date.');
  process.exit(0);
}

writeFileSync(TYPES_PATH, source);
console.log(`Spliced ${TABLES.length} Builder table type blocks into src/integrations/supabase/types.ts`);
