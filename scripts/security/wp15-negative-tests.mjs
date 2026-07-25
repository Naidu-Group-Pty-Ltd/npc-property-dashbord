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

async function call(fn, headers, body) {
  const url = `${SUPABASE_URL}/functions/v1/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, ...headers },
    body: JSON.stringify(body ?? {}),
  });
  // Consume body so Deno / node fetch doesn't leak
  const text = await res.text().catch(() => '');
  return { status: res.status, bodyPreview: text.slice(0, 200) };
}

function record(id, target, input, expectedStatus, observedStatus) {
  const expectedList = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const result = expectedList.includes(observedStatus) ? 'expected_denial' : 'FAIL';
  const row = {
    id, target, input,
    expected: expectedList.join('|'),
    observed: String(observedStatus),
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
  ok = record('NT-11', 'admin-user-management', 'authenticated non-superadmin JWT', 403, r.status) && ok;
}

writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`\nWrote ${lines.length} rows -> ${OUT}`);
if (!ok) {
  console.error('WP-15 negative-test harness: FAIL');
  process.exit(1);
}
console.log('WP-15 negative-test harness: OK');
