/**
 * The national pipeline register — discovery, and the four different sentences.
 *
 * Every fixture here is written to CKAN's own published envelope shape
 * (`{success, result: {count, results: [{organization, resources: [...]}]}}`),
 * which is what `data.gov.au` serves and what `investmentProgramme.pure.ts`
 * already reads Queensland's QTRIP through. The publisher's OWN bytes are
 * verified separately and from CI, by `scripts/market/national-pipeline-liveness.ts`,
 * because this egress answers 403 to CONNECT for `data.gov.au` — which is why
 * a fixture suite alone is never the verification here, only the shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MACHINE_READABLE_FORMATS,
  NATIONAL_PIPELINE_PUBLISHER,
  NATIONAL_PIPELINE_QUERIES,
  NATIONAL_PIPELINE_REGISTER,
  assessPipelineAvailability,
  ckanFieldsUrl,
  ckanSampleUrl,
  ckanSearchUrl,
  mergeCatalogueReads,
  parseCkanSearch,
  pipelineCoverageNote,
  rankPipelineResources,
  surveyPipelinePackages,
  type CkanPackage,
  type CkanParse,
} from '@/lib/reports/../../../supabase/functions/_shared/planning/nationalPipeline.pure';

interface ResourceSeed {
  id?: string;
  name?: string;
  format?: string;
  url?: string;
  datastore_active?: boolean;
  size?: number | string;
  last_modified?: string;
}

function ckan(
  results: {
    id: string;
    name: string;
    title: string;
    org?: string;
    licence?: string;
    modified?: string;
    resources?: ResourceSeed[];
  }[],
  count = results.length,
): string {
  return JSON.stringify({
    success: true,
    result: {
      count,
      results: results.map((r) => ({
        id: r.id,
        name: r.name,
        title: r.title,
        license_title: r.licence ?? 'Creative Commons Attribution 4.0 International',
        metadata_modified: r.modified ?? '2026-07-01T00:00:00.000000',
        organization: r.org === undefined ? undefined : { name: 'slug', title: r.org },
        resources: (r.resources ?? []).map((res, i) => ({
          id: res.id ?? `res-${r.id}-${i}`,
          name: res.name ?? `resource ${i}`,
          format: res.format ?? 'CSV',
          url: res.url ?? `https://data.gov.au/dataset/${r.name}/resource/${i}/download/file.csv`,
          datastore_active: res.datastore_active ?? false,
          size: res.size,
          last_modified: res.last_modified,
        })),
      })),
    },
  });
}

const IA = 'Infrastructure Australia';

function catalogueOf(text: string): CkanPackage[] {
  const parse = parseCkanSearch(text);
  if (parse.kind !== 'catalogue') throw new Error(`expected a catalogue, got ${parse.reason}`);
  return parse.packages;
}

describe('reading the Commonwealth catalogue', () => {
  it('reads a package, its organisation title and its resources', () => {
    const parse = parseCkanSearch(
      ckan([
        {
          id: 'pkg-1',
          name: 'infrastructure-priority-list',
          title: 'Infrastructure Priority List 2026',
          org: IA,
          resources: [{ format: 'csv', datastore_active: true, size: '81920' }],
        },
      ], 1),
    );
    expect(parse.kind).toBe('catalogue');
    if (parse.kind !== 'catalogue') return;
    expect(parse.total).toBe(1);
    expect(parse.packages[0].organisation).toBe(IA);
    expect(parse.packages[0].licence).toContain('Creative Commons');
    // The publisher's own format word, upper-cased — never inferred from the URL.
    expect(parse.packages[0].resources[0].format).toBe('CSV');
    expect(parse.packages[0].resources[0].datastoreActive).toBe(true);
    expect(parse.packages[0].resources[0].size).toBe(81920);
  });

  it('refuses a body that is not JSON, naming the size and the first bytes', () => {
    const html = `<!DOCTYPE html><html><head><title>Service unavailable</title></head>${'x'.repeat(4000)}`;
    const parse = parseCkanSearch(html);
    expect(parse.kind).toBe('refused');
    if (parse.kind !== 'refused') return;
    expect(parse.reason).toContain(String(html.length));
    expect(parse.reason).toContain('DOCTYPE');
  });

  it('refuses CKAN’s own failure envelope rather than reading it as empty', () => {
    const parse = parseCkanSearch(JSON.stringify({ success: false, error: { message: 'Not found' } }));
    expect(parse.kind).toBe('refused');
    if (parse.kind !== 'refused') return;
    expect(parse.reason).toContain('Not found');
  });

  it('refuses a 200 whose shape it does not recognise', () => {
    const parse = parseCkanSearch(JSON.stringify({ success: true, result: { count: 3 } }));
    expect(parse.kind).toBe('refused');
    if (parse.kind !== 'refused') return;
    expect(parse.reason).toContain('no result.results array');
  });
});

describe('which packages are the register', () => {
  it('needs the publisher AND the register’s name, because either alone is wrong', () => {
    const packages = catalogueOf(
      ckan([
        // The register.
        { id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA },
        // Right publisher, different publication.
        { id: 'b', name: 'audit', title: 'Australian Infrastructure Audit 2026', org: IA },
        // Right name, a different jurisdiction's register with a different coverage claim.
        { id: 'c', name: 'nsw-ipl', title: 'NSW Infrastructure Priority List', org: 'Infrastructure NSW' },
        // Neither.
        { id: 'd', name: 'roads', title: 'Road deaths by month', org: 'BITRE' },
      ]),
    );
    expect(surveyPipelinePackages(packages).map((p) => p.id)).toEqual(['a']);
  });

  it('accepts the names the publisher has actually used for this list', () => {
    const packages = catalogueOf(
      ckan([
        { id: 'a', name: 'p1', title: 'Infrastructure Priority List 2026', org: IA },
        { id: 'b', name: 'p2', title: 'Infrastructure Pipeline', org: IA },
        { id: 'c', name: 'p3', title: 'Priority Initiatives and Projects', org: IA },
      ]),
    );
    expect(surveyPipelinePackages(packages)).toHaveLength(3);
  });

  it('never returns the same package twice', () => {
    const packages = catalogueOf(
      ckan([
        { id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA },
        { id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA },
      ]),
    );
    expect(surveyPipelinePackages(packages)).toHaveLength(1);
  });
});

describe('which resource is tried first', () => {
  it('puts a queryable resource before a download, whatever its date', () => {
    const packages = catalogueOf(
      ckan([
        {
          id: 'a',
          name: 'ipl',
          title: 'Infrastructure Priority List',
          org: IA,
          modified: '2024-01-01T00:00:00.000000',
          resources: [{ id: 'live', format: 'CSV', datastore_active: true }],
        },
        {
          id: 'b',
          name: 'ipl-2026',
          title: 'Infrastructure Priority List 2026',
          org: IA,
          modified: '2026-09-01T00:00:00.000000',
          resources: [{ id: 'file', format: 'CSV' }],
        },
      ]),
    );
    const ranked = rankPipelineResources(packages);
    expect(ranked.map((c) => c.resource.id)).toEqual(['live', 'file']);
    expect(ranked[0].access).toBe('queryable');
    expect(ranked[1].access).toBe('download');
  });

  it('prefers the newer edition, then the declared format order', () => {
    const packages = catalogueOf(
      ckan([
        {
          id: 'a',
          name: 'ipl-2024',
          title: 'Infrastructure Priority List 2024',
          org: IA,
          modified: '2024-06-01T00:00:00.000000',
          resources: [{ id: 'old-csv', format: 'CSV' }],
        },
        {
          id: 'b',
          name: 'ipl-2026',
          title: 'Infrastructure Priority List 2026',
          org: IA,
          modified: '2026-06-01T00:00:00.000000',
          resources: [
            { id: 'new-xlsx', format: 'XLSX' },
            { id: 'new-csv', format: 'CSV' },
          ],
        },
      ]),
    );
    expect(rankPipelineResources(packages).map((c) => c.resource.id))
      .toEqual(['new-csv', 'new-xlsx', 'old-csv']);
  });

  it('refuses a document as a register, and leaves it findable as a format', () => {
    const packages = catalogueOf(
      ckan([
        {
          id: 'a',
          name: 'ipl',
          title: 'Infrastructure Priority List',
          org: IA,
          resources: [
            { id: 'pdf', format: 'PDF' },
            { id: 'doc', format: 'DOCX' },
          ],
        },
      ]),
    );
    expect(rankPipelineResources(packages)).toHaveLength(0);
    const availability = assessPipelineAvailability(parseCkanSearch(
      ckan([
        {
          id: 'a',
          name: 'ipl',
          title: 'Infrastructure Priority List',
          org: IA,
          resources: [
            { id: 'pdf', format: 'PDF' },
            { id: 'doc', format: 'DOCX' },
          ],
        },
      ]),
    ));
    expect(availability.kind).toBe('published_as_documents');
    if (availability.kind !== 'published_as_documents') return;
    expect(availability.formats).toEqual(['DOCX', 'PDF']);
  });

  it('takes a datastore-active resource even when its format is one we cannot decode', () => {
    // Rule 3: a queryable endpoint is not a format. CKAN answers JSON for it
    // however the catalogue labels the underlying distribution.
    const packages = catalogueOf(
      ckan([
        {
          id: 'a',
          name: 'ipl',
          title: 'Infrastructure Priority List',
          org: IA,
          resources: [{ id: 'live', format: 'PDF', datastore_active: true }],
        },
      ]),
    );
    expect(rankPipelineResources(packages).map((c) => c.resource.id)).toEqual(['live']);
  });
});

describe('merging several searches', () => {
  it('de-duplicates by package id and keeps the larger declared total', () => {
    const a = parseCkanSearch(ckan([{ id: 'x', name: 'ipl', title: 'Infrastructure Priority List', org: IA }], 4));
    const b = parseCkanSearch(ckan([
      { id: 'x', name: 'ipl', title: 'Infrastructure Priority List', org: IA },
      { id: 'y', name: 'pipe', title: 'Infrastructure Pipeline', org: IA },
    ], 9));
    const merged = mergeCatalogueReads([a, b]);
    expect(merged.kind).toBe('catalogue');
    if (merged.kind !== 'catalogue') return;
    expect(merged.packages.map((p) => p.id)).toEqual(['x', 'y']);
    expect(merged.total).toBe(9);
  });

  it('a refusal anywhere refuses the whole reading', () => {
    const good = parseCkanSearch(ckan([{ id: 'x', name: 'ipl', title: 'Infrastructure Priority List', org: IA }]));
    const bad: CkanParse = { kind: 'refused', reason: 'HTTP 502' };
    expect(mergeCatalogueReads([good, bad]).kind).toBe('refused');
    // A partial catalogue read as a complete one makes an absent package
    // indistinguishable from a query that failed.
    expect(mergeCatalogueReads([]).kind).toBe('refused');
  });
});

describe('the four absences are four different sentences', () => {
  const readings: CkanParse[] = [
    parseCkanSearch(ckan([{
      id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA,
      resources: [{ id: 'live', format: 'CSV', datastore_active: true }],
    }])),
    parseCkanSearch(ckan([{
      id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA,
      resources: [{ id: 'pdf', format: 'PDF' }],
    }])),
    parseCkanSearch(ckan([{ id: 'z', name: 'roads', title: 'Road deaths', org: 'BITRE' }])),
    { kind: 'refused', reason: 'HTTP 503' },
  ];

  it('names a distinct availability for each', () => {
    expect(readings.map((r) => assessPipelineAvailability(r).kind)).toEqual([
      'readable',
      'published_as_documents',
      'not_in_catalogue',
      'catalogue_unavailable',
    ]);
  });

  it('writes four distinct notes, each naming the register that was asked', () => {
    const notes = readings.map((r) => pipelineCoverageNote(assessPipelineAvailability(r)));
    expect(new Set(notes).size).toBe(4);
    for (const note of notes) {
      expect(note).toContain(NATIONAL_PIPELINE_PUBLISHER);
      expect(note).toContain(NATIONAL_PIPELINE_REGISTER);
    }
  });

  it('rates no absence — the level is never a judgement about the area', () => {
    // §9 of PLANNING_CONTROLS_IN_THE_REPORT.md: an absence may not be rated,
    // and never as a strength either.
    const forbidden = /\b(low|minimal|limited|negligible|favourable|favorable|strong|weak|poor|good)\b/i;
    for (const reading of readings) {
      expect(pipelineCoverageNote(assessPipelineAvailability(reading))).not.toMatch(forbidden);
    }
  });

  it('never states that the area has no planned infrastructure', () => {
    const forbidden = /\bno (?:planned |named |major )?(?:infrastructure|projects?|works)\b/i;
    for (const reading of readings) {
      expect(pipelineCoverageNote(assessPipelineAvailability(reading))).not.toMatch(forbidden);
    }
  });
});

describe('the URLs', () => {
  it('asks for the declarations without a single row', () => {
    expect(ckanFieldsUrl('abc-123')).toContain('limit=0');
    expect(ckanSampleUrl('abc-123', 5)).toContain('limit=5');
  });

  it('encodes a resource id rather than interpolating it', () => {
    expect(ckanFieldsUrl('a/b c')).toContain('resource_id=a%2Fb%20c');
  });

  it('encodes a quoted search phrase', () => {
    expect(ckanSearchUrl('"infrastructure priority list"')).toContain('q=%22infrastructure%20priority%20list%22');
    expect(ckanSearchUrl('x', 10, 20)).toContain('rows=10&start=20');
  });

  it('asks more than one question of the catalogue', () => {
    // One query is one guess about how a publisher titles its own work.
    expect(NATIONAL_PIPELINE_QUERIES.length).toBeGreaterThan(1);
  });

  it('names no organisation slug, package id or resource id anywhere in the module', () => {
    /*
     * An identifier nobody here could verify fails exactly like an absent one —
     * `absBuildingApprovals.pure.ts` pays for this rule, and it is why the
     * dataflow there is discovered rather than typed. A resource id is
     * something this module OUTPUTS, so a CKAN uuid appearing in its source
     * would mean a future edition silently reads a past one.
     */
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions/_shared/planning/nationalPipeline.pure.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(code).not.toMatch(/organization:\s*\S/);
    // The declared preference order is the one thing that IS a literal here.
    expect(MACHINE_READABLE_FORMATS.join(',')).toBe('CSV,XLSX,XLS,JSON,GEOJSON');
  });
});
