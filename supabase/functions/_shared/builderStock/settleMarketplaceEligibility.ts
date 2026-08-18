/**
 * Builder stock — judging images that were stored before there was a judgement.
 *
 * Ingestion decides display eligibility as it writes each image, so everything
 * imported from now on arrives judged. This is for everything already in the
 * bucket: the same decision, from the same bytes, reached by the same
 * function.
 *
 * THE BYTES ARE RE-READ, NEVER RE-FETCHED AND NEVER REWRITTEN. The stored
 * object is downloaded, measured and left exactly as it was — the object, its
 * hashes and its provenance are untouched. The only write is the verdict,
 * merged into `source_detail` beside the role rather than over it.
 *
 * IT SCANS BY KEYSET, WHICH IS THE PART THAT HAS TO BE RIGHT. An earlier
 * version read the first 5,000 rows and filtered them in memory. Past 5,000
 * images an organisation would have re-read the same already-settled page on
 * every pass and never reached the rest — a sweep that cannot finish is worse
 * than no sweep, because it looks like one. Every pass here starts after the
 * last id it saw, so the scan advances whether or not a row needed work.
 */
import { STOCK_IMAGE_BUCKET } from './fileTypes.pure.ts';
import { assessMarketplaceEligibility } from './assessSourceImage.ts';
import {
  marketplaceEligibilityDetail, needsEligibilityAssessment,
} from './marketplaceEligibility.pure.ts';
import { isPrimaryRole, readStoredRole } from './sourceImageRole.pure.ts';
import { SOURCE_SUPPLIED_STAGE, SOURCE_SUPPLIED_VERIFICATION } from './primaryImage.ts';

export interface EligibilitySettlement {
  /** Rows the scan walked past. */
  scanned: number;
  /** Primary images that still needed a verdict. */
  outstanding: number;
  /** Of those, how many this run measured and wrote. */
  assessed: number;
  /** Of those, how many may not be drawn on a card. */
  rejected: number;
  /** Of those, how many no decoder here could read. Not displayable. */
  unmeasured: number;
  /** True when the budget ran out before the scan finished. */
  incomplete: boolean;
}

/** Rows read per keyset page. Small enough to stay inside any budget. */
const PAGE = 200;
/** A ceiling on pages per call, so one organisation cannot hold the worker. */
const MAX_PAGES = 200;

interface ImageRow {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  source_detail: Record<string, unknown> | null;
}

/**
 * Judge every unjudged primary, walking the whole table by id.
 *
 * Only `primary_property` images are measured: nothing else can reach a card,
 * so a verdict for one would answer a question nobody asked. The role filter
 * lives in JavaScript because the role is inside a JSON column, but the SCAN
 * does not — it is keyed on `id`, so a page full of non-primary rows still
 * advances the cursor.
 */
export async function settleMarketplaceEligibility(
  db: any,
  organisationId: string,
  options: { deadlineAt?: number; uploadId?: string | null } = {},
): Promise<EligibilitySettlement> {
  const outcome: EligibilitySettlement = {
    scanned: 0, outstanding: 0, assessed: 0, rejected: 0, unmeasured: 0, incomplete: false,
  };

  let after = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    if (options.deadlineAt && Date.now() > options.deadlineAt) {
      outcome.incomplete = true;
      return outcome;
    }

    let query = db
      .from('builder_stock_item_images')
      .select('id, storage_bucket, storage_path, source_detail')
      .eq('organisation_id', organisationId)
      .eq('source_stage', SOURCE_SUPPLIED_STAGE)
      .eq('verification_status', SOURCE_SUPPLIED_VERIFICATION)
      .eq('processing_status', 'ready')
      .order('id', { ascending: true })
      .limit(PAGE);
    if (options.uploadId) query = query.eq('upload_id', options.uploadId);
    if (after) query = query.gt('id', after);

    const { data, error } = await query;
    if (error) return outcome;
    const rows = (data ?? []) as ImageRow[];
    if (!rows.length) return outcome;

    for (const row of rows) {
      outcome.scanned += 1;
      // The cursor advances on EVERY row, settled or not. See the header.
      after = row.id;

      if (!isPrimaryRole(readStoredRole(row.source_detail))) continue;
      if (!needsEligibilityAssessment(row.source_detail)) continue;
      outcome.outstanding += 1;
      if (!row.storage_path) continue;

      if (options.deadlineAt && Date.now() > options.deadlineAt) {
        outcome.incomplete = true;
        return outcome;
      }

      const { data: blob, error: downloadError } = await db.storage
        .from(row.storage_bucket || STOCK_IMAGE_BUCKET)
        .download(row.storage_path);
      if (downloadError || !blob) continue;

      const eligibility = await assessMarketplaceEligibility(
        new Uint8Array(await blob.arrayBuffer()));

      const { error: writeError } = await db.from('builder_stock_item_images')
        .update({
          source_detail: {
            ...(row.source_detail ?? {}),
            ...marketplaceEligibilityDetail(eligibility),
          },
        })
        .eq('id', row.id);
      if (writeError) continue;

      outcome.assessed += 1;
      if (eligibility.state === 'ineligible') outcome.rejected += 1;
      if (!eligibility.measured) outcome.unmeasured += 1;
    }

    if (rows.length < PAGE) return outcome;
  }

  // The page ceiling, not the wall clock: there is more to do next time.
  outcome.incomplete = true;
  return outcome;
}
