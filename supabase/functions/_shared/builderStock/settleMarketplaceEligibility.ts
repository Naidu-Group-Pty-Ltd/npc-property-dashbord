/**
 * Builder stock — judging images that were stored before there was a judgement.
 *
 * Ingestion decides display eligibility as it writes each image, so everything
 * imported from now on arrives judged. This is for everything already in the
 * bucket: the same decision, from the same bytes, reached the same way.
 *
 * THE BYTES ARE RE-READ, NEVER RE-FETCHED AND NEVER REWRITTEN. The stored
 * object is downloaded, measured and put back untouched — the object, its
 * hashes and its provenance are exactly what they were. The only write is the
 * verdict, merged into `source_detail` beside the role rather than over it.
 *
 * It is budgeted and resumable in the same way the rest of the repair is: an
 * image already judged under the current version is skipped, so running it
 * again continues rather than repeats.
 */
import { STOCK_IMAGE_BUCKET } from './fileTypes.pure.ts';
import { assessMarketplaceEligibility } from './assessSourceImage.ts';
import {
  marketplaceEligibilityDetail, needsEligibilityAssessment,
} from './marketplaceEligibility.pure.ts';
import { isPrimaryRole, readStoredRole } from './sourceImageRole.pure.ts';
import { SOURCE_SUPPLIED_STAGE, SOURCE_SUPPLIED_VERIFICATION } from './primaryImage.ts';

export interface EligibilitySettlement {
  /** Images considered. */
  inspected: number;
  /** Images this run measured and wrote a verdict for. */
  assessed: number;
  /** Of those, how many may not be drawn on a card. */
  rejected: number;
  /** Images whose container nothing here can decode. Still displayable. */
  unmeasured: number;
  /** True when the budget ran out; run it again to continue. */
  incomplete: boolean;
}

/** Rows read in one pass. A cap, not a page size. */
const MAX_ROWS = 5000;

/**
 * Judge every unjudged primary an organisation holds.
 *
 * Only `primary_property` images are measured: nothing else can reach a card,
 * so a verdict for one would be an answer to a question never asked.
 */
export async function settleMarketplaceEligibility(
  db: any,
  organisationId: string,
  options: { deadlineAt?: number } = {},
): Promise<EligibilitySettlement> {
  const outcome: EligibilitySettlement = {
    inspected: 0, assessed: 0, rejected: 0, unmeasured: 0, incomplete: false,
  };

  const { data: rows } = await db
    .from('builder_stock_item_images')
    .select('id, storage_bucket, storage_path, source_detail')
    .eq('organisation_id', organisationId)
    .eq('source_stage', SOURCE_SUPPLIED_STAGE)
    .eq('verification_status', SOURCE_SUPPLIED_VERIFICATION)
    .eq('processing_status', 'ready')
    .limit(MAX_ROWS);

  for (const row of (rows ?? []) as Array<{
    id: string;
    storage_bucket: string | null;
    storage_path: string | null;
    source_detail: Record<string, unknown> | null;
  }>) {
    if (options.deadlineAt && Date.now() > options.deadlineAt) {
      outcome.incomplete = true;
      break;
    }
    if (!isPrimaryRole(readStoredRole(row.source_detail))) continue;
    if (!needsEligibilityAssessment(row.source_detail)) continue;
    if (!row.storage_path) continue;
    outcome.inspected += 1;

    const { data: blob, error } = await db.storage
      .from(row.storage_bucket || STOCK_IMAGE_BUCKET)
      .download(row.storage_path);
    if (error || !blob) continue;

    const eligibility = await assessMarketplaceEligibility(
      new Uint8Array(await blob.arrayBuffer()));

    await db.from('builder_stock_item_images')
      .update({
        source_detail: {
          ...(row.source_detail ?? {}),
          ...marketplaceEligibilityDetail(eligibility),
        },
      })
      .eq('id', row.id);

    outcome.assessed += 1;
    if (!eligibility.eligible) outcome.rejected += 1;
    if (!eligibility.measured) outcome.unmeasured += 1;
  }

  return outcome;
}
