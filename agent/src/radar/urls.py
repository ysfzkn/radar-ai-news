"""URL canonicalization used for de-duplication."""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_DROPPED_PARAMS = {"ref", "source", "fbclid", "gclid"}


def _is_dropped(name: str) -> bool:
    return name.startswith("utm_") or name in _DROPPED_PARAMS


def canonicalize(url: str) -> str:
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    host = host.removeprefix("www.")
    if parts.port:
        host = f"{host}:{parts.port}"
    path = parts.path
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/") or "/"
    query = urlencode(
        [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _is_dropped(k)]
    )
    return urlunsplit(("https", host, path, query, ""))
