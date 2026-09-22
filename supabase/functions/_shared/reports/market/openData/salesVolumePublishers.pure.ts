/**
 * Does ACT, NT, TAS or WA publish a COUNT of residential sales, by an area
 * finer than the state, over enough periods to score Demand?
 *
 * ── The gap, stated precisely ────────────────────────────────────────────
 *
 * `scoreTransactionVolume` is the only PRIMARY demand measure this
 * deployment is entitled to — the other three (rental tightness, sale
 * urgency, absorption) come from vendor feeds nobody here holds, which is
 * what a Domain 403 leaves behind. It needs `VOLUME_BASELINE_PERIODS + 1`
 * = **four** periods carrying a count before it will believe a baseline.
 *
 * Where the register stands (measured from the loaders, 22 Sep 2026):
 *
 *   NSW  postcode + LGA + state, a count with EVERY period       ✅
 *   QLD  LGA, a count with every period                          ✅
 *   SA   LGA, a count with every period                           ✅
 *   VIC  suburb, ONE count per workbook — closed by
 *        `vicVolumeBackfill.pure.ts`, four archived quarters      ✅
 *   WA   `absResDwell` only: state grain, `salesCount: null`      ✗
 *   TAS  as WA                                                    ✗
 *   NT   as WA                                                    ✗
 *   ACT  as WA                                                    ✗
 *
 * So all four have a GROWTH reading and none has a DEMAND one, and the
 * missing thing is specific: not a median, not a price, not an area — a
 * **count**, over four periods, somewhere finer than the state.
 *
 * ── A median series is not a count series, and that is the whole trap ────
 *
 * Every one of these jurisdictions publishes something called "property
 * sales". Reading one and concluding the gap is closed is the failure this
 * module exists to prevent, because `absResDwell` already hands all four a
 * price at state grain: a second price series would change nothing and
 * would look, from a dashboard, exactly like a fix.
 *
 * `datasetCarriesCount` is therefore asked of the publisher's own words —
 * a dataset carries a count where it SAYS it does — and a median-only
 * dataset is recorded as `medians_only`, a distinct reading with its own
 * sentence, rather than as a find.
 *
 * ── Nothing here writes, and nothing here scores ─────────────────────────
 *
 * This is a reader and a policy in one file because both are small, but the
 * split is the same one `forwardDemand.pure.ts` makes: the parse functions
 * answer *what the catalogue said*, and `assessVolumeCoverage` answers
 * *what this deployment may state*. No `EvidencePoint` is constructed, no
 * row shape is emitted, and no table is named — loading is a separate step
 * that needs a register write, and this probe is what decides whether one is
 * worth asking for.
 *
 * Deno-compatible: one type-only import.
 */

import type { SalesRegisterState } from './salesRegister.pure.ts';

/** The four this module exists for. `AU` and the five scored states are out of scope. */
export type VolumeGapState = 'ACT' | 'NT' | 'TAS' | 'WA';

export const VOLUME_GAP_STATES: readonly VolumeGapState[] = ['ACT', 'NT', 'TAS', 'WA'];

/**
 * The states that already score, and why naming them here matters.
 *
 * A probe that only knows about the four it is looking at cannot tell you it
 * is looking at the right four. This list is asserted against the loaders by
 * spec, so a jurisdiction that silently loses its counts — the fault
 * `market-sales-ingest` committed when it wrote `sales_count: null` into
 * `ON CONFLICT DO UPDATE SET` on every daily run — shows up as a
 * contradiction rather than as a quiet regression.
 */
export const VOLUME_SCORED_STATES: readonly SalesRegisterState[] = ['NSW', 'QLD', 'SA', 'VIC'];

/**
 * The fewest counted periods a demand reading needs.
 *
 * Imported rather than retyped would be better, and is not possible: this
 * module must parse under Deno with no dependency on the scoring engine, and
 * `demandScoring.pure.ts` pulls in the whole evidence vocabulary. So the
 * number is stated once here and a spec asserts it equals
 * `VOLUME_BASELINE_PERIODS + 1` — the `AML_COMMAND_REFRESH_EVENT` rule: a
 * literal at each end is how two ends drift, so where one literal cannot be
 * avoided, a test holds the pair together.
 */
export const VOLUME_PERIODS_REQUIRED = 4;

// ---------------------------------------------------------------------------
// Where to ask
// ---------------------------------------------------------------------------

/**
 * A catalogue worth asking, per jurisdiction.
 *
 * Two per state, deliberately, and they fail differently — W3.4's rule paid
 * again. The jurisdiction's OWN catalogue is the authority on what it
 * publishes; `data.gov.au` HARVESTS the state catalogues and is the one this
 * repository has already measured working from CI
 * (`national-pipeline-liveness`). An absence needs both to answer AND to
 * agree, because a single truncated or unreachable question reads exactly
 * like an empty world — which this programme has now demonstrated twice.
 *
 * Every entry is a CKAN **API root**, never a dataset id and never a
 * resource id. What gets read is the publisher's own index.
 */
export interface VolumeCatalogue {
  state: VolumeGapState | 'AU';
  /** The publisher of the CATALOGUE, in a reader's words. */
  publisher: string;
  /** CKAN 3 API root, no trailing slash. */
  api: string;
  /**
   * `own` — the jurisdiction's own catalogue.
   * `harvest` — a catalogue that indexes other publishers' datasets.
   *
   * The distinction decides what an absence MEANS: nothing in a harvest is
   * a statement about the jurisdiction, only about the harvest.
   */
  kind: 'own' | 'harvest';
}

export const VOLUME_CATALOGUES: readonly VolumeCatalogue[] = [
  { state: 'WA', publisher: 'Government of Western Australia', api: 'https://catalogue.data.wa.gov.au/api/3', kind: 'own' },
  { state: 'NT', publisher: 'Northern Territory Government', api: 'https://data.nt.gov.au/api/3', kind: 'own' },
  { state: 'TAS', publisher: 'Tasmanian Government', api: 'https://data.tas.gov.au/api/3', kind: 'own' },
  { state: 'ACT', publisher: 'ACT Government', api: 'https://www.data.act.gov.au/api/3', kind: 'own' },
  // The one this repository has already measured answering from CI.
  { state: 'AU', publisher: 'Australian Government (data.gov.au)', api: 'https://data.gov.au/data/api/3', kind: 'harvest' },
];

/** Search a catalogue. `rows` bounded; `start` pages. */
export function volumeSearchUrl(api: string, query: string, rows = 50, start = 0): string {
  const p = new URLSearchParams({
    q: query,
    rows: String(Math.max(1, Math.min(200, rows))),
    start: String(Math.max(0, start)),
  });
  return `${api.replace(/\/+$/, '')}/action/package_search?${p}`;
}

/**
 * The queries, and why free text is used here where W3.2 refused it.
 *
 * W3.2's lesson is that a relevance query is not a FILTER — reading "no
 * match" off a ranked list establishes nothing. That lesson applies to
 * proving an ABSENCE, and this probe's absence is handled the same way:
 * corroborated across two catalogues that fail differently, and never read
 * from one ranked page.
 *
 * What free text is legitimate for is the opposite direction — finding a
 * CANDIDATE. There is no organisation slug to filter on here, because the
 * publisher of a sales series is a valuer-general or a revenue office whose
 * slug nobody here can verify, and typing one would fail exactly like an
 * absent one. So these queries look for candidates and every survivor is
 * then judged on the publisher's own words.
 */
export const VOLUME_QUERIES: readonly string[] = [
  'property sales',
  'residential sales',
  'median house price sales',
  'property transfers',
  'land sales',
];

// ---------------------------------------------------------------------------
// What the catalogue said
// ---------------------------------------------------------------------------

export interface VolumeResource {
  id: string;
  name: string;
  /** The publisher's own format word, upper-cased. Never inferred from the URL. */
  format: string;
  url: string;
  datastoreActive: boolean;
  size: number | null;
}

export interface VolumeDataset {
  id: string;
  name: string;
  title: string;
  /** What the publisher wrote about it. Judged, never re-worded. */
  notes: string | null;
  organisation: string | null;
  licence: string | null;
  metadataModified: string | null;
  resources: VolumeResource[];
}

export type VolumeCatalogueParse =
  | { kind: 'catalogue'; total: number; datasets: VolumeDataset[] }
  | { kind: 'refused'; reason: string };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Read a CKAN `package_search` answer.
 *
 * A refusal carries the byte count and the first 220 bytes verbatim, which
 * is load-bearing rather than decorative: the ABS structure parser read no
 * dimension out of 3,193,984 real bytes and reported it as an empty
 * document, because it had been handed XML under an unexpected namespace
 * prefix. **A parser that cannot say what it received cannot be debugged
 * from a CI log.**
 */
export function parseVolumeCatalogue(text: string): VolumeCatalogueParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return {
      kind: 'refused',
      reason: `not JSON (${text.length} bytes, ${String(err)}): ${JSON.stringify(text.slice(0, 220))}`,
    };
  }
  const envelope = body as { success?: unknown; result?: unknown; error?: unknown };
  if (envelope.success === false) {
    return { kind: 'refused', reason: `the catalogue refused: ${JSON.stringify(envelope.error ?? null)}` };
  }
  const result = envelope.result as { count?: unknown; results?: unknown } | undefined;
  if (!result || !Array.isArray(result.results)) {
    return {
      kind: 'refused',
      reason: `no result.results array (${text.length} bytes): ${JSON.stringify(text.slice(0, 220))}`,
    };
  }
  const datasets: VolumeDataset[] = [];
  for (const raw of result.results as unknown[]) {
    const d = raw as Record<string, unknown>;
    const id = str(d.id);
    const name = str(d.name);
    if (!id || !name) continue;
    const org = d.organization as Record<string, unknown> | undefined;
    const resources: VolumeResource[] = [];
    for (const rawRes of Array.isArray(d.resources) ? (d.resources as unknown[]) : []) {
      const r = rawRes as Record<string, unknown>;
      const rid = str(r.id);
      const url = str(r.url);
      if (!rid || !url) continue;
      resources.push({
        id: rid,
        name: str(r.name) ?? rid,
        format: (str(r.format) ?? '').toUpperCase(),
        url,
        datastoreActive: r.datastore_active === true,
        size: num(r.size),
      });
    }
    datasets.push({
      id,
      name,
      title: str(d.title) ?? name,
      notes: str(d.notes),
      organisation: str(org?.title) ?? str(org?.name),
      licence: str(d.license_title) ?? str(d.license_id),
      metadataModified: str(d.metadata_modified),
      resources,
    });
  }
  return { kind: 'catalogue', total: num(result.count) ?? datasets.length, datasets };
}

// ---------------------------------------------------------------------------
// Judging a candidate: the count, the grain, the format
// ---------------------------------------------------------------------------

/**
 * A count of transactions, named by the publisher.
 *
 * Deliberately narrow, and the narrowness is the point. `medianPrice` is
 * already held for all four states, so a dataset that mentions "sales" and
 * publishes only prices closes nothing — and would look like a fix.
 *
 * `number of sales`, `sales volume`, `transaction count`, `sales count`,
 * `no. of sales`, `dwellings sold`, `properties sold`, `transfers` with a
 * count word. Not `median`, not `price`, not `value`.
 */
export const COUNT_PATTERN =
  /\b(?:number\s+of\s+(?:sales|transactions|transfers|properties|dwellings)|no\.?\s+of\s+sales|sales?\s+(?:volume|count|numbers?)|transaction\s+(?:count|volume|numbers?)|(?:properties|dwellings|houses|units)\s+sold|volume\s+of\s+(?:sales|transfers))\b/i;

/** A median or a price, which these states already have. */
export const MEDIAN_PATTERN = /\b(?:median|mean|average)\s+(?:sale\s+)?(?:price|value)|\bprice\s+(?:index|quartiles?)\b/i;

/**
 * An area finer than the state, named by the publisher.
 *
 * `absResDwell` already answers the state, so a state-only series adds
 * nothing to what these four already hold — which is exactly why
 * `state_grain_only` is a distinct reading rather than a find.
 */
export const SUB_STATE_PATTERN =
  /\b(?:suburb|locality|localities|postcode|post\s?code|local\s+government|LGA|SA2|SA3|statistical\s+area|region(?:al|s)?|district|council)\b/i;

export const MACHINE_READABLE_FORMATS: readonly string[] = ['CSV', 'XLSX', 'XLS', 'JSON', 'GEOJSON'];
export const DOCUMENT_FORMATS: readonly string[] = ['PDF', 'DOC', 'DOCX', 'HTML', 'ZIP'];

/** What a candidate dataset is, on the publisher's own words. */
export interface VolumeCandidate {
  dataset: VolumeDataset;
  /** Does the publisher say it carries a COUNT? */
  count: boolean;
  /** Does it name an area finer than the state? */
  subState: boolean;
  /** Does it name a median or price? (Held already — not a find on its own.) */
  median: boolean;
  /** The best machine-readable resource, where there is one. */
  machineReadable: VolumeResource | null;
  /** Formats offered, so "published, but not as a feed" is a sayable sentence. */
  formats: string[];
}

/**
 * Judge one dataset by what its publisher wrote.
 *
 * Title AND notes, because a title alone is a headline: WA's
 * "Property Sales" tells you nothing about whether a count is inside it,
 * and the notes are where a publisher lists its columns.
 */
export function judgeVolumeDataset(dataset: VolumeDataset): VolumeCandidate {
  const words = [dataset.title, dataset.notes, ...dataset.resources.map((r) => r.name)]
    .filter((w): w is string => typeof w === 'string' && w !== '')
    .join(' · ');
  const formats = [...new Set(dataset.resources.map((r) => r.format).filter((f) => f !== ''))];
  const machine = dataset.resources
    .filter((r) => MACHINE_READABLE_FORMATS.includes(r.format))
    // A queryable resource outranks a download — `nationalPipeline`'s rule.
    .sort((a, b) => Number(b.datastoreActive) - Number(a.datastoreActive))[0] ?? null;
  return {
    dataset,
    count: COUNT_PATTERN.test(words),
    subState: SUB_STATE_PATTERN.test(words),
    median: MEDIAN_PATTERN.test(words),
    machineReadable: machine,
    formats,
  };
}

/**
 * Rank the candidates that could close the gap.
 *
 * A candidate qualifies only on a COUNT. Sorting puts sub-state grain and a
 * machine-readable resource above their absences, so the probe's first line
 * is the best thing the publisher has rather than the first thing it listed.
 */
export function rankVolumeCandidates(datasets: readonly VolumeDataset[]): VolumeCandidate[] {
  return datasets
    .map(judgeVolumeDataset)
    .filter((c) => c.count)
    .sort((a, b) =>
      Number(b.subState) - Number(a.subState)
      || Number(b.machineReadable !== null) - Number(a.machineReadable !== null)
      || Number(b.machineReadable?.datastoreActive ?? false) - Number(a.machineReadable?.datastoreActive ?? false));
}

/** Merge several catalogue reads. A refusal anywhere is carried, never smoothed. */
export function mergeVolumeReads(parses: readonly VolumeCatalogueParse[]): VolumeCatalogueParse {
  const refusals = parses.filter((p): p is Extract<VolumeCatalogueParse, { kind: 'refused' }> => p.kind === 'refused');
  const ok = parses.filter((p): p is Extract<VolumeCatalogueParse, { kind: 'catalogue' }> => p.kind === 'catalogue');
  if (ok.length === 0) {
    return { kind: 'refused', reason: refusals.map((r) => r.reason).join(' | ') || 'nothing was asked' };
  }
  const seen = new Set<string>();
  const datasets: VolumeDataset[] = [];
  for (const p of ok) {
    for (const d of p.datasets) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      datasets.push(d);
    }
  }
  return { kind: 'catalogue', total: Math.max(...ok.map((p) => p.total)), datasets };
}

// ---------------------------------------------------------------------------
// What this deployment may state
// ---------------------------------------------------------------------------

/**
 * Five readings, five sentences.
 *
 * `medians_only` and `state_grain_only` exist because they are the two ways
 * this probe could be read as a success when it is not: these four
 * jurisdictions ALREADY hold a state-grain price from `absResDwell`, so a
 * find that is either of those closes nothing and must not be filed as a
 * candidate. `SUPPLY_EVIDENCE.md`'s rule — four absences are four different
 * sentences — with the two near-misses named rather than collapsed.
 */
export type VolumeCoverage =
  /** A count series, sub-state, machine-readable. The gap can be closed. */
  | { kind: 'countable'; title: string; publisher: string; resourceId: string; format: string; licence: string | null }
  /** A count series, but only at state grain — which is already held. */
  | { kind: 'state_grain_only'; title: string; publisher: string }
  /** A count series published as documents rather than as a feed. */
  | { kind: 'published_as_documents'; title: string; publisher: string; formats: string[] }
  /** Sales data exists and carries no count. Not a find. */
  | { kind: 'medians_only'; examined: number }
  /** The catalogues answered and hold no count series. */
  | { kind: 'no_count_published'; examined: number }
  /** A catalogue could not be read. Says nothing about the jurisdiction. */
  | { kind: 'catalogue_unavailable'; reason: string };

/**
 * Decide, from corroborated reads.
 *
 * `corroborated` is the caller's job to establish and this function's job to
 * require: an absence (`no_count_published` / `medians_only`) is returned
 * only where it is true, because a single catalogue's silence is a statement
 * about that catalogue. An unreadable catalogue therefore outranks every
 * absence below it.
 */
export function assessVolumeCoverage(
  parse: VolumeCatalogueParse,
  corroborated: boolean,
): VolumeCoverage {
  if (parse.kind === 'refused') return { kind: 'catalogue_unavailable', reason: parse.reason };
  if (!corroborated) {
    return {
      kind: 'catalogue_unavailable',
      reason: 'only one catalogue answered, and one catalogue’s silence is a statement about that catalogue',
    };
  }
  const ranked = rankVolumeCandidates(parse.datasets);
  const best = ranked[0];
  if (best && best.subState && best.machineReadable) {
    return {
      kind: 'countable',
      title: best.dataset.title,
      publisher: best.dataset.organisation ?? 'the catalogue states no publisher',
      resourceId: best.machineReadable.id,
      format: best.machineReadable.format,
      licence: best.dataset.licence,
    };
  }
  if (best && best.subState) {
    return {
      kind: 'published_as_documents',
      title: best.dataset.title,
      publisher: best.dataset.organisation ?? 'the catalogue states no publisher',
      formats: best.formats.length > 0 ? best.formats : ['the catalogue states no format'],
    };
  }
  if (best) {
    return {
      kind: 'state_grain_only',
      title: best.dataset.title,
      publisher: best.dataset.organisation ?? 'the catalogue states no publisher',
    };
  }
  const anyMedian = parse.datasets.some((d) => judgeVolumeDataset(d).median);
  return anyMedian
    ? { kind: 'medians_only', examined: parse.datasets.length }
    : { kind: 'no_count_published', examined: parse.datasets.length };
}

/**
 * What a report may say about a jurisdiction whose demand cannot be scored.
 *
 * Every sentence is about the REGISTER and never about the market — the rule
 * §9 of `PLANNING_CONTROLS_IN_THE_REPORT.md` states and this programme has
 * now paid for four times. None of them rates anything, and none of them
 * says an area has few sales: a count nobody publishes is not a count of
 * zero, which is `rentalEvidence`'s *absent is never zero* applied to a
 * register rather than to a field.
 */
export function volumeCoverageNote(coverage: VolumeCoverage, state: VolumeGapState): string {
  switch (coverage.kind) {
    case 'countable':
      return `${state} publishes a count of residential sales below state level — `
        + `${coverage.title}, from ${coverage.publisher}, as ${coverage.format}`
        + `${coverage.licence ? ` under ${coverage.licence}` : ''}. It is not loaded into this `
        + 'deployment yet, so no transaction-volume reading is available here; that is outstanding '
        + 'work rather than a limitation of the source.';
    case 'state_grain_only':
      return `${state}'s published count of residential sales (${coverage.title}, `
        + `${coverage.publisher}) describes the whole ${state === 'ACT' || state === 'NT' ? 'territory' : 'state'} `
        + 'and no smaller area, so it cannot describe this property’s market. No transaction-volume '
        + 'reading is available here.';
    case 'published_as_documents':
      return `${state}'s count of residential sales is published as `
        + `${coverage.formats.join(', ')} rather than as a data feed (${coverage.title}, `
        + `${coverage.publisher}), so nothing from it is read here. That is a statement about the `
        + 'form it is published in, not about the market.';
    case 'medians_only':
      return `${state}'s published sales data states prices and not counts — `
        + `${coverage.examined} datasets were examined and none carries a number of sales. This `
        + 'report therefore states no transaction-volume reading for this area, which is a limit of '
        + 'what is published rather than a measurement.';
    case 'no_count_published':
      return `No count of residential sales below state level was found published for ${state} `
        + `(${coverage.examined} datasets examined across the territory's own catalogue and the `
        + 'Commonwealth catalogue). This report states no transaction-volume reading for this area.';
    case 'catalogue_unavailable':
      return `Whether ${state} publishes a count of residential sales could not be established for `
        + 'this report, so no transaction-volume reading is stated. That is a statement about the '
        + 'retrieval rather than about the market.';
  }
}
