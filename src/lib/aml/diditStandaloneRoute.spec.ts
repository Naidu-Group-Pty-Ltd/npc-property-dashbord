import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveStandaloneRoute,
} from '../../../supabase/functions/_shared/aml/providers/diditStandaloneRoute.pure.ts';

/**
 * Where a standalone verification call goes.
 *
 * A Didit API key is scoped to an APPLICATION, and that scope includes the
 * application's whole session list — every customer's name and live
 * pre-signed URLs to their passport portrait and selfie. Measured against the
 * live account on 7 Sep 2026: one key read all eight sessions. So the
 * credential stops travelling to tenants and the CALL travels instead, through
 * Mission Control, which is already the side that meters what the prime's keys
 * spend.
 *
 * These tests hold the three properties that make that safe.
 */

const VENDOR = 'https://verification.didit.me';
const MC = 'https://mission-control.aurixasystems.com.au';

const base = {
  apiBase: VENDOR,
  missionControlUrl: MC,
  cloneApiKey: 'clone-key',
};

describe('resolveStandaloneRoute — the direct route', () => {
  it('goes to the vendor when this deployment holds the vendor key', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: 'vendor-key' });
    expect(route.via).toBe('direct');
    if (route.via !== 'direct') return;
    expect(route.url).toBe(`${VENDOR}/v3/face-match/`);
    expect(route.headers['x-api-key']).toBe('vendor-key');
    expect(route.secret).toBe('vendor-key');
  });

  it('prefers the vendor key even where the broker is also configured', () => {
    // The prime holds both: it is the account holder AND it runs Mission
    // Control. Holding the key is what entitles a deployment to spend it.
    const route = resolveStandaloneRoute({ ...base, path: '/v3/id-verification/', apiKey: 'k' });
    expect(route.via).toBe('direct');
  });

  it('meters, because this is the side that spends the vendor key', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/id-verification/', apiKey: 'k' });
    expect(route.via === 'direct' && route.meter).toBe(true);
  });
});

describe('resolveStandaloneRoute — the brokered route', () => {
  it('goes to Mission Control when this deployment holds no vendor key', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: null });
    expect(route.via).toBe('broker');
    if (route.via !== 'broker') return;
    expect(route.url).toBe(`${MC}/api/public/verification/face-match`);
    expect(route.headers['x-clone-api-key']).toBe('clone-key');
    expect(route.secret).toBe('clone-key');
  });

  it('is NOT metered here — Mission Control meters the vendor call it makes', () => {
    // Metering at both ends bills the tenant twice, which this platform's own
    // rule names as worse than not billing at all. `meter` is what carries it.
    for (const path of ['/v3/id-verification/', '/v3/passive-liveness/', '/v3/face-match/']) {
      const route = resolveStandaloneRoute({ ...base, path, apiKey: null });
      expect(route.via).toBe('broker');
      expect(route.via === 'broker' && route.meter).toBe(false);
    }
  });

  it('never points a brokered call at the vendor', () => {
    // The whole point of the hop is that the tenant's request carries no
    // vendor credential; a brokered URL on the vendor host would be an
    // unauthenticated call that reads as a customer failing verification.
    const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: null });
    expect(route.via === 'broker' && route.url.startsWith(MC)).toBe(true);
    expect(JSON.stringify(route)).not.toContain('didit.me');
  });

  it('never carries the vendor key name on the brokered hop', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: '' });
    expect(route.via === 'broker' && route.headers['x-api-key']).toBeFalsy();
  });

  it('tolerates a trailing slash on the Mission Control URL', () => {
    const route = resolveStandaloneRoute({
      ...base,
      missionControlUrl: `${MC}///`,
      path: '/v3/face-match/',
      apiKey: null,
    });
    expect(route.via === 'broker' && route.url).toBe(`${MC}/api/public/verification/face-match`);
  });
});

describe('resolveStandaloneRoute — unconfigured', () => {
  it('refuses rather than making an unauthenticated vendor call', () => {
    const route = resolveStandaloneRoute({
      path: '/v3/face-match/',
      apiKey: null,
      apiBase: VENDOR,
      missionControlUrl: null,
      cloneApiKey: null,
    });
    expect(route.via).toBe('unconfigured');
    // Nothing that could be handed to `fetch`.
    expect(JSON.stringify(route)).not.toContain('http');
  });

  it('refuses on half a broker, either half', () => {
    for (const half of [
      { missionControlUrl: MC, cloneApiKey: null },
      { missionControlUrl: null, cloneApiKey: 'clone-key' },
      { missionControlUrl: '   ', cloneApiKey: 'clone-key' },
      { missionControlUrl: MC, cloneApiKey: '   ' },
    ]) {
      const route = resolveStandaloneRoute({
        ...base, ...half, path: '/v3/face-match/', apiKey: null,
      });
      expect(route.via).toBe('unconfigured');
      expect(route.via === 'unconfigured' && route.why).toMatch(/MISSION_CONTROL|DIDIT_API_KEY/);
    }
  });

  it('treats a blank vendor key as no key, never as a key', () => {
    // An env var set to an empty string is how a half-provisioned deployment
    // looks; `'   '` as an `x-api-key` is a 401 that reads like a rejected
    // customer.
    for (const blank of ['', '   ', null, undefined]) {
      const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: blank });
      expect(route.via).toBe('broker');
    }
  });

  it('refuses a path the broker does not carry rather than attempting it', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/sessions/', apiKey: null });
    expect(route.via).toBe('unconfigured');
    expect(route.via === 'unconfigured' && route.why).toContain('/v3/sessions/');
  });
});

describe('the route and the calls it has to carry', () => {
  const clientSrc = readFileSync(
    resolve(
      __dirname,
      '../../../supabase/functions/_shared/aml/providers/diditStandaloneClient.ts',
    ),
    'utf8',
  );

  it('brokers every vendor path this client actually posts to', () => {
    // The drift that would break a brokered tenant silently: a fourth call
    // added to the client with no operation on the broker. Read the paths from
    // the client rather than restating them here.
    const paths = [...clientSrc.matchAll(/postMultipart\([^,]+,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const path of paths) {
      const route = resolveStandaloneRoute({ ...base, path, apiKey: null });
      expect(route.via, `${path} is not an operation Mission Control brokers`).toBe('broker');
    }
  });

  it('meters exactly where the route says to', () => {
    // `meteredFetch` on the broker route would bill the tenant twice; a plain
    // `fetch` on the direct route would bill it to nobody.
    expect(clientSrc).toContain('route.meter');
    expect(clientSrc.match(/meteredFetch\(/g)?.length).toBe(1);
    expect(clientSrc).toContain('await fetch(route.url, init)');
    // The other way to double-bill is to log adjacently to a metered call.
    expect(clientSrc).not.toContain('logApiUsage');
  });

  it('does not report a brokered deployment as unconfigured', () => {
    /*
     * A tenant deliberately holds no Didit key, so "no key" must not mean "not
     * ready" — one function decides it (`standaloneIdvReadiness`), and
     * `adapterConfigured` and the Command Centre card both read that one
     * answer. Gating readiness on the key alone would have every brokered
     * clone reporting `misconfigured` while verifying perfectly.
     */
    const providers = readFileSync(
      resolve(__dirname, '../../../supabase/functions/_shared/aml/providers/index.ts'),
      'utf8',
    );
    const fn = providers.slice(
      providers.indexOf('export function standaloneIdvReadiness'),
      providers.indexOf('function adapterConfigured'),
    );
    expect(fn).toContain('MISSION_CONTROL_CLONE_API_KEY');
    expect(fn).not.toMatch(/ready:\s*apiKeyPresent/);
    expect(fn).toContain('credential !== "none"');
    // Thresholds stay required on BOTH routes: they are this deployment's own
    // policy, and the broker neither supplies nor overrides them.
    expect(fn).toContain('liveness === "ok" && faceMatch === "ok"');
  });

  it('never writes the multipart Content-Type, on either route', () => {
    // `fetch` derives `multipart/form-data; boundary=…` from the FormData
    // body. Writing the header drops the boundary and every request becomes a
    // 400 that looks like an unreadable photograph — and the broker forwards
    // the header onward, so one hand-written header breaks both hops.
    const routeSrc = readFileSync(
      resolve(
        __dirname,
        '../../../supabase/functions/_shared/aml/providers/diditStandaloneRoute.pure.ts',
      ),
      'utf8',
    );
    expect(routeSrc.toLowerCase()).not.toContain('multipart/form-data');
    for (const path of ['/v3/face-match/']) {
      for (const apiKey of ['k', null]) {
        const route = resolveStandaloneRoute({ ...base, path, apiKey });
        if (route.via === 'unconfigured') throw new Error('unexpected');
        const names = Object.keys(route.headers).map((h) => h.toLowerCase());
        expect(names).not.toContain('content-type');
      }
    }
  });
});
