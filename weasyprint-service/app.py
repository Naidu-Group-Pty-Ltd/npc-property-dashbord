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
import ipaddress
import socket
from importlib import metadata
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
from flask import Flask, request, Response, jsonify
from weasyprint import HTML, default_url_fetcher
from weasyprint.urls import HTTP_HEADERS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("weasyprint-service")

app = Flask(__name__)

EXPECTED_TOKEN = (os.environ.get("WEASYPRINT_SERVICE_TOKEN") or os.environ.get("WEASYPRINT_API_KEY") or "").strip().strip('"')
MAX_HTML_BYTES = int(os.environ.get("MAX_HTML_BYTES", str(25 * 1024 * 1024)))  # 25 MB


def _validate_resource_url(url: str) -> None:
    """Allow embedded data or public HTTP(S) resources, never local networks."""
    parsed = urlsplit(url)
    if parsed.scheme == "data":
        return
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("resource URL scheme is not allowed")
    if parsed.username or parsed.password:
        raise ValueError("resource URL credentials are not allowed")

    try:
        addresses = {
            info[4][0]
            for info in socket.getaddrinfo(parsed.hostname, parsed.port, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as exc:
        raise ValueError("resource URL host could not be resolved") from exc
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("resource URL host is not public")


class SafeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_resource_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def safe_url_fetcher(url: str, timeout: int = 10, ssl_context=None):
    """Apply the network policy before WeasyPrint fetches a resource."""
    _validate_resource_url(url)
    if urlsplit(url).scheme == "data":
        return default_url_fetcher(url, timeout=timeout, ssl_context=ssl_context)

    opener = build_opener(SafeRedirectHandler(), HTTPSHandler(context=ssl_context))
    response = opener.open(Request(url, headers=HTTP_HEADERS), timeout=timeout)
    info = response.info()
    return {
        "file_obj": response,
        "redirected_url": response.geturl(),
        "mime_type": info.get_content_type(),
        "encoding": info.get_param("charset"),
        "filename": info.get_filename(),
    }


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
    if not _auth_ok(request):
        return jsonify({"error": "unauthorized"}), 401

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
            pdf_bytes = HTML(string=html, base_url=base_url, url_fetcher=safe_url_fetcher).write_pdf(
                **write_kwargs,
                optimize_images=optimize_images,
                presentational_hints=False,
            )
        except TypeError:
            # Fallback for very old WeasyPrint builds that don't accept these kwargs.
            log.warning("write_pdf kwargs unsupported, falling back to defaults")
            pdf_bytes = HTML(string=html, base_url=base_url, url_fetcher=safe_url_fetcher).write_pdf()
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
