/**
 * Do SA, WA, NT and ACT publish a planning layer — and under what licence?
 *
 * ## Why this exists: two premises, never measured
 *
 * `planningSources.pure.ts` carries two statements that decide what four
 * jurisdictions' reports may say, and neither is a measurement:
 *
 *   `SA_NT_NOTE`      *"every candidate host refused this platform's
 *                      scripted egress during integration"*
 *   `WA_LICENCE_NOTE` *"published for personal, non-commercial use …
 *                      so nothing is fetched"*
 *
 * The first was measured on the DEVELOPMENT egress. That is the egress which
 * answers **403 to CONNECT** for `data.gov.au` and every ABS host — three
 * registers that answer the production egress perfectly well. §8 of
 * `PLANNING_CONTROLS_IN_THE_REPORT.md` is the precedent and it is not a
 * small one: four jurisdictions assumed unreachable answered HTTP 200, all
 * open licence, no key, and *"overlay mapping … is not retrieved by this
 * platform"* had been printed on every property in the country from a
 * premise nobody had tested.
 *
 * The second is a **licence** claim. It may well be right. Nothing here has
 * ever read what the service itself says about its own terms — and a
 * jurisdiction can publish one layer under a restricted portal and the same
 * layer through an open catalogue.
 *
 * ## What is asked, and what is deliberately not
 *
 * A service ROOT or a service DIRECTORY, per jurisdiction, several each. No
 * layer id is typed anywhere: an ArcGIS directory enumerates the
 * jurisdiction's own list of services, so what gets read is the publisher's
 * catalogue rather than a path somebody guessed. The ACT entry is not a
 * guess at all — it is the organisation `buildActZoningQuery` already reads
 * a gazetted zone from in production.
 *
 * Nothing is written anywhere: no database, no Supabase, no credential, no
 * feature query. Only metadata endpoints are asked, which is the cheapest
 * question each service answers.
 *
 * ## The exit code
 *
 * Three outcomes and only one of them is red.
 *
 *  - A host that does not answer, or refuses us, or 404s: **0**. A build
 *    must not be decided by another party's uptime, and a 404 against a
 *    typed host is a gap in this repository that this probe's own output is
 *    the remedy for — printed, not failed on, because failing would make
 *    every future host addition a red build until it happened to be right.
 *  - A service that answers and states restricted terms: **0**. That is the
 *    measurement, and it CONFIRMS `WA_LICENCE_NOTE` if WA says it.
 *  - A service that answers and this repository cannot read what it sent:
 *    **1**. That is the one failure a fixture can never catch.
 *
 * `abs-register-liveness`' rule, the third time: *exit 0 when the publisher
 * is unreachable and 1 when the publisher answered and this reader refused.*
 */
import {
  LAYER_CANDIDATES,
  UNREAD_JURISDICTIONS,
  assessJurisdictionLayers,
  candidatesFor,
  classifyCandidateFailure,
  jurisdictionLayerNote,
  layerMetadataUrl,
  parseArcgisAnswer,
  parseWfsCapabilities,
  type CandidateOutcome,
  type LayerCandidate,
} from '../../supabase/functions/_shared/planning/jurisdictionLayerProbe.pure.ts';

const FETCH_MS = 30_000;
const UA = 'npc-property-dashboard/jurisdiction-layer-liveness (+planning coverage probe)';

const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(26)} ${String(v)}`);

/** Our side. The only thing that fails this job. */
function ours(what: string, detail: unknown): never {
  h('A SERVICE ANSWERED AND THIS REPOSITORY COULD NOT READ IT');
  kv('stage', what);
  kv('detail', detail);
  console.log('\n  The publisher answered and this reader refused its answer. That is the');
  console.log('  one failure a synthetic fixture can never catch, and it is what this');
  console.log('  job exists for.');
  process.exit(1);
}

interface Fetched { status: number; body: string; bytes: number; ms: number; networkError: string | null }

async function ask(url: string, accept: string): Promise<Fetched> {
  const began = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept, 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
      redirect: 'follow',
    });
    const body = await res.text();
    return { status: res.status, body, bytes: body.length, ms: Date.now() - began, networkError: null };
  } catch (err) {
    return {
      status: 0,
      body: '',
      bytes: 0,
      ms: Date.now() - began,
      networkError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function askCandidate(c: LayerCandidate): Promise<CandidateOutcome> {
  const url = layerMetadataUrl(c);
  const accept = c.kind === 'arcgis' ? 'application/json' : 'application/xml,text/xml,*/*';
  console.log(`\n  · ${c.jurisdiction} — ${c.service}`);
  kv('url', url);
  const got = await ask(url, accept);
  kv('http', got.networkError !== null
    ? `network: ${got.networkError} (${got.ms} ms)`
    : `${got.status} · ${got.bytes} bytes · ${got.ms} ms`);

  if (got.networkError !== null || got.status !== 200) {
    const failure = classifyCandidateFailure(got.networkError !== null ? null : got.status, got.networkError !== null);
    kv('failure', failure);
    if (got.bytes > 0) kv('body, verbatim', JSON.stringify(got.body.slice(0, 220)));
    return {
      kind: 'failed',
      failure,
      status: got.networkError !== null ? null : got.status,
      detail: got.networkError ?? `HTTP ${got.status}`,
    };
  }

  const answer = c.kind === 'arcgis' ? parseArcgisAnswer(got.body) : parseWfsCapabilities(got.body);
  switch (answer.kind) {
    case 'directory':
      kv('answer', `service directory · ${answer.services.length} services · ${answer.folders.length} folders`);
      if (answer.folders.length > 0) kv('folders', answer.folders.slice(0, 40).join(', '));
      answer.services.slice(0, 40).forEach((s) => console.log(`        ${s}`));
      if (answer.services.length > 40) console.log(`        … and ${answer.services.length - 40} more`);
      return { kind: 'directory', services: answer.services, folders: answer.folders, bytes: got.bytes };
    case 'service':
      kv('answer', `service · ${answer.layers.length} layers`);
      answer.layers.slice(0, 40).forEach((l) => console.log(`        ${l}`));
      kv('licence reading', answer.licence.kind);
      kv('licence evidence', answer.licence.evidence === null
        ? '(the service states nothing)'
        : JSON.stringify(answer.licence.evidence));
      return { kind: 'answered', layers: answer.layers, licence: answer.licence, bytes: got.bytes };
    case 'error':
      /*
       * A 200 carrying an ArcGIS error is a REFUSAL wearing a success digit —
       * the `PGRST205` and truncated-ABS shape. Reading it as an empty
       * directory is exactly what this branch exists to stop.
       */
      kv('answer', `a 200 that is a refusal — ${answer.message}`);
      return { kind: 'failed', failure: 'refused', status: 200, detail: answer.message };
    case 'unreadable':
      /*
       * HTTP 200, real bytes, and no shape this reader knows. That is OURS,
       * and it is the only red in this job.
       */
      ours(`${c.jurisdiction} — ${c.service}`, answer.reason);
  }
}

async function main(): Promise<void> {
  h('Do SA, WA, NT and ACT publish a planning layer — and under what licence?');
  kv('candidates', LAYER_CANDIDATES.length);
  kv('jurisdictions', UNREAD_JURISDICTIONS.join(', '));
  console.log('\n  Metadata endpoints only. Nothing is written anywhere and no feature');
  console.log('  query is made. A 404 is OUR typed host and never a statement about the');
  console.log('  jurisdiction — which is the confusion this probe exists to end.');

  const readings: { jurisdiction: string; note: string; kind: string }[] = [];

  for (const jurisdiction of UNREAD_JURISDICTIONS) {
    const candidates = candidatesFor(jurisdiction);
    h(`${jurisdiction} · ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`);
    if (candidates.length === 0) {
      /*
       * A verdict over zero requests is the fault `abs-projection-liveness`
       * printed once. It cannot happen here without this file being edited
       * wrong, so it is ours.
       */
      ours(`${jurisdiction} candidates`, 'no candidate declared — a reading over zero requests is not a reading');
    }
    const outcomes: { candidate: LayerCandidate; outcome: CandidateOutcome }[] = [];
    for (const c of candidates) {
      outcomes.push({ candidate: c, outcome: await askCandidate(c) });
    }
    const reading = assessJurisdictionLayers(outcomes);
    console.log('');
    kv('reading', reading.kind);
    const note = jurisdictionLayerNote(reading, jurisdiction);
    console.log(`\n  What a report may say:\n    ${note}`);
    readings.push({ jurisdiction, note, kind: reading.kind });
  }

  h('READ');
  for (const r of readings) kv(r.jurisdiction, r.kind);

  console.log('\n  What this settles, and what it does not:');
  console.log('');
  const restricted = readings.filter((r) => r.kind === 'licence_restricted');
  const reachable = readings.filter((r) => r.kind === 'catalogue_readable' || r.kind === 'integratable'
    || r.kind === 'licence_unverified');
  const refused = readings.filter((r) => r.kind === 'refused_us');
  const unresolved = readings.filter((r) => r.kind === 'no_candidate_resolved' || r.kind === 'unreachable');

  if (restricted.length > 0) {
    console.log(`  · ${restricted.map((r) => r.jurisdiction).join(', ')} — the service states restricted terms`);
    console.log('    IN ITS OWN METADATA. That is the licence claim confirmed by the');
    console.log('    publisher rather than asserted by us, and nothing is fetched.');
  }
  if (reachable.length > 0) {
    console.log(`  · ${reachable.map((r) => r.jurisdiction).join(', ')} — reachable from this egress.`);
    console.log('    Any note saying the host refused this platform is a statement about a');
    console.log('    past egress and must be rewritten as outstanding integration work.');
  }
  if (refused.length > 0) {
    console.log(`  · ${refused.map((r) => r.jurisdiction).join(', ')} — the publisher declined us. A finding`);
    console.log('    about the publisher, and the note may say so.');
  }
  if (unresolved.length > 0) {
    console.log(`  · ${unresolved.map((r) => r.jurisdiction).join(', ')} — no candidate this repository holds`);
    console.log('    resolved. That is a gap HERE. The note must not say the jurisdiction');
    console.log('    publishes nothing, because this run established no such thing.');
  }
  console.log('');
  console.log('  Exiting 0: every reading above is a measurement. The only red in this');
  console.log('  job is a service answering and this reader refusing its answer.');
}

main().catch((err) => {
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
