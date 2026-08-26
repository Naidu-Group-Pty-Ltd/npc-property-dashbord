"""Builder Stock image worker — masked overlay inpainting, run by us alone.

POST /v1/inpaint
  Headers:
    Authorization: Bearer <BUILDER_STOCK_IMAGE_WORKER_TOKEN>
  Body (multipart/form-data):
    image: PNG of the builder's own patch (the property's exact pixels)
    mask:  PNG, WHITE where the promotional graphic is, BLACK elsewhere
  Returns:
    image/png bytes (200) with `x-inpaint-model` naming what ran, or
    { "error": "..." } (4xx/5xx).

GET /healthz -> 200 "ok"    (unauthenticated liveness, nothing else is)
GET /version -> model + runtime versions, authenticated

WHAT THIS SERVICE IS AND IS NOT. It replaces the OpenAI images/edits call in
Builder Stock's overlay repair: the model weights load HERE, in
infrastructure this project runs, and no third-party generative API is
involved anywhere in the process. It takes exactly two things — one image and
its mask — and there is deliberately no URL input, no reference-image input,
no prompt and no property lookup of any kind: the caller sends the pixels of
ONE property's own photograph and receives those same pixels back with only
the masked region reconstructed. Property isolation is therefore structural —
this process has no way to reach any other picture.

AUTHENTICATION FAILS CLOSED, exactly as the WeasyPrint sidecar's does: no
configured token means every request is refused, so a mis-deployed instance
is a broken one rather than an anonymous public image-editing endpoint.
"""

import hmac
import io
import logging
import os
import time

import numpy as np
import onnxruntime as ort
from flask import Flask, Response, jsonify, request

from inpaint_core import (
    InpaintRefused, binarise_mask, decode_rgb, encode_png, inpaint,
)
from model_manifest import MODEL_ATTRIBUTION, MODEL_ID, MODEL_LICENSE

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("builder-stock-image-worker")

app = Flask(__name__)

EXPECTED_TOKEN = (
    os.environ.get("BUILDER_STOCK_IMAGE_WORKER_TOKEN") or ""
).strip().strip('"')
MODEL_PATH = os.environ.get("MODEL_PATH", "/app/models/lama_fp32.onnx")
# Each part is a 512-square PNG in normal operation (< 1 MB). The ceiling is
# generous headroom, not an invitation.
MAX_PART_BYTES = int(os.environ.get("MAX_PART_BYTES", str(12 * 1024 * 1024)))
app.config["MAX_CONTENT_LENGTH"] = MAX_PART_BYTES * 2 + 64 * 1024

_session = None


def session() -> ort.InferenceSession:
    """The model, loaded once per process and shared by every request.

    gunicorn runs with `--preload`, so the parent pays this and the workers
    inherit it — the same warm-up pattern the WeasyPrint sidecar uses.
    """
    global _session
    if _session is None:
        started = time.monotonic()
        _session = ort.InferenceSession(
            MODEL_PATH, providers=["CPUExecutionProvider"])
        log.info("model loaded in %.1fs from %s", time.monotonic() - started, MODEL_PATH)
    return _session


def _auth_ok(req) -> bool:
    if not EXPECTED_TOKEN:
        # No token configured: refuse everything — fail closed.
        return False
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    received = header.split(" ", 1)[1].strip().strip('"')
    return hmac.compare_digest(received, EXPECTED_TOKEN)


@app.get("/health")
@app.get("/healthz")
def healthz():
    return Response("ok", mimetype="text/plain")


@app.get("/version")
def version():
    if not _auth_ok(request):
        return jsonify({"error": "unauthorized"}), 401
    return jsonify({
        "model": MODEL_ID,
        "license": MODEL_LICENSE,
        "attribution": MODEL_ATTRIBUTION,
        "onnxruntime": ort.__version__,
        "numpy": np.__version__,
    })


def _read_part(name: str) -> bytes:
    part = request.files.get(name)
    if part is None:
        raise InpaintRefused(f"the request carries no '{name}' part")
    data = part.read(MAX_PART_BYTES + 1)
    if len(data) > MAX_PART_BYTES:
        raise InpaintRefused(f"the '{name}' part is larger than this service accepts")
    if not data:
        raise InpaintRefused(f"the '{name}' part is empty")
    return data


@app.post("/v1/inpaint")
def inpaint_route():
    if not _auth_ok(request):
        return jsonify({"error": "unauthorized"}), 401

    started = time.monotonic()
    try:
        image = decode_rgb(_read_part("image"), what="image")
        mask = binarise_mask(decode_rgb(_read_part("mask"), what="mask"))
        result = inpaint(session(), image, mask)
    except InpaintRefused as refusal:
        return jsonify({"error": str(refusal)}), 422
    except Exception:  # noqa: BLE001 - a fault must not leak internals
        log.exception("inpaint failed")
        return jsonify({"error": "the repair could not be completed"}), 500

    png = encode_png(result)
    log.info(
        "inpainted %dx%d in %.1fs (%d bytes out)",
        image.shape[1], image.shape[0], time.monotonic() - started, len(png),
    )
    return Response(
        png,
        mimetype="image/png",
        headers={
            "x-inpaint-model": MODEL_ID,
            "Cache-Control": "no-store",
        },
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8080")))
