#!/usr/bin/env node
/**
 * WP-15 — Live negative-test harness.
 *
 * Executes the subset of docs/security/WP15_NEGATIVE_TEST_MATRIX.md that can
 * be run without a real user session and without provider fixtures. This
 * covers the WP-12 Phase B strict-signed rollout: any attempt to reach an
 * `internal_service` receiver without a valid HMAC envelope MUST return 401.
 *
 * Env required:
 *   SUPABASE_URL       (e.g. https://dduzbchuswwbefdunfct.supabase.co)
 *   SUPABASE_ANON_KEY  (public anon key)
 *   NON_SUPERADMIN_JWT (access token for an active, non-superadmin user)
 *
 * Optional:
 *   OUTPUT_DIR   (default docs/security/wp15-evidence/<YYYY-MM-DD>)
 *   CRON_TARGET  (default market-updates-digest)
 *   INTERNAL_TARGET (default agent-task-runner)
 *
 * Every row emits one JSON line:
 *   {"id":"NT-05","target":"…","input":"…","expected":"401","observed":"401","result":"expected_denial"}
 *
 * Exit code is 0 iff every result === "expected_denial".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const NON_SUPERADMIN_JWT = process.env.NON_SUPERADMIN_JWT;
if (!SUPABASE_URL || !ANON || !NON_SUPERADMIN_JWT) {
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY, and NON_SUPERADMIN_JWT are required.');
  process.exit(2);
}

const CRON_TARGET     = process.env.CRON_TARGET     || 'market-updates-digest';
const INTERNAL_TARGET = process.env.INTERNAL_TARGET || 'agent-task-runner';
const DATE = new Date().toISOString().slice(0, 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR || join('docs', 'security', 'wp15-evidence', DATE);
mkdirSync(OUTPUT_DIR, { recursive: true });
const OUT = join(OUTPUT_DIR, 'negative-tests.jsonl');
const lines = [];

/**
 * Every 5xx body this run happened to see, for NT-40. Collected rather than
 * provoked: deliberately breaking a production endpoint to watch it break is not
 * a test worth running against a live system.
 */
const observed5xx = [];

async function call(fn, headers, body) {
  const url = `${SUPABASE_URL}/functions/v1/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, ...headers },
    body: JSON.stringify(body ?? {}),
  });
  // Consume body so Deno / node fetch doesn't leak
  const text = await res.text().catch(() => '');
  if (res.status >= 500) observed5xx.push({ fn, body: text.slice(0, 400) });
  return { status: res.status, bodyPreview: text.slice(0, 200) };
}

function record(id, target, input, expectedStatus, observedStatus, expectedError, observedBody) {
  const expectedList = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  let observedError;
  if (expectedError) {
    try {
      observedError = JSON.parse(observedBody).error;
    } catch {
      observedError = undefined;
    }
  }
  const result = expectedList.includes(observedStatus) && (!expectedError || observedError === expectedError)
    ? 'expected_denial'
    : 'FAIL';
  const row = {
    id, target, input,
    expected: expectedList.join('|'),
    observed: String(observedStatus),
    ...(expectedError && { expectedError, observedError: observedError ?? 'unparseable response' }),
    result,
  };
  lines.push(JSON.stringify(row));
  console.log(JSON.stringify(row));
  return result === 'expected_denial';
}

let ok = true;

// NT-05 — Arbitrary Bearer against Market AI orchestrator (verify_jwt=true fn)
{
  const r = await call('market-updates-qa',
    { authorization: 'Bearer not-a-real-jwt' },
    { question: 'ping' });
  ok = record('NT-05', 'market-updates-qa', 'Bearer <random>', 401, r.status) && ok;
}

// NT-06 — Missing X-Cron-Secret against a cron worker
{
  const r = await call(CRON_TARGET, {}, {});
  ok = record('NT-06', CRON_TARGET, 'missing X-Cron-Secret', [401, 403], r.status) && ok;
}

// NT-07 — Wrong X-Cron-Secret against a cron worker
{
  const r = await call(CRON_TARGET,
    { 'x-cron-secret': 'wrong-value-for-negative-test' },
    {});
  ok = record('NT-07', CRON_TARGET, 'wrong X-Cron-Secret', [401, 403], r.status) && ok;
}

// NT-09 — Missing X-Internal-Signature against internal-service receiver
{
  const r = await call(INTERNAL_TARGET, {}, { ping: true });
  ok = record('NT-09', INTERNAL_TARGET, 'missing X-Internal-Signature', [401, 403], r.status) && ok;
}

// NT-09b — Present but obviously-forged signature
{
  const r = await call(INTERNAL_TARGET, {
    'x-internal-signature':  'deadbeef'.repeat(8),
    'x-internal-timestamp':  String(Date.now()),
    'x-internal-nonce':      'nonce-negative-test',
    'x-internal-key-id':     'v1',
  }, { ping: true });
  ok = record('NT-09b', INTERNAL_TARGET, 'forged signature', 401, r.status) && ok;
}

// NT-11 — Authenticated non-superadmin against the admin management function
{
  const r = await call('admin-user-management',
    { authorization: `Bearer ${NON_SUPERADMIN_JWT}` },
    { action: 'list_users' });
  ok = record(
    'NT-11',
    'admin-user-management',
    'authenticated non-superadmin JWT',
    403,
    r.status,
    'Unauthorized: Superadmin access required',
    r.bodyPreview,
  ) && ok;
}

// ───────────────────────────────────────────────────────────────────────────
// Rows added for the 20-item programme (WP-16 … WP-21). Same rule as above:
// every one must come back a denial, and a pass here is the only evidence that
// a source fix is also a deployed fix.
// ───────────────────────────────────────────────────────────────────────────

// NT-37 — WP-19. A credentialed request from an origin that is not on the
// allowlist must not be told it may read the response. The function may answer
// 200; what must not happen is `Access-Control-Allow-Origin` coming back as `*`
// or echoing the attacker's origin, either of which lets a hostile page read a
// response carrying the session cookie.
{
  const evil = 'https://negative-test.invalid';
  const res = await fetch(`${SUPABASE_URL}/functions/v1/template-share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, origin: evil },
    body: JSON.stringify({ operation: 'noop' }),
  });
  await res.text().catch(() => '');
  const acao = res.headers.get('access-control-allow-origin');
  const leaked = acao === '*' || acao === evil;
  lines.push(JSON.stringify({
    id: 'NT-37', target: 'template-share',
    input: `credentialed request with Origin: ${evil}`,
    expected: 'ACAO is neither * nor the request origin',
    observed: `ACAO: ${acao ?? '<absent>'}`,
    result: leaked ? 'FAIL' : 'expected_denial',
  }));
  console.log(lines.at(-1));
  ok = !leaked && ok;
}

// NT-38 — WP-16 / WP-20. A UUID belonging to nobody must not distinguish
// "exists but forbidden" from "does not exist", and must never return the row.
{
  const foreign = '00000000-0000-4000-8000-0000000000ff';
  const r = await call('get-client-data',
    { authorization: `Bearer ${NON_SUPERADMIN_JWT}` },
    { clientId: foreign });
  ok = record('NT-38', 'get-client-data', 'UUID from another tenant', [401, 403, 404], r.status) && ok;
}

// NT-39 — WP-20. A privileged write naming a column no request may set must be
// refused. Under an ordinary staff token the authorization gate refuses first,
// which is the correct denial and the one this asserts; proving the field
// allowlist itself needs an AML-write session, so that stays a unit concern
// (scripts/security/check-mass-assignment.mjs).
{
  const r = await call('aml-monitoring',
    { authorization: `Bearer ${NON_SUPERADMIN_JWT}` },
    { operation: 'upsert_alert', alert: { title: 'negative test', resolved_by: '00000000-0000-4000-8000-00000000000a' } });
  ok = record('NT-39', 'aml-monitoring', 'write naming a protected column', [401, 403], r.status) && ok;
}

// NT-40 — WP-18. Nothing in this run may have answered a 5xx that carries the
// exception. Asserted over every response the harness saw rather than by
// provoking a failure: deliberately breaking a production endpoint to watch it
// break is not a test worth running against a live system, and this catches the
// same regression whenever any row happens to trip one.
{
  const schemaish = /relation "|column "|constraint "|violates |permission denied for table|at [A-Za-z]+\.[a-z]+ \(/i;
  const offenders = observed5xx.filter((o) => schemaish.test(o.body));
  lines.push(JSON.stringify({
    id: 'NT-40', target: 'any',
    input: `${observed5xx.length} 5xx response(s) seen during this run`,
    expected: 'no schema detail in any 5xx body',
    observed: offenders.length ? offenders.map((o) => `${o.fn}: ${o.body.slice(0, 80)}`).join(' | ') : 'none',
    result: offenders.length ? 'FAIL' : 'expected_denial',
  }));
  console.log(lines.at(-1));
  ok = offenders.length === 0 && ok;
}

writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`\nWrote ${lines.length} rows -> ${OUT}`);
if (!ok) {
  console.error('WP-15 negative-test harness: FAIL');
  process.exit(1);
}
console.log('WP-15 negative-test harness: OK');
