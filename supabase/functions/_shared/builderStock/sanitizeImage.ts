/**
 * Builder stock — the order the two repairs are tried in, and the proof.
 *
 * ONE ENTRY POINT, taking the builder's bytes and returning either a cleaned
 * copy of them or a refusal. Ingestion calls it as an image is stored and the
 * settler calls it for everything stored before it existed, so a picture
 * imported tomorrow and a picture imported last year get the identical
 * treatment from the identical code.
 *
 * THE ORDER IS DETERMINISTIC FIRST, ALWAYS.
 *
 *   clean            the detector found no laid-over graphic → NOTHING IS DONE.
 *                    The builder's file is served exactly as supplied. A repair
 *                    that runs on a picture nobody objected to is a change to a
 *                    photograph for no reason.
 *
 *   small and quiet  `sanitizeOverlay` — arithmetic, no model, no network, the
 *                    same bytes out every time. This is the preferred answer
 *                    and it is tried first even when the generative route is
 *                    available, because a reconstruction nobody has to trust
 *                    beats one somebody does.
 *
 *   large or busy    only then, `inpaintOverlay` — the same mask, the same
 *                    original, a model rebuilding what was behind it, and the
 *                    result composited at the mask alone.
 *
 * AND THE ANSWER IS CHECKED BEFORE IT IS OFFERED. Whatever produced it, the
 * result goes back through the SAME classifier that refused the original. A
 * repair that leaves the graphic legible measures as annotated a second time
 * and is refused here — recorded as work done, never served. That is the only
 * honest way to claim the marketing is gone: not that a repair ran, but that
 * the thing which objected no longer objects.
 *
 * NOTHING HERE CAN SUBSTITUTE AN IMAGE. Every path returns either a derivative
 * of these exact bytes or a refusal. There is no branch that reaches another
 * image, another property, a search, a map, a render or a generator, and the
 * refusal deliberately carries no candidate for a caller to fall back to.
 */
import { decodeFullRaster, decodeThumbnailResult } from './sourceImageRaster.ts';
import { overlayTextBoxes, readMarketingOverlay } from './marketingOverlay.pure.ts';
import { overlayPlateMask } from './overlayPlate.pure.ts';
import { growOverlayMask, sanitizeOverlay } from './sanitizeOverlay.pure.ts';
import { inpaintOverlay, type InpaintInput } from './inpaintOverlay.ts';
import { encodePng } from './rasterPng.ts';
import { decideMarketplaceEligibility } from './marketplaceEligibility.pure.ts';
import type {
  SanitizationFailureReason, SanitizationTransformation,
} from './sanitizedDerivative.pure.ts';

export type SanitizeImageResult =
  | {
    ok: true;
    /** A PNG of the repaired picture. Lossless: nothing is re-compressed. */
    bytes: Uint8Array;
    width: number;
    height: number;
    transformation: SanitizationTransformation;
    repairedShare: number;
    regionsRemoved: number;
    model: string | null;
    /** The classifier's verdict on the REPAIR, not on the original. */
    verdict: 'eligible' | 'ineligible' | 'pending';
  }
  | {
    ok: false;
    reason: SanitizationFailureReason | 'not_annotated';
    detail: string;
    transformation: SanitizationTransformation | null;
    model: string | null;
    /**
     * THE REPAIR THAT WAS REFUSED, KEPT SO SOMEBODY CAN LOOK AT IT.
     *
     * Deliberately not called `bytes`, and deliberately never returned on any
     * path that could be mistaken for a result: this is a rejected render, and
     * the caller stores it under its own name where nothing serves it. "We
     * tried and the graphic is still there" is a claim an operator has to be
     * able to check, and a refusal that throws the evidence away makes the next
     * improvement guesswork.
     */
    rejected?: { bytes: Uint8Array; width: number; height: number };
  };

export interface SanitizeImageOptions {
  /**
   * Whether the generative route may be used at all.
   *
   * A deployment with no credential, or one that has switched it off, still
   * gets the deterministic repair — the two are independent, and a missing key
   * must not turn a picture the arithmetic could have fixed into a blank card.
   */
  allowGenerative?: boolean;
  /** Injected in tests. Production passes nothing. */
  edit?: InpaintInput['edit'];
}

/**
 * Clean this image, or say why it cannot be cleaned.
 *
 * Never throws: a decoder that falls over on a builder's file must not fail
 * their import, and the caller records the refusal like any other.
 */
export async function sanitizeSourceImage(
  bytes: Uint8Array,
  options: SanitizeImageOptions = {},
): Promise<SanitizeImageResult> {
  try {
    const thumbnail = await decodeThumbnailResult(bytes);
    if (thumbnail.ok === false) {
      return {
        ok: false, reason: 'unusable_input', transformation: null, model: null,
        detail: `the picture could not be read (${thumbnail.reason})`,
      };
    }

    /*
     * THE DETECTOR IS ASKED ONCE, ON THE THUMBNAIL, AND IS NOT ADJUSTED.
     *
     * Its thresholds are fitted to the 400px reduction, and every one of them
     * would have to move to make a borderline picture reachable — which would
     * change what the marketplace refuses, not just what this repairs. A
     * picture this cannot clean stays a blank card; it does not become a reason
     * to loosen the rule that made it blank.
     */
    const verdict = readMarketingOverlay(thumbnail.thumbnail);
    if (!verdict || !verdict.annotated) {
      return {
        ok: false, reason: 'not_annotated', transformation: null, model: null,
        detail: 'the detector found no laid-over graphic on this picture',
      };
    }

    /*
     * THE MASK IS DERIVED FROM THE TYPE, NEVER FROM FLAT COLOUR.
     *
     * The classifier's flat-colour pass is the right instrument for "is there
     * promotional treatment here", where a false positive costs a blank card.
     * It is the WRONG instrument for "which pixels may I rebuild", where a
     * false positive removes whatever was there — and Lot 13 Hummock Rise is
     * the proof: its flat regions are the black garage door, a patch of sky,
     * and ONE of its two badges. Repairing that mask took the garage door off
     * the house and left the marketing on it.
     *
     * `overlayPlateMask` takes the lines of type the strict pass already found
     * and floods outward to find the plate each one is set on. A garage door
     * has no words on it and is never reached; neither is sky, a roof or a
     * wall. Type set straight onto the photograph has no plate, and that
     * contributes nothing rather than a guessed rectangle — such a picture
     * falls through to `nothing_to_remove`, is recorded as refused, and keeps
     * its blank card.
     */
    const plates = overlayPlateMask(thumbnail.thumbnail, overlayTextBoxes(thumbnail.thumbnail));
    if (!plates.plates.length) {
      return {
        ok: false, reason: 'nothing_to_remove',
        transformation: 'deterministic_overlay_reconstruction', model: null,
        detail: 'the graphic on this picture has no measurable extent to remove',
      };
    }

    const raster = await decodeFullRaster(bytes);
    if (!raster) {
      return {
        ok: false, reason: 'unusable_input', transformation: null, model: null,
        detail: 'the picture decoded as a thumbnail and not at full size',
      };
    }

    // The deterministic route first, always.
    const deterministic = sanitizeOverlay({
      width: raster.width,
      height: raster.height,
      pixels: raster.pixels,
      mask: plates.mask,
      regions: plates.plates.length,
      maskWidth: thumbnail.thumbnail.width,
      maskHeight: thumbnail.thumbnail.height,
    });

    if (deterministic.ok) {
      return await finish(
        deterministic.pixels, raster.width, raster.height,
        'deterministic_overlay_reconstruction', deterministic.repairedShare,
        deterministic.regionsRemoved, null);
    }

    /*
     * The deterministic route's two GATES are what the generative route exists
     * for; its two input faults are not. "Too much to rebuild" and "the
     * surroundings are structured" mean the arithmetic would smear — precisely
     * the case a model handles. "Nothing to remove" and "unusable input" mean
     * there is no repair to attempt, and asking a model to make one anyway is
     * how a picture with no badge on it comes back regenerated.
     */
    if (deterministic.reason !== 'background_too_detailed'
      && deterministic.reason !== 'too_much_to_rebuild') {
      return {
        ok: false, reason: deterministic.reason,
        transformation: 'deterministic_overlay_reconstruction', model: null,
        detail: `the deterministic repair had nothing it could do (${deterministic.reason})`,
      };
    }

    if (options.allowGenerative === false) {
      return {
        ok: false, reason: deterministic.reason,
        transformation: 'deterministic_overlay_reconstruction', model: null,
        detail: `the deterministic repair refused (${deterministic.reason}) and the `
          + 'generative route is not enabled here',
      };
    }

    const mask = growOverlayMask(
      plates.mask, thumbnail.thumbnail.width, thumbnail.thumbnail.height,
      raster.width, raster.height);
    if (!mask) {
      return {
        ok: false, reason: 'unusable_input',
        transformation: 'generative_overlay_inpaint', model: null,
        detail: 'the mask could not be placed on the full-size picture',
      };
    }

    const generated = await inpaintOverlay({
      width: raster.width, height: raster.height, pixels: raster.pixels, mask,
      edit: options.edit,
    });
    if (!generated.ok) {
      return {
        ok: false,
        reason: generated.reason === 'too_many_regions'
          ? 'too_much_to_rebuild' : generated.reason,
        transformation: 'generative_overlay_inpaint',
        model: null,
        detail: generated.detail,
      };
    }

    return await finish(
      generated.pixels, generated.width, generated.height,
      'generative_overlay_inpaint', generated.repairedShare, generated.regionsRemoved,
      generated.model);
  } catch (error) {
    return {
      ok: false, reason: 'unusable_input', transformation: null, model: null,
      detail: String((error as { message?: string })?.message ?? error).slice(0, 200),
    };
  }
}

/**
 * Encode the repair and put it back through the classifier.
 *
 * PNG because it is lossless: a JPEG re-encode would put its own artefacts on
 * the builder's untouched pixels, which are supposed to survive this
 * byte-for-byte.
 */
async function finish(
  pixels: Uint8Array, width: number, height: number,
  transformation: SanitizationTransformation,
  repairedShare: number, regionsRemoved: number, model: string | null,
): Promise<SanitizeImageResult> {
  const bytes = await encodePng(pixels, { width, height, components: 3 });
  if (!bytes) {
    return {
      ok: false, reason: 'storage_failed', transformation, model,
      detail: 'the repaired picture could not be encoded',
    };
  }

  /*
   * DIMENSIONS, READ OFF THE ARTEFACT THAT WILL BE STORED.
   *
   * Not off the buffer that produced it: the whole point of a validation gate
   * is to check the thing, and a re-crop or a re-scale that slipped through the
   * encoder would be invisible to a check of the inputs. The PNG header is four
   * bytes of width and four of height at a fixed offset, so this costs nothing.
   */
  const header = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
  if (header.getUint32(0) !== width || header.getUint32(4) !== height) {
    return {
      ok: false, reason: 'validation_failed', transformation, model,
      detail: 'the repaired picture is not the size the builder supplied',
    };
  }

  const check = await decodeThumbnailResult(bytes);
  if (check.ok === false) {
    return {
      ok: false, reason: 'validation_failed', transformation, model,
      detail: 'the repaired picture could not be read back',
    };
  }

  const verdict = decideMarketplaceEligibility(readMarketingOverlay(check.thumbnail));
  if (verdict.state !== 'eligible') {
    return {
      ok: false, reason: 'still_annotated', transformation, model,
      detail: `the repaired picture is still not one to draw (${verdict.reason ?? verdict.state})`,
      rejected: { bytes, width, height },
    };
  }

  return {
    ok: true, bytes, width, height, transformation, repairedShare, regionsRemoved, model,
    verdict: verdict.state,
  };
}
