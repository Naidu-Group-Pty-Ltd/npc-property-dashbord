"""The repair itself: mask in, hole reconstructed, EVERYTHING ELSE the caller's.

Pure in the sense the repo's other sidecars use the word: no Flask, no
network, no filesystem — the ONNX session is handed in, so every rule here is
exercised by `test_inpaint_core.py` with a stub session and no 208 MB model.

THE ONE GUARANTEE THAT MATTERS lives in `composite_masked` and is arithmetic,
not a hope about the model: the returned picture is built by taking the
ORIGINAL byte everywhere the mask is 0 and the model's byte only where it is
1. Whatever the model does — re-light the scene, redraw the roof, return
noise — nothing outside the mask can reach the caller, because nothing
outside the mask is ever read from its output. The Supabase client then
re-checks the same property over the whole frame (`outsidePermittedRegionUnchanged`)
and re-runs the marketing classifier on the result; this file is the first of
those three fences, at the only place the model's output exists.

WHY THE MASK IS BINARISED AT 128. The client draws it white-on-black and
resampling can leave grey at edges; a grey pixel must be one thing or the
other, and >=128 keeps the drawn region while refusing to let anti-aliasing
quietly widen what may be rebuilt.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from model_manifest import MODEL_EDGE

# A mask covering nearly the whole patch is not a badge on a photograph — it
# is a request to regenerate the picture, which this service must never do.
# The client's patch planner pads every graphic with photograph on purpose, so
# real repairs sit far below this; the ceiling only refuses the degenerate.
MAX_MASK_SHARE = 0.90


class InpaintRefused(ValueError):
    """A request this service will not serve, with a reason safe to return."""


def decode_rgb(png_bytes: bytes, *, what: str, max_edge: int = 4096) -> np.ndarray:
    """PNG/image bytes -> HxWx3 uint8, or a refusal naming the part."""
    try:
        with Image.open(__import__("io").BytesIO(png_bytes)) as img:
            img.load()
            rgb = img.convert("RGB")
    except Exception as error:  # noqa: BLE001 - any undecodable input is one answer
        raise InpaintRefused(f"the {what} could not be decoded as an image") from error
    if rgb.width < 8 or rgb.height < 8:
        raise InpaintRefused(f"the {what} is too small to be a repair patch")
    if rgb.width > max_edge or rgb.height > max_edge:
        raise InpaintRefused(f"the {what} is larger than this service accepts")
    return np.asarray(rgb, dtype=np.uint8)


def binarise_mask(mask_rgb: np.ndarray) -> np.ndarray:
    """HxWx3 uint8 -> HxW uint8 in {0,1}. White (or light) marks the hole."""
    grey = mask_rgb.astype(np.uint16).sum(axis=2) // 3
    return (grey >= 128).astype(np.uint8)


def validate_pair(image: np.ndarray, mask: np.ndarray) -> None:
    if image.shape[:2] != mask.shape[:2]:
        raise InpaintRefused("the image and its mask are different sizes")
    share = float(mask.sum()) / float(mask.shape[0] * mask.shape[1])
    if share <= 0.0:
        raise InpaintRefused("the mask marks nothing to rebuild")
    if share > MAX_MASK_SHARE:
        raise InpaintRefused(
            "the mask covers almost the whole picture; this service repairs a "
            "masked region and never regenerates an image"
        )


def _resize_rgb(image: np.ndarray, edge: int) -> np.ndarray:
    return np.asarray(
        Image.fromarray(image, "RGB").resize((edge, edge), Image.BILINEAR),
        dtype=np.uint8,
    )


def _resize_mask(mask: np.ndarray, edge: int) -> np.ndarray:
    # NEAREST, deliberately: a bilinear mask invents grey, and grey re-opens
    # the binarisation question this module has already answered once.
    return np.asarray(
        Image.fromarray((mask * 255).astype(np.uint8), "L").resize(
            (edge, edge), Image.NEAREST),
        dtype=np.uint8,
    ) // 255


def prepare_feeds(session, image: np.ndarray, mask: np.ndarray) -> dict:
    """Name the model's own inputs rather than assuming an order.

    The export takes two tensors — a 3-channel image and a 1-channel mask —
    and they are told apart by their channel count, so a re-export that swaps
    their order keeps working and one that changes shape fails loudly here.
    """
    feeds = {}
    for meta in session.get_inputs():
        shape = list(meta.shape)
        channels = shape[1] if len(shape) == 4 else None
        if channels == 3:
            feeds[meta.name] = (
                image.astype(np.float32).transpose(2, 0, 1)[None, ...] / 255.0
            )
        elif channels == 1:
            feeds[meta.name] = mask.astype(np.float32)[None, None, ...]
        else:
            raise InpaintRefused("the loaded model does not take an image and a mask")
    if len(feeds) != 2:
        raise InpaintRefused("the loaded model does not take an image and a mask")
    return feeds


def read_output(raw: np.ndarray) -> np.ndarray:
    """Model output -> HxWx3 uint8, whichever value range the export used.

    The JIT checkpoint answers 0..1 and the Carve export answers 0..255; the
    rule is a deterministic function of the output rather than a config knob,
    so the same tensor always decodes the same way.
    """
    out = np.asarray(raw, dtype=np.float32)
    if out.ndim == 4:
        out = out[0]
    if out.ndim != 3:
        raise InpaintRefused("the model returned something that is not an image")
    if out.shape[0] == 3 and out.shape[2] != 3:
        out = out.transpose(1, 2, 0)
    if out.shape[2] != 3:
        raise InpaintRefused("the model returned something that is not an RGB image")
    if float(out.max(initial=0.0)) <= 2.0:
        out = out * 255.0
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def composite_masked(
    original: np.ndarray, repaired: np.ndarray, mask: np.ndarray,
) -> np.ndarray:
    """The guarantee: original bytes outside the mask, model bytes inside."""
    if original.shape != repaired.shape or original.shape[:2] != mask.shape[:2]:
        raise InpaintRefused("the repair does not match the picture it is for")
    keep = (mask == 0)[..., None]
    return np.where(keep, original, repaired)


def inpaint(session, image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """One repair: validated pair in, composited result out, at CALLER size.

    The model runs at its own fixed edge; the answer is resized back and then
    composited against the ORIGINAL-resolution image under the
    ORIGINAL-resolution mask, so a resize can soften only rebuilt pixels and
    can never move a single byte outside the mask.
    """
    validate_pair(image, mask)
    height, width = image.shape[:2]

    at_model = (width == MODEL_EDGE and height == MODEL_EDGE)
    model_image = image if at_model else _resize_rgb(image, MODEL_EDGE)
    model_mask = mask if at_model else _resize_mask(mask, MODEL_EDGE)
    if model_mask.sum() == 0:
        # A sliver of a mask that vanished in the resize: nothing to rebuild
        # at model resolution means nothing may be claimed as rebuilt at all.
        raise InpaintRefused("the mask marks nothing to rebuild at model resolution")

    outputs = session.run(None, prepare_feeds(session, model_image, model_mask))
    repaired = read_output(outputs[0])

    if not at_model:
        repaired = np.asarray(
            Image.fromarray(repaired, "RGB").resize((width, height), Image.BILINEAR),
            dtype=np.uint8,
        )
    return composite_masked(image, repaired, mask)


def encode_png(image: np.ndarray) -> bytes:
    import io

    buffer = io.BytesIO()
    Image.fromarray(image, "RGB").save(buffer, format="PNG")
    return buffer.getvalue()
