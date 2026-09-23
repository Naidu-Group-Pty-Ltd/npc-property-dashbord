/**
 * What does each state and territory publish as its OWN population
 * projection — in what form, at what grain, and what is in the file?
 *
 * ## Why this exists
 *
 * Forward demand at a property's own area is a per-jurisdiction register:
 * the ABS projects no finer than capital city or rest of state
 * (`FORWARD_DEMAND_EVIDENCE.md`, measured 22 Sep 2026). Loading one needs a
 * table and an ingest stage, and a parser written against a file nobody here
 * has seen is a parser written against a guess — the ABS probe's first run
 * found three premises wrong in one sitting. So this asks first, and prints
 * what each publisher's file actually holds: sheet names, header rows and the
 * first rows of data. That output is what the loader is written against.
 *
 * It writes nothing anywhere: no database, no Supabase, no credential, no
 * table, no row.
 *
 * ## Three routes, because they fail differently
 *
 *   1. the jurisdiction's own open-data catalogue (CKAN, or Socrata for the
 *      ACT);
 *   2. the Commonwealth harvest, attributed by the publisher's own full name;
 *   3. the publisher's own product page (`FORWARD_DEMAND_PUBLISHERS.url`),
 *      where every one of them actually puts the workbooks.
 *
 * ## The exit code
 *
 * `abs-register-liveness`' rule. A publisher that does not answer, 404s, or
 * serves something that is not the file its link names: **0** — a build must
 * not be decided by another party's uptime, and a typed root that is wrong
 * is a gap this output names. A catalogue that answers JSON this reader
 * cannot read: **1** — the one failure a fixture can never catch.
 */
import { gunzipSync, inflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { FORWARD_DEMAND_PUBLISHERS } from '../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure.ts';
import {
  DESCRIBE_MAX_BYTES,
  PROJECTION_CATALOGUES,
  PROJECTION_HARVEST_ROOT,
  PROJECTION_QUERIES,
  PROJECTION_STATES,
  parseProjectionCatalogue,
  projectionAttributable,
  projectionFileLinks,
  projectionInventoryUrl,
  projectionSearchUrl,
  rankProjectionCandidates,
  rankProjectionLinks,
  type ProjectionCatalogue,
  type ProjectionJudgement,
  type ProjectionLink,
  type ProjectionState,
} from '../../supabase/functions/_shared/reports/market/openData/stateProjectionPublishers.pure.ts';
import {
  mergeVolumeReads,
  type VolumeCatalogueParse,
  type VolumeDataset,
} from '../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure.ts';
import { readZipDirectoryFromTail, memberDataStart, ZIP_TAIL_BYTES } from '../../supabase/functions/_shared/gtfsFeed.pure.ts';

const FETCH_MS = 30_000;
const DOWNLOAD_MS = 90_000;
const UA = 'npc-property-dashboard/state-projection-liveness (+forward demand coverage probe)';

const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(Math.min(s.length, 100))); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(30)} ${String(v)}`);

function ours(what: string, detail: unknown): never {
  h('A PUBLISHER ANSWERED AND THIS REPOSITORY COULD NOT READ IT');
  kv('stage', what);
  kv('detail', detail);
  process.exit(1);
}

interface Fetched { status: number; body: string; ms: number; networkError: string | null; contentType: string | null }

async function ask(url: string, accept = 'application/json'): Promise<Fetched> {
  const began = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept, 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
      redirect: 'follow',
    });
    const body = await res.text();
    return { status: res.status, body, ms: Date.now() - began, networkError: null, contentType: res.headers.get('content-type') };
  } catch (err) {
    return { status: 0, body: '', ms: Date.now() - began, networkError: err instanceof Error ? err.message : String(err), contentType: null };
  }
}

/** A file, whole, or a statement of why not. Capped so a description never downloads an archive nobody asked for. */
async function download(url: string): Promise<{ bytes: Uint8Array | null; status: number; type: string | null; note: string }> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(DOWNLOAD_MS), redirect: 'follow' });
    const type = res.headers.get('content-type');
    const declared = Number(res.headers.get('content-length') ?? NaN);
    if (!res.ok) return { bytes: null, status: res.status, type, note: `HTTP ${res.status}` };
    if (Number.isFinite(declared) && declared > DESCRIBE_MAX_BYTES) {
      await res.body?.cancel();
      return { bytes: null, status: res.status, type, note: `declares ${declared.toLocaleString('en-AU')} bytes, past the ${DESCRIBE_MAX_BYTES.toLocaleString('en-AU')} a description needs` };
    }
    const reader = res.body?.getReader();
    if (!reader) return { bytes: null, status: res.status, type, note: 'no body' };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > DESCRIBE_MAX_BYTES) {
        await reader.cancel();
        return { bytes: null, status: res.status, type, note: `past ${DESCRIBE_MAX_BYTES.toLocaleString('en-AU')} bytes without ending` };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    return { bytes, status: res.status, type, note: `${total.toLocaleString('en-AU')} bytes` };
  } catch (err) {
    return { bytes: null, status: 0, type: null, note: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
};

/** What a workbook holds: every sheet's name and size, and the first rows of the sheets that matter. */
function describeWorkbook(bytes: Uint8Array): void {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', cellDates: false, sheetRows: 40 });
  } catch (err) {
    console.log(`      not readable as a workbook — ${err instanceof Error ? err.message : String(err)}`);
    console.log(`      first bytes ${JSON.stringify(new TextDecoder().decode(bytes.subarray(0, 80)))}`);
    return;
  }
  console.log(`      sheets (${wb.SheetNames.length}): ${wb.SheetNames.join(' | ')}`);
  // Sheets named for a grain or for population first; otherwise the first few.
  const scored = wb.SheetNames.map((name, i) => ({
    name, i,
    score: (/SA2|LGA|local government|suburb|district|region/i.test(name) ? 2 : 0) + (/pop|proj/i.test(name) ? 1 : 0),
  })).sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { name } of scored.slice(0, 4)) {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'] ?? '(empty)';
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' }) as unknown[][];
    console.log(`\n      sheet "${name}"  ref ${ref}  (first 40 rows read)`);
    for (const row of rows.slice(0, 14)) {
      const cells = row.slice(0, 14).map(cell);
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
      if (cells.length === 0) continue;
      console.log(`        ${cells.join(' ¦ ')}`);
    }
  }
}

function describeCsv(bytes: Uint8Array): void {
  const text = new TextDecoder().decode(bytes);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  console.log(`      ${lines.length.toLocaleString('en-AU')} lines`);
  for (const l of lines.slice(0, 8)) console.log(`        ${l.length > 200 ? `${l.slice(0, 199)}…` : l}`);
}

function describeZip(bytes: Uint8Array): void {
  let members;
  try {
    members = readZipDirectoryFromTail(bytes.subarray(Math.max(0, bytes.length - ZIP_TAIL_BYTES)), bytes.length);
  } catch (err) {
    console.log(`      not readable as a zip — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  console.log(`      ${members.length} member(s):`);
  for (const m of members.slice(0, 20)) console.log(`        ${m.uncompressedSize.toLocaleString('en-AU').padStart(14)}  ${m.name}`);
  // Describe the first member that is itself a workbook or a CSV.
  const inner = members.find((m) => /\.(xlsx|xls|csv)$/i.test(m.name) && m.uncompressedSize <= DESCRIBE_MAX_BYTES);
  if (!inner) return;
  try {
    const start = memberDataStart(bytes.subarray(inner.localHeaderOffset, inner.localHeaderOffset + 30), inner.localHeaderOffset);
    const raw = bytes.subarray(start, start + inner.compressedSize);
    const data = inner.method === 0 ? raw : inner.method === 8 ? new Uint8Array(inflateRawSync(raw)) : null;
    if (!data) { console.log(`      ${inner.name}: compression method ${inner.method}, not read`); return; }
    console.log(`\n      inside: ${inner.name}`);
    if (/\.csv$/i.test(inner.name)) describeCsv(data); else describeWorkbook(data);
  } catch (err) {
    console.log(`      ${inner.name} could not be extracted — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function describe(url: string, label: string): Promise<void> {
  console.log(`\n    DESCRIBING (${label}) ${url}`);
  const got = await download(url);
  console.log(`      ${got.note}${got.type ? ` · ${got.type}` : ''}`);
  if (!got.bytes) return;
  let bytes = got.bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(gunzipSync(bytes));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  // An .xlsx is a zip whose members are the workbook's own parts.
  if (isZip && /\.xlsx(?:$|[?#])/i.test(url)) return describeWorkbook(bytes);
  if (isZip) {
    // Could still be a workbook served under another name — look before choosing.
    const head = new TextDecoder().decode(bytes.subarray(0, 2000));
    return head.includes('[Content_Types].xml') || head.includes('xl/') ? describeWorkbook(bytes) : describeZip(bytes);
  }
  if (isOle) return describeWorkbook(bytes);
  const start = new TextDecoder().decode(bytes.subarray(0, 200)).trimStart();
  if (start.startsWith('<')) {
    console.log(`      the link served a web page, not a file: ${JSON.stringify(start.slice(0, 120))}`);
    return;
  }
  describeCsv(bytes);
}

async function askCatalogue(c: ProjectionCatalogue): Promise<VolumeCatalogueParse> {
  kv('catalogue', `${c.root} (${c.dialect}${c.measured ? ', measured answering' : ', typed, unmeasured'})`);
  const inv = await ask(projectionInventoryUrl(c));
  if (inv.networkError === null && inv.status === 200) {
    const p = parseProjectionCatalogue(c, inv.body);
    kv('the index says it holds', p.kind === 'catalogue' ? `${p.total.toLocaleString('en-AU')} datasets` : `(unreadable — ${p.reason.slice(0, 100)})`);
  } else {
    kv('the index says it holds', `(it did not say — ${inv.networkError ?? `HTTP ${inv.status}`})`);
  }
  const parses: VolumeCatalogueParse[] = [];
  for (const q of PROJECTION_QUERIES) {
    const got = await ask(projectionSearchUrl(c, q, 50));
    if (got.networkError !== null || got.status !== 200) {
      console.log(`      ${q.padEnd(26)} ${got.networkError !== null ? `network: ${got.networkError}` : `HTTP ${got.status} ${JSON.stringify(got.body.slice(0, 100))}`}`);
      continue;
    }
    const parse = parseProjectionCatalogue(c, got.body);
    if (parse.kind === 'refused') {
      if (!got.body.trimStart().startsWith('{')) {
        console.log(`      ${q.padEnd(26)} 200 but not a catalogue — ${parse.reason.slice(0, 120)}`);
        continue;
      }
      ours(`${c.state} catalogue — ${q}`, parse.reason);
    }
    console.log(`      ${q.padEnd(26)} 200 · ${parse.total} declared · ${parse.datasets.length} read · ${got.ms} ms`);
    parses.push(parse);
  }
  return parses.length > 0 ? mergeVolumeReads(parses) : { kind: 'refused', reason: `no query reached ${c.root}` };
}

function printCandidates(ranked: ProjectionJudgement[]): void {
  kv('projection datasets', ranked.length);
  for (const j of ranked.slice(0, 6)) {
    console.log(`\n      ${j.dataset.title}`);
    console.log(`        publisher   ${j.dataset.organisation ?? '(not stated)'}`);
    console.log(`        grain words ${j.grainWords.length > 0 ? j.grainWords.join(', ') : '(none in its own words)'}`);
    console.log(`        formats     ${j.formats.join(', ') || '(none stated)'}`);
    console.log(`        licence     ${j.dataset.licence ?? '(not stated)'}`);
    console.log(`        updated     ${j.dataset.metadataModified ?? '(not stated)'}`);
    console.log(`        file        ${j.machineReadable ? `${j.machineReadable.format} ${j.machineReadable.url}` : 'NO machine-readable resource'}`);
  }
}

function printLinks(links: ProjectionLink[]): void {
  for (const l of links.slice(0, 10)) {
    console.log(`      ${l.format.padEnd(5)} ${(l.grainWords.join(',') || '-').padEnd(14)} ${l.projection ? 'proj' : '    '}  ${l.text.slice(0, 70)}`);
    console.log(`            ${l.url}`);
  }
}

async function main(): Promise<void> {
  h('What does each state and territory publish as its own population projection?');
  console.log('  The ABS projects to capital city or rest of state and no finer, so forward');
  console.log('  demand at a property\'s own area is a per-jurisdiction register. This asks');
  console.log('  each publisher what it has and prints what the file holds. It writes nothing.');

  // The harvest, once: every jurisdiction's attributable projections in one read.
  h('The Commonwealth harvest');
  const harvestParses: VolumeCatalogueParse[] = [];
  for (const q of PROJECTION_QUERIES) {
    const got = await ask(`${PROJECTION_HARVEST_ROOT}/action/package_search?${new URLSearchParams({ q, rows: '200' })}`);
    if (got.networkError !== null || got.status !== 200) {
      console.log(`      ${q.padEnd(26)} ${got.networkError ?? `HTTP ${got.status}`}`);
      continue;
    }
    const parse = parseProjectionCatalogue({ dialect: 'ckan' }, got.body);
    if (parse.kind === 'refused') ours(`harvest — ${q}`, parse.reason);
    console.log(`      ${q.padEnd(26)} 200 · ${parse.total} declared · ${parse.datasets.length} read`);
    harvestParses.push(parse);
  }
  const harvest = harvestParses.length > 0 ? mergeVolumeReads(harvestParses) : null;

  const summary: { state: ProjectionState; finest: string; files: number }[] = [];

  for (const state of PROJECTION_STATES) {
    const pub = FORWARD_DEMAND_PUBLISHERS[state];
    h(`${state} — ${pub?.publisher ?? '(no publisher named)'}`);
    const datasets: VolumeDataset[] = [];

    const catalogue = PROJECTION_CATALOGUES.find((c) => c.state === state);
    if (catalogue) {
      const parse = await askCatalogue(catalogue);
      if (parse.kind === 'catalogue') datasets.push(...parse.datasets);
    } else {
      kv('catalogue', 'none this repository has verified — see sales-volume-liveness for where it publishes');
    }
    const fromHarvest = harvest?.kind === 'catalogue'
      ? harvest.datasets.filter((d) => projectionAttributable(d, state))
      : [];
    kv('harvest datasets attributable', fromHarvest.length);
    datasets.push(...fromHarvest);

    const ranked = rankProjectionCandidates(datasets);
    printCandidates(ranked);

    // The product page.
    let links: ProjectionLink[] = [];
    if (pub?.url) {
      const page = await ask(pub.url, 'text/html,*/*');
      kv('product page', `${pub.url} → ${page.networkError ?? `HTTP ${page.status}`}`);
      if (page.networkError === null && page.status === 200) {
        links = rankProjectionLinks(projectionFileLinks(page.body, pub.url));
        kv('files it links to', links.length);
        printLinks(links);
      }
    }

    // Describe the best of each route, so the loader is written against the file.
    const described = new Set<string>();
    const best = ranked.find((j) => j.machineReadable !== null);
    if (best?.machineReadable) {
      described.add(best.machineReadable.url);
      await describe(best.machineReadable.url, `catalogue: ${best.dataset.title.slice(0, 60)}`);
    }
    for (const l of links.filter((x) => x.projection || x.grainWords.length > 0).slice(0, 2)) {
      if (described.has(l.url)) continue;
      described.add(l.url);
      await describe(l.url, `page: ${l.text.slice(0, 60)}`);
    }
    const finest = [...ranked.flatMap((j) => j.grainWords), ...links.flatMap((l) => l.grainWords)][0] ?? '(none named)';
    summary.push({ state, finest, files: described.size });
  }

  h('READ');
  for (const s of summary) kv(s.state, `finest grain named: ${s.finest} · files described: ${s.files}`);
  console.log('\n  A grain NAMED is a claim in the publisher\'s words; the file descriptions above');
  console.log('  are what a loader is written against. Nothing was written anywhere.');
}

main().catch((err) => {
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
