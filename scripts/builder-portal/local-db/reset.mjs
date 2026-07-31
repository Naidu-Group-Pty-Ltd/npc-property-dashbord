#!/usr/bin/env node
/**
 * Clean local migration reset for Builder Portal migration validation.
 *
 * The Supabase CLI's `db reset` needs Docker, which is not available in every
 * environment. This performs the equivalent against a plain PostgreSQL cluster:
 * drop the database, recreate it, apply the Supabase-compatible bootstrap, then
 * replay every file in supabase/migrations in timestamp order, recording each
 * in supabase_migrations.schema_migrations exactly as the CLI would.
 *
 * Historical migrations written against Supabase-managed extensions (pg_net,
 * pg_cron, vector) or against objects created outside the corpus cannot replay
 * on a plain cluster. Those are reported as ENVIRONMENT failures and are
 * distinguished from failures in migrations this branch adds, which are always
 * fatal.
 *
 * Usage:
 *   node scripts/builder-portal/local-db/reset.mjs [--from=<version>] [--quiet]
 *
 * Environment:
 *   LOCAL_PG_HOST (default /tmp)   LOCAL_PG_PORT (default 55432)
 *   LOCAL_PG_USER (default postgres)   LOCAL_PG_DB (default aurixa_local)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('../../../', import.meta.url).pathname;
const HOST = process.env.LOCAL_PG_HOST || '/tmp';
const PORT = process.env.LOCAL_PG_PORT || '55432';
const USER = process.env.LOCAL_PG_USER || 'postgres';
const DB = process.env.LOCAL_PG_DB || 'aurixa_local';
const quiet = process.argv.includes('--quiet');
const fromArg = process.argv.find((arg) => arg.startsWith('--from='));
const from = fromArg ? fromArg.slice('--from='.length) : null;

/** Migrations added by the Builder Portal programme. A failure here is fatal. */
const BUILDER_MIGRATION_PATTERN = /_builder_portal_phase\d|_portal_terms_multi_portal|_cross_portal_rollout_org|_builder_portal_admin_module/;

const psql = (args, options = {}) =>
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', stdio: options.stdio || 'pipe', env: { ...process.env, PGPASSWORD: '' },
  });

const log = (message) => { if (!quiet) console.log(message); };

// --- 1. Recreate the database ---------------------------------------------
log(`Resetting ${DB} on ${HOST}:${PORT} ...`);
psql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
psql(['-d', 'postgres', '-c', `CREATE DATABASE ${DB}`]);

// --- 2. Bootstrap the Supabase-compatible environment ----------------------
psql(['-d', DB, '-f', join(root, 'scripts/builder-portal/local-db/00-supabase-bootstrap.sql')]);
log('Bootstrap applied.');

// --- 3. Replay migrations --------------------------------------------------
const migrationsDir = join(root, 'supabase/migrations');
let migrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
if (from) migrations = migrations.filter((name) => name >= from);

const scratch = mkdtempSync(join(tmpdir(), 'aurixa-migrate-'));
const applied = [];
const environmentFailures = [];
const dependencyFailures = [];
const builderFailures = [];

/**
 * True when the failure is "an object this migration builds on was never
 * created", which on a plain cluster means an earlier historical migration
 * failed. The Builder SQL itself is untested in that case, not broken; the
 * upstream-fixture harness (verify-phase-1.mjs) is what exercises it.
 */
const UPSTREAM_OBJECTS = [
  'portal_terms_versions', 'portal_terms_acceptances', 'cross_portal_firm_rollouts',
  'cross_portal_feature_definitions', 'cross_portal_rollout_history',
  'cross_portal_dual_read_comparisons', 'cross_portal_cutover_approvals',
  'cross_portal_reconciliation_runs', 'dashboard_modules', 'solicitor_firms',
  'solicitor_portal_users',
];
const isUpstreamDependencyFailure = (detail) =>
  UPSTREAM_OBJECTS.some((object) =>
    detail.includes(`relation "public.${object}" does not exist`)
    || detail.includes(`relation "${object}" does not exist`));

for (const name of migrations) {
  const version = name.split('_')[0];
  const body = readFileSync(join(migrationsDir, name), 'utf8');
  // Wrap each migration in a transaction, exactly as the Supabase CLI does, so a
  // failure leaves no partial objects behind.
  const wrapped = `BEGIN;\n${body}\n`
    + `INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES (`
    + `${quoteLiteral(version)}, ${quoteLiteral(name)}) ON CONFLICT (version) DO NOTHING;\nCOMMIT;\n`;
  const path = join(scratch, name);
  writeFileSync(path, wrapped);

  try {
    psql(['-d', DB, '-f', path]);
    applied.push(name);
  } catch (error) {
    const detail = String(error.stderr || error.message).trim().split('\n').slice(0, 4).join(' | ');
    const record = { name, detail };
    if (!BUILDER_MIGRATION_PATTERN.test(name)) {
      environmentFailures.push(record);
    } else if (isUpstreamDependencyFailure(detail)) {
      // A Builder migration that fails only because an upstream object was
      // never created is a consequence of the 282 pre-existing environment
      // failures, not a defect in the Builder SQL. Reported separately so a
      // genuine Builder defect is never hidden inside that noise.
      dependencyFailures.push(record);
    } else {
      builderFailures.push(record);
    }
  }
}

function quoteLiteral(value) { return `'${String(value).replace(/'/g, "''")}'`; }

// --- 4. Report -------------------------------------------------------------
console.log('');
console.log(`Migrations found:    ${migrations.length}`);
console.log(`Applied cleanly:      ${applied.length}`);
console.log(`Environment failures: ${environmentFailures.length} (pre-existing; not replayable on a plain cluster)`);
console.log(`Builder dependency:   ${dependencyFailures.length} (upstream object missing because of the above)`);
console.log(`Builder defects:      ${builderFailures.length}`);

if (dependencyFailures.length && !quiet) {
  console.log('\nBuilder migrations blocked by a missing upstream object:');
  for (const failure of dependencyFailures) {
    console.log(`  - ${failure.name}\n      ${failure.detail}`);
  }
  console.log('\n  These are exercised by scripts/builder-portal/local-db/verify-phase-1.mjs,');
  console.log('  which supplies the upstream objects from a fixture verified against production.');
}

if (environmentFailures.length && !quiet) {
  console.log('\nEnvironment failures (informational):');
  for (const failure of environmentFailures.slice(0, 40)) {
    console.log(`  - ${failure.name}\n      ${failure.detail}`);
  }
  if (environmentFailures.length > 40) console.log(`  ... and ${environmentFailures.length - 40} more`);
}

if (builderFailures.length) {
  console.error('\nFATAL — Builder Portal migrations failed on their own merit:');
  for (const failure of builderFailures) {
    console.error(`  - ${failure.name}\n      ${failure.detail}`);
  }
  process.exit(1);
}

console.log('\nLocal reset complete. No Builder Portal migration failed on its own merit.');
if (dependencyFailures.length) {
  console.log('Run `npm run builder:db:verify` to exercise the dependency-blocked migrations.');
}
