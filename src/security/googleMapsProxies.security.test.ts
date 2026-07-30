import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readHandler = (name: string) => readFileSync(
  new URL(`./${name}/index.ts`, import.meta.url),
  'utf8',
);

describe('Google Maps proxy security controls', () => {
  for (const functionName of ['resolve-listing-coordinates', 'street-view']) {
    it(`${functionName} requires listings access and layered provider controls`, () => {
      const source = readHandler(functionName);
      const authorization = source.indexOf("requireModulePermission(supabase, { userId, authMethod }, 'listings', 'can_view')");
      const providerCall = source.indexOf('maps.googleapis.com');

      expect(authorization).toBeGreaterThan(-1);
      expect(providerCall).toBeGreaterThan(authorization);
      expect(source).toContain('enforceActorQuota');
      expect(source).toContain('enforceIpQuota');
      expect(source).toContain('enforceGlobalDailyQuota');
      expect(source).toContain('provider_circuit_is_open');
      expect(source).toContain('provider_circuit_record_failure');
      expect(source).toContain('provider_circuit_record_success');
      expect(source).toContain('killSwitchActive');
      expect(source).toContain('fetchWithTimeout');
    });
  }
});
