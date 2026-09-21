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
  ABS_BA_NAME_PATTERN,
  absBuildingApprovalsUrl,
  currentEdition,
  dataflowRef,
  parseAbsBuildingApprovals,
  parseDataflowCatalogue,
  resolveBuildingApprovalsFlow,
  surveyConstructionFlows,
  type ApprovalsAreaKind,
  type DataflowEntry,
} from '../../supabase/functions/_shared/reports/market/openData/absBuildingApprovals.pure.ts';

const UA = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)';
/** Three years: past the parser's 24-month floor with room to spare. */
const START_PERIOD = process.env.ABS_START_PERIOD ?? '2023-01';
/** One year: the narrowest window `approvalsFactBlocks` actually reports on. */
const TWELVE_MONTHS = process.env.ABS_SHORT_PERIOD ?? '2025-01';

const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(26)} ${String(v)}`);

/**
 * Their side. Reported, never failed on.
 *
 * The refusing party's own words are printed, because this script cannot tell
 * the Bureau's refusal from an INTERMEDIARY'S. The development egress answers
 * 403 to CONNECT for `data.api.abs.gov.au` and the ABS would answer 403 for a
 * throttle, and the two send an operator to opposite remedies — the same
 * distinction `x-mission-control-refusal` exists for in the verification
 * broker. A runner sitting behind an allowlist would otherwise make this whole
 * gate a placebo that exits 0 having reached nothing, which is the failure
 * class it was written to close.
 */
function theirs(what: string, detail: unknown, body?: string): never {
  h('THE ABS DID NOT ANSWER');
  kv('stage', what);
  kv('detail', detail);
  if (body !== undefined) kv('what refused, verbatim', JSON.stringify(body.slice(0, 300)));
  console.log('\n  This is a statement about the retrieval, not about the reader.');
  console.log('  Read the line above before believing it was the Bureau: a gateway on');
  console.log('  this egress refuses in the same digits, and that is a green build');
  console.log('  standing over a check that reached nothing.');
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
    if (!res.ok) theirs('catalogue', `HTTP ${res.status}`, catalogue);
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

  h('4 · How much data, and how fast');
  /*
   * The first version of this fetched `/all` with a 240s budget and, when the
   * body did not finish, printed "THE ABS DID NOT ANSWER" and exited 0.
   *
   * The ABS had answered. **HTTP 200 in 6.4 seconds**, and then four minutes
   * of body. That is a size problem on our side reported as an availability
   * problem on theirs, which is the same shape as every other defect this
   * programme has found: a green result standing in for a thing that does not
   * work. An edge function has a ~150s wall clock, so a download nobody can
   * carry is the loader failing, and it has to FAIL here.
   *
   * So this measures rather than asks. It streams each candidate window under
   * its own budget and reports bytes and elapsed even when it does not finish,
   * because the number that decides the design is THROUGHPUT: how much of the
   * register can be carried in the time an invocation actually has.
   */
  const EDGE_BUDGET_MS = 150_000;
  const PROBE_MS = 60_000;

  /**
   * Stream, count, and stop at the budget. A partial read is a measurement.
   *
   * The byte count is kept across the throw, because losing it is the defect
   * this function exists to remove: an aborted body that reports `0 bytes,
   * timed out` is indistinguishable from a publisher that never answered, and
   * reporting the second when the first is true is what sent the last run to
   * "THE ABS DID NOT ANSWER" over an HTTP 200.
   *
   * The signal's own ceiling is therefore deliberately LOOSER than the probe
   * budget: our own elapsed check is what stops a healthy transfer, so the
   * stop is a cancel we made with a count in hand rather than an abort thrown
   * at us. The signal remains, as the floor under a connection that stalls
   * with no chunk to measure at all.
   */
  async function measure(url: string): Promise<{
    status: number | null; bytes: number; ms: number; finished: boolean; error?: string;
  }> {
    const began = Date.now();
    let status: number | null = null;
    let bytes = 0;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' },
        signal: AbortSignal.timeout(PROBE_MS + 30_000),
      });
      status = res.status;
      if (!res.body) return { status, bytes: 0, ms: Date.now() - began, finished: false };
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { status, bytes, ms: Date.now() - began, finished: true };
        bytes += value?.byteLength ?? 0;
        if (Date.now() - began > PROBE_MS) {
          await reader.cancel().catch(() => {});
          return { status, bytes, ms: Date.now() - began, finished: false };
        }
      }
    } catch (error) {
      return {
        status, bytes, ms: Date.now() - began, finished: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * The current edition at a coarser grain, read the way the loader would read
   * it — through `resolveBuildingApprovalsFlow`'s own override path, over the
   * real catalogue. Not `survey[0]`: the survey sorts by ref, so at LGA grain
   * that is `BA_LGA2018`, the OLDEST of the nine editions the Bureau
   * publishes. Selecting an edition is `currentEdition`'s job and there must
   * not be a second answer to it here.
   */
  const currentAt = (kind: ApprovalsAreaKind): DataflowEntry | null => {
    const refs = surveyConstructionFlows(catalogue)
      .filter((f) => f.areaKind === kind && ABS_BA_NAME_PATTERN.test(f.name))
      .map((f) => f.ref);
    const entries = parseDataflowCatalogue(catalogue).filter((f) => refs.includes(dataflowRef(f)));
    return currentEdition(entries).chosen;
  };

  /*
   * Every URL here is built by `absBuildingApprovalsUrl`, never by hand. A
   * measurement taken against a URL this script composed itself measures this
   * script, and two spellings of one query is how the two come to disagree —
   * the defect this repository has paid for under half a dozen names.
   */
  interface Window { label: string; flow: DataflowEntry; grain: ApprovalsAreaKind; start: string }
  const windows: Window[] = [];
  const fine = choice.areaKind;
  windows.push({ label: `${fine.toUpperCase()}, 12 months`, flow: choice.flow, grain: fine, start: TWELVE_MONTHS });
  windows.push({ label: `${fine.toUpperCase()}, 36 months`, flow: choice.flow, grain: fine, start: START_PERIOD });
  const lga = currentAt('lga');
  if (lga && dataflowRef(lga) !== dataflowRef(choice.flow)) {
    windows.push({ label: 'LGA, 12 months', flow: lga, grain: 'lga', start: TWELVE_MONTHS });
    windows.push({ label: 'LGA, 36 months', flow: lga, grain: 'lga', start: START_PERIOD });
  }

  /*
   * The grain travels WITH the window. A coarser window is the one that
   * completes where the finest does not, and `ABS_BA_PLAUSIBILITY` floors the
   * area count per grain — 800 at SA2 against 200 at LGA — so parsing an LGA
   * download as SA2 refuses a healthy register for having too few areas, and
   * reports a design measurement as a publisher defect. Same rule as the rest
   * of this script: name what was actually read.
   */
  let carried: Window & { url: string; bytes: number } | null = null;
  for (const w of windows) {
    const url = absBuildingApprovalsUrl(w.flow, w.start);
    const m = await measure(url);
    const rate = m.ms > 0 ? m.bytes / (m.ms / 1000) : 0;
    console.log(
      `  ${w.label.padEnd(16)} ${String(m.status ?? 'ERR').padStart(3)}  `
      + `${(m.bytes / 1_048_576).toFixed(1).padStart(7)} MB  `
      + `${(m.ms / 1000).toFixed(1).padStart(6)} s  `
      + `${(rate / 1024).toFixed(0).padStart(6)} KB/s  `
      + `${m.finished ? 'complete' : 'DID NOT FINISH'}${m.error ? ` (${m.error})` : ''}`,
    );
    if (m.finished && m.ms < EDGE_BUDGET_MS && !carried) carried = { ...w, url, bytes: m.bytes };
  }

  h('5 · What an invocation can actually carry');
  if (!carried) {
    console.error('  No window completed inside the probe budget.');
    console.error('');
    console.error(`  The Bureau ANSWERED every one of them — this is not an outage. The`);
    console.error('  register as configured cannot be loaded by an edge function with a');
    console.error(`  ~${EDGE_BUDGET_MS / 1000}s wall clock, and the loader must page the query or drop to`);
    console.error('  a coarser grain. Failing, because a schedule that cannot finish is');
    console.error('  worse than no schedule: it writes a partial register every night and');
    console.error('  reports success.');
    process.exit(1);
  }
  kv('workable window', carried.label);
  kv('grain', carried.grain);
  kv('bytes', carried.bytes.toLocaleString('en-AU'));
  kv('url', carried.url);

  h('6 · What the parser makes of it');
  let body: string;
  try {
    const res = await fetch(carried.url, {
      headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' },
      signal: AbortSignal.timeout(EDGE_BUDGET_MS),
    });
    if (!res.ok) theirs('data', `HTTP ${res.status} on a URL that answered 200 moments ago`);
    body = await res.text();
    kv('bytes re-read', body.length.toLocaleString('en-AU'));
  } catch (error) {
    theirs('data', error instanceof Error ? error.message : String(error));
  }
  try {
    const parsed = parseAbsBuildingApprovals(body, carried.grain);
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
    kv('units published', withUnits.toLocaleString('en-AU'));
    kv('units NULL (suppressed)', (parsed.rows.length - withUnits).toLocaleString('en-AU'));
    h('THE READER ACCEPTS THE ABS\u2019S OWN BYTES');
    console.log('  Verified against the publisher, not against a fixture.');
  } catch (error) {
    h('THE PARSER REFUSED THE ABS\u2019S OWN DOWNLOAD');
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error('\n  The ABS answered and this reader would not take it. That is ours,');
    console.error('  and it is exactly what no synthetic fixture could have told us.');
    process.exit(1);
  }
}

await main();
