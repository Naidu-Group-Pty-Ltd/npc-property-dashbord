/**
 * Does the ABS answer, and does our reader accept what it actually sends?
 *
 * ## Why this exists
 *
 * `absBuildingApprovals.pure.ts` is verified against the SDMX-CSV *format* —
 * every test behind it runs on synthetic bodies written to the published
 * standard's shape — because the development egress cannot reach the ABS:
 * the gateway answers **403 to CONNECT** for `data.api.abs.gov.au`, a policy
 * denial in the network allowlist. So the reader has never seen the Bureau's
 * own bytes, and "verified against the format" is not "verified".
 *
 * A GitHub runner has open internet. This closes that gap from CI, BEFORE
 * anything is merged, deployed or scheduled: it fetches the real catalogue,
 * runs the real discovery over it, fetches the real data query and runs the
 * real parser, and prints what the probe would have printed. It writes
 * nothing, anywhere — no database, no Supabase, no credential.
 *
 * ## The exit code is the whole design
 *
 * **The ABS being unreachable is not our failure.** A compliance product
 * cannot have its build decided by somebody else's uptime — this repository
 * already pays for that rule in `PEP_SCREENING_ENGINE.md` ("a compliance
 * decision cannot depend on somebody else's rate limiter"). So a refusal, a
 * timeout or a 5xx from the ABS **reports and exits 0**.
 *
 * What exits 1 is the case that IS ours: the ABS answered, and our discovery
 * or our parser refused what it sent. That is the reader being wrong about
 * the publisher, which is precisely what no synthetic fixture can catch and
 * precisely what this is for.
 */
import {
  ABS_BA_DATAFLOW_CATALOGUE_URL,
  absBuildingApprovalsUrl,
  dataflowRef,
  parseAbsBuildingApprovals,
  resolveBuildingApprovalsFlow,
  surveyConstructionFlows,
} from '../../supabase/functions/_shared/reports/market/openData/absBuildingApprovals.pure.ts';

const UA = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)';
/** Three years: past the parser's 24-month floor with room to spare. */
const START_PERIOD = process.env.ABS_START_PERIOD ?? '2023-01';

const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(26)} ${String(v)}`);

/** Their side. Reported, never failed on. */
function theirs(what: string, detail: unknown): never {
  h('THE ABS DID NOT ANSWER');
  kv('stage', what);
  kv('detail', detail);
  console.log('\n  This is a statement about the retrieval, not about the reader.');
  console.log('  Exiting 0: a build must not be decided by another party’s uptime.');
  process.exit(0);
}

async function main(): Promise<void> {
  h('1 · The dataflow catalogue');
  kv('url', ABS_BA_DATAFLOW_CATALOGUE_URL);
  let catalogue: string;
  try {
    const res = await fetch(ABS_BA_DATAFLOW_CATALOGUE_URL, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.sdmx.structure+json;version=1.0,application/xml,*/*' },
      signal: AbortSignal.timeout(90_000),
    });
    kv('status', res.status);
    kv('content-type', res.headers.get('content-type'));
    catalogue = await res.text();
    kv('bytes', catalogue.length.toLocaleString('en-AU'));
    if (!res.ok) theirs('catalogue', `HTTP ${res.status}`);
  } catch (error) {
    theirs('catalogue', error instanceof Error ? error.message : String(error));
  }

  h('2 · What the ABS publishes about construction');
  let survey: ReturnType<typeof surveyConstructionFlows>;
  try {
    survey = surveyConstructionFlows(catalogue);
  } catch (error) {
    // The catalogue arrived and we could not read it. Ours.
    console.error(`  REFUSED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  kv('flows matching a term', survey.length);
  for (const f of survey) {
    console.log(`  ${(f.areaKind ?? '—').padEnd(9)} ${f.ref.padEnd(42)} ${f.name}`);
    console.log(`  ${''.padEnd(9)} ${''.padEnd(42)} terms: ${f.keys.join(', ')}`);
  }

  h('3 · Which flow the loader would read');
  let choice: ReturnType<typeof resolveBuildingApprovalsFlow>;
  try {
    choice = resolveBuildingApprovalsFlow(catalogue);
  } catch (error) {
    // Discovery refused a catalogue the ABS really sent. Ours, and the exact
    // thing a synthetic fixture cannot tell us.
    h('DISCOVERY REFUSED THE ABS’S OWN CATALOGUE');
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error('\n  The catalogue above is what it was given. Either the selection rule');
    console.error('  is wrong about what the Bureau publishes, or the Bureau publishes');
    console.error('  nothing this loader should read — and the survey says which.');
    process.exit(1);
  }
  kv('flow', dataflowRef(choice.flow));
  kv('name', choice.flow.name);
  kv('grain', choice.areaKind);
  kv('geography score', choice.geographyScore);
  kv('how', choice.how);
  kv('catalogued flows', choice.cataloguedFlows.toLocaleString('en-AU'));
  kv('candidates', choice.candidates.length);

  h('4 · The data query');
  const url = absBuildingApprovalsUrl(choice.flow, START_PERIOD);
  kv('url', url);
  let body: string;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' }, signal: AbortSignal.timeout(240_000) });
    kv('status', res.status);
    body = await res.text();
    kv('bytes', body.length.toLocaleString('en-AU'));
    // Operationally load-bearing: an edge function has a wall clock and a
    // memory ceiling, and a body the loader cannot hold is a finding now
    // rather than a 546 at 03:45 on a Tuesday.
    kv('MB', (body.length / 1_048_576).toFixed(1));
    if (!res.ok) theirs('data', `HTTP ${res.status}`);
  } catch (error) {
    theirs('data', error instanceof Error ? error.message : String(error));
  }

  h('5 · What the parser makes of it');
  try {
    const parsed = parseAbsBuildingApprovals(body, choice.areaKind);
    kv('areas', parsed.areas.toLocaleString('en-AU'));
    kv('months', parsed.periods.length);
    kv('first period', parsed.periods[0]);
    kv('latest period', parsed.latestPeriod);
    kv('states', parsed.states.sort().join(', ') || '(none read)');
    kv('rows', parsed.rows.length.toLocaleString('en-AU'));
    kv('rows skipped', parsed.skipped.toLocaleString('en-AU'));
    kv('series filtered', parsed.seriesTypeUnfiltered ? 'NO — no series column' : 'yes, Original only');
    kv('columns', JSON.stringify(parsed.columns));
    const withUnits = parsed.rows.filter((r) => r.dwellingUnits !== null).length;
    const nullUnits = parsed.rows.length - withUnits;
    kv('units published', withUnits.toLocaleString('en-AU'));
    kv('units NULL (suppressed)', nullUnits.toLocaleString('en-AU'));
    h('THE READER ACCEPTS THE ABS’S OWN BYTES');
    console.log('  Verified against the publisher, not against a fixture.');
  } catch (error) {
    h('THE PARSER REFUSED THE ABS’S OWN DOWNLOAD');
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error('\n  The ABS answered and this reader would not take it. That is ours,');
    console.error('  and it is exactly what no synthetic fixture could have told us.');
    process.exit(1);
  }
}

await main();
