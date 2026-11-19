"""Command line entry point: `radar collect`, `radar run`, `radar budget`, `radar check-sources`."""

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

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


NO_CREDENTIAL = 'No Anthropic credential found. Set ANTHROPIC_API_KEY or run "ant auth login".'


def _collect_in_run(
    store: SqliteStore, sources: list[Source], client: httpx.Client, now: datetime
) -> tuple[dict, list[Candidate]]:
    """Collecting steps only; the caller owns the run record."""
    store.upsert_sources(sources)
    report = fetch_all(sources, client, now)
    new_items = store.insert_items(report.items)
    pending = [i for i in store.items_since(now - WINDOW) if i.cluster_id is None]
    new_clusters = assign_clusters(store, pending, now)
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
    return stats, candidates


def _collect(
    store: SqliteStore, sources: list[Source], client: httpx.Client, now: datetime
) -> tuple[dict, list[Candidate]]:
    run_id = store.start_run("collect", now)
    stats, candidates = _collect_in_run(store, sources, client, now)
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


def _anthropic_config_dir() -> Path:
    """Where the Anthropic SDK looks for profiles (mirrors its `_config_dir`)."""
    configured = os.environ.get("ANTHROPIC_CONFIG_DIR")
    if configured:
        return Path(configured)
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / "Anthropic"
    return Path.home() / ".config" / "anthropic"


def _active_profile(config_dir: Path) -> str:
    """`ANTHROPIC_PROFILE`, else the `active_config` pointer file, else `default`."""
    named = os.environ.get("ANTHROPIC_PROFILE")
    if named:
        return named
    try:
        pointer = (config_dir / "active_config").read_text(encoding="utf-8").strip()
    except OSError:
        pointer = ""
    return pointer or "default"


def _has_credential() -> bool:
    """True when the SDK's own credential lookup would find something to send.

    Mirrors the SDK's chain: an API key or auth token in the environment, workload
    identity federation variables, or the active profile's `configs/<profile>.json`
    file in the SDK's config directory. A directory alone is not a credential.
    """
    env = os.environ
    if env.get("ANTHROPIC_API_KEY") or env.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    if env.get("ANTHROPIC_FEDERATION_RULE_ID") and env.get("ANTHROPIC_ORGANIZATION_ID"):
        if env.get("ANTHROPIC_IDENTITY_TOKEN") or env.get("ANTHROPIC_IDENTITY_TOKEN_FILE"):
            return True
    config_dir = _anthropic_config_dir()
    profile = _active_profile(config_dir)
    bad_name = (
        profile != profile.strip()
        or profile.startswith(".")
        or any(c in profile for c in ("/", "\\", "\x00"))
    )
    return not bad_name and (config_dir / "configs" / f"{profile}.json").is_file()


def _make_llm(meter):
    from radar.llm import AnthropicLLM

    return AnthropicLLM(meter)


def _open_store(args: argparse.Namespace) -> SqliteStore:
    db_path = resolve(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return SqliteStore(str(db_path), MIGRATIONS)


def _run_dry(args: argparse.Namespace, cap: float) -> int:
    from radar.agent import plan_scoring
    from radar.budget import worst_case_usd
    from radar.score import SCORE_MODEL, score_user_message
    from radar.score import SYSTEM as SCORE_SYSTEM
    from radar.source import MAX_LINKS_CHARS, MAX_SOURCE_CHARS
    from radar.write import SYSTEM as WRITE_SYSTEM
    from radar.write import WRITE_MODEL

    sources = load_sources(str(resolve(args.sources)))
    store = _open_store(args)
    client = make_client()
    try:
        stats, candidates = _collect(store, sources, client, datetime.now(UTC))
        to_score = plan_scoring(store, candidates, datetime.now(UTC))[2]
    finally:
        client.close()
        store.close()
    worst = 0.0
    if to_score:
        size = len(SCORE_SYSTEM.encode("utf-8")) + len(score_user_message(to_score).encode("utf-8"))
        worst += worst_case_usd(SCORE_MODEL, size, 4000)
    size = len(WRITE_SYSTEM.encode("utf-8")) + MAX_SOURCE_CHARS + MAX_LINKS_CHARS + 300
    # The writer allows a fallback, so each call reserves two attempts.
    writer = 2 * worst_case_usd(WRITE_MODEL, size, 2000)
    worst += args.max_stories * writer
    print(
        json.dumps(
            {
                "would_score": len(to_score),
                "worst_case_usd": round(worst, 4),
                "cap_usd": cap,
            }
        )
    )
    return 0 if stats["sources_ok"] > 0 else 1


def _run_agent_command(args: argparse.Namespace) -> int:
    from radar.budget import DAILY_TOKEN_TARGET, Meter, cap_from_env
    from radar.score import MAX_EDITION

    args.max_stories = args.max_stories or MAX_EDITION
    try:
        cap = cap_from_env()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if args.dry_run:
        return _run_dry(args, cap)
    if not _has_credential():
        print(NO_CREDENTIAL, file=sys.stderr)
        return 2
    from radar.agent import run_agent

    sources = load_sources(str(resolve(args.sources)))
    store = _open_store(args)
    client = make_client()
    now = datetime.now(UTC)
    stats: dict = {}
    try:
        run_id = store.start_run("run", now)
        try:
            stats, candidates = _collect_in_run(store, sources, client, now)
            meter = Meter(store, run_id, cap, clock=lambda: datetime.now(UTC))
            agent = run_agent(
                store, candidates, _make_llm(meter), client, now, run_id, args.max_stories
            )
            agent["stories_failed"] = agent.pop("failed")
            stats |= agent
            tokens = meter.tokens_today()
            stats["llm_calls"] = meter.calls
            stats["tokens_today"] = tokens
            stats["cost_today_usd"] = round(meter.spent_today(), 4)
            stats["over_token_target"] = tokens > DAILY_TOKEN_TARGET
        except BaseException as exc:
            store.finish_run(run_id, datetime.now(UTC), {**stats, "error": type(exc).__name__})
            raise
        store.finish_run(run_id, datetime.now(UTC), stats)
        written = [s for s in store.stories_since(now) if s.run_id == run_id]
    finally:
        client.close()
        store.close()
    print(json.dumps(stats))
    for story in written:
        print(f"{story.status}  {story.category}  {story.draft.en.title}")
    return 0 if stats["sources_ok"] > 0 else 1


def _run_budget(args: argparse.Namespace) -> int:
    from radar.budget import cap_from_env, day_start

    try:
        cap = cap_from_env()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    store = _open_store(args)
    try:
        rows = store.usage_since(day_start(datetime.now(UTC)))
    finally:
        store.close()
    by_step: dict[str, dict] = {}
    for row in rows:
        step = by_step.setdefault(
            row["step"], {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
        )
        step["calls"] += 1
        step["input_tokens"] += row["input_tokens"]
        step["output_tokens"] += row["output_tokens"]
        step["cost_usd"] += row["cost_usd"]
    for step in by_step.values():
        step["cost_usd"] = round(step["cost_usd"], 4)
    spent = sum(r["cost_usd"] for r in rows)
    print(
        json.dumps(
            {
                "cap_usd": round(cap, 4),
                "spent_usd": round(spent, 4),
                "left_usd": round(max(cap - spent, 0.0), 4),
                "tokens": sum(r["input_tokens"] + r["output_tokens"] for r in rows),
                "calls": len(rows),
                "by_step": by_step,
            }
        )
    )
    return 0


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


def _positive_int(text: str) -> int:
    value = int(text)
    if value < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return value


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

    p_run = commands.add_parser("run", help="collect, then score, write, verify and route stories")
    p_run.add_argument("--db", default=os.environ.get("RADAR_DB_PATH") or DEFAULT_DB)
    p_run.add_argument("--sources", default=DEFAULT_SOURCES)
    p_run.add_argument("--max-stories", type=_positive_int, default=None, metavar="N")
    p_run.add_argument("--dry-run", action="store_true", help="collect only; show worst-case cost")
    p_run.set_defaults(run=_run_agent_command)

    p_budget = commands.add_parser("budget", help="show today's model spend")
    p_budget.add_argument("--db", default=os.environ.get("RADAR_DB_PATH") or DEFAULT_DB)
    p_budget.set_defaults(run=_run_budget)

    p_check = commands.add_parser("check-sources", help="fetch each source once and report")
    p_check.add_argument("--sources", default=DEFAULT_SOURCES)
    p_check.set_defaults(run=_run_check)

    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
