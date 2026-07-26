#!/usr/bin/env node
// CORS request/response header contract gate.
//
// A browser preflight only succeeds when EVERY header the client puts in
// `Access-Control-Request-Headers` is echoed back in `Access-Control-Allow-Headers`.
// When one is missing the real request is never dispatched and `fetch()` rejects
// with an opaque `TypeError: Failed to fetch` — which the app surfaces as
// "Network/CORS error calling <fn>", indistinguishable from the function being
// down. Adding a header on the client without widening the edge-function
// allowlist therefore breaks every page at once (this is exactly how
// `x-correlation-id` took the dashboard down).
//
// Symmetrically, a cross-origin response only reveals the CORS-safelisted
// response headers to JS. Custom headers the client reads back must be named in
// `Access-Control-Expose-Headers` or they silently read as `null`.
//
// This gate asserts:
//   1. every custom request header the frontend sends to an edge function is in
//      the canonical allowlist in `_shared/auth.ts`;
//   2. every custom response header the frontend reads is in the canonical
//      expose list;
//   3. every hand-rolled CORS object in `supabase/functions/` is a superset of
//      the client-required request headers and expose headers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FUNC_DIR = 'supabase/functions';
const AUTH_TS = `${FUNC_DIR}/_shared/auth.ts`;
const SRC_DIR = 'src';

const errors = [];

// ── Canonical lists (source of truth: _shared/auth.ts) ──────────────────────
const authSrc = readFileSync(AUTH_TS, 'utf8');
function parseConst(name) {
  const m = authSrc.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\.join`));
  if (!m) {
    errors.push(`${AUTH_TS}: could not parse \`export const ${name}\` — the CORS contract gate depends on it.`);
    return new Set();
  }
  return new Set(
    [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1].toLowerCase()),
  );
}
const ALLOWED = parseConst('CORS_ALLOWED_REQUEST_HEADERS');
const EXPOSED = parseConst('CORS_EXPOSED_RESPONSE_HEADERS');

// ── What the frontend actually sends / reads ────────────────────────────────
function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const sent = new Map();  // header -> file
const read = new Map();  // header -> file

for (const file of walkFiles(SRC_DIR)) {
  const src = readFileSync(file, 'utf8');
  // Only files that actually talk to an edge function can trigger a preflight.
  // (Keeps unrelated `x-*` string keys — e.g. brand slugs — out of the gate.)
  const callsEdgeFunction = /functions\/v1\//.test(src) || /invokeSecureFunction/.test(src);
  if (callsEdgeFunction) {
    for (const m of src.matchAll(/['"](x-[a-z0-9-]+)['"]\s*:/gi)) {
      sent.set(m[1].toLowerCase(), file);
    }
  }
  for (const m of src.matchAll(/headers\.get\(\s*['"](x-[a-z0-9-]+)['"]/gi)) {
    read.set(m[1].toLowerCase(), file);
  }
}

for (const [h, file] of sent) {
  if (!ALLOWED.has(h)) {
    errors.push(`${file}: sends request header \`${h}\` but it is NOT in CORS_ALLOWED_REQUEST_HEADERS (${AUTH_TS}). Every preflight carrying it will fail.`);
  }
}
for (const [h, file] of read) {
  if (!EXPOSED.has(h)) {
    errors.push(`${file}: reads response header \`${h}\` but it is NOT in CORS_EXPOSED_RESPONSE_HEADERS (${AUTH_TS}). It will read back as null cross-origin.`);
  }
}

// ── Hand-rolled CORS objects must be supersets of what the client needs ─────
// Session/portal carriers are per-surface, so only the headers the shared
// client attaches to *every* call are required everywhere.
const REQUIRED_EVERYWHERE = ['x-correlation-id', 'x-step-up-token'];

function walkFunctions(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFunctions(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

for (const file of walkFunctions(FUNC_DIR)) {
  if (file === AUTH_TS) continue; // uses the named constants
  const src = readFileSync(file, 'utf8');
  const matches = [...src.matchAll(
    /(['"])Access-Control-Allow-Headers\1\s*:\s*(?:\r?\n\s*)?(['"])([^'"]*)\2/g,
  )];
  if (matches.length === 0) continue;

  for (const m of matches) {
    const value = m[3].trim();
    if (value === '*') continue; // wildcard permits everything (non-credentialed only)
    const have = new Set(value.split(',').map((s) => s.trim().toLowerCase()));
    const missing = REQUIRED_EVERYWHERE.filter((h) => !have.has(h));
    if (missing.length) {
      errors.push(`${file}: Access-Control-Allow-Headers is missing ${missing.map((h) => `\`${h}\``).join(', ')}.`);
    }
  }

  // The object declaring Allow-Headers should also expose what the client reads.
  if (!/Access-Control-Expose-Headers/.test(src)) {
    errors.push(`${file}: declares Access-Control-Allow-Headers but no Access-Control-Expose-Headers — custom response headers will read back as null.`);
  }
}

if (errors.length) {
  console.error('CORS contract check FAILED:\n');
  for (const e of errors.sort()) console.error(`  - ${e}`);
  console.error(`\nFix by adding the header to the canonical lists in ${AUTH_TS} and to any`);
  console.error('hand-rolled CORS object in supabase/functions/. A client header that is not');
  console.error('allow-listed fails the browser preflight and breaks every page that calls the function.');
  process.exit(1);
}
console.log(`CORS contract check passed (${sent.size} client request header(s), ${read.size} read response header(s), all edge-function CORS objects conform).`);
