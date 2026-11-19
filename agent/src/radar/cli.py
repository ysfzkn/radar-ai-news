"""Command line entry point: `radar collect` and `radar check-sources`."""

import argparse
import json
import os
import sys
from datetime import UTC, datetime

import httpx

from radar.cluster import WINDOW, assign_clusters
from radar.fetch import fetch_all, make_client
from radar.models import Candidate, Source
from radar.paths import resolve
from radar.prefilter import rank_candidates
from radar.sources import load_sources
from radar.store import SqliteStore

DEFAULT_DB = "dev-notes/local.db"
DEFAULT_SOURCES = "sources.yaml"
MIGRATIONS = "db/migrations"


def _collect(
    store: SqliteStore, sources: list[Source], client: httpx.Client, now: datetime
) -> tuple[dict, list[Candidate]]:
    store.upsert_sources(sources)
    run_id = store.start_run("collect", now)
    report = fetch_all(sources, client, now)
    new_items = store.insert_items(report.items)
    new_clusters = assign_clusters(store, new_items, now)
    candidates = rank_candidates(store.clusters_since(now - WINDOW), sources, now)
    failed = [s.id for s in sources if s.id in report.errors]
    stats = {
        "sources_ok": len(sources) - len(failed),
        "sources_failed": len(failed),
        "new_items": len(new_items),
        "new_clusters": new_clusters,
        "candidates": len(candidates),
        "llm_calls": 0,
        "failed": failed,
    }
    store.finish_run(run_id, datetime.now(UTC), stats)
    return stats, candidates


def collect(store: SqliteStore, sources: list[Source], client: httpx.Client, now: datetime) -> dict:
    """One collection run. Makes no LLM calls and prints nothing."""
    return _collect(store, sources, client, now)[0]


def _run_collect(args: argparse.Namespace) -> int:
    sources = load_sources(str(resolve(args.sources)))
    db_path = resolve(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    store = SqliteStore(str(db_path), MIGRATIONS)
    client = make_client()
    try:
        stats, candidates = _collect(store, sources, client, datetime.now(UTC))
    finally:
        client.close()
        store.close()
    print(json.dumps(stats))
    for c in candidates[: args.show]:
        print(f"{c.score:5.2f}  {c.source_count}  {c.title}  {c.url}")
    return 0 if stats["sources_ok"] > 0 else 1


def _run_check(args: argparse.Namespace) -> int:
    sources = load_sources(str(resolve(args.sources)))
    now = datetime.now(UTC)
    with make_client() as client:
        for source in sources:
            report = fetch_all([source], client, now)
            if source.id in report.errors:
                print(f"{source.id}: FAIL {report.errors[source.id]}")
            else:
                print(f"{source.id}: ok {len(report.items)} items")
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(prog="radar")
    commands = parser.add_subparsers(dest="command", required=True)

    p_collect = commands.add_parser("collect", help="fetch sources, cluster, rank candidates")
    p_collect.add_argument("--db", default=os.environ.get("RADAR_DB_PATH") or DEFAULT_DB)
    p_collect.add_argument("--sources", default=DEFAULT_SOURCES)
    p_collect.add_argument("--show", type=int, default=0, metavar="N")
    p_collect.set_defaults(run=_run_collect)

    p_check = commands.add_parser("check-sources", help="fetch each source once and report")
    p_check.add_argument("--sources", default=DEFAULT_SOURCES)
    p_check.set_defaults(run=_run_check)

    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
