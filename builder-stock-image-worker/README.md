# builder-stock-image-worker

The internal service that removes promotional overlays from Builder Stock's
builder-supplied photographs — the replacement for the OpenAI `images/edits`
call that used to sit in `supabase/functions/_shared/builderStock/inpaintOverlay.ts`.

Read [`docs/builder-stock/IMAGE_WORKER.md`](../docs/builder-stock/IMAGE_WORKER.md)
for the architecture, the calling contract, deployment and the environment
variables the Supabase side needs.

## What it does

One endpoint, `POST /v1/inpaint`, takes exactly two things:

- `image` — a PNG patch of **that property's own photograph** (the Supabase
  client cuts it around one detected graphic);
- `mask` — a PNG, white where the promotional graphic is.

It reconstructs **only** the masked region with a dedicated masked-inpainting
model and answers with a PNG in which every pixel outside the mask is
byte-identical to the input — enforced arithmetically in `inpaint_core.py`
(`composite_masked`), proven at build time by `selfcheck.py`, and checked
again on the Supabase side by the existing outside-mask gate and the
marketing-overlay classifier.

There is no prompt, no URL input, no reference image and no property lookup:
the process has no way to reach any other property's picture, which is what
makes property isolation structural rather than promised.

## The model

`big-lama` (LaMa, Fourier-convolution inpainting) as the pinned ONNX export
`Carve/LaMa-ONNX / lama_fp32.onnx` — Apache-2.0 (Samsung Research / Carve; see
[`NOTICE.md`](./NOTICE.md)), fixed 512×512 input, run on ONNX Runtime CPU. The
exact bytes are pinned by SHA-256 in `model_manifest.py` and fetched at
**build** time; production never downloads a model.

## Running it

```sh
docker build -t builder-stock-image-worker .
docker run --rm -p 8080:8080 \
  -e BUILDER_STOCK_IMAGE_WORKER_TOKEN=dev-secret \
  builder-stock-image-worker
```

Authentication fails closed: with no token configured every request is
refused, so a mis-deployed instance is broken, not an anonymous public
image-editing API.

## Tests

`python -m unittest test_inpaint_core -v` — the mask/composite/refusal rules
with a stub session (no model needed). The Docker build also runs these plus
`selfcheck.py` (a real inference against the real model, as root and again as
the runtime user).
