/**
 * Asking each jurisdiction what it publishes as its own population
 * projection — before any loader is written against it.
 *
 * These pin the discovery rules, not a measurement: the measurement is the
 * CI probe's output, and a constant recording it is changed when the probe
 * says so.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESCRIBE_MAX_BYTES,
  ESTIMATE_PATTERN,
  PROJECTION_CATALOGUES,
  PROJECTION_PATTERN,
  PROJECTION_STATES,
  STATE_NAMES,
  judgeProjectionDataset,
  parseProjectionCatalogue,
  projectionAttributable,
  projectionFileLinks,
  projectionInventoryUrl,
  projectionSearchUrl,
  rankProjectionCandidates,
  rankProjectionLinks,
} from '../../../../supabase/functions/_shared/reports/market/openData/stateProjectionPublishers.pure';
import { FORWARD_DEMAND_PUBLISHERS } from '../../../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure';
import type { VolumeDataset } from '../../../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure';

const ds = (over: Partial<VolumeDataset> & { id: string }): VolumeDataset => ({
  name: over.id,
  title: over.id,
  notes: null,
  organisation: null,
  licence: null,
  metadataModified: null,
  resources: [],
  ...over,
});

const res = (format: string, url = `https://x/${format.toLowerCase()}`) => ({
  id: url, name: url, format, url, datastoreActive: false, size: null,
});

describe('every jurisdiction is asked, and the probe names only what it measured', () => {
  it('covers all eight, and every one has a product page to ask', () => {
    expect([...PROJECTION_STATES].sort()).toEqual(Object.keys(FORWARD_DEMAND_PUBLISHERS).sort());
    for (const s of PROJECTION_STATES) expect(FORWARD_DEMAND_PUBLISHERS[s].url).toMatch(/^https:\/\//);
  });

  it('marks as measured only the catalogues CI has actually reached', () => {
    const measured = PROJECTION_CATALOGUES.filter((c) => c.measured).map((c) => c.state).sort();
    expect(measured).toEqual(['ACT', 'NT', 'WA']);
    // Tasmania has no catalogue this repository has verified — its typed root is ENOTFOUND.
    expect(PROJECTION_CATALOGUES.some((c) => c.state === 'TAS')).toBe(false);
  });

  it('asks each dialect in its own terms', () => {
    const act = PROJECTION_CATALOGUES.find((c) => c.state === 'ACT')!;
    const nsw = PROJECTION_CATALOGUES.find((c) => c.state === 'NSW')!;
    expect(projectionSearchUrl(act, 'population projections')).toContain('api.us.socrata.com');
    expect(projectionSearchUrl(nsw, 'population projections')).toContain('/action/package_search?');
    expect(projectionInventoryUrl(nsw)).toContain('rows=0');
    expect(parseProjectionCatalogue({ dialect: 'ckan' }, '<html>').kind).toBe('refused');
  });
});

describe('a projection is judged on the publisher’s own words', () => {
  it('finds the finest grain the publisher names, and a file a loader could read', () => {
    const j = judgeProjectionDataset(ds({
      id: 'vif',
      title: 'Victoria in Future 2023 — population projections by SA2 and LGA',
      resources: [res('PDF'), res('XLSX')],
    }));
    expect(j.projection).toBe(true);
    expect(j.grainWords).toEqual(['sa2', 'lga']);
    expect(j.machineReadable?.format).toBe('XLSX');
  });

  it('refuses a measured estimate by name — the worst thing to print under a forward heading', () => {
    const erp = judgeProjectionDataset(ds({ id: 'erp', title: 'Estimated Resident Population by LGA' }));
    expect(erp.projection).toBe(false);
    expect(erp.estimateOnly).toBe(true);
    expect(rankProjectionCandidates([ds({ id: 'erp', title: 'Estimated Resident Population by LGA' })])).toEqual([]);
    expect(ESTIMATE_PATTERN.test('Estimated resident population')).toBe(true);
    expect(PROJECTION_PATTERN.test('Population projections 2021-2046')).toBe(true);
  });

  it('carries a suburb as a WORD, never as an SA2', () => {
    const act = judgeProjectionDataset(ds({ id: 'act', title: 'ACT population projections by suburb and district' }));
    expect(act.grainWords).toEqual(['suburb', 'district']);
    expect(act.grainWords).not.toContain('sa2');
  });

  it('ranks the finest named grain first, then a readable file', () => {
    const ranked = rankProjectionCandidates([
      ds({ id: 'lga', title: 'Projections by local government area', resources: [res('XLSX')] }),
      ds({ id: 'sa2-pdf', title: 'Projections by SA2', resources: [res('PDF')] }),
      ds({ id: 'sa2-csv', title: 'Projections by SA2', resources: [res('CSV')] }),
    ]);
    expect(ranked.map((j) => j.dataset.id)).toEqual(['sa2-csv', 'sa2-pdf', 'lga']);
  });
});

describe('a harvest hit is attributed to a jurisdiction by its own full name', () => {
  it('accepts the state’s own agencies', () => {
    expect(projectionAttributable(ds({ id: 'a', organisation: 'Queensland Government Statistician’s Office' }), 'QLD')).toBe(true);
    expect(projectionAttributable(ds({ id: 'b', organisation: 'Department of Transport and Planning (Victoria)' }), 'VIC')).toBe(true);
  });

  it('never attributes a council’s own forecast to the state', () => {
    // Town of Victoria Park is a Western Australian council.
    expect(projectionAttributable(ds({ id: 'c', organisation: 'Town of Victoria Park' }), 'VIC')).toBe(false);
    expect(projectionAttributable(ds({ id: 'd', organisation: 'City of Sydney' }), 'NSW')).toBe(false);
  });

  it('never attributes by abbreviation', () => {
    expect(projectionAttributable(ds({ id: 'e', organisation: 'Department of Climate Action' }), 'ACT')).toBe(false);
    for (const s of PROJECTION_STATES) for (const n of STATE_NAMES[s]) expect(n.length).toBeGreaterThan(4);
  });
});

describe('the product page is read for its files, and only its files', () => {
  const page = `
    <p>Download <a href="/sites/default/files/2024-05/NSW%20Population%20Projections%20by%20SA2.xlsx">projections by SA2 (XLSX)</a></p>
    <a href='https://example.nsw.gov.au/data/lga-projections.csv'>LGA projections</a>
    <a href="/docs/methodology.pdf">Methodology</a>
    <a href="/sites/default/files/2024-05/NSW%20Population%20Projections%20by%20SA2.xlsx">again</a>
    <a href="javascript:void(0)">x.xlsx</a>
    <a href="mailto:a@b.c?subject=x.csv">mail</a>`;

  it('resolves relative links, drops duplicates, and refuses anything that is not a web file', () => {
    const links = projectionFileLinks(page, 'https://www.planning.nsw.gov.au/research-and-demography/population-projections');
    expect(links.map((l) => l.url)).toEqual([
      'https://www.planning.nsw.gov.au/sites/default/files/2024-05/NSW%20Population%20Projections%20by%20SA2.xlsx',
      'https://example.nsw.gov.au/data/lga-projections.csv',
    ]);
    expect(links[0]).toMatchObject({ format: 'XLSX', projection: true });
    expect(links[0].grainWords).toContain('sa2');
    expect(links[1].grainWords).toContain('lga');
  });

  it('puts the finest grain first', () => {
    const links = projectionFileLinks(page, 'https://www.planning.nsw.gov.au/p');
    expect(rankProjectionLinks([...links].reverse())[0].format).toBe('XLSX');
  });
});

describe('the probe writes nothing, describes a file without downloading an archive, and fails only on our reader', () => {
  const probe = readFileSync('scripts/market/state-projection-liveness.ts', 'utf8');
  const module = readFileSync('supabase/functions/_shared/reports/market/openData/stateProjectionPublishers.pure.ts', 'utf8');

  it('names no table, no client and no credential', () => {
    for (const [name, src] of [['probe', probe], ['module', module]] as const) {
      expect(src, name).not.toMatch(/createClient|SERVICE_ROLE|SUPABASE_URL|\.from\(\s*['"]/);
      expect(src, name).not.toMatch(/\b(?:insert|upsert|delete)\s*\(/);
    }
  });

  it('constructs no evidence, so nothing it finds can reach the scorer', () => {
    for (const asserted of [/\bnew\s+EvidencePoint\b/, /:\s*EvidencePoint\b/, /\bimport\b[^;]*\bEvidencePoint\b/]) {
      expect(module, String(asserted)).not.toMatch(asserted);
      expect(probe, String(asserted)).not.toMatch(asserted);
    }
  });

  it('caps a description, and exits 1 on exactly one path', () => {
    expect(DESCRIBE_MAX_BYTES).toBeLessThanOrEqual(50_000_000);
    expect(probe.match(/process\.exit\(1\)/g) ?? []).toHaveLength(1);
    expect(probe).toMatch(/function ours\(/);
  });
});
