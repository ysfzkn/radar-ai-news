"""Command line entry point: `radar collect`, `run`, `budget`, `push`, `state` and more."""

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
from radar.prefilter import LOOKBACK, rank_backlog, rank_candidates
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
    pending = [i for i in store.items_since(now - LOOKBACK) if i.cluster_id is None]
    new_clusters = assign_clusters(store, pending, now)
    clusters = store.clusters_since(now - LOOKBACK - WINDOW)
    candidates = rank_candidates(clusters, sources, now)
    backlog = rank_backlog(clusters, sources, now)
    failed = [s.id for s in sources if s.id in report.errors]
    stats = {
        "sources_ok": len(sources) - len(failed),
        "sources_failed": len(failed),
        "new_items": len(new_items),
        "new_clusters": new_clusters,
        "candidates": len(candidates),
        "backlog_candidates": len(backlog),
        "llm_calls": 0,
        "failed": failed,
    }
    # Fresh first; the backlog is all of it, best first: the agent drops what is written,
    # blocked or a duplicate before it keeps the best prefilter.BACKLOG_LIMIT.
    return stats, candidates + backlog


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
    from radar.dedup import WRITTEN_WINDOW, WrittenIndex
    from radar.score import BACKLOG_SYSTEM, SCORE_MODEL, WRITTEN_SHOWN, score_user_message
    from radar.score import SYSTEM as SCORE_SYSTEM
    from radar.source import MAX_LINKS_CHARS, MAX_SOURCE_CHARS
    from radar.write import SYSTEM as WRITE_SYSTEM
    from radar.write import WRITE_MODEL

    sources = load_sources(str(resolve(args.sources)))
    store = _open_store(args)
    client = make_client()
    try:
        now = datetime.now(UTC)
        stats, candidates = _collect(store, sources, client, now)
        to_score = plan_scoring(store, candidates, now)[2]
        backlog = plan_scoring(store, candidates, now, "backlog")[2]
        written = WrittenIndex(store.written_refs(now - WRITTEN_WINDOW)).recent(WRITTEN_SHOWN)
    finally:
        client.close()
        store.close()
    worst = 0.0
    # Both lanes, as if the backlog were needed: the real run asks it only below the floor.
    for system, batch in ((SCORE_SYSTEM, to_score), (BACKLOG_SYSTEM, backlog)):
        if batch:
            user = score_user_message(batch, now, written)
            size = len(system.encode("utf-8")) + len(user.encode("utf-8"))
            worst += worst_case_usd(SCORE_MODEL, size, 4000)
    # 300 bytes for the category and URL lines, 300 more for the dates line.
    size = len(WRITE_SYSTEM.encode("utf-8")) + MAX_SOURCE_CHARS + MAX_LINKS_CHARS + 600
    # The writer allows a fallback, so each call reserves two attempts.
    writer = 2 * worst_case_usd(WRITE_MODEL, size, 2000)
    worst += args.max_stories * writer
    print(
        json.dumps(
            {
                "would_score": len(to_score),
                "would_score_backlog": len(backlog),
                "worst_case_usd": round(worst, 4),
                "cap_usd": cap,
            }
        )
    )
    return 0 if stats["sources_ok"] > 0 else 1


def _agent_in_run(
    store: SqliteStore,
    candidates: list[Candidate],
    client: httpx.Client,
    now: datetime,
    run_id: int,
    cap: float,
    max_stories: int,
    make_llm,
    review_all: bool = False,
) -> dict:
    """The model steps of a run, metered under `cap`; returns the run's statistics."""
    from radar.agent import run_agent
    from radar.budget import DAILY_TOKEN_TARGET, Meter

    meter = Meter(store, run_id, cap, clock=lambda: datetime.now(UTC))
    agent = run_agent(
        store, candidates, make_llm(meter), client, now, run_id, max_stories, review_all
    )
    agent["stories_failed"] = agent.pop("failed")
    tokens = meter.tokens_today()
    agent["llm_calls"] = meter.calls
    agent["tokens_today"] = tokens
    agent["cost_today_usd"] = round(meter.spent_today(), 4)
    agent["over_token_target"] = tokens > DAILY_TOKEN_TARGET
    return agent


def _run_agent_command(args: argparse.Namespace) -> int:
    from radar.budget import cap_from_env
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
    sources = load_sources(str(resolve(args.sources)))
    store = _open_store(args)
    client = make_client()
    now = datetime.now(UTC)
    stats: dict = {}
    try:
        run_id = store.start_run("run", now)
        try:
            stats, candidates = _collect_in_run(store, sources, client, now)
            stats |= _agent_in_run(
                store, candidates, client, now, run_id, cap, args.max_stories, _make_llm
            )
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


def _list_refused(args: argparse.Namespace) -> int:
    store = _open_store(args)
    try:
        parked = store.refused_stories()
    finally:
        store.close()
    for story in parked:
        when = story.refused_at.isoformat() if story.refused_at else ""
        print(f"{story.uid}  {when}  {story.refused_path or ''}  {story.draft.tr.title}")
    return 0


def _run_push(args: argparse.Namespace) -> int:
    from radar.push import PushError, allowed_url, push_stories

    if args.list_refused:
        return _list_refused(args)
    url = args.url or os.environ.get("RADAR_ADMIN_URL") or ""
    token = os.environ.get("RADAR_INGEST_TOKEN") or ""
    if not url:
        print("Set RADAR_ADMIN_URL or pass --url (the admin service origin).", file=sys.stderr)
        return 2
    if not token:
        print("Set RADAR_INGEST_TOKEN to push stories.", file=sys.stderr)
        return 2
    if not allowed_url(url):
        print(
            "The admin URL must be https://, or http:// to localhost, 127.0.0.1 or [::1].",
            file=sys.stderr,
        )
        return 2
    store = _open_store(args)

    def report_rejected(uid: str, path: str) -> None:
        print(f"rejected by the admin service: {uid} ({path})", file=sys.stderr)

    try:
        with httpx.Client(timeout=30, follow_redirects=False) as client:
            stats = push_stories(
                store,
                client,
                url,
                token,
                datetime.now(UTC),
                on_reject=report_rejected,
                retry_refused=args.retry_refused,
            )
    except PushError as exc:
        print(f"push failed: {exc}", file=sys.stderr)
        return 1
    finally:
        store.close()
    print(json.dumps(stats))
    return 1 if stats["rejected"] else 0


def _run_state(args: argparse.Namespace) -> int:
    from radar.state import MIN_PASSPHRASE, StateError, pack, unpack

    passphrase = os.environ.get("RADAR_STATE_KEY") or ""
    if len(passphrase) < MIN_PASSPHRASE:
        print(
            f"Set RADAR_STATE_KEY to a passphrase of at least {MIN_PASSPHRASE} characters.",
            file=sys.stderr,
        )
        return 2
    db_path = str(resolve(args.db))
    try:
        if args.state_command == "save":
            size = pack(db_path, args.file, passphrase)
            print(f"saved {size} bytes to {args.file}")
        else:
            unpack(args.file, db_path, passphrase, force=args.force)
            print(f"loaded {db_path}")
    except StateError as exc:
        print(f"state: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"state: {exc.strerror or type(exc).__name__}", file=sys.stderr)
        return 1
    return 0


def _daily_client(kind: str) -> httpx.Client:
    """The source fetcher's client, or one that never follows a redirect (admin, Telegram)."""
    if kind == "sources":
        return make_client()
    return httpx.Client(timeout=30, follow_redirects=False)


def _daily_llm(meter):
    if not _has_credential():
        from radar.daily import StepError

        raise StepError(NO_CREDENTIAL)
    return _make_llm(meter)


def _run_daily(args: argparse.Namespace) -> int:
    from radar import daily
    from radar.score import MAX_EDITION

    if args.collect_only and args.max_stories is not None:
        print("--collect-only writes no story; leave out --max-stories.", file=sys.stderr)
        return 2
    mode = "collect_only" if args.collect_only else "review_all" if args.review_all else "normal"
    return daily.run_daily(
        db_path=resolve(args.db),
        sources_path=resolve(args.sources),
        max_stories=args.max_stories or MAX_EDITION,
        env=os.environ,
        now=datetime.now(UTC),
        http=_daily_client,
        llm_factory=_daily_llm,
        out=sys.stdout,
        mode=mode,
    )


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

    p_push = commands.add_parser("push", help="send finished stories to the admin service")
    p_push.add_argument("--db", default=os.environ.get("RADAR_DB_PATH") or DEFAULT_DB)
    p_push.add_argument("--url", default=None, help="admin origin (default: $RADAR_ADMIN_URL)")
    refusals = p_push.add_mutually_exclusive_group()
    refusals.add_argument(
        "--retry-refused", action="store_true", help="also send stories the service refused before"
    )
    refusals.add_argument(
        "--list-refused", action="store_true", help="list refused stories and send nothing"
    )
    p_push.set_defaults(run=_run_push)

    p_daily = commands.add_parser("daily", help="collect, run and push, then send a notice")
    p_daily.add_argument("--db", default=os.environ.get("RADAR_DB_PATH") or DEFAULT_DB)
    p_daily.add_argument("--sources", default=DEFAULT_SOURCES)
    p_daily.add_argument("--max-stories", type=_positive_int, default=None, metavar="N")
    modes = p_daily.add_mutually_exclusive_group()
    modes.add_argument(
        "--review-all",
        action="store_true",
        help="publish nothing; every new story waits for review",
    )
    modes.add_argument(
        "--collect-only",
        action="store_true",
        help="collect and store sources only: no model call, no story, no push",
    )
    p_daily.set_defaults(run=_run_daily)

    p_state = commands.add_parser("state", help="keep the database as one encrypted file")
    state_commands = p_state.add_subparsers(dest="state_command", required=True)
    p_save = state_commands.add_parser("save", help="write the database to an encrypted file")
    p_save.add_argument("--db", default=os.environ.get("RADAR_DB_PATH") or DEFAULT_DB)
    p_save.add_argument("--file", required=True)
    p_save.set_defaults(run=_run_state)
    p_load = state_commands.add_parser("load", help="restore the database from an encrypted file")
    p_load.add_argument("--db", default=os.environ.get("RADAR_DB_PATH") or DEFAULT_DB)
    p_load.add_argument("--file", required=True)
    p_load.add_argument("--force", action="store_true", help="replace an existing database")
    p_load.set_defaults(run=_run_state)

    args = parser.parse_args(argv)
    return args.run(args)


def entry() -> int:
    """The `radar` command: loads `agent/.env`, then runs `main`.

    Kept apart from `main` so tests that call `main` never see a real `.env`.
    """
    from radar.envfile import ENV_FILE, load_env_file

    load_env_file(ENV_FILE, os.environ)
    return main()


if __name__ == "__main__":
    sys.exit(entry())
