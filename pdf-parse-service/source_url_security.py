"""SSRF-safe fetching for caller-supplied PDF source URLs."""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable

import httpx


Resolver = Callable[..., list[tuple]]
REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class UnsafeSourceUrl(ValueError):
    """Raised when a source URL could reach a non-public network address."""


def validate_public_http_url(url: str, *, resolver: Resolver = socket.getaddrinfo) -> None:
    """Require HTTP(S) and ensure every resolved address is globally routable."""
    try:
        parsed = httpx.URL(url)
        port = parsed.port
    except (TypeError, ValueError) as exc:
        raise UnsafeSourceUrl("Source URL is invalid.") from exc

    if parsed.scheme not in {"http", "https"}:
        raise UnsafeSourceUrl("Source URL must use HTTP or HTTPS.")
    if not parsed.host or parsed.userinfo:
        raise UnsafeSourceUrl("Source URL must have a hostname and no credentials.")

    try:
        literal = ipaddress.ip_address(parsed.host)
        addresses = {literal}
    except ValueError:
        try:
            results = resolver(
                parsed.host,
                port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
            addresses = {ipaddress.ip_address(result[4][0]) for result in results}
        except (OSError, ValueError) as exc:
            raise UnsafeSourceUrl("Source URL hostname could not be resolved safely.") from exc

    if not addresses or any(not address.is_global for address in addresses):
        raise UnsafeSourceUrl("Source URL must resolve only to public IP addresses.")


async def fetch_public_url(
    url: str,
    *,
    timeout: float = 60,
    max_redirects: int = 5,
    resolver: Resolver = socket.getaddrinfo,
    transport: httpx.AsyncBaseTransport | None = None,
) -> httpx.Response:
    """Fetch a public URL, revalidating each explicit redirect destination."""
    current_url = httpx.URL(url)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, transport=transport) as client:
        for redirect_count in range(max_redirects + 1):
            validate_public_http_url(str(current_url), resolver=resolver)
            response = await client.get(current_url)
            if response.status_code not in REDIRECT_STATUSES or "location" not in response.headers:
                return response
            if redirect_count == max_redirects:
                raise httpx.TooManyRedirects("Exceeded maximum source URL redirects.", request=response.request)
            current_url = response.url.join(response.headers["location"])

    raise AssertionError("redirect loop exited unexpectedly")  # pragma: no cover
