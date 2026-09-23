/**
 * Which layer is each unread jurisdiction's ZONE, and what does it answer at a
 * point? The step between "the publisher's directory answers" and "a parser
 * is verified against a real response".
 *
 * ── Where this sits ──────────────────────────────────────────────────────
 *
 * `jurisdictionLayerProbe.pure.ts` established reachability and licence from
 * metadata alone (22 Sep 2026): South Australia's state spatial service
 * answers with 131 services across 30 folders, Western Australia's SLIP root
 * answers with five folders, and the Northern Territory's NTLIS sits behind a
 * bot-protection challenge. It deliberately made no feature query. What it
 * could not say is WHICH layer carries the zone, what that layer's fields are
 * called, and what it returns at a real coordinate — and `SA_NOTE` says,
 * correctly, that none of it is read because no parser has been verified
 * against a response nobody here has seen.
 *
 * This module is what finds the layer and shapes the one question that
 * verifies a parser: a point query at a public coordinate in each capital.
 * Nothing in it is a layer id anybody typed — ids come from the publisher's
 * own directory, walked by the publisher's own folder names — and the only
 * typed things are HOSTS, as in `LAYER_CANDIDATES`, whose failures are
 * printed rather than hidden.
 *
 * ── Two routes, because they fail differently ────────────────────────────
 *
 * A jurisdiction's open-data catalogue names datasets WITH their licence and
 * the service they are served from; a service directory names layers with
 * none of that. So both are asked, and a layer found in a directory is
 * reported beside the catalogue's statement of its terms where one exists.
 * WA's is the case that matters: `WA_LICENCE_NOTE` was typed from SLIP's
 * public terms, and whether the planning scheme zones are also offered under
 * an open licence is a question for the catalogue, not for memory.
 *
 * Deno-compatible: explicit `.ts` extensions, no `@/` aliases. Writes nothing.
 */
import type { VolumeDataset } from '../reports/market/openData/salesVolumePublishers.pure.ts';

export type UnreadZoneJurisdiction = 'SA' | 'WA' | 'NT';

export const UNREAD_ZONE_JURISDICTIONS: readonly UnreadZoneJurisdiction[] = ['SA', 'WA', 'NT'];

/**
 * Each jurisdiction's own CKAN catalogue. WA's and the NT's answered from CI
 * on 22 Sep 2026 (`sales-volume-liveness`); South Australia's is the root its
 * portal documents, typed, and printed with whatever it answers.
 */
export const ZONE_CATALOGUES: Readonly<Record<UnreadZoneJurisdiction, { root: string; measured: boolean }>> = {
  SA: { root: 'https://data.sa.gov.au/data/api/3', measured: false },
  WA: { root: 'https://catalogue.data.wa.gov.au/api/3', measured: true },
  NT: { root: 'https://data.nt.gov.au/api/3', measured: true },
};

export const ZONE_QUERIES: readonly string[] = [
  'planning zones',
  'zoning',
  'planning scheme zones',
  'land use zones',
];

/** A dataset's own words name a planning zone. */
export const ZONE_WORDS = /\bzon(?:e|es|ing)\b/i;
export const PLANNING_WORDS = /\bplanning\b|\bscheme\b|\bdesign code\b|\bland use\b/i;

/**
 * The ArcGIS REST service root a URL belongs to, or null.
 *
 * `…/rest/services/Folder/Name/MapServer/12/query?x` → `…/rest/services/Folder/Name/MapServer`.
 * A layer id or operation on the end is stripped so the SERVICE is asked for
 * its own layer list; the layer the zone lives in is then read from it.
 */
export function arcgisServiceRootOf(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const m = /^(.*\/rest\/services\/.+?\/(?:MapServer|FeatureServer))(?:\/.*)?$/i.exec(url.pathname);
  if (!m) return null;
  return `https://${url.host}${m[1]}`;
}

export interface ZoneDatasetJudgement {
  dataset: VolumeDataset;
  zone: boolean;
  /** ArcGIS service roots its resources point at, de-duplicated. */
  services: string[];
  formats: string[];
}

export function judgeZoneDataset(dataset: VolumeDataset): ZoneDatasetJudgement {
  const words = [dataset.title, dataset.notes].filter((w): w is string => typeof w === 'string').join(' · ');
  const services = [...new Set(dataset.resources.map((r) => arcgisServiceRootOf(r.url)).filter((s): s is string => s !== null))];
  return {
    dataset,
    zone: ZONE_WORDS.test(words) && PLANNING_WORDS.test(words),
    services,
    formats: [...new Set(dataset.resources.map((r) => r.format).filter((f) => f !== ''))],
  };
}

/** Zone datasets first, those served from a queryable service above those that are not. */
export function rankZoneDatasets(datasets: readonly VolumeDataset[]): ZoneDatasetJudgement[] {
  return datasets
    .map(judgeZoneDataset)
    .filter((j) => j.zone)
    .sort((a, b) => Number(b.services.length > 0) - Number(a.services.length > 0));
}

/** A service in a directory worth opening: its name speaks of planning or zones. */
export const ZONE_SERVICE_PATTERN = /zon|plan|scheme|design.?code|landuse|land_use/i;

/** A layer inside a service that is the zone itself, not a precinct, overlay or label. */
export const ZONE_LAYER_PATTERN = /\bzon(?:e|es|ing)\b|zones?_|_zones?\b|zoning/i;
export const NOT_A_ZONE_LAYER = /\boverlay|\bprecinct|\blabel|annotation|\bboundar|sub-?zone|policy area/i;

export function isZoneLayerName(name: string): boolean {
  return ZONE_LAYER_PATTERN.test(name) && !NOT_A_ZONE_LAYER.test(name);
}

export interface ServiceLayer { id: number; name: string; geometryType: string | null }

/** A service's own layer list, with ids — `parseArcgisAnswer` keeps only names. */
export function readServiceLayers(text: string): ServiceLayer[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const layers = (body as { layers?: unknown })?.layers;
  if (!Array.isArray(layers)) return null;
  const out: ServiceLayer[] = [];
  for (const raw of layers) {
    const l = raw as Record<string, unknown>;
    if (typeof l.id !== 'number' || typeof l.name !== 'string') continue;
    out.push({ id: l.id, name: l.name, geometryType: typeof l.geometryType === 'string' ? l.geometryType : null });
  }
  return out;
}

export interface LayerField { name: string; alias: string | null; type: string | null }

export interface LayerDescription {
  name: string | null;
  geometryType: string | null;
  fields: LayerField[];
  /** What the layer says about its own terms and currency, verbatim. */
  copyrightText: string | null;
  description: string | null;
}

export function readLayerDescription(text: string): LayerDescription | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const o = body as Record<string, unknown>;
  if (!o || typeof o !== 'object' || o.error) return null;
  const fields = Array.isArray(o.fields)
    ? (o.fields as unknown[]).map((f) => {
      const r = f as Record<string, unknown>;
      return {
        name: typeof r.name === 'string' ? r.name : '',
        alias: typeof r.alias === 'string' ? r.alias : null,
        type: typeof r.type === 'string' ? r.type : null,
      };
    }).filter((f) => f.name !== '')
    : [];
  const text2 = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return {
    name: text2(o.name),
    geometryType: text2(o.geometryType),
    fields,
    copyrightText: text2(o.copyrightText),
    description: text2(o.description),
  };
}

/**
 * Public places in each capital, for the one question that verifies a parser.
 *
 * A capital's centre and an established residential suburb, because a zone
 * layer that answers the CBD with a city-centre zone and a suburb with a
 * residential one has been read correctly twice — one point can agree with a
 * wrong field by accident. Coordinates are of public places, not of any
 * client's property.
 */
export const ZONE_PROBE_POINTS: Readonly<Record<UnreadZoneJurisdiction, ReadonlyArray<{ place: string; lng: number; lat: number }>>> = {
  SA: [
    { place: 'Adelaide city centre (Victoria Square)', lng: 138.6007, lat: -34.9285 },
    { place: 'Prospect (Prospect Road)', lng: 138.5947, lat: -34.8837 },
  ],
  WA: [
    { place: 'Perth city centre (Forrest Place)', lng: 115.8599, lat: -31.9522 },
    { place: 'Mount Lawley (Beaufort Street)', lng: 115.8740, lat: -31.9340 },
  ],
  NT: [
    { place: 'Darwin city centre (Smith Street)', lng: 130.8418, lat: -12.4634 },
    { place: 'Nightcliff', lng: 130.8526, lat: -12.3833 },
  ],
};

/**
 * The point query, in the shape `buildActZoningQuery` has run in production:
 * `x,y` with `inSR=4326`, intersects, every field, no geometry.
 */
export function buildZonePointQuery(layerUrl: string, lng: number, lat: number): string {
  const p = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${layerUrl.replace(/\/+$/, '')}/query?${p}`;
}

export type PointAnswer =
  | { kind: 'features'; attributes: Record<string, unknown>[] }
  | { kind: 'none_at_point' }
  | { kind: 'error'; message: string };

/** A point query's answer. An ArcGIS error inside a 200 is an error, read first. */
export function readPointAnswer(text: string): PointAnswer {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: 'error', message: `not JSON: ${JSON.stringify(text.slice(0, 160))}` };
  }
  const o = body as Record<string, unknown>;
  const err = o?.error as Record<string, unknown> | undefined;
  if (err && typeof err === 'object') {
    return { kind: 'error', message: `ArcGIS error ${String(err.code ?? '?')}: ${String(err.message ?? '')}` };
  }
  if (!Array.isArray(o?.features)) return { kind: 'error', message: 'no features array' };
  const attributes = (o.features as unknown[])
    .map((f) => (f as { attributes?: Record<string, unknown> }).attributes)
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object');
  return attributes.length === 0 ? { kind: 'none_at_point' } : { kind: 'features', attributes };
}
