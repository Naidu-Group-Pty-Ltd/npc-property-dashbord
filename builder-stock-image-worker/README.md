# builder-stock-image-worker

The internal service that removes promotional overlays from Builder Stock's
builder-supplied photographs — the replacement for the OpenAI `images/edits`
call that used to sit in `supabase/functions/_shared/builderStock/inpaintOverlay.ts`.

**It is plain Python and runs directly — no Docker, no containers, no
Kubernetes, no registry.** Every dependency is a pip wheel; the whole service
is this directory, a virtualenv, and one gunicorn process. Read
[`docs/builder-stock/IMAGE_WORKER.md`](../docs/builder-stock/IMAGE_WORKER.md)
for the architecture, the calling contract, hosting options and the
environment variables the Supabase side needs.

## What it does

One endpoint, `POST /v1/inpaint`, takes exactly two things:

- `image` — a PNG patch of **that property's own photograph** (the Supabase
  client cuts it around one detected graphic);
- `mask` — a PNG, white where the promotional graphic is.

It reconstructs **only** the masked region with a dedicated masked-inpainting
model and answers with a PNG in which every pixel outside the mask is
byte-identical to the input — enforced arithmetically in `inpaint_core.py`
(`composite_masked`), proven at deploy time by `selfcheck.py`, and checked
again on the Supabase side by the existing outside-mask gate and the
marketing-overlay classifier.

There is no prompt, no URL input, no reference image and no property lookup:
the process has no way to reach any other property's picture, which is what
makes property isolation structural rather than promised.

## The model

`big-lama` (LaMa, Fourier-convolution inpainting) as the pinned ONNX export
`Carve/LaMa-ONNX / lama_fp32.onnx` — Apache-2.0 (Samsung Research / Carve; see
[`NOTICE.md`](./NOTICE.md)), fixed 512×512 input, run on ONNX Runtime CPU. The
exact bytes are pinned by SHA-256 in `model_manifest.py` and fetched once at
**deploy** time by `download_model.py`; production never downloads a model at
request time.

## Running it directly

```sh
cd builder-stock-image-worker
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python download_model.py models        # fetches + SHA-256-verifies the model
python selfcheck.py models/lama_fp32.onnx   # real inference; must print ok
BUILDER_STOCK_IMAGE_WORKER_TOKEN=dev-secret PORT=8080 \
  gunicorn --bind 0.0.0.0:8080 --workers 1 --threads 4 --timeout 90 \
    --preload --access-logfile - app:app
```

`Procfile` carries that same start command for managed Python runtimes, and
the systemd unit in the deployment doc runs it on a plain VM — one command,
every host.

Authentication fails closed: with no token configured every request is
refused, so a mis-deployed instance is broken, not an anonymous public
image-editing API.

## Tests

`python -m unittest test_inpaint_core -v` — the mask/composite/refusal rules
with a stub session (no model needed). `selfcheck.py` is the end-to-end proof
against the real weights and belongs in every deploy's build step.
