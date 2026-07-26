"""
WeasyPrint PDF rendering microservice.

POST /render
  Headers:
    Authorization: Bearer <WEASYPRINT_SERVICE_TOKEN>
    Content-Type:  application/json
  Body:
    { "html": "<!doctype html>...", "base_url": "https://optional/" }
  Returns:
    application/pdf bytes (200) or { "error": "..." } (4xx/5xx)

GET /healthz -> 200 "ok"
"""

import os
import logging
from importlib import metadata
from flask import Flask, request, Response, jsonify
from weasyprint import HTML
from weasyprint.urls import URLFetchingError, default_url_fetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("weasyprint-service")

app = Flask(__name__)

EXPECTED_TOKEN = (os.environ.get("WEASYPRINT_SERVICE_TOKEN") or os.environ.get("WEASYPRINT_API_KEY") or "").strip().strip('"')
MAX_HTML_BYTES = int(os.environ.get("MAX_HTML_BYTES", str(25 * 1024 * 1024)))  # 25 MB


def embedded_resource_fetcher(url: str, timeout: int = 10, ssl_context=None):
    """Resolve embedded resources while refusing all filesystem and network access."""
    if not url.lower().startswith("data:"):
        raise URLFetchingError("external resources are disabled")
    return default_url_fetcher(url, timeout=timeout, ssl_context=ssl_context)


def _package_version(name: str) -> str:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return "unknown"


def _auth_ok(req) -> bool:
    if not EXPECTED_TOKEN:
        # If no token is set, refuse everything — fail closed.
        return False
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    # Support both "Bearer <token>" and "Bearer "<token>""
    received_token = header.split(" ", 1)[1].strip().strip('"')
    return received_token == EXPECTED_TOKEN


@app.get("/")
def root():
    return jsonify(
        {
            "service": "weasyprint-service",
            "status": "ok",
            "endpoints": ["GET /healthz", "GET /health", "GET /version", "POST /render"],
        }
    )


@app.get("/health")
@app.get("/healthz")
def healthz():
    return Response("ok", mimetype="text/plain")


@app.get("/version")
def version():
    return jsonify(
        {
            "weasyprint": _package_version("weasyprint"),
            "pydyf": _package_version("pydyf"),
            "flask": _package_version("flask"),
        }
    )


@app.post("/render")
def render():
    if not _auth_ok(request):
        return jsonify({"error": "unauthorized"}), 401

    if request.content_length and request.content_length > MAX_HTML_BYTES:
        return jsonify({"error": "html too large"}), 413

    payload = request.get_json(silent=True) or {}
    html = payload.get("html")
    base_url = payload.get("base_url") or None
    pdf_variant = payload.get("pdf_variant") or None  # e.g. "pdf/a-2b", "pdf/ua-1"
    tagged = bool(payload.get("tagged", True))         # accessible/tagged PDF by default
    optimize_images = bool(payload.get("optimize_images", True))

    if not isinstance(html, str) or not html.strip():
        return jsonify({"error": "html is required"}), 400

    try:
        write_kwargs = {}
        # WeasyPrint ≥60 supports pdf_variant + pdf_identifier; older builds ignore unknowns.
        if pdf_variant:
            write_kwargs["pdf_variant"] = pdf_variant
        # `pdf_forms`/`uncompressed_pdf` skipped; we want tagged + compressed.
        try:
            pdf_bytes = HTML(
                string=html,
                base_url=base_url,
                url_fetcher=embedded_resource_fetcher,
            ).write_pdf(
                **write_kwargs,
                optimize_images=optimize_images,
                presentational_hints=False,
            )
        except TypeError:
            # Fallback for very old WeasyPrint builds that don't accept these kwargs.
            log.warning("write_pdf kwargs unsupported, falling back to defaults")
            pdf_bytes = HTML(
                string=html,
                base_url=base_url,
                url_fetcher=embedded_resource_fetcher,
            ).write_pdf()
    except Exception as exc:  # noqa: BLE001
        log.exception("weasyprint render failed")
        return jsonify({"error": f"render_failed: {exc}"}), 500

    log.info("rendered pdf bytes=%d html_bytes=%d", len(pdf_bytes), len(html))
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={"Content-Disposition": 'inline; filename="report.pdf"'},
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
