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
 *                      --runs 4
 *
 * THE CALIBRATION RUNS FIRST AND IS NOT OPTIONAL. A pass under a runtime that
 * is not enforcing the memory ceiling proves nothing about the ceiling —
 * measured 8 September 2026, `wrangler dev --local` allocated 900 MB and
 * answered 200. So `/v1/alloc` is asked before any election, and the report
 * says plainly whether the ceiling was observed to bite.
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
const docs = multi('doc');
const expects = multi('expect');
if (!token) { console.error('no token: pass --token or set BUILDER_STOCK_PDF_PROBE_TOKEN'); process.exit(2); }
if (!Object.keys(docs).length) { console.error('no --doc given'); process.exit(2); }

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const auth = { authorization: `Bearer ${token}` };

/** Cloudflare answers a resource kill with an edge error page, not our JSON. */
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

const line = (s) => console.log(s);

line(`probe: ${base}`);

// ---- health -----------------------------------------------------------------
{
  const res = await fetch(`${base}/health`, { headers: auth });
  const { json, text } = await readAnswer(res);
  line(`health: HTTP ${res.status} ${json ? JSON.stringify(json) : text.slice(0, 120)}`);
}

// ---- calibration ------------------------------------------------------------
line('');
line('CALIBRATION — does this runtime enforce the 128 MB isolate ceiling?');
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

// ---- elections --------------------------------------------------------------
const rows = [];
for (const [lot, path] of Object.entries(docs)) {
  const bytes = readFileSync(path);
  const expected = expects[lot] ? readFileSync(expects[lot]) : null;
  const context = CONTEXTS[lot];
  if (!context) {
    // Never guessed. A run against a context this file does not carry would
    // measure the cover rule failing, not the runtime.
    console.error(`no context for lot ${lot} in contexts.json — refusing to guess`);
    process.exit(2);
  }
  line('');
  line(`LOT ${lot} — ${bytes.length.toLocaleString()} byte document, ${runs} runs`);
  for (let i = 1; i <= runs; i += 1) {
    const started = Date.now();
    let res, answer, err = null;
    try {
      res = await fetch(`${base}/v1/elect`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/pdf',
          'x-election-context': encodeContext(context) },
        body: bytes,
      });
      answer = await readAnswer(res);
    } catch (error) { err = error; }
    const elapsed = Date.now() - started;

    if (err) {
      rows.push({ lot, run: i, status: `transport:${err.message}`, elapsed });
      line(`  run ${i}: TRANSPORT FAILURE after ${elapsed} ms — ${err.message}`);
      continue;
    }
    const body = answer.json;
    // A Cloudflare resource kill is an edge error page, not our JSON.
    const killed = !body && /1102|exceeded resource limits|Worker threw/i.test(answer.text);
    if (killed || !body) {
      rows.push({ lot, run: i, status: killed ? 'RESOURCE KILL' : `HTTP ${res.status} non-JSON`, elapsed });
      line(`  run ${i}: HTTP ${res.status} ${killed ? 'RESOURCE KILL' : 'non-JSON'} after ${elapsed} ms`);
      line(`          ${answer.text.replace(/\s+/g, ' ').slice(0, 200)}`);
      continue;
    }
    const returnedSha = body.image_sha256 ?? null;
    const expectedSha = expected ? sha(expected) : null;
    // BYTE-FOR-BYTE, not merely the same size. Two different photographs from
    // one brochure can share a length; only the digest settles it.
    const identical = expectedSha ? returnedSha === expectedSha : null;
    rows.push({ lot, run: i, status: body.status, reference: body.reference,
      image_bytes: body.image_bytes, image_sha256: returnedSha, identical,
      elapsed, isolate: body.isolate, invocation: body.invocation });
    line(`  run ${i}: HTTP ${res.status} ${body.status} ${body.reference ?? ''}`
      + ` image=${(body.image_bytes ?? 0).toLocaleString()}B`
      + `${identical === null ? '' : identical ? ' IDENTICAL' : ' DIFFERS'}`
      + ` worker=${body.elapsed_ms}ms wall=${elapsed}ms`
      + ` isolate=${body.isolate} inv=${body.invocation}`);
    line(`          sha256 returned=${String(returnedSha).slice(0, 24)}…`
      + `${expectedSha ? ` deterministic=${expectedSha.slice(0, 24)}…` : ''}`);
  }
}

// ---- verdict ----------------------------------------------------------------
line('');
line('ACCEPTANCE');
const byLot = {};
for (const r of rows) (byLot[r.lot] ??= []).push(r);
let pass = true;
for (const [lot, rs] of Object.entries(byLot)) {
  const allRecovered = rs.every((r) => r.status === 'recovered');
  const refs = new Set(rs.map((r) => r.reference));
  const hashes = new Set(rs.map((r) => r.image_sha256));
  const isolates = new Set(rs.map((r) => r.isolate));
  // `null` means no deterministic output was supplied to compare against, and
  // that is not a pass — an uncompared result is not a matching one.
  const matchesDeterministic = rs.every((r) => r.identical === true);
  const ok = allRecovered && refs.size === 1 && hashes.size === 1 && matchesDeterministic;
  pass &&= ok;
  line(`  lot ${lot}: ${ok ? 'PASS' : 'FAIL'} — every run recovered: ${allRecovered};`
    + ` one winner: ${[...refs].join(',')}; one image digest: ${hashes.size === 1};`
    + ` matches the deterministic output: ${matchesDeterministic}`);
  line(`            isolates seen: ${isolates.size} (${[...isolates].join(', ')})`
    + `${isolates.size > 1 ? '  <-- the isolate was RECYCLED between runs' : ''}`);
}
line('');
line(`RESULT: ${pass ? 'elections pass' : 'ELECTIONS FAIL'};`
  + ` memory ceiling ${enforced === true ? 'observed to be enforced' : 'NOT OBSERVED — instrument uncalibrated'}`);
