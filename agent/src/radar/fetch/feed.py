"""RSS/Atom fetcher."""

import calendar
from datetime import UTC, datetime

import feedparser
import httpx

from radar.fetch.common import get, limit_items, safe_canonical
from radar.models import RawItem, Source
from radar.text import clean_summary

MAX_TITLE_CHARS = 1000  # only against a hostile feed; real titles are far shorter


def _published(entry, now: datetime) -> datetime:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if parsed is None:
        return now
    return datetime.fromtimestamp(calendar.timegm(parsed), tz=UTC)


def fetch_feed(source: Source, client: httpx.Client, now: datetime) -> list[RawItem]:
    response = get(client, source.url)
    response.raise_for_status()
    # feedparser's HTML sanitiser (and its relative-link rewriter) is quadratic on a
    # hostile body, so both are off. Every text taken from an entry goes through
    # clean_summary instead, which drops all markup in linear time.
    parsed = feedparser.parse(response.content, sanitize_html=False, resolve_relative_uris=False)
    items = []
    for entry in parsed.entries:
        link = entry.get("link")
        title = clean_summary(entry.get("title") or "", limit=MAX_TITLE_CHARS)
        url = safe_canonical(link) if link else None
        if not url or not title:
            continue
        items.append(
            RawItem(
                source_id=source.id,
                url=url,
                title=title,
                summary=clean_summary(entry.get("summary") or ""),
                published_at=_published(entry, now),
            )
        )
    # Unrecognised document (even well-formed HTML has an empty version) or broken XML.
    if not items and (parsed.get("bozo") or not parsed.get("version")):
        raise ValueError("not a feed")
    return limit_items(items, now)
