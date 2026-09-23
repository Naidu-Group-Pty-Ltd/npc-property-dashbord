/**
 * Which layer is SA's, WA's and the NT's planning ZONE — and what does it say
 * at a real point, under what terms?
 *
 * ## Why this exists
 *
 * `jurisdiction-layer-liveness` settled reachability from metadata: South
 * Australia's state spatial service answers, Western Australia's SLIP root
 * answers with five folders, the Northern Territory's NTLIS is behind a
 * bot-protection challenge. What it deliberately did not do is ask a layer a
 * question — and a parser verified against no response is the defect
 * `SA_NOTE` names. This asks: it finds the zone layer in each publisher's own
 * directory, reads the layer's fields and its stated terms, and makes ONE
 * point query at a public place in each capital and one suburb. That answer is
 * what the parsers are written against.
 *
 * It writes nothing anywhere: no database, no Supabase, no credential.
 *
 * ## What it reads
 *
 *   1. the jurisdiction's own catalogue, for zone datasets WITH their licence
 *      and the service they are served from;
 *   2. the service directories `LAYER_CANDIDATES` already names, walked by the
 *      publisher's own folder names — no folder, service or layer id is typed;
 *   3. the zone layers found, asked for their fields and terms, then asked the
 *      point question.
 *
 * ## The exit code
 *
 * `abs-register-liveness`' rule. A publisher that is unreachable, refuses,
 * challenges, or has no zone layer: **0** — that is the measurement. A
 * catalogue or directory that answers JSON this reader cannot read: **1**.
 */
import {
  bodyLooksChallenged,
  candidatesFor,
  classifyCandidateFailure,
  folderRootFor,
  parseArcgisAnswer,
  type LayerCandidate,
} from '../../supabase/functions/_shared/planning/jurisdictionLayerProbe.pure.ts';
import {
  UNREAD_ZONE_JURISDICTIONS,
  ZONE_CATALOGUES,
  ZONE_PROBE_POINTS,
  ZONE_QUERIES,
  ZONE_SERVICE_PATTERN,
  buildZonePointQuery,
  isZoneLayerName,
  rankZoneDatasets,
  readLayerDescription,
  readPointAnswer,
  readServiceLayers,
  type UnreadZoneJurisdiction,
} from '../../supabase/functions/_shared/planning/zoneLayerDiscovery.pure.ts';
import {
  mergeVolumeReads,
  parseVolumeCatalogue,
  volumeSearchUrl,
  type VolumeCatalogueParse,
} from '../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure.ts';

const FETCH_MS = 30_000;
const UA = 'npc-property-dashboard/planning-zone-liveness (+zone layer verification probe)';
const SERVICES_PER_JURISDICTION = 12;
const ZONE_LAYERS_PER_SERVICE = 3;

const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(Math.min(s.length, 100))); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(30)} ${String(v)}`);

function ours(what: string, detail: unknown): never {
  h('A PUBLISHER ANSWERED AND THIS REPOSITORY COULD NOT READ IT');
  kv('stage', what);
  kv('detail', detail);
  process.exit(1);
}

interface Fetched { status: number; body: string; ms: number; networkError: string | null }

async function ask(url: string): Promise<Fetched> {
  const began = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
      redirect: 'follow',
    });
    const body = await res.text();
    return { status: res.status, body, ms: Date.now() - began, networkError: null };
  } catch (err) {
    return { status: 0, body: '', ms: Date.now() - began, networkError: err instanceof Error ? err.message : String(err) };
  }
}

const describeFailure = (got: Fetched) => {
  const cls = classifyCandidateFailure(got.networkError !== null ? null : got.status, got.networkError !== null, got.body);
  return `${got.networkError ?? `HTTP ${got.status}`} → ${cls}${bodyLooksChallenged(got.body) ? ' (a bot-protection challenge page)' : ''}`;
};

const short = (v: unknown) => {
  const s = v === null || v === undefined ? 'null' : String(v).replace(/\s+/g, ' ');
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
};

async function catalogueRoute(j: UnreadZoneJurisdiction): Promise<string[]> {
  const cat = ZONE_CATALOGUES[j];
  kv('catalogue', `${cat.root}${cat.measured ? ' (measured answering)' : ' (typed, unmeasured)'}`);
  const parses: VolumeCatalogueParse[] = [];
  for (const q of ZONE_QUERIES) {
    const got = await ask(volumeSearchUrl(cat.root, q, 50));
    if (got.networkError !== null || got.status !== 200) {
      console.log(`      ${q.padEnd(24)} ${describeFailure(got)}`);
      continue;
    }
    const parse = parseVolumeCatalogue(got.body);
    if (parse.kind === 'refused') {
      if (!got.body.trimStart().startsWith('{')) { console.log(`      ${q.padEnd(24)} 200 but not a catalogue`); continue; }
      ours(`${j} catalogue — ${q}`, parse.reason);
    }
    console.log(`      ${q.padEnd(24)} 200 · ${parse.total} declared · ${parse.datasets.length} read`);
    parses.push(parse);
  }
  if (parses.length === 0) return [];
  const merged = mergeVolumeReads(parses);
  if (merged.kind !== 'catalogue') return [];
  const ranked = rankZoneDatasets(merged.datasets);
  kv('zone datasets', ranked.length);
  for (const r of ranked.slice(0, 8)) {
    console.log(`\n      ${r.dataset.title}`);
    console.log(`        publisher   ${r.dataset.organisation ?? '(not stated)'}`);
    console.log(`        licence     ${r.dataset.licence ?? '(not stated)'}`);
    console.log(`        formats     ${r.formats.join(', ') || '(none stated)'}`);
    console.log(`        updated     ${r.dataset.metadataModified ?? '(not stated)'}`);
    console.log(`        services    ${r.services.length > 0 ? r.services.join(' | ') : '(no ArcGIS service among its resources)'}`);
  }
  return [...new Set(ranked.flatMap((r) => r.services))];
}

async function directoryRoute(j: UnreadZoneJurisdiction): Promise<string[]> {
  const found: string[] = [];
  for (const c of candidatesFor(j)) {
    const got = await ask(`${c.root}?f=json`);
    if (got.networkError !== null || got.status !== 200) {
      kv(c.root, describeFailure(got));
      continue;
    }
    const answer = parseArcgisAnswer(got.body);
    if (answer.kind === 'unreadable') {
      if (bodyLooksChallenged(got.body) || !got.body.trimStart().startsWith('{')) { kv(c.root, 'answered, but not as an ArcGIS directory'); continue; }
      ours(`${j} directory ${c.root}`, answer.reason);
    }
    if (answer.kind === 'error') { kv(c.root, answer.message); continue; }
    if (answer.kind === 'service') continue; // a single service root is walked from the catalogue route
    kv(c.root, `${answer.services.length} services, ${answer.folders.length} folders`);
    const rootServices = answer.services.map((s) => s.replace(/ \((\w+)\)$/, '/$1'));
    for (const s of rootServices) if (ZONE_SERVICE_PATTERN.test(s)) found.push(`${c.root}/${s}`);
    for (const folder of answer.folders.slice(0, 48)) {
      const sub: LayerCandidate = folderRootFor(c, folder);
      const f = await ask(`${sub.root}?f=json`);
      if (f.networkError !== null || f.status !== 200) continue;
      const fa = parseArcgisAnswer(f.body);
      if (fa.kind !== 'directory') continue;
      for (const s of fa.services) {
        // A service name inside a folder carries the folder: `PlanSA/Zones (MapServer)`.
        const path = s.replace(/ \((\w+)\)$/, '/$1');
        if (ZONE_SERVICE_PATTERN.test(path)) found.push(`${c.root}/${path}`);
      }
    }
  }
  return [...new Set(found)];
}

async function askService(j: UnreadZoneJurisdiction, service: string): Promise<boolean> {
  const got = await ask(`${service}?f=json`);
  console.log(`\n    SERVICE ${service}`);
  if (got.networkError !== null || got.status !== 200) {
    console.log(`      ${describeFailure(got)}`);
    return false;
  }
  const answer = parseArcgisAnswer(got.body);
  if (answer.kind === 'error' || answer.kind === 'unreadable') {
    console.log(`      ${answer.kind === 'error' ? answer.message : answer.reason.slice(0, 160)}`);
    return false;
  }
  if (answer.kind === 'service') {
    console.log(`      terms read       ${answer.licence.kind}${'evidence' in answer.licence && answer.licence.evidence ? ` — "${short(answer.licence.evidence)}"` : ''}`);
  }
  const layers = readServiceLayers(got.body) ?? [];
  const zones = layers.filter((l) => isZoneLayerName(l.name));
  console.log(`      layers           ${layers.length} (${zones.length} named as a zone)`);
  for (const l of zones.slice(0, ZONE_LAYERS_PER_SERVICE)) {
    const layerUrl = `${service}/${l.id}`;
    const meta = await ask(`${layerUrl}?f=json`);
    const desc = meta.status === 200 ? readLayerDescription(meta.body) : null;
    console.log(`\n      LAYER ${l.id} "${l.name}" (${l.geometryType ?? desc?.geometryType ?? '?'})`);
    if (desc) {
      console.log(`        fields        ${desc.fields.map((f) => `${f.name}${f.alias && f.alias !== f.name ? `[${f.alias}]` : ''}`).join(', ').slice(0, 900)}`);
      console.log(`        copyright     ${short(desc.copyrightText)}`);
      console.log(`        description   ${short(desc.description)}`);
    } else {
      console.log(`        metadata      ${meta.networkError ?? `HTTP ${meta.status}`}`);
    }
    for (const pt of ZONE_PROBE_POINTS[j]) {
      const q = await ask(buildZonePointQuery(layerUrl, pt.lng, pt.lat));
      if (q.networkError !== null || q.status !== 200) {
        console.log(`        at ${pt.place}: ${describeFailure(q)}`);
        continue;
      }
      const a = readPointAnswer(q.body);
      if (a.kind === 'features') {
        console.log(`        at ${pt.place}: ${a.attributes.length} feature(s)`);
        for (const [k, v] of Object.entries(a.attributes[0]).slice(0, 24)) console.log(`          ${k.padEnd(24)} ${short(v)}`);
      } else {
        console.log(`        at ${pt.place}: ${a.kind === 'none_at_point' ? 'nothing at this point' : a.message}`);
      }
    }
  }
  return zones.length > 0;
}

async function main(): Promise<void> {
  h('Which layer is SA\'s, WA\'s and the NT\'s planning zone, and what does it say at a point?');
  console.log('  Metadata said each publisher is reachable (or challenged). This finds the zone');
  console.log('  layer, reads its fields and stated terms, and asks it one question at a public');
  console.log('  place in each capital and one suburb. It writes nothing.');

  const summary: { j: UnreadZoneJurisdiction; services: number; zoneServices: number }[] = [];
  for (const j of UNREAD_ZONE_JURISDICTIONS) {
    h(j);
    const fromCatalogue = await catalogueRoute(j);
    const fromDirectory = await directoryRoute(j);
    const services = [...new Set([...fromCatalogue, ...fromDirectory])].slice(0, SERVICES_PER_JURISDICTION);
    kv('services to ask', `${services.length} (${fromCatalogue.length} from the catalogue, ${fromDirectory.length} from the directory walk)`);
    let zoneServices = 0;
    for (const s of services) if (await askService(j, s)) zoneServices += 1;
    summary.push({ j, services: services.length, zoneServices });
  }

  h('READ');
  for (const s of summary) kv(s.j, `${s.services} planning service(s) asked, ${s.zoneServices} carrying a layer named as a zone`);
  console.log('\n  A layer named as a zone is a candidate. The point answers above are what a');
  console.log('  parser is written against; the terms above are what decides whether it may be');
  console.log('  republished. Nothing was written anywhere.');
}

main().catch((err) => {
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
