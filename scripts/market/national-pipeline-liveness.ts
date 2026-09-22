/**
 * Is Infrastructure Australia's Priority List a register, or a publication?
 *
 * ## Why this exists
 *
 * W3.2's acceptance is two-branched: page 22's sentence is replaced by *named,
 * dated, sourced entries*, **or** by *a coverage statement that names the
 * register asked*. The statement shipped first. Which branch is honest is not
 * a design decision — it is a question only the publisher can answer, and
 * nothing in this repository had ever asked it.
 *
 * The development egress cannot ask: the gateway answers **403 to CONNECT**
 * for `data.gov.au`, `www.infrastructureaustralia.gov.au`, `www.abs.gov.au`
 * and `data.api.abs.gov.au` alike — measured 22 Sep 2026, a policy denial in
 * the network allowlist rather than anything either publisher did. A GitHub
 * runner has open internet. So this asks from CI, before anything is merged,
 * deployed or scheduled, and it writes nothing anywhere: no database, no
 * Supabase, no credential.
 *
 * ## The exit code is the whole design
 *
 * This is `abs-approvals-liveness.ts`'s rule, and it is the same rule for the
 * same reason. **The catalogue being unreachable is not our failure**, so a
 * refusal, a timeout or a 5xx reports and exits 0. What exits 1 is the case
 * that IS ours: the catalogue answered and our own discovery could not read
 * what it sent.
 *
 * And one case that is neither: the catalogue answers, is read correctly, and
 * holds no machine-readable edition of the list. That is not a defect in
 * anything — it is the measurement that settles which acceptance branch is
 * honest, and it exits 0 while saying so in as many words. A build that went
 * red because a publisher publishes a PDF would be a build asserting an
 * opinion about somebody else's distribution choices.
 */
import {
  CKAN_BASE,
  NATIONAL_PIPELINE_ORG_PATTERN,
  NATIONAL_PIPELINE_PUBLISHER,
  NATIONAL_PIPELINE_QUERIES,
  NATIONAL_PIPELINE_REGISTER,
  PRIORITY_LIST_PATTERN,
  assessPipelineAvailability,
  ckanFieldsUrl,
  ckanSampleUrl,
  ckanSearchUrl,
  mergeCatalogueReads,
  parseCkanSearch,
  pipelineCoverageNote,
  rankPipelineResources,
  surveyPipelinePackages,
  type CkanParse,
  type PipelineCandidate,
} from '../../supabase/functions/_shared/planning/nationalPipeline.pure.ts';

const UA = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)';
const FETCH_MS = 45_000;

/*
 * Everything prints on ONE stream. A heading on stdout and a verdict on
 * stderr are two buffers a log viewer interleaves as it pleases, which is how
 * the ABS probe's first failing run rendered its rule under the message
 * instead of under the heading. The exit code reports the failure; the text is
 * for a person, and a garbled verdict is harder to trust.
 */
const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(24)} ${String(v)}`);

/**
 * Their side. Reported, never failed on.
 *
 * The refusing party's own words are printed, because this script cannot tell
 * the catalogue's refusal from an INTERMEDIARY'S — this egress answers 403 to
 * CONNECT and a throttled CKAN would answer 403 as well, and the two send an
 * operator to opposite remedies. A runner behind an allowlist would otherwise
 * make this gate a placebo that exits 0 having reached nothing.
 */
function theirs(what: string, detail: unknown, body?: string): never {
  h('THE CATALOGUE DID NOT ANSWER');
  kv('stage', what);
  kv('detail', detail);
  if (body !== undefined) kv('what refused, verbatim', JSON.stringify(body.slice(0, 300)));
  console.log('\n  This is a statement about the retrieval, not about the register.');
  console.log('  Read the line above before believing it was data.gov.au: a gateway on');
  console.log('  this egress refuses in the same digits, and that is a green build');
  console.log('  standing over a check that reached nothing.');
  console.log('  Exiting 0: a build must not be decided by another party’s uptime.');
  process.exit(0);
}

/** Our side. The only thing that fails this job. */
function ours(what: string, detail: unknown): never {
  h('OUR DISCOVERY REFUSED THE CATALOGUE’S OWN ANSWER');
  kv('stage', what);
  kv('detail', detail);
  console.log('\n  The catalogue answered and this repository could not read it.');
  console.log('  That is the one failure a synthetic fixture can never catch, and it is');
  console.log('  what this job exists for.');
  process.exit(1);
}

interface Fetched { status: number; body: string; bytes: number; ms: number }

async function get(url: string): Promise<Fetched> {
  const began = Date.now();
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  const body = await res.text();
  return { status: res.status, body, bytes: body.length, ms: Date.now() - began };
}

async function main(): Promise<void> {
  h(`1 · ${NATIONAL_PIPELINE_PUBLISHER} in the Commonwealth’s catalogue`);
  kv('catalogue', CKAN_BASE);
  kv('organisation rule', String(NATIONAL_PIPELINE_ORG_PATTERN));
  kv('register rule', String(PRIORITY_LIST_PATTERN));

  const parses: CkanParse[] = [];
  for (const query of NATIONAL_PIPELINE_QUERIES) {
    const url = ckanSearchUrl(query);
    let got: Fetched;
    try {
      got = await get(url);
    } catch (err) {
      theirs(`search ${JSON.stringify(query)}`, err instanceof Error ? err.message : String(err));
    }
    console.log('');
    kv('query', query);
    kv('http', `${got.status} · ${got.bytes} bytes · ${got.ms} ms`);
    if (got.status !== 200) theirs(`search ${JSON.stringify(query)}`, `HTTP ${got.status}`, got.body);
    const parse = parseCkanSearch(got.body);
    if (parse.kind === 'refused') ours(`reading the answer to ${JSON.stringify(query)}`, parse.reason);
    kv('catalogue total', parse.total);
    kv('packages returned', parse.packages.length);
    parses.push(parse);
  }

  const merged = mergeCatalogueReads(parses);
  if (merged.kind === 'refused') ours('merging the searches', merged.reason);

  h('2 · What the searches returned, and what survives both tests');
  kv('distinct packages', merged.packages.length);
  for (const p of merged.packages) {
    const orgOk = p.organisation !== null && NATIONAL_PIPELINE_ORG_PATTERN.test(p.organisation);
    const nameOk = PRIORITY_LIST_PATTERN.test(p.title) || PRIORITY_LIST_PATTERN.test(p.name);
    const mark = orgOk && nameOk ? '✔' : orgOk ? 'org only' : nameOk ? 'name only' : '·';
    console.log(`  ${String(mark).padEnd(9)} ${p.title}`);
    console.log(`  ${' '.repeat(9)} org=${p.organisation ?? '(none)'} · modified=${p.metadataModified ?? '(none)'} · licence=${p.licence ?? '(none)'}`);
    console.log(`  ${' '.repeat(9)} resources: ${p.resources.map((r) => `${r.format || '?'}${r.datastoreActive ? '/datastore' : ''}`).join(', ') || '(none)'}`);
  }

  const survivors = surveyPipelinePackages(merged.packages);
  kv('survivors', survivors.length);

  h('3 · The resources this repository would try, best first');
  const ranked = rankPipelineResources(merged.packages);
  if (ranked.length === 0) console.log('  (none)');
  ranked.forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${c.access.padEnd(9)} ${c.resource.format.padEnd(7)} ${c.resource.name}`);
    console.log(`      package=${c.packageTitle}`);
    console.log(`      id=${c.resource.id} · size=${c.resource.size ?? '(unstated)'} · modified=${c.metadataModified ?? '(none)'}`);
    console.log(`      ${c.resource.url}`);
  });

  const availability = assessPipelineAvailability(merged);
  h('4 · The reading a report would carry');
  kv('availability', availability.kind);
  console.log(`\n  ${pipelineCoverageNote(availability)}`);

  if (availability.kind !== 'readable') {
    h('MEASURED: THE COVERAGE STATEMENT IS THE HONEST BRANCH');
    if (availability.kind === 'published_as_documents') {
      kv('formats offered', availability.formats.join(', ') || '(none stated)');
      console.log('\n  The register is published and is not a feed. A project read off a');
      console.log('  document travels through publishedProjectRegister.pure.ts, labelled');
      console.log('  “recorded from an official publication”, and never as a retrieval.');
    }
    if (availability.kind === 'not_in_catalogue') {
      kv('packages searched', availability.searched);
    }
    if (availability.kind === 'catalogue_unavailable') {
      kv('reason', availability.reason);
    }
    console.log('\n  Exiting 0. Nothing here is a defect: this is the measurement that');
    console.log('  settles which of W3.2’s two acceptance branches can be true, and a');
    console.log('  build must not go red over another party’s distribution choices.');
    process.exit(0);
  }

  h('5 · What the chosen resource DECLARES');
  let chosen: PipelineCandidate | null = null;
  for (const candidate of availability.candidates) {
    if (candidate.access !== 'queryable') {
      console.log(`\n  ${candidate.resource.name}: a download, not a queryable resource.`);
      console.log('  Its columns cannot be asked for without fetching it whole, so it is');
      console.log('  reported and not opened here. A later stage may measure the download.');
      continue;
    }
    const url = ckanFieldsUrl(candidate.resource.id);
    let got: Fetched;
    try {
      got = await get(url);
    } catch (err) {
      console.log(`\n  ${candidate.resource.name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    console.log('');
    kv('resource', candidate.resource.name);
    kv('http', `${got.status} · ${got.bytes} bytes · ${got.ms} ms`);
    if (got.status !== 200) { kv('skipped', `HTTP ${got.status}`); continue; }
    let declared: { result?: { total?: number; fields?: { id: string; type: string }[] } };
    try {
      declared = JSON.parse(got.body);
    } catch (err) {
      ours('reading the declared fields', `${String(err)}: ${JSON.stringify(got.body.slice(0, 220))}`);
    }
    const total = declared.result?.total ?? null;
    const fields = declared.result?.fields ?? [];
    kv('rows the resource holds', total ?? '(unstated)');
    kv('columns declared', fields.length);
    for (const f of fields) console.log(`      ${f.id}  ·  ${f.type}`);
    /*
     * Rule 2, and the reason it is a rule: QTRIP's current edition is declared
     * `datastore_active` and holds zero rows. A resource chosen by declaration
     * rather than by effect reads an empty register as an empty country.
     */
    if (total === null || total === 0) {
      console.log('\n      Declared and empty. Walking on — the edition is the one that ANSWERS.');
      continue;
    }
    chosen = candidate;
    break;
  }

  if (!chosen) {
    h('EVERY MACHINE-READABLE EDITION IS EMPTY OR UNOPENABLE');
    console.log('  The catalogue lists the register as a feed and no edition of that feed');
    console.log('  returned a row. Asserted by effect, never by configuration: the');
    console.log('  coverage statement is still the honest branch today.');
    console.log('  Exiting 0 — this is a measurement, not a defect.');
    process.exit(0);
  }

  h('6 · A sample of the register’s own rows, verbatim');
  let sample: Fetched;
  try {
    sample = await get(ckanSampleUrl(chosen.resource.id, 5));
  } catch (err) {
    theirs('sampling the chosen resource', err instanceof Error ? err.message : String(err));
  }
  kv('http', `${sample.status} · ${sample.bytes} bytes · ${sample.ms} ms`);
  if (sample.status !== 200) theirs('sampling the chosen resource', `HTTP ${sample.status}`, sample.body);
  let rows: { result?: { records?: Record<string, unknown>[] } };
  try {
    rows = JSON.parse(sample.body);
  } catch (err) {
    ours('reading the sample', `${String(err)}: ${JSON.stringify(sample.body.slice(0, 220))}`);
  }
  const records = rows.result?.records ?? [];
  kv('records', records.length);
  records.forEach((r, i) => {
    console.log(`\n  — record ${i + 1} —`);
    for (const [k, v] of Object.entries(r)) {
      console.log(`      ${k.padEnd(34)} ${JSON.stringify(v)}`);
    }
  });

  h('READ');
  kv('register', `${NATIONAL_PIPELINE_PUBLISHER} — ${NATIONAL_PIPELINE_REGISTER}`);
  kv('resource', chosen.resource.id);
  kv('licence', chosen.licence ?? '(the catalogue states none)');
  console.log('\n  The catalogue answered, the discovery read it, and the register holds');
  console.log('  rows. The columns above are what a row parser must be written against —');
  console.log('  measured, not assumed.');
}

main().catch((err) => {
  /*
   * An unexpected throw is OURS. A fetch failure is caught where it happens
   * and reported as theirs; anything reaching here is this script being wrong,
   * and reporting it as somebody else's outage is the placebo this file's
   * header refuses.
   */
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
