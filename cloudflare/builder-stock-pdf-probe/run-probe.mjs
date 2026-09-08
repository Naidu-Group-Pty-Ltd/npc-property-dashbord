#!/usr/bin/env node
/**
 * TEMPORARY — drives the feasibility probe and records every acceptance fact.
 *
 * Deleted with the rest of this directory once the question is answered. It
 * exists so the deployed run and the local one are the SAME measurement: a
 * result typed by hand into a table is a result nobody can repeat.
 *
 *   node run-probe.mjs --base https://<worker>.workers.dev \
 *                      --token "$BUILDER_STOCK_PDF_PROBE_TOKEN" \
 *                      --doc 516=/path/l516.pdf --doc 6706=/path/l6706.pdf \
 *                      --expect 516=/path/elected_l516.pdf.jpg \
 *                      --expect 6706=/path/elected_l6706.pdf.jpg \
 *                      --runs 4 --rounds 4
 *
 * THREE PHASES, IN THIS ORDER, AND THE ORDER IS THE ARGUMENT.
 *
 * 1. CALIBRATION. A pass under a runtime that is not enforcing the memory
 *    ceiling proves nothing about the ceiling — measured 8 September 2026,
 *    `wrangler dev --local` allocated 900 MB and answered 200. So `/v1/alloc`
 *    is asked before any election and the verdict is stated plainly.
 *
 * 2. SEQUENTIAL, `--runs` each. One document in flight at a time: does the
 *    election run at all, and does it elect the same picture every time?
 *
 * 3. CONCURRENT, `--rounds` of both documents at once. This is the phase the
 *    128 MB question actually turns on, because the ceiling is per-ISOLATE and
 *    a single request never reaches it. It runs ONLY IF the sequential phase
 *    passed: concurrency after a sequential failure measures nothing new and
 *    would let a second failure be read as a concurrency finding.
 *
 * ONE REQUEST PATH. `elect()` serves both phases, because two implementations
 * of "run an election" is how two phases come to disagree about what they
 * measured.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const multi = (name) => process.argv.reduce((acc, v, i) => {
  if (v === `--${name}` && process.argv[i + 1]) {
    const [k, ...rest] = process.argv[i + 1].split('=');
    acc[k] = rest.join('=');
  }
  return acc;
}, {});

const base = (arg('base') ?? 'http://127.0.0.1:8788').replace(/\/$/, '');
const token = arg('token') ?? process.env.BUILDER_STOCK_PDF_PROBE_TOKEN ?? '';
const runs = Number(arg('runs', '4'));
const rounds = Number(arg('rounds', '4'));
const docs = multi('doc');
const expects = multi('expect');
if (!token) { console.error('no token: pass --token or set BUILDER_STOCK_PDF_PROBE_TOKEN'); process.exit(2); }
if (!Object.keys(docs).length) { console.error('no --doc given'); process.exit(2); }

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const auth = { authorization: `Bearer ${token}` };
const line = (s) => console.log(s);
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/*
 * A KILL IS NOT A REPLY. When the runtime terminates a Worker there is no
 * body of ours to read — Cloudflare answers with its own error page (1102,
 * "Worker exceeded resource limits"), and the invocation outcome
 * (`exceededMemory` / `exceededCpu`) appears only in Workers Logs. So the
 * words are matched where they can be, and the phase report names the log
 * window either way rather than pretending the HTTP response settled it.
 */
const KILL = /exceededMemory|exceededCpu|1102|exceeded resource limits|Worker threw|Error 1101/i;

const readAnswer = async (res) => {
  const text = await res.text();
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
};

/*
 * THE CONTEXT IS NOT INVENTED HERE. `contexts.json` is derived from the live
 * rows by the real `stockRecordLabel` / `stockIdentityHints` /
 * `designOfRecordOrRow`. A thinner context is not a smaller test — it is a
 * DIFFERENT one: with no estate name to corroborate by, the cover rule
 * recognises no page, nothing is decoded, and the CPU-heavy half never runs.
 * Measured: both documents answered `not_identified` in ~300 ms rather than
 * `recovered` in ~1,200 ms, which would have been recorded as a result about
 * Cloudflare.
 */
const CONTEXTS = JSON.parse(
  readFileSync(new URL('./contexts.json', import.meta.url), 'utf8'));

const encodeContext = (c) =>
  Buffer.from(JSON.stringify({ protocol: 1, ...c }), 'utf8').toString('base64');

/** Every document named on the command line, loaded once and reused. */
const LOTS = Object.entries(docs).map(([lot, path]) => {
  const context = CONTEXTS[lot];
  if (!context) {
    // Never guessed. A run against a context this file does not carry would
    // measure the cover rule failing, not the runtime.
    console.error(`no context for lot ${lot} in contexts.json — refusing to guess`);
    process.exit(2);
  }
  const expected = expects[lot] ? readFileSync(expects[lot]) : null;
  return { lot, bytes: readFileSync(path), expected, expectedSha: expected ? sha(expected) : null, context };
});

/** One election. The only place a request is made, for either phase. */
async function elect({ lot, bytes, expectedSha, context }, label) {
  const started = Date.now();
  let res, answer;
  try {
    res = await fetch(`${base}/v1/elect`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/pdf',
        'x-election-context': encodeContext(context) },
      body: bytes,
    });
    answer = await readAnswer(res);
  } catch (error) {
    return { lot, label, outcome: 'transport', detail: error.message, elapsed: Date.now() - started };
  }
  const elapsed = Date.now() - started;
  const body = answer.json;
  if (!body) {
    const killed = KILL.test(answer.text);
    return { lot, label, outcome: killed ? 'resource_kill' : 'non_json', http: res.status,
      detail: answer.text.replace(/\s+/g, ' ').slice(0, 200), elapsed };
  }
  return {
    lot, label, outcome: 'answered', http: res.status, status: body.status,
    reference: body.reference ?? null, image_bytes: body.image_bytes ?? null,
    image_sha256: body.image_sha256 ?? null,
    // BYTE-FOR-BYTE, not merely the same size. Two photographs from one
    // brochure can share a length; only the digest settles it. `null` means
    // nothing was supplied to compare against, and that is never a pass.
    identical: expectedSha ? body.image_sha256 === expectedSha : null,
    workerMs: body.elapsed_ms, elapsed, isolate: body.isolate ?? null,
    invocation: body.invocation ?? null,
  };
}

const describe = (r) => {
  if (r.outcome === 'transport') return `TRANSPORT FAILURE after ${r.elapsed} ms — ${r.detail}`;
  if (r.outcome === 'resource_kill') return `HTTP ${r.http} RESOURCE KILL after ${r.elapsed} ms\n            ${r.detail}`;
  if (r.outcome === 'non_json') return `HTTP ${r.http} non-JSON after ${r.elapsed} ms\n            ${r.detail}`;
  return `HTTP ${r.http} ${r.status} ${r.reference ?? ''}`
    + ` image=${(r.image_bytes ?? 0).toLocaleString()}B`
    + `${r.identical === null ? '' : r.identical ? ' IDENTICAL' : ' DIFFERS'}`
    + ` worker=${r.workerMs}ms wall=${r.elapsed}ms isolate=${r.isolate} inv=${r.invocation}`;
};

/** The one acceptance rule, applied to whichever set of results it is given. */
const accepts = (rs) => rs.length > 0
  && rs.every((r) => r.outcome === 'answered' && r.status === 'recovered' && r.identical === true)
  && new Set(rs.map((r) => r.reference)).size === 1
  && new Set(rs.map((r) => r.image_sha256)).size === 1;

const killsIn = (rs) => rs.filter((r) => r.outcome === 'resource_kill' || r.outcome === 'transport');

line(`probe: ${base}`);
line(`started: ${stamp()} UTC`);

// ---- health -----------------------------------------------------------------
{
  const res = await fetch(`${base}/health`, { headers: auth });
  const { json, text } = await readAnswer(res);
  line(`health: HTTP ${res.status} ${json ? JSON.stringify(json) : text.slice(0, 120)}`);
}

// ---- 1. calibration ---------------------------------------------------------
line('');
line('PHASE 1 — CALIBRATION: does this runtime enforce the 128 MB isolate ceiling?');
let enforced = null;
for (const mb of [64, 200, 900]) {
  const started = Date.now();
  let res, answer;
  try {
    res = await fetch(`${base}/v1/alloc?mb=${mb}`, { headers: auth });
    answer = await readAnswer(res);
  } catch (error) {
    line(`  ${String(mb).padStart(4)} MB  -> transport error: ${error.message}  (${Date.now() - started} ms)`);
    if (mb >= 200) enforced = true;
    continue;
  }
  const ok = res.ok && answer.json?.allocated_mb === mb;
  line(`  ${String(mb).padStart(4)} MB  -> HTTP ${res.status}${ok ? ' allocated' : ' REFUSED'}`
    + `  isolate=${answer.json?.isolate ?? '-'} inv=${answer.json?.invocation ?? '-'}`
    + `  (${Date.now() - started} ms)`);
  if (mb >= 200) enforced = ok ? (enforced ?? false) : true;
}
line(enforced === true
  ? '  VERDICT: the ceiling bites. A memory result from this runtime means something.'
  : '  VERDICT: NOT ENFORCING — a 200/900 MB allocation succeeded. Any memory'
    + '\n           result from this runtime is worthless; this is evidence of'
    + '\n           EXECUTION only.');

// ---- 2. sequential ----------------------------------------------------------
const sequential = [];
line('');
line(`PHASE 2 — SEQUENTIAL: ${runs} runs of each document, one in flight at a time`);
const seqFrom = stamp();
for (const doc of LOTS) {
  line('');
  line(`  LOT ${doc.lot} — ${doc.bytes.length.toLocaleString()} byte document`);
  for (let i = 1; i <= runs; i += 1) {
    const r = await elect(doc, `seq:${i}`);
    sequential.push(r);
    line(`    run ${i}: ${describe(r)}`);
    if (r.outcome === 'answered' && r.identical !== null) {
      line(`            sha256 returned=${String(r.image_sha256).slice(0, 24)}…`
        + ` deterministic=${String(doc.expectedSha).slice(0, 24)}…`);
    }
  }
}
const seqTo = stamp();

line('');
line('  SEQUENTIAL ACCEPTANCE');
let seqPass = true;
for (const doc of LOTS) {
  const rs = sequential.filter((r) => r.lot === doc.lot);
  const ok = accepts(rs);
  seqPass &&= ok;
  const isolates = new Set(rs.map((r) => r.isolate).filter(Boolean));
  line(`    lot ${doc.lot}: ${ok ? 'PASS' : 'FAIL'}`
    + ` — recovered: ${rs.every((r) => r.status === 'recovered')};`
    + ` one winner: ${[...new Set(rs.map((r) => r.reference))].join(',')};`
    + ` matches the deterministic output: ${rs.every((r) => r.identical === true)}`);
  line(`              isolates: ${isolates.size} (${[...isolates].join(', ')})`
    + `${isolates.size > 1 ? '  <-- RECYCLED between runs' : ''}`);
}

// ---- 3. concurrent ----------------------------------------------------------
/*
 * THE PHASE THE MEMORY QUESTION TURNS ON.
 *
 * Cloudflare's ceiling is per-ISOLATE and "a single isolate can handle many
 * concurrent requests", so one document in flight may never approach it while
 * two together do. And exceeding it does not necessarily fail: the runtime
 * "lets in-flight requests complete and creates a new isolate for subsequent
 * requests" — so the honest signal is not only whether these succeed, it is
 * whether the isolate that served them SURVIVED them.
 */
let conPass = null;
const concurrent = [];
let conFrom = null, conTo = null;
if (!seqPass) {
  line('');
  line('PHASE 3 — CONCURRENT: SKIPPED. The sequential phase did not pass, and a');
  line('  concurrent failure after a sequential one measures nothing new — it');
  line('  would read as a concurrency finding when it is not.');
} else if (LOTS.length < 2) {
  line('');
  line('PHASE 3 — CONCURRENT: SKIPPED. Needs at least two documents; pass both');
  line('  --doc arguments to exercise the isolate with more than one in flight.');
} else {
  line('');
  line(`PHASE 3 — CONCURRENT: ${rounds} rounds, all ${LOTS.length} documents in flight together`);
  conFrom = stamp();
  for (let round = 1; round <= rounds; round += 1) {
    const results = await Promise.all(LOTS.map((doc) => elect(doc, `con:${round}`)));
    concurrent.push(...results);
    line('');
    line(`  round ${round}:`);
    for (const r of results) line(`    lot ${r.lot}: ${describe(r)}`);
    const isolates = new Set(results.map((r) => r.isolate).filter(Boolean));
    line(`    isolates this round: ${isolates.size} (${[...isolates].join(', ')})`
      + `${isolates.size > 1 ? '  <-- the two requests were served by DIFFERENT isolates' : ''}`);
  }
  conTo = stamp();

  line('');
  line('  CONCURRENT ACCEPTANCE');
  conPass = true;
  for (const doc of LOTS) {
    const rs = concurrent.filter((r) => r.lot === doc.lot);
    const ok = accepts(rs);
    conPass &&= ok;
    line(`    lot ${doc.lot}: ${ok ? 'PASS' : 'FAIL'}`
      + ` — recovered: ${rs.every((r) => r.status === 'recovered')};`
      + ` one winner: ${[...new Set(rs.map((r) => r.reference))].join(',')};`
      + ` matches the deterministic output: ${rs.every((r) => r.identical === true)}`);
  }
  const kills = killsIn(concurrent);
  conPass &&= kills.length === 0;
  line(`    resource kills / transport failures under load: ${kills.length}`
    + `${kills.length ? ` — ${kills.map((k) => `${k.lot}:${k.outcome}`).join(', ')}` : ''}`);

  /*
   * RECYCLING IS THE READING, not a footnote. The sequential phase establishes
   * which isolate served an unloaded worker; if concurrency introduces new
   * ones, the ceiling was reached even though every request returned 200.
   */
  const seqIsolates = new Set(sequential.map((r) => r.isolate).filter(Boolean));
  const conIsolates = new Set(concurrent.map((r) => r.isolate).filter(Boolean));
  const fresh = [...conIsolates].filter((i) => !seqIsolates.has(i));
  line(`    isolates across all rounds: ${conIsolates.size} (${[...conIsolates].join(', ')})`);
  line(`    isolates not seen in the sequential phase: ${fresh.length}`
    + `${fresh.length ? ` (${fresh.join(', ')})  <-- RECYCLED UNDER LOAD` : ''}`);
}

// ---- what to read in Workers Logs -------------------------------------------
line('');
line('WORKERS LOGS — read these windows before believing any of the above.');
line('  A resource kill returns no body of ours, and the invocation outcome');
line('  (`exceededMemory` / `exceededCpu` / `ok`) appears ONLY in the logs.');
line(`    sequential: ${seqFrom} .. ${seqTo} UTC`);
if (conFrom) line(`    concurrent: ${conFrom} .. ${conTo} UTC`);
line('  Dashboard: Workers & Pages > builder-stock-pdf-probe > Logs (or Metrics >');
line('  Errors > Invocation Statuses). Live: `npx wrangler tail builder-stock-pdf-probe`');
line('  -c cloudflare/builder-stock-pdf-probe/wrangler.jsonc --format pretty');

// ---- verdict ----------------------------------------------------------------
line('');
line('RESULT');
line(`  calibration: ${enforced === true ? 'the runtime enforces the ceiling'
  : 'NOT ENFORCING — this runtime cannot answer the memory question'}`);
line(`  sequential:  ${seqPass ? 'pass' : 'FAIL'}`);
line(`  concurrent:  ${conPass === null ? 'not run' : conPass ? 'pass' : 'FAIL'}`);
line('');
if (enforced !== true) {
  line('  ANSWER: NOT YET. Execution is demonstrated; the 128 MB question is open');
  line('  until this runs somewhere that enforces the ceiling.');
} else if (seqPass && conPass) {
  line('  ANSWER: YES — under a runtime observed to enforce the ceiling, every');
  line('  run recovered, elected the same image, and matched the deterministic');
  line('  output byte for byte, with no resource kill. Check the isolate lines');
  line('  above: fresh isolates under load mean the ceiling was reached.');
} else {
  line('  ANSWER: NO — see the failing phase above.');
}
process.exitCode = (seqPass && (conPass === null || conPass)) ? 0 : 1;
