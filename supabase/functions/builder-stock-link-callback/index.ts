/**
 * BUILDER STOCK — THE GOOGLE SHEETS HYPERLINK RECOVERY CALLBACK.
 *
 * A Google Sheet whose owner has not enabled file export answers `/export`
 * with a sign-in page, and `/export` is the only public representation that
 * carries a cell's link target. So the brochure addresses behind cells reading
 * "Brochure", "Estate Brochure" or "Masterplan" never reach this product, and
 * stage 1 has nothing to open. The recovery is performed by a Make scenario
 * holding its own authorised Google connection, which reads the same sheet and
 * posts the targets here.
 *
 * THIS IS AN INBOUND WRITE PATH THAT DECIDES WHAT A CLIENT SEES ON A PROPERTY
 * CARD, and it is built accordingly.
 *
 *   THE CALLER CANNOT NAME ITS OWN AUTHORITY. The body carries a request id
 *   and grid data. Which organisation, which upload and therefore which
 *   properties may be touched are read from the row this product wrote when it
 *   asked. Forging the entire payload still reaches nothing, because nothing
 *   in the payload is consulted to decide whose stock is reachable.
 *
 *   A ROW IS MATCHED BY WHAT IT IS, NEVER BY WHERE IT SITS. Position, order
 *   and count are ignored entirely; each returned row goes through the same
 *   normalisation and property identity the import itself used. Exactly one
 *   match applies the link; zero or several discard it. It is better to lose a
 *   brochure than to put one on the wrong lot.
 *
 *   IT FAILS CLOSED AND WRITES NOTHING ON REFUSAL. Bad signature, stale
 *   timestamp, replay, expiry, a document that is not the one we asked about,
 *   an oversized body — each answers and stops.
 *
 * Nothing here decides anything about an image. A recovered URL is written
 * into the cell it came from and becomes an ordinary builder source; the
 * existing hierarchy, sanitisation, identity and role rules are untouched.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  MAX_CALLBACK_BYTES, callbackRefusal, mergeRecoveredLink, recoveredRowsFromGrid,
  signedPayload, timestampWithinSkew, type RecoveryRequestRecord,
} from '../_shared/builderStock/linkRecovery.pure.ts';
import { hmacHex } from '../_shared/builderStock/requestLinkRecovery.ts';
import {
  consumeRateLimit, enforceRawBodyLimit, securityJsonError,
} from '../_shared/requestSecurity.ts';
import { normaliseStockRow } from '../_shared/builderStock/normalise.pure.ts';
import {
  identityDifferences, stockPropertyIdentity,
} from '../_shared/builderStock/stockIdentity.pure.ts';

const REQUEST_TABLE = 'builder_stock_link_recovery_requests';

/** The columns a stored property needs for an identity comparison. */
const ITEM_COLUMNS = 'id, primary_image_id, source_row, development_name, project_name, '
  + 'address_line, suburb, state, postcode, lot_number, unit_number, building_size_sqm';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') return securityJsonError(400, 'method_not_allowed');

  const secret = (Deno.env.get('MAKE_SHEET_LINKS_SHARED_SECRET') ?? '').trim();
  if (!secret) return securityJsonError(503, 'recovery_not_configured');

  const bounded = await enforceRawBodyLimit(req, MAX_CALLBACK_BYTES);
  if (!bounded.ok) return bounded.error;
  const rawBody = bounded.raw;

  /*
   * FRESHNESS BEFORE AUTHENTICITY, and both before anything is parsed. The
   * timestamp is inside the signed string, so a replayed body with a fresh
   * timestamp does not verify and a replayed body with its own timestamp is
   * stale. Neither reaches the database.
   */
  const timestamp = req.headers.get('x-make-timestamp') ?? '';
  if (!timestampWithinSkew(timestamp, Date.now())) {
    return securityJsonError(401, 'stale_timestamp');
  }

  const presented = (req.headers.get('x-make-signature') ?? '').replace(/^v1=/, '');
  const expected = await hmacHex(secret, signedPayload(timestamp, rawBody));
  if (!constantTimeEquals(presented, expected)) {
    return securityJsonError(401, 'invalid_signature');
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return securityJsonError(400, 'malformed_payload');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : '';
  let request: RecoveryRequestRecord | null = null;
  if (/^[0-9a-f-]{36}$/i.test(requestId)) {
    const { data } = await supabase.from(REQUEST_TABLE)
      .select('id, organisation_id, upload_id, spreadsheet_id, gid, expires_at, consumed_at, status')
      .eq('id', requestId).maybeSingle();
    request = (data ?? null) as RecoveryRequestRecord | null;
  }

  const refusal = callbackRefusal(request, body, Date.now());
  if (refusal) {
    if (request) {
      await supabase.from(REQUEST_TABLE)
        .update({ status: 'refused', refusal_reason: refusal.code })
        .eq('id', request.id).is('consumed_at', null);
    }
    return jsonError(refusal.status, refusal.code);
  }
  const authority = request as RecoveryRequestRecord;

  /*
   * RATE LIMITED ON THE AUTHORITY WE RECOVERED, never on anything the caller
   * said. The key names the organisation from the stored row, so a flood of
   * forged bodies cannot exhaust another organisation's allowance.
   */
  const limit = await consumeRateLimit(
    supabase, `bs:link-recovery:${authority.organisation_id}`, 12, 600);
  if (!limit.allowed) return securityJsonError(429, 'rate_limited');

  /*
   * SINGLE-USE, CLAIMED BEFORE THE WORK. The conditional update is the replay
   * guard: a second caller presenting the same id finds nothing to claim and
   * is refused, whatever it carries.
   */
  const { data: claimed } = await supabase.from(REQUEST_TABLE)
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', authority.id).is('consumed_at', null)
    .select('id').maybeSingle();
  if (!claimed) return jsonError(409, 'request_already_consumed');

  const rows = recoveredRowsFromGrid(body.sheets, authority.gid ?? null);

  const { data: items } = await supabase.from('builder_stock_items')
    .select(ITEM_COLUMNS)
    .eq('organisation_id', authority.organisation_id)
    .or(`upload_id.eq.${authority.upload_id},pending_upload_id.eq.${authority.upload_id}`);

  const stored = (items ?? []) as unknown as Array<Record<string, unknown>>;
  const applied = await applyRecoveredLinks(supabase, stored, rows);

  await supabase.from(REQUEST_TABLE).update({
    status: 'fulfilled',
    rows_returned: rows.length,
    links_applied: applied.linksApplied,
    properties_reopened: applied.reopened,
  }).eq('id', authority.id);

  console.info('[builder-stock] link recovery applied', {
    phase: 'link_recovery_callback',
    request_id: authority.id,
    upload_id: authority.upload_id,
    rows_returned: rows.length,
    links_applied: applied.linksApplied,
    properties_reopened: applied.reopened,
    unmatched_rows: applied.unmatched,
  });

  return new Response(JSON.stringify({
    ok: true,
    rows_returned: rows.length,
    links_applied: applied.linksApplied,
    properties_reopened: applied.reopened,
  }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
});

/**
 * Attach each recovered target to the one property it belongs to.
 *
 * The match is `stockPropertyIdentity` over the SAME normalisation the import
 * used, compared with `identityDifferences` — the existing rule, imported
 * rather than re-implemented, so a row that would have matched at import time
 * matches here and nothing else does.
 */
async function applyRecoveredLinks(
  supabase: any,
  items: Array<Record<string, unknown>>,
  rows: ReturnType<typeof recoveredRowsFromGrid>,
): Promise<{ linksApplied: number; reopened: number; unmatched: number }> {
  const identities = items.map((item) => ({
    item, identity: stockPropertyIdentity(item as never),
  }));

  let linksApplied = 0;
  let unmatched = 0;
  const reopen: string[] = [];

  for (const row of rows) {
    if (!Object.keys(row.links).length) continue;

    const record = normaliseStockRow(row.values);
    if (!record) { unmatched += 1; continue; }
    const wanted = stockPropertyIdentity(record as never);

    const matches = identities.filter(
      (candidate) => identityDifferences(candidate.identity, wanted).length === 0);
    // FAIL CLOSED. Zero is a row we no longer hold; several is a row whose
    // identity does not distinguish it. Neither may receive a document.
    if (matches.length !== 1) { unmatched += 1; continue; }

    const target = matches[0].item;
    const sourceRow = (target.source_row ?? {}) as Record<string, unknown>;
    const unmapped = { ...((sourceRow.unmapped ?? {}) as Record<string, string>) };
    const recovered = new Set(
      Array.isArray(sourceRow.recovered_link_columns)
        ? (sourceRow.recovered_link_columns as string[]) : []);

    let changed = false;
    for (const [heading, url] of Object.entries(row.links)) {
      const merged = mergeRecoveredLink(unmapped[heading], url);
      if (merged === null) continue;
      unmapped[heading] = merged;
      recovered.add(heading);
      changed = true;
      linksApplied += 1;
    }
    if (!changed) continue;

    const { error } = await supabase.from('builder_stock_items').update({
      source_row: {
        ...sourceRow, unmapped, recovered_link_columns: Array.from(recovered).sort(),
      },
    }).eq('id', target.id);
    if (error) continue;

    /*
     * REOPENED ONLY WHERE THERE IS SOMETHING TO GAIN. A property already
     * holding a stage 1 image has its builder's own picture; re-running the
     * source stage for it would spend a claim to reach the same answer.
     */
    if (!target.primary_image_id) reopen.push(String(target.id));
  }

  let reopened = 0;
  if (reopen.length) {
    const { data } = await supabase.from('builder_stock_items').update({
      image_work_stage: 'source',
      enrichment_status: 'pending',
      image_work_claim_until: null,
      image_work_next_attempt_at: new Date().toISOString(),
      image_work_updated_at: new Date().toISOString(),
    }).in('id', reopen).select('id');
    reopened = ((data ?? []) as unknown[]).length;
  }

  return { linksApplied, reopened, unmatched };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: 'Invalid request', code }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
