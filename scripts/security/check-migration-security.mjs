#!/usr/bin/env node
/**
 * WP-17 — the database layer has to hold its own hardening.
 *
 * ## Why this exists
 *
 * `docs/security/REMEDIATION_FINAL_STATUS_2026-07-21.md` closed the backend
 * remediation with three numbers:
 *
 *     security_definer_view                        3 -> 0
 *     *_security_definer_function_executable     116 -> 9
 *     function_search_path_mutable                 8 -> 0
 *
 * Three weeks later the live advisor read **2 / 96 / 5**.
 *
 * Nothing undid those fixes. They were one-off migrations rather than
 * invariants, and 323 migrations landed after them — 136 creating or altering
 * SECURITY DEFINER objects. Postgres grants EXECUTE to PUBLIC at CREATE time and
 * `anon` inherits PUBLIC, so every new SECURITY DEFINER function starts
 * reachable by the publishable key that ships in the browser bundle, and every
 * new view starts reading its base tables with the owner's rights. Nothing in
 * `.github/workflows/` reads `supabase/migrations/**` at all, so the decay was
 * invisible between advisor runs.
 *
 * Every other layer here has a gate. This is the database's.
 *
 * ## Rules
 *
 *   secdef_search_path    CREATE FUNCTION ... SECURITY DEFINER must SET search_path.
 *   secdef_execute        A new SECURITY DEFINER function must REVOKE EXECUTE
 *                         from PUBLIC (revoking from `anon` alone is a no-op —
 *                         that was the RLS-W5 lesson, 20260725096000).
 *   view_security_invoker CREATE VIEW must set security_invoker = true.
 *   table_rls             CREATE TABLE in public/aml must ENABLE ROW LEVEL SECURITY.
 *
 * ## Grandfathering
 *
 * Only migrations at or after BASELINE are checked, the same ratchet
 * `edge-typecheck-baseline.json` and `needs-review-baseline.json` use. The
 * existing corpus is 900+ files and belongs to other programmes; WP-17's own
 * sweep migration cleans up what it left behind. New debt cannot land.
 *
 * Exemptions live in supabase/migrations/MIGRATION_SECURITY_KEEPLIST.json, keyed
 * by OBJECT and never by file — exempting a file exempts everything anyone adds
 * to it later.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source —
// which is precisely the "gate that is not a gate" this suite exists to catch.
const root = resolve(process.cwd());
const MIGRATIONS = join(root, 'supabase', 'migrations');
const KEEPLIST = join(MIGRATIONS, 'MIGRATION_SECURITY_KEEPLIST.json');

/**
 * Migrations from this timestamp on are checked. This is WP-17's own sweep, so
 * the gate holds itself to its rules too. Never move this forward to make a
 * failure go away — that silently un-checks everything in between.
 */
const BASELINE = '20260909000000';

const keeplist = JSON.parse(readFileSync(KEEPLIST, 'utf8'));
const exempt = new Set((keeplist.exemptions ?? []).map((e) => `${e.rule}:${e.object.toLowerCase()}`));
const isExempt = (rule, object) => exempt.has(`${rule}:${String(object).toLowerCase()}`);

/** Comments hide keywords and, worse, contain example SQL. Strip them first. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[^\S\n]*--.*$/gm, ' ')
    .replace(/\s--.*$/gm, ' ');
}

/** `public.foo` / `"public"."foo"` / `foo` -> `public.foo`, lowercased. */
function qualify(raw) {
  const parts = String(raw).split('.').map((p) => p.replace(/["`]/g, '').trim().toLowerCase());
  return parts.length > 1 ? `${parts[0]}.${parts[1]}` : `public.${parts[0]}`;
}

const errors = [];
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && /^\d{14}_/.test(f))
  .filter((f) => f.slice(0, 14) >= BASELINE)
  .sort();

for (const file of files) {
  const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
  const at = (rule, object, message) => {
    if (!isExempt(rule, object)) errors.push(`[${rule}] ${file}: ${message}`);
  };

  // ── Functions ────────────────────────────────────────────────────────────
  // Body-delimited so a `$$ ... $$` block that merely mentions SECURITY DEFINER
  // (WP-17's own catalogue sweep does) is not mistaken for a definition.
  const FUNC = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w".]+)\s*\(([\s\S]*?)\)\s*(RETURNS[\s\S]*?)(?=\bAS\b\s*(?:\$[\w]*\$|')|\bBEGIN\s+ATOMIC\b)/gi;
  for (const m of sql.matchAll(FUNC)) {
    const name = qualify(m[1]);
    const header = m[3];
    if (!/SECURITY\s+DEFINER/i.test(header)) continue;

    if (!/SET\s+search_path\s*(?:=|TO)/i.test(header)) {
      at('secdef_search_path', name,
        `\`${name}\` is SECURITY DEFINER with no \`SET search_path\`. It runs with the definer's `
        + `privileges while the caller decides how unqualified names resolve. Add `
        + `\`SET search_path = public\` (or \`aml, public\`) to the function header.`);
    }

    // Named revoke: `REVOKE EXECUTE ON FUNCTION [schema.]name(...) FROM ... PUBLIC`.
    // Scoped to this function and required to name PUBLIC — a revoke that lists
    // only `anon` is a no-op, since anon inherits EXECUTE through PUBLIC.
    const bare = name.split('.')[1];
    const namedRevoke = new RegExp(
      `REVOKE\\s+(?:ALL|EXECUTE)\\s+(?:PRIVILEGES\\s+)?ON\\s+FUNCTION\\s+[\\w".]*\\b${bare}\\b[^;]*?\\bFROM\\b[^;]*?\\bPUBLIC\\b`,
      'i',
    ).test(sql);

    // Catalogue sweep: a DO block that loops pg_proc on prosecdef and revokes
    // from PUBLIC covers functions it never names. Accepted only when all three
    // parts are present, so "mentions PUBLIC somewhere" cannot pass.
    const catalogueSweep = /\bpg_proc\b/i.test(sql)
      && /\bprosecdef\b/i.test(sql)
      && /REVOKE\s+EXECUTE[^']*?FROM\s+PUBLIC/i.test(sql);

    if (!namedRevoke && !catalogueSweep) {
      at('secdef_execute', name,
        `\`${name}\` is SECURITY DEFINER but this migration never revokes EXECUTE from PUBLIC. `
        + `CREATE grants PUBLIC by default and \`anon\` inherits it, so the function ships reachable `
        + `by the publishable key in the browser bundle. Add `
        + `\`REVOKE EXECUTE ON FUNCTION ${name}(...) FROM PUBLIC, anon, authenticated;\` and grant `
        + `back only the roles that need it. Revoking from \`anon\` alone is a no-op. `
        + `If it must stay client-callable (an RLS predicate, say), add it to `
        + `MIGRATION_SECURITY_KEEPLIST.json with a reason.`);
    }
  }

  // ── Views ────────────────────────────────────────────────────────────────
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)([\s\S]{0,300}?)\bAS\b/gi)) {
    const name = qualify(m[1]);
    if (/MATERIALIZED/i.test(m[0])) continue; // materialized views take no security_invoker
    if (/security_invoker\s*=\s*(?:true|on)/i.test(m[2])) continue;
    const alteredLater = new RegExp(
      `ALTER\\s+VIEW\\s+[\\w".]*${name.split('.')[1]}\\b[\\s\\S]{0,120}?security_invoker\\s*=\\s*(?:true|on)`, 'i',
    ).test(sql);
    if (alteredLater) continue;
    at('view_security_invoker', name,
      `\`${name}\` is created without \`security_invoker = true\`, so it reads its base tables with `
      + `the owner's rights and their RLS never applies to whoever can select the view. Add `
      + `\`WITH (security_invoker = true)\`.`);
  }

  // ── Tables ───────────────────────────────────────────────────────────────
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi)) {
    const name = qualify(m[1]);
    const [schema, bare] = name.split('.');
    if (!['public', 'aml'].includes(schema)) continue;
    const enabled = new RegExp(
      `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?[\\w".]*\\b${bare}\\b[\\s\\S]{0,120}?ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i',
    ).test(sql);
    if (!enabled) {
      at('table_rls', name,
        `\`${name}\` is created without \`ENABLE ROW LEVEL SECURITY\` in the same migration. `
        + `PostgREST exposes it, so any role holding a table grant can read and write every row. `
        + `Enable RLS and add policies — or, if it is service-role-only (the dominant convention `
        + `here), enable RLS and add none, which denies every other role.`);
    }
  }
}

// A stale exemption is the same failure wearing a note.
const today = new Date().toISOString().slice(0, 10);
for (const e of keeplist.exemptions ?? []) {
  if (e.review_by && e.review_by < today) {
    errors.push(
      `[keeplist] ${e.object}: exemption for \`${e.rule}\` passed its review_by (${e.review_by}). `
      + `Re-confirm the reason and move the date, or remove the entry.`);
  }
  if (!e.reason || e.reason.length < 20) {
    errors.push(`[keeplist] ${e.object}: exemption for \`${e.rule}\` has no usable reason.`);
  }
}

if (errors.length) {
  console.error('Migration security check FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\nChecked ${files.length} migration(s) at or after ${BASELINE}.`);
  process.exit(1);
}
console.log(
  `Migration security check passed (${files.length} migration(s) at or after ${BASELINE}; `
  + `${exempt.size} reviewed exemption(s)).`,
);
