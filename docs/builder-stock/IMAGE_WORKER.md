# The Builder Stock image worker — overlay inpainting without a vendor

Read this before touching `_shared/builderStock/inpaintOverlay.ts`, anything
in `builder-stock-image-worker/`, or the environment variables named below.

## Why it exists

Builder Stock's overlay repair has two routes and the order is fixed:
deterministic reconstruction first (`sanitizeOverlay.pure.ts` — arithmetic, no
model), and masked inpainting only where the deterministic route refuses
(`background_too_detailed` / `too_much_to_rebuild`). The inpainting route used
to POST each patch to OpenAI's `images/edits` on a forwarded `OPENAI_API_KEY` —
a per-image bill on somebody else's credit, and a production outage the day
that account ran dry (the settler's own comments still record the 429s:
*"You have no credits remaining"*, every tick, for hours).

The route now calls **`builder-stock-image-worker/`**, a plain-Python service
this repository ships — **no Docker, no containers, no Kubernetes, no
registry anywhere**: a virtualenv, pip wheels, and one gunicorn process. The
model weights load inside infrastructure we run, and no third-party
generative API, key or per-image bill exists anywhere in the Builder Stock
path. There is deliberately **no fallback to the old endpoint** —
`inpaintOverlay.ts` contains no OpenAI URL, key name or model name, and a
test reads the module source and fails if one returns.

## Order of the whole stage (and where each step is decided)

1. **Clean builder-supplied image first.** Decided in `repairSourceImages.ts`
   (a convicted promotional cover no longer stops same-property package
   discovery), in `chooseDisplayableImage` (a clean original outranks a
   sanitized derivative), and in `settleImageSanitization.ts` (a property that
   already serves a proven clean primary gets **no** repair spend at all).
2. **Deterministic repair second.** Unchanged.
3. **This worker third.** Same mask, same original bytes, same gates.
4. **Manual/failed state** only when all of the above refuse — recorded as a
   `sanitization_failure`, original preserved, nothing else ever substituted.

## The calling contract

`inpaintOverlay.ts` cuts one square patch per detected graphic (unchanged
geometry — plan, merge, coverage check), resamples it to **512** (the model's
own fixed input edge; it was 1024 only because OpenAI's endpoint was), and
POSTs `multipart/form-data` to `${BUILDER_STOCK_IMAGE_WORKER_URL}/v1/inpaint`:

- `image`: PNG of the patch — that property's own pixels and nothing else;
- `mask`: PNG, **white = rebuild**, black = leave alone;
- `Authorization: Bearer ${BUILDER_STOCK_IMAGE_WORKER_TOKEN}`.

The worker answers `image/png` plus an `x-inpaint-model` header, which is
what the derivative record stores as `model`. The call goes through
`meteredFetch` with an explicit `secretName`, exactly like the WeasyPrint and
PDF-parse sidecars: the token is the workspace's own service secret, never a
forwarded vendor key, so Mission Control rates the usage at nothing — the
binding in `apiUsageBilling.pure.ts` exists so the call is visible in the
ledger, not so anyone is billed.

Three fences stand between the model's output and a card, and all three are
kept:

1. the worker composites its output **only inside the binarised mask**
   (`inpaint_core.composite_masked` — outside pixels are copied from the
   input, arithmetically);
2. the client composites the returned patch under `blendWeights` (mask + 2px
   feather) and runs `outsidePermittedRegionUnchanged` over the whole frame
   against the bytes from storage — zero changed pixels is the only pass;
3. the result goes back through the same marketing-overlay classifier that
   convicted the original, and `still_annotated` is a refusal.

## Failure behaviour (unchanged on purpose)

- No `BUILDER_STOCK_IMAGE_WORKER_URL` configured → `inpaint_unavailable`.
- Worker unreachable / non-200 / undecodable answer → `inpaint_failed`.

Both are **operational** to `settleImageSanitization.ts`: nothing is written,
the upload's marker does not advance, the row cools down for ten minutes and
is retried — an outage can never become a permanent verdict about a
photograph, and nothing ever substitutes another image.

## The model, and its license

`big-lama` — LaMa (Suvorov et al., WACV 2022), a **dedicated masked-inpainting
model**: image + mask in, hole reconstructed, no text input at all. Pinned as
the ONNX export `Carve/LaMa-ONNX / lama_fp32.onnx`, SHA-256
`1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`
(208,044,816 bytes), fetched and verified at **build** time
(`download_model.py`) and never at request time.

License, verified against the sources: `advimman/lama` is **Apache-2.0**
(© 2021 Samsung Research), the ONNX export is **Apache-2.0**. Commercial SaaS
use is permitted; attribution ships beside the service (`NOTICE.md`). Do not
swap the model without re-verifying the replacement's license and updating
`model_manifest.py` — the manifest is the only place the file, hash and
license are named.

## Deployment — ZERO Docker (needs explicit approval; nothing has been deployed)

The worker is deliberately **not** a container. It is a directory of plain
Python: every dependency is a pip wheel (no compiler, no system packages),
the model is one file fetched and SHA-verified by `download_model.py`, and
the whole service is one gunicorn process. Anything that can run Python 3.12
runs it directly — no Dockerfile, no image, no registry, no Kubernetes, and
never a personal or office PC.

**The contract every host satisfies the same way:**

- build (once per deploy):
  `pip install -r requirements.txt && python download_model.py models && python selfcheck.py models/lama_fp32.onnx`
- start: the `Procfile` command —
  `gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 90 --preload --access-logfile - app:app`
- health: `GET /healthz`
- env: `BUILDER_STOCK_IMAGE_WORKER_TOKEN` (and the platform's `PORT`;
  `MODEL_PATH` only if the host keeps large files elsewhere)

**Option A — managed native-Python application runtime (recommended).** Any
platform that deploys a Python service straight from the repository with a
build command and a start command (Render-style native runtimes,
Railway/Heroku-class Python services, and equivalents): point it at
`builder-stock-image-worker/`, give it the build and start commands above,
set the token, pick a plan with **4 GB RAM / 2 vCPU**. The platform provides
HTTPS, the env vars, health-checked restarts and process supervision — there
is no server to administer and no Docker anywhere in the workflow.

**Option B — a plain VM / server instance.** A small cloud compute instance
(2 vCPU, 4 GB RAM, ~2 GB free disk) running the worker directly under
systemd, with the host or a reverse proxy (Caddy gives automatic HTTPS in two
lines) terminating TLS:

```ini
# /etc/systemd/system/builder-stock-image-worker.service
[Unit]
Description=Builder Stock image worker (masked overlay inpainting)
After=network-online.target

[Service]
User=inpaint
WorkingDirectory=/opt/builder-stock-image-worker
Environment=PORT=8080
Environment=BUILDER_STOCK_IMAGE_WORKER_TOKEN=<long random string>
ExecStart=/opt/builder-stock-image-worker/.venv/bin/gunicorn \
  --bind 127.0.0.1:8080 --workers 1 --threads 4 --timeout 90 \
  --preload --access-logfile - app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Setup is the README's five commands (venv → pip → `download_model.py` →
`selfcheck.py` → gunicorn), then `systemctl enable --now`. `Restart=always`
is the supervision; the selfcheck in the build step is what makes a broken
deploy fail before it serves.

**Sizing, either way:** CPU-only — **no GPU**. The ONNX session is the
footprint (~1.5–2 GB resident; 4 GB RAM is comfortable), ~2–8 s per 512²
patch, at most 4 patches per photograph, and the settler repairs at most 2
photographs per tick, so a single small instance is far more than the
workload. Disk: ~2 GB (208 MB model + wheels). A restart is seconds of model
load, inside the client's 60 s ceiling, and the settler retries anyway.

To go live (in this order):

1. Deploy the worker by Option A or B, reachable by Supabase egress, with
   `BUILDER_STOCK_IMAGE_WORKER_TOKEN=<long random string>`.
2. Set the **same** two values as Supabase Edge Function secrets:
   `BUILDER_STOCK_IMAGE_WORKER_URL` (no trailing slash, no path) and
   `BUILDER_STOCK_IMAGE_WORKER_TOKEN`.
3. Nothing else. The settlement sweep already runs; the next tick's
   generative-route candidates go to the worker. `OPENAI_API_KEY` is not read
   by Builder Stock any more and can stay or go as other features require.

Until step 2 happens, the generative route reports `inpaint_unavailable` and
stays retryable — the deterministic route, clean-source precedence, and all
serving behaviour work regardless.
