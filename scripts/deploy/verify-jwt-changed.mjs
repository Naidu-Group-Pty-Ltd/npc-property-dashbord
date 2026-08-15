#!/usr/bin/env node
/**
 * Print the functions whose `verify_jwt` declaration changed in the last commit.
 *
 * A `verify_jwt` change in `supabase/config.toml` only reaches production if the
 * function it describes is redeployed, and until 15 Aug 2026 nothing made that
 * happen. `config.toml` is in the deploy workflow's `on.push.paths`, so editing
 * it TRIGGERS the workflow — but the changed-function list was built entirely
 * from `supabase/functions/**` paths, so a config-only push produced an EMPTY
 * list and deployed nothing. The declaration then sat unapplied until that
 * function's source happened to change for an unrelated reason.
 *
 * That is the mechanism behind the whole drift class. `agreement-centre-render`
 * read `verify_jwt = true` in the file and was deployed `false`; 91 functions
 * had no block at all — which the CLI reads as `true` — while every one of them
 * ran with the check off.
 *
 * This diffs the DECLARATIONS rather than the file text. Diffing the text would
 * redeploy on a comment edit, and would miss a change made by deleting a block.
 *
 *   node scripts/deploy/verify-jwt-changed.mjs [beforeRev] [afterRev]
 *
 * Prints a space-separated list on one line; empty when nothing changed.
 */
import { execFileSync } from 'node:child_process';

const [beforeRev = 'HEAD^', afterRev = 'HEAD'] = process.argv.slice(2);

/** `[functions.NAME]` … `verify_jwt = true|false` before the next `[section]`. */
export function parseDeclarations(toml) {
  const declared = new Map();
  let current = null;
  for (const line of toml.split('\n')) {
    const trimmed = line.trim();
    const section = /^\[functions\.([A-Za-z0-9_-]+)\]$/.exec(trimmed);
    if (section) { current = section[1]; continue; }
    if (trimmed.startsWith('[')) { current = null; continue; }
    if (!current) continue;
    const value = /^verify_jwt\s*=\s*(true|false)\b/.exec(trimmed);
    if (value) { declared.set(current, value[1]); current = null; }
  }
  return declared;
}

function declarationsAt(rev) {
  try {
    return parseDeclarations(
      execFileSync('git', ['show', `${rev}:supabase/config.toml`], { encoding: 'utf8' }),
    );
  } catch {
    // No such revision (a first commit, a shallow clone without the parent) —
    // treat as "nothing declared" so the diff reports additions rather than
    // failing the deploy.
    return new Map();
  }
}

const before = declarationsAt(beforeRev);
const after = declarationsAt(afterRev);
const changed = [...new Set([...before.keys(), ...after.keys()])]
  .filter((fn) => before.get(fn) !== after.get(fn))
  .sort();

process.stdout.write(`${changed.join(' ')}\n`);
