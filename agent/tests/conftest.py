from datetime import UTC, datetime

import pytest

from radar.models import RawItem, Source, Tier
from radar.store import SqliteStore


@pytest.fixture
def now() -> datetime:
    return datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


@pytest.fixture
def item(now) -> RawItem:
    return RawItem(
        source_id="github-blog",
        url="https://github.blog/a2ui-1-0",
        title="A2UI 1.0",
        summary="Announcing A2UI 1.0.",
        published_at=now,
        points=0,
    )


@pytest.fixture
def store(tmp_path):
    s = SqliteStore(str(tmp_path / "radar.db"))
    s.upsert_sources(
        [
            Source(
                id="github-blog",
                name="GitHub Blog",
                tier=Tier.PRIMARY,
                kind="feed",
                url="https://github.blog/feed/",
            ),
            Source(
                id="hn",
                name="Hacker News",
                tier=Tier.COMMUNITY,
                kind="hn",
                url="https://hacker-news.firebaseio.com/v0",
            ),
            Source(
                id="webrazzi-ai",
                name="Webrazzi AI",
                tier=Tier.TURKEY,
                kind="feed",
                url="https://webrazzi.com/feed/",
                lang="tr",
            ),
        ]
    )
    yield s
    s.close()
