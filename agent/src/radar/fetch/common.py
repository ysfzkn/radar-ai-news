"""Per-source limits shared by every fetcher."""

from datetime import datetime, timedelta

from radar.models import RawItem
from radar.urls import canonicalize

MAX_ITEMS = 50
MAX_AGE = timedelta(hours=72)


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
