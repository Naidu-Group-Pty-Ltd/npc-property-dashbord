import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalError } from '../_shared/errorResponse.ts';
import {
  GTFS_FEEDS, ZIP_TAIL_BYTES, feedByKey, findMember, memberDataStart,
  readZipDirectoryFromTail, type GtfsFeed, type ZipMember,
} from '../_shared/gtfsFeed.pure.ts';

/**
 * Load published GTFS feeds into `transport_stops` — the loader IS this
 * function, running where the egress lives (the `abs-poa-ingest` /
 * `crime-data-ingest` pattern, which is the sanctions-register lesson: a
 * loader that cannot reach its source from where it will actually run is a
 * loader that has never been tested).
 *
 * ## `probe` exists because reachability is a fact about THIS egress
 *
 * SALM is stalled in exactly this way: the file is published, and every
 * vantage this programme holds is refused at the IP level. Reaching a host
 * from a developer sandbox says nothing about the Edge Function that will run
 * the load, so `{"stage":"probe"}` asks the question from here — per feed, it
 * reports whether a range request was honoured, whether the zip's central
 * directory parses, and whether the member inflates to its declared size.
 * It writes nothing.
 *
 * Its answer is what decides whether a feed may be declared at all.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const UA = 'NPC-Property-Dashboard/1.0 (+reporting-engine; GTFS ingest)';

async function ranged(url: string, start: number, end: number): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'User-Agent': UA } });
  // A 200 to a Range request means the server is sending the WHOLE archive —
  // 279 MB for NSW. Refused rather than consumed: accepting it would exhaust
  // the function's memory instead of reporting that a source changed.
  if (r.status !== 206) {
    await r.body?.cancel();
    throw new Error(`range request not honoured: HTTP ${r.status}`);
  }
  return new Uint8Array(await r.arrayBuffer());
}

async function totalSize(url: string): Promise<number> {
  const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HEAD failed: HTTP ${r.status}`);
  const n = Number(r.headers.get('content-length'));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('no content-length — a chunked archive cannot be range-addressed');
  }
  return n;
}

async function inflate(bytes: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error(`compression method ${method} is neither stored nor deflate`);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Fetch one named member and return its bytes, or throw naming the reason. */
async function readMember(feed: GtfsFeed, name: string): Promise<{ bytes: Uint8Array; member: ZipMember; total: number }> {
  const total = await totalSize(feed.url);
  const tail = await ranged(feed.url, Math.max(0, total - ZIP_TAIL_BYTES), total - 1);
  const members = readZipDirectoryFromTail(tail, total);
  const member = findMember(members, name);
  if (!member) throw new Error(`archive has no ${name} (members: ${members.map((m) => m.name).join(', ')})`);
  const lh = await ranged(feed.url, member.localHeaderOffset, member.localHeaderOffset + 29);
  const dataStart = memberDataStart(lh, member.localHeaderOffset);
  const comp = await ranged(feed.url, dataStart, dataStart + member.compressedSize - 1);
  const bytes = await inflate(comp, member.method);
  // The declared size is the archive's own checksum on our arithmetic: an
  // off-by-n in the local-header skip inflates to something plausible-looking
  // rather than failing, and this is what catches it.
  if (bytes.length !== member.uncompressedSize) {
    throw new Error(`${name} inflated to ${bytes.length} bytes, archive declares ${member.uncompressedSize}`);
  }
  return { bytes, member, total };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: Record<string, unknown> = {};
  try { body = JSON.parse(await req.text()); } catch { /* defaults below */ }
  const stage = String(body?.stage ?? 'probe');

  const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorised = internalSecret !== '' && bearer === internalSecret;

  // The bootstrap arm is PER FEED, for the reason the crime ingest's is per
  // STATE: a whole-table emptiness gate seals on the first feed loaded and
  // locks every remaining feed out of its own first load.
  if (!authorised) {
    const { count, error } = await supabase
      .from('transport_feed_syncs')
      .select('id', { count: 'exact', head: true });
    if (!error && (count ?? 0) === 0) {
      console.log('[transport-gtfs-ingest] bootstrap arm: no feed loads recorded yet, permitted');
      authorised = true;
    }
  }
  if (!authorised) return json({ success: false, error: 'forbidden' }, 403);

  try {
    if (stage === 'probe') {
      // Reads nothing and writes nothing. Its whole job is to answer whether
      // this egress can address these archives at all.
      const results = [];
      for (const feed of GTFS_FEEDS) {
        const started = Date.now();
        try {
          const { bytes, member, total } = await readMember(feed, 'stops.txt');
          const firstLine = new TextDecoder().decode(bytes.subarray(0, 600)).split('\n')[0].replace(/^\uFEFF/, '').trim();
          results.push({
            feed: feed.key,
            reachable: true,
            totalBytes: total,
            fetchedBytes: member.compressedSize,
            fetchedPercent: Number((100 * member.compressedSize / total).toFixed(3)),
            inflatedBytes: bytes.length,
            header: firstLine,
            ms: Date.now() - started,
          });
        } catch (e) {
          results.push({ feed: feed.key, reachable: false, reason: (e as Error).message, ms: Date.now() - started });
        }
      }
      return json({ success: true, stage: 'probe', wrote: false, results });
    }

    const feed = feedByKey(stage);
    if (!feed) return json({ success: false, error: 'unknown_stage', stage }, 400);
    return json({ success: false, error: 'load_not_implemented', stage: feed.key }, 501);
  } catch (e) {
    console.error('[transport-gtfs-ingest] failed:', e);
    return json({ success: false, ...internalError(e, 'transport-gtfs-ingest') }, 500);
  }
});
