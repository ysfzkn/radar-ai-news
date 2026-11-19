from datetime import timedelta

from radar.store import SqliteStore


def test_insert_items_is_idempotent(store, item):
    assert len(store.insert_items([item])) == 1
    assert store.insert_items([item]) == []
    assert len(store.items_since(item.published_at - timedelta(hours=1))) == 1


def test_same_url_from_two_sources_is_two_items(store, item):
    other = item.model_copy(update={"source_id": "hn"})
    assert len(store.insert_items([item, other])) == 2


def test_cluster_roundtrip(store, item):
    [stored] = store.insert_items([item])
    cid = store.create_cluster("A2UI 1.0", item.published_at)
    store.set_cluster(stored.id, cid)
    [cluster] = store.clusters_since(item.published_at - timedelta(hours=1))
    assert cluster.id == cid and [i.id for i in cluster.items] == [stored.id]
    assert cluster.first_seen.tzinfo is not None
    assert cluster.items[0].published_at.utcoffset() == timedelta(0)


def test_run_record(store, now):
    rid = store.start_run("collect", now)
    store.finish_run(rid, now, {"new_items": 3, "llm_calls": 0})
    assert store.last_run()["stats"] == {"new_items": 3, "llm_calls": 0}


def test_migrations_apply_once(tmp_path):
    path = str(tmp_path / "a.db")
    first = SqliteStore(path)
    first.close()
    second = SqliteStore(path)  # second open must not raise
    second.close()
