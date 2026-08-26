# Builder Stock image worker: masked overlay inpainting on OUR infrastructure.
# Targets any container host (Cloud Run, Fly.io, Railway, Render, a plain VM
# with Docker) — the same portability rule as `weasyprint-service/Dockerfile`,
# and nothing below is specific to one provider.
#
# Build & deploy (Cloud Run example, matching the project's other sidecars):
#   gcloud builds submit --tag gcr.io/PROJECT_ID/builder-stock-image-worker .
#   gcloud run deploy builder-stock-image-worker \
#     --image gcr.io/PROJECT_ID/builder-stock-image-worker \
#     --region australia-southeast1 \
#     --memory 4Gi --cpu 2 --concurrency 2 --timeout 120 \
#     --set-env-vars BUILDER_STOCK_IMAGE_WORKER_TOKEN=<long-random-string>
#
# The service authenticates every request itself (bearer token, fail-closed),
# so platform-level anonymous ingress is acceptable exactly as it is for the
# WeasyPrint sidecar; lock ingress down further if the host makes it easy.
#
# ── The model is baked in at BUILD time, pinned by SHA-256 ──────────────────
# `model_manifest.py` names the exact file (Carve/LaMa-ONNX lama_fp32.onnx,
# Apache-2.0) and its hash; `download_model.py` refuses anything else, so a
# tampered or moved upstream file fails the BUILD, and production never
# downloads a model at request time.

# ── Stage 1: the virtualenv and the verified model ──────────────────────────
FROM python:3.12-slim-bookworm AS builder

ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv "$VIRTUAL_ENV"
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY model_manifest.py download_model.py ./
RUN python download_model.py /build/models

# ── Stage 2: the runtime image ──────────────────────────────────────────────
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    MODEL_PATH=/app/models/lama_fp32.onnx \
    HOME=/tmp

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --from=builder /build/models /app/models
COPY model_manifest.py inpaint_core.py app.py selfcheck.py test_inpaint_core.py NOTICE.md ./

# The unit tests and the end-to-end selfcheck run IN the image, so "the model
# loads, the mask is respected, the plate is reconstructed" is a property of
# the artefact — the same pattern as the WeasyPrint sidecar.
RUN python -m unittest test_inpaint_core -v \
    && python selfcheck.py "$MODEL_PATH"

# Unprivileged. The service takes two PNGs from an authenticated caller and
# returns one; there is no reason for any of that to happen as uid 0.
RUN useradd --system --no-create-home --uid 10001 inpaint \
    && chown -R root:root /app && chmod -R a+rX /app
USER inpaint

# Re-run the selfcheck as the exact runtime identity: a model root can read
# and uid 10001 cannot is a worker that 500s in production and nowhere else.
RUN python selfcheck.py "$MODEL_PATH"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import os,urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/healthz', timeout=4).status==200 else 1)"

# One worker: the ONNX session is the memory footprint, and `--preload` loads
# it in the parent so a restart never races a cold model against a request.
# `--timeout 90` sits above the Supabase client's own 60s request ceiling.
CMD exec gunicorn --bind :$PORT --workers 1 --threads 4 --timeout 90 \
      --preload --graceful-timeout 30 --access-logfile - app:app
