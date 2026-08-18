#!/usr/bin/env node
/**
 * Generates the Dart edge-function catalogue from `mobile/api-surface.json`.
 *
 * `mobileScope` on each function is what decides which app may call it
 * (mobile/plan.md R-ARCH-4). Emitting the classification as Dart constants is
 * what lets `check-api-scope.mjs` enforce it mechanically instead of by review
 * — a Command Centre build that names a `portal` function fails, and so does a
 * portal build that names a `staff` one.
 *
 * `server-only` functions are emitted too, as an explicit deny-list. They are
 * never callable from any client, and naming them is more useful than omitting
 * them: a developer who reaches for one gets told why it is refused.
 *
 * Run:   npm run mobile:dart:api
 * Check: npm run mobile:dart:api:check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');
const SRC = join(REPO, 'mobile', 'api-surface.json');
const OUT = join(REPO, 'mobile', 'packages', 'npc_api', 'lib', 'src', 'functions.g.dart');

function build() {
  const src = JSON.parse(readFileSync(SRC, 'utf8'));
  const byScope = { staff: [], portal: [], public: [], 'server-only': [] };
  for (const fn of src.functions) {
    if (byScope[fn.mobileScope]) byScope[fn.mobileScope].push(fn.name);
  }
  for (const k of Object.keys(byScope)) byScope[k].sort();

  const set = (names) =>
    names.length ? names.map((n) => `    '${n}',`).join('\n') : '';

  return `// GENERATED — do not edit. Run \`npm run mobile:dart:api\`.
//
// Source: mobile/api-surface.json (generated from the audited security
// registry). \`mobileScope\` decides which app may call which function —
// see mobile/plan.md R-ARCH-4 and scripts/mobile/check-api-scope.mjs.
//
// Counts: staff ${byScope.staff.length} · portal ${byScope.portal.length} · public ${byScope.public.length} · server-only ${byScope['server-only'].length}
//
// This file's shape is owned by its generator; formatting it would make it
// disagree with the drift check, so the formatter is told to leave it alone.
// dart format off

/// Which family of apps a function belongs to.
enum NpcFunctionScope {
  /// Command Centre only.
  staff,

  /// The four portal apps only.
  portal,

  /// Any app — unauthenticated or pre-auth surfaces.
  public,

  /// No client, ever. Present so a refusal can explain itself.
  serverOnly,
}

/// The edge-function catalogue, classified by scope.
///
/// This is a contract, not a convenience: calling a function outside the
/// running app's scope is a build failure, because the alternative is a
/// client that reaches an endpoint its session can never satisfy and fails
/// at runtime in front of a user.
class NpcFunctions {
  const NpcFunctions._();

  /// Command Centre surface.
  static const Set<String> staff = <String>{
${set(byScope.staff)}
  };

  /// Client / finance / solicitor / builder surface.
  static const Set<String> portal = <String>{
${set(byScope.portal)}
  };

  /// Callable from any app.
  static const Set<String> public = <String>{
${set(byScope.public)}
  };

  /// Never callable from a device.
  static const Set<String> serverOnly = <String>{
${set(byScope['server-only'])}
  };

  /// Everything a [scope] app is permitted to call, including [public].
  static Set<String> allowedFor(NpcFunctionScope scope) {
    switch (scope) {
      case NpcFunctionScope.staff:
        return <String>{...staff, ...public};
      case NpcFunctionScope.portal:
        return <String>{...portal, ...public};
      case NpcFunctionScope.public:
        return public;
      case NpcFunctionScope.serverOnly:
        return const <String>{};
    }
  }

  /// The scope a function belongs to, or null if the registry does not know it.
  static NpcFunctionScope? scopeOf(String name) {
    if (staff.contains(name)) return NpcFunctionScope.staff;
    if (portal.contains(name)) return NpcFunctionScope.portal;
    if (public.contains(name)) return NpcFunctionScope.public;
    if (serverOnly.contains(name)) return NpcFunctionScope.serverOnly;
    return null;
  }
}
`;
}

const generated = build();
if (process.argv.includes('--check')) {
  let current = null;
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing counts as drift */ }
  if (current !== generated) {
    console.error('✖ npc_api functions.g.dart is out of date with mobile/api-surface.json.');
    console.error('  Run `npm run mobile:dart:api` and commit the result.');
    process.exit(1);
  }
  console.log('✓ Dart function catalogue matches api-surface.json');
} else {
  writeFileSync(OUT, generated);
  console.log(`→ ${OUT.replace(REPO + '/', '')}`);
}
