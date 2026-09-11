/**
 * Resolve ONE report's geography, from its coordinate, through the canonical
 * ASGS boundaries.
 *
 * ## Why this exists
 *
 * `resolve-report-geography` is a bounded backfill: it self-selects reports
 * whose `location_intelligence` is ALREADY PERSISTED — which happens at the
 * generator's own write — so a first generation never had a geography row when
 * the Client-Safe Gate asked whether the ABS data belonged to the subject
 * property. The result was a real inconsistency: a regenerated report got area
 * statistics and a brand-new one did not.
 *
 * This is that function's per-report body, lifted out so the generator can run
 * it for the report in hand, before the gate decides. **There is no second
 * geography algorithm**: the batch now calls this too, so both paths resolve
 * through the same `resolveGeography` over the same ASGS 2021 boundaries.
 *
 * ## The defect this move exposed
 *
 * The batch wrote `method: 'point_in_polygon'`. The table's CHECK constraint
 * admits `'asgs_point_in_polygon'` or `'none'` — so **every upsert violated it
 * and every write failed**, and the failure was swallowed into a per-report
 * `write_failed:` string in a results array nobody reads. The function returned
 * HTTP 200 throughout. That, rather than "the backfill has not run yet", is why
 * `report_geography` was empty. Fixed here, in the one place that now writes.
 *
 * ## What it refuses
 *
 * A coordinate outside Australia's bounding box is never sent to the boundary
 * service, and a report with no usable coordinate resolves `unresolved` rather
 * than borrowing a location. Nothing here reads a free-text suburb or postcode:
 * the address string is what produced the untrusted postcode in the first place.
 */

import {
  ASGS_RELEASE,
  BOUNDARY_SOURCE,
  isPlausiblyAustralian,
  resolveGeography,
  type AsgsArea,
  type AsgsLookup,
  type Sa2Hierarchy,
} from './asgsGeography.pure.ts';

/** The value the table's CHECK constraint actually admits. */
export const GEOGRAPHY_METHOD = 'asgs_point_in_polygon' as const;

export const GEO_TIMEOUT_MS = 20_000;

// Moved VERBATIM from `resolve-report-geography`, which now imports it back.
// Transcribing it by hand would have produced a second algorithm with
// different layer names and a different endpoint — which is exactly what a
// first draft of this file did.
const LAYERS: ReadonlyArray<{ key: keyof AsgsLookup; layer: string; code: string; name: string }> = [
  { key: 'sal', layer: 'SAL', code: 'sal_code_2021', name: 'sal_name_2021' },
  { key: 'poa', layer: 'POA', code: 'poa_code_2021', name: 'poa_name_2021' },
  { key: 'sa2', layer: 'SA2', code: 'sa2_code_2021', name: 'sa2_name_2021' },
  { key: 'ra', layer: 'RA', code: 'ra_code_2021', name: 'ra_name_2021' },
  { key: 'ucl', layer: 'UCL', code: 'ucl_code_2021', name: 'ucl_name_2021' },
  { key: 'sua', layer: 'SUA', code: 'sua_code_2021', name: 'sua_name_2021' },
];

async function queryLayer(
  layer: string, codeField: string, nameField: string, lat: number, lng: number,
): Promise<AsgsArea | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: `${codeField},${nameField}`,
    returnGeometry: 'false',
    f: 'json',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://geo.abs.gov.au/arcgis/rest/services/${ASGS_RELEASE}/${layer}/MapServer/0/query?${params}`,
      { signal: controller.signal },
    );
    if (!res.ok) throw new Error(`ABS geoserver answered ${res.status} for ${layer}`);
    const body = await res.json() as {
      error?: unknown;
      features?: Array<{ attributes?: Record<string, unknown> }>;
    };
    // ArcGIS reports failures as 200 plus an error body. That is transport.
    if (body.error) throw new Error(`ABS geoserver returned an error body for ${layer}`);
    const attrs = body.features?.[0]?.attributes;
    const code = attrs?.[codeField];
    const name = attrs?.[nameField];
    if (typeof code !== 'string' || !code) return null;
    return { code, name: typeof name === 'string' && name ? name : code };
  } finally {
    clearTimeout(timer);
  }
}

/** Every layer for one point. A single failure fails the whole lookup. */
export async function lookupPointDefault(lat: number, lng: number): Promise<AsgsLookup> {
  const empty: AsgsLookup = {
    sal: null, poa: null, sa2: null, ra: null, ucl: null, sua: null,
    salNeighbours: [], serviceFailed: true,
  };
  try {
    const areas = await Promise.all(
      LAYERS.map((l) => queryLayer(l.layer, l.code, l.name, lat, lng)),
    );
    const out: Record<string, AsgsArea | null> = {};
    LAYERS.forEach((l, i) => { out[l.key as string] = areas[i]; });
    return {
      sal: out.sal, poa: out.poa, sa2: out.sa2, ra: out.ra, ucl: out.ucl, sua: out.sua,
      // Neighbour detection needs an envelope query; the backfill's finding was
      // that it matters rarely, so it is left empty rather than approximated.
      salNeighbours: out.sal ? [out.sal] : [],
      serviceFailed: false,
    };
  } catch (_e) {
    return empty;
  }
}

export interface GeographyRowShape {
  report_id: string;
  latitude: number | null;
  longitude: number | null;
  suburb: string | null;
  locality_code: string | null;
  postcode: string | null;
  state: string | null;
  sa2_code: string | null;
  sa2_name: string | null;
  sa3_name: string | null;
  sa4_name: string | null;
  gccsa_name: string | null;
  remoteness_area: string | null;
  urban_centre: string | null;
  significant_urban_area: string | null;
  method: string;
  boundary_source: string;
  source_version: string;
  status: string;
  flags: readonly string[];
  notes: string;
}

export interface ResolveOneOptions {
  /** A service-role Supabase client. */
  readonly supabase: {
    from: (table: string) => any;
  };
  readonly reportId: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Injected so the generator and the batch can share one HTTP policy. */
  readonly lookupPoint?: (lat: number, lng: number) => Promise<AsgsLookup>;
}

export interface ResolveOneResult {
  readonly status: string;
  readonly row: GeographyRowShape | null;
  /** Present only where the write succeeded — and it is a real failure now. */
  readonly writeError: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;


/**
 * Resolve and persist one report's geography.
 *
 * Total: never throws on a resolution that simply cannot be made. A coordinate
 * that is absent or outside Australia resolves `unresolved`, which is what
 * makes the Client-Safe Gate withhold rather than guess.
 */
export async function resolveOneReportGeography(
  opts: ResolveOneOptions,
): Promise<ResolveOneResult> {
  const latitude = num(opts.latitude);
  const longitude = num(opts.longitude);
  const lookupPoint = opts.lookupPoint ?? lookupPointDefault;

  // The boundary service is only asked about a point that could be here.
  // Asking it about London wastes a request to be told what the bounding box
  // already knows.
  const worthAsking = latitude !== null && longitude !== null
    && isPlausiblyAustralian({ latitude, longitude });

  const lookup = worthAsking ? await lookupPoint(latitude!, longitude!) : null;

  let hierarchy: Sa2Hierarchy | null = null;
  if (lookup?.sa2) {
    const { data: meta } = await opts.supabase
      .from('abs_sa2_meta')
      .select('sa2_code, sa2_name, sa3_name, sa4_name, gccsa_name, state_name')
      .eq('sa2_code', lookup.sa2.code)
      .maybeSingle();
    if (meta) {
      hierarchy = {
        sa2Code: meta.sa2_code as string,
        sa2Name: meta.sa2_name as string,
        sa3Name: (meta.sa3_name as string) ?? null,
        sa4Name: (meta.sa4_name as string) ?? null,
        gccsaName: (meta.gccsa_name as string) ?? null,
        stateName: (meta.state_name as string) ?? null,
      };
    }
  }

  const resolved = resolveGeography({
    coordinate: latitude !== null && longitude !== null ? { latitude, longitude } : null,
    lookup,
    hierarchy,
    directoryMatches: [],
  });

  const row: GeographyRowShape = {
    report_id: opts.reportId,
    latitude,
    longitude,
    suburb: resolved.suburb,
    locality_code: resolved.localityCode,
    postcode: resolved.postcode,
    state: resolved.state,
    sa2_code: resolved.sa2Code,
    sa2_name: resolved.sa2Name,
    sa3_name: resolved.sa3Name,
    sa4_name: resolved.sa4Name,
    gccsa_name: resolved.gccsaName,
    remoteness_area: resolved.remotenessArea,
    urban_centre: resolved.urbanCentre,
    significant_urban_area: resolved.significantUrbanArea,
    // Not `point_in_polygon`: the CHECK constraint admits only this spelling,
    // and the other one silently failed every write this table ever received.
    method: GEOGRAPHY_METHOD,
    boundary_source: BOUNDARY_SOURCE,
    source_version: ASGS_RELEASE,
    status: resolved.status,
    flags: resolved.flags,
    notes: resolved.notes.join(' '),
  };

  const { error } = await opts.supabase
    .from('report_geography')
    .upsert(row, { onConflict: 'report_id' });

  return {
    status: resolved.status,
    row: error ? null : row,
    writeError: error ? String(error.message ?? error) : null,
  };
}
