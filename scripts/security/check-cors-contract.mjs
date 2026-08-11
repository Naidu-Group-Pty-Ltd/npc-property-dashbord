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

// ── The shared transport must not add custom request headers ────────────────
// This is the rule that matters most in practice. The frontend ships as one
// bundle; each of the ~300 edge functions carries its own bundled copy of
// `_shared/auth.ts` and is redeployed individually. A custom header added to
// the shared transport only works once EVERY function it can reach has been
// redeployed — until then the preflight fails and the entire app goes dark.
// Body fields carry the same data with no preflight requirement.
const SHARED_TRANSPORT = 'src/lib/secureInvoke.ts';
// Line-based scan: an `'x-…':` object key on its own line is a header entry.
// (Block matching is unreliable here — a `${...}` template inside a header
// value closes a naive brace match early and hides everything after it.)
const transportSrcRaw = readFileSync(SHARED_TRANSPORT, 'utf8');
for (const rawLine of transportSrcRaw.split('\n')) {
  const line = rawLine.trim();
  if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
  const m = line.match(/['"](x-[a-z0-9-]+)['"]\s*:/i);
  if (!m) continue;
  errors.push(`${SHARED_TRANSPORT}: adds custom request header \`${m[1].toLowerCase()}\` on the shared edge-function transport. It reaches ~300 independently-deployed functions and fails the preflight on every one not yet redeployed with it allow-listed — taking the whole app down. Send it as a body field instead.`);
}

// ── Credentialed callers must not reach a wildcard-origin function ──────────
// `invokeSecureFunction` sends `credentials: 'include'` so the HttpOnly
// `__Host-session_token` cookie reaches the function. The Fetch spec requires
// the browser to REJECT a credentialed response whose
// `Access-Control-Allow-Origin` is `*` — opaquely, as `Failed to fetch`. So a
// function on that transport may never answer with a wildcard origin; it needs
// the exact-origin allowlist (`createCorsHeaders`, or the `withRequestOrigin`
// wrapper in `_shared/corsOrigin.ts`). This is what broke the AML/CTF surface.
//
// There is no longer an exemption list. `TOKEN_AUTH_FUNCTIONS` used to name the
// five import/render functions that answered `*` and were therefore called with
// `credentials: 'omit'` — which stripped the HttpOnly session cookie, the only
// carrier `extractSessionToken` reads since WP-11B/C Phase 4, and left them
// depending on an access-token JWT the ES256 remediation made unobtainable.
// Every PDF template import 401'd. They now answer an allowlisted origin
// exactly, via `createTokenAuthCorsHeaders(origin)`, so they are held to the
// same rule as everything else.
const TOKEN_AUTH = new Set();

// `invokeSecureFunction` is not the only transport. The Finance, Solicitor and
// Builder portals each post to edge functions through their own wrapper, and
// two of those attach a custom request header (`X-Portal-Request`) on every
// call. Checking only `secureInvoke` left those surfaces — several hundred
// invocations — entirely outside this gate, so each entry below names the
// module that defines the transport and the headers it attaches are read from
// that source rather than restated here (a restated list goes stale in exactly
// the way the edge-function header copies did).
const TRANSPORTS = [
  { name: 'invokeSecureFunction', module: 'src/lib/secureInvoke.ts' },
  { name: 'invokeAmlFunction', module: 'src/lib/aml/invokeAmlFunction.ts' },
  { name: 'streamSecureFunction', module: 'src/lib/streamSecureFunction.ts' },
  { name: 'invokeSolicitorFunction', module: 'src/lib/solicitorPortal.ts' },
  { name: 'invokeBuilderFunction', module: 'src/lib/builderPortal.ts' },
  { name: 'invokeFinanceFunction', module: 'src/hooks/useFinancePortalAuth.tsx' },
];

for (const t of TRANSPORTS) {
  let modSrc;
  try {
    modSrc = readFileSync(t.module, 'utf8');
  } catch {
    errors.push(`${t.module}: transport module defining \`${t.name}\` not found — the credentialed-CORS gate depends on it. Update TRANSPORTS in this script if the module moved.`);
    t.headers = [];
    t.credentialed = false;
    continue;
  }
  t.credentialed = /credentials:\s*['"]include['"]/.test(modSrc);
  t.headers = [...new Set(
    [...modSrc.matchAll(/['"](x-[a-z0-9-]+)['"]\s*:/gi)].map((m) => m[1].toLowerCase()),
  )];
  for (const h of t.headers) {
    if (!ALLOWED.has(h)) {
      errors.push(`${t.module}: transport \`${t.name}\` attaches request header \`${h}\`, which is NOT in CORS_ALLOWED_REQUEST_HEADERS (${AUTH_TS}). Every preflight it triggers will fail.`);
    }
  }
}
const transportByName = new Map(TRANSPORTS.map((t) => [t.name, t]));

// Functions each transport reaches. Literal names, plus the `const FN = '…'`
// indirection the hooks in this repo consistently use.
const reachedBy = new Map(); // function name -> Set(transport names)
for (const file of walkFiles(SRC_DIR)) {
  if (/\.test\.tsx?$/.test(file)) continue;
  const src = readFileSync(file, 'utf8');
  const consts = [...src.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"]([a-z0-9-]+)['"]/g)];
  for (const t of TRANSPORTS) {
    const record = (fn) => {
      if (!reachedBy.has(fn)) reachedBy.set(fn, new Set());
      reachedBy.get(fn).add(t.name);
    };
    for (const m of src.matchAll(new RegExp(`${t.name}(?:<[^>]*>)?\\(\\s*["'\`]([a-zA-Z0-9_-]+)["'\`]`, 'g'))) record(m[1]);
    for (const [, ident, value] of consts) {
      if (new RegExp(`${t.name}(?:<[^>]*>)?\\(\\s*${ident}\\b`).test(src)) record(value);
    }
  }
}

for (const [fn, vias] of [...reachedBy].sort((a, b) => a[0].localeCompare(b[0]))) {
  const path = `${FUNC_DIR}/${fn}/index.ts`;
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { continue; } // deployed-only, not in repo

  // Several functions keep a now-dead wildcard literal but actually build their
  // real headers with createCorsHeaders(origin), or have the origin rewritten
  // per request by withRequestOrigin — those answer an exact origin.
  // `createTokenAuthCorsHeaders(origin)` counts too, but ONLY when it is passed
  // an origin: the no-argument form still answers `*` to everyone.
  // Each form must be CALLED, not merely imported. `withRequestOrigin` used to
  // be matched as a bare identifier, so unwrapping the handler and leaving the
  // now-unused import behind still satisfied this — the negative test for this
  // rule caught it.
  const usesSharedOrigin = /createCorsHeaders\s*\(/.test(src)
    || /withRequestOrigin\s*\(/.test(src)
    || /createTokenAuthCorsHeaders\s*\(\s*[^)\s]/.test(src);

  // (a) A credentialed request whose response carries a wildcard origin is
  //     rejected by the browser itself, opaquely, as "Failed to fetch".
  const credentialedVias = [...vias].filter(
    (v) => transportByName.get(v)?.credentialed && !(v === 'invokeSecureFunction' && TOKEN_AUTH.has(fn)),
  );
  if (
    credentialedVias.length
    && !usesSharedOrigin
    && /["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/.test(src)
  ) {
    errors.push(`${path}: answers \`Access-Control-Allow-Origin: *\` but is called with credentials through ${credentialedVias.join(', ')}. Browsers reject a credentialed response with a wildcard origin, so every call fails as "Failed to fetch". Use createCorsHeaders(origin), or wrap the handler with withRequestOrigin (_shared/corsOrigin.ts).`);
  }

  // (a2) Same failure, one level of indirection away: the shared token-auth
  //      helper answers `*` unless it is given the request origin. A function
  //      reached by a credentialed transport must pass it — unless the handler
  //      is wrapped in `withRequestOrigin`, which rewrites the origin on the
  //      way out and makes the helper's own answer irrelevant.
  if (
    credentialedVias.length
    && !/withRequestOrigin/.test(src)
    && /createTokenAuthCorsHeaders\s*\(\s*\)/.test(src)
  ) {
    errors.push(`${path}: calls \`createTokenAuthCorsHeaders()\` with no origin, which answers \`Access-Control-Allow-Origin: *\`, but is called with credentials through ${credentialedVias.join(', ')}. Browsers reject a credentialed response with a wildcard origin. Pass the request origin: \`createTokenAuthCorsHeaders(req.headers.get('origin'))\`.`);
  }

  // (a3) Accepting the session cookie means accepting ambient authority, which
  //      is exactly what CSRF exploits. Every cookie-reachable function must
  //      run the shared guard (it no-ops when no cookie is present).
  if (credentialedVias.length && /createTokenAuthCorsHeaders\s*\(/.test(src) && !/enforceCsrf\s*\(/.test(src)) {
    errors.push(`${path}: answers an exact origin with credentials (so the HttpOnly session cookie reaches it) but never calls \`enforceCsrf(req)\` from _shared/csrfGuard.ts. Cookie authority is ambient — add the guard.`);
  }

  // (b) Every custom header its callers attach must survive its preflight.
  const required = [...new Set([...vias].flatMap((v) => transportByName.get(v)?.headers ?? []))];
  if (required.length === 0) continue;
  for (const m of src.matchAll(/(['"])Access-Control-Allow-Headers\1\s*:\s*(?:\r?\n\s*)?(['"])([^'"]*)\2/g)) {
    const value = m[3].trim();
    if (value === '*') continue;
    const have = new Set(value.split(',').map((s) => s.trim().toLowerCase()));
    const missing = required.filter((h) => !have.has(h));
    if (missing.length) {
      errors.push(`${path}: reached by ${[...vias].join(', ')}, which ${vias.size > 1 ? 'attach' : 'attaches'} ${missing.map((h) => `\`${h}\``).join(', ')}, but its Access-Control-Allow-Headers omits ${missing.length > 1 ? 'them' : 'it'}. The preflight fails and every call surfaces as "Failed to fetch".`);
    }
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

// ── createCorsHeaders() must not be overridden ─────────────────────────────
// Spreading the shared helper and then restating Allow-/Expose-Headers pins the
// function to a snapshot of the canonical lists taken on the day it was
// written. Because the literal comes *after* the spread it wins, so the copy
// can only ever narrow the allowlist — never extend it. Every instance of this
// in the repo had already gone stale: six functions were silently dropping
// headers the canonical list had since gained (`x-step-up-token`,
// `x-portal-request`, the portal session carriers), which fails the browser
// preflight and surfaces as an opaque "Failed to fetch".
//
// Paren-aware so `createCorsHeaders(req.headers.get('origin'))` is matched too.
const SPREAD_OVERRIDE = /\.\.\.\s*createCorsHeaders\s*\((?:[^()]|\([^()]*\))*\)\s*,([\s\S]{0,600}?)\}/g;
for (const file of walkFunctions(FUNC_DIR)) {
  if (file === AUTH_TS) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(SPREAD_OVERRIDE)) {
    for (const key of ['Access-Control-Allow-Headers', 'Access-Control-Expose-Headers']) {
      if (new RegExp(`(['"])${key}\\1\\s*:`).test(m[1])) {
        errors.push(`${file}: overrides \`${key}\` after spreading createCorsHeaders(). The override wins over the spread, so it can only narrow the canonical list and will go stale the next time a header is added. Delete the override; if the function genuinely needs an extra header, add it to the canonical list in ${AUTH_TS}.`);
      }
    }
  }
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
  // A file can trip the same rule at more than one CORS object; report it once.
  for (const e of [...new Set(errors)].sort()) console.error(`  - ${e}`);
  console.error(`\nFix by adding the header to the canonical lists in ${AUTH_TS} and to any`);
  console.error('hand-rolled CORS object in supabase/functions/. A client header that is not');
  console.error('allow-listed fails the browser preflight and breaks every page that calls the function.');
  process.exit(1);
}
console.log(`CORS contract check passed (${sent.size} client request header(s), ${read.size} read response header(s), all edge-function CORS objects conform).`);
