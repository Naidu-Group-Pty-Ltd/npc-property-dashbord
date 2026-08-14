#!/usr/bin/env node
/**
 * Generates the Dart design tokens from `mobile/design-tokens.json`.
 *
 * `export-design-tokens.mjs` deliberately exports values verbatim — HSL
 * triplets, `var(--…)` references and CSS constructs alike — because resolving
 * them there would bake light-mode values into expressions the dark theme needs
 * to re-point. Resolution is this script's job, and its output is the
 * `npc_design_system` package's token table.
 *
 * Every token in the JSON reaches Dart. A token this script cannot type is
 * emitted as a raw string rather than dropped, because a token that silently
 * disappears between web and mobile is exactly the drift these generators
 * exist to prevent — `tokens_coverage_test.dart` asserts the count matches.
 *
 * Classification:
 *   `H S% L%`                        → Color        (colors)
 *   `<n>px` / `<n>rem` / `<n>`       → double       (lengths)
 *   `<n>ms` / `<n>s`                 → Duration     (durations)
 *   `var(--x)`                       → resolved, then reclassified
 *   anything else (gradients,
 *   shadow lists, font stacks)       → String       (raw)
 *
 * Run:   npm run mobile:dart:tokens
 * Check: npm run mobile:dart:tokens:check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');
const SRC = join(REPO, 'mobile', 'design-tokens.json');
const OUT = join(REPO, 'mobile', 'packages', 'npc_design_system', 'lib', 'src', 'tokens.g.dart');

const HSL = /^(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%$/;
const LENGTH = /^(-?[\d.]+)(px|rem)?$/;
const DURATION = /^(-?[\d.]+)(ms|s)$/;
const VAR_ONLY = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/;

/** Resolve `var(--x)` chains within a theme, falling back to light. */
function resolveValue(raw, theme, light, seen = new Set()) {
  const m = String(raw).match(VAR_ONLY);
  if (!m) return raw;
  const key = m[1];
  if (seen.has(key)) return raw; // cycle — leave it raw rather than loop
  seen.add(key);
  const next = theme[key] ?? light[key];
  return next === undefined ? raw : resolveValue(next, theme, light, seen);
}

function hslToArgb(h, s, l) {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = ln - c / 2;
  const to = (v) => Math.round(Math.min(255, Math.max(0, (v + m) * 255)));
  return (0xff << 24 | to(r1) << 16 | to(g1) << 8 | to(b1)) >>> 0;
}

/** `--accent-foreground` → `accentForeground` */
function dartName(cssName) {
  return cssName.replace(/^--/, '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

const escape = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, ' ');

function classify(value) {
  const v = String(value).trim();
  let m;
  if ((m = v.match(HSL))) {
    return { kind: 'color', dart: `Color(0x${hslToArgb(+m[1], +m[2], +m[3]).toString(16).padStart(8, '0')})` };
  }
  if ((m = v.match(DURATION))) {
    const ms = m[2] === 's' ? Math.round(+m[1] * 1000) : Math.round(+m[1]);
    return { kind: 'duration', dart: `Duration(milliseconds: ${ms})` };
  }
  if ((m = v.match(LENGTH))) {
    // rem is relative to the 16px root the web sets on :root.
    const px = m[2] === 'rem' ? +m[1] * 16 : +m[1];
    return { kind: 'length', dart: Number.isInteger(px) ? `${px}.0` : `${px}` };
  }
  return { kind: 'raw', dart: `'${escape(v)}'` };
}

function emitTheme(name, theme, light) {
  const buckets = { color: [], length: [], duration: [], raw: [] };
  for (const [cssName, rawValue] of Object.entries(theme)) {
    const resolved = resolveValue(rawValue, theme, light);
    const { kind, dart } = classify(resolved);
    buckets[kind].push(`      '${cssName}': ${dart},`);
  }
  const map = (k, type) =>
    buckets[k].length ? `    ${k}s: <String, ${type}>{\n${buckets[k].join('\n')}\n    },`
                      : `    ${k}s: const <String, ${type}>{},`;
  return `  /// ${name} — ${Object.keys(theme).length} tokens from design-tokens.json.
  static const NpcTokenSet ${name} = NpcTokenSet(
    name: '${name}',
${map('color', 'Color')}
${map('length', 'double')}
${map('duration', 'Duration')}
${map('raw', 'String')}
  );`;
}

function build() {
  const src = JSON.parse(readFileSync(SRC, 'utf8'));
  const light = src.themes.light;
  const themes = Object.entries(src.themes)
    .map(([name, theme]) => emitTheme(name, theme, light))
    .join('\n\n');
  const counts = Object.entries(src.themes)
    .map(([n, t]) => `//   ${n}: ${Object.keys(t).length}`)
    .join('\n');

  return `// GENERATED — do not edit. Run \`npm run mobile:dart:tokens\`.
//
// Source: mobile/design-tokens.json (itself generated from src/styles/*.css).
// Every token in that file appears here; values this generator cannot type are
// carried as raw strings so nothing is lost between web and mobile.
//
// Token counts:
${counts}
//
// ignore_for_file: lines_longer_than_80_chars
//
// This file's shape is owned by its generator; formatting it would make it
// disagree with the drift check, so the formatter is told to leave it alone.
// dart format off

import 'dart:ui' show Color;

/// One resolved theme's tokens, split by the Dart type each value became.
class NpcTokenSet {
  const NpcTokenSet({
    required this.name,
    required this.colors,
    required this.lengths,
    required this.durations,
    required this.raws,
  });

  final String name;
  final Map<String, Color> colors;
  final Map<String, double> lengths;
  final Map<String, Duration> durations;
  final Map<String, String> raws;

  /// Total tokens carried, across every bucket. Compared against
  /// design-tokens.json by \`tokens_coverage_test.dart\`.
  int get tokenCount =>
      colors.length + lengths.length + durations.length + raws.length;

  /// Every token name this set carries.
  Iterable<String> get tokenNames =>
      <String>[...colors.keys, ...lengths.keys, ...durations.keys, ...raws.keys];
}

/// The generated token tables, one per theme exported from the web app.
class NpcTokens {
${themes}

  /// Every generated theme, keyed by the name the web export used.
  static const Map<String, NpcTokenSet> all = <String, NpcTokenSet>{
${Object.keys(src.themes).map((n) => `    '${n}': ${n},`).join('\n')}
  };
}
`;
}

const generated = build();
if (process.argv.includes('--check')) {
  let current = null;
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing counts as drift */ }
  if (current !== generated) {
    console.error('✖ npc_design_system tokens.g.dart is out of date with mobile/design-tokens.json.');
    console.error('  Run `npm run mobile:dart:tokens` and commit the result.');
    process.exit(1);
  }
  console.log('✓ Dart design tokens match design-tokens.json');
} else {
  writeFileSync(OUT, generated);
  const n = JSON.parse(readFileSync(SRC, 'utf8'));
  console.log(`→ ${OUT.replace(REPO + '/', '')}  ${Object.keys(n.themes).length} themes`);
}
