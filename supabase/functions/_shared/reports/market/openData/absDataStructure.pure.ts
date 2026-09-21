/**
 * Ask the ABS for the part of the cube this register reads, and nothing else.
 *
 * ## The measurement this exists for
 *
 * Measured from a CI runner on 21 Sep 2026, against the Bureau's own bytes:
 *
 *     SA2, 12 months   200    476.5 MB   60.2 s   DID NOT FINISH
 *     SA2, 36 months   200   5045.4 MB   60.1 s   DID NOT FINISH
 *     LGA, 12 months   200     61.8 MB    1.6 s   complete
 *
 * An edge function has a ~150 s wall clock, so the finest grain the scorer
 * prices is not loadable at all with `/all`, and the LGA download is 61.8 MB
 * for **one month** of data. The window is not the lever: the two LGA windows
 * came back byte-identical because that edition holds one month, and shrinking
 * a period cannot shrink a cube that is wide rather than long.
 *
 * What is actually in those bytes is the whole cube — every building type
 * including hotels, factories, offices and health, every measure, and all
 * three series estimates — of which `parseAbsBuildingApprovals` keeps Original
 * estimates of three residential types on two measures and discards the rest.
 * We are paying to transfer what we then throw away.
 *
 * ## An SDMX key is POSITIONAL, so it is read and never typed
 *
 * `/rest/data/{flow}/{key}` selects by position: `M..1+2.....` means whatever
 * the publisher's dimension order says it means. Typing one from memory is the
 * mistyped Airtable column with an HTTP 200 in front of it — a narrowed key
 * against the wrong positions returns a plausible, wrong slice rather than an
 * error. So the order comes from the publisher's own data structure, exactly
 * as the dataflow identifier comes from the publisher's own catalogue.
 *
 * ## Four rules
 *
 * **The codes are chosen by NAME, with the rules the parser reads by.**
 * `BUILDING_TYPE_PATTERNS`, `UNITS_MEASURE`, `VALUE_MEASURE`,
 * `ORIGINAL_SERIES` and `MONTHLY_FREQ` are imported rather than restated, so
 * asking for what we keep and keeping what we asked for are one declaration.
 * Two copies of "which building types are residential" is how a narrowed
 * download comes back missing a row the parser still expects.
 *
 * **The area dimension is never narrowed, and that is enforced rather than
 * intended.** Narrowing the region is the one change that would silently make
 * the register a reading about somewhere else, so `composeApprovalsKey`
 * refuses outright if a rule ever matches a region dimension.
 *
 * **A rule that matches no code narrows nothing.** If the ABS renames
 * `Original`, the rule matches nothing, that position is left open, the whole
 * dimension comes back, and the parse filters it exactly as it does today.
 * The failure mode is a download that is bigger than it needed to be, never
 * one that is missing rows — and the caller is told which dimensions went
 * unnarrowed so a silent widening is visible in the sync row.
 *
 * **A structure that cannot be read costs nothing.** The caller falls back to
 * `/all`, which is what shipped, so this can only improve a load or leave it
 * alone. A narrowing is an optimisation and must never be a dependency.
 */
import {
  BUILDING_TYPE_PATTERNS,
  MONTHLY_FREQ,
  ORIGINAL_SERIES,
  UNITS_MEASURE,
  VALUE_MEASURE,
  type DataflowEntry,
} from './absBuildingApprovals.pure.ts';

/** The structure request for one flow: the DSD and its codelists. */
export function absDataStructureUrl(flow: DataflowEntry): string {
  return `https://data.api.abs.gov.au/rest/dataflow/${flow.agency}/${flow.id}/${flow.version}`
    + '?references=all';
}

export interface StructureCode {
  id: string;
  name: string;
}

export interface StructureDimension {
  id: string;
  /** The publisher's own 1-based position. The key is composed in this order. */
  position: number;
  codes: StructureCode[];
  /**
   * The time dimension. Read so the order is the publisher's own, and then
   * EXCLUDED from the key: under SDMX REST the key covers the dimensions
   * other than time, and the period is `startPeriod`/`endPeriod`. A slot for
   * `TIME_PERIOD` shifts nothing visibly and makes every position after it
   * mean a different dimension — an HTTP 200 over a plausible, wrong slice,
   * which is the one failure this whole module is arranged to avoid.
   */
  isTime: boolean;
}

export interface DataStructure {
  dimensions: StructureDimension[];
}

/**
 * The dimensions this register narrows, and what it keeps of each.
 *
 * `dimension` is matched against the dimension's own ID and `keep` against
 * each code's NAME — an id is a publisher's shorthand (`TYPE_BUILD` code `1`)
 * and carries no meaning a rule can be written against, while a name is the
 * same string the CSV's label column carries and the same one the parse
 * matches. Adding a dimension here is a declaration beside the rule that
 * reads it, never a change to the composer.
 */
export const ABS_BA_KEY_RULES: ReadonlyArray<{
  dimension: RegExp;
  keep: RegExp[];
  why: string;
}> = [
  {
    dimension: /^(TYPE_BUILD|BUILDING_TYPE|TYPE_OF_BUILDING|DWELLING_TYPE|TYPEBUILD)$/i,
    keep: BUILDING_TYPE_PATTERNS.map(([, pattern]) => pattern),
    why: 'three residential types; the cube also carries hotels, factories, offices and health',
  },
  {
    dimension: /^(MEASURE|MSR|MEASURES)$/i,
    keep: [UNITS_MEASURE, VALUE_MEASURE],
    why: 'dwelling units and value of building approved',
  },
  {
    dimension: /^(TSEST|SERIES_TYPE|SERIESTYPE|ADJUSTMENT|ADJUSTMENT_TYPE)$/i,
    keep: [ORIGINAL_SERIES],
    why: 'Original only — summing across the three estimates triples every figure',
  },
  {
    dimension: /^(FREQ|FREQUENCY)$/i,
    keep: [MONTHLY_FREQ],
    why: 'monthly; every other period is discarded by `monthPeriod` anyway',
  },
];

/**
 * The dimensions that name an AREA. Never narrowed, and a rule that reaches
 * one is a bug this refuses to ship rather than a slice to serve.
 */
export const AREA_DIMENSION = /^(REGION|ASGS_2016|ASGS_2021|ASGS_2026|LGA|SA2|STATE|GCCSA)$/i;

export interface ComposedKey {
  /** The positional key, or `all` where nothing narrowed. */
  key: string;
  /** Per narrowed dimension: what was kept, and out of how many. */
  narrowed: Array<{ dimension: string; kept: string[]; of: number; why: string }>;
  /** Dimensions a rule named but could not narrow, with why. Never silent. */
  unnarrowed: Array<{ dimension: string; reason: string }>;
}

/**
 * The key for one structure. `all` where nothing could be narrowed, which is
 * byte-for-byte the request that shipped.
 */
export function composeApprovalsKey(structure: DataStructure): ComposedKey {
  const ordered = structure.dimensions
    .filter((d) => !d.isTime)
    .sort((a, b) => a.position - b.position);
  if (ordered.length === 0) {
    return { key: 'all', narrowed: [], unnarrowed: [{ dimension: '(none)', reason: 'the structure named no dimension' }] };
  }

  const narrowed: ComposedKey['narrowed'] = [];
  const unnarrowed: ComposedKey['unnarrowed'] = [];
  const positions: string[] = [];

  for (const dim of ordered) {
    const rule = ABS_BA_KEY_RULES.find((r) => r.dimension.test(dim.id));
    if (!rule) { positions.push(''); continue; }
    if (AREA_DIMENSION.test(dim.id)) {
      // Not a degradation. A register narrowed by area is a register about
      // somewhere else, and the whole point of the read ladder is that the
      // AREA is chosen at read time from a trusted geography.
      throw new Error(
        `a key rule matched the area dimension "${dim.id}" — refused, because narrowing the `
        + 'area is what would make this register a reading about somewhere else',
      );
    }
    if (dim.codes.length === 0) {
      unnarrowed.push({ dimension: dim.id, reason: 'the structure published no codelist for it' });
      positions.push('');
      continue;
    }
    const kept = dim.codes.filter((c) => rule.keep.some((k) => k.test(c.name.trim()))).map((c) => c.id);
    if (kept.length === 0) {
      // The publisher renamed something. Leaving the position OPEN returns the
      // whole dimension and the parse filters it as it always has — bigger
      // than it needed to be, never missing a row.
      unnarrowed.push({
        dimension: dim.id,
        reason: `no code name matched (${dim.codes.length} published, e.g. ${dim.codes.slice(0, 3).map((c) => c.name).join(', ')})`,
      });
      positions.push('');
      continue;
    }
    if (kept.length === dim.codes.length) {
      // Asking for everything is asking for nothing; keep the position open so
      // the URL stays the shorter, cacheable one.
      positions.push('');
      continue;
    }
    narrowed.push({ dimension: dim.id, kept, of: dim.codes.length, why: rule.why });
    positions.push(kept.join('+'));
  }

  const key = positions.every((p) => p === '') ? 'all' : positions.join('.');
  return { key, narrowed, unnarrowed };
}

/** The data query for a flow, narrowed to what this register reads. */
export function narrowedApprovalsUrl(flow: DataflowEntry, startPeriod: string, key: string): string {
  if (!/^\d{4}-\d{2}$/.test(startPeriod)) {
    throw new Error(`startPeriod must be YYYY-MM, not "${startPeriod}"`);
  }
  return `https://data.api.abs.gov.au/rest/data/${flow.agency},${flow.id},${flow.version}/${key}`
    + `?startPeriod=${startPeriod}&format=csvfilewithlabels`;
}

// ─── Reading the structure ──────────────────────────────────────────────────

/**
 * The data structure, in both shapes the standard admits.
 *
 * Same reason `parseDataflowCatalogue` reads both: which one answers depends
 * on the `Accept` header and on the publisher's defaults, and a reader that
 * understands only the shape somebody assumed reports a publisher outage when
 * the publisher changed a content type.
 */
export function parseDataStructure(text: string): DataStructure {
  const body = text.trim();
  if (body === '') throw new Error('the ABS data structure is empty — refused');
  const parsed = body.startsWith('{') ? parseJsonStructure(body) : parseXmlStructure(body);
  if (parsed.dimensions.length === 0) {
    throw new Error('the ABS data structure names no dimension — refused');
  }
  return parsed;
}

/** `urn:…Codelist=ABS:CL_TYPE_BUILD(1.0.0)` → `CL_TYPE_BUILD`. */
function codelistIdOf(urn: string): string | null {
  const m = /Codelist=[^:]*:([A-Za-z0-9_@\-]+)\(/.exec(urn) ?? /Codelist=[^:]*:([A-Za-z0-9_@\-]+)/.exec(urn);
  return m ? m[1] : null;
}

const localeName = (value: unknown, names: unknown): string => {
  if (typeof value === 'string') return value;
  const map = (names ?? {}) as Record<string, unknown>;
  if (typeof map.en === 'string') return map.en;
  return Object.values(map).find((v): v is string => typeof v === 'string') ?? '';
};

function parseJsonStructure(body: string): DataStructure {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    throw new Error('the ABS data structure is not parseable JSON — refused');
  }
  const root = doc as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;

  // Codelists first, by id, so a dimension can resolve its own.
  const byCodelist = new Map<string, StructureCode[]>();
  const lists = Array.isArray(data.codelists) ? data.codelists : [];
  for (const raw of lists) {
    if (!raw || typeof raw !== 'object') continue;
    const cl = raw as Record<string, unknown>;
    const id = typeof cl.id === 'string' ? cl.id : null;
    if (!id) continue;
    const codes = Array.isArray(cl.codes) ? cl.codes : [];
    byCodelist.set(id, codes.flatMap((c) => {
      if (!c || typeof c !== 'object') return [];
      const code = c as Record<string, unknown>;
      return typeof code.id === 'string'
        ? [{ id: code.id, name: localeName(code.name, code.names) }]
        : [];
    }));
  }

  const structures = Array.isArray(data.dataStructures) ? data.dataStructures : [];
  const dimensions: StructureDimension[] = [];
  for (const raw of structures) {
    if (!raw || typeof raw !== 'object') continue;
    const dsd = raw as Record<string, unknown>;
    const components = (dsd.dataStructureComponents ?? {}) as Record<string, unknown>;
    const dimList = (components.dimensionList ?? {}) as Record<string, unknown>;
    const dims = Array.isArray(dimList.dimensions) ? dimList.dimensions : [];
    // SDMX-JSON publishes the time dimension in its own array, so it is
    // already out of the key's order; it is read only to be named.
    const timeDims = Array.isArray(dimList.timeDimensions) ? dimList.timeDimensions : [];
    for (const t of timeDims) {
      if (!t || typeof t !== 'object') continue;
      const tid = (t as Record<string, unknown>).id;
      if (typeof tid === 'string') dimensions.push({ id: tid, position: 9_999, codes: [], isTime: true });
    }
    dims.forEach((d, index) => {
      if (!d || typeof d !== 'object') return;
      const dim = d as Record<string, unknown>;
      const id = typeof dim.id === 'string' ? dim.id : null;
      if (!id) return;
      const rep = (dim.localRepresentation ?? {}) as Record<string, unknown>;
      const enumeration = typeof rep.enumeration === 'string' ? rep.enumeration : '';
      const clId = codelistIdOf(enumeration);
      dimensions.push({
        id,
        // The publisher's own position where it states one; else the order it
        // published them in, which SDMX-JSON guarantees is the key's order.
        position: typeof dim.position === 'number' ? dim.position : index + 1,
        codes: (clId && byCodelist.get(clId)) || [],
        isTime: false,
      });
    });
  }
  return { dimensions };
}

function parseXmlStructure(body: string): DataStructure {
  const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
    return m ? m[1] : null;
  };

  // Codelists, by id.
  const byCodelist = new Map<string, StructureCode[]>();
  for (const block of body.matchAll(/<str:Codelist\b([^>]*)>([\s\S]*?)<\/str:Codelist>/g)) {
    const id = attr(block[1], 'id');
    if (!id) continue;
    const codes: StructureCode[] = [];
    for (const code of block[2].matchAll(/<str:Code\b([^>]*)>([\s\S]*?)<\/str:Code>/g)) {
      const codeId = attr(code[1], 'id');
      if (!codeId) continue;
      const name = /<com:Name[^>]*>([\s\S]*?)<\/com:Name>/.exec(code[2]);
      codes.push({ id: codeId, name: (name?.[1] ?? '').trim() });
    }
    byCodelist.set(id, codes);
  }

  const dimensions: StructureDimension[] = [];
  let fallbackPosition = 0;
  for (const block of body.matchAll(/<str:(Dimension|TimeDimension)\b([^>]*)>([\s\S]*?)<\/str:(?:Dimension|TimeDimension)>/g)) {
    // The time dimension is read so positions stay the publisher's own, and
    // is then excluded from the key: the period is a query parameter.
    const isTime = block[1] === 'TimeDimension';
    const id = attr(block[2], 'id');
    if (!id) continue;
    if (!isTime) fallbackPosition += 1;
    const declared = attr(block[2], 'position');
    const enumeration = /<Ref\b([^>]*)\bpackage="codelist"([^>]*)\/>/.exec(block[3])
      ?? /<Ref\b([^>]*)\bclass="Codelist"([^>]*)\/>/.exec(block[3]);
    const clId = enumeration ? attr(enumeration[0], 'id') : null;
    dimensions.push({
      id,
      position: declared && /^\d+$/.test(declared) ? Number(declared) : fallbackPosition,
      codes: (clId && byCodelist.get(clId)) || [],
      isTime,
    });
  }
  return { dimensions };
}
