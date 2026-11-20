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
    # news.test is not the site of either source that carried it: each shows its own site.
    assert store.story_sources(cluster_id) == [
        {"name": "GitHub Blog", "url": "https://github.blog/post", "tier": 1},
        {"name": "Hacker News", "url": "https://news.ycombinator.com/", "tier": 2},
        {"name": "Webrazzi AI", "url": "https://webrazzi.com/", "tier": 4},
    ]
    assert store.story_sources(999) == []


def _cluster_of(store, cluster_id, now, *items):
    from radar.models import RawItem

    store.insert_items(
        [
            RawItem(source_id=sid, url=url, title="t", published_at=now + timedelta(minutes=i))
            for i, (sid, url) in enumerate(items)
        ]
    )
    for stored in store.items_since(now - timedelta(hours=1)):
        store.set_cluster(stored.id, cluster_id)
    return store.story_sources(cluster_id)


def test_a_hacker_news_item_never_links_to_the_submitted_page(store, cluster_id, now):
    sources = _cluster_of(
        store,
        cluster_id,
        now,
        ("github-blog", "https://github.blog/a2ui"),
        ("hn", "https://evil.example/fake-release"),
        ("hn", "https://sub.evil.example/other"),
    )
    assert all("evil.example" not in s["url"] for s in sources)
    assert sources == [
        {"name": "GitHub Blog", "url": "https://github.blog/a2ui", "tier": 1},
        {"name": "Hacker News", "url": "https://news.ycombinator.com/", "tier": 2},
    ]


def test_a_hacker_news_discussion_link_is_kept(store, cluster_id, now):
    sources = _cluster_of(store, cluster_id, now, ("hn", "https://news.ycombinator.com/item?id=1"))
    assert [s["url"] for s in sources] == ["https://news.ycombinator.com/item?id=1"]


def test_a_feed_item_on_its_own_site_or_a_subdomain_is_kept(store, cluster_id, now):
    sources = _cluster_of(
        store,
        cluster_id,
        now,
        ("github-blog", "https://github.blog/post"),
        ("github-blog", "https://www.github.blog/other"),
        ("webrazzi-ai", "https://ai.webrazzi.com/haber"),
    )
    assert [s["url"] for s in sources] == [
        "https://github.blog/post",
        "https://www.github.blog/other",
        "https://ai.webrazzi.com/haber",
    ]


def test_a_feed_item_on_another_site_shows_the_feeds_own_site(store, cluster_id, now):
    sources = _cluster_of(
        store,
        cluster_id,
        now,
        ("webrazzi-ai", "https://evil.example/webrazzi.com"),
        ("github-blog", "https://notgithub.blog/x"),
        ("github-blog", "https://blog/x"),
    )
    assert [s["url"] for s in sources] == ["https://github.blog/", "https://webrazzi.com/"]


def test_attempts_are_recorded_oldest_first(store, cluster_id, run_id, now):
    later = now + timedelta(hours=1)
    store.record_attempt(cluster_id=cluster_id, run_id=run_id, outcome="failed", at=later)
    store.record_attempt(cluster_id=cluster_id, run_id=None, outcome="thin", at=now)
    assert store.attempts_for([cluster_id, 999]) == {cluster_id: [now, later]}
    assert store.attempts_for([]) == {}


def two_stories(store, cluster_id, run_id, score, draft, now):
    _insert(store, cluster_id, run_id, score, draft, now)
    other = store.create_cluster("Other", now)
    _insert(store, other, run_id, score.model_copy(update={"cluster_id": other}), draft, now)
    return store.stories_since(now - timedelta(hours=1))


def test_mark_refused_parks_a_story_and_clear_refused_releases_it(
    store, cluster_id, run_id, score, draft, now
):
    first, second = two_stories(store, cluster_id, run_id, score, draft, now)
    later = now + timedelta(hours=1)
    store.mark_refused(first.uid, "texts.tr.title", later)
    assert [s.uid for s in store.unpushed_stories()] == [second.uid]
    assert [s.uid for s in store.unpushed_stories(include_refused=True)] == [first.uid, second.uid]
    (parked,) = store.refused_stories()
    assert parked.uid == first.uid and parked.refused_at == later
    assert parked.refused_path == "texts.tr.title"
    store.clear_refused([first.uid])
    store.clear_refused([])
    assert store.refused_stories() == []
    assert [s.uid for s in store.unpushed_stories()] == [first.uid, second.uid]


def test_refused_stories_are_oldest_refusal_first_and_exclude_pushed(
    store, cluster_id, run_id, score, draft, now
):
    first, second = two_stories(store, cluster_id, run_id, score, draft, now)
    store.mark_refused(second.uid, "a", now)
    store.mark_refused(first.uid, "b", now + timedelta(hours=1))
    assert [s.uid for s in store.refused_stories()] == [second.uid, first.uid]
    store.mark_pushed([second.uid], now)
    assert [s.uid for s in store.refused_stories()] == [first.uid]


def test_mark_pushed_clears_a_refusal(store, cluster_id, run_id, score, draft, now):
    (first, _) = two_stories(store, cluster_id, run_id, score, draft, now)
    store.mark_refused(first.uid, "a", now)
    store.mark_pushed([first.uid], now)
    row = store._conn.execute("SELECT refused_at, refused_path FROM stories WHERE id = ?", (1,))
    assert tuple(row.fetchone()) == (None, None)


def test_migration_0004_adds_the_columns_and_keeps_existing_rows(tmp_path):
    import shutil
    from pathlib import Path

    from radar.store import SqliteStore

    source = Path(__file__).resolve().parents[2] / "db" / "migrations"
    old = tmp_path / "old"
    old.mkdir()
    for name in ("0001_init.sql", "0002_stories.sql", "0003_publish.sql"):
        shutil.copy(source / name, old / name)
    path = str(tmp_path / "m.db")
    first = SqliteStore(path, str(old))
    first.create_cluster("C", datetime(2026, 11, 19, tzinfo=UTC))
    first._conn.execute("INSERT INTO runs (kind, started_at) VALUES ('run', 'x')")
    first._conn.execute(
        "INSERT INTO stories (cluster_id, run_id, category, status, score, fact_card, "
        "source_url, source_count, created_at, uid) "
        "VALUES (1, 1, 'tooling', 'review', '{}', '{}', 'https://e.com', 1, 'x', 'u1')"
    )
    first._conn.commit()
    first.close()
    shutil.copy(source / "0004_refused.sql", old / "0004_refused.sql")
    again = SqliteStore(path, str(old))
    try:
        row = again._conn.execute("SELECT * FROM stories").fetchone()
    finally:
        again.close()
    assert row["uid"] == "u1" and row["source_url"] == "https://e.com"
    assert row["refused_at"] is None and row["refused_path"] is None
