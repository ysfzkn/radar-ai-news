import sqlite3
from datetime import datetime, timedelta

import pytest
from pydantic import ValidationError

from radar.models import RawItem
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


def test_failed_migration_leaves_nothing_behind(tmp_path):
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_ok.sql").write_text("CREATE TABLE a (x INTEGER);", encoding="utf-8")
    bad = migrations / "0002_bad.sql"
    bad.write_text("CREATE TABLE b (x INTEGER); THIS IS NOT SQL;", encoding="utf-8")
    path = str(tmp_path / "m.db")
    with pytest.raises(sqlite3.Error):
        SqliteStore(path, str(migrations))
    # Closing the connection would discard an open transaction anyway, so also
    # check the rollback on a live connection.
    bad.unlink()
    live = SqliteStore(path, str(migrations))
    try:
        bad.write_text("CREATE TABLE b (x INTEGER); THIS IS NOT SQL;", encoding="utf-8")
        with pytest.raises(sqlite3.Error):
            live._apply(bad)
        rows = live._conn.execute("SELECT name FROM sqlite_master WHERE name = 'b'").fetchall()
        assert rows == [] and not live._conn.in_transaction
    finally:
        live.close()
    bad.unlink()
    reopened = SqliteStore(path, str(migrations))
    try:
        rows = reopened._conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {r[0] for r in rows}
        applied = {r[0] for r in reopened._conn.execute("SELECT name FROM schema_migrations")}
    finally:
        reopened.close()
    assert "a" in tables and "b" not in tables
    assert applied == {"0001_ok.sql"}


def test_naive_datetime_is_rejected():
    with pytest.raises(ValidationError):
        RawItem(
            source_id="x", url="https://e.com/a", title="t", published_at=datetime(2026, 11, 19)
        )


def test_migration_with_two_statements_on_one_line_applies(tmp_path):
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_one_line.sql").write_text(
        "CREATE TABLE a (x TEXT DEFAULT 'p;q'); CREATE INDEX i ON a (x);", encoding="utf-8"
    )
    store = SqliteStore(str(tmp_path / "o.db"), str(migrations))
    try:
        names = {r[0] for r in store._conn.execute("SELECT name FROM sqlite_master")}
    finally:
        store.close()
    assert {"a", "i"} <= names
