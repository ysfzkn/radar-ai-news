import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from radar.fetch.hn import SITE as HN_SITE
from radar.models import (
    Cluster,
    Draft,
    FactCard,
    Lane,
    Outcome,
    RawItem,
    Score,
    Source,
    Status,
    StoredItem,
    Story,
    StoryText,
)
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


def _host(url: str) -> str:
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return ""
    return host.rstrip(".").lower().removeprefix("www.")


def _shown_url(item_url: str, kind: str, source_url: str) -> str:
    """The item's URL when it is on its source's site, else that source's own site."""
    if kind == "hn":
        sites = [HN_SITE, source_url]
    else:
        parts = urlsplit(source_url)
        sites = [f"{parts.scheme}://{parts.netloc}/"]
    host = _host(item_url)
    for site in sites:
        site_host = _host(site)
        if host and site_host and (host == site_host or host.endswith("." + site_host)):
            return item_url
    return sites[0]


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
            self._apply(file)

    def _apply(self, file: Path) -> None:
        """Run one migration file and record it in a single transaction."""
        statements, buffer = [], ""
        for char in file.read_text(encoding="utf-8"):
            buffer += char
            if char == ";" and sqlite3.complete_statement(buffer):
                statements.append(buffer)
                buffer = ""
        if buffer.strip():
            statements.append(buffer)  # incomplete tail: let SQLite report the error
        try:
            self._conn.execute("BEGIN")
            for statement in statements:
                self._conn.execute(statement)
            self._conn.execute("INSERT INTO schema_migrations (name) VALUES (?)", (file.name,))
            self._conn.execute("COMMIT")
        except Exception:
            if self._conn.in_transaction:
                self._conn.execute("ROLLBACK")
            raise

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

    def save_scores(
        self, scores: list[Score], at: datetime, lens: Lane = "fresh", watermark: int = 0
    ) -> None:
        """Keep the latest score of each cluster, with the question it answered (`lens`) and
        the highest story id when it was asked (`watermark`, see `story_watermark`)."""
        with self._conn:
            self._conn.executemany(
                "INSERT INTO cluster_scores "
                "(cluster_id, relevance, novelty, usefulness, category, risk_flags, scored_at, "
                "lens, repeat, watermark) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(cluster_id) DO UPDATE SET relevance=excluded.relevance, "
                "novelty=excluded.novelty, usefulness=excluded.usefulness, "
                "category=excluded.category, risk_flags=excluded.risk_flags, "
                "scored_at=excluded.scored_at, lens=excluded.lens, repeat=excluded.repeat, "
                "watermark=excluded.watermark",
                [
                    (
                        s.cluster_id,
                        s.relevance,
                        s.novelty,
                        s.usefulness,
                        s.category,
                        json.dumps(s.risk_flags, ensure_ascii=False),
                        _iso(at),
                        lens,
                        int(s.repeat),
                        watermark,
                    )
                    for s in scores
                ],
            )

    def scores_for(
        self,
        cluster_ids: list[int],
        *,
        lens: Lane | None = None,
        watermark: int | None = None,
        scored_since: datetime | None = None,
    ) -> dict[int, Score]:
        """Stored scores; with `lens`, `watermark` or `scored_since`, only those asked that
        question, at that watermark, or since that time."""
        if not cluster_ids:
            return {}
        marks = ",".join("?" * len(cluster_ids))
        sql = f"SELECT * FROM cluster_scores WHERE cluster_id IN ({marks})"
        params: list = list(cluster_ids)
        if lens is not None:
            sql += " AND lens = ?"
            params.append(lens)
        if watermark is not None:
            sql += " AND watermark = ?"
            params.append(watermark)
        if scored_since is not None:
            sql += " AND scored_at >= ?"
            params.append(_iso(scored_since))
        return {
            r["cluster_id"]: Score(
                cluster_id=r["cluster_id"],
                relevance=r["relevance"],
                novelty=r["novelty"],
                usefulness=r["usefulness"],
                category=r["category"],
                risk_flags=json.loads(r["risk_flags"]),
                repeat=bool(r["repeat"]),
            )
            for r in self._conn.execute(sql, params)
        }

    def story_watermark(self) -> int:
        """The highest story id (0 for none): a score asked at a lower watermark has not
        seen every story written since."""
        row = self._conn.execute("SELECT COALESCE(MAX(id), 0) AS top FROM stories").fetchone()
        return row["top"]

    def written_refs(self, since: datetime) -> list[dict]:
        """Every story created since `since`, newest first, as the duplicate check needs it:
        its links (the story's source URL and every item URL of its cluster), its titles
        (every item title of its cluster and both written titles) and its English title."""
        stories = self._conn.execute(
            "SELECT s.id AS id, s.cluster_id AS cluster_id, s.source_url AS source_url, "
            "s.created_at AS created_at, en.title AS en_title, tr.title AS tr_title "
            "FROM stories s "
            "JOIN story_texts en ON en.story_id = s.id AND en.lang = 'en' "
            "JOIN story_texts tr ON tr.story_id = s.id AND tr.lang = 'tr' "
            "WHERE s.created_at >= ? ORDER BY s.created_at DESC, s.id DESC",
            (_iso(since),),
        ).fetchall()
        refs = []
        for r in stories:
            items = self._conn.execute(
                "SELECT url, title FROM items WHERE cluster_id = ? ORDER BY id", (r["cluster_id"],)
            ).fetchall()
            refs.append(
                {
                    "created_at": _parse(r["created_at"]),
                    "urls": {r["source_url"], *(i["url"] for i in items)},
                    "titles": [i["title"] for i in items] + [r["en_title"], r["tr_title"]],
                    "title": r["en_title"],
                }
            )
        return refs

    def story_cluster_ids(self, cluster_ids: list[int]) -> set[int]:
        if not cluster_ids:
            return set()
        marks = ",".join("?" * len(cluster_ids))
        rows = self._conn.execute(
            f"SELECT cluster_id FROM stories WHERE cluster_id IN ({marks})", cluster_ids
        )
        return {r["cluster_id"] for r in rows}

    def insert_story(
        self,
        *,
        cluster_id: int,
        run_id: int,
        status: Status,
        reasons: list[str],
        score: Score,
        draft: Draft,
        source_url: str,
        source_count: int,
        created_at: datetime,
        reported_at: datetime | None = None,
        lane: Lane = "fresh",
    ) -> int:
        published_at = _iso(created_at) if status == "published" else None
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO stories (cluster_id, run_id, category, status, reasons, score, "
                "fact_card, source_url, source_count, created_at, published_at, uid, "
                "reported_at, lane) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    cluster_id,
                    run_id,
                    score.category,
                    status,
                    json.dumps(reasons, ensure_ascii=False),
                    score.model_dump_json(),
                    draft.fact_card.model_dump_json(),
                    source_url,
                    source_count,
                    _iso(created_at),
                    published_at,
                    uuid.uuid4().hex,
                    _iso(reported_at) if reported_at else None,
                    lane,
                ),
            )
            story_id = cur.lastrowid
            self._conn.executemany(
                "INSERT INTO story_texts (story_id, lang, title, summary, dev_line) "
                "VALUES (?, ?, ?, ?, ?)",
                [
                    (story_id, lang, t.title, t.summary, t.dev_line)
                    for lang, t in (("tr", draft.tr), ("en", draft.en))
                ],
            )
        return story_id

    def stories_since(self, since: datetime, status: Status | None = None) -> list[Story]:
        sql = "SELECT * FROM stories WHERE created_at >= ?"
        params: list = [_iso(since)]
        if status is not None:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at, id"
        return self._stories(sql, params)

    def unpushed_stories(self, include_refused: bool = False) -> list[Story]:
        sql = "SELECT * FROM stories WHERE pushed_at IS NULL"
        if not include_refused:
            sql += " AND refused_at IS NULL"
        return self._stories(sql + " ORDER BY created_at, id", [])

    def refused_stories(self) -> list[Story]:
        """Stories the admin service refused and that are still unsent, oldest refusal first."""
        return self._stories(
            "SELECT * FROM stories WHERE refused_at IS NOT NULL AND pushed_at IS NULL "
            "ORDER BY refused_at, id",
            [],
        )

    def mark_pushed(self, uids: list[str], at: datetime) -> None:
        """Record a story as sent; this also clears any earlier refusal."""
        with self._conn:
            self._conn.executemany(
                "UPDATE stories SET pushed_at = ?, refused_at = NULL, refused_path = NULL "
                "WHERE uid = ?",
                [(_iso(at), uid) for uid in uids],
            )

    def mark_refused(self, uid: str, path: str, at: datetime) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE stories SET refused_at = ?, refused_path = ? WHERE uid = ?",
                (_iso(at), path, uid),
            )

    def clear_refused(self, uids: list[str]) -> None:
        with self._conn:
            self._conn.executemany(
                "UPDATE stories SET refused_at = NULL, refused_path = NULL WHERE uid = ?",
                [(uid,) for uid in uids],
            )

    def lead_sources(self, cluster_ids: list[int]) -> dict[int, str]:
        """The id of the source that leads each cluster: the one whose item comes first by
        tier, then time, as in `story_sources`. A cluster with no item is left out."""
        lead: dict[int, str] = {}
        ids = list(dict.fromkeys(cluster_ids))
        for start in range(0, len(ids), 500):
            chunk = ids[start : start + 500]
            rows = self._conn.execute(
                "SELECT i.cluster_id AS cluster_id, i.source_id AS source_id FROM items i "
                "JOIN sources s ON s.id = i.source_id "
                f"WHERE i.cluster_id IN ({','.join('?' * len(chunk))}) "
                "ORDER BY s.tier, i.published_at, i.id",
                chunk,
            )
            for r in rows:
                lead.setdefault(r["cluster_id"], r["source_id"])
        return lead

    def story_sources(self, cluster_id: int) -> list[dict]:
        """The story's public source links, one per distinct URL, by tier then time.

        An item's own URL is shown only when it is on the site of the configured source
        that carried it (the same host as the source's feed URL or a subdomain of it). An
        aggregator's item points wherever its submitter chose, so any other item shows that
        source's own site instead (Hacker News: news.ycombinator.com). Every item still
        counts toward the story's source count, which is stored with the story.
        """
        rows = self._conn.execute(
            "SELECT s.name AS name, s.tier AS tier, s.kind AS kind, s.url AS source_url, "
            "i.url AS url FROM items i "
            "JOIN sources s ON s.id = i.source_id WHERE i.cluster_id = ? "
            "ORDER BY s.tier, i.published_at, i.id",
            (cluster_id,),
        )
        seen: set[str] = set()
        result = []
        for r in rows:
            url = _shown_url(r["url"], r["kind"], r["source_url"])
            if url in seen:
                continue
            seen.add(url)
            result.append({"name": r["name"], "url": url, "tier": r["tier"]})
        return result

    def record_attempt(
        self, *, cluster_id: int, run_id: int | None, outcome: Outcome, at: datetime
    ) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO story_attempts (cluster_id, run_id, outcome, at) VALUES (?, ?, ?, ?)",
                (cluster_id, run_id, outcome, _iso(at)),
            )

    def attempts_for(self, cluster_ids: list[int]) -> dict[int, list[datetime]]:
        if not cluster_ids:
            return {}
        marks = ",".join("?" * len(cluster_ids))
        rows = self._conn.execute(
            f"SELECT cluster_id, at FROM story_attempts WHERE cluster_id IN ({marks}) "
            "ORDER BY at, id",
            cluster_ids,
        )
        result: dict[int, list[datetime]] = {}
        for r in rows:
            result.setdefault(r["cluster_id"], []).append(_parse(r["at"]))
        return result

    def _stories(self, sql: str, params: list) -> list[Story]:
        stories = []
        for r in self._conn.execute(sql, params).fetchall():
            texts = {
                t["lang"]: StoryText(title=t["title"], summary=t["summary"], dev_line=t["dev_line"])
                for t in self._conn.execute(
                    "SELECT * FROM story_texts WHERE story_id = ?", (r["id"],)
                )
            }
            stories.append(
                Story(
                    id=r["id"],
                    uid=r["uid"],
                    cluster_id=r["cluster_id"],
                    run_id=r["run_id"],
                    category=r["category"],
                    status=r["status"],
                    reasons=json.loads(r["reasons"]),
                    score=Score.model_validate_json(r["score"]),
                    draft=Draft(
                        fact_card=FactCard.model_validate_json(r["fact_card"]),
                        tr=texts["tr"],
                        en=texts["en"],
                    ),
                    source_url=r["source_url"],
                    source_count=r["source_count"],
                    created_at=_parse(r["created_at"]),
                    published_at=_parse(r["published_at"]) if r["published_at"] else None,
                    pushed_at=_parse(r["pushed_at"]) if r["pushed_at"] else None,
                    refused_at=_parse(r["refused_at"]) if r["refused_at"] else None,
                    refused_path=r["refused_path"],
                    reported_at=_parse(r["reported_at"]) if r["reported_at"] else None,
                    lane=r["lane"],
                )
            )
        return stories

    def record_usage(
        self,
        *,
        run_id: int | None,
        step: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        at: datetime,
    ) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO llm_usage (run_id, step, model, input_tokens, output_tokens, "
                "cost_usd, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (run_id, step, model, input_tokens, output_tokens, cost_usd, _iso(at)),
            )

    def usage_since(self, since: datetime) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM llm_usage WHERE at >= ? ORDER BY id", (_iso(since),)
        )
        return [
            {
                "step": r["step"],
                "model": r["model"],
                "input_tokens": r["input_tokens"],
                "output_tokens": r["output_tokens"],
                "cost_usd": r["cost_usd"],
                "at": _parse(r["at"]),
            }
            for r in rows
        ]
