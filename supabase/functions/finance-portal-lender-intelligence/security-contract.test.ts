import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('finance portal lender intelligence abuse controls', () => {
  it('atomically claims a persistent cooldown before invoking the live-rate service', () => {
    const refreshBranch = functionSource.indexOf("if (operation === 'refresh_rates')");
    const cooldownClaim = functionSource.indexOf(".update({ last_live_rates_refresh_at:", refreshBranch);
    const conditionalClaim = functionSource.indexOf('last_live_rates_refresh_at.lt.', cooldownClaim);
    const downstreamFetch = functionSource.indexOf(
      "`${supabaseUrl}/functions/v1/cdr-lending-rates-service`",
      refreshBranch,
    );

    expect(refreshBranch).toBeGreaterThan(-1);
    expect(cooldownClaim).toBeGreaterThan(refreshBranch);
    expect(conditionalClaim).toBeGreaterThan(cooldownClaim);
    expect(downstreamFetch).toBeGreaterThan(conditionalClaim);
  });

  it('fails closed and returns a retryable rate-limit response when no claim is acquired', () => {
    expect(functionSource).toContain("return json({ error: 'Unable to authorize live-rate refresh' }, 503)");
    expect(functionSource).toContain('retry_after_seconds:');
    expect(functionSource).toMatch(/retry_after_seconds:[\s\S]*?429/);
  });
});
