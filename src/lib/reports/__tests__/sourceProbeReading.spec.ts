/**
 * ME-5.1 — the probe's reading is one implementation, and it never fabricates.
 *
 * The probe classifies on the server and a person reads the answer on the
 * Integrations page. These tests pin the three rules that keep those two ends
 * from becoming two standards.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  describeAuthAttempt,
  PROBE_VERDICTS,
  PROVIDER_STATUS_READING,
  describeVerdict,
  groupCredentialPresence,
  summariseProbe,
} from '../market/sourceProbeReading.pure';

const PROBE_SOURCE = resolve(
  process.cwd(),
  'supabase/functions/market-source-probe/index.ts',
);

describe('the verdict vocabulary mirrors the classifier', () => {
  it('names every verdict the probe can return, and no others', () => {
    const source = readFileSync(PROBE_SOURCE, 'utf8');
    // The `Verdict` union is the classifier's own vocabulary.
    const union = source.slice(
      source.indexOf('type Verdict'),
      source.indexOf(';', source.indexOf('type Verdict')),
    );
    const declared = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toEqual([...PROBE_VERDICTS].sort());
  });

  it('gives every verdict a reading, an owner and a tone', () => {
    for (const verdict of PROBE_VERDICTS) {
      const reading = describeVerdict(verdict);
      expect(reading.recognised).toBe(true);
      expect(reading.label.length).toBeGreaterThan(0);
      expect(reading.meaning.length).toBeGreaterThan(0);
      expect(reading.owner).not.toBe('unassigned');
      expect(['positive', 'neutral', 'attention', 'blocked']).toContain(reading.tone);
    }
  });
});

describe('an unrecognised verdict is its own reading, never a default', () => {
  it('does not coerce an unknown value onto a known one', () => {
    const reading = describeVerdict('teapot');
    expect(reading.recognised).toBe(false);
    expect(reading.verdict).toBe('teapot');
    expect(reading.label).not.toBe(describeVerdict('reachable').label);
    expect(reading.label).not.toBe(describeVerdict('credential_absent').label);
    // It quotes the value rather than interpreting it.
    expect(reading.meaning).toContain('teapot');
  });

  it('never reads an unknown verdict as positive', () => {
    for (const unknown of ['', 'ok', 'success', 'reachable_maybe', 'CREDENTIAL_ABSENT']) {
      expect(describeVerdict(unknown).tone).not.toBe('positive');
    }
  });
});

describe('a credential is presence only', () => {
  it('takes booleans, so no value is ever in scope', () => {
    const groups = groupCredentialPresence({
      DOMAIN_API_KEY: false,
      DOMAIN_CLIENT_ID: true,
      DOMAIN_CLIENT_SECRET: false,
      SQM_RESEARCH_API_KEY: false,
    });
    const domain = groups.find((g) => g.provider === 'domain');
    expect(domain?.names.map((n) => n.name)).toEqual([
      'DOMAIN_API_KEY',
      'DOMAIN_CLIENT_ID',
      'DOMAIN_CLIENT_SECRET',
    ]);
    expect(domain?.anySet).toBe(true);
    expect(groups.find((g) => g.provider === 'sqm_research')?.anySet).toBe(false);
    // Nothing in the output carries anything but a name and a boolean.
    for (const group of groups) {
      for (const entry of group.names) {
        expect(Object.keys(entry).sort()).toEqual(['name', 'set']);
        expect(typeof entry.set).toBe('boolean');
      }
    }
  });

  it('keeps a name it cannot place rather than dropping it', () => {
    const groups = groupCredentialPresence({ SOME_NEW_PROVIDER_KEY: true });
    const other = groups.find((g) => g.provider === 'other');
    expect(other?.names.map((n) => n.name)).toEqual(['SOME_NEW_PROVIDER_KEY']);
  });

  it('reports every credential name the probe declares', () => {
    const source = readFileSync(PROBE_SOURCE, 'utf8');
    const block = source.slice(
      source.indexOf('const CREDENTIAL_NAMES'),
      source.indexOf('] as const', source.indexOf('const CREDENTIAL_NAMES')),
    );
    const names = [...block.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(8);

    const present = Object.fromEntries(names.map((n) => [n, false]));
    const grouped = groupCredentialPresence(present)
      .flatMap((g) => g.names.map((n) => n.name))
      .sort();
    expect(grouped).toEqual([...names].sort());
    // Every declared name is placed with a provider — none falls to `other`.
    expect(groupCredentialPresence(present).some((g) => g.provider === 'other')).toBe(false);
  });
});

describe('presence is not entitlement', () => {
  it('says so when nothing is set, without claiming a network finding', () => {
    const summary = summariseProbe({ DOMAIN_API_KEY: false, PROPTRACK_API_KEY: false });
    expect(summary.anyCredentialSet).toBe(false);
    expect(summary.setCount).toBe(0);
    expect(summary.declaredCount).toBe(2);
    expect(summary.reading).toContain('unauthenticated');
  });

  it('never describes a set credential as working', () => {
    const summary = summariseProbe({ DOMAIN_CLIENT_ID: true, DOMAIN_CLIENT_SECRET: true });
    expect(summary.setCount).toBe(2);
    expect(summary.reading).toMatch(/not entitlement/i);
    expect(summary.reading).not.toMatch(/\b(working|configured correctly|ready)\b/i);
  });
});

describe('every provider status carries its owner', () => {
  it('routes a licensing question to commercial and a route question to engineering', () => {
    expect(PROVIDER_STATUS_READING.licensing_unverified.owner).toBe('commercial');
    expect(PROVIDER_STATUS_READING.entitlement_unavailable.owner).toBe('commercial');
    expect(PROVIDER_STATUS_READING.authentication_implementation_obsolete.owner).toBe('engineering');
    expect(PROVIDER_STATUS_READING.credential_absent.owner).toBe('operator');
  });

  it('never draws a licensing-unverified provider as positive', () => {
    expect(PROVIDER_STATUS_READING.licensing_unverified.tone).not.toBe('positive');
  });

  it('names every status the probe can set', () => {
    const source = readFileSync(PROBE_SOURCE, 'utf8');
    const union = source.slice(
      source.indexOf('type ProviderStatus'),
      source.indexOf(';', source.indexOf('type ProviderStatus')),
    );
    const declared = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(Object.keys(PROVIDER_STATUS_READING).sort()).toEqual(declared);
  });
});

describe('the owner routing is meaningful', () => {
  it('sends a 403-with-credential to commercial and a 404 to engineering', () => {
    expect(describeVerdict('not_entitled').owner).toBe('commercial');
    expect(describeVerdict('route_not_found').owner).toBe('engineering');
    expect(describeVerdict('credential_absent').owner).toBe('operator');
    expect(describeVerdict('server_error').owner).toBe('vendor');
  });

  it('does not claim a reachable endpoint carries usable measures', () => {
    const reading = describeVerdict('reachable');
    expect(reading.meaning).toMatch(/does not say/i);
    expect(reading.nextAction).toBeTruthy();
  });
});

// ── ME-6 final run: the classification defect the first live probe exposed ──

describe('an unauthenticated refusal is never an entitlement finding', () => {
  const src = readFileSync(PROBE_SOURCE, 'utf8');

  it('classify takes credential presence AND the target kind, not the status alone', () => {
    expect(src).toContain('function classify(status: number, credentialSent: boolean, kind: TargetKind)');
  });

  it('no call site may assert a credential was sent — the first version hardcoded true', () => {
    // The defect verbatim: `classify(response.status, isDomain ? … : true)`.
    const calls = [...src.matchAll(/classify\(([^)]*)\)/g)].map((m) => m[1]);
    const invocations = calls.filter((c) => !c.startsWith('status:'));
    expect(invocations.length).toBeGreaterThan(0);
    for (const args of invocations) {
      expect(args).not.toMatch(/,\s*true\s*[,)]?\s*$/);
      expect(args).not.toContain('? hasDomain');
    }
  });

  it('every target declares its kind, its credential names and its auth method', () => {
    const ids = [...src.matchAll(/id:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    const kinds = [...src.matchAll(/kind:\s*"(commercial|government)"/g)].length;
    const creds = [...src.matchAll(/credentialNames:\s*\[/g)].length;
    const auths = [...src.matchAll(/auth:\s*"(domain_api_key|not_implemented|none_required)"/g)].length;
    expect(kinds).toBe(ids.length);
    expect(creds).toBe(ids.length);
    expect(auths).toBe(ids.length);
  });

  it('a government target can never be classified as an entitlement problem', () => {
    // The rule, read off the classifier: government short-circuits before the
    // credentialSent branch that produces `not_entitled`.
    const body = src.slice(src.indexOf('function classify('), src.indexOf('\n}', src.indexOf('function classify(')));
    const at403 = body.slice(body.indexOf('status === 403'));
    expect(at403.indexOf('kind === "government"')).toBeLessThan(at403.indexOf('not_entitled'));
  });
});

describe('the auth-attempt reading states what reached the wire', () => {
  it('a public source can never carry an entitlement finding', () => {
    const r = describeAuthAttempt(false, false, 'government');
    expect(r.qualifiesFinding).toBe(false);
    expect(r.line).toMatch(/no credential applies/i);
  });

  it('names an unusable credential as unusable rather than pretending it was sent', () => {
    const r = describeAuthAttempt(false, true, 'commercial');
    expect(r.qualifiesFinding).toBe(false);
    expect(r.line).toMatch(/cannot use it/i);
    expect(r.line).toMatch(/inventing a contract/i);
  });

  it('only a sent credential qualifies a finding about access', () => {
    expect(describeAuthAttempt(true, false, 'commercial').qualifiesFinding).toBe(true);
    expect(describeAuthAttempt(false, false, 'commercial').qualifiesFinding).toBe(false);
    expect(describeAuthAttempt(false, false, 'commercial').line).toMatch(/not a statement about entitlement/i);
  });
});

describe('Domain’s API key is not described as obsolete', () => {
  const src = readFileSync(PROBE_SOURCE, 'utf8');

  it('an api-key credential alone makes Domain configured and testable', () => {
    const block = src.slice(src.indexOf('domain: {'), src.indexOf('cotality: {'));
    expect(block).toContain('hasDomainOAuth || hasDomainKey');
    expect(block).not.toContain('authentication_implementation_obsolete');
  });

  it('the repository description no longer calls X-API-Key obsolete', () => {
    const block = src.slice(src.indexOf('domain: {'), src.indexOf('cotality: {'));
    expect(block).not.toMatch(/X-Api-Key \(obsolete\)/);
    expect(block).toMatch(/documented scheme/i);
  });
});

describe('the provider diagnostic never carries credential material', () => {
  const src = readFileSync(PROBE_SOURCE, 'utf8');

  it('reads response headers from an allow-list that excludes auth and cookies', () => {
    const block = src.slice(src.indexOf('providerHeaders:'), src.indexOf('elapsedMs:', src.indexOf('providerHeaders:')));
    for (const banned of ['authorization', 'cookie', 'set-cookie', 'x-api-key']) {
      expect(block.toLowerCase()).not.toContain(`"${banned}"`);
    }
    expect(block).toContain('www-authenticate');
  });

  it('never reads back the request headers it sent', () => {
    expect(src).not.toMatch(/headers\[["']X-Api-Key["']\]\s*\)/);
    expect(src).not.toContain('JSON.stringify(headers');
  });
});
