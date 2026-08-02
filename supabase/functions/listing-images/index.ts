import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createForbiddenResponse,
  createUnauthorizedResponse,
  createCorsHeaders,
} from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  enforceActorQuota,
  enforceGlobalDailyQuota,
  enforceIpQuota,
  fetchWithTimeout,
  getClientIp,
  killSwitchActive,
  redactError,
} from '../_shared/publicAbuseControls.ts';
import { assertPublicUrl } from '../_shared/ssrfGuard.ts';
import {
  imageSetFingerprint,
  isRefreshDue,
  nextRefreshAt,
  normaliseImageCandidates,
  imageIdentity,
  type ImageCandidate,
  type ImageOrigin,
} from '../_shared/listingImages.pure.ts';

/**
 * Listing image library.
 *
 * A property photo's source URL is not storage. Airtable signs attachment URLs
 * and expires them within hours; portal hotlinks die when the listing is
 * withdrawn. Anything that has to survive — a card, a map popup, a generated
 * report — needs a copy we own. This function makes and maintains that copy.
 *
 *   op: 'resolve'  (a signed-in user) — hand back signed URLs for a batch of
 *                  listings, harvesting anything missing or stale inline, up to
 *                  a bounded budget per request.
 *   op: 'refresh'  (service role, hourly cron) — sweep listings whose
 *                  `refresh_after` has come round, re-read them from Airtable,
 *                  and re-harvest only what actually changed.
 *   op: 'sync'     (service role) — push the durable URLs back into Airtable so
 *                  the enrichment column stays current for downstream consumers.
 *
 * The bytes live in the private `listing-images` bucket. The browser only ever
 * receives short-lived signed URLs, never a bucket path and never a source URL.
 */

const BUCKET = 'listing-images';
const CIRCUIT_SCOPE = 'listing_image_harvest';

/** Per-listing ceiling. Agents upload 40+ photos; a card needs a handful. */
const MAX_IMAGES_PER_LISTING = 12;
/** Refuse anything that is not plausibly a web-sized photo. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_IMAGE_BYTES = 512;
/** Listings accepted in one `resolve` call. */
const MAX_BATCH = 120;
/** Listings actually harvested in one `resolve` call — the rest come back pending. */
const MAX_HARVESTS_PER_REQUEST = 6;
/** Listings claimed by one cron sweep. */
const MAX_HARVESTS_PER_SWEEP = 40;
/** How long a handed-out signed URL stays valid. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

interface ListingInput {
  id: string;
  images?: unknown;
  listedAt?: string | number | null;
}

interface StoredImageRow {
  listing_id: string;
  image_identity: string;
  storage_path: string | null;
  origin: ImageOrigin;
  position: number;
  status: string;
  width: number | null;
  height: number | null;
}

const dnsResolver = async (hostname: string, recordType: 'A' | 'AAAA'): Promise<string[]> => {
  try {
    return await Deno.resolveDns(hostname, recordType);
  } catch {
    return [];
  }
};

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Airtable record ids are `rec` + 14 url-safe chars; be permissive but bounded.
  return /^[A-Za-z0-9_-]{3,64}$/.test(trimmed) ? trimmed : null;
}

function epochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deterministic bucket path.
 *
 * Derived from the listing and the image identity rather than from a random id,
 * so re-harvesting the same photo overwrites in place instead of orphaning the
 * previous object. Storage stays proportional to the number of photos, not to
 * the number of refresh passes that have ever run.
 */
async function storagePathFor(
  listingId: string,
  identity: string,
  contentType: string,
): Promise<string> {
  const digest = (await sha256Hex(new TextEncoder().encode(identity))).slice(0, 32);
  const extension = EXTENSION_BY_TYPE[contentType] ?? 'jpg';
  return `${listingId}/${digest}.${extension}`;
}

/**
 * Fetches one candidate's bytes, refusing anything that is not a bounded image.
 *
 * The URL comes from caller-supplied data, so it goes through the SSRF guard
 * before any request leaves the runtime. The bytes are never returned to the
 * caller — they only ever go into the bucket — so this cannot be used to read a
 * response back out.
 */
async function fetchImageBytes(
  candidate: ImageCandidate,
): Promise<{ bytes: Uint8Array; contentType: string } | { error: string }> {
  let safeUrl: URL;
  try {
    safeUrl = await assertPublicUrl(candidate.url, dnsResolver);
  } catch (error) {
    return { error: `blocked_url: ${redactError(error)}` };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      safeUrl.toString(),
      { headers: { Accept: 'image/*' }, redirect: 'follow' },
      10_000,
    );
  } catch (error) {
    return { error: `fetch_failed: ${redactError(error)}` };
  }

  if (!response.ok) return { error: `http_${response.status}` };

  const contentType = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    // Drain so the connection is not left hanging on a rejected response.
    await response.body?.cancel();
    return { error: `unsupported_type: ${contentType || 'unknown'}` };
  }

  // Trust `content-length` as a cheap pre-check, but still bound the read: a
  // missing or lying header must not be able to stream us out of memory.
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    return { error: 'too_large' };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { error: 'too_large' };
  if (bytes.byteLength < MIN_IMAGE_BYTES) return { error: 'too_small' };

  return { bytes, contentType };
}

interface HarvestOutcome {
  stored: number;
  failed: number;
  fingerprint: string;
  error: string | null;
}

/**
 * Brings one listing's stored set in line with its current candidates.
 *
 * Photos whose checksum is unchanged are left completely alone — no upload, no
 * row rewrite — which is what makes an hourly sweep affordable. Photos that
 * have disappeared from the source are marked `gone` rather than deleted, so a
 * report generated last quarter still resolves the image it referenced.
 */
async function harvestListing(
  supabase: ReturnType<typeof createClient>,
  listingId: string,
  candidates: ImageCandidate[],
  listedAt: number | null,
): Promise<HarvestOutcome> {
  const capped = candidates.slice(0, MAX_IMAGES_PER_LISTING);
  const fingerprint = imageSetFingerprint(capped);
  const now = Date.now();

  const { data: existingRows } = await supabase
    .from('listing_images')
    .select('image_identity, checksum, status, storage_path')
    .eq('listing_id', listingId);

  const existing = new Map<string, { checksum: string | null; status: string }>();
  for (const row of (existingRows ?? []) as Array<{
    image_identity: string;
    checksum: string | null;
    status: string;
  }>) {
    existing.set(row.image_identity, { checksum: row.checksum, status: row.status });
  }

  let stored = 0;
  let failed = 0;
  let firstError: string | null = null;
  const seen = new Set<string>();

  for (let position = 0; position < capped.length; position += 1) {
    const candidate = capped[position];
    const identity = imageIdentity(candidate);
    seen.add(identity);

    const prior = existing.get(identity);
    // Already stored and unchanged: re-assert position only. This is the path
    // the overwhelming majority of refresh passes take.
    if (prior?.status === 'stored') {
      await supabase
        .from('listing_images')
        .update({ position, last_verified_at: new Date(now).toISOString() })
        .eq('listing_id', listingId)
        .eq('image_identity', identity);
      stored += 1;
      continue;
    }

    const fetched = await fetchImageBytes(candidate);
    if ('error' in fetched) {
      failed += 1;
      firstError ??= fetched.error;
      await supabase.from('listing_images').upsert(
        {
          listing_id: listingId,
          image_identity: identity,
          origin: candidate.origin,
          position,
          status: 'failed',
          source_url: candidate.url.slice(0, 2048),
          last_verified_at: new Date(now).toISOString(),
          last_error: fetched.error.slice(0, 500),
          error_count: 1,
        },
        { onConflict: 'listing_id,image_identity' },
      );
      continue;
    }

    const checksum = await sha256Hex(fetched.bytes);
    const path = await storagePathFor(listingId, identity, fetched.contentType);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, fetched.bytes, { contentType: fetched.contentType, upsert: true });

    if (uploadError) {
      failed += 1;
      firstError ??= `upload_failed: ${uploadError.message}`;
      continue;
    }

    const { error: rowError } = await supabase.from('listing_images').upsert(
      {
        listing_id: listingId,
        image_identity: identity,
        storage_path: path,
        origin: candidate.origin,
        position,
        status: 'stored',
        content_type: fetched.contentType,
        bytes: fetched.bytes.byteLength,
        width: candidate.width ?? null,
        height: candidate.height ?? null,
        checksum,
        source_url: candidate.url.slice(0, 2048),
        last_verified_at: new Date(now).toISOString(),
        error_count: 0,
        last_error: null,
      },
      { onConflict: 'listing_id,image_identity' },
    );

    if (rowError) {
      failed += 1;
      firstError ??= `row_failed: ${rowError.message}`;
      continue;
    }
    stored += 1;
  }

  // Retire anything the source no longer offers. Marked, not deleted: a report
  // rendered months ago may still reference it.
  const vanished = Array.from(existing.keys()).filter((identity) => !seen.has(identity));
  if (vanished.length > 0) {
    await supabase
      .from('listing_images')
      .update({ status: 'gone', last_verified_at: new Date(now).toISOString() })
      .eq('listing_id', listingId)
      .in('image_identity', vanished);
  }

  const errorCount = stored === 0 && failed > 0 ? 1 : 0;
  await supabase.from('listing_image_sets').upsert(
    {
      listing_id: listingId,
      fingerprint,
      image_count: capped.length,
      stored_count: stored,
      listed_at: listedAt ? new Date(listedAt).toISOString() : null,
      last_harvested_at: new Date(now).toISOString(),
      refresh_after: new Date(nextRefreshAt({ listedAt, errorCount, now })).toISOString(),
      error_count: errorCount,
      last_error: firstError ? firstError.slice(0, 500) : null,
    },
    { onConflict: 'listing_id' },
  );

  return { stored, failed, fingerprint, error: firstError };
}

/** Signs every stored image for the requested listings. */
async function signStoredImages(
  supabase: ReturnType<typeof createClient>,
  listingIds: string[],
): Promise<Record<string, Array<Record<string, unknown>>>> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  if (listingIds.length === 0) return out;

  const { data } = await supabase
    .from('listing_images')
    .select('listing_id, image_identity, storage_path, origin, position, status, width, height')
    .in('listing_id', listingIds)
    .eq('status', 'stored')
    .order('position', { ascending: true });

  const rows = (data ?? []) as StoredImageRow[];
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return out;

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
  for (const row of rows) {
    const url = row.storage_path ? urlByPath.get(row.storage_path) : undefined;
    if (!url) continue;
    (out[row.listing_id] ??= []).push({
      url,
      position: row.position,
      origin: row.origin,
      width: row.width,
      height: row.height,
      expiresAt,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Airtable                                                                    */
/* -------------------------------------------------------------------------- */

interface AirtableConfig {
  token: string;
  baseId: string;
  table: string;
  field: string;
}

function airtableConfig(): AirtableConfig | null {
  const token = Deno.env.get('AIRTABLE_TOKEN');
  const baseId = Deno.env.get('AIRTABLE_BASE_ID');
  const table = Deno.env.get('AIRTABLE_TABLE_NAME');
  // The enrichment column is named per base, so it is configuration rather than
  // a constant. Without it the write-back is skipped, not guessed.
  const field = Deno.env.get('AIRTABLE_IMAGE_LIBRARY_FIELD');
  if (!token || !baseId || !table || !field) return null;
  return { token, baseId, table, field };
}

/** Reads the image field for a batch of records during a cron sweep. */
async function readAirtableImages(
  config: AirtableConfig,
  listingIds: string[],
): Promise<Map<string, { images: unknown; listedAt: number | null }>> {
  const out = new Map<string, { images: unknown; listedAt: number | null }>();
  const formula = `OR(${listingIds.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
  const url =
    `https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(config.table)}` +
    `?filterByFormula=${encodeURIComponent(formula)}&pageSize=${listingIds.length}`;

  const response = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${config.token}` } },
    12_000,
  );
  if (!response.ok) throw new Error(`airtable_read_${response.status}`);

  const payload = (await response.json()) as {
    records?: Array<{ id: string; fields?: Record<string, unknown>; createdTime?: string }>;
  };
  for (const record of payload.records ?? []) {
    const fields = record.fields ?? {};
    out.set(record.id, {
      images: fields.Images ?? fields.Property_Images ?? fields.images ?? [],
      listedAt:
        epochMs(fields.Listed_Date) ??
        epochMs(fields.Date_Listed) ??
        epochMs(fields.ReceivedAt) ??
        epochMs(record.createdTime),
    });
  }
  return out;
}

/**
 * Writes the durable URLs back into the Airtable enrichment column.
 *
 * The values written are long-lived signed URLs into our own bucket, so what
 * lands in Airtable is genuinely usable by anything reading the base — which is
 * the point of enriching it. Airtable caps a batch at 10 records.
 */
async function syncAirtable(
  supabase: ReturnType<typeof createClient>,
  config: AirtableConfig,
  listingIds: string[],
): Promise<{ synced: number; error: string | null }> {
  if (listingIds.length === 0) return { synced: 0, error: null };

  const signedByListing = await signStoredImages(supabase, listingIds);
  const records = listingIds
    .map((id) => ({
      id,
      fields: {
        [config.field]: (signedByListing[id] ?? [])
          .map((image) => String(image.url))
          .join('\n'),
      },
    }))
    .filter((record) => record.fields[config.field].length > 0);

  let synced = 0;
  let error: string | null = null;

  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    try {
      const response = await fetchWithTimeout(
        `https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(config.table)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: chunk, typecast: true }),
        },
        12_000,
      );
      if (!response.ok) {
        error ??= `airtable_write_${response.status}`;
        continue;
      }
      synced += chunk.length;
      const stamped = new Date().toISOString();
      for (const record of chunk) {
        await supabase
          .from('listing_image_sets')
          .update({ airtable_synced_at: stamped })
          .eq('listing_id', record.id);
      }
    } catch (e) {
      error ??= redactError(e);
    }
  }

  return { synced, error };
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const j = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const op = typeof body.op === 'string' ? body.op : 'resolve';

    if (killSwitchActive('LISTING_IMAGES_KILL_SWITCH')) {
      return j({ success: false, error: 'temporarily_unavailable' }, 503);
    }

    /* -- Cron / service-role operations ---------------------------------- */
    if (op === 'refresh' || op === 'sync') {
      // These carry no user; they are only reachable with the service-role key,
      // which cron holds and a browser never does.
      const authHeader = req.headers.get('authorization') || '';
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
        return createUnauthorizedResponse('Service role required', corsHeaders);
      }

      const config = airtableConfig();
      if (!config) {
        return j({ success: false, error: 'airtable_not_configured' }, 500);
      }

      const limit = Math.min(
        MAX_HARVESTS_PER_SWEEP,
        Math.max(1, Number(body.limit) || MAX_HARVESTS_PER_SWEEP),
      );

      if (op === 'sync') {
        const { data: drifted } = await supabase
          .from('listing_image_sets')
          .select('listing_id')
          .gt('stored_count', 0)
          .order('airtable_synced_at', { ascending: true, nullsFirst: true })
          .limit(limit);
        const ids = (drifted ?? []).map((r: { listing_id: string }) => r.listing_id);
        const result = await syncAirtable(supabase, config, ids);
        return j({ success: true, op, considered: ids.length, ...result });
      }

      const { data: due } = await supabase
        .from('listing_image_sets')
        .select('listing_id, refresh_after, fingerprint')
        .lte('refresh_after', new Date().toISOString())
        .order('refresh_after', { ascending: true })
        .limit(limit);

      const dueIds = (due ?? []).map((r: { listing_id: string }) => r.listing_id);
      if (dueIds.length === 0) return j({ success: true, op, claimed: 0, harvested: 0 });

      let harvested = 0;
      let unchanged = 0;
      let errors = 0;
      try {
        const fresh = await readAirtableImages(config, dueIds);
        const priorFingerprints = new Map(
          (due ?? []).map((r: { listing_id: string; fingerprint: string | null }) => [
            r.listing_id,
            r.fingerprint,
          ]),
        );

        for (const listingId of dueIds) {
          const record = fresh.get(listingId);
          if (!record) {
            // The record is gone from Airtable. Push it far out rather than
            // retrying it every hour forever.
            await supabase
              .from('listing_image_sets')
              .update({
                refresh_after: new Date(
                  nextRefreshAt({ listedAt: null, errorCount: 4, now: Date.now() }),
                ).toISOString(),
                last_error: 'record_not_found',
              })
              .eq('listing_id', listingId);
            continue;
          }

          const candidates = normaliseImageCandidates(record.images, 'airtable');
          const fingerprint = imageSetFingerprint(candidates.slice(0, MAX_IMAGES_PER_LISTING));

          if (fingerprint === priorFingerprints.get(listingId)) {
            // Nothing changed upstream: re-arm the schedule without touching a
            // single byte. This is the case that makes hourly sweeps cheap.
            unchanged += 1;
            await supabase
              .from('listing_image_sets')
              .update({
                last_harvested_at: new Date().toISOString(),
                refresh_after: new Date(
                  nextRefreshAt({ listedAt: record.listedAt, now: Date.now() }),
                ).toISOString(),
              })
              .eq('listing_id', listingId);
            continue;
          }

          const outcome = await harvestListing(supabase, listingId, candidates, record.listedAt);
          harvested += 1;
          if (outcome.error) errors += 1;
        }
      } catch (e) {
        return j({ success: false, op, error: redactError(e) }, 502);
      }

      return j({ success: true, op, claimed: dueIds.length, harvested, unchanged, errors });
    }

    /* -- User-facing resolve --------------------------------------------- */
    const { error: authError, userId, authMethod } = await verifyAuth(
      supabase,
      req.headers,
      body as { session_token?: string },
    );
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }
    const permission = await requireModulePermission(
      supabase,
      { userId, authMethod },
      'listings',
      'can_view',
    );
    if (!permission.ok) {
      return createForbiddenResponse(permission.error || 'Listings access required', corsHeaders);
    }

    const actorQuota = await enforceActorQuota(supabase, userId, CIRCUIT_SCOPE, {
      limit: 40,
      windowMs: 60_000,
    });
    const ipQuota = await enforceIpQuota(supabase, getClientIp(req), CIRCUIT_SCOPE, {
      limit: 80,
      windowMs: 60_000,
    });
    if (!actorQuota.ok || !ipQuota.ok) return j({ success: false, error: 'rate_limited' }, 429);

    const globalQuota = await enforceGlobalDailyQuota(supabase, CIRCUIT_SCOPE, 20_000);
    if (!globalQuota.ok) return j({ success: false, error: 'temporarily_unavailable' }, 503);

    const rawListings = Array.isArray(body.listings) ? body.listings : [];
    const listings: ListingInput[] = [];
    for (const raw of rawListings.slice(0, MAX_BATCH)) {
      const entry = raw as ListingInput;
      const id = cleanId(entry?.id);
      if (!id) continue;
      listings.push({ id, images: entry.images, listedAt: entry.listedAt ?? null });
    }
    if (listings.length === 0) return j({ success: true, images: {}, pending: [] });

    const ids = listings.map((l) => l.id);

    const { data: sets } = await supabase
      .from('listing_image_sets')
      .select('listing_id, fingerprint, refresh_after')
      .in('listing_id', ids);

    const stateById = new Map(
      ((sets ?? []) as Array<{
        listing_id: string;
        fingerprint: string | null;
        refresh_after: string | null;
      }>).map((row) => [row.listing_id, row]),
    );

    const now = Date.now();
    const pending: string[] = [];
    let budget = MAX_HARVESTS_PER_REQUEST;

    for (const listing of listings) {
      const candidates = normaliseImageCandidates(listing.images, 'airtable');
      if (candidates.length === 0) continue;

      const fingerprint = imageSetFingerprint(candidates.slice(0, MAX_IMAGES_PER_LISTING));
      const state = stateById.get(listing.id);
      const due =
        !state ||
        state.fingerprint !== fingerprint ||
        isRefreshDue(state.refresh_after ? Date.parse(state.refresh_after) : null, now);

      if (!due) continue;
      if (budget <= 0) {
        // Over budget for this request. The caller polls, and the hourly sweep
        // will pick these up regardless — never silently drop them.
        pending.push(listing.id);
        continue;
      }
      budget -= 1;
      await harvestListing(supabase, listing.id, candidates, epochMs(listing.listedAt));
    }

    const images = await signStoredImages(supabase, ids);
    return j({ success: true, images, pending });
  } catch (error) {
    console.error('[listing-images] unhandled', redactError(error));
    return j({ success: false, error: 'internal_error' }, 500);
  }
});
