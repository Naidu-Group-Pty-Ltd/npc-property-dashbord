/**
 * Builder stock — what a property can HONESTLY say about its picture.
 *
 * THE REPORT, VERBATIM: "if there its running on the backend. There needs to
 * be some kind of indication to let the users know that its running on the
 * backend please wait or some kind of progress bar."
 *
 * PRODUCTION, 4 SEPTEMBER 2026. Three properties on one screen, all three
 * reading "No image yet", and no two of them for the same reason:
 *
 *   Lot 5629 The Grove   a package recovery was RUNNING, started 03:21
 *   Lot 521 Timbarra     four documents read, none presents a cover
 *   Lot 123 Solara       three documents read, one is an image not a package
 *
 * The first is work in flight and the words are a lie by omission — the row
 * looked exactly like a row nothing would ever happen to, so the honest thing
 * for a person to do was assume the product was broken and re-upload the list.
 * Which is what happened, twice, and re-uploading is what destroyed a repaired
 * photograph earlier the same morning.
 *
 * THE RULE. A row says "still looking" when the engine still owes it a stage,
 * and says the picture is not coming only when the engine has FINISHED and
 * come back with nothing. The two are different sentences because they call
 * for different actions: wait, or fix the row's documents.
 *
 * `settled` is the finished stage — the ladder's last rung — so anything else
 * is work outstanding. An unrecognised stage reads as WORKING rather than as
 * finished, because a stage this module has not been taught about is one the
 * engine may still act on, and promising "no picture is coming" about a row
 * the engine is about to photograph is the failure worth avoiding.
 *
 * Pure: no IO, no clock.
 */

/** The ladder's last rung. Everything before it is work outstanding. */
export const SETTLED_WORK_STAGE = 'settled';

export type StockImageProgress =
  /** A picture is on the card. Nothing is owed. */
  | 'drawn'
  /** The engine still owes this property a stage. Wait. */
  | 'working'
  /** Finished, and the row attaches no document to read a picture out of. */
  | 'no_document'
  /** Finished, the documents were read, and none of them names a picture. */
  | 'none_found';

export interface StockImageProgressInput {
  /** Whether the card has a picture to draw. */
  hasImage: boolean;
  /** How many readable documents this property's own row attaches. */
  sourceDocuments: number;
  /**
   * `image_work_stage`. Absent for a deployment whose projection predates
   * this — which reads as FINISHED, because that is how those rows behaved
   * before the field existed and inventing progress for them would be worse
   * than the silence it replaces.
   */
  workStage?: string | null;
}

/** What this property's imagery honestly amounts to right now. */
export function stockImageProgress(input: StockImageProgressInput): StockImageProgress {
  if (input.hasImage) return 'drawn';
  /*
   * A row with no stage at all is not "working". The field arrived with this
   * change, so an older projection would otherwise turn every pictureless row
   * on the page into a promise that something is about to happen.
   */
  const stage = typeof input.workStage === 'string' ? input.workStage.trim() : '';
  if (stage && stage !== SETTLED_WORK_STAGE) return 'working';
  return input.sourceDocuments > 0 ? 'none_found' : 'no_document';
}

/**
 * The words each state gets, and why they are these words.
 *
 * `working` never names a stage — "sanitization" and "eligibility" are this
 * pipeline's vocabulary, not a builder's, and a person waiting on a
 * photograph is owed the fact that it is coming rather than a term they would
 * have to look up. The two finished states each name the ACT that would
 * change them, because a status nobody can act on is just an apology.
 */
export const STOCK_IMAGE_PROGRESS_LABEL: Record<StockImageProgress, string> = {
  drawn: 'Image ready',
  working: 'Finding a picture…',
  no_document: 'No brochure on this row',
  none_found: 'No picture in the documents',
};

export const STOCK_IMAGE_PROGRESS_DETAIL: Record<StockImageProgress, string> = {
  drawn: 'This property has a picture on its card.',
  working: 'The documents on this row are being read now. '
    + 'This finishes on its own — the page updates when it does.',
  no_document: 'This stock list attaches no brochure or plan to this property. '
    + 'Add a link to its row and the photograph is read from it.',
  none_found: 'Every document on this row was read and none of them presents a '
    + "photograph of this property. Add a picture with “Add picture”, or link a "
    + 'brochure that shows the house.',
};

/** How many properties on a page are still being worked. */
export function countWorkingImages(
  items: readonly StockImageProgressInput[],
): number {
  return items.filter((item) => stockImageProgress(item) === 'working').length;
}

/**
 * The upload statuses that mean properties may still be ARRIVING.
 *
 * A replacement stock list writes its new properties invisible and publishes
 * them only once their imagery has been looked for — which is what stops a
 * marketplace filling with blank cards mid-import. The cost is a window in
 * which a list that detected 125 rows shows 95, with the other thirty staged
 * and unlistable, and nothing on the page accounting for the difference.
 *
 * That window is exactly where somebody concludes the import dropped their
 * rows and uploads the file again. It is the same missing sentence as a row
 * that says "No image yet" while being read, one level up.
 */
const ARRIVING_UPLOAD_STATUSES: readonly string[] = [
  'uploaded', 'parsing', 'imported', 'enriching',
];

/** Is this stock list still bringing properties in? */
export function uploadIsArriving(status: string | null | undefined): boolean {
  return ARRIVING_UPLOAD_STATUSES.includes(String(status ?? '').trim());
}

/** How many of these stock lists are still bringing properties in. */
export function countArrivingUploads(
  uploads: readonly { status?: string | null; deleted_at?: string | null }[],
): number {
  return uploads.filter(
    (upload) => !upload.deleted_at && uploadIsArriving(upload.status),
  ).length;
}
