#!/usr/bin/env node
/**
 * Negative tests for the string-matching security gates.
 *
 * ## Why this exists
 *
 * Most gates in `scripts/security/` assert a security property by grepping the
 * source for the exact line that implements it. That is cheap and it has caught
 * real regressions, but it has a failure mode that is invisible from the inside:
 * when the implementation is legitimately refactored, the literal stops
 * matching, the gate fails for a reason that has nothing to do with security,
 * and the only two ways out look identical from the diff — re-point the
 * assertion at the new code (correct), or loosen it until it passes (a silent
 * hole).
 *
 * Five gates had drifted this way at once, all of them hidden behind an earlier
 * failing step in the same CI job. Re-pointing them is only trustworthy if the
 * re-pointed assertion still bites, so that is what this file checks: for each
 * gate, it removes the control from a throwaway copy of the tree and asserts the
 * gate FAILS. A gate that passes on mutated source is not a gate.
 *
 * ## How
 *
 * Gates read their targets with paths relative to the process cwd, so each case
 * runs against a mirror of the repository built from symlinks — real directories
 * only along the path to the mutated file, symlinks for everything else. Nothing
 * in the working tree is written to, so a crash cannot leave a dirty checkout or
 * a half-reverted security control behind.
 *
 * Add a case whenever you add or re-point a literal-matching gate.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

const root = resolve(process.cwd());

/**
 * Every case: run `gate`, having replaced `find` with `replace` in `file`.
 * `find` must appear in the real file — a case whose anchor has itself drifted
 * would otherwise silently test nothing, which is the very fault this guards.
 */
const CASES = [
  {
    gate: 'check-agent-tool-policies.mjs',
    file: 'supabase/functions/ai-dashboard-agent/index.ts',
    what: 'agent trace log stops checking for the superadmin role',
    find: ".eq('role', 'superadmin')",
    replace: ".eq('role', 'staff')",
  },
  {
    gate: 'check-agent-tool-policies.mjs',
    file: 'supabase/functions/ai-dashboard-agent/index.ts',
    what: 'agent trace log stops scoping reads to the requesting user',
    find: "is_rolled_back').eq('user_id', userId!)",
    replace: "is_rolled_back')",
  },
  {
    gate: 'check-csrf-coverage.mjs',
    file: 'supabase/functions/agent-insights-runner/index.ts',
    what: 'a cookie-auth function stops enforcing CSRF',
    find: 'enforceCsrf',
    replace: 'noopCsrf',
    all: true,
  },
  {
    gate: 'check-step-up-session-binding.mjs',
    file: 'supabase/functions/security-step-up/index.ts',
    what: 'a step-up proof is bound to the pre-rotation session again',
    find: 'bound_session_id: boundSessionId,',
    replace: 'bound_session_id: staffSession.id,',
  },
  {
    gate: 'check-step-up-session-binding.mjs',
    file: 'supabase/functions/security-step-up/index.ts',
    what: 'the rotated session id is no longer carried into the binding',
    find: 'boundSessionId = rot.newSessionId;',
    replace: '/* rebinding removed */',
  },
  {
    gate: 'check-storage-upload-hardening.mjs',
    file: 'supabase/functions/secure-storage/index.ts',
    what: 'a human caller can set the storage upsert flag',
    find: 'upsert: isInternal ? upsert === true : false',
    replace: 'upsert: upsert === true',
  },
  {
    gate: 'check-storage-upload-hardening.mjs',
    file: 'supabase/functions/secure-storage/index.ts',
    what: 'a human upload path is caller-chosen rather than server-generated',
    find: 'uploadPath = `${uploadBinding.clientId || uploadBinding.ownerUserId || actorId}/${crypto.randomUUID()}',
    replace: 'uploadPath = `${path}',
  },
  {
    gate: 'check-market-digest-authz.mjs',
    file: 'supabase/functions/market-updates-digest/index.ts',
    what: 'the digest idempotency lookup drops the period key',
    find: ".eq('period', period).eq('period_key', periodKey).maybeSingle()",
    replace: ".eq('period', period).maybeSingle()",
  },
  {
    gate: 'check-market-digest-authz.mjs',
    file: 'supabase/functions/market-updates-digest/index.ts',
    what: 'the digest spends on the provider before resolving idempotency',
    find: "if (existingDigest && existingDigest.status === 'published') return json",
    replace: "if (false) return json",
  },
  {
    gate: 'check-auth-rate-limit-coverage.mjs',
    file: 'supabase/functions/custom-auth-login-v2/index.ts',
    what: 'the staff login stops consuming a source-keyed rate limit',
    find: 'const rateLimit = await enforceAuthRateLimit(supabase, req, {',
    replace: 'const rateLimit = await noopRateLimit(supabase, req, {',
  },
  {
    gate: 'check-auth-rate-limit-coverage.mjs',
    file: 'supabase/functions/client-portal-forgot-password/index.ts',
    what: 'a recovery limiter goes back to the caller-controlled X-Forwarded-For',
    find: 'const gate = await beginAuthRateLimit(supabase, req, {',
    replace:
      "const _ip = req.headers.get('x-forwarded-for'); const gate = await beginAuthRateLimit(supabase, req, {",
  },
  {
    gate: 'check-password-leak-coverage.mjs',
    file: 'supabase/functions/client-portal-reset-password/index.ts',
    what: 'a reset path stops breach-checking the new password',
    find: 'const strength = await validatePasswordStrength(new_password)',
    replace: 'const strength = { isValid: true, error: null }',
  },
  {
    gate: 'check-password-leak-coverage.mjs',
    file: 'supabase/functions/_shared/passwordValidation.ts',
    what: 'the shared policy stops reaching the Have I Been Pwned check',
    find: 'checkLeakedPasswordWithTimeout',
    replace: 'noopLeakCheck',
    all: true,
  },
  {
    gate: 'check-portal-session-client-storage.mjs',
    file: 'src/hooks/usePortalData.ts',
    what: 'the client portal token goes back into localStorage',
    find: "import { portalSessionBodyFields, portalSessionHeaders } from '@/lib/portalSession';",
    replace:
      "const PORTAL_SESSION_KEY = 'portal_session_token';\n" +
      "const portalSessionHeaders = () => ({ 'x-portal-session-token': localStorage.getItem(PORTAL_SESSION_KEY) || '' });\n" +
      'const portalSessionBodyFields = () => ({});',
  },
  {
    gate: 'check-admin-authorization-server-side.mjs',
    file: 'supabase/functions/admin-user-management/index.ts',
    what: 'a privileged action is handled before the superadmin gate',
    find: "    // Actions that don't require superadmin auth\n    if (action === 'verify_invite') {",
    replace:
      "    // Actions that don't require superadmin auth\n" +
      "    if (action === 'delete_user') { /* moved above the gate */ }\n" +
      "    if (action === 'verify_invite') {",
  },
  {
    gate: 'check-client-bundle-secrets.mjs',
    file: 'src/hooks/useGoogleFonts.ts',
    what: 'a Google API key is hardcoded into the browser bundle again',
    find: "const { data, error } = await invokeSecureFunction<{",
    replace:
      "      await fetch('https://www.googleapis.com/webfonts/v1/webfonts?key=AIzaSyAPjKmIVPd3M30RFnb1pCqJ1fT-BaKkPNI');\n" +
      '      const { data, error } = await invokeSecureFunction<{',
  },
];

/**
 * Mirror `root` into `dest` with symlinks, materialising real directories only
 * where an override needs one, and write the overridden contents.
 */
function mirror(dest, overrides) {
  const realDirs = new Set();
  for (const rel of overrides.keys()) {
    const parts = rel.split('/');
    for (let i = 0; i < parts.length - 1; i++) realDirs.add(parts.slice(0, i + 1).join('/'));
  }
  const walk = (rel) => {
    const absSrc = rel ? join(root, rel) : root;
    const absDest = rel ? join(dest, rel) : dest;
    mkdirSync(absDest, { recursive: true });
    for (const entry of readdirSync(absSrc, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory() && realDirs.has(childRel)) { walk(childRel); continue; }
      if (overrides.has(childRel)) continue; // written below
      symlinkSync(join(absSrc, entry.name), join(absDest, entry.name));
    }
  };
  walk('');
  for (const [rel, content] of overrides) {
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    writeFileSync(join(dest, rel), content);
  }
}

const failures = [];
let checked = 0;

for (const test of CASES) {
  const original = readFileSync(join(root, test.file), 'utf8');
  if (!original.includes(test.find)) {
    failures.push(
      `${test.gate}: the anchor for "${test.what}" is not in ${test.file} any more `
      + `(looked for ${JSON.stringify(test.find)}). This negative test is not testing anything — `
      + `re-point it at the control as it is written now.`,
    );
    continue;
  }
  const mutated = test.all
    ? original.split(test.find).join(test.replace)
    : original.replace(test.find, test.replace);
  if (mutated === original) { failures.push(`${test.gate}: mutation for "${test.what}" changed nothing`); continue; }

  const dir = mkdtempSync(join(tmpdir(), 'gate-negative-'));
  try {
    mirror(dir, new Map([[test.file, mutated]]));
    const run = spawnSync(process.execPath, [join(root, 'scripts', 'security', test.gate)], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    checked++;
    if (run.status === 0) {
      failures.push(
        `${test.gate} PASSED with the control removed (${test.what}). The gate does not `
        + `detect this regression: it is asserting something other than the property it claims.`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`Security gate negative tests FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Security gate negative tests passed (${checked} controls removed, ${checked} gates failed as required).`);
