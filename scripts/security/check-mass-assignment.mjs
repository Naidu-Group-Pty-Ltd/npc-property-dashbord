#!/usr/bin/env node
/**
 * WP-20 — a request body may not choose which columns get written.
 *
 * ## The shape of it
 *
 * Several operations took a sub-object off the request and wrote it straight to
 * a table:
 *
 *     const a = body.alert ?? {};
 *     aml.from('alerts').update(a).eq('id', a.id)
 *
 * Every column the caller named got written, including ones no UI exposes. In
 * `aml.alerts` that reached `resolved_by` and `resolved_at` — the record of who
 * closed an alert and when. These sit behind `requireWrite()`/MLRO gates, so it
 * is not an anonymous hole; it is an authorised user reaching past the workflow,
 * and in an AML file that is a compliance problem rather than a data-quality
 * one.
 *
 * The fix is a field allowlist at the write — `pickAllowed` from
 * `_shared/wp09Guards.ts`, with the columns declared in a module next to the
 * function. Not a denylist: `delete payload.id; delete payload.user_id` leaves
 * every column nobody thought of writable, and the set of columns nobody thought
 * of grows every migration.
 *
 * ## Why this ratchets
 *
 * 90 write sites derive from a request body. Most are already laundered through
 * `pickAllowed`, `pickKnownColumns`, `buildMatterPayload` and friends; the
 * remainder need a per-table decision about which columns are legitimately
 * writable, which is product knowledge and not one change. So the current set is
 * frozen in `supabase/functions-registry/mass-assignment-baseline.json` and the
 * gate fails on anything NEW — the same ratchet `edge-typecheck-baseline.json`
 * uses. Existing debt is visible and capped; it cannot grow.
 *
 * Lower the count whenever you allowlist one — `--update` rewrites the baseline,
 * and the committed file is the record of the backlog shrinking.
 *
 *   node scripts/security/check-mass-assignment.mjs           # check
 *   node scripts/security/check-mass-assignment.mjs --update  # re-freeze
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// cwd, not import.meta.url — the negative-test harness mutates a mirror.
const root = resolve(process.cwd());
const FUNC_DIR = join(root, 'supabase', 'functions');
const BASELINE = join(root, 'supabase', 'functions-registry', 'mass-assignment-baseline.json');
const update = process.argv.includes('--update');

/** Helpers that return an allowlisted object. A write fed by one is fine. */
const LAUNDERERS = /pickAllowed|pickKnownColumns|pickEditable|sanitize[A-Z]|normalise[A-Z]\w*Payload|build[A-Z]\w*Payload|mapPayload|WRITABLE|_COLUMNS\b|_FIELDS\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.pure.ts')) out.push(p);
  }
  return out;
}

const found = new Map(); // relative path -> count

for (const file of walk(FUNC_DIR)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  let count = 0;

  for (const m of src.matchAll(
    /\.(?:insert|update|upsert)\(\s*(?:\{\s*\.\.\.\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*[,)])/g,
  )) {
    const varName = m[1] || m[2];
    if (!varName) continue;

    // How is it defined in this file? Follow bare-identifier aliases, because
    // `const alertRow = a;` where `a = body.alert` is still the caller's object
    // — the first version of this gate stopped at the alias and its own
    // negative test walked straight through it.
    const define = (name) => new RegExp(
      `\\b(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]*)?=\\s*([^\\n;]{0,180})`,
    ).exec(src)?.[1] ?? '';

    let rhs = define(varName);
    const seen = new Set([varName]);
    for (let hop = 0; hop < 4; hop++) {
      const alias = rhs.trim().match(/^([A-Za-z_$][\w$]*)$/);
      if (!alias || seen.has(alias[1])) break;
      seen.add(alias[1]);
      rhs = define(alias[1]);
    }

    // Only request-derived values are in scope. A locally-built object
    // (`const patch = { status: 'processing' }`) is the author's, not the
    // caller's.
    const bodyDerived = /\bbody\b|req\.json\(\)|\bpayload\b|\.data\b/.test(rhs)
      || ['body', 'payload'].includes(varName);
    if (!bodyDerived) continue;

    // Laundered at definition, or by a helper named on the same line as the write?
    if (LAUNDERERS.test(rhs) || LAUNDERERS.test(m[0])) continue;

    // Laundered on the way in — `const row = pickAllowed(rule, X)` two lines up
    // then `insert(row)` — is covered by the rhs test above. What is NOT covered
    // is a write of the raw variable when a *different* variable was laundered,
    // which is the bug this is looking for.
    count++;
  }
  if (count) found.set(rel, count);
}

const total = [...found.values()].reduce((a, b) => a + b, 0);

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify({
    $comment: 'WP-20: per-file count of writes fed by an unallowlisted request body. '
      + 'Frozen so new mass-assignment cannot land while the existing backlog is worked down. '
      + 'Regenerate with `node scripts/security/check-mass-assignment.mjs --update`. Numbers may only go down.',
    generated_total: total,
    files: Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b))),
  }, null, 2)}\n`);
  console.log(`Wrote baseline: ${found.size} files, ${total} sites.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`Mass-assignment check could not read ${relative(root, BASELINE)}. Run with --update to create it.`);
  process.exit(1);
}

const previous = baseline.files ?? {};
const regressions = [];
const improvements = [];
for (const [file, count] of found) {
  const was = previous[file] ?? 0;
  if (count > was) regressions.push(`${file}: ${was} → ${count}`);
}
for (const [file, was] of Object.entries(previous)) {
  const now = found.get(file) ?? 0;
  if (now < was) improvements.push(`${file}: ${was} → ${now}`);
}

console.log(`Mass-assignment: ${total} request-derived write(s) without a field allowlist (baseline ${baseline.generated_total}).`);

if (regressions.length) {
  console.error('\nMass-assignment check FAILED — new unallowlisted writes:\n');
  for (const r of regressions) console.error(`  - ${r}`);
  console.error(
    '\nA request body must not choose which columns get written. Filter it with '
    + '`pickAllowed(input, COLUMNS)` from _shared/wp09Guards.ts and declare the columns '
    + '(see _shared/amlWritableColumns.ts). A denylist is not equivalent: it leaves every '
    + 'column nobody thought of writable, and that set grows every migration.',
  );
  process.exit(1);
}

if (improvements.length) {
  console.log(`\n${improvements.length} file(s) improved on the baseline:`);
  for (const i of improvements) console.log(`  - ${i}`);
  console.log('\nRun with --update to bank the improvement.');
}
console.log('Mass-assignment check passed (no new unallowlisted writes).');
