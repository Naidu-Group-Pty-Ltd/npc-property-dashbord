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
import ssl
import zlib
from importlib import metadata
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
from flask import Flask, request, Response, jsonify
from weasyprint import HTML

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("weasyprint-service")

app = Flask(__name__)

EXPECTED_TOKEN = (os.environ.get("WEASYPRINT_SERVICE_TOKEN") or os.environ.get("WEASYPRINT_API_KEY") or "").strip().strip('"')
MAX_HTML_BYTES = int(os.environ.get("MAX_HTML_BYTES", str(25 * 1024 * 1024)))  # 25 MB


def _validate_remote_url(url: str) -> None:
    """Allow only public HTTPS resources to be fetched by WeasyPrint."""
    parsed = urlsplit(url)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("PDF resources must use an absolute HTTPS URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("PDF resource URLs must not contain credentials")
    if parsed.port not in (None, 443):
        raise ValueError("PDF resource URLs must use the standard HTTPS port")

    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as exc:
        raise ValueError("PDF resource hostname could not be resolved") from exc

    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("PDF resources must not target a private or reserved address")


class _RestrictedRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_remote_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def restricted_url_fetcher(url: str, timeout=10, ssl_context=None):
    """Fetch public HTTPS resources while validating redirect destinations."""
    _validate_remote_url(url)
    context = ssl_context or ssl.create_default_context()
    opener = build_opener(HTTPSHandler(context=context), _RestrictedRedirectHandler())
    response = opener.open(
        Request(url, headers={"User-Agent": "WeasyPrint restricted fetcher"}),
        timeout=timeout,
    )
    try:
        info = response.info()
        body = response.read()
        redirected_url = response.geturl()
    finally:
        response.close()
    if info.get("Content-Encoding") == "gzip":
        body = zlib.decompress(body, 16 + zlib.MAX_WBITS)
    elif info.get("Content-Encoding") == "deflate":
        try:
            body = zlib.decompress(body)
        except zlib.error:
            body = zlib.decompress(body, -15)
    return {
        "string": body,
        "redirected_url": redirected_url,
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
            pdf_bytes = HTML(string=html, base_url=base_url, url_fetcher=restricted_url_fetcher).write_pdf(
                **write_kwargs,
                optimize_images=optimize_images,
                presentational_hints=False,
            )
        except TypeError:
            # Fallback for very old WeasyPrint builds that don't accept these kwargs.
            log.warning("write_pdf kwargs unsupported, falling back to defaults")
            pdf_bytes = HTML(string=html, base_url=base_url, url_fetcher=restricted_url_fetcher).write_pdf()
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
