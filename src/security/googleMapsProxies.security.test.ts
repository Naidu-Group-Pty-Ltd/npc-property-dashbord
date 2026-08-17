import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Repo-relative, like `ModuleGuard.security.test.ts` and the AML contracts.
 *
 * This was `new URL('./<name>/index.ts', import.meta.url)`, and under this
 * Vitest `import.meta.url` is not a file-scheme URL — `readFileSync` resolved
 * it to the literal path `src/security/undefined` and both tests failed with
 * ENOENT. They were not checking the two proxies at all; they were checking
 * that a path did not exist. The handlers were never under `src/security/`
 * either, which the URL form quietly implied.
 */
const readHandler = (name: string) => readFileSync(
  join(process.cwd(), 'supabase', 'functions', name, 'index.ts'),
  'utf8',
);

/**
 * What every Google Maps proxy owes, and what only one of them does.
 *
 * This asserted `enforceActorQuota` and `enforceIpQuota` on BOTH handlers.
 * `resolve-listing-coordinates` deliberately has neither, and says so at the
 * call site: "Per-request actor/IP throttles caused normal map pagination to
 * lock itself out and, worse, discarded cache hits with a blanket 429.
 * Provider spend remains bounded by the global daily quota, the per-request
 * lookup cap, and the circuit breaker below."
 *
 * That decision is recorded in the code and the test simply predated it — the
 * file has been unrunnable since the path bug above, so nothing reconciled
 * them. Asserting the throttle back would reintroduce the lockout; deleting
 * the whole case would drop the controls that ARE shared. So the shared floor
 * is asserted for both, and the per-actor throttle is asserted only where it
 * belongs — with `resolve-listing-coordinates` asserted NOT to have it, so its
 * removal stays deliberate rather than becoming an accident nobody notices.
 */
const SHARED_CONTROLS = [
  'enforceGlobalDailyQuota',
  'provider_circuit_is_open',
  'provider_circuit_record_failure',
  'provider_circuit_record_success',
  'killSwitchActive',
  'fetchWithTimeout',
] as const;

describe('Google Maps proxy security controls', () => {
  for (const functionName of ['resolve-listing-coordinates', 'street-view']) {
    it(`${functionName} authorizes before it spends, and bounds the spend`, () => {
      const source = readHandler(functionName);
      const authorization = source.indexOf("requireModulePermission(supabase, { userId, authMethod }, 'listings', 'can_view')");
      const providerCall = source.indexOf('maps.googleapis.com');

      expect(authorization).toBeGreaterThan(-1);
      expect(providerCall).toBeGreaterThan(authorization);
      for (const control of SHARED_CONTROLS) {
        expect(source, `${functionName} must keep ${control}`).toContain(control);
      }
    });
  }

  it('throttles street-view per actor and per IP', () => {
    const source = readHandler('street-view');
    expect(source).toContain('enforceActorQuota');
    expect(source).toContain('enforceIpQuota');
  });

  it('keeps the per-request throttles off the paginating endpoint, on purpose', () => {
    const source = readHandler('resolve-listing-coordinates');
    expect(source).not.toContain('enforceActorQuota(');
    expect(source).not.toContain('enforceIpQuota(');
    // The reason has to survive with the absence, or the next reader restores
    // the throttle and the map locks itself out again.
    // Matched on one line: the sentence wraps in the source.
    expect(source).toMatch(/actor\/IP throttles caused normal map/);
  });
});
