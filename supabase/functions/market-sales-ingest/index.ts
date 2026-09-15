import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  QGSO_RLDA_LICENCE,
  QGSO_RLDA_PAGE_URL,
  QGSO_RLDA_SOURCE_LABEL,
  QGSO_SALES_SHEETS,
  discoverQgsoRldaSpreadsheet,
  parseQgsoRldaSales,
} from '../_shared/reports/market/openData/qgsoRldaSales.pure.ts';
import {
  NSW_DCJ_LICENCE,
  NSW_DCJ_PAGE_URL,
  NSW_DCJ_PREVIOUS_URL,
  NSW_DCJ_SOURCE_LABEL,
  chooseDcjSalesFiles,
  dcjSalesLinks,
  parseDcjSalesWorkbook,
} from '../_shared/reports/market/openData/nswDcjSales.pure.ts';
import { type SalesMedianRow, salesAreaToken } from '../_shared/reports/market/openData/salesRegister.pure.ts';

/**
 * Load the open-data sales registers into `market_sales_medians` — the
 * capital-growth evidence the Investment Grade reads where Domain's suburb
 * series is not held (docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md).
 *
 * This function IS the loader (the abs-regional-ingest pattern): both hosts
 * answer this project's egress directly, measured on 2026-09-15 through
 * pg_net (QGSO 200, 617,018 bytes; DCJ 200, 780,693 bytes), and a
 * workbook parsed here is the same workbook a person would download.
 *
 * Stages, one per publisher, re-invoked to refresh:
 *  - `qld`  — discovers the dated "all monitored regions" spreadsheet on the
 *    QGSO page (never a pinned URL: the file name carries its date and a
 *    pinned link goes stale silently), parses the four dwelling-sales sheets
 *    and upserts every LGA and regional quarter since 2008.
 *  - `nsw`  — lists the DCJ sales tables on the current and previous-reports
 *    pages, loads the newest quarter and the same quarter one, three, five
 *    and ten years earlier (the growth horizons), or the quarters named in
 *    `periods`. A workbook that refuses is recorded and the others still
 *    load; a run that loads nothing answers 422.
 *  - `probe` — asks whether both pages answer from here, and writes nothing.
 *
 * The parsers throw on header drift, vocabulary drift, a disagreeing
 * reporting period and an implausible shape, so a bad file refuses instead
 * of loading. Rows carry the data's own quarter; currency is read from the
 * data, never from loaded_at.
 *
 * Auth: the gateway JWT in front, and `verifyAuth` inside (the internal edge
 * secret or a verified service-role token — what `cron_service_role_headers()`
 * sends), so a scheduled or operator-run load and a browser cannot be told
 * apart by accident.
 */

const UA = 'npc-property-dashboard-market-sales-ingest';
const REFUSAL = /drift|refuse|fewer than|outside|not a quarter|no "|lists no|but the link named|not thousands|not a dollar|not a current file|quarters differ|answered \d{3}/i;

type Grid = unknown[][];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

async function fetchWorkbook(url: string): Promise<{ workbook: XLSX.WorkBook; bytes: number }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`${url} answered ${bytes.length} bytes that are not a workbook (no PK header) — refused`);
  }
  return { workbook: XLSX.read(bytes, { type: 'array' }), bytes: bytes.length };
}

function gridOf(workbook: XLSX.WorkBook, name: string): Grid | null {
  const sheet = workbook.Sheets[name];
  if (!sheet) return null;
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as Grid;
}

interface RegisterRecord {
  state: string;
  area_kind: string;
  area: string;
  area_token: string;
  dwelling_type: string;
  period: string;
  median_price: number | null;
  sales_count: number | null;
  source: string;
  source_url: string;
  licence: string;
  loaded_at: string;
}

function toRecords(rows: ReadonlyArray<SalesMedianRow>, source: string, sourceUrl: string, licence: string, loadedAt: string): RegisterRecord[] {
  return rows.map((r) => ({
    state: r.state,
    area_kind: r.areaKind,
    area: r.area,
    area_token: salesAreaToken(r.areaKind, r.area),
    dwelling_type: r.dwellingType,
    period: r.period,
    median_price: r.medianPrice,
    sales_count: r.salesCount,
    source,
    source_url: sourceUrl,
    licence,
    loaded_at: loadedAt,
  }));
}

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

// deno-lint-ignore no-explicit-any
async function upsertRecords(supabase: any, records: RegisterRecord[]): Promise<number> {
  let written = 0;
  for (const batch of chunk(records, 500)) {
    const { error } = await supabase
      .from('market_sales_medians')
      .upsert(batch, { onConflict: 'state,area_kind,area,dwelling_type,period' });
    if (error) throw new Error(`market_sales_medians upsert failed: ${error.message}`);
    written += batch.length;
  }
  return written;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'method_not_allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { error: authError } = await verifyAuth(supabase, req.headers, body);
  if (authError) return createUnauthorizedResponse(authError, corsHeaders);

  const stage = String(body.stage ?? '');
  const loadedAt = new Date().toISOString();

  try {
    if (stage === 'probe') {
      const answers: Record<string, unknown> = {};
      for (const [label, url] of [['qgso_page', QGSO_RLDA_PAGE_URL], ['dcj_page', NSW_DCJ_PAGE_URL], ['dcj_previous', NSW_DCJ_PREVIOUS_URL]] as const) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
          const text = await res.text();
          const extra = label === 'qgso_page'
            ? { spreadsheet: discoverQgsoRldaSpreadsheet(text) }
            : { salesTables: dcjSalesLinks(text).length };
          answers[label] = { status: res.status, bytes: text.length, ...extra };
        } catch (error) {
          answers[label] = { status: null, error: error instanceof Error ? error.message : String(error) };
        }
      }
      return json({ success: true, stage, answers, wrote: false });
    }

    if (stage === 'qld') {
      const page = await fetchText(QGSO_RLDA_PAGE_URL);
      const link = discoverQgsoRldaSpreadsheet(page);
      if (!link) throw new Error('the QGSO residential development page lists no "all monitored regions" spreadsheet — refused');
      console.log(`[market-sales-ingest] qld: downloading ${link.url} (as at ${link.asAt})`);
      const { workbook, bytes } = await fetchWorkbook(link.url);
      const sheets: Record<string, Grid> = {};
      for (const spec of QGSO_SALES_SHEETS) {
        const grid = gridOf(workbook, spec.name);
        if (grid) sheets[spec.name] = grid;
      }
      const parsed = parseQgsoRldaSales(sheets); // throws → nothing written
      const records = toRecords(parsed.rows, QGSO_RLDA_SOURCE_LABEL, link.url, QGSO_RLDA_LICENCE, loadedAt);
      const written = await upsertRecords(supabase, records);
      const detail = {
        stage, file: link.url, as_at: link.asAt, bytes, source: QGSO_RLDA_SOURCE_LABEL, licence: QGSO_RLDA_LICENCE,
        periods: parsed.periods.length, first_period: parsed.periods[0], latest_period: parsed.latestPeriod,
        lgas: parsed.lgas.length, regions: parsed.regions, rows_written: written,
      };
      await supabase.from('market_sales_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    if (stage === 'nsw') {
      const current = await fetchText(NSW_DCJ_PAGE_URL);
      let previous = '';
      try {
        previous = await fetchText(NSW_DCJ_PREVIOUS_URL);
      } catch (error) {
        console.warn('[market-sales-ingest] nsw: previous-reports page unavailable —', error instanceof Error ? error.message : String(error));
      }
      const links = dcjSalesLinks(current + previous);
      const choice = chooseDcjSalesFiles(links);
      if (!choice) throw new Error('the DCJ rent and sales pages list no sales tables — refused');
      const wanted = Array.isArray(body.periods)
        ? links.filter((l) => (body.periods as unknown[]).includes(l.period))
        : choice.chosen;
      const files: Array<Record<string, unknown>> = [];
      let written = 0;
      for (const link of wanted) {
        try {
          console.log(`[market-sales-ingest] nsw: downloading ${link.url} (${link.period})`);
          const { workbook, bytes } = await fetchWorkbook(link.url);
          const postcode = gridOf(workbook, 'Postcode');
          const lga = gridOf(workbook, 'LGA');
          if (!postcode || !lga) throw new Error(`${link.url}: workbook has no Postcode/LGA sheets (sheets: ${workbook.SheetNames.join(', ')}) — layout drift`);
          const parsed = parseDcjSalesWorkbook({ postcode, lga }, link.period);
          const records = toRecords(parsed.rows, NSW_DCJ_SOURCE_LABEL, link.url, NSW_DCJ_LICENCE, loadedAt);
          const n = await upsertRecords(supabase, records);
          written += n;
          files.push({ period: link.period, url: link.url, bytes, postcodes: parsed.postcodes, lgas: parsed.lgas, rows_written: n, reporting_period: parsed.reportingPeriodText });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[market-sales-ingest] nsw: ${link.period} refused — ${message}`);
          files.push({ period: link.period, url: link.url, refused: message });
        }
      }
      const detail = {
        stage, source: NSW_DCJ_SOURCE_LABEL, licence: NSW_DCJ_LICENCE, links_listed: links.length,
        latest_period: choice.latest.period, horizons: choice.horizons.map((h) => ({ years: h.years, period: h.period, available: h.link !== null })),
        files, rows_written: written,
      };
      await supabase.from('market_sales_sync').insert({ detail });
      if (written === 0) return json({ success: false, error: 'no DCJ workbook loaded', ...detail }, 422);
      return json({ success: true, ...detail });
    }

    return json({ success: false, error: 'stage must be "qld", "nsw" or "probe"' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[market-sales-ingest] ${stage} refused/failed:`, message);
    try {
      await supabase.from('market_sales_sync').insert({ detail: { stage, refused: message } });
    } catch { /* the refusal is already in the log */ }
    if (REFUSAL.test(message)) return json({ success: false, error: message }, 422);
    return json({ success: false, ...internalError(error, 'market-sales-ingest') }, 500);
  }
});
