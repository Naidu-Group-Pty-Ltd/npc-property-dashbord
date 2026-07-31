/**
 * CORS-ORIGINS contract.
 *
 * The origin allowlist was implemented four times over — in `auth.ts` (CORS
 * response headers), `csrfGuard.ts` (cookie-mutation origin check) and the two
 * portal session validators — each with its own hardcoded fallback. They
 * drifted, and the drift was observable in production: this project's Lovable
 * editor origin was accepted by the CORS layer and rejected by the CSRF layer,
 * so cookie-authenticated mutations answered `403 csrf_denied` on requests the
 * browser had already been told were legal.
 *
 * These tests pin the single-resolver arrangement that fixes it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LEGACY_FALLBACK_ORIGINS,
  LOCAL_DEV_ORIGINS,
  PROJECT_PREVIEW_ORIGINS,
  isOriginAllowed,
  resolveAllowedOrigins,
} from '../../../supabase/functions/_shared/allowedOrigins.ts';

const FUNCTIONS = resolve(__dirname, '../../../supabase/functions');
const read = (p: string) => readFileSync(resolve(FUNCTIONS, p), 'utf8');

/** Every module that has to agree on which origins are trusted. */
const CONSUMERS = [
  '_shared/auth.ts',
  '_shared/csrfGuard.ts',
  '_shared/solicitorSessionToken.ts',
  '_shared/builderSessionToken.ts',
];

describe('shared origin allowlist', () => {
  it('is the only module that reads the ALLOWED_ORIGINS secret', () => {
    for (const file of CONSUMERS) {
      const src = read(file);
      // A doc comment naming the secret is fine; reading it is not.
      expect(
        /env\??\.?(?:get)?\??\.?\(\s*['"]ALLOWED_ORIGINS['"]\s*\)/.test(src),
        `${file} reads ALLOWED_ORIGINS directly instead of using _shared/allowedOrigins.ts`,
      ).toBe(false);
      expect(src, `${file} does not import the shared allowlist`).toContain('allowedOrigins.ts');
    }
  });

  it('trusts this project\'s own preview origins, which the CSRF fallback used to omit', () => {
    // The exact origin the Lovable editor iframe runs on. Its absence is what
    // made every cookie-authenticated mutation fail with csrf_denied.
    expect(PROJECT_PREVIEW_ORIGINS).toContain(
      'https://7976d60b-c277-4851-889b-c170285f4be2.lovableproject.com',
    );
    for (const origin of PROJECT_PREVIEW_ORIGINS) {
      expect(isOriginAllowed(origin), `${origin} is not allow-listed`).toBe(true);
    }
  });

  it('falls back to the legacy production origins plus preview and localhost', () => {
    // No ALLOWED_ORIGINS in this environment (no Deno global), so this is the
    // safety-net path every function takes when the secret is missing.
    const resolved = resolveAllowedOrigins();
    for (const origin of [...LEGACY_FALLBACK_ORIGINS, ...PROJECT_PREVIEW_ORIGINS, ...LOCAL_DEV_ORIGINS]) {
      expect(resolved, `${origin} missing from the resolved allowlist`).toContain(origin);
    }
    expect(new Set(resolved).size, 'the resolved allowlist contains duplicates').toBe(resolved.length);
  });

  it('rejects unknown origins and a missing origin', () => {
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    // Suffix trust is off by default: a sibling Lovable subdomain is not enough.
    expect(isOriginAllowed('https://someone-elses-app.lovable.app')).toBe(false);
    expect(isOriginAllowed(null)).toBe(false);
    expect(isOriginAllowed('')).toBe(false);
  });

  it('resolves the CORS origin per request rather than pinning one', () => {
    // `createCorsHeaders()` with no argument answers the first allow-listed
    // origin for every caller, which the browser rejects for all the others.
    const auth = read('_shared/auth.ts');
    expect(auth).toContain('export function createCorsHeaders(origin: string | null = null)');
    expect(auth).toContain('isOriginAllowed(origin)');
  });
});
