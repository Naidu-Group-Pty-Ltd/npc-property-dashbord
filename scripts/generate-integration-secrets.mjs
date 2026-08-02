#!/usr/bin/env node
/**
 * Regenerates `supabase/functions/_shared/integrationSecrets.ts` from the Integrations
 * registry, so the edge-function allowlist can never drift from the page that feeds it.
 *
 * Edge functions run on Deno and cannot import from `src/`, so the list is materialised
 * into `_shared/` instead. `src/lib/integrations/allowedSecrets.test.ts` fails the build
 * if the two ever disagree.
 *
 *   node scripts/generate-integration-secrets.mjs           # write
 *   node scripts/generate-integration-secrets.mjs --check   # verify only, non-zero on drift
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = resolve(root, 'src/lib/integrations/registry.ts');
const TARGET = resolve(root, 'supabase/functions/_shared/integrationSecrets.ts');

/**
 * The registry is TypeScript with `satisfies`-free plain literals, so a regex read is
 * enough and avoids pulling a TS loader into a plain node script.
 */
export function readSecretNames(source = readFileSync(REGISTRY, 'utf8')) {
  const arrayStart = source.indexOf('export const INTEGRATIONS');
  const aliasStart = source.indexOf('export const SUPABASE_SECRET_ALIASES');
  if (arrayStart === -1 || aliasStart === -1) {
    throw new Error('registry.ts: could not locate INTEGRATIONS / SUPABASE_SECRET_ALIASES');
  }

  const aliases = Object.fromEntries(
    [...source.slice(aliasStart).matchAll(/^ {2}([A-Z0-9_]+): '([^']+)',$/gm)].map((m) => [m[1], m[2]]),
  );

  const fieldKeys = [...source.slice(arrayStart, aliasStart).matchAll(/\bkey: '([^']+)'/g)].map((m) => m[1]);
  if (fieldKeys.length === 0) throw new Error('registry.ts: no credential fields found');

  return [...new Set(fieldKeys.map((key) => aliases[key] ?? key))].sort();
}

export function renderModule(names) {
  return `/**
 * Every Supabase secret name the Integrations page is allowed to write.
 *
 * GENERATED from \`src/lib/integrations/registry.ts\` — one entry per credential field,
 * with \`SUPABASE_SECRET_ALIASES\` already applied (the page syncs the aliased name via
 * \`getSupabaseSecretName()\`, not the raw field key).
 *
 * Do not hand-edit. Add the field to the registry instead and re-run
 * \`npm run integrations:secrets:generate\`. \`allowedSecrets.test.ts\` fails the build
 * if this list drifts from the registry.
 */
export const ALLOWED_INTEGRATION_SECRETS = new Set<string>([
${names.map((n) => `  '${n}',`).join('\n')}
]);
`;
}

const names = readSecretNames();
const rendered = renderModule(names);

if (process.argv.includes('--check')) {
  const current = readFileSync(TARGET, 'utf8');
  if (current !== rendered) {
    console.error(
      `integrationSecrets.ts is out of date (${names.length} secrets in the registry).\n` +
        'Run: npm run integrations:secrets:generate',
    );
    process.exit(1);
  }
  console.log(`integrationSecrets.ts is up to date (${names.length} secrets).`);
} else {
  writeFileSync(TARGET, rendered);
  console.log(`Wrote ${names.length} secret names to supabase/functions/_shared/integrationSecrets.ts`);
}
