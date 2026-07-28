# Verification service — face match, liveness signal, MRZ.
# Stateless: no volumes for customer data, no database access.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    AML_MODEL_DIR=/models

# libGL/libglib for OpenCV; tesseract for the MRZ read.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 tesseract-ocr curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY NOTICE ./NOTICE

# Models are fetched at build time so the image is self-contained and the
# service cannot start against a half-populated model directory.
RUN sh scripts/fetch_models.sh

# Run unprivileged. The service handles biometric data; it has no business
# running as root.
RUN useradd --system --uid 10001 amlsvc && chown -R amlsvc /srv /models
USER amlsvc

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
