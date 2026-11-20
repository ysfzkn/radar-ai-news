"""`radar daily`: collect, run and push in one go, then tell the owner what needs attention."""

import json
import re
import sys
from collections.abc import Callable, Mapping
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import TextIO

import httpx

from radar import cli
from radar.notify import (
    NotifyError,
    Summary,
    field_paths,
    needs_notice,
    origin,
    render,
    send_email,
    send_telegram,
    subject,
)
from radar.paths import resolve
from radar.push import PushError, allowed_url, push_stories
from radar.sources import load_sources
from radar.store import SqliteStore

SECRET_NAMES = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "RADAR_INGEST_TOKEN",
    "RADAR_STATE_KEY",
    "RADAR_SMTP_PASSWORD",
    "TELEGRAM_BOT_TOKEN",
)
URL = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://\S*")
ERROR_CHARS = 200
BAD_ADMIN_URL = "the admin URL must be https://, or http:// to localhost, 127.0.0.1 or [::1]"


class StepError(Exception):
    """A step failed for a reason written for the owner; its text is safe to show."""


# Only these carry a message worth showing; any other exception is named by its class,
# since its text may hold a URL, a secret or story text.
SAFE_MESSAGES = (StepError, PushError)


def _redact(text: str, env: Mapping[str, str]) -> str:
    for name in SECRET_NAMES:
        value = env.get(name)
        if value:
            text = text.replace(value, "[redacted]")
    return text


def clean_error(exc: BaseException, env: Mapping[str, str]) -> str:
    """One line: the exception's class, and its message only when it is a known-safe kind."""
    name = type(exc).__name__
    if not isinstance(exc, SAFE_MESSAGES):
        return name
    text = _redact(" ".join(_redact(str(exc), env).split()), env)
    text = URL.sub("[url]", text)[:ERROR_CHARS]
    return f"{name}: {text}" if text else name


def _open_store(db_path: Path | str) -> SqliteStore:
    path = resolve(str(db_path))
    path.parent.mkdir(parents=True, exist_ok=True)
    return SqliteStore(str(path), cli.MIGRATIONS)


def _run_step(store, candidates, client, now, run_id, max_stories, llm_factory) -> dict:
    from radar.budget import cap_from_env

    try:
        cap = cap_from_env()
    except ValueError as exc:
        raise StepError(str(exc)) from None
    return cli._agent_in_run(store, candidates, client, now, run_id, cap, max_stories, llm_factory)


def _push_step(store: SqliteStore, url: str, token: str, http) -> dict:
    with http("admin") as client:
        stats = push_stories(store, client, url, token, datetime.now(UTC))
    parked = {s.uid: s.refused_path for s in store.refused_stories()}
    stats["refused_paths"] = field_paths([parked.get(uid) for uid in stats["rejected"]])
    return stats


def _notify(summary: Summary, env: Mapping[str, str], http, now: datetime) -> None:
    """Send to every configured channel; a failure is one stderr line and nothing more."""
    text = render(summary, now=now)
    token = env.get("TELEGRAM_BOT_TOKEN") or ""
    chat_id = env.get("TELEGRAM_CHAT_ID") or ""
    channels: list[tuple[str, Callable[[], None]]] = []
    if token and chat_id:

        def telegram() -> None:
            with http("telegram") as client:
                send_telegram(client, token, chat_id, text)

        channels.append(("telegram", telegram))
    if env.get("RADAR_SMTP_HOST"):
        channels.append(("email", lambda: send_email(text, subject(summary, now=now), env)))
    if not channels:
        print("notice needed but no channel is configured", file=sys.stderr)
    for name, send in channels:
        try:
            send()
        except NotifyError as exc:
            print(f"notice failed: {exc}", file=sys.stderr)
        except Exception as exc:
            print(f"notice failed: {name}: {type(exc).__name__}", file=sys.stderr)


def run_daily(
    *,
    db_path: Path | str,
    sources_path: Path | str,
    max_stories: int,
    env: Mapping[str, str],
    now: datetime,
    http: Callable[[str], httpx.Client],
    llm_factory: Callable,
    out: TextIO,
) -> int:
    """Collect, run and push; print one JSON summary line; notify when something needs it.

    `http(kind)` returns a new client for "sources", "admin" or "telegram"; `llm_factory`
    builds the model client from the meter. Returns 1 when a step failed or no source
    could be read, else 0.
    """
    failure: tuple[str, str] | None = None

    def fail(step: str, exc: BaseException) -> None:
        nonlocal failure
        if failure is None:  # the first failure is the one to fix
            failure = (step, clean_error(exc, env))

    collected: dict = {}
    run_stats: dict | None = None
    push_stats: dict | None = None
    review = published = 0
    url = (env.get("RADAR_ADMIN_URL") or "").strip()
    token = env.get("RADAR_INGEST_TOKEN") or ""
    admin_url = origin(url) if url and allowed_url(url) else None
    store: SqliteStore | None = None
    try:
        try:
            sources = load_sources(str(resolve(str(sources_path))))
            store = _open_store(db_path)
        except Exception as exc:
            fail("collect", exc)
        if store is not None:
            run_id = store.start_run("run", now)
            record: dict = {}
            error_name: str | None = None
            try:
                try:
                    with http("sources") as client:
                        try:
                            collected, candidates = cli._collect_in_run(store, sources, client, now)
                            record = dict(collected)
                        except Exception as exc:
                            fail("collect", exc)
                            error_name = type(exc).__name__
                        else:
                            try:
                                run_stats = _run_step(
                                    store, candidates, client, now, run_id, max_stories, llm_factory
                                )
                                record |= run_stats
                            except Exception as exc:
                                fail("run", exc)
                                error_name = type(exc).__name__
                except Exception as exc:  # the client could not be made or closed
                    fail("collect" if not record else "run", exc)
                    error_name = error_name or type(exc).__name__
            except BaseException as exc:  # an interruption: record it, as `radar run` does
                store.finish_run(run_id, datetime.now(UTC), {**record, "error": type(exc).__name__})
                raise
            store.finish_run(
                run_id,
                datetime.now(UTC),
                {**record, "error": error_name} if error_name else record,
            )
            if not (failure and failure[0] == "collect"):
                if not url or not token:
                    push_stats = {"skipped": True}
                elif admin_url is None:
                    fail("push", StepError(BAD_ADMIN_URL))
                else:
                    try:
                        push_stats = _push_step(store, url, token, http)
                    except Exception as exc:
                        fail("push", exc)
            sent = [
                s
                for s in store.stories_since(now)
                if s.run_id == run_id and s.pushed_at is not None
            ]
            review = sum(1 for s in sent if s.status == "review")
            published = sum(1 for s in sent if s.status == "published")
    finally:
        if store is not None:
            store.close()
    summary = Summary(
        collected=collected,
        run=run_stats,
        push=push_stats,
        review=review,
        published=published,
        cap_reached=bool(run_stats and run_stats.get("budget_stopped")),
        failed_step=failure[0] if failure else None,
        error=failure[1] if failure else None,
        admin_url=admin_url,
    )
    print(json.dumps(asdict(summary)), file=out)
    if needs_notice(summary):
        _notify(summary, env, http, now)
    # As in `radar collect` and `radar run`: a day on which no source could be read failed,
    # though the chain went on so that stories of earlier runs were still pushed.
    unread = bool(collected) and collected.get("sources_ok", 0) == 0
    return 1 if failure or unread else 0
