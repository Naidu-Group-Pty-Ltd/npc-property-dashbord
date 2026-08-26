"""The one place the inpainting model is named, pinned and licensed.

WHY A MANIFEST. The whole point of this service is that Builder Stock's
overlay repair stops depending on a third-party image API — which only holds
if the model this service runs is a fact somebody can check, not whatever a
deploy happened to download. So the file, its exact bytes (SHA-256) and its
license are pinned here; `download_model.py` refuses anything else, and the
`x-inpaint-model` header every repair response carries is written from
MODEL_ID, so the derivative record in Supabase names what actually ran.

THE MODEL. big-lama — LaMa ("Resolution-robust Large Mask Inpainting with
Fourier Convolutions", Suvorov et al., WACV 2022; https://github.com/advimman/lama)
— is a DEDICATED masked-inpainting model: it takes an image and a mask and
reconstructs only the hole. It has no text input, so there is nothing to
prompt and no way to ask it for a different house. The ONNX export is
Carve/LaMa-ONNX (https://huggingface.co/Carve/LaMa-ONNX), fixed 512x512 input,
which is exactly the patch size the Supabase client sends.

LICENSE, verified against the sources themselves and not from memory:
  - advimman/lama (code and the big-lama checkpoint): Apache License 2.0,
    Copyright 2021 Samsung Research. No non-commercial clause.
  - Carve/LaMa-ONNX (the export this pins): apache-2.0 on the model card.
Commercial SaaS use is permitted; attribution ships in NOTICE.md.
"""

# Recorded on every sanitized derivative this worker contributes to.
MODEL_ID = "builder-stock-image-worker/big-lama"

MODEL_FILENAME = "lama_fp32.onnx"
MODEL_URL = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
# The LFS object hash Hugging Face publishes for this exact file. A download
# that hashes to anything else is refused — a model nobody chose must never
# end up deciding what a client's photograph looks like.
MODEL_SHA256 = "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6"
MODEL_BYTES = 208_044_816

MODEL_LICENSE = "Apache-2.0"
MODEL_ATTRIBUTION = (
    "LaMa (big-lama), Copyright 2021 Samsung Research, Apache-2.0; "
    "ONNX export by Carve (Carve/LaMa-ONNX), Apache-2.0"
)

# The export's fixed input edge. The Supabase client sends patches at exactly
# this size, so the model runs with no second resize; anything else that
# arrives is resized in, inpainted, and composited back at the CALLER's
# resolution — see `inpaint_core.py`, where outside-mask pixels are taken from
# the original bytes whatever happened in between.
MODEL_EDGE = 512
