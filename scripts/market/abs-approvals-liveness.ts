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
import {
  absDataStructureUrl,
  composeApprovalsKey,
  narrowedApprovalsUrl,
  parseDataStructure,
} from '../../supabase/functions/_shared/reports/market/openData/absDataStructure.pure.ts';

const UA = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)';
/** Three years: past the parser's 24-month floor with room to spare. */
const START_PERIOD = process.env.ABS_START_PERIOD ?? '2023-01';
/** One year: the narrowest window `approvalsFactBlocks` actually reports on. */
const TWELVE_MONTHS = process.env.ABS_SHORT_PERIOD ?? '2025-01';

/*
 * Everything prints on ONE stream. The first failing run rendered
 *
 *     THE PARSER REFUSED THE ABS'S OWN DOWNLOAD
 *       the ABS building-approvals download holds 1 months...
 *     ─────────────────────────────────────────
 *
 * with the rule under the message rather than under the heading, because a
 * heading on stdout and a verdict on stderr are two buffers a log viewer
 * interleaves as it pleases. The exit code is what reports the failure; the
 * text is for a person to read, and a garbled verdict is harder to trust.
 */
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
    console.log(`  REFUSED: ${error instanceof Error ? error.message : String(error)}`);
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
    console.log(`  ${error instanceof Error ? error.message : String(error)}`);
    console.log('\n  The catalogue above is what it was given. Either the selection rule');
    console.log('  is wrong about what the Bureau publishes, or the Bureau publishes');
    console.log('  nothing this loader should read — and the survey says which.');
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
  const seen: Array<{ label: string; flow: string; start: string; bytes: number; finished: boolean }> = [];
  for (const w of windows) {
    const url = absBuildingApprovalsUrl(w.flow, w.start);
    const m = await measure(url);
    seen.push({ label: w.label, flow: dataflowRef(w.flow), start: w.start, bytes: m.bytes, finished: m.finished });
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

  /*
   * Does narrowing the window narrow the download?
   *
   * Measured 21 Sep 2026: the two LGA windows came back **byte-identical**
   * (61.8 MB from 2025-01 and from 2023-01), which means one of two things
   * and they lead to different designs — either the ABS is ignoring
   * `startPeriod` for this flow, in which case the only lever left is the
   * KEY, or the edition simply holds no month before the later start, in
   * which case it may not reach `minPeriods` at all. Stating the observation
   * is not the same as settling it, so this names the reading and step 6's
   * period range settles which.
   */
  h('4a · Does the window narrow the download?');
  const byFlow = new Map<string, typeof seen>();
  for (const r of seen) byFlow.set(r.flow, [...(byFlow.get(r.flow) ?? []), r]);
  for (const [flow, rs] of byFlow) {
    if (rs.length < 2 || !rs.every((r) => r.finished)) {
      kv(flow, 'not comparable — a window did not finish');
      continue;
    }
    const identical = rs.every((r) => r.bytes === rs[0].bytes);
    kv(flow, identical
      ? `IDENTICAL bytes from ${rs.map((r) => r.start).join(' and ')} — startPeriod narrowed nothing`
      : `${rs.map((r) => `${r.start}: ${(r.bytes / 1_048_576).toFixed(1)} MB`).join(', ')}`);
  }

  /*
   * 4b · Where the HISTORY is.
   *
   * Settled 21 Sep 2026: `BA_LGA2026` holds **one month**, so the identical
   * byte counts above were not the ABS disregarding `startPeriod` — they were
   * an edition with nothing earlier to withhold. That is `currentEdition`'s
   * rule biting from the far side: it picks the newest BOUNDARY vintage,
   * which is exactly the edition with the least series behind it, and the
   * product needs 24 months before it may state a year-on-year change.
   *
   * So the question is no longer "which edition is current" but "where does
   * the series live", and the two may not be the same flow. One vintage back
   * answers it, and the same pair of windows against a flow that HAS a
   * history is also the only honest test of whether `startPeriod` narrows a
   * download at all — which decides whether the window is a lever or the key
   * is the only one.
   */
  h('4b · Where the history is');
  const priorEditionOf = (kind: ApprovalsAreaKind): DataflowEntry | null => {
    const current = currentAt(kind);
    const refs = surveyConstructionFlows(catalogue)
      .filter((f) => f.areaKind === kind && ABS_BA_NAME_PATTERN.test(f.name))
      .map((f) => f.ref);
    const pool = parseDataflowCatalogue(catalogue)
      .filter((f) => refs.includes(dataflowRef(f)))
      .filter((f) => !current || dataflowRef(f) !== dataflowRef(current));
    return currentEdition(pool).chosen ?? pool[pool.length - 1] ?? null;
  };
  const prior = priorEditionOf('lga');
  if (!prior) {
    kv('prior LGA edition', 'none published — nothing to compare');
  } else {
    kv('prior LGA edition', `${dataflowRef(prior)} — ${prior.name}`);
    const short = await measure(absBuildingApprovalsUrl(prior, TWELVE_MONTHS));
    const long = await measure(absBuildingApprovalsUrl(prior, START_PERIOD));
    const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;
    kv(`from ${TWELVE_MONTHS}`, `${mb(short.bytes)} in ${(short.ms / 1000).toFixed(1)}s ${short.finished ? '' : '(DID NOT FINISH)'}`);
    kv(`from ${START_PERIOD}`, `${mb(long.bytes)} in ${(long.ms / 1000).toFixed(1)}s ${long.finished ? '' : '(DID NOT FINISH)'}`);
    if (short.finished && long.finished) {
      kv('the window', short.bytes === long.bytes
        ? 'narrows NOTHING — this edition holds no month before either start, or startPeriod is ignored'
        : `narrows the download: ${mb(long.bytes - short.bytes)} of the ${mb(long.bytes)} is the extra two years`);
    }
  }

  /*
   * 4c · Narrowing the query, which is the lever the window is not.
   *
   * The parse keeps Original estimates of three residential building types on
   * two measures and discards the rest of the cube — and we are downloading
   * the whole cube to do it, which is why ONE month of LGA data is 61.8 MB
   * and three years of SA2 is past 5 GB. Shrinking a period cannot shrink a
   * cube that is wide rather than long.
   *
   * So this composes the key from the publisher's own data structure, using
   * `composeApprovalsKey` — the production module, not a copy — and measures
   * the narrowed download against the same window that could not be carried.
   * That comparison is the whole design question.
   */
  h('4c · The query, narrowed at the source');
  let narrowedKey = 'all';
  try {
    const dsdUrl = absDataStructureUrl(choice.flow);
    kv('url', dsdUrl);
    const res = await fetch(dsdUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.sdmx.structure+json;version=1.0,application/xml,*/*' },
      signal: AbortSignal.timeout(90_000),
    });
    kv('status', res.status);
    const text = await res.text();
    kv('bytes', text.length.toLocaleString('en-AU'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const structure = parseDataStructure(text);
    kv('dimensions', structure.dimensions
      .slice().sort((a, b) => a.position - b.position)
      .map((d) => `${d.position}:${d.id}${d.isTime ? '(time)' : `[${d.codes.length}]`}`).join(' · '));
    const composed = composeApprovalsKey(structure);
    narrowedKey = composed.key;
    kv('key', composed.key);
    for (const n of composed.narrowed) {
      kv(`  narrowed ${n.dimension}`, `${n.kept.length} of ${n.of} — ${n.why}`);
    }
    for (const u of composed.unnarrowed) kv(`  OPEN ${u.dimension}`, u.reason);
    if (composed.key === 'all') {
      kv('the narrowing', 'nothing narrowed — this is byte-for-byte the request that shipped');
    }
  } catch (error) {
    // Reported, never failed on: a narrowing is an optimisation and the
    // fallback is `/all`, which is what shipped.
    kv('the structure', error instanceof Error ? error.message : String(error));
    kv('the narrowing', 'none — falling back to /all, exactly as the loader does');
  }

  h('4d · What the narrowed query costs');
  if (narrowedKey === 'all') {
    kv('skipped', 'nothing to compare — the key composed to `all`');
  } else {
    for (const [label, flow] of [['SA2', choice.flow], ['LGA', currentAt('lga')]] as const) {
      if (!flow) continue;
      const m = await measure(narrowedApprovalsUrl(flow, START_PERIOD, narrowedKey));
      const rate = m.ms > 0 ? m.bytes / (m.ms / 1000) : 0;
      console.log(
        `  ${`${label}, ${START_PERIOD}→, narrowed`.padEnd(28)} ${String(m.status ?? 'ERR').padStart(3)}  `
        + `${(m.bytes / 1_048_576).toFixed(1).padStart(7)} MB  `
        + `${(m.ms / 1000).toFixed(1).padStart(6)} s  `
        + `${(rate / 1024).toFixed(0).padStart(6)} KB/s  `
        + `${m.finished ? 'complete' : 'DID NOT FINISH'}${m.error ? ` (${m.error})` : ''}`,
      );
      if (m.finished && m.ms < EDGE_BUDGET_MS && flow === choice.flow) {
        // The finest grain, carried. This is the answer the design needed.
        carried = {
          label: `${label}, narrowed, from ${START_PERIOD}`,
          flow,
          grain: choice.areaKind,
          start: START_PERIOD,
          url: narrowedApprovalsUrl(flow, START_PERIOD, narrowedKey),
          bytes: m.bytes,
        };
      } else if (m.finished && m.ms < EDGE_BUDGET_MS && !carried) {
        carried = {
          label: `${label}, narrowed, from ${START_PERIOD}`,
          flow,
          grain: 'lga',
          start: START_PERIOD,
          url: narrowedApprovalsUrl(flow, START_PERIOD, narrowedKey),
          bytes: m.bytes,
        };
      }
    }
  }


  h('5 · What an invocation can actually carry');
  if (!carried) {
    console.log('  No window completed inside the probe budget.');
    console.log('');
    console.log(`  The Bureau ANSWERED every one of them — this is not an outage. The`);
    console.log('  register as configured cannot be loaded by an edge function with a');
    console.log(`  ~${EDGE_BUDGET_MS / 1000}s wall clock, and the loader must page the query or drop to`);
    console.log('  a coarser grain. Failing, because a schedule that cannot finish is');
    console.log('  worse than no schedule: it writes a partial register every night and');
    console.log('  reports success.');
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
    console.log(`  ${error instanceof Error ? error.message : String(error)}`);
    console.log('\n  The ABS answered and this reader would not take it. That is ours,');
    console.log('  and it is exactly what no synthetic fixture could have told us.');
    process.exit(1);
  }
}

await main();
