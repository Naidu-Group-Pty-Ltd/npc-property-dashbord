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
  /**
   * Finished, and at least one of this row's documents was never actually
   * READ — we could not open it, or opening it failed.
   *
   * SEPARATE FROM `none_found` BECAUSE IT IS A DIFFERENT SENTENCE ABOUT A
   * DIFFERENT THING. `none_found` is a finding about the builder's document;
   * this is a fact about us reaching it. Collapsing the two is what told six
   * properties on the 7 September upload that their brochures contained no
   * photograph, when the brochures each hold a facade render that this same
   * extractor elects in about a second — the worker had died reading them and
   * the card reported that as the document's own answer.
   *
   * It never names a mechanism. A crash, a memory ceiling, a timeout and a
   * retry count are this pipeline's vocabulary and a builder can do nothing
   * with any of them; what they are owed is that the document has not been
   * read yet and that this is being retried.
   */
  | 'unreadable'
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
  /**
   * How many of this row's documents we FAILED to read — as opposed to read
   * and found nothing in. Supplied by the server, which is the only side that
   * can see why a branch stopped; the client is handed a count and never a
   * reason, so no mechanism can reach a screen through this field.
   */
  unreadDocuments?: number;
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
  if (input.sourceDocuments <= 0) return 'no_document';
  /*
   * A DOCUMENT WE NEVER READ IS NOT A DOCUMENT THAT SAID NOTHING, and this is
   * the one line that keeps those two apart on screen. Checked before
   * `none_found`, because a row where one document failed and the others were
   * read has NOT established that its documents name no picture.
   */
  const unread = Number(input.unreadDocuments ?? 0);
  if (Number.isFinite(unread) && unread > 0) return 'unreadable';
  return 'none_found';
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
  unreadable: 'Could not read a document',
  none_found: 'No picture in the supplied documents',
};

export const STOCK_IMAGE_PROGRESS_DETAIL: Record<StockImageProgress, string> = {
  drawn: 'This property has a picture on its card.',
  working: 'The documents on this row are being read now. '
    + 'This finishes on its own — the page updates when it does.',
  no_document: 'This stock list attaches no brochure or plan to this property. '
    + 'Add a link to its row and the photograph is read from it.',
  unreadable: 'One of the documents on this row could not be opened, so it has '
    + 'not been read yet. This is retried automatically. If it keeps saying '
    + 'this, check the link still opens and is shared, or add a picture with '
    + '“Add picture”.',
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

/**
 * How many of a row's documents we FAILED to read, from its stored provenance.
 *
 * THE ONE PLACE THAT LOOKS AT WHY A BRANCH STOPPED, and it is deliberately
 * server-side: the client is handed the resulting COUNT and never the reason,
 * so a mechanism — a kill, a memory ceiling, a timeout, an attempt tally —
 * has no route to a screen.
 *
 * Two shapes count as unread, and neither is the document answering:
 *
 *   a retirement stamped `operational`   we could not open it, or opening it
 *                                        destroyed the worker
 *   a bare attempt record                a step that started and never came
 *                                        back — the shape a kill leaves
 *
 * An `inspected` retirement is NOT counted: that one was read, and what it
 * says about the document is true.
 */
export function unreadDocumentCount(storedProvenance: unknown): number {
  const root = storedProvenance as { branches?: Record<string, unknown> } | null;
  const branches = root && typeof root === 'object' ? root.branches : null;
  if (!branches || typeof branches !== 'object') return 0;
  let unread = 0;
  for (const value of Object.values(branches)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as { result?: unknown; exhaustion?: unknown };
    if (record.result === 'package_recovery_attempt') { unread += 1; continue; }
    if (record.result === 'no_deterministic_image' && record.exhaustion === 'operational') {
      unread += 1;
    }
  }
  return unread;
}
