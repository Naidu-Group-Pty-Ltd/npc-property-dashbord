#!/usr/bin/env node
/**
 * Type-check every Edge Function entry point (WP-14).
 *
 * ## This gate was passing by not running
 *
 * `deno check` was failing before it type-checked anything:
 *
 *     error: Could not find "@supabase/supabase-js" in a node_modules folder.
 *            Deno expects the node_modules/ directory to be up to date.
 *         at supabase/functions/agent-insights-runner/index.ts:6:30
 *
 * Nothing was wrong with that function. `npm ci` creates `node_modules`, and
 * Deno then switches to "bring your own node_modules" resolution, where a
 * versioned `npm:` specifier has to agree with `package.json`. **49 functions
 * use versioned specifiers**, including `npm:@supabase/supabase-js@2.45.0`
 * against a `package.json` declaring `^2.55.0`. Edge functions do not deploy
 * against `node_modules` at all — they run on Deno Deploy, which resolves
 * `npm:` from the registry — so the frontend's install directory has no
 * business in this check.
 *
 * `DENO_NO_PACKAGE_JSON=1` takes `package.json` out of scope, which is both the
 * fix and an accurate description of the deployment target.
 *
 * That failure has been masking the gate for a long time — the job it lives in
 * failed at an earlier step for months, so nobody saw this one fail either.
 *
 * ## Why a baseline
 *
 * With resolution fixed, the check reports **430 pre-existing type errors
 * across 410 files** — years of accumulated drift in code nobody was being told
 * about. Fixing them is not one change, and most of them belong to other
 * programmes.
 *
 * So this ratchets rather than blocks, the same way
 * `scripts/audit-style-tokens.cjs` does for hardcoded styles and
 * `needs-review-baseline.json` does for the security registry: the current
 * count per file is frozen in `edge-typecheck-baseline.json`, and the gate
 * fails when a file gains an error or a clean file acquires one. Existing debt
 * is visible and capped; new debt cannot land.
 *
 * Lower a number whenever you fix something — `--update` rewrites the baseline,
 * and the committed file is the record of the backlog shrinking.
 *
 *   node scripts/security/check-edge-functions.mjs            # check
 *   node scripts/security/check-edge-functions.mjs --update   # rewrite baseline
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const functionsDir = join(root, 'supabase', 'functions');
const BASELINE_PATH = join(root, 'supabase', 'functions-registry', 'edge-typecheck-baseline.json');
const update = process.argv.includes('--update');

const entries = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const index = join(functionsDir, entry.name, 'index.ts');
    try { return statSync(index).isFile() ? [index] : []; } catch { return []; }
  }).sort();

const result = spawnSync('deno', ['check', ...entries], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  // See the header: the frontend's node_modules must not be in scope.
  env: { ...process.env, DENO_NO_PACKAGE_JSON: '1' },
});
if (result.error) {
  console.error(`Edge Function check could not start: ${result.error.message}`);
  process.exit(1);
}

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
// Deno prints colour codes even when piped; strip them before matching.
const plain = output.replace(/\[[0-9;]*m/g, '');

/**
 * A resolution failure is not a type error and must never be baselined — it
 * means the check did not run, which is exactly the state this file was in.
 */
const RESOLUTION_FAILURE =
  /^error: (Could not find|Failed resolving types|Relative import path|Module not found|Import '[^']*' failed)/m;
if (RESOLUTION_FAILURE.test(plain)) {
  console.error('Edge Function check could not resolve its dependencies — it did not type-check anything:\n');
  console.error(plain.split('\n').filter((line) => line.startsWith('error:')).slice(0, 5).join('\n'));
  process.exit(1);
}

/** `at file:///…/supabase/functions/<name>/…` — the file an error was reported in. */
const AT_FILE = /at file:\/\/(\S+?):\d+:\d+/g;
const counts = new Map();
for (const block of plain.split(/(?=^TS\d+ \[ERROR\])/m)) {
  if (!/^TS\d+ \[ERROR\]/.test(block)) continue;
  const at = [...block.matchAll(AT_FILE)][0];
  if (!at) continue;
  const file = relative(root, at[1]).replace(/\\/g, '/');
  counts.set(file, (counts.get(file) ?? 0) + 1);
}

const observed = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
const total = Object.values(observed).reduce((sum, n) => sum + n, 0);

/**
 * Deno failed, and produced no type errors while doing it. That is not a clean
 * tree — it is a check that never ran.
 *
 * The named-pattern guard above has to predict how Deno phrases each failure,
 * and it did not predict this one:
 *
 *     error: Import 'https://esm.sh/...' failed: 408 Request Timeout
 *
 * A transient registry blip therefore reported **0 errors across 421 entry
 * points** and passed. Worse, `--update` would have banked that zero, freezing
 * a gate that checks nothing into the repository as a perfect score. That was
 * one command away from happening.
 *
 * This guard needs no such prediction. When there are real type errors Deno
 * also exits non-zero, so the two cases are separated by whether anything was
 * parsed out — not by the wording of the message.
 */
if (result.status !== 0 && total === 0) {
  console.error(
    `Edge Function check did not run: deno exited ${result.status} and reported no type errors.\n`
    + 'That is a failure to type-check, not a clean tree — refusing to report (or bank) zero.\n',
  );
  console.error(plain.split('\n').filter((l) => l.startsWith('error:')).slice(0, 5).join('\n'));
  process.exit(1);
}

if (update) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({
    $comment:
      'WP-14: per-file type-error counts for supabase/functions entry points, frozen so new '
      + 'errors fail CI while the existing backlog is worked down. Regenerate with '
      + '`node scripts/security/check-edge-functions.mjs --update`. Numbers may only go down.',
    generated_total: total,
    files: observed,
  }, null, 2)}\n`);
  console.log(`Wrote baseline: ${Object.keys(observed).length} files, ${total} errors.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`Missing or unreadable baseline at ${relative(root, BASELINE_PATH)}. Run with --update.`);
  process.exit(1);
}
const allowed = baseline.files ?? {};
const baselineTotal = Object.values(allowed).reduce((sum, n) => sum + Number(n || 0), 0);

const regressions = [];
for (const [file, count] of Object.entries(observed)) {
  const permitted = Number(allowed[file] ?? 0);
  if (count > permitted) regressions.push({ file, count, permitted });
}
const improvements = Object.entries(allowed)
  .filter(([file, permitted]) => (observed[file] ?? 0) < Number(permitted))
  .map(([file, permitted]) => ({ file, count: observed[file] ?? 0, permitted }));

console.log(
  `Edge Function type-check: ${entries.length} entry points, ${total} errors `
  + `(baseline ${baselineTotal}).`,
);

if (regressions.length) {
  console.error('\nEdge Function type-check FAILED — new type errors:\n');
  for (const { file, count, permitted } of regressions) {
    console.error(` - ${file}: ${permitted} → ${count}`);
  }
  console.error(
    '\nFix them, or if a file was legitimately rewritten, re-run with --update and '
    + 'explain the new number in the commit.',
  );
  process.exit(1);
}

if (improvements.length) {
  console.log(`\n${improvements.length} file(s) improved on the baseline:`);
  for (const { file, count, permitted } of improvements.slice(0, 20)) {
    console.log(` - ${file}: ${permitted} → ${count}`);
  }
  console.log('\nRun with --update to bank the improvement.');
}

console.log('Edge Function type-check passed (no new errors).');
process.exit(0);
