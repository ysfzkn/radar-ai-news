"""Per-source limits shared by every fetcher."""

import ipaddress
import socket
import time
from datetime import datetime, timedelta

import httpx

from radar.models import RawItem
from radar.urls import canonicalize

MAX_ITEMS = 50
MAX_AGE = timedelta(hours=72)
MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
MAX_SECONDS = 20.0  # for a whole fetch, redirects included; the client's timeout is per read
_REDIRECTS = (301, 302, 303, 307, 308)
_LOCAL_SUFFIXES = (".localhost", ".local", ".internal")
_clock = time.monotonic  # replaced in tests


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


def _global(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Globally routable unicast; an IPv4-mapped IPv6 address is judged by its IPv4 part."""
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def public_http_url(url: str) -> bool:
    """True for an http(s) URL whose host is not obviously internal.

    Host names are not resolved here (see `resolves_public`, which `get` also applies).
    IP literals must be globally routable.
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
    return _global(ip)


def resolve(host: str) -> list[str]:
    """Every address the system resolver gives for `host` (OSError when there is none)."""
    return [str(info[4][0]) for info in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)]


_resolver = resolve  # replaced in tests, which must not need the network


def resolves_public(url: str) -> bool:
    """True when the URL's host is an IP literal or a name whose every address is global.

    The connection resolves the name again, so a name whose answer changes between the
    two lookups (DNS rebinding with a very short TTL) is not caught; that would need the
    connection pinned to the checked address.
    """
    host = httpx.URL(url).host
    try:
        ipaddress.ip_address(host)
        return True  # a literal: already judged by public_http_url
    except ValueError:
        pass
    try:
        addresses = _resolver(host)
    except (OSError, UnicodeError):
        return False
    try:
        ips = [ipaddress.ip_address(a.split("%", 1)[0]) for a in addresses]
    except ValueError:
        return False
    return bool(ips) and all(_global(ip) for ip in ips)


def _check_deadline(deadline: float) -> None:
    if _clock() > deadline:
        raise FetchRefused("response too slow")


def _read_capped(response: httpx.Response, deadline: float) -> bytes:
    declared = response.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BYTES:
        raise FetchRefused("response too large")
    body = bytearray()
    for chunk in response.iter_bytes():
        body.extend(chunk)
        if len(body) > MAX_BYTES:
            raise FetchRefused("response too large")
        _check_deadline(deadline)
    return bytes(body)


def get(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    """GET with a size cap, a total deadline and redirects followed only to public
    http(s) URLs (names are resolved first and refused when any address is not global).

    The deadline is checked between chunks, so a server that stalls inside one read is
    still bounded by the client's per-read timeout on top of MAX_SECONDS.
    """
    kwargs["follow_redirects"] = False
    deadline = _clock() + MAX_SECONDS
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        if not public_http_url(current) or not resolves_public(current):
            raise FetchRefused("refused non-public or non-http(s) address")
        _check_deadline(deadline)
        with client.stream("GET", current, **kwargs) as response:
            location = response.headers.get("location")
            if response.status_code in _REDIRECTS and location:
                current = str(httpx.URL(current).join(location))
                continue
            body = _read_capped(response, deadline)
            headers = [
                (k, v)
                for k, v in response.headers.multi_items()
                if k.lower() not in ("content-encoding", "content-length")
            ]
            return httpx.Response(
                response.status_code, headers=headers, content=body, request=response.request
            )
    raise FetchRefused("too many redirects")
