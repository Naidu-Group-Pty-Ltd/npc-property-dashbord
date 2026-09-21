/**
 * The national supply floor — ABS Building Approvals, by area and month.
 *
 * ## Why this register exists
 *
 * `REPORT_PRESENTATION_PROGRAMME.md` W3 states the rule: *every property in
 * Australia gets a development reading; the grain is the publisher's; the
 * scorer prices the grain; coverage travels with the answer.* Development
 * evidence today is one state's development-application register — the
 * Queensland walk that produced 1,410 dwellings and $1.18bn — and nothing at
 * all for the other seven jurisdictions. Meanwhile the statewide prompt
 * carries `**Supply Pipeline Risk:** [New housing supply vs demand balance]`,
 * a bracketed slot with no register behind it, which is the shape that put
 * `450 m²`, `8.5 m` and `0.5:1` into a Queensland property's document under
 * New South Wales instrument names.
 *
 * ABS Building Approvals is the one free, keyless, national, sub-state,
 * monthly measure of approved dwelling supply, under CC BY 4.0. It is the
 * floor beneath every jurisdiction, exactly as `RES_DWELL_ST` is the floor
 * beneath every price series.
 *
 * ## The dataflow is DISCOVERED, never guessed
 *
 * `absResDwell.pure.ts` hardcodes `ABS,RES_DWELL_ST,1.0.0`, and that is a
 * liability rather than a model: the version is part of the identifier, the
 * ABS reissues it, and a stale constant fetches a 404 that reads exactly like
 * an outage. It is also a constant nobody in this repository can verify
 * offline — this session's egress reaches neither `data.api.abs.gov.au` nor
 * `www.abs.gov.au`, and **an identifier typed from memory is the mistyped
 * Airtable column again**: invisible, because an absent flow and an empty
 * flow fail the same way.
 *
 * So the loader reads the ABS's own dataflow catalogue, selects by NAME
 * against a declared pattern, and prefers the FINEST grain the catalogue
 * offers — because the scorer prices the grain. Three refusals, each naming
 * what it saw: a catalogue it cannot parse, a catalogue in which nothing
 * matches, and a tie inside the chosen grain. It never picks one of two.
 *
 * An operator may name a flow explicitly (`resolveBuildingApprovalsFlow`'s
 * `override`), and that override is **checked against the catalogue** rather
 * than trusted — a typed identifier that is not published is refused with the
 * near misses named, so a typo cannot present as an outage.
 *
 * ## Four rules
 *
 * **An approval is not a completion.** The ABS counts approvals; a dwelling
 * approved is not commenced, and a dwelling commenced is not finished. This
 * is `infrastructureEvidence`'s rule — an approval is never read as funding,
 * funding never as a start on site — and `APPROVALS_ARE_NOT_COMPLETIONS`
 * carries it into the prose that quotes any figure from here.
 *
 * **One series estimate, or the count is three times itself.** The ABS
 * publishes Original, Seasonally Adjusted and Trend estimates of the same
 * month on the same flow. Summing across them triples every figure while
 * every individual row is correct — the QLD rollup trap in another costume —
 * so where the download carries a series-type column, only Original is kept,
 * and where it does not, nothing is filtered and the fact is recorded.
 *
 * **Absent is never zero.** `parseNumberCell` is the one reader, so a
 * suppressed or unpublished month is `null` and never 0. A month genuinely
 * carrying no approvals is a real 0 and is kept, because a council that
 * approved nothing in August is a fact worth printing.
 *
 * **A short walk is a truncated download.** Australia has roughly 540 local
 * government areas; a download naming 40 of them is not a small country, it
 * is a truncated body, and the loader refuses rather than writing a register
 * that looks complete.
 */
import {
  type SalesRegisterState,
  parseNumberCell,
  salesAreaToken,
} from './salesRegister.pure.ts';
import { parseSdmxCsv } from './absResDwell.pure.ts';

export const ABS_BA_AGENCY = 'ABS';

/** The ABS's own catalogue of every flow it publishes. */
export const ABS_BA_DATAFLOW_CATALOGUE_URL =
  'https://data.api.abs.gov.au/rest/dataflow/ABS?detail=allstubs';

export const ABS_BA_PAGE_URL =
  'https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/latest-release';
export const ABS_BA_SOURCE_LABEL =
  'Australian Bureau of Statistics, Building Approvals, Australia — dwelling units approved';
export const ABS_BA_LICENCE = 'Creative Commons Attribution 4.0 International';
export const ABS_BA_LICENCE_URL = 'https://www.abs.gov.au/privacy-and-legals/copyright';

/** Said wherever a figure from this register is quoted. */
export const APPROVALS_ARE_NOT_COMPLETIONS =
  'An approval is a council decision, not a building. Approved dwellings are '
  + 'not commenced dwellings and commenced dwellings are not completed ones, and '
  + 'the ABS counts only the first.';

/** The grain a matched flow works at, finest first — the scorer prices it. */
export type ApprovalsAreaKind = 'sa2' | 'lga' | 'state' | 'national';

export interface GrainRule {
  areaKind: ApprovalsAreaKind;
  /** Matched against the flow's published NAME. */
  pattern: RegExp;
  /** `openDataSalesEvidence`'s geography ladder, applied to supply. */
  geographyScore: number;
}

/**
 * Finest first. A flow naming no grain at all is not admitted: an
 * unqualified "Building Approvals" is the national release, and calling it a
 * reading about a council area is the mistake this whole module exists to
 * avoid.
 */
export const ABS_BA_GRAIN_LADDER: readonly GrainRule[] = [
  { areaKind: 'sa2', pattern: /\bSA2\b|statistical areas? level 2/i, geographyScore: 80 },
  { areaKind: 'lga', pattern: /local government area|\bLGAs?\b/i, geographyScore: 55 },
  { areaKind: 'state', pattern: /states? and territor|by state\b/i, geographyScore: 30 },
];

/** The subject pattern. Both words, in either order, anywhere in the name. */
export const ABS_BA_NAME_PATTERN = /building\s+approvals?/i;

export const ABS_BA_PLAUSIBILITY = {
  /** Minimum distinct areas, by grain. Australia has ~540 LGAs, ~2,500 SA2s. */
  minAreas: { sa2: 800, lga: 200, state: 8, national: 1 } as Record<ApprovalsAreaKind, number>,
  /** Months. Two years is the shortest window a year-on-year reading needs. */
  minPeriods: 24,
  /** Dwelling units approved in one area in one month. */
  maxUnitsPerAreaMonth: 100_000,
  /** Dollars of building approved in one area in one month. */
  maxValuePerAreaMonth: 20_000_000_000,
} as const;

// ─── The dataflow catalogue ─────────────────────────────────────────────────

export interface DataflowEntry {
  agency: string;
  id: string;
  version: string;
  name: string;
}

/** `ABS,BUILDING_APPROVALS_LGA,1.0.0` — the form the data URL takes. */
export function dataflowRef(entry: DataflowEntry): string {
  return `${entry.agency},${entry.id},${entry.version}`;
}

const ATTR = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
};

/**
 * The ABS's dataflow catalogue, as `(agency, id, version, name)` records.
 *
 * Tolerant of both shapes the SDMX REST standard admits, because which one
 * answers depends on the `Accept` header the caller sent and on the
 * publisher's own defaults — and a loader that can read only the shape
 * somebody assumed is a loader that reports a publisher outage when the
 * publisher changed a content type.
 */
export function parseDataflowCatalogue(text: string): DataflowEntry[] {
  const body = text.trim();
  if (body === '') throw new Error('the ABS dataflow catalogue is empty — refused');
  if (body.startsWith('{')) return parseJsonCatalogue(body);
  return parseXmlCatalogue(body);
}

function parseJsonCatalogue(body: string): DataflowEntry[] {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    throw new Error('the ABS dataflow catalogue is not parseable JSON — refused');
  }
  const root = doc as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const flows = data.dataflows ?? root.dataflows;
  if (!Array.isArray(flows)) {
    throw new Error('the ABS dataflow catalogue JSON carries no "dataflows" array — refused');
  }
  const out: DataflowEntry[] = [];
  for (const raw of flows) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const id = typeof f.id === 'string' ? f.id : null;
    if (!id) continue;
    // SDMX-JSON writes either a plain `name` or a `names` map by locale.
    const names = (f.names ?? {}) as Record<string, unknown>;
    const name = typeof f.name === 'string'
      ? f.name
      : typeof names.en === 'string'
        ? names.en
        : Object.values(names).find((v): v is string => typeof v === 'string') ?? '';
    out.push({
      agency: typeof f.agencyID === 'string' ? f.agencyID : ABS_BA_AGENCY,
      id,
      version: typeof f.version === 'string' ? f.version : '1.0.0',
      name,
    });
  }
  return out;
}

function parseXmlCatalogue(body: string): DataflowEntry[] {
  const out: DataflowEntry[] = [];
  // Both the namespaced (`str:Dataflow`) and bare spellings, self-closing or not.
  const blocks = body.match(/<(?:\w+:)?Dataflow\b[\s\S]*?(?:\/>|<\/(?:\w+:)?Dataflow>)/g) ?? [];
  for (const block of blocks) {
    const open = /<(?:\w+:)?Dataflow\b[^>]*>/.exec(block)?.[0] ?? '';
    const id = ATTR(open, 'id');
    if (!id) continue;
    const nameMatch = /<(?:\w+:)?Name\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Name>/.exec(block);
    out.push({
      agency: ATTR(open, 'agencyID') ?? ABS_BA_AGENCY,
      id,
      version: ATTR(open, 'version') ?? '1.0.0',
      name: (nameMatch ? nameMatch[1] : '').replace(/\s+/g, ' ').trim(),
    });
  }
  if (out.length === 0) {
    throw new Error('the ABS dataflow catalogue names no dataflow (neither JSON nor SDMX-ML) — refused');
  }
  return out;
}

export interface FlowChoice {
  flow: DataflowEntry;
  areaKind: ApprovalsAreaKind;
  geographyScore: number;
  /** How the flow was arrived at, for the sync row. */
  how: 'discovered' | 'operator_override';
  /** Every flow whose name matched the subject, finest grain first. */
  candidates: Array<{ ref: string; name: string; areaKind: ApprovalsAreaKind | null }>;
  /** How many flows the catalogue held in total. */
  cataloguedFlows: number;
}

function grainOf(name: string): GrainRule | null {
  for (const rule of ABS_BA_GRAIN_LADDER) if (rule.pattern.test(name)) return rule;
  return null;
}

/** `ABS,SOMETHING,1.0.0` and nothing else. */
export const DATAFLOW_REF_SHAPE = /^[A-Za-z0-9_]+,[A-Za-z0-9_]+,\d+(?:\.\d+)*$/;

/**
 * Which flow this load reads, and why.
 *
 * With no override: the finest-grained flow whose name names building
 * approvals. With an override: that flow, but only once the catalogue is
 * shown to publish it — an identifier nobody publishes is refused with the
 * closest published names beside it, because "we asked for a flow that does
 * not exist" and "the publisher is down" must not read the same.
 */
export function resolveBuildingApprovalsFlow(
  catalogueText: string,
  override?: string | null,
): FlowChoice {
  const all = parseDataflowCatalogue(catalogueText);
  if (all.length === 0) throw new Error('the ABS dataflow catalogue names no dataflow — refused');

  const matched = all
    .map((flow) => ({ flow, rule: grainOf(flow.name) }))
    .filter((c) => ABS_BA_NAME_PATTERN.test(c.flow.name));
  const candidates = matched
    .map((c) => ({ ref: dataflowRef(c.flow), name: c.flow.name, areaKind: c.rule?.areaKind ?? null }))
    .sort((a, b) => rank(a.areaKind) - rank(b.areaKind));

  if (override) {
    const want = override.trim();
    if (!DATAFLOW_REF_SHAPE.test(want)) {
      throw new Error(`"${want}" is not an SDMX dataflow reference (AGENCY,ID,VERSION) — refused`);
    }
    const found = all.find((f) => dataflowRef(f) === want);
    if (!found) {
      const near = all.filter((f) => ABS_BA_NAME_PATTERN.test(f.name)).map(dataflowRef);
      throw new Error(
        `the ABS catalogue (${all.length} flows) does not publish "${want}"`
        + (near.length ? ` — it publishes ${near.join(', ')}` : ' — and no flow it publishes names building approvals')
        + ' — refused',
      );
    }
    const rule = grainOf(found.name);
    return {
      flow: found,
      areaKind: rule?.areaKind ?? 'national',
      geographyScore: rule?.geographyScore ?? ABS_BA_GRAIN_LADDER[ABS_BA_GRAIN_LADDER.length - 1].geographyScore,
      how: 'operator_override',
      candidates,
      cataloguedFlows: all.length,
    };
  }

  if (matched.length === 0) {
    throw new Error(
      `no flow in the ABS catalogue (${all.length} flows) names building approvals — refused`,
    );
  }
  const graded = matched.filter((c): c is { flow: DataflowEntry; rule: GrainRule } => c.rule !== null);
  if (graded.length === 0) {
    throw new Error(
      `the ABS catalogue names ${matched.length} building-approvals flow(s) and none states a sub-national grain `
      + `(${candidates.map((c) => c.ref).join(', ')}) — refused, because an unqualified release is not a reading about an area`,
    );
  }
  const best = ABS_BA_GRAIN_LADDER.find((g) => graded.some((c) => c.rule.areaKind === g.areaKind))!;
  const atBest = graded.filter((c) => c.rule.areaKind === best.areaKind);
  // Not "which of these is the flow" but "which of these is CURRENT" — the
  // Bureau publishes one per edition. See `currentEdition`.
  const { chosen, tied } = currentEdition(atBest.map((c) => c.flow));
  if (!chosen) {
    throw new Error(
      `the ABS catalogue names ${tied.length} building-approvals flows at ${best.areaKind} grain `
      + `with the same vintage and no declared end (${tied.map(dataflowRef).join(', ')}) `
      + '— refused rather than picking one',
    );
  }
  return {
    flow: chosen,
    areaKind: best.areaKind,
    geographyScore: best.geographyScore,
    how: 'discovered',
    candidates,
    cataloguedFlows: all.length,
  };
}

/**
 * Which EDITION of a series a flow is, and whether it is the current one.
 *
 * ## Measured, not assumed — and the assumption was wrong
 *
 * `resolveBuildingApprovalsFlow` originally refused any grain holding more
 * than one flow, on the reasoning that two candidates mean an ambiguity a
 * loader must not resolve by itself. Run against the ABS's own catalogue on
 * 21 Sep 2026 (`abs-register-liveness`, HTTP 200, 791,134 bytes) that refused
 * outright, and it was RIGHT to:
 *
 *     the ABS catalogue names 3 building-approvals flows at sa2 grain
 *     (ABS,BA_SA2,2.0.0, ABS,BA_SA2_201116, ABS,BA_SA2_2016-21)
 *     — refused rather than picking one
 *
 * The Bureau publishes one flow per EDITION, not one per subject:
 *
 *   * SA2 — `BA_SA2_201116` (July 2011 to June 2016), `BA_SA2_2016-21`
 *     (2016 to 2021), `BA_SA2,2.0.0` (from July 2021 onwards);
 *   * LGA — `BA_LGA2018` through `BA_LGA2026`, one per LGA vintage. Nine.
 *
 * So they are not competitors to disambiguate. They are one series cut into
 * editions, and the question is not "which of these is the flow" but "which
 * of these is CURRENT". Refusing twelve flows is as wrong as picking one at
 * random — and picking at random is what a hardcoded identifier does, which
 * is the whole reason this module discovers instead. Had the loader named a
 * flow from memory it could have taken `BA_SA2_201116`, whose data ends in
 * **June 2016**, and presented a decade-old series as this month's supply.
 *
 * ## Two rules, in order
 *
 * **A period a publisher declares CLOSED is history.** A name saying "to June
 * 2016" or "2016 to 2021" states its own end; one saying "from July 2021
 * onwards" does not. Where any open edition exists the closed ones are not
 * candidates at all, whatever year they carry — `BA_SA2_2016-21` reaches 2021
 * and is still finished.
 *
 * **Then the latest vintage wins**, read as the greatest four-digit year in
 * the identifier or the name. That is what separates `BA_LGA2026` from the
 * eight LGA editions behind it.
 *
 * A tie after both is still refused, because two editions claiming the same
 * vintage with neither declaring an end is an ambiguity nothing here can
 * settle. The rule narrowed; it did not go away.
 */
export interface FlowEdition {
  /** The year the publisher's own name says the period ENDS, where it says. */
  closedAt: number | null;
  /** The greatest four-digit year in the identifier or the name. */
  vintage: number | null;
}

/** `2011` through the year after next: a year in an ABS series, not an ABN. */
const PLAUSIBLE_YEAR = /\b(20[0-4]\d)\b/g;

/**
 * A declared END. Both shapes the catalogue uses, and neither matches
 * "from July 2021 onwards", which declares a beginning.
 */
const DECLARES_AN_END = [
  /\bto\s+(?:\w+\s+)?(20\d\d)\b/i,
  /\b(20\d\d)\s*[-\u2013]\s*(\d{2,4})\b/,
];

export function flowEdition(entry: DataflowEntry): FlowEdition {
  const text = `${entry.id} ${entry.name}`;
  let closedAt: number | null = null;
  for (const re of DECLARES_AN_END) {
    const m = re.exec(entry.name);
    if (!m) continue;
    // `2016-21` closes in 2021; `to June 2016` closes in 2016.
    const tail = m[2] ?? m[1];
    const year = tail.length === 2 ? Number(`20${tail}`) : Number(tail);
    if (Number.isFinite(year)) closedAt = Math.max(closedAt ?? 0, year);
  }
  const years = [...text.matchAll(PLAUSIBLE_YEAR)].map((m) => Number(m[1]));
  return { closedAt, vintage: years.length ? Math.max(...years) : null };
}

/**
 * The current edition among flows at one grain, or null where two tie.
 *
 * Exported because the probe reports what it rejected: an operator reading a
 * sync row should see the eight LGA vintages that lost, not only the one
 * that won.
 */
export function currentEdition(
  flows: ReadonlyArray<DataflowEntry>,
): { chosen: DataflowEntry | null; tied: DataflowEntry[] } {
  if (flows.length === 0) return { chosen: null, tied: [] };
  if (flows.length === 1) return { chosen: flows[0], tied: [] };
  const withEdition = flows.map((flow) => ({ flow, edition: flowEdition(flow) }));
  const open = withEdition.filter((f) => f.edition.closedAt === null);
  const pool = open.length > 0 ? open : withEdition;
  const best = Math.max(...pool.map((f) => f.edition.vintage ?? -1));
  const at = pool.filter((f) => (f.edition.vintage ?? -1) === best);
  if (at.length === 1) return { chosen: at[0].flow, tied: [] };
  return { chosen: null, tied: at.map((f) => f.flow) };
}

const rank = (kind: ApprovalsAreaKind | null): number => {
  if (kind === null) return ABS_BA_GRAIN_LADDER.length;
  const at = ABS_BA_GRAIN_LADDER.findIndex((g) => g.areaKind === kind);
  return at === -1 ? ABS_BA_GRAIN_LADDER.length : at;
};

/**
 * What else the ABS publishes that bears on construction in an area.
 *
 * ## Why a SURVEY rather than a wider selection
 *
 * `INFRASTRUCTURE_COVERAGE_LIMITS` states, on every report, that this
 * platform does not reach *"council capital works programmes and their
 * budgets"* or *"state and federal budget infrastructure programmes"* — and
 * those are precisely the scheduled projects a reader most wants named. The
 * residential approvals this module loads are dwelling supply; they say
 * nothing about a hospital, a school, a distribution centre or a road.
 *
 * The ABS collection carries more than dwellings — non-residential building
 * approvals by value and purpose, engineering construction, building activity
 * — and some of it is published at sub-state grain. **Which of it, at what
 * grain, is not knowable from this repository**: neither ABS host answers a
 * development egress, so any list written here would be a list of what
 * somebody remembered rather than what the Bureau publishes.
 *
 * So this reports rather than decides. It is read by the `probe` stage alone,
 * changes no selection, and turns "could we also look at scheduled
 * infrastructure?" into one measurement from production instead of an opinion
 * about a catalogue nobody here can open. `resolveBuildingApprovalsFlow` stays
 * exactly as narrow as it was: a survey that widened the selection would be a
 * loader choosing a series because its name sounded relevant.
 */
export const ABS_CONSTRUCTION_SURVEY: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: 'building_approvals', pattern: /building\s+approvals?/i },
  { key: 'non_residential', pattern: /non-?residential/i },
  { key: 'engineering_construction', pattern: /engineering\s+construction/i },
  { key: 'building_activity', pattern: /building\s+activity|work\s+done|construction\s+activity/i },
  { key: 'public_infrastructure', pattern: /infrastructure|public\s+works|capital\s+works/i },
];

export interface SurveyedFlow {
  /** Which survey term matched. A flow may match more than one. */
  keys: string[];
  ref: string;
  name: string;
  /** The grain its NAME declares, where it declares one. */
  areaKind: ApprovalsAreaKind | null;
}

/**
 * Every catalogue flow whose name matches a construction term, with the grain
 * its name declares. Ordered finest-grain first, so an LGA or SA2 series is
 * the first thing an operator reads.
 */
export function surveyConstructionFlows(catalogueText: string): SurveyedFlow[] {
  return parseDataflowCatalogue(catalogueText)
    .map((flow) => ({
      keys: ABS_CONSTRUCTION_SURVEY.filter((t) => t.pattern.test(flow.name)).map((t) => t.key),
      ref: dataflowRef(flow),
      name: flow.name,
      areaKind: grainOf(flow.name)?.areaKind ?? null,
    }))
    .filter((f) => f.keys.length > 0)
    .sort((a, b) => rank(a.areaKind) - rank(b.areaKind) || a.ref.localeCompare(b.ref));
}

/** The data query for a chosen flow. Labels, because the parse reads labels. */
export function absBuildingApprovalsUrl(flow: DataflowEntry, startPeriod: string): string {
  if (!/^\d{4}-\d{2}$/.test(startPeriod)) {
    throw new Error(`startPeriod must be YYYY-MM, not "${startPeriod}"`);
  }
  return `https://data.api.abs.gov.au/rest/data/${dataflowRef(flow)}/all`
    + `?startPeriod=${startPeriod}&format=csvfilewithlabels`;
}

// ─── The data ───────────────────────────────────────────────────────────────

export type ApprovalsBuildingType = 'house' | 'other_residential' | 'total_residential';

export interface ApprovalRow {
  state: SalesRegisterState | null;
  areaKind: ApprovalsAreaKind;
  /** The publisher's own label. */
  area: string;
  areaToken: string;
  /** The publisher's own area code (an LGA code, an SA2 code). */
  areaCode: string;
  period: string;
  buildingType: ApprovalsBuildingType;
  /** Dwelling units approved. Null where the ABS published none. */
  dwellingUnits: number | null;
  /** Dollars of building approved, where the flow carries a value measure. */
  value: number | null;
}

const BUILDING_TYPE_PATTERNS: ReadonlyArray<[ApprovalsBuildingType, RegExp]> = [
  ['total_residential', /^total (residential|dwellings?)\b|^dwellings?,? total\b|^total$/i],
  ['house', /^houses?\b/i],
  ['other_residential', /other residential|non-?house/i],
];

const UNITS_MEASURE = /number of dwelling units|dwelling units|^number\b/i;
const VALUE_MEASURE = /value of (building|work)/i;
const ORIGINAL_SERIES = /^orig/i;

/** State from the ABS's own one-digit region code, where the flow carries it. */
export const ABS_BA_STATE_OF_CODE: Readonly<Record<string, SalesRegisterState>> = {
  '1': 'NSW', '2': 'VIC', '3': 'QLD', '4': 'SA', '5': 'WA', '6': 'TAS', '7': 'NT', '8': 'ACT', AUS: 'AU',
};

/** An LGA/SA2 code's leading digit is its state, under every ASGS edition. */
export function stateOfAreaCode(code: string): SalesRegisterState | null {
  const trimmed = code.trim();
  if (trimmed === '') return null;
  if (ABS_BA_STATE_OF_CODE[trimmed]) return ABS_BA_STATE_OF_CODE[trimmed];
  const lead = trimmed[0];
  return /[1-8]/.test(lead) ? ABS_BA_STATE_OF_CODE[lead] : null;
}

export interface ResolvedColumns {
  regionCode: string;
  regionLabel: string;
  measureLabel: string | null;
  buildingTypeLabel: string | null;
  seriesTypeLabel: string | null;
}

/**
 * Which column is which, read off the header rather than assumed.
 *
 * SDMX-CSV with labels emits both the code column (`REGION`) and its label
 * (`Region`), which is what makes this safe: a header offering exactly one
 * region pair and one measure label is not ambiguous, and where it is
 * ambiguous the loader says which names it found rather than choosing.
 */
export function resolveColumns(header: string[]): ResolvedColumns {
  const find = (re: RegExp, exclude?: RegExp): string[] =>
    header.filter((h) => re.test(h) && !(exclude && exclude.test(h)));

  /*
   * Case is the discriminator, and it is load-bearing. SDMX-CSV with labels
   * emits the dimension's ID in upper snake (`REGION`) and its human name
   * beside it (`Region`) -- so a case-INSENSITIVE code pattern matches both
   * and the header reads as ambiguous when it is not. That was this reader's
   * first defect, caught by its own fixture.
   */
  const regionCodes = find(/^(REGION|ASGS_2016|ASGS_2021|LGA|SA2)$/);
  const regionLabels = find(/^(Region|Local Government Area|Statistical Area Level 2)$/);
  if (regionCodes.length !== 1 || regionLabels.length !== 1) {
    throw new Error(
      `the ABS building-approvals download offers ${regionCodes.length} region code column(s) `
      + `and ${regionLabels.length} region label column(s) (header: ${header.join(', ')}) — refused`,
    );
  }
  const one = (names: string[]): string | null => (names.length === 1 ? names[0] : null);
  return {
    regionCode: regionCodes[0],
    regionLabel: regionLabels[0],
    measureLabel: one(find(/^Measure$/)),
    buildingTypeLabel: one(find(/^(Building Type|Type of Building|Dwelling Type)$/i)),
    seriesTypeLabel: one(find(/^(Adjustment Type|Series Type|TSEST_Label|Type of Series Estimate)$/i)),
  };
}

export interface AbsApprovalsParse {
  rows: ApprovalRow[];
  periods: string[];
  latestPeriod: string;
  areas: number;
  states: SalesRegisterState[];
  columns: ResolvedColumns;
  /** True where the download carried no series-type column to filter on. */
  seriesTypeUnfiltered: boolean;
  /** Rows the parse skipped because nothing it recognises named them. */
  skipped: number;
}

/**
 * The building-approvals download as register rows.
 *
 * Throws on a reshaped, truncated or unit-drifted answer; never returns a
 * partial register as though it were whole, and never writes a figure it
 * could not attribute to an area, a month and a building type.
 */
export function parseAbsBuildingApprovals(
  text: string,
  areaKind: ApprovalsAreaKind,
): AbsApprovalsParse {
  const records = parseSdmxCsv(text);
  if (records.length === 0) throw new Error('the ABS building-approvals download is empty — refused');
  const header = Object.keys(records[0]);
  for (const col of ['TIME_PERIOD', 'OBS_VALUE']) {
    if (!header.includes(col)) {
      throw new Error(`the ABS building-approvals download has no "${col}" column (header drift) — refused`);
    }
  }
  const columns = resolveColumns(header);
  const hasUnitMult = header.includes('UNIT_MULT');

  // (area code, period, building type) → the row being built.
  const byKey = new Map<string, ApprovalRow>();
  const periods = new Set<string>();
  const areas = new Set<string>();
  const states = new Set<SalesRegisterState>();
  let skipped = 0;
  let sawSeriesType = false;

  for (const rec of records) {
    if (columns.seriesTypeLabel) {
      const series = (rec[columns.seriesTypeLabel] ?? '').trim();
      if (series !== '') {
        sawSeriesType = true;
        if (!ORIGINAL_SERIES.test(series)) continue;
      }
    }
    const period = monthPeriod(rec.TIME_PERIOD ?? '');
    if (!period) { skipped++; continue; }
    const areaCode = (rec[columns.regionCode] ?? '').trim();
    const area = (rec[columns.regionLabel] ?? '').trim();
    if (areaCode === '' || area === '') { skipped++; continue; }

    const buildingType = columns.buildingTypeLabel
      ? matchBuildingType(rec[columns.buildingTypeLabel] ?? '')
      : 'total_residential';
    if (!buildingType) { skipped++; continue; }

    const measure = columns.measureLabel ? (rec[columns.measureLabel] ?? '') : '';
    const isValue = VALUE_MEASURE.test(measure);
    const isUnits = !columns.measureLabel || UNITS_MEASURE.test(measure);
    if (!isValue && !isUnits) { skipped++; continue; }

    const raw = parseNumberCell(rec.OBS_VALUE);
    const mult = hasUnitMult ? Number(rec.UNIT_MULT) : 0;
    const scaled = raw === null ? null : Math.round(raw * 10 ** (Number.isInteger(mult) ? mult : 0));

    const key = `${areaCode}|${period}|${buildingType}`;
    let row = byKey.get(key);
    if (!row) {
      const state = stateOfAreaCode(areaCode);
      row = {
        state,
        areaKind,
        area,
        areaToken: salesAreaToken(areaKind === 'sa2' ? 'suburb' : areaKind, area),
        areaCode,
        period,
        buildingType,
        dwellingUnits: null,
        value: null,
      };
      byKey.set(key, row);
      if (state) states.add(state);
    }
    if (scaled !== null) {
      if (isValue) {
        if (scaled < 0 || scaled > ABS_BA_PLAUSIBILITY.maxValuePerAreaMonth) {
          throw new Error(
            `the ABS building-approvals value for ${area} ${period} reads $${scaled}, `
            + `outside 0–${ABS_BA_PLAUSIBILITY.maxValuePerAreaMonth} (unit or column drift) — refused`,
          );
        }
        row.value = scaled;
      } else {
        if (scaled < 0 || scaled > ABS_BA_PLAUSIBILITY.maxUnitsPerAreaMonth) {
          throw new Error(
            `the ABS building-approvals count for ${area} ${period} reads ${scaled} dwelling units, `
            + `outside 0–${ABS_BA_PLAUSIBILITY.maxUnitsPerAreaMonth} (unit or column drift) — refused`,
          );
        }
        row.dwellingUnits = scaled;
      }
    }
    periods.add(period);
    areas.add(areaCode);
  }

  const rows = [...byKey.values()];
  if (rows.length === 0) {
    throw new Error(
      'the ABS building-approvals download carries no row this loader recognises '
      + `(${records.length} records read, ${skipped} skipped) — refused`,
    );
  }
  const minAreas = ABS_BA_PLAUSIBILITY.minAreas[areaKind];
  if (areas.size < minAreas) {
    throw new Error(
      `the ABS building-approvals download names ${areas.size} ${areaKind} areas, fewer than ${minAreas} `
      + '(a truncated download) — refused',
    );
  }
  const sorted = [...periods].sort();
  if (sorted.length < ABS_BA_PLAUSIBILITY.minPeriods) {
    throw new Error(
      `the ABS building-approvals download holds ${sorted.length} months, `
      + `fewer than ${ABS_BA_PLAUSIBILITY.minPeriods} — refused`,
    );
  }
  return {
    rows,
    periods: sorted,
    latestPeriod: sorted[sorted.length - 1],
    areas: areas.size,
    states: [...states],
    columns,
    seriesTypeUnfiltered: !sawSeriesType,
    skipped,
  };
}

/** `2026-07` → `2026-07`; `2026-07-01` → `2026-07`; null for anything else. */
export function monthPeriod(timePeriod: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(timePeriod.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}`;
}

function matchBuildingType(label: string): ApprovalsBuildingType | null {
  const s = label.trim();
  if (s === '') return null;
  for (const [type, pattern] of BUILDING_TYPE_PATTERNS) if (pattern.test(s)) return type;
  return null;
}
