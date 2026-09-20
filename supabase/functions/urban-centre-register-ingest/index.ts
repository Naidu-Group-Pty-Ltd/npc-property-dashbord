/**
 * Load the ABS's Significant Urban Areas into `urban_centre_register`.
 *
 * One request to the service `resolveOneReportGeography.ts` has queried in
 * production since ME-5, for every feature rather than one point, with the
 * polygon's centre rather than its outline. The parsing, the refusals and the
 * plausibility bounds are `urbanCentreIngest.pure.ts`'s; this is the fetch,
 * the write and the ledger.
 *
 * ## What it is for
 *
 * A commute measured to the state capital is a reading about a regional
 * property's access only if the capital is that property's market. Golden
 * Square is a suburb of Bendigo; its commute was measured to Melbourne at
 * 114 minutes and scored 0 of 100. See `urbanCentre.pure.ts`.
 *
 * ## Two things it deliberately does not do
 *
 * **It never half-writes.** A load that fails its plausibility bounds is
 * recorded as failed and writes no centre, because a register missing two
 * thirds of Australia is worse than one nobody has loaded: the second says so
 * and the first does not. Only a load that passes replaces the table's rows,
 * in one transaction-shaped sequence — upsert every centre, then prune the
 * codes this load did not carry.
 *
 * **It never seeds a fallback.** `CLONE_PROVISIONING_GAPS.md` records that the
 * rows a migration INSERTs do not travel, so a register that was seeded would
 * be present on the prime and absent on every clone while looking, from the
 * ledger, exactly like it was there. A deployment whose ingest has not run has
 * an empty register and behaves as it did before this existed — which is the
 * point of `ownCentre: 'no'` being a reading rather than a score.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { ASGS_RELEASE } from '../_shared/geography/asgsGeography.pure.ts';
import {
  assessLoad,
  parseSuaFeatures,
  type ParsedCentre,
} from '../_shared/reports/location/urbanCentreIngest.pure.ts';

const SOURCE = 'ABS ASGS 2021 Significant Urban Areas (geo.abs.gov.au ArcGIS REST)';
const TIMEOUT_MS = 45_000;

const SUA_LAYER =
  `https://geo.abs.gov.au/arcgis/rest/services/${ASGS_RELEASE}/SUA/MapServer/0/query`;

/**
 * Every SUA, with the centre of each — and WITHOUT the outline of any.
 *
 * `returnGeometry` is **false**, and that is the whole lesson of this file's
 * first production call. It was `true` beside `returnCentroid: true`, on the
 * reasoning that the parser accepts a feature's own geometry where the service
 * supplies no centroid — which is true, and which quietly asked the ABS for
 * every Significant Urban Area's full-resolution POLYGON. The worker was
 * killed with HTTP 546 (WORKER_RESOURCE_LIMIT) before it could log a single
 * line, so the only evidence it left was a status code on the edge.
 *
 * A centroid is two numbers. An urban-area boundary is tens of thousands of
 * vertices, and there are about a hundred of them. Asking for both to hedge
 * against one being missing is how a two-kilobyte answer becomes one no edge
 * function can hold — so the hedge is gone and the ABSENCE of a centroid is a
 * measurement the probe makes rather than something to insure against.
 *
 * `outSR=4326` because every coordinate in this platform is WGS84 and a silent
 * projection change is how a centre lands in the ocean.
 */
function queryUrl(extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'sua_code_2021,sua_name_2021',
    returnGeometry: 'false',
    returnCentroid: 'true',
    outSR: '4326',
    f: 'json',
    ...extra,
  });
  return `${SUA_LAYER}?${params}`;
}

/** How many urban areas the release holds. Two hundred bytes, whatever it says. */
function countUrl(): string {
  return `${SUA_LAYER}?${new URLSearchParams({ where: '1=1', returnCountOnly: 'true', f: 'json' })}`;
}

// deno-lint-ignore no-explicit-any
async function lastGoodCount(supabase: any): Promise<number | null> {
  const { data, error } = await supabase
    .from('urban_centre_syncs')
    .select('centres_written')
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(1);
  if (error) return null;
  const n = Number(data?.[0]?.centres_written);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// deno-lint-ignore no-explicit-any
async function writeCentres(supabase: any, centres: readonly ParsedCentre[], loadedAt: string) {
  const rows = centres.map((c) => ({
    sua_code: c.code,
    sua_name: c.name,
    state: c.state,
    lat: c.lat,
    lng: c.lng,
    point_basis: 'sua_centroid',
    asgs_release: ASGS_RELEASE,
    source: SOURCE,
    loaded_at: loadedAt,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('urban_centre_register')
      .upsert(rows.slice(i, i + 500), { onConflict: 'sua_code' });
    if (error) throw new Error(`urban_centre_register upsert failed: ${error.message}`);
  }
  // Prune by EFFECT rather than by configuration: whatever this load did not
  // carry is no longer in the release, and the prune names `sua_code` in its
  // own filter rather than relying on the returning projection — the defect
  // `SANCTIONS_LIST_LOADING.md` records, where a `.delete().or(...)` answered
  // 42703 on every load it was part of.
  const keep = centres.map((c) => c.code);
  const { error } = await supabase
    .from('urban_centre_register')
    .delete()
    .not('sua_code', 'in', `(${keep.map((c) => `"${c.replace(/"/g, '')}"`).join(',')})`);
  if (error) throw new Error(`urban_centre_register prune failed: ${error.message}`);
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // `verifyAuth(supabase, headers, body)` — the signature every other ingest
  // here uses, and the one that accepts what `cron_service_role_headers()`
  // sends. The first cut of this file called `verifyAuth(req)` against a
  // three-argument function: `headers` was undefined, so the FIRST statement
  // inside threw a TypeError and this function would have answered 500 to
  // every request ever made of it, before reaching a single line of its own
  // work. It is the `appendCaseEvent` class — an identifier or a shape that
  // does not exist is never type debt — and nothing but execution or reading
  // the callee finds it.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { error: authError } = await verifyAuth(supabase, req.headers, body);
  if (authError) return createUnauthorizedResponse(authError, cors);

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    });

  /*
   * `stage: 'probe'` fetches and describes, and writes NOTHING — no register
   * row, no ledger row. It exists because the query shape could not be
   * verified from the machine this was written on: that egress answers 403 at
   * the CONNECT tunnel for `geo.abs.gov.au` under an organisation policy, so
   * whether this service honours `returnCentroid` on a MapServer layer, and
   * how many features it returns in one answer, were UNVERIFIED assumptions.
   * `market-sales-ingest` already carries a stage of exactly this shape for
   * exactly this reason. Asserted by effect, never by configuration.
   */
  if (String(body.stage ?? '') === 'probe') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const ask = async (label: string, url: string) => {
      const res = await fetch(url, { signal: controller.signal });
      const text = await res.text();
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* reported */ }
      return { label, status: res.status, bytes: text.length, parsed };
    };
    try {
      // Cheapest question first, and a bounded one second. The probe must not
      // be able to commit the fault it exists to find: the first call answers
      // in a couple of hundred bytes whatever the release holds, and the
      // second is capped at five features, so neither can reach the memory
      // ceiling that killed the first attempt at 546 with nothing logged.
      const counted = await ask('count', countUrl());
      const shaped = await ask('shape', queryUrl({ resultRecordCount: '5' }));
      const features = Array.isArray(shaped.parsed?.features)
        ? shaped.parsed!.features as Array<Record<string, unknown>>
        : [];
      const first = features[0] ?? null;
      const probe = {
        ok: counted.status === 200 && shaped.status === 200
          && !counted.parsed?.error && !shaped.parsed?.error,
        count: { status: counted.status, bytes: counted.bytes, body: counted.parsed },
        shape: {
          status: shaped.status,
          bytes: shaped.bytes,
          errorBody: shaped.parsed?.error ?? null,
          exceededTransferLimit: shaped.parsed?.exceededTransferLimit ?? null,
          returned: features.length,
          // The one thing `returnCentroid=true` was an assumption about.
          firstFeatureKeys: first ? Object.keys(first) : [],
          firstAttributes: first?.attributes ?? null,
          firstCentroid: first?.centroid ?? null,
          hasGeometry: first ? Object.hasOwn(first, 'geometry') : null,
        },
        // What the real load would make of those five, computed, never written.
        wouldParse: (() => {
          try {
            const r = parseSuaFeatures(shaped.parsed);
            return { centres: r.centres.length, dropped: r.dropped, sample: r.centres.slice(0, 3) };
          } catch (e) {
            return { refused: e instanceof Error ? e.message : String(e) };
          }
        })(),
      };
      console.log(`[urban-centre-register-ingest] probe ${JSON.stringify(probe)}`);
      return json(probe);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[urban-centre-register-ingest] probe failed: ${message}`);
      return json({ ok: false, probeError: message });
    } finally {
      clearTimeout(timer);
    }
  }

  const started = new Date().toISOString();
  const { data: run } = await supabase
    .from('urban_centre_syncs')
    .insert({ started_at: started, asgs_release: ASGS_RELEASE })
    .select('id')
    .single();
  const runId = run?.id ?? null;

  const fail = async (message: string, detail: Record<string, unknown> = {}) => {
    if (runId) {
      await supabase.from('urban_centre_syncs').update({
        status: 'failed', finished_at: new Date().toISOString(), error: message, detail,
      }).eq('id', runId);
    }
    console.error(`[urban-centre-register-ingest] ${message}`);
    return new Response(JSON.stringify({ ok: false, error: message, detail }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let body: unknown;
    try {
      const res = await fetch(queryUrl(), { signal: controller.signal });
      if (!res.ok) return await fail(`the ABS geoserver answered ${res.status}`);
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const parsed = parseSuaFeatures(body);
    const verdict = assessLoad(parsed.centres.length, await lastGoodCount(supabase));
    if (!verdict.ok) {
      return await fail(verdict.reason ?? 'the load was refused', {
        parsed: parsed.centres.length, dropped: parsed.dropped,
      });
    }

    const loadedAt = new Date().toISOString();
    await writeCentres(supabase, parsed.centres, loadedAt);

    if (runId) {
      await supabase.from('urban_centre_syncs').update({
        status: 'succeeded',
        finished_at: loadedAt,
        centres_written: parsed.centres.length,
        detail: { dropped: parsed.dropped, states: [...new Set(parsed.centres.map((c) => c.state))].sort() },
      }).eq('id', runId);
    }
    console.log(`[urban-centre-register-ingest] wrote ${parsed.centres.length} centres`);
    return new Response(
      JSON.stringify({ ok: true, centres: parsed.centres.length, dropped: parsed.dropped }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await fail(message);
    return internalError(message, cors);
  }
});
