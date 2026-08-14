#!/usr/bin/env node
/**
 * Enforces mobile/plan.md R-ARCH-4: an app may only name edge functions in its
 * own scope.
 *
 * This is the build-time half of the rule. `NpcApiClient` also refuses at
 * runtime, but a runtime refusal is a crash in front of a user; the point of
 * `mobileScope` existing as a field is that the check can be mechanical.
 *
 * It scans each app's Dart sources for string literals passed to `invoke(…)`
 * and compares them against the scope declared for that app below. A literal
 * that names no known function is also a failure — a typo'd function name is
 * indistinguishable from a call to something that does not exist.
 *
 * Run: npm run mobile:scope:check
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');
const APPS = join(REPO, 'mobile', 'apps');

/** Which scope each app target is allowed to reach. */
const APP_SCOPES = {
  command_centre: 'staff',
  client: 'portal',
  finance: 'portal',
  solicitor: 'portal',
  builder: 'portal',
};

const surface = JSON.parse(
  readFileSync(join(REPO, 'mobile', 'api-surface.json'), 'utf8'),
);
const scopeOf = new Map(surface.functions.map((f) => [f.name, f.mobileScope]));

function dartFiles(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...dartFiles(full));
    else if (entry.endsWith('.dart') && !entry.endsWith('.g.dart')) out.push(full);
  }
  return out;
}

let failures = 0;
for (const [app, allowedScope] of Object.entries(APP_SCOPES)) {
  const files = dartFiles(join(APPS, app, 'lib'));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // `invoke('name'` / `invoke("name"` — the single entry point in NpcApiClient.
    for (const match of source.matchAll(/\binvoke\(\s*['"]([a-z0-9-]+)['"]/gi)) {
      const name = match[1];
      const scope = scopeOf.get(name);
      const rel = file.replace(REPO + '/', '');
      if (scope === undefined) {
        console.error(`✖ ${rel}: "${name}" is not in the audited registry.`);
        failures++;
      } else if (scope !== allowedScope && scope !== 'public') {
        console.error(
          `✖ ${rel}: "${name}" is ${scope} scope; ${app} may only call ${allowedScope} or public.`,
        );
        failures++;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} out-of-scope edge-function reference(s). See mobile/plan.md R-ARCH-4.`);
  process.exit(1);
}
console.log('✓ every edge-function reference is within its app\'s scope');
