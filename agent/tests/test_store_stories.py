import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from radar.models import Score


def test_score_total():
    s = Score(cluster_id=1, relevance=5, novelty=4, usefulness=3, category="protocol")
    assert s.total == 4.1


def test_score_out_of_range_rejected():
    with pytest.raises(ValidationError):
        Score(cluster_id=1, relevance=7, novelty=4, usefulness=3, category="protocol")


def test_scores_roundtrip_and_upsert(store, cluster_id, score, now):
    store.save_scores([score], now)
    assert store.scores_for([cluster_id, 999]) == {cluster_id: score}
    changed = score.model_copy(update={"relevance": 2, "risk_flags": ["accusation", "regulation"]})
    store.save_scores([changed], now)
    got = store.scores_for([cluster_id])[cluster_id]
    assert got.relevance == 2 and got.risk_flags == ["accusation", "regulation"]
    assert store.scores_for([]) == {}


def _insert(store, cluster_id, run_id, score, draft, now, status="published", reasons=()):
    return store.insert_story(
        cluster_id=cluster_id,
        run_id=run_id,
        status=status,
        reasons=list(reasons),
        score=score,
        draft=draft,
        source_url="https://e.com/a",
        source_count=2,
        created_at=now,
    )


def test_story_roundtrip(store, cluster_id, run_id, score, draft, now):
    sid = _insert(store, cluster_id, run_id, score, draft, now)
    [story] = store.stories_since(now - timedelta(hours=1))
    assert story.id == sid and story.draft == draft and story.published_at == now
    assert story.score == score and story.category == "protocol"
    assert story.score.cluster_id == story.cluster_id == cluster_id
    assert story.draft.tr.title.startswith("A2UI 1.0 çıktı: İlk")
    assert store.story_cluster_ids([cluster_id, 999]) == {cluster_id}
    assert store.story_cluster_ids([]) == set()


def test_review_story_has_no_published_at(store, cluster_id, run_id, score, draft, now):
    _insert(store, cluster_id, run_id, score, draft, now, "review", ["risk: regulation"])
    [story] = store.stories_since(now - timedelta(hours=1))
    assert story.status == "review" and story.published_at is None
    assert story.reasons == ["risk: regulation"]


def test_one_story_per_cluster(store, cluster_id, run_id, score, draft, now):
    _insert(store, cluster_id, run_id, score, draft, now)
    with pytest.raises(sqlite3.IntegrityError):
        _insert(store, cluster_id, run_id, score, draft, now)
    assert len(store.stories_since(now - timedelta(hours=1))) == 1


def test_stories_since_filters_by_status_and_time(store, cluster_id, run_id, score, draft, now):
    other = store.create_cluster("Other", now)
    _insert(store, cluster_id, run_id, score, draft, now)
    other_score = score.model_copy(update={"cluster_id": other})
    _insert(store, other, run_id, other_score, draft, now + timedelta(minutes=1), "review")
    since = now - timedelta(hours=1)
    assert [s.status for s in store.stories_since(since)] == ["published", "review"]
    assert [s.cluster_id for s in store.stories_since(since, "review")] == [other]
    assert [s.cluster_id for s in store.stories_since(since, "published")] == [cluster_id]
    assert store.stories_since(now + timedelta(hours=1)) == []


def test_usage_roundtrip(store, run_id, now):
    store.record_usage(
        run_id=run_id,
        step="score",
        model="claude-haiku-5-5",
        input_tokens=1000,
        output_tokens=200,
        cost_usd=0.0002,
        at=now,
    )
    store.record_usage(
        run_id=None,
        step="write",
        model="claude-sonnet-5-5",
        input_tokens=3000,
        output_tokens=900,
        cost_usd=0.015,
        at=now,
    )
    rows = store.usage_since(now - timedelta(hours=1))
    assert [r["step"] for r in rows] == ["score", "write"]
    assert rows[0]["cost_usd"] == 0.0002 and rows[1]["output_tokens"] == 900
    assert rows[0]["at"] == now and rows[0]["at"].tzinfo is not None
    assert rows[0]["at"].utcoffset() == timedelta(0) and rows[0]["at"].tzinfo == UTC
    assert store.usage_since(now + timedelta(hours=1)) == []


def test_inserted_story_has_a_32_hex_uid_and_is_unpushed(
    store, cluster_id, run_id, score, draft, now
):
    import re

    _insert(store, cluster_id, run_id, score, draft, now)
    other = store.create_cluster("Other", now)
    _insert(store, other, run_id, score.model_copy(update={"cluster_id": other}), draft, now)
    first, second = store.stories_since(now - timedelta(hours=1))
    assert re.fullmatch(r"[0-9a-f]{32}", first.uid) and re.fullmatch(r"[0-9a-f]{32}", second.uid)
    assert first.uid != second.uid
    assert first.pushed_at is None and second.pushed_at is None


def test_existing_stories_get_a_uid_when_migrating(tmp_path):
    import re
    import shutil
    from pathlib import Path

    from radar.store import SqliteStore

    source = Path(__file__).resolve().parents[2] / "db" / "migrations"
    old = tmp_path / "old"
    old.mkdir()
    for name in ("0001_init.sql", "0002_stories.sql"):
        shutil.copy(source / name, old / name)
    path = str(tmp_path / "m.db")
    first = SqliteStore(path, str(old))
    first.create_cluster("C", datetime(2026, 11, 19, tzinfo=UTC))
    first._conn.execute("INSERT INTO runs (kind, started_at) VALUES ('run', 'x')")
    first._conn.execute(
        "INSERT INTO stories (cluster_id, run_id, category, status, score, fact_card, "
        "source_url, source_count, created_at) "
        "VALUES (1, 1, 'tooling', 'review', '{}', '{}', 'https://e.com', 1, 'x')"
    )
    first._conn.commit()
    first.close()
    shutil.copy(source / "0003_publish.sql", old / "0003_publish.sql")
    again = SqliteStore(path, str(old))
    try:
        row = again._conn.execute("SELECT uid, pushed_at FROM stories").fetchone()
    finally:
        again.close()
    assert re.fullmatch(r"[0-9a-f]{32}", row["uid"]) and row["pushed_at"] is None


def test_mark_pushed_removes_stories_from_unpushed(store, cluster_id, run_id, score, draft, now):
    _insert(store, cluster_id, run_id, score, draft, now)
    other = store.create_cluster("Other", now)
    _insert(store, other, run_id, score.model_copy(update={"cluster_id": other}), draft, now)
    first, second = store.stories_since(now - timedelta(hours=1))
    assert [s.uid for s in store.unpushed_stories()] == [first.uid, second.uid]
    store.mark_pushed([first.uid], now)
    assert [s.uid for s in store.unpushed_stories()] == [second.uid]
    pushed = store.stories_since(now - timedelta(hours=1))[0]
    assert pushed.pushed_at == now
    store.mark_pushed([], now)


def test_story_sources_orders_by_tier_and_drops_duplicate_urls(store, cluster_id, now):
    from radar.models import RawItem

    def item(source_id, url, minutes):
        return RawItem(
            source_id=source_id,
            url=url,
            title="t",
            published_at=now + timedelta(minutes=minutes),
        )

    store.insert_items(
        [
            item("hn", "https://news.test/thread", 0),
            item("github-blog", "https://github.blog/post", 5),
            item("webrazzi-ai", "https://news.test/thread", 9),
        ]
    )
    for stored in store.items_since(now - timedelta(hours=1)):
        store.set_cluster(stored.id, cluster_id)
    assert store.story_sources(cluster_id) == [
        {"name": "GitHub Blog", "url": "https://github.blog/post", "tier": 1},
        {"name": "Hacker News", "url": "https://news.test/thread", "tier": 2},
    ]
    assert store.story_sources(999) == []


def test_attempts_are_recorded_oldest_first(store, cluster_id, run_id, now):
    later = now + timedelta(hours=1)
    store.record_attempt(cluster_id=cluster_id, run_id=run_id, outcome="failed", at=later)
    store.record_attempt(cluster_id=cluster_id, run_id=None, outcome="thin", at=now)
    assert store.attempts_for([cluster_id, 999]) == {cluster_id: [now, later]}
    assert store.attempts_for([]) == {}
