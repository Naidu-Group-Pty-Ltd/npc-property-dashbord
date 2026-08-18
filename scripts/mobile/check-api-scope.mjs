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

/**
 * Which scope each app may reach, and which functions within it.
 *
 * The scope alone is too coarse. All four portal apps are `portal` scope, so a
 * scope-only check happily let the client app call `builder-portal-inventory` —
 * four separate products, four separate audiences, one shared authority, which
 * is exactly what this gate exists to prevent. `prefixes` narrows each app to
 * the functions its own portal owns; `null` means the whole scope (the Command
 * Centre owns all of `staff`).
 *
 * `shared` names the deliberate exceptions — functions more than one caller
 * reaches, which dispatch on session type inside the function.
 */
const APP_SCOPES = {
  command_centre: { scope: 'staff', prefixes: null },
  client: {
    scope: 'portal',
    prefixes: [
      'client-portal-', 'client-legal-', 'get-portal-', 'manage-portal-', 'portal-',
    ],
    shared: ['push-subscribe'],
  },
  finance: {
    scope: 'portal',
    prefixes: ['finance-portal-', 'finance-legal-'],
    shared: ['manage-partner-referrals'],
  },
  solicitor: { scope: 'portal', prefixes: ['solicitor-portal-'] },
  builder: { scope: 'portal', prefixes: ['builder-portal-'] },
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
for (const [app, rule] of Object.entries(APP_SCOPES)) {
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
        continue;
      }
      if (scope === 'public') continue;
      if (scope !== rule.scope) {
        console.error(
          `✖ ${rel}: "${name}" is ${scope} scope; ${app} may only call ${rule.scope} or public.`,
        );
        failures++;
        continue;
      }
      if (rule.prefixes === null) continue;
      const owned = rule.prefixes.some((prefix) => name.startsWith(prefix))
        || (rule.shared ?? []).includes(name);
      if (!owned) {
        console.error(
          `✖ ${rel}: "${name}" is ${scope} scope but belongs to another portal, not ${app}.`,
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
