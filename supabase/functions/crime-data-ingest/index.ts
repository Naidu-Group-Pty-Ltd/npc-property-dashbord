import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalError } from '../_shared/errorResponse.ts';
import {
  createNswAccumulator, feedChunk, NSW_SOURCE_LABEL, parseQldLgaCsv,
  QLD_SOURCE_LABEL, stateTotals, zipSingleDeflateSpan, type CrimeSeriesRow,
} from '../_shared/crimeIngest.pure.ts';
import { normaliseCouncilTokens } from '../_shared/planning/developmentActivity.pure.ts';

/**
 * Ingest the two published recorded-crime datasets into `crime_reference` —
 * the loader IS this function, running where credentials and egress live
 * (the abs-poa-ingest pattern, which is the sanctions-register lesson).
 *
 * Two stages, one per source, because their cadences differ:
 *  - `{"stage":"nsw"}` — BOCSAR's postcode dataset (quarterly releases).
 *    The 4.2 MB zip unpacks to a 60 MB CSV; the parser reduces it line by
 *    line into fixed-size window accumulators precisely so this stage fits
 *    the edge worker's memory (the single-pass ABS ingest found that
 *    ceiling the hard way).
 *  - `{"stage":"qld"}` — QPS's LGA dataset (monthly releases).
 *
 * Each stage writes the per-area rows AND `state_total` rows (plain
 * addition over every area in the same file), records the load in
 * `crime_sync`, and refuses anything outside the measured shape — the
 * parsers throw on header drift, truncated downloads, implausible area
 * counts and broken rollup identities, so a bad file refuses instead of
 * loading.
 *
 * Auth: the internal edge secret — or, exactly once, an empty
 * `crime_reference` (the self-sealing bootstrap arm; sources are public
 * and the write is an idempotent upsert of that public data).
 *
 * Refreshing is re-invoking the stages; rows carry the data's own
 * latest_month, so currency is read from the data, never from loaded_at.
 */

const NSW_URL = 'https://bocsarblob.blob.core.windows.net/bocsar-open-data/PostcodeData.zip';
const QLD_URL = 'https://open-crime-data.s3-ap-southeast-2.amazonaws.com/Crime%20Statistics/LGA_Reported_Offences_Number.csv';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // The stage is read before authorisation because the bootstrap arm is
  // PER STATE: with both stages writing one table, a whole-table emptiness
  // gate seals after the first stage and locks the second out — which is
  // exactly what happened on the first production load (QLD loaded, NSW
  // answered forbidden). Each state's first load opens without the secret;
  // re-loading a state that holds rows requires it.
  const stage = String((await req.json().catch(() => ({})))?.stage ?? '');
  const stageState = stage === 'nsw' ? 'NSW' : stage === 'qld' ? 'QLD' : null;

  const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorised = internalSecret !== '' && bearer === internalSecret;
  if (!authorised && stageState) {
    const { count, error } = await supabase
      .from('crime_reference')
      .select('area', { count: 'exact', head: true })
      .eq('state', stageState);
    if (!error && (count ?? 0) === 0) {
      console.log(`[crime-data-ingest] bootstrap arm: no ${stageState} rows yet, first load permitted`);
      authorised = true;
    }
  }
  if (!authorised) return json({ success: false, error: 'forbidden' }, 403);

  try {
    const chunk = <T,>(arr: T[], n: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    const upsert = async (
      state: 'NSW' | 'QLD',
      areaKind: 'postcode' | 'lga',
      rows: CrimeSeriesRow[],
      source: string,
    ) => {
      const totals = stateTotals(rows).map((r) => ({ ...r, area: state }));
      const all = [
        ...rows.map((r) => ({ kind: areaKind, r })),
        ...totals.map((r) => ({ kind: 'state_total' as const, r })),
      ];
      for (const batch of chunk(all, 500)) {
        const { error } = await supabase.from('crime_reference').upsert(
          batch.map(({ kind, r }) => ({
            state,
            area_kind: kind,
            area: r.area,
            offence: r.offence,
            months12: r.months12,
            prior12: r.prior12,
            year_totals: r.yearTotals,
            latest_month: r.latestMonth,
            series_from: r.seriesFrom,
            source,
            area_token: kind === 'lga' ? normaliseCouncilTokens(r.area) : r.area,
            loaded_at: new Date().toISOString(),
          })),
          { onConflict: 'state,area_kind,area,offence' },
        );
        if (error) throw new Error(`crime_reference upsert failed: ${error.message}`);
      }
      return { rows: rows.length, state_totals: totals.length, latest_month: rows[0]?.latestMonth };
    };

    if (stage === 'nsw') {
      console.log('[crime-data-ingest] nsw stage: downloading from BOCSAR…');
      const res = await fetch(NSW_URL, { headers: { 'User-Agent': 'npc-property-dashboard-crime-ingest' } });
      if (!res.ok) return json({ success: false, error: `BOCSAR download answered ${res.status}` }, 502);
      // The 4.2 MB zip inflates to a 60 MB CSV, and holding that as one
      // string is what put the first attempt over WORKER_RESOURCE_LIMIT —
      // so the single deflate entry is located from the central directory
      // and STREAMED through the accumulator, line by line. Verified
      // byte-identical to the whole-string parse against the real archive.
      const zipBytes = new Uint8Array(await res.arrayBuffer());
      const span = zipSingleDeflateSpan(zipBytes);
      const stream = new Blob([zipBytes.subarray(span.start, span.start + span.length)]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'))
        .pipeThrough(new TextDecoderStream());
      const accumulator = createNswAccumulator();
      let carry = '';
      for await (const chunk of stream) carry = feedChunk(accumulator, carry, chunk);
      if (carry.trim() !== '') accumulator.feedLine(carry);
      const rows = accumulator.finish();
      const detail = { stage, source: NSW_SOURCE_LABEL, ...(await upsert('NSW', 'postcode', rows, NSW_SOURCE_LABEL)) };

      // The state per-100k benchmark, with the denominator NAMED: the 2021
      // Census usual-resident population of exactly the postcodes in this
      // file — a join on the file's own keys, never a typed-in state figure.
      const totals = stateTotals(rows);
      const total12 = totals.reduce((s, r) => s + r.months12, 0);
      const areas = [...new Set(rows.map((r) => r.area))];
      const { data: popRows, error: popError } = await supabase
        .from('abs_census_poa').select('population').in('poa', areas);
      let benchmark: Record<string, unknown> = { state: 'NSW', total12, latest_month: rows[0]?.latestMonth };
      if (!popError && popRows && popRows.length > 0) {
        const population = popRows.reduce((s: number, r: { population: number | null }) => s + (r.population ?? 0), 0);
        if (population > 0) {
          benchmark = {
            ...benchmark,
            population,
            rate_per_100k: Math.round((total12 / population) * 100_000),
            denominator: `2021 Census usual residents of the ${popRows.length} matched postal areas (of ${areas.length} in the BOCSAR file)`,
          };
        }
      }
      const { error: benchError } = await supabase.from('crime_state_benchmarks')
        .upsert(benchmark, { onConflict: 'state' });
      if (benchError) console.warn('[crime-data-ingest] benchmark write failed (load itself succeeded):', benchError.message);

      await supabase.from('crime_sync').insert({ detail: { ...detail, benchmark } });
      return json({ success: true, ...detail });
    }

    if (stage === 'qld') {
      console.log('[crime-data-ingest] qld stage: downloading from QPS open data…');
      const res = await fetch(QLD_URL, { headers: { 'User-Agent': 'npc-property-dashboard-crime-ingest' } });
      if (!res.ok) return json({ success: false, error: `QPS download answered ${res.status}` }, 502);
      const rows = parseQldLgaCsv(await res.text());
      const detail = { stage, source: QLD_SOURCE_LABEL, ...(await upsert('QLD', 'lga', rows, QLD_SOURCE_LABEL)) };

      // No LGA-population join exists yet (abs_census_poa is POA-keyed), so
      // the QLD benchmark carries counts only; the reading offers state
      // count-change context, never a rate with an unnamed denominator.
      const divisions = new Set(['Offences Against the Person', 'Offences Against Property', 'Other Offences']);
      const total12 = stateTotals(rows).filter((r) => divisions.has(r.offence)).reduce((s, r) => s + r.months12, 0);
      const { error: benchError } = await supabase.from('crime_state_benchmarks')
        .upsert({ state: 'QLD', total12, latest_month: rows[0]?.latestMonth }, { onConflict: 'state' });
      if (benchError) console.warn('[crime-data-ingest] benchmark write failed (load itself succeeded):', benchError.message);

      await supabase.from('crime_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    return json({ success: false, error: 'stage must be "nsw" or "qld"' }, 400);
  } catch (error) {
    console.error(`[crime-data-ingest] ${stage} stage failed:`, error);
    return json({ success: false, ...internalError(error, 'crime-data-ingest') }, 500);
  }
});
