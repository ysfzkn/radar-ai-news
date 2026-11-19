from datetime import timedelta

from radar.cluster import assign_clusters
from radar.models import RawItem


def _raw(source_id, url, title, at):
    return RawItem(source_id=source_id, url=url, title=title, published_at=at)


def test_same_url_from_two_sources_clusters(store, now):
    url = "https://github.blog/a2ui-1-0"
    stored = store.insert_items(
        [
            _raw("github-blog", url, "Announcing the first protocol milestone", now),
            _raw("hn", url, "Show HN: agents render their own widgets", now),
        ]
    )
    created = assign_clusters(store, stored, now)
    clusters = store.clusters_since(now - timedelta(hours=72))
    assert created == 1
    assert len(clusters) == 1
    assert len(clusters[0].items) == 2


def test_similar_titles_cluster(store, now):
    stored = store.insert_items(
        [
            _raw("github-blog", "https://a.example/1", "A2UI 1.0 is now a release candidate!", now),
            _raw("hn", "https://b.example/2", "Google ships A2UI 1.0 release candidate", now),
        ]
    )
    assert assign_clusters(store, stored, now) == 1
    assert len(store.clusters_since(now - timedelta(hours=72))[0].items) == 2


def test_unrelated_titles_do_not_cluster(store, now):
    stored = store.insert_items(
        [
            _raw("github-blog", "https://a.example/1", "A2UI 1.0 is now a release candidate!", now),
            _raw("hn", "https://b.example/2", "LangGraph 2.0 released", now),
        ]
    )
    assert assign_clusters(store, stored, now) == 2
    assert len(store.clusters_since(now - timedelta(hours=72))) == 2


def test_turkish_and_english_titles_cluster_by_url(store, now):
    url = "https://github.blog/a2ui-1-0"
    stored = store.insert_items(
        [
            _raw("webrazzi-ai", url, "A2UI 1.0 aday sürüme geçti", now),
            _raw("hn", url, "A2UI 1.0 release candidate", now),
        ]
    )
    assert assign_clusters(store, stored, now) == 1
    assert len(store.clusters_since(now - timedelta(hours=72))[0].items) == 2


def test_joins_cluster_from_an_earlier_run(store, now):
    first = store.insert_items(
        [_raw("github-blog", "https://a.example/1", "A2UI 1.0 is now a release candidate!", now)]
    )
    assert assign_clusters(store, first, now) == 1
    later = now + timedelta(hours=1)
    second = store.insert_items(
        [_raw("hn", "https://b.example/2", "Google ships A2UI 1.0 release candidate", later)]
    )
    assert assign_clusters(store, second, later) == 0
    clusters = store.clusters_since(now - timedelta(hours=72))
    assert len(clusters) == 1
    assert len(clusters[0].items) == 2


def test_cluster_older_than_72h_is_not_joined(store, now):
    old = now - timedelta(hours=73)
    first = store.insert_items(
        [_raw("github-blog", "https://a.example/1", "A2UI 1.0 is now a release candidate!", old)]
    )
    assert assign_clusters(store, first, old) == 1
    second = store.insert_items(
        [_raw("hn", "https://b.example/2", "Google ships A2UI 1.0 release candidate", now)]
    )
    assert assign_clusters(store, second, now) == 1
    assert len(store.clusters_since(old)) == 2
