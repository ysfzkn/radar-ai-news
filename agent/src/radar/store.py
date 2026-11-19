import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from radar.models import Cluster, RawItem, Source, StoredItem
from radar.paths import resolve


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def _parse(text: str) -> datetime:
    dt = datetime.fromisoformat(text)
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _stored(row: sqlite3.Row) -> StoredItem:
    return StoredItem(
        id=row["id"],
        source_id=row["source_id"],
        url=row["url"],
        title=row["title"],
        summary=row["summary"],
        published_at=_parse(row["published_at"]),
        points=row["points"],
        cluster_id=row["cluster_id"],
    )


class SqliteStore:
    def __init__(self, path: str, migrations_dir: str = "db/migrations") -> None:
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        try:
            self._migrate(resolve(migrations_dir))
        except Exception:
            self._conn.close()
            raise

    def close(self) -> None:
        self._conn.close()

    def _migrate(self, directory: Path) -> None:
        if not directory.is_dir():
            raise FileNotFoundError(f"migrations directory not found: {directory}")
        self._conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)")
        applied = {r["name"] for r in self._conn.execute("SELECT name FROM schema_migrations")}
        for file in sorted(directory.glob("*.sql")):
            if file.name in applied:
                continue
            # executescript commits implicitly; the name row is recorded right after.
            self._conn.executescript(file.read_text(encoding="utf-8"))
            self._conn.execute("INSERT INTO schema_migrations (name) VALUES (?)", (file.name,))
            self._conn.commit()

    def upsert_sources(self, sources: list[Source]) -> None:
        with self._conn:
            self._conn.executemany(
                "INSERT INTO sources (id, name, tier, kind, url, weight, lang, enabled) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name, tier=excluded.tier, "
                "kind=excluded.kind, url=excluded.url, weight=excluded.weight, "
                "lang=excluded.lang, enabled=excluded.enabled",
                [
                    (s.id, s.name, int(s.tier), s.kind, s.url, s.weight, s.lang, int(s.enabled))
                    for s in sources
                ],
            )

    def insert_items(self, items: list[RawItem]) -> list[StoredItem]:
        inserted: list[StoredItem] = []
        with self._conn:
            for it in items:
                cur = self._conn.execute(
                    "INSERT OR IGNORE INTO items "
                    "(source_id, url, title, summary, published_at, points) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (it.source_id, it.url, it.title, it.summary, _iso(it.published_at), it.points),
                )
                if cur.rowcount:
                    inserted.append(StoredItem(**it.model_dump(), id=cur.lastrowid))
        return inserted

    def items_since(self, since: datetime) -> list[StoredItem]:
        rows = self._conn.execute(
            "SELECT * FROM items WHERE published_at >= ? ORDER BY published_at, id",
            (_iso(since),),
        )
        return [_stored(r) for r in rows]

    def create_cluster(self, title: str, first_seen: datetime) -> int:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO clusters (title, first_seen) VALUES (?, ?)",
                (title, _iso(first_seen)),
            )
        return cur.lastrowid

    def set_cluster(self, item_id: int, cluster_id: int) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE items SET cluster_id = ? WHERE id = ?", (cluster_id, item_id)
            )

    def clusters_since(self, since: datetime) -> list[Cluster]:
        clusters = self._conn.execute(
            "SELECT * FROM clusters WHERE first_seen >= ? ORDER BY first_seen, id",
            (_iso(since),),
        ).fetchall()
        result = []
        for c in clusters:
            rows = self._conn.execute(
                "SELECT * FROM items WHERE cluster_id = ? ORDER BY published_at, id", (c["id"],)
            )
            result.append(
                Cluster(
                    id=c["id"],
                    title=c["title"],
                    first_seen=_parse(c["first_seen"]),
                    items=[_stored(r) for r in rows],
                )
            )
        return result

    def start_run(self, kind: str, started_at: datetime) -> int:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO runs (kind, started_at) VALUES (?, ?)", (kind, _iso(started_at))
            )
        return cur.lastrowid

    def finish_run(self, run_id: int, finished_at: datetime, stats: dict) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE runs SET finished_at = ?, stats = ? WHERE id = ?",
                (_iso(finished_at), json.dumps(stats), run_id),
            )

    def last_run(self) -> dict | None:
        row = self._conn.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "kind": row["kind"],
            "started_at": _parse(row["started_at"]),
            "finished_at": _parse(row["finished_at"]) if row["finished_at"] else None,
            "stats": json.loads(row["stats"]) if row["stats"] else None,
        }
