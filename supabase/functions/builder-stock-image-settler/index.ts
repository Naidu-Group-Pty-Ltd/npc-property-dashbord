/**
 * Builder stock — bringing stock that is ALREADY imported up to the current
 * image rules, with nobody watching.
 *
 * WHY THIS EXISTS. Changing what counts as a property's primary image makes
 * every previously stored image row out of date by definition: it proves where
 * its bytes came from and says nothing about what the source presented them as.
 * The repair that fixes that has existed for a while and was only ever reachable
 * through a "Source images" button in the Builder Portal, one stock list at a
 * time. Asking a builder to press a button on every source they have ever
 * uploaded is not a deployment step; it is a defect with instructions.
 *
 * So this drives the SAME repair from pg_cron. It is a sweep, not a service:
 * every upload carries `source_images_settled_version`, this brings the ones
 * below the current version up to it, and when none are left the migration's
 * cron job unschedules itself. Nothing here is on a read path and nothing runs
 * when there is no work.
 *
 * WHAT IT MAY WRITE. `builder_stock_item_images` rows, the `primary_image_id`
 * those rows earn, and the settlement marker. No stock item is created or
 * deleted; no price, availability, configuration, status, selection, builder or
 * project/unit linkage is touched. Those guarantees are `repairSourceImages.ts`'s
 * and are not restated here — this only decides WHICH uploads it runs for.
 *
 * SECURITY. Internal callers only, through the signed envelope
 * (`verifyInternal`). It holds a service-role client and crosses organisations,
 * which is exactly why it must not be reachable by a portal session.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { enforceRawBodyLimit } from '../_shared/requestSecurity.ts';
import { internalErrorResponse } from '../_shared/errorResponse.ts';
import {
  settleUploadSourceImages, SETTLED_VERSION_COLUMN,
} from '../_shared/builderStock/settleSourceImages.ts';
import { PROVENANCE_VERSION } from '../_shared/builderStock/sourceImages.ts';
import { enforceStrictPrimaryImages } from '../_shared/builderStock/primaryImage.ts';

/*
 * The canonical headers, not a hand-rolled copy.
 *
 * The copy this replaces was a snapshot of the allowlist on the day it was
 * written: it was already missing `x-correlation-id` and `x-step-up-token`,
 * and it declared no `Access-Control-Expose-Headers` at all — so any custom
 * response header would have read back as `null`. A hand-rolled list can only
 * ever go stale, which is why `check-cors-contract.mjs` refuses one.
 *
 * `createCorsHeaders()` with no origin also drops the wildcard ACAO the copy
 * carried. This function holds a service-role client and crosses
 * organisations; `*` on it was wrong independently of the preflight.
 */
const corsHeaders = createCorsHeaders();

/** Wall clock for one tick, well inside the edge ceiling. */
const BUDGET_MS = 100_000;
/** Sources one tick may read. Resumable, so small is safe and slow is not. */
const MAX_UPLOADS_PER_TICK = 6;
const MAX_BODY_BYTES = 8 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const bounded = await enforceRawBodyLimit(req, MAX_BODY_BYTES);
  if (!bounded.ok) return bounded.error;
  const gate = await verifyInternal(supabase, req, bounded.raw);
  if (!gate.ok) {
    console.warn('[builder-stock-image-settler] verifyInternal denied', {
      errorCode: (gate as { errorCode?: string }).errorCode,
    });
    return json({ error: 'Forbidden' }, 403);
  }

  const startedAt = Date.now();
  const deadlineAt = startedAt + BUDGET_MS;

  try {
    /**
     * The organisations with work outstanding, oldest source first.
     *
     * Read straight off the uploads rather than from a queue table: the marker
     * IS the queue, so there is no second place for the two to disagree.
     */
    const { data: rows, error } = await supabase
      .from('builder_stock_uploads')
      .select(`id, organisation_id, ${SETTLED_VERSION_COLUMN}`)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) {
      // The column is missing: the migration has not applied yet. Nothing to
      // do, and saying so is better than sweeping every source every tick.
      console.warn('[builder-stock-image-settler] uploads not readable', {
        phase: 'settlement_scan',
        message: String(error.message ?? error).slice(0, 200),
      });
      return json({ success: true, settled: 0, remaining: 0, skipped: 'marker_unavailable' });
    }

    const outstanding = (rows ?? []).filter((row: Record<string, unknown>) =>
      Number(row[SETTLED_VERSION_COLUMN] ?? 0) < PROVENANCE_VERSION);

    if (!outstanding.length) {
      // Quiet path. The migration's job unschedules itself on this.
      return json({ success: true, settled: 0, remaining: 0, complete: true });
    }

    let settled = 0;
    let attempted = 0;
    for (const row of outstanding.slice(0, MAX_UPLOADS_PER_TICK)) {
      if (Date.now() > deadlineAt) break;
      attempted += 1;
      const outcome = await settleUploadSourceImages(supabase, {
        organisationId: String(row.organisation_id),
        uploadId: String(row.id),
        deadlineAt,
      });
      if (outcome.settled) settled += 1;
    }

    /**
     * Every organisation this tick touched gets its primaries settled.
     *
     * A property whose source no longer designates an image must END this run
     * with no primary rather than the one it had under the old rules — and that
     * is true of properties the sweep never re-read, which is why it is applied
     * per organisation rather than per upload.
     */
    const organisations = new Set(
      outstanding.slice(0, MAX_UPLOADS_PER_TICK).map((row) => String(row.organisation_id)));
    for (const organisationId of organisations) {
      try {
        await enforceStrictPrimaryImages(supabase, organisationId);
      } catch (enforceError) {
        console.warn('[builder-stock-image-settler] primaries not enforced', {
          organisation_id: organisationId,
          phase: 'primary_enforcement',
          message: String((enforceError as { message?: string })?.message ?? enforceError)
            .slice(0, 200),
        });
      }
    }

    const remaining = Math.max(0, outstanding.length - settled);
    console.log('[builder-stock-image-settler] tick', {
      attempted, settled, remaining, ms: Date.now() - startedAt,
    });
    return json({ success: true, settled, attempted, remaining, complete: remaining === 0 });
  } catch (error) {
    // `internalError` builds the BODY; the handler owes `Deno.serve` a
    // Response. Returning the body meant the sweep's only failure path
    // answered with something the runtime cannot serve — and the arguments
    // were transposed besides, so the headers were being logged as the
    // context and the context discarded as a correlation id.
    return internalErrorResponse(error, '[builder-stock-image-settler]', corsHeaders);
  }
});
