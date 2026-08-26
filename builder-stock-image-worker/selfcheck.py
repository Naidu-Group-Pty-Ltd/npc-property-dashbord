"""Prove this deployment can actually repair a picture, before it serves one.

The same pattern as the WeasyPrint sidecar's selfcheck: run it as the deploy's
last build step (`python selfcheck.py models/lama_fp32.onnx`), so "the model
loads, runs, and the outside-mask guarantee holds" is proved on the exact
host, interpreter and weights that will serve — rather than something
production discovers. A worker that cannot keep unmasked pixels
byte-identical must never come up.
"""

import os
import sys

import numpy as np
import onnxruntime as ort

from inpaint_core import inpaint
from model_manifest import MODEL_EDGE

MODEL_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models", "lama_fp32.onnx")


def main() -> int:
    session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])

    # A graded sky with grain, and a plate where a badge would be.
    edge = MODEL_EDGE
    y = np.linspace(0, 1, edge, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, edge, dtype=np.float32)[None, :]
    grain = ((np.arange(edge)[:, None] * 29 + np.arange(edge)[None, :] * 71) % 13 - 6)
    image = np.stack([
        120 + 90 * y + 0 * x + grain,
        160 + 70 * y + 0 * x + grain,
        210 + 40 * y + 0 * x + grain,
    ], axis=2).clip(0, 255).astype(np.uint8)
    image[40:120, 60:300] = (193, 255, 114)

    mask = np.zeros((edge, edge), dtype=np.uint8)
    mask[36:124, 56:304] = 1

    result = inpaint(session, image, mask)

    outside = (mask == 0)
    if not np.array_equal(result[outside], image[outside]):
        print("FATAL: pixels outside the mask were altered", file=sys.stderr)
        return 1

    before = image[36:124, 56:304].astype(np.int32)
    after = result[36:124, 56:304].astype(np.int32)
    if np.abs(before - after).mean() < 8:
        print("FATAL: the masked region was not visibly reconstructed", file=sys.stderr)
        return 1

    # And the reconstruction must not be a flat block — the exact failure the
    # Supabase-side classifier exists to refuse.
    if float(after.std()) < 2.0:
        print("FATAL: the reconstruction is a flat colour block", file=sys.stderr)
        return 1

    print("selfcheck ok: model runs, mask respected, plate reconstructed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
