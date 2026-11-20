from datetime import UTC, datetime

import pytest

from radar.fetch import common
from radar.models import Draft, FactCard, RawItem, Score, Source, StoryText, Tier
from radar.store import SqliteStore


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    """Every name resolves to one public address, so no test needs the network.
    Tests about resolution replace the resolver themselves."""
    monkeypatch.setattr(common, "_resolver", lambda host: ["93.184.216.34"])


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


@pytest.fixture
def cluster_id(store, now) -> int:
    return store.create_cluster("A2UI 1.0", now)


@pytest.fixture
def run_id(store, now) -> int:
    return store.start_run("agent", now)


@pytest.fixture
def score(cluster_id) -> Score:
    return Score(
        cluster_id=cluster_id,
        relevance=5,
        novelty=4,
        usefulness=3,
        category="protocol",
        risk_flags=["regulation"],
    )


@pytest.fixture
def draft() -> Draft:
    return Draft(
        fact_card=FactCard(
            what="A2UI 1.0 was released.",
            who=["GitHub"],
            numbers=["1.0"],
            versions=["1.0"],
            try_url="https://github.com/a2ui",
        ),
        tr=StoryText(
            title="A2UI 1.0 çıktı: İlk kararlı sürüm",
            summary="Arayüz protokolü artık kararlı; öğrenmesi kolay, üretimde güvenli, şık.",
            dev_line="Şimdi deneyin: örnek uygulamayı çalıştırın.",
        ),
        en=StoryText(
            title="A2UI 1.0 ships",
            summary="The UI protocol is now stable.",
            dev_line="Try the sample app today.",
        ),
    )
