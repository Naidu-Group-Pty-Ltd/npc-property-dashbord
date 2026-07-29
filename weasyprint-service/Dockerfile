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

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

# WeasyPrint native deps + a broad font stack for editorial typography.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libpango-1.0-0 libpangoft2-1.0-0 \
      libcairo2 libgdk-pixbuf-2.0-0 \
      libffi-dev shared-mime-info \
      fontconfig \
      fonts-dejavu fonts-liberation fonts-noto fonts-noto-cjk \
      fonts-inter fonts-roboto fonts-lato \
      fonts-cormorant-garamond fonts-fraunces fonts-ibm-plex \
      fonts-playfair-display \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8080
CMD exec gunicorn --bind :$PORT --workers 2 --threads 4 --timeout 600 app:app
