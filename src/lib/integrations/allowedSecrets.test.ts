import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, getSupabaseSecretName } from './registry';

/**
 * `update-integration-secret` runs on Deno and cannot import from `src/`, so its allowlist
 * is materialised into `supabase/functions/_shared/integrationSecrets.ts` by
 * `scripts/generate-integration-secrets.mjs`. These tests are the drift guard: they fail
 * the build whenever a registry field has no matching entry in the generated module.
 */
const GENERATED = resolve(
  __dirname,
  '../../../supabase/functions/_shared/integrationSecrets.ts',
);

const generatedNames = (): string[] => {
  const source = readFileSync(GENERATED, 'utf8');
  const body = source.slice(source.indexOf('ALLOWED_INTEGRATION_SECRETS'));
  return [...body.matchAll(/^ {2}'([A-Z0-9_]+)',$/gm)].map((m) => m[1]);
};

const registryNames = (): string[] => [
  ...new Set(INTEGRATIONS.flatMap((i) => i.fields.map((f) => getSupabaseSecretName(f.key)))),
];

describe('update-integration-secret allowlist', () => {
  it('covers every credential field in the registry', () => {
    const generated = new Set(generatedNames());
    const missing = registryNames().filter((name) => !generated.has(name));

    expect(missing, 'run: npm run integrations:secrets:generate').toEqual([]);
  });

  it('contains nothing the Integrations page cannot send', () => {
    const registry = new Set(registryNames());
    const extra = generatedNames().filter((name) => !registry.has(name));

    expect(extra, 'run: npm run integrations:secrets:generate').toEqual([]);
  });

  it('stores aliased secret names, not raw field keys', () => {
    const generated = new Set(generatedNames());

    // The three legacy fields whose stored key differs from the Supabase secret name.
    expect(generated.has('AIRTABLE_TOKEN')).toBe(true);
    expect(generated.has('AIRTABLE_API_KEY')).toBe(false);
    expect(generated.has('GOHIGHLEVEL_API_KEY')).toBe(true);
    expect(generated.has('GHL_API_KEY')).toBe(false);
    expect(generated.has('GOHIGHLEVEL_LOCATION_ID')).toBe(true);
    expect(generated.has('GHL_LOCATION_ID')).toBe(false);
  });

  it('only lists names the endpoint’s own format check accepts', () => {
    // Mirrors SECRET_NAME_REGEX in supabase/functions/update-integration-secret/index.ts.
    const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]{2,50}$/;
    const rejected = generatedNames().filter((name) => !SECRET_NAME_REGEX.test(name));

    expect(rejected).toEqual([]);
  });
});
