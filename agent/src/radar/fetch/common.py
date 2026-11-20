"""Per-source limits shared by every fetcher."""

import ipaddress
from datetime import datetime, timedelta

import httpx

from radar.models import RawItem
from radar.urls import canonicalize

MAX_ITEMS = 50
MAX_AGE = timedelta(hours=72)
MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
_REDIRECTS = (301, 302, 303, 307, 308)
_LOCAL_SUFFIXES = (".localhost", ".local", ".internal")


class FetchRefused(Exception):
    """A source URL or response the fetcher will not accept (short, safe reason)."""


def limit_items(items: list[RawItem], now: datetime) -> list[RawItem]:
    """Drop items older than 72h, sort newest first, keep at most 50."""
    cutoff = now - MAX_AGE
    fresh = [i for i in items if i.published_at >= cutoff]
    fresh.sort(key=lambda i: i.published_at, reverse=True)
    return fresh[:MAX_ITEMS]


def safe_canonical(url: str) -> str | None:
    """Canonical URL, or None when the link is malformed or has no host."""
    try:
        canonical = canonicalize(url)
    except ValueError:
        return None
    if not canonical.removeprefix("https://").split("/", 1)[0]:
        return None
    return canonical


def public_http_url(url: str) -> bool:
    """True for an http(s) URL whose host is not obviously internal.

    Host names are not resolved (no DNS in this check): a public name that
    resolves to a private address is not caught. IP literals must be globally
    routable; IPv4-mapped IPv6 literals are judged by their IPv4 part.
    """
    try:
        parsed = httpx.URL(url)
    except (httpx.InvalidURL, ValueError):
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = parsed.host.lower().rstrip(".")
    if not host:
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if host == "localhost" or host.endswith(_LOCAL_SUFFIXES):
            return False
        # Numeric shorthand such as 2130706433 or 0x7f.1 is an address, not a name.
        last = host.rsplit(".", 1)[-1]
        return not (last.isdigit() or last.startswith("0x"))
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _read_capped(response: httpx.Response) -> bytes:
    declared = response.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BYTES:
        raise FetchRefused("response too large")
    body = bytearray()
    for chunk in response.iter_bytes():
        body.extend(chunk)
        if len(body) > MAX_BYTES:
            raise FetchRefused("response too large")
    return bytes(body)


def get(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    """GET with a size cap and redirects followed only to public http(s) URLs."""
    kwargs["follow_redirects"] = False
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        if not public_http_url(current):
            raise FetchRefused("refused non-public or non-http(s) address")
        with client.stream("GET", current, **kwargs) as response:
            location = response.headers.get("location")
            if response.status_code in _REDIRECTS and location:
                current = str(httpx.URL(current).join(location))
                continue
            body = _read_capped(response)
            headers = [
                (k, v)
                for k, v in response.headers.multi_items()
                if k.lower() not in ("content-encoding", "content-length")
            ]
            return httpx.Response(
                response.status_code, headers=headers, content=body, request=response.request
            )
    raise FetchRefused("too many redirects")
