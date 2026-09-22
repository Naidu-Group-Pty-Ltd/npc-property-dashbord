/**
 * Does ACT, NT, TAS or WA publish a COUNT of residential sales?
 *
 * ## Why this exists
 *
 * W3.5 asks for sales counts in those four jurisdictions so Demand can score
 * nationally rather than in four states. Loading one needs a register WRITE —
 * a migration and an ingest stage — and that is a boundary this programme does
 * not cross without asking. **Asking the publishers does not.**
 *
 * So this is the step that decides whether the migration is worth requesting,
 * and what it would be for. It writes nothing anywhere: no database, no
 * Supabase, no credential, no table, no row. It reads five public catalogue
 * indexes and prints what they say.
 *
 * ## The trap this probe exists to avoid
 *
 * All four jurisdictions already hold a price series — `absResDwell`, the ABS
 * mean price of residential dwellings, at state grain. Every one of them also
 * publishes something called "property sales". So the easy and wrong outcome
 * is to find a sales dataset, report the gap closed, and change nothing:
 * `scoreTransactionVolume` needs a **count**, over four periods, at an area
 * finer than the state, and a second price series satisfies none of that.
 *
 * `judgeVolumeDataset` therefore asks whether the PUBLISHER says a count is in
 * it, and `medians_only` / `state_grain_only` are recorded as distinct
 * readings rather than as finds.
 *
 * ## An absence is corroborated or it is not claimed
 *
 * W3.2's lesson, paid twice there: a ranked page of full-text hits establishes
 * nothing about an absence, and one catalogue's silence is a statement about
 * that catalogue. So each jurisdiction is asked of its OWN catalogue and of
 * `data.gov.au`, which harvests the states and which this repository has
 * already measured answering from CI — and an absence requires both to answer.
 *
 * ## The exit code
 *
 * `abs-register-liveness`' rule, the fourth time.
 *
 *  - A catalogue that does not answer, or 404s: **0**. A build must not be
 *    decided by another party's uptime, and a typed API root that resolves to
 *    nothing is a gap in this repository that this probe's own output is the
 *    remedy for.
 *  - A catalogue that answers and holds no count series: **0**. That is the
 *    measurement, and it is what decides whether to ask for the migration.
 *  - A catalogue that answers and this repository cannot read what it sent:
 *    **1**. The one failure a fixture can never catch.
 */
import {
  VOLUME_CATALOGUES,
  VOLUME_GAP_STATES,
  VOLUME_PERIODS_REQUIRED,
  VOLUME_QUERIES,
  VOLUME_SCORED_STATES,
  assessVolumeCoverage,
  mergeVolumeReads,
  parseVolumeCatalogue,
  rankVolumeCandidates,
  volumeCoverageNote,
  volumeSearchUrl,
  type VolumeCatalogue,
  type VolumeCatalogueParse,
  type VolumeCoverage,
} from '../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure.ts';

const FETCH_MS = 30_000;
const UA = 'npc-property-dashboard/sales-volume-liveness (+demand coverage probe)';

const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(28)} ${String(v)}`);

/** Our side. The only thing that fails this job. */
function ours(what: string, detail: unknown): never {
  h('A CATALOGUE ANSWERED AND THIS REPOSITORY COULD NOT READ IT');
  kv('stage', what);
  kv('detail', detail);
  console.log('\n  The publisher answered and this reader refused its answer. That is the');
  console.log('  one failure a synthetic fixture can never catch, and it is what this');
  console.log('  job exists for.');
  process.exit(1);
}

interface Fetched { status: number; body: string; bytes: number; ms: number; networkError: string | null }

async function ask(url: string): Promise<Fetched> {
  const began = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
      redirect: 'follow',
    });
    const body = await res.text();
    return { status: res.status, body, bytes: body.length, ms: Date.now() - began, networkError: null };
  } catch (err) {
    return {
      status: 0, body: '', bytes: 0, ms: Date.now() - began,
      networkError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ask one catalogue every query, and merge.
 *
 * Several queries rather than one, because a publisher's own words for this
 * differ by jurisdiction ("property transfers", "land sales", "number of
 * sales") and a single phrase would measure our vocabulary rather than theirs.
 * The merge de-duplicates by dataset id, so a dataset five queries all find is
 * counted once.
 */
async function askCatalogue(c: VolumeCatalogue): Promise<VolumeCatalogueParse> {
  console.log(`\n  · ${c.state} — ${c.publisher} (${c.kind})`);
  kv('api', c.api);
  const parses: VolumeCatalogueParse[] = [];
  let answered = false;
  for (const q of VOLUME_QUERIES) {
    const url = volumeSearchUrl(c.api, q, 50);
    const got = await ask(url);
    if (got.networkError !== null || got.status !== 200) {
      console.log(`      ${q.padEnd(30)} ${got.networkError !== null ? `network: ${got.networkError}` : `HTTP ${got.status}`}`);
      /*
       * A 404 on an API root is OUR typed host and no statement about the
       * jurisdiction — W3.4's rule. It is printed and never failed on, and the
       * body's first bytes go with it so the next increment can see what
       * answered instead of a CKAN index.
       */
      if (got.bytes > 0 && got.status !== 200) {
        console.log(`      ${' '.repeat(30)} ${JSON.stringify(got.body.slice(0, 120))}`);
      }
      continue;
    }
    const parse = parseVolumeCatalogue(got.body);
    if (parse.kind === 'refused') {
      /*
       * HTTP 200, real bytes, and no shape this reader knows. Two cases, and
       * only one is ours: a CKAN that refused the query says so inside a JSON
       * envelope this parser reads, while a portal that is not CKAN at all
       * answers HTML or a different schema. The second is a typed host being
       * wrong, which is printed; the first is a reader defect, which fails.
       */
      const looksJson = got.body.trimStart().startsWith('{');
      if (!looksJson) {
        console.log(`      ${q.padEnd(30)} 200 but not a CKAN index — ${parse.reason}`);
        continue;
      }
      ours(`${c.state} — ${q}`, parse.reason);
    }
    answered = true;
    console.log(`      ${q.padEnd(30)} 200 · ${parse.total} declared · ${parse.datasets.length} read · ${got.ms} ms`);
    parses.push(parse);
  }
  if (!answered) {
    return { kind: 'refused', reason: `no query reached ${c.api} as a CKAN index` };
  }
  return mergeVolumeReads(parses);
}

function printCandidates(parse: VolumeCatalogueParse): void {
  if (parse.kind !== 'catalogue') return;
  const ranked = rankVolumeCandidates(parse.datasets);
  kv('datasets examined', parse.datasets.length);
  kv('carrying a COUNT', ranked.length);
  for (const c of ranked.slice(0, 6)) {
    console.log(`\n      ${c.dataset.title}`);
    console.log(`        publisher   ${c.dataset.organisation ?? '(the catalogue states none)'}`);
    console.log(`        licence     ${c.dataset.licence ?? '(the catalogue states none)'}`);
    console.log(`        sub-state   ${c.subState ? 'yes' : 'NO — state grain only, already held'}`);
    console.log(`        formats     ${c.formats.length > 0 ? c.formats.join(', ') : '(none stated)'}`);
    console.log(`        feed        ${c.machineReadable
      ? `${c.machineReadable.format} ${c.machineReadable.id}${c.machineReadable.datastoreActive ? ' (queryable)' : ''}`
      : 'NO machine-readable resource'}`);
    console.log(`        updated     ${c.dataset.metadataModified ?? '(not stated)'}`);
  }
}

async function main(): Promise<void> {
  h('Does ACT, NT, TAS or WA publish a COUNT of residential sales?');
  kv('jurisdictions', VOLUME_GAP_STATES.join(', '));
  kv('already scoring', VOLUME_SCORED_STATES.join(', '));
  kv('periods a reading needs', VOLUME_PERIODS_REQUIRED);
  console.log('\n  All four already hold a PRICE series at state grain (the ABS mean price of');
  console.log('  residential dwellings), so a second price series closes nothing and would');
  console.log('  look, from a dashboard, exactly like a fix. What is missing is a COUNT,');
  console.log('  over four periods, at an area finer than the state.');
  console.log('\n  This writes nothing anywhere: no database, no table, no row, no');
  console.log('  credential. It reads five public catalogue indexes.');

  // The harvest catalogue is asked ONCE and its answer serves every
  // jurisdiction, because it indexes all of them.
  const harvestEntry = VOLUME_CATALOGUES.find((c) => c.kind === 'harvest');
  if (!harvestEntry) ours('configuration', 'no harvest catalogue declared — an absence could not be corroborated');
  h('The Commonwealth catalogue, which harvests the states');
  const harvest = await askCatalogue(harvestEntry);
  printCandidates(harvest);

  const readings: { state: string; coverage: VolumeCoverage; note: string }[] = [];

  for (const state of VOLUME_GAP_STATES) {
    const own = VOLUME_CATALOGUES.find((c) => c.state === state && c.kind === 'own');
    h(`${state}`);
    if (!own) ours(`${state} configuration`, 'no own catalogue declared');
    const ownParse = await askCatalogue(own);
    printCandidates(ownParse);

    /*
     * Corroboration: BOTH must have answered. One catalogue's silence is a
     * statement about that catalogue, which is the fault this probe's two
     * predecessors each committed once.
     */
    const corroborated = ownParse.kind === 'catalogue' && harvest.kind === 'catalogue';
    const merged = mergeVolumeReads([ownParse, harvest].filter((p) => p.kind === 'catalogue'));
    const coverage = assessVolumeCoverage(
      corroborated ? merged : (ownParse.kind === 'refused' ? ownParse : merged),
      corroborated,
    );
    console.log('');
    kv('reading', coverage.kind);
    kv('corroborated', corroborated ? 'yes — both catalogues answered' : 'NO — only one answered');
    const note = volumeCoverageNote(coverage, state);
    console.log(`\n  What a report may say:\n    ${note}`);
    readings.push({ state, coverage, note });
  }

  h('READ');
  for (const r of readings) kv(r.state, r.coverage.kind);

  const countable = readings.filter((r) => r.coverage.kind === 'countable');
  const nearMiss = readings.filter((r) =>
    r.coverage.kind === 'state_grain_only' || r.coverage.kind === 'published_as_documents');
  const absent = readings.filter((r) =>
    r.coverage.kind === 'medians_only' || r.coverage.kind === 'no_count_published');
  const unknown = readings.filter((r) => r.coverage.kind === 'catalogue_unavailable');

  console.log('\n  What this settles, and what it does not:\n');
  if (countable.length > 0) {
    console.log(`  · ${countable.map((r) => r.state).join(', ')} — a count series exists, sub-state and`);
    console.log('    machine-readable. Loading it needs a register write, which is a');
    console.log('    migration and an ingest stage and therefore an approval to ask for.');
    console.log('    The resource ids above are what that stage would read.');
  }
  if (nearMiss.length > 0) {
    console.log(`  · ${nearMiss.map((r) => r.state).join(', ')} — a count is published and cannot close`);
    console.log('    the gap as published: either it describes the whole state (which the ABS');
    console.log('    series already does) or it is a document rather than a feed. Recorded as');
    console.log('    a near miss so nobody builds an ingest against it.');
  }
  if (absent.length > 0) {
    console.log(`  · ${absent.map((r) => r.state).join(', ')} — no sub-state count found, corroborated`);
    console.log('    across the jurisdiction\'s own catalogue and the Commonwealth catalogue.');
    console.log('    That is a limit of what is published. It is NOT a count of zero and no');
    console.log('    report may read it as few sales.');
  }
  if (unknown.length > 0) {
    console.log(`  · ${unknown.map((r) => r.state).join(', ')} — could not be established. A typed API`);
    console.log('    root that resolves to nothing is a gap HERE, and this output names it.');
  }
  console.log('');
  console.log('  Exiting 0: every reading above is a measurement. The only red in this');
  console.log('  job is a catalogue answering and this reader refusing its answer.');
}

main().catch((err) => {
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
