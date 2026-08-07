import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideProvider } from '../../../supabase/functions/_shared/aml/providerEnvironment.ts';

/**
 * Identity verification runs live or not at all.
 *
 * Production previously carried a selfhosted IDV row in simulator mode. The
 * runtime correctly refused to execute it, but leaving that state persisted
 * made the provider look half-configured and kept operational work circling
 * around a mode that production must never use.
 */

describe('production never executes a simulator for identity verification', () => {
  it('refuses a real provider left in simulator mode', () => {
    const d = decideProvider({
      environment: 'production', providerKey: 'selfhosted', mode: 'simulator',
      adapterWired: true, adapterConfigured: true,
    });
    expect(d.kind).toBe('refuse');
    expect(d.kind === 'refuse' && d.message).toMatch(/still in simulator mode/i);
    expect(d.kind === 'refuse' && d.message).toMatch(/no verification attempt was recorded/i);
  });

  it('refuses when nothing is configured at all', () => {
    const d = decideProvider({
      environment: 'production', providerKey: 'simulator', mode: 'simulator',
      adapterWired: false, adapterConfigured: false,
    });
    expect(d.kind === 'refuse' && d.code).toBe('provider_not_configured');
  });

  it('never returns a simulator decision in production, whatever the inputs', () => {
    for (const providerKey of ['selfhosted', 'simulator', 'anything']) {
      for (const mode of ['simulator', 'live'] as const) {
        for (const wired of [true, false]) {
          for (const configured of [true, false]) {
            const d = decideProvider({
              environment: 'production', providerKey, mode,
              adapterWired: wired, adapterConfigured: configured,
            });
            expect(d.kind, `${providerKey}/${mode}/${wired}/${configured}`).not.toBe('simulator');
          }
        }
      }
    }
  });

  it('keeps simulator behaviour isolated to non-production test/local flows', () => {
    for (const environment of ['test', 'local', 'staging'] as const) {
      expect(decideProvider({
        environment, providerKey: 'selfhosted', mode: 'simulator',
        adapterWired: true, adapterConfigured: true,
      }).kind).toBe('simulator');
    }
  });

  it('goes live only when the adapter is wired and configured', () => {
    expect(decideProvider({
      environment: 'production', providerKey: 'selfhosted', mode: 'live',
      adapterWired: true, adapterConfigured: true,
    })).toEqual({ kind: 'live' });
  });
});

describe('persisted IDV provider configuration is live-only', () => {
  const guardMigration = readFileSync(
    'supabase/migrations/20260807000000_no_simulator_idv_in_production.sql', 'utf8');
  const normaliseMigration = readFileSync(
    'supabase/migrations/20260807110000_normalise_selfhosted_idv_live_mode.sql', 'utf8');

  it('keeps the historical production guard in the migration chain', () => {
    expect(guardMigration).toContain("capability = 'idv'");
    expect(guardMigration).toContain("mode = 'simulator'");
  });

  it('converts legacy selfhosted simulator rows to live but inactive', () => {
    expect(normaliseMigration).toMatch(/UPDATE aml\.provider_configs[\s\S]*SET mode = 'live',[\s\S]*active = false/);
    expect(normaliseMigration).toContain("capability = 'idv'");
    expect(normaliseMigration).toContain("provider_key = 'selfhosted'");
    expect(normaliseMigration).toContain("mode = 'simulator'");
  });

  it('rejects any persisted IDV simulator mode, not just active rows', () => {
    expect(normaliseMigration).toContain("IF NEW.capability = 'idv' AND NEW.mode = 'simulator' THEN");
    expect(normaliseMigration).toMatch(/RAISE EXCEPTION/);
  });

  it('leaves screening configuration alone', () => {
    const statements = normaliseMigration.split('\n')
      .filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(statements).not.toContain('pep_sanctions');
    expect(statements).not.toContain('local_lists');
  });

  it('carries an explicit rollback', () => {
    expect(normaliseMigration).toContain('-- ROLLBACK:');
  });

  it('the historical seed is inactive and the later migration removes its simulator state', () => {
    const seed = readFileSync(
      'supabase/migrations/20260802120000_seed_selfhosted_kyc_providers.sql', 'utf8');
    const idvBlock = seed.slice(0, seed.indexOf("'pep_sanctions'"));
    expect(idvBlock).toContain('false,');
    expect(normaliseMigration).toContain("SET mode = 'live'");
  });
});

describe('the configuration screen offers no simulator for identity verification', () => {
  const page = readFileSync('src/pages/aml/AmlConfiguration.tsx', 'utf8');

  it('hides the simulator mode option for idv', () => {
    expect(page).toContain('form.capability !== "idv"');
  });

  it('defaults a new idv provider to live', () => {
    expect(page).toMatch(/capability: "idv"[\s\S]{0,200}?mode: "live"/);
  });
});
