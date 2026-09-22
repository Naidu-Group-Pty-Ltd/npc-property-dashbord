/**
 * W3.5 — does ACT, NT, TAS or WA publish a COUNT of residential sales?
 *
 * The assertion that matters most here is the one that stops a success being
 * declared where nothing changed. All four jurisdictions ALREADY hold a price
 * series at state grain (`absResDwell`, the ABS mean price of residential
 * dwellings), and every one of them publishes something called "property
 * sales" — so finding a sales dataset and reporting the gap closed is the easy
 * and wrong outcome. `scoreTransactionVolume` needs a **count**, over four
 * periods, at an area finer than the state.
 *
 * So `medians_only` and `state_grain_only` are asserted to be distinct
 * readings with their own sentences, and neither may be paraphrased into a
 * find.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COUNT_PATTERN,
  MACHINE_READABLE_FORMATS,
  MEDIAN_PATTERN,
  SUB_STATE_PATTERN,
  VOLUME_CATALOGUES,
  VOLUME_GAP_STATES,
  VOLUME_PERIODS_REQUIRED,
  VOLUME_QUERIES,
  VOLUME_SCORED_STATES,
  assessVolumeCoverage,
  judgeVolumeDataset,
  mergeVolumeReads,
  parseVolumeCatalogue,
  rankVolumeCandidates,
  volumeCoverageNote,
  volumeSearchUrl,
  type VolumeCoverage,
  type VolumeDataset,
  type VolumeGapState,
} from '../../../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure';
import { VOLUME_BASELINE_PERIODS } from '../../../../supabase/functions/_shared/reports/market/demandScoring.pure';

const dataset = (over: Partial<VolumeDataset> = {}): VolumeDataset => ({
  id: 'id-1',
  name: 'slug',
  title: 'Property Sales',
  notes: null,
  organisation: 'A Publisher',
  licence: 'CC BY 4.0',
  metadataModified: '2026-09-01T00:00:00Z',
  resources: [],
  ...over,
});

describe('the number a demand reading needs', () => {
  /*
   * The one literal this module could not avoid — it must parse under Deno
   * with no dependency on the scoring engine's evidence vocabulary. So the
   * pair is held together by a test instead: `AML_COMMAND_REFRESH_EVENT`'s
   * rule, that a literal at each end is how two ends drift.
   */
  it('equals the scorer’s own baseline plus the latest period', () => {
    expect(VOLUME_PERIODS_REQUIRED).toBe(VOLUME_BASELINE_PERIODS + 1);
  });

  /*
   * A probe that only knows about the four it is looking at cannot tell you it
   * is looking at the right four.
   */
  it('names the four that cannot score and the four that can, without overlap', () => {
    expect([...VOLUME_GAP_STATES].sort()).toEqual(['ACT', 'NT', 'TAS', 'WA']);
    expect([...VOLUME_SCORED_STATES].sort()).toEqual(['NSW', 'QLD', 'SA', 'VIC']);
    for (const s of VOLUME_GAP_STATES) {
      expect(VOLUME_SCORED_STATES, s).not.toContain(s);
    }
  });

  /*
   * The scored four are asserted against the LOADERS rather than trusted,
   * because `market-sales-ingest` has already lost a jurisdiction's counts
   * once by writing `sales_count: null` into `ON CONFLICT DO UPDATE SET` on
   * every daily run. A silent regression should contradict this list.
   */
  it('is corroborated by a loader that writes a count for each scored state', () => {
    const loaders: Record<string, string> = {
      NSW: 'supabase/functions/_shared/reports/market/openData/nswDcjSales.pure.ts',
      QLD: 'supabase/functions/_shared/reports/market/openData/qgsoRldaSales.pure.ts',
      SA: 'supabase/functions/_shared/reports/market/openData/saLsgStats.pure.ts',
      VIC: 'supabase/functions/_shared/reports/market/openData/vicVpsrSuburb.pure.ts',
    };
    for (const state of VOLUME_SCORED_STATES) {
      const path = loaders[state];
      expect(path, state).toBeTruthy();
      const src = readFileSync(path, 'utf8');
      /*
       * Either spelling. The first cut asked for `salesCount:` followed by
       * something other than `null` and missed South Australia, which passes
       * the value as a SHORTHAND property — `salesCount,`. That is the
       * repository's own TS18004 lesson in a test: shorthand is how almost
       * everything here is passed around, so a guard that cannot see it is
       * blind to most of the code it claims to judge.
       */
      expect(src, state).toMatch(/salesCount:\s*(?!null\b)|\bsalesCount\s*,/);
    }
    /* And Victoria's four counted periods come from the backfill, not the file. */
    const backfill = readFileSync(
      'supabase/functions/_shared/reports/market/openData/vicVolumeBackfill.pure.ts', 'utf8');
    expect(backfill).toContain('ONE `No. of Sales` column');
  });
});

describe('a median series is not a count series', () => {
  it('recognises a count in the publisher’s own vocabulary', () => {
    for (const words of [
      'Number of sales', 'No. of Sales', 'no of sales', 'sales volume', 'Sales Count',
      'transaction count', 'number of transfers', 'properties sold', 'dwellings sold',
      'volume of transfers', 'number of dwellings',
    ]) {
      expect(COUNT_PATTERN.test(words), words).toBe(true);
    }
  });

  /*
   * The narrowness is the point. These four already hold a price at state
   * grain, so a dataset that mentions sales and publishes only prices closes
   * nothing — and would look like a fix.
   */
  it('does not read a price as a count', () => {
    for (const words of [
      'Median sale price', 'Mean price of residential dwellings', 'Average sale value',
      'Price index', 'sale price quartiles', 'Property sales', 'Land sales report',
    ]) {
      expect(COUNT_PATTERN.test(words), words).toBe(false);
    }
  });

  it('tells a median dataset apart from a count one', () => {
    expect(MEDIAN_PATTERN.test('Median sale price by suburb')).toBe(true);
    expect(MEDIAN_PATTERN.test('Number of sales by suburb')).toBe(false);
  });

  it('recognises an area finer than the state and nothing coarser', () => {
    for (const w of ['by suburb', 'by postcode', 'local government area', 'LGA', 'SA2',
      'statistical area', 'by locality', 'by district', 'by council']) {
      expect(SUB_STATE_PATTERN.test(w), w).toBe(true);
    }
    for (const w of ['Western Australia', 'territory total', 'whole of state']) {
      expect(SUB_STATE_PATTERN.test(w), w).toBe(false);
    }
  });
});

describe('judging a candidate', () => {
  it('reads the title, the notes and the resource names together', () => {
    /* A title alone is a headline; the notes are where a publisher lists columns. */
    const c = judgeVolumeDataset(dataset({
      title: 'Property Sales',
      notes: 'Quarterly median price and number of sales by suburb.',
      resources: [{ id: 'r1', name: 'sales.csv', format: 'CSV', url: 'https://h/x.csv', datastoreActive: true, size: 10 }],
    }));
    expect(c.count).toBe(true);
    expect(c.subState).toBe(true);
    expect(c.median).toBe(true);
    expect(c.machineReadable?.id).toBe('r1');
  });

  it('prefers a queryable resource to a download', () => {
    const c = judgeVolumeDataset(dataset({
      notes: 'number of sales by LGA',
      resources: [
        { id: 'dl', name: 'a.csv', format: 'CSV', url: 'https://h/a.csv', datastoreActive: false, size: null },
        { id: 'q', name: 'b.csv', format: 'CSV', url: 'https://h/b.csv', datastoreActive: true, size: null },
      ],
    }));
    expect(c.machineReadable?.id).toBe('q');
  });

  /* A document is not a register — the formats are carried back so
   * "published, but not as a feed" is a sayable sentence. */
  it('offers no machine-readable resource for a PDF-only dataset, and names the formats', () => {
    const c = judgeVolumeDataset(dataset({
      notes: 'number of sales by suburb',
      resources: [{ id: 'p', name: 'report.pdf', format: 'PDF', url: 'https://h/r.pdf', datastoreActive: false, size: null }],
    }));
    expect(c.machineReadable).toBeNull();
    expect(c.formats).toEqual(['PDF']);
    expect(MACHINE_READABLE_FORMATS).not.toContain('PDF');
  });

  it('ranks only datasets carrying a count, best first', () => {
    const ranked = rankVolumeCandidates([
      dataset({ id: 'price', title: 'Median sale price by suburb' }),
      dataset({ id: 'state', title: 'Number of sales, Tasmania' }),
      dataset({
        id: 'good', title: 'Number of sales by locality',
        resources: [{ id: 'r', name: 'x.csv', format: 'CSV', url: 'https://h/x', datastoreActive: true, size: null }],
      }),
    ]);
    expect(ranked.map((c) => c.dataset.id)).toEqual(['good', 'state']);
  });
});

describe('reading a catalogue', () => {
  it('reads a CKAN package_search answer', () => {
    const body = JSON.stringify({
      success: true,
      result: {
        count: 2,
        results: [{
          id: 'a', name: 'slug-a', title: 'Number of sales by suburb',
          notes: 'quarterly', license_title: 'CC BY 4.0',
          organization: { title: 'Valuer-General' },
          metadata_modified: '2026-08-01T00:00:00Z',
          resources: [{ id: 'r1', url: 'https://h/x.csv', format: 'csv', datastore_active: true, size: '12' }],
        }],
      },
    });
    const p = parseVolumeCatalogue(body);
    expect(p.kind).toBe('catalogue');
    if (p.kind !== 'catalogue') return;
    expect(p.total).toBe(2);
    expect(p.datasets[0].organisation).toBe('Valuer-General');
    expect(p.datasets[0].resources[0].format).toBe('CSV');
    expect(p.datasets[0].resources[0].size).toBe(12);
  });

  /*
   * A parser that cannot say what it received cannot be debugged from a CI
   * log — the ABS structure parser read no dimension out of 3.1 MB of real
   * bytes and reported an empty document.
   */
  it('names what it received when it cannot read it', () => {
    const p = parseVolumeCatalogue('<html>not ckan</html>');
    expect(p.kind).toBe('refused');
    if (p.kind === 'refused') {
      expect(p.reason).toContain('not JSON');
      expect(p.reason).toContain('not ckan');
    }
    expect(parseVolumeCatalogue(JSON.stringify({ success: false, error: { message: 'nope' } })).kind)
      .toBe('refused');
    expect(parseVolumeCatalogue(JSON.stringify({ result: {} })).kind).toBe('refused');
  });

  it('de-duplicates a dataset several queries all found', () => {
    const one = parseVolumeCatalogue(JSON.stringify({
      result: { count: 1, results: [{ id: 'x', name: 'x', title: 'T', resources: [] }] },
    }));
    const merged = mergeVolumeReads([one, one, one]);
    expect(merged.kind).toBe('catalogue');
    if (merged.kind === 'catalogue') expect(merged.datasets).toHaveLength(1);
  });

  it('carries a refusal rather than smoothing it', () => {
    const merged = mergeVolumeReads([{ kind: 'refused', reason: 'HTTP 503' }]);
    expect(merged.kind).toBe('refused');
  });
});

describe('what may be stated', () => {
  const catalogue = (datasets: VolumeDataset[]): Extract<VolumeCatalogueParseLike, { kind: 'catalogue' }> =>
    ({ kind: 'catalogue', total: datasets.length, datasets });
  type VolumeCatalogueParseLike = ReturnType<typeof parseVolumeCatalogue>;

  it('reports a sub-state, machine-readable count as countable', () => {
    const c = assessVolumeCoverage(catalogue([dataset({
      title: 'Number of sales by suburb',
      resources: [{ id: 'r', name: 'x.csv', format: 'CSV', url: 'https://h/x', datastoreActive: true, size: null }],
    })]), true);
    expect(c.kind).toBe('countable');
  });

  /*
   * The two near misses. Both are the shape that could be reported as a
   * success while changing nothing, because the ABS already hands these four
   * a state-grain price.
   */
  it('keeps a state-grain count and a document-only count as distinct near misses', () => {
    expect(assessVolumeCoverage(catalogue([dataset({ title: 'Number of sales, Tasmania' })]), true).kind)
      .toBe('state_grain_only');
    expect(assessVolumeCoverage(catalogue([dataset({
      title: 'Number of sales by suburb',
      resources: [{ id: 'p', name: 'r.pdf', format: 'PDF', url: 'https://h/r', datastoreActive: false, size: null }],
    })]), true).kind).toBe('published_as_documents');
  });

  it('separates "prices only" from "nothing published"', () => {
    expect(assessVolumeCoverage(catalogue([dataset({ title: 'Median sale price by suburb' })]), true).kind)
      .toBe('medians_only');
    expect(assessVolumeCoverage(catalogue([dataset({ title: 'Bus routes' })]), true).kind)
      .toBe('no_count_published');
  });

  /*
   * One catalogue's silence is a statement about that catalogue. This is the
   * fault W3.2's probe committed twice, so an absence requires corroboration
   * and an uncorroborated read cannot produce one.
   */
  it('refuses to read an absence from one catalogue', () => {
    const c = assessVolumeCoverage(catalogue([dataset({ title: 'Bus routes' })]), false);
    expect(c.kind).toBe('catalogue_unavailable');
    if (c.kind === 'catalogue_unavailable') expect(c.reason).toMatch(/one catalogue/i);
  });

  it('never reads a refusal as an absence', () => {
    expect(assessVolumeCoverage({ kind: 'refused', reason: 'HTTP 503' }, true).kind)
      .toBe('catalogue_unavailable');
  });
});

describe('the sentence a report may carry', () => {
  const ALL: VolumeCoverage[] = [
    { kind: 'countable', title: 'T', publisher: 'P', resourceId: 'r', format: 'CSV', licence: 'CC BY 4.0' },
    { kind: 'state_grain_only', title: 'T', publisher: 'P' },
    { kind: 'published_as_documents', title: 'T', publisher: 'P', formats: ['PDF'] },
    { kind: 'medians_only', examined: 12 },
    { kind: 'no_count_published', examined: 12 },
    { kind: 'catalogue_unavailable', reason: 'HTTP 503' },
  ];

  it('names the jurisdiction in every reading', () => {
    for (const state of VOLUME_GAP_STATES) {
      for (const c of ALL) {
        expect(volumeCoverageNote(c, state), `${state}/${c.kind}`).toContain(state);
      }
    }
  });

  /*
   * §9's rule, applied to a register rather than to a layer: an absence may
   * not be rated, and a count nobody publishes is not a count of zero.
   */
  it('rates nothing and never reads an absence as few sales', () => {
    for (const state of VOLUME_GAP_STATES) {
      for (const c of ALL) {
        const note = volumeCoverageNote(c, state);
        const where = `${state}/${c.kind}`;
        expect(note, where).not.toMatch(/\|\s*(?:low|minimal|negligible|limited|favourable)\s*\|/i);
        expect(note, where).not.toMatch(/\b(?:few|little|no|weak|thin|quiet)\s+(?:sales|demand|activity|turnover)\b/i);
        expect(note, where).not.toMatch(/\bdemand is\b/i);
        expect(note, where).not.toMatch(/\b0 sales\b|\bzero sales\b/i);
      }
    }
  });

  /* Every sentence is about the REGISTER, and the two near misses say why. */
  it('says which kind of limit each absence is', () => {
    expect(volumeCoverageNote({ kind: 'state_grain_only', title: 'T', publisher: 'P' }, 'TAS'))
      .toMatch(/whole state|no smaller area/i);
    expect(volumeCoverageNote({ kind: 'published_as_documents', title: 'T', publisher: 'P', formats: ['PDF'] }, 'WA'))
      .toMatch(/rather than as a data feed/i);
    expect(volumeCoverageNote({ kind: 'medians_only', examined: 3 }, 'NT'))
      .toMatch(/prices and not counts/i);
    expect(volumeCoverageNote({ kind: 'catalogue_unavailable', reason: 'x' }, 'ACT'))
      .toMatch(/about the retrieval/i);
  });

  /* A territory is not a state, and printing it as one reads as carelessness. */
  it('calls the ACT and the NT territories', () => {
    for (const s of ['ACT', 'NT'] as VolumeGapState[]) {
      expect(volumeCoverageNote({ kind: 'state_grain_only', title: 'T', publisher: 'P' }, s)).toContain('territory');
    }
    expect(volumeCoverageNote({ kind: 'state_grain_only', title: 'T', publisher: 'P' }, 'WA')).toContain('state');
  });

  it('calls a countable find outstanding work rather than a limit of the source', () => {
    expect(volumeCoverageNote(ALL[0], 'WA')).toMatch(/outstanding work rather than a limitation/i);
  });
});

describe('where it asks', () => {
  /*
   * Two catalogues per jurisdiction that fail differently — W3.4's
   * corroboration rule. The jurisdiction's own is the authority on what it
   * publishes; the harvest is the one this repository has measured answering.
   */
  it('gives every jurisdiction its own catalogue and keeps one harvest', () => {
    for (const s of VOLUME_GAP_STATES) {
      const own = VOLUME_CATALOGUES.filter((c) => c.state === s && c.kind === 'own');
      expect(own, s).toHaveLength(1);
    }
    expect(VOLUME_CATALOGUES.filter((c) => c.kind === 'harvest')).toHaveLength(1);
  });

  /* An API root is typed; a dataset id never is. */
  it('types an API root and never a dataset or resource id', () => {
    for (const c of VOLUME_CATALOGUES) {
      expect(c.api, c.state).toMatch(/^https:\/\//);
      expect(c.api, c.state).not.toContain('?');
      expect(c.api, c.state).not.toMatch(/\/(?:dataset|package_show|resource)\b/);
      expect(c.api, c.state).toMatch(/\/api\/3$/);
    }
  });

  it('composes a bounded search from the root', () => {
    const u = volumeSearchUrl('https://h/api/3', 'property sales', 50, 0);
    expect(u).toBe('https://h/api/3/action/package_search?q=property+sales&rows=50&start=0');
    expect(volumeSearchUrl('https://h/api/3/', 'x', 9999)).toContain('rows=200');
    expect(volumeSearchUrl('https://h/api/3', 'x', 0)).toContain('rows=1');
  });

  /*
   * Several queries rather than one, because a publisher's own words differ by
   * jurisdiction and a single phrase would measure our vocabulary rather than
   * theirs.
   */
  it('asks in more than one publisher’s vocabulary', () => {
    expect(VOLUME_QUERIES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(VOLUME_QUERIES).size).toBe(VOLUME_QUERIES.length);
  });
});

describe('the probe writes nothing', () => {
  const probe = readFileSync('scripts/market/sales-volume-liveness.ts', 'utf8');
  const module = readFileSync(
    'supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure.ts', 'utf8');

  /*
   * The whole reason this step needs no approval: loading a series is a
   * register WRITE, and discovery is not. A source scan rather than a promise.
   */
  it('names no table, no client and no credential', () => {
    for (const [name, src] of [['probe', probe], ['module', module]] as const) {
      expect(src, name).not.toMatch(/createClient|SERVICE_ROLE|SUPABASE_URL|\.from\(/);
      expect(src, name).not.toMatch(/\b(?:insert|upsert|update|delete)\s*\(/);
      expect(src, name).not.toMatch(/market_sales_medians/);
    }
  });

  /*
   * And it constructs no evidence, so nothing here can reach the scorer.
   *
   * Stated as ASSERTED FORMS rather than as the bare names, because the
   * module's own header says *"No `EvidencePoint` is constructed, no row shape
   * is emitted"* — and a guard that flags the sentence stating the prohibition
   * would have the rule deleted to keep the guard passing. That is exactly
   * what the infrastructure paragraph's rating scan cost once, and it is the
   * second time this programme has paid for it.
   */
  it('constructs no EvidencePoint and emits no register row', () => {
    for (const asserted of [
      /\bnew\s+EvidencePoint\b/,
      /:\s*EvidencePoint\b/,
      /\bas\s+EvidencePoint\b/,
      /\bEvidencePoint\s*</,
      /:\s*SalesMedianRow\b/,
      /\bSalesMedianRow\s*\[/,
      /\bimport\b[^;]*\b(?:EvidencePoint|SalesMedianRow)\b/,
    ]) {
      expect(module, String(asserted)).not.toMatch(asserted);
    }
  });

  /* The exit contract, the fourth time. */
  it('fails only where a catalogue answered and this reader refused', () => {
    expect(probe).toMatch(/process\.exit\(1\)/);
    expect(probe).toMatch(/function ours\(/);
    /* A refusal from the publisher exits 0 — asserted as the absence of a
     * second failure path rather than as prose. */
    expect(probe.match(/process\.exit\(1\)/g) ?? []).toHaveLength(1);
  });
});
