/**
 * Builder stock — the record of a cleaned copy, and the rules for serving it.
 *
 * A sanitized derivative is a SECOND set of bytes made from ONE set of bytes:
 * the builder's own primary image for that exact property, with a graphic that
 * was laid over it removed. It is not a replacement and it is not an
 * alternative image. Nothing else is ever an input, and this module exists so
 * that claim is checkable rather than merely intended — every record names the
 * exact original by id and by SHA-256, and a derivative whose provenance does
 * not tie back to the bytes currently in the row is not served.
 *
 * IT IS STORED BESIDE THE ORIGINAL VERDICT, NEVER OVER IT. The original stays
 * `ineligible / annotated_marketing_tile`, because that is the truth about the
 * builder's file and overwriting it would erase the reason the derivative
 * exists. What changes is one extra fact — this record — and the display rule
 * reads both: a card may draw the original when it is eligible, or the frozen
 * derivative when one has been made and passed. Nothing else, ever.
 *
 * A FAILURE IS RECORDED TOO, AND IT IS NOT A DERIVATIVE. Where a repair was
 * attempted and refused — by the deterministic gates, by the validation gate,
 * or by the endpoint — that is written as a failure, under its own key, and the
 * card goes on showing nothing. No other image takes its place. The failure is
 * terminal for the version that produced it for exactly the reason the
 * eligibility verdict is: retrying identical work every five minutes for ever
 * is what the settlement programme spent a fortnight undoing.
 *
 * Pure: no imports, no IO, no clock.
 */

/**
 * Bumped when a repair would come out differently for bytes already handled.
 *
 * ONE NUMBER FOR THE WHOLE STAGE, covering both routes. A record names which
 * route made it, but "is this record stale" is one question and must have one
 * answer: two counters would let a deterministic derivative be current while a
 * generative one from the same run was not, and nothing downstream could say
 * which of the two a card was showing.
 *
 * Deliberately not `MARKETPLACE_ELIGIBILITY_VERSION` and deliberately not
 * `PROVENANCE_VERSION`. Whether a picture may be drawn, where its bytes came
 * from, and how well a graphic can be taken off it are three questions that
 * improve on three different days.
 *
 *   1  first release: Laplace reconstruction for small quiet patches, masked
 *      generative inpainting for the rest, both gated on the same detector
 */
export const SANITIZATION_VERSION = 1;

/** Where the record lives inside `source_detail`. */
export const DERIVATIVE_KEY = 'sanitized_derivative';
/** And where a refusal does. Never the same key: they are not the same fact. */
export const FAILURE_KEY = 'sanitization_failure';

/**
 * How the overlay was taken off.
 *
 * Two routes and no third. The first is arithmetic — it has no model, no
 * network and no randomness, and the same bytes always produce the same bytes.
 * The second asks a model to reconstruct what was behind the mask, and is
 * reached ONLY where the first refuses.
 */
export type SanitizationTransformation =
  | 'deterministic_overlay_reconstruction'
  | 'generative_overlay_inpaint';

export interface SanitizedDerivative {
  transformation: SanitizationTransformation;
  sanitization_version: number;

  /* ---- the exact original, named twice ---- */
  /** The `builder_stock_item_images` row the bytes were read from. */
  original_image_id: string;
  /** And the bytes themselves. A row whose object changed invalidates this. */
  original_sha256: string;
  stock_item_id: string;
  organisation_id: string;
  /** The source row / package the original was recovered through, if any. */
  source_reference: string | null;

  /* ---- the frozen result ---- */
  storage_bucket: string;
  storage_path: string;
  derivative_sha256: string;
  width: number;
  height: number;

  /* ---- what was done ---- */
  /** Share of the frame rebuilt. */
  repaired_share: number;
  regions_removed: number;
  /** The model, for the generative route. Null for the deterministic one. */
  model: string | null;
  generated_at: string;

  /**
   * THE REPAIR'S VERDICT ON ITS OWN WORK, measured on the derivative's bytes.
   *
   * `eligible` means two things were checked and both held: no laid-over type
   * survives anywhere in the result, and nothing the repair rebuilt came back
   * as a flat coloured block. Anything else is stored and NOT served — the work
   * is recorded, the card stays empty, and nobody has to guess.
   *
   * DELIBERATELY NOT "the display classifier now passes it". That test is the
   * one this shipped with and it was wrong: Lot 13 Hummock Rise's repaired
   * picture carries no type at all, and the classifier refuses it for the
   * house's black garage door — a flat coloured block that was there before the
   * repair and after it, and the same false positive that hides the completely
   * unmarked Lot 537 Kirramingly. A repair cannot be held responsible for a
   * judgement about a feature of the house.
   */
  verdict: 'eligible' | 'ineligible' | 'pending';
  /**
   * And what the display classifier makes of the result, recorded and not
   * obeyed. Kept because the disagreement above is worth being able to see.
   */
  classifier_state?: 'eligible' | 'ineligible' | 'pending';
}

/** Why a repair did not produce a servable picture. */
export type SanitizationFailureReason =
  /** The deterministic route's own gates: see `sanitizeOverlay.pure.ts`. */
  | 'background_too_detailed'
  | 'too_much_to_rebuild'
  | 'nothing_to_remove'
  | 'unusable_input'
  /** The generative route could not be reached, or refused the request. */
  | 'inpaint_unavailable'
  | 'inpaint_failed'
  /** No square patch can hold the graphic without leaving the picture. */
  | 'uncoverable'
  /** It returned something, and the validation gate rejected it. */
  | 'validation_failed'
  /** The result was made and the classifier still sees a graphic on it. */
  | 'still_annotated'
  /** The bytes could not be written or the record could not be stored. */
  | 'storage_failed';

export interface SanitizationFailure {
  transformation: SanitizationTransformation | null;
  sanitization_version: number;
  original_image_id: string;
  original_sha256: string;
  reason: SanitizationFailureReason;
  /** Safe to surface: what happened, for an operator and for a retry. */
  detail: string;
  model: string | null;
  failed_at: string;
  /**
   * Where the refused render was kept, when there was one.
   *
   * NOT a derivative and never served: nothing reads this path except a person
   * looking at what the repair produced. It is here because "we tried and the
   * graphic is still there" is a claim somebody has to be able to check.
   */
  rejected_path?: string | null;
}

/**
 * Read a stored derivative, if it is one this code may serve.
 *
 * FOUR THINGS ARE CHECKED AND EVERY ONE OF THEM CAN REFUSE, because a
 * derivative is a claim about specific bytes and a claim that has drifted from
 * them is worse than no claim: it would put a picture on a card that nothing
 * can any longer prove came from that property's own file.
 *
 *   SHAPE     anything malformed is not a derivative
 *   VERSION   `<` rather than `!==`, so a record from a FUTURE version (a
 *             rollback, a restored snapshot) is not overruled by this code
 *   ORIGIN    the SHA-256 named must be the SHA-256 the row currently holds —
 *             a builder who replaces the file has replaced the premise
 *   VERDICT   only `eligible`. A repair that did not remove the graphic is a
 *             record of work done, not a picture to draw.
 *
 * Fails closed in every direction. The cost of refusing wrongly is a blank
 * card, which is the state this whole area is trying to leave and is still
 * strictly better than showing a client an image nothing can vouch for.
 */
export function readServableDerivative(
  sourceDetail: Record<string, unknown> | null | undefined,
  originalSha256: string | null | undefined,
): SanitizedDerivative | null {
  const raw = (sourceDetail ?? {})[DERIVATIVE_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<SanitizedDerivative>;

  if (record.transformation !== 'deterministic_overlay_reconstruction'
    && record.transformation !== 'generative_overlay_inpaint') return null;

  const version = Number(record.sanitization_version);
  if (!Number.isFinite(version) || version < SANITIZATION_VERSION) return null;

  if (typeof record.storage_path !== 'string' || !record.storage_path) return null;
  if (typeof record.derivative_sha256 !== 'string' || !record.derivative_sha256) return null;

  // The original, compared exactly. No normalisation and no fallback to "the
  // row has no hash so assume it matches" — an unhashable original is one this
  // may not claim to be derived from.
  if (typeof record.original_sha256 !== 'string' || !record.original_sha256) return null;
  if (!originalSha256 || record.original_sha256 !== originalSha256) return null;

  if (record.verdict !== 'eligible') return null;

  return record as SanitizedDerivative;
}

/**
 * The hash of the bytes a row currently claims to hold.
 *
 * `stored_sha256` is what is in the bucket; `source_sha256` is what the builder
 * served. They are written from the same buffer and are normally identical, and
 * where a row carries only the older of the two keys the second is the fallback.
 */
export function storedOriginalSha(
  sourceDetail: Record<string, unknown> | null | undefined,
): string | null {
  const detail = sourceDetail ?? {};
  if (typeof detail.stored_sha256 === 'string' && detail.stored_sha256) {
    return detail.stored_sha256;
  }
  if (typeof detail.source_sha256 === 'string' && detail.source_sha256) {
    return detail.source_sha256;
  }
  return null;
}

/**
 * The derivative a card may draw for this row, or null.
 *
 * The one call every display path makes, so the client, the marketplace
 * endpoint and the portal endpoint cannot hold different opinions about which
 * object is served — a disagreement there would mean a card showing the cleaned
 * picture and the endpoint handing over the badged one, or the reverse.
 */
export function servableDerivativeFor(
  sourceDetail: Record<string, unknown> | null | undefined,
): SanitizedDerivative | null {
  return readServableDerivative(sourceDetail, storedOriginalSha(sourceDetail));
}

/**
 * Has this image already been through the repair at the current version?
 *
 * True for a stored derivative AND for a stored failure, which is the part
 * that keeps the sweep finite: "we tried and it did not work" is knowledge in
 * exactly the way "we read the package and it named no image" is, and throwing
 * it away is how a settler comes to re-run the same refused work for ever.
 *
 * A change of original bytes reopens both, through the same SHA-256 comparison
 * the reader above makes.
 */
export function sanitizationSettled(
  sourceDetail: Record<string, unknown> | null | undefined,
  originalSha256: string | null | undefined,
): boolean {
  const detail = sourceDetail ?? {};
  for (const key of [DERIVATIVE_KEY, FAILURE_KEY]) {
    const raw = detail[key];
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as { sanitization_version?: unknown; original_sha256?: unknown };
    const version = Number(record.sanitization_version);
    if (!Number.isFinite(version) || version < SANITIZATION_VERSION) continue;
    if (typeof record.original_sha256 !== 'string') continue;
    if (!originalSha256 || record.original_sha256 !== originalSha256) continue;
    return true;
  }
  return false;
}

/** The `source_detail` keys a successful repair contributes. */
export function derivativeDetail(
  derivative: SanitizedDerivative,
): Record<string, unknown> {
  // The failure key is cleared: a repair that has now succeeded must not leave
  // a refusal standing beside it for an operator to read as the current state.
  return { [DERIVATIVE_KEY]: derivative, [FAILURE_KEY]: null };
}

/** And the keys a refusal contributes. */
export function failureDetail(
  failure: SanitizationFailure,
): Record<string, unknown> {
  // The derivative key is NOT cleared here. A previously servable derivative
  // whose original has not changed stays servable; a failure recorded against
  // NEW bytes will not match its SHA-256 and so will not be served anyway.
  return { [FAILURE_KEY]: failure };
}
