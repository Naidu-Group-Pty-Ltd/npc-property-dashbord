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
 * every upload carries a settled-version marker, this brings the ones below
 * the current version up to it, and when none are left the migration's cron
 * job unschedules itself. Nothing here is on a read path and nothing runs when
 * there is no work.
 *
 * IT NOW CARRIES TWO KINDS OF WORK, UNDER TWO MARKERS. Provenance
 * (`source_images_settled_version`) is where a row's bytes came from and what
 * the source designated them as. Marketplace display eligibility
 * (`marketplace_eligibility_settled_version`) is whether the picture itself may
 * go on a card — a facade under a status ribbon answers every provenance
 * question correctly and is still not a card image. They are versioned apart on
 * purpose: improving the classifier must not re-fetch every Notion page, and
 * re-reading a source must not re-run a classifier that has not changed. An
 * upload behind on either is outstanding, and every upload written before the
 * fourth question existed is behind on the second one — which is what makes
 * this the thing that repairs production, with nobody pressing anything.
 *
 * WHAT IT MAY WRITE. `builder_stock_item_images` rows, the display verdict
 * inside their `source_detail`, the `primary_image_id` those rows earn, and the
 * two settlement markers. THE STORED IMAGE IS NEVER REWRITTEN: eligibility
 * re-READS each object to measure it, and no byte of any picture is altered,
 * cropped, blurred or replaced by anything. No stock item is created or
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
  readEligibilityTarget, readOutstandingUploads, runSettlementTick,
  settleUploadSourceImages,
  ELIGIBILITY_SETTLED_VERSION_COLUMN, SETTLED_VERSION_COLUMN,
  type SettlementCandidate,
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
/**
 * Outstanding uploads one tick asks the database for.
 *
 * Comfortably more than it can settle, so the tick always has the oldest work
 * in front of it, and bounded so a very large backlog drains over several ticks
 * rather than arriving in one response.
 */
const MAX_QUEUE_ROWS = 100;
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
     * The uploads with work outstanding, oldest source first.
     *
     * ASKED OF THE DATABASE, NOT FILTERED IN MEMORY. This used to read the
     * oldest 500 uploads and filter them here, which meant 500 settled uploads
     * were enough to hide every outstanding one behind them: the tick found
     * nothing, reported the queue empty, and the 501st was never reached.
     * `readOutstandingUploads` asks for the rows that are actually behind, so
     * the queue drains at 500 uploads and at 50,000.
     *
     * The eligibility version it selects against is the DATABASE's target, not
     * this build's constant — see `readEligibilityTarget`, which is what makes
     * a later classifier bump wake production rather than change nothing.
     */
    const eligibilityTarget = await readEligibilityTarget(supabase);
    const queue = await readOutstandingUploads(supabase, {
      limit: MAX_QUEUE_ROWS, eligibilityTarget,
    });

    if (queue.unavailable) {
      // The columns are missing: the migration has not applied yet. Nothing to
      // do, and saying so is better than sweeping every source every tick.
      console.warn('[builder-stock-image-settler] uploads not readable', {
        phase: 'settlement_scan',
      });
      return json({ success: true, settled: 0, remaining: 0, skipped: 'marker_unavailable' });
    }

    const outstanding = queue.rows;

    if (!outstanding.length) {
      // Quiet path. The migration's job unschedules itself on this.
      return json({
        success: true, settled: 0, remaining: 0, complete: true, eligibilityTarget,
      });
    }

    /**
     * The tick's own rule lives in the shared module, not here.
     *
     * It is the part with a defect worth pinning — the cap counts settlements
     * rather than attempts, so one upload that can never settle cannot starve
     * the queue behind it — and a rule inside a `Deno.serve` handler is a rule
     * nothing can test.
     */
    const { attempted, settled, organisations } = await runSettlementTick(
      outstanding.map((row): SettlementCandidate => ({
        id: String(row.id),
        organisation_id: String(row.organisation_id),
        needsProvenance:
          Number(row[SETTLED_VERSION_COLUMN] ?? 0) < PROVENANCE_VERSION,
        needsEligibility:
          Number(row[ELIGIBILITY_SETTLED_VERSION_COLUMN] ?? 0) < eligibilityTarget,
      })),
      { maxSettled: MAX_UPLOADS_PER_TICK, deadlineAt },
      (candidate) => settleUploadSourceImages(supabase, {
        organisationId: candidate.organisation_id,
        uploadId: candidate.id,
        deadlineAt,
        needsProvenance: candidate.needsProvenance,
        needsEligibility: candidate.needsEligibility,
      }),
    );

    /**
     * Every organisation this tick TOUCHED gets its primaries settled.
     *
     * A property whose source no longer designates an image must END this run
     * with no primary rather than the one it had under the old rules — and that
     * is true of properties the sweep never re-read, which is why it is applied
     * per organisation rather than per upload. The tick reports the ones it
     * actually reached rather than the ones it planned to.
     */
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
