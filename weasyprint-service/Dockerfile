# WeasyPrint microservice for premium investment-report PDFs.
# Targets Google Cloud Run (or any container host: Fly.io, Railway, Render).
#
# Build & deploy (Cloud Run example):
#   gcloud builds submit --tag gcr.io/PROJECT_ID/weasyprint-service .
#   gcloud run deploy weasyprint-service \
#     --image gcr.io/PROJECT_ID/weasyprint-service \
#     --region australia-southeast1 \
#     --memory 2Gi --cpu 2 --concurrency 4 --timeout 600 \
#     --set-env-vars WEASYPRINT_SERVICE_TOKEN=<long-random-string>
#
# ── Fonts ────────────────────────────────────────────────────────────────────
# The font list below is a CONTRACT with
# `supabase/functions/_shared/reportDesign/typography.pure.ts`, asserted by
# `src/lib/reportDesign/__tests__/reportTypography.spec.ts`, which reads this
# file. A face a report names must be installed here, or it silently falls back
# to the engine default — invisible in review, obvious in a client's hands.
#
# This previously installed `fonts-playfair-display`, `fonts-cormorant-garamond`
# and `fonts-fraunces`. **None of the three exists in Debian**, bookworm or
# trixie. `apt-get install -y` exits non-zero on an unknown package, so this
# layer failed and the image could not be built. Playfair Display now arrives as
# a COPY-ed TTF; Cormorant and Fraunces are gone from the type stacks entirely.

# Pinned to the distribution, not just the Python version. The font contract
# above is only checkable against a known Debian release, and an unpinned
# `-slim` silently moves from bookworm to trixie when the tag is rebuilt.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

# WeasyPrint native deps + the packaged half of the font stack.
# Every package here is verified present in bookworm AND trixie.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libpango-1.0-0 libpangoft2-1.0-0 \
      libcairo2 libgdk-pixbuf-2.0-0 \
      libffi-dev shared-mime-info \
      fontconfig \
      fonts-dejavu fonts-liberation fonts-noto fonts-noto-cjk \
      fonts-inter fonts-roboto fonts-lato \
      fonts-ibm-plex \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The brand faces. Not packaged by any distribution, so they travel with the
# service — which is also why they live here rather than in `public/fonts/`:
# Docker cannot COPY from outside its build context, and the documented build
# context is this directory. SIL OFL 1.1; the licence files ship beside them,
# which redistribution inside an image requires.
COPY fonts/ /usr/local/share/fonts/npc/
RUN fc-cache -f \
    # Fail the build rather than the render. A missing brand face produces a
    # document set in the engine's default serif, and nothing detects that until
    # a client opens it.
    && for family in "Cinzel" "Playfair Display" "Inter" "IBM Plex Mono"; do \
         fc-list : family | grep -qi "$family" \
           || { echo "FATAL: font family '$family' is not installed"; exit 1; }; \
       done \
    && fc-match "Playfair Display:italic" | grep -qi "playfair" \
       || { echo "FATAL: Playfair Display italic is not installed"; exit 1; }

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8080
CMD exec gunicorn --bind :$PORT --workers 2 --threads 4 --timeout 600 app:app
