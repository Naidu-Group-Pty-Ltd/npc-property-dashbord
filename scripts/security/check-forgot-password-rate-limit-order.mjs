#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handlers = [
  {
    path: 'supabase/functions/client-portal-forgot-password/index.ts',
    lookup: ".from('client_portal_users')",
    eligibility: "if (!portalUser || portalUser.status === 'disabled')",
    ipBucket: 'cpfp_ip:',
    accountBucket: 'cpfp_email:',
  },
  {
    path: 'supabase/functions/finance-portal-forgot-password/index.ts',
    lookup: ".from('finance_portal_users')",
    eligibility: 'if (!portalUser || !portalUser.is_active || portalUser.revoked_at)',
    ipBucket: 'fpfp_ip:',
    accountBucket: 'fpfp_email:',
  },
];

for (const handler of handlers) {
  test(`${handler.path} prevents attacker-controlled limiter row creation`, async () => {
    const source = await readFile(new URL(`../../${handler.path}`, import.meta.url), 'utf8');
    const ipWrite = source.indexOf(handler.ipBucket);
    const ipDecision = source.indexOf('if (ipLimitError || ipOk !== true)', ipWrite);
    const lookup = source.indexOf(handler.lookup, ipDecision);
    const eligibility = source.indexOf(handler.eligibility, lookup);
    const accountWrite = source.indexOf(handler.accountBucket, eligibility);

    assert.ok(ipWrite >= 0, 'source-IP limiter must be present');
    assert.ok(ipDecision > ipWrite, 'source-IP result must be checked immediately after consumption');
    assert.ok(lookup > ipDecision, 'account lookup must happen only after the source-IP gate');
    assert.ok(eligibility > lookup, 'account eligibility must be checked after lookup');
    assert.ok(accountWrite > eligibility, 'account bucket must be written only after eligibility is confirmed');
    assert.equal(
      source.slice(ipWrite, accountWrite).includes('Promise.all'),
      false,
      'source-IP and account limiter writes must never run concurrently',
    );
  });
}

test('rate-limit storage rejects oversized keys and prunes expired buckets', async () => {
  const migration = await readFile(
    new URL('../../supabase/migrations/20260725120000_bound_auth_rate_limit_storage.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /char_length\(p_key\)\s+NOT\s+BETWEEN\s+1\s+AND\s+200/i);
  assert.match(migration, /DELETE FROM public\.auth_rate_limits/i);
  assert.match(migration, /updated_at < now\(\) - interval '24 hours'/i);
  assert.match(migration, /LIMIT 100/i);
});
