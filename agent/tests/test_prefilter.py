from datetime import UTC, datetime, timedelta

from radar.models import Cluster, Source, StoredItem, Tier
from radar.prefilter import rank_candidates

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


def _source(sid, tier, weight=1.0):
    return Source(
        id=sid, name=sid, tier=tier, kind="feed", url=f"https://{sid}.example/feed", weight=weight
    )


def _item(n, sid, points=0, url=None, title=None, age_hours=1):
    return StoredItem(
        id=n,
        source_id=sid,
        url=url or f"https://{sid}.example/{n}",
        title=title or f"title {sid}",
        summary=f"summary {sid}",
        published_at=NOW - timedelta(hours=age_hours),
        points=points,
    )


def _cluster(cid, items, age_hours=2):
    seen = NOW - timedelta(hours=age_hours)
    return Cluster(id=cid, title=f"cluster {cid}", first_seen=seen, items=items)


def test_scores():
    sources = [
        _source("p", Tier.PRIMARY),
        _source("c1", Tier.COMMUNITY),
        _source("c2", Tier.COMMUNITY),
        _source("c3", Tier.COMMUNITY),
        _source("t", Tier.TURKEY),
    ]
    clusters = [
        _cluster(1, [_item(1, "p")]),
        _cluster(2, [_item(2, "c1", 500), _item(3, "c2"), _item(4, "c3")]),
        _cluster(3, [_item(5, "t")]),
    ]
    by_id = {c.cluster_id: c for c in rank_candidates(clusters, sources, NOW)}
    assert by_id[1].score == 3.0
    assert by_id[1].has_primary and not by_id[1].is_turkey
    assert by_id[2].score == 5.0
    assert by_id[2].source_count == 3
    assert not by_id[2].has_primary
    assert by_id[3].score == 3.0
    assert by_id[3].is_turkey


def test_order_and_limit():
    sources = [_source("p", Tier.PRIMARY), _source("c", Tier.COMMUNITY)]
    clusters = [
        _cluster(1, [_item(1, "c")]),
        _cluster(2, [_item(2, "p"), _item(3, "c", 500)]),
        _cluster(3, [_item(4, "p")]),
    ]
    ranked = rank_candidates(clusters, sources, NOW)
    assert [c.cluster_id for c in ranked] == [2, 3, 1]
    assert ranked[0].score == 6.0
    assert len(rank_candidates(clusters, sources, NOW, limit=2)) == 2


def test_points_are_capped_at_500():
    sources = [_source("c", Tier.COMMUNITY)]
    capped = rank_candidates([_cluster(1, [_item(1, "c", 5000)])], sources, NOW)
    normal = rank_candidates([_cluster(1, [_item(1, "c", 500)])], sources, NOW)
    assert capped[0].score == normal[0].score == 3.0


def test_uses_primary_item_for_url_and_title():
    sources = [_source("c", Tier.COMMUNITY), _source("p", Tier.PRIMARY)]
    items = [
        _item(1, "c", url="https://c.example/x", title="community take", age_hours=5),
        _item(2, "p", url="https://p.example/x", title="official post", age_hours=1),
    ]
    cand = rank_candidates([_cluster(1, items)], sources, NOW)[0]
    assert cand.url == "https://p.example/x"
    assert cand.title == "official post"
    assert cand.summary == "summary p"


def test_skips_clusters_older_than_36h():
    sources = [_source("p", Tier.PRIMARY)]
    clusters = [
        _cluster(1, [_item(1, "p")], age_hours=37),
        _cluster(2, [_item(2, "p")], age_hours=35),
    ]
    assert [c.cluster_id for c in rank_candidates(clusters, sources, NOW)] == [2]
