/**
 * The open-data sales register is wired into the grade — pinned at the
 * source, because the generator runs only against Perplexity, the cadastre
 * and the database.
 *
 * What is pinned is the rule, not a number: the register is consulted beside
 * Domain (after it, so Domain's suburb series is the incumbent a coarser
 * point has to beat), asked only for the cadastre's council or the boundary
 * service's postcode, merged per measure with the finer point winning, and
 * named in the growth gap so an operator reading "grade withheld" is sent to
 * the loader rather than only to Domain's portal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const GENERATOR = read('supabase', 'functions', 'generate-investment-report', 'index.ts');
const SCORING = read('supabase', 'functions', '_shared', 'reports', 'market', 'scoringV2Production.pure.ts');
const LOADER = read('supabase', 'functions', 'market-sales-ingest', 'index.ts');
const CONFIG = read('supabase', 'config.toml');
const MIGRATION = read('supabase', 'migrations', '20261125090000_market_sales_medians.sql');
const EVIDENCE = read('supabase', 'functions', '_shared', 'reports', 'market', 'marketEvidence.pure.ts');

describe('the generator consults the register beside Domain', () => {
  const block = GENERATOR.slice(GENERATOR.indexOf('const registerSource = salesRegisterSourceFor(marketState);'));
  const registerBlock = block.slice(0, block.indexOf('// Population growth'));

  it('asks after Domain and before the population driver, inside the market-evidence block', () => {
    const domainAt = GENERATOR.indexOf("providersConsulted.push('domain');");
    const registerAt = GENERATOR.indexOf('const registerSource = salesRegisterSourceFor(marketState);');
    const populationAt = GENERATOR.indexOf('populationGrowthPoint(erpSeries');
    expect(domainAt).toBeGreaterThan(0);
    expect(registerAt).toBeGreaterThan(domainAt);
    expect(populationAt).toBeGreaterThan(registerAt);
  });

  it('asks only for the cadastre\'s council or the trusted postcode — never a typed suburb or a parsed token', () => {
    expect(registerBlock).toContain("enhancedData.planningData?.parcel?.status === 'ok'");
    expect(registerBlock).toContain("registerAsks.push({ areaKind: 'postcode', area: marketPostcode });");
    expect(registerBlock).toContain("registerAsks.push({ areaKind: 'lga', area: cadastreLga });");
    expect(registerBlock).not.toMatch(/area:\s*suburb\b/);
    expect(registerBlock).not.toContain('propertyAddress.match');
  });

  it('records the provider as consulted, and as unavailable with the reason when nothing answers', () => {
    expect(registerBlock).toContain('providersConsulted.push(registerSource.provider);');
    expect(registerBlock).toContain('providersUnavailable.push({ provider: registerSource.provider, reason: registerNotes.join');
    expect(registerBlock).toContain('load it with market-sales-ingest');
  });

  it('merges per measure so a finer, dwelling-matched point wins whichever provider it came from', () => {
    expect(registerBlock).toContain('mergeEvidence(registerSubject, [held, offered])');
    expect(registerBlock).toContain('for (const key of EVIDENCE_KEYS)');
    expect(registerBlock).not.toContain('Object.assign(marketPoints, answer.points)');
  });

  it('reads the register through the one read helper and the one adapter', () => {
    expect(GENERATOR).toContain("import { readSalesRegister } from '../_shared/reports/market/salesRegisterRead.ts';");
    expect(GENERATOR).toContain("import { openDataSalesPoints, salesRegisterSourceFor } from '../_shared/reports/market/openDataSalesEvidence.pure.ts';");
  });
});

describe('the growth gap names the register', () => {
  it('sends an operator to the loader as well as to Domain', () => {
    const remedy = SCORING.slice(SCORING.indexOf("case 'growth':"), SCORING.indexOf("case 'demand':"));
    expect(remedy).toContain('market-sales-ingest');
    expect(remedy).toContain('OPEN_DATA_GROWTH_EVIDENCE.md');
    expect(remedy).toContain('DOMAIN_ACTIVATION_REQUEST.md');
  });
});

describe('the loader and its declarations', () => {
  it('is declared to the gateway and the security registry', () => {
    expect(CONFIG).toMatch(/\[functions\.market-sales-ingest\]\s*\nverify_jwt = true/);
    const registry = JSON.parse(read('supabase', 'functions-registry', 'SECURITY_REGISTRY.json'));
    expect(registry.functions['market-sales-ingest']).toMatchObject({ verify_jwt: true, exposure_class: 'internal-service', reviewed: true });
  });

  it('authorises through verifyAuth and discovers the workbooks from the publishers\' pages, never a pinned dated file', () => {
    expect(LOADER).toContain('verifyAuth(supabase, req.headers, body)');
    expect(LOADER).toContain('discoverQgsoRldaSpreadsheet(page)');
    expect(LOADER).toContain('dcjSalesLinks(current + previous)');
    expect(LOADER).not.toMatch(/all-monitored-regions-\d{8}\.xlsx/);
    expect(LOADER).not.toMatch(/sales-tables-[a-z]+-\d{4}/);
  });

  it('refuses rather than stores, and writes only the register and its log', () => {
    expect(LOADER).toContain('parseQgsoRldaSales(sheets); // throws → nothing written');
    expect(LOADER).toMatch(/\.from\('market_sales_medians'\)/);
    expect(LOADER).toMatch(/\.from\('market_sales_sync'\)/);
    const tables = [...LOADER.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['market_sales_medians', 'market_sales_sync']));
  });

  it('the register keeps a suppressed median as null and keys a quarter by its end month', () => {
    expect(MIGRATION).toContain('primary key (state, area_kind, area, dwelling_type, period)');
    expect(MIGRATION).toContain("check (period ~ '^[0-9]{4}-(03|06|09|12)$')");
    expect(MIGRATION).toContain('median_price numeric check (median_price is null or median_price > 0)');
    expect(MIGRATION).toContain('enable row level security');
  });

  it('the two registers are providers the evidence vocabulary knows', () => {
    expect(EVIDENCE).toContain("| 'qld_qgso_rlda'");
    expect(EVIDENCE).toContain("| 'nsw_dcj_rent_sales'");
  });
});
