"""Hacker News (Algolia search API) fetcher."""

from datetime import UTC, datetime

import httpx

from radar.fetch.common import limit_items
from radar.models import RawItem, Source
from radar.urls import canonicalize


def fetch_hn(source: Source, client: httpx.Client, now: datetime) -> list[RawItem]:
    response = client.get(source.url)
    response.raise_for_status()
    items = []
    for hit in response.json().get("hits", []):
        title = (hit.get("title") or "").strip()
        object_id = hit.get("objectID")
        url = hit.get("url") or (
            f"https://news.ycombinator.com/item?id={object_id}" if object_id else None
        )
        created = hit.get("created_at_i")
        if not title or not url or created is None:
            continue
        items.append(
            RawItem(
                source_id=source.id,
                url=canonicalize(url),
                title=title,
                published_at=datetime.fromtimestamp(created, tz=UTC),
                points=hit.get("points") or 0,
            )
        )
    return limit_items(items, now)
