"""Per-source limits shared by every fetcher."""

import ipaddress
import socket
import threading
import time
import zlib
from datetime import datetime, timedelta

import httpx

from radar.models import RawItem
from radar.urls import canonicalize

MAX_ITEMS = 50
# Items up to 14 days old are kept, so a story the store never saw while it was fresh can
# still be chosen from the backlog (prefilter.LOOKBACK).
MAX_AGE = timedelta(days=14)
MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
MAX_SECONDS = 20.0  # for a whole fetch, redirects included; the client's timeout is per read
# Real seconds after which a fetch is given up even when nothing came to check the
# deadline against: MAX_SECONDS plus one read timeout (make_client's 15 s).
HARD_SECONDS = MAX_SECONDS + 15.0
_REDIRECTS = (301, 302, 303, 307, 308)
_LOCAL_SUFFIXES = (".localhost", ".local", ".internal")
_clock = time.monotonic  # replaced in tests


class FetchRefused(Exception):
    """A source URL or response the fetcher will not accept (short, safe reason)."""


def limit_items(items: list[RawItem], now: datetime) -> list[RawItem]:
    """Drop items older than MAX_AGE (14 days), sort newest first, keep at most 50."""
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


# IPv6 ranges that reach an IPv4 address or a local network, which `is_global` lets
# through: NAT64 well-known prefix, IPv4-compatible, SIIT (IPv4-translated).
_NOT_PUBLIC_V6 = tuple(
    ipaddress.ip_network(n) for n in ("64:ff9b::/96", "::/96", "::ffff:0:0:0/96")
)


def _global(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Globally routable unicast; an IPv4-mapped IPv6 address is judged by its IPv4 part."""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif ip.is_site_local or any(ip in net for net in _NOT_PUBLIC_V6):
            return False
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
    # The name the connection will use (IDNA 2008 as httpx encodes it), not the Unicode
    # form, which the system resolver may encode differently (faß.de: fass.de, not
    # xn--fa-hia.de).
    host = httpx.URL(url).raw_host.decode("ascii")
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


def _decoder(response: httpx.Response):
    """A gzip decompressor for a gzip body, None for an unencoded one; anything else is
    refused (only gzip is asked for)."""
    encoding = response.headers.get("content-encoding", "").strip().lower()
    if encoding in ("", "identity"):
        return None
    if encoding in ("gzip", "x-gzip"):
        return zlib.decompressobj(16 + zlib.MAX_WBITS)
    raise FetchRefused("unsupported content encoding")


def _read_capped(response: httpx.Response, deadline: float) -> bytes:
    """The decoded body. The cap and the deadline apply to the raw bytes as they arrive,
    so a compressed body that decodes to little or nothing is still bounded, and the
    decoded body is capped while it is decompressed, never built whole first."""
    declared = response.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BYTES:
        raise FetchRefused("response too large")
    decoder = _decoder(response)
    if response.is_stream_consumed:
        # Built in memory, already read and decoded (a test transport): nothing to stream.
        if len(response.content) > MAX_BYTES:
            raise FetchRefused("response too large")
        return response.content
    raw = 0
    body = bytearray()
    for chunk in response.iter_raw():
        raw += len(chunk)
        if raw > MAX_BYTES:
            raise FetchRefused("response too large")
        if decoder is None:
            body.extend(chunk)
        else:
            try:
                body.extend(decoder.decompress(chunk, MAX_BYTES + 1 - len(body)))
            except zlib.error:
                raise httpx.DecodingError("bad gzip body", request=response.request) from None
        if len(body) > MAX_BYTES:
            raise FetchRefused("response too large")
        _check_deadline(deadline)
    return bytes(body)


def _get(client: httpx.Client, url: str, deadline: float, kwargs: dict) -> httpx.Response:
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        _check_deadline(deadline)
        if not public_http_url(current) or not resolves_public(current):
            raise FetchRefused("refused non-public or non-http(s) address")
        _check_deadline(deadline)
        with client.stream("GET", current, **kwargs) as response:
            _check_deadline(deadline)
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


def get(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    """GET with a size cap, a total deadline and redirects followed only to public
    http(s) URLs (names are resolved first and refused when any address is not global).

    The deadline (MAX_SECONDS, on `_clock`) is checked before each hop, after each name
    lookup, once the headers are in and after every raw chunk of the body. A wait that
    yields nothing to check (a name server that never answers, headers sent a byte at a
    time) is cut by a hard stop instead: the fetch runs in a worker thread and is given
    up after HARD_SECONDS of real time. The worker is a daemon thread; once given up it
    stops at its next deadline check or read timeout, and holds nothing the caller waits on.
    """
    kwargs["follow_redirects"] = False
    kwargs["headers"] = {**(kwargs.get("headers") or {}), "Accept-Encoding": "gzip"}
    deadline = _clock() + MAX_SECONDS
    result: list = []

    def work() -> None:
        try:
            result.append((True, _get(client, url, deadline, kwargs)))
        except BaseException as exc:  # handed to the caller below
            result.append((False, exc))

    worker = threading.Thread(target=work, name="radar-fetch", daemon=True)
    worker.start()
    worker.join(HARD_SECONDS)
    if not result:
        raise FetchRefused("response too slow")
    ok, value = result[0]
    if not ok:
        raise value
    return value
