"""`radar push`: send finished stories to the admin service."""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from urllib.parse import urlsplit

import httpx

from radar.models import Draft, Story
from radar.store import SqliteStore

BATCH = 20
VERSION = 1
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
MESSAGE_LIMIT = 200

# These mirror the ingest schema in admin/src/schema.ts; keep the two in step.
MAX_REASONS = 20
REASON_CHARS = 300
MAX_LIST = 30  # who, numbers, versions
LIST_CHARS = 200
WHAT_CHARS = 1000
MAX_SOURCES = 30
URL_CHARS = 2000

STORY_PATH = re.compile(r"stories\.(\d+)(?:\.|$)")
STORY_PREFIX = re.compile(r"stories\.\d+\.?")


class PushError(Exception):
    pass


class _Rejected(Exception):
    """The Worker refused one story of the batch; `index` is its place in what was sent."""

    def __init__(self, index: int, path: str) -> None:
        super().__init__(path)
        self.index = index
        self.path = path


def allowed_url(url: str) -> bool:
    """https anywhere, or http only to the local machine. The token goes nowhere else."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        return False
    if not host:
        return False
    if parts.scheme == "https":
        return True
    return parts.scheme == "http" and host in LOCAL_HOSTS


def _try_url(url: str | None) -> str | None:
    """Only an http(s) link within the URL limit is sent; anything else is no link."""
    if url is None or len(url) > URL_CHARS:
        return None
    return url if url.lower().startswith(("http://", "https://")) else None


def _short_list(entries: list[str]) -> list[str]:
    return [e[:LIST_CHARS] for e in entries[:MAX_LIST]]


def _fact_card(draft: Draft) -> dict:
    card = draft.fact_card
    return {
        "what": card.what[:WHAT_CHARS],
        "who": _short_list(card.who),
        "numbers": _short_list(card.numbers),
        "versions": _short_list(card.versions),
        "try_url": _try_url(card.try_url),
    }


def _story_body(story: Story, sources: list[dict]) -> dict:
    # Clamp what can be clamped; the texts and URLs go as stored, and a story the
    # Worker still refuses for them is skipped by push_stories.
    draft = story.draft
    return {
        "uid": story.uid,
        "category": story.category,
        "status": story.status,
        "reasons": [r[:REASON_CHARS] for r in story.reasons[:MAX_REASONS]],
        "score": {
            "relevance": story.score.relevance,
            "novelty": story.score.novelty,
            "usefulness": story.score.usefulness,
            "total": story.score.total,
            "risk_flags": list(story.score.risk_flags),
        },
        "fact_card": _fact_card(draft),
        "source_url": story.source_url,
        "source_count": story.source_count,
        "sources": [
            {"name": s["name"], "url": s["url"], "tier": int(s["tier"])}
            for s in sources[:MAX_SOURCES]
        ],
        "created_at": story.created_at.astimezone(UTC).isoformat(),
        "texts": {"tr": draft.tr.model_dump(), "en": draft.en.model_dump()},
    }


def build_payload(stories: list[Story], sources: dict[str, list[dict]]) -> dict:
    return {
        "version": VERSION,
        "stories": [_story_body(s, sources.get(s.uid, [])) for s in stories],
    }


def _clean(text: object, token: str) -> str:
    return str(text).replace(token, "[redacted]")[:MESSAGE_LIMIT]


def _error(response: httpx.Response, token: str) -> PushError:
    try:
        body = response.json()
    except ValueError:
        body = None
    detail = ""
    if isinstance(body, dict):
        parts = [_clean(body[k], token) for k in ("error", "path") if body.get(k)]
        detail = " ".join(parts)
    message = f"admin service answered {response.status_code}"
    return PushError(f"{message}: {detail}" if detail else message)


def _rejected_story(response: httpx.Response, size: int) -> _Rejected | None:
    """A 400 whose path names one story of the batch (`stories.<N>…`), else None."""
    if response.status_code != 400:
        return None
    try:
        path = response.json().get("path")
    except (ValueError, AttributeError):
        return None
    match = STORY_PATH.match(path) if isinstance(path, str) else None
    if match is None or int(match.group(1)) >= size:
        return None
    return _Rejected(int(match.group(1)), path)


def _post(client: httpx.Client, url: str, token: str, payload: dict) -> dict:
    endpoint = url.rstrip("/") + "/api/ingest"
    try:
        response = client.post(endpoint, json=payload, headers={"Authorization": f"Bearer {token}"})
    except (httpx.HTTPError, httpx.InvalidURL, httpx.UnsupportedProtocol, ValueError) as exc:
        # The exception text can echo request details, so only its type is reported.
        raise PushError(f"could not reach the admin service ({type(exc).__name__})") from None
    if response.status_code != 200:
        rejected = _rejected_story(response, len(payload["stories"]))
        if rejected is not None:
            raise rejected
        raise _error(response, token)
    try:
        body = response.json()
        accepted, duplicates = body["accepted"], body["duplicates"]
        ok = all(
            isinstance(v, list) and all(isinstance(u, str) for u in v)
            for v in (accepted, duplicates)
        )
    except (ValueError, KeyError, TypeError):
        ok = False
    if not ok:
        raise PushError("admin service sent a response that is not the ingest reply")
    return body


def push_stories(
    store: SqliteStore,
    client: httpx.Client,
    url: str,
    token: str,
    now: datetime,
    on_reject: Callable[[str, str], None] | None = None,
    retry_refused: bool = False,
) -> dict:
    """Push every unpushed story in batches.

    A story the Worker refuses (a 400 naming `stories.<N>`) is left out, its uid is listed
    under "rejected", `on_reject(uid, path)` is called and the story is parked in the store
    with the field named; the rest of its batch is resent. Each refusal removes one story,
    so a batch takes at most its size in requests. Parked stories are not sent again unless
    `retry_refused` is true; "parked" counts those still unsent when the call ends.
    """
    stories = store.unpushed_stories(include_refused=retry_refused)
    stats: dict = {"pushed": 0, "duplicates": 0, "batches": 0, "rejected": []}
    for start in range(0, len(stories), BATCH):
        batch = stories[start : start + BATCH]
        sources = {s.uid: store.story_sources(s.cluster_id) for s in batch}
        while True:
            try:
                body = _post(client, url, token, build_payload(batch, sources))
                break
            except _Rejected as refused:
                uid = batch.pop(refused.index).uid
                stats["rejected"].append(uid)
                field = STORY_PREFIX.sub("", refused.path, count=1)
                store.mark_refused(uid, _clean(field, token), now)
                if on_reject is not None:
                    on_reject(uid, _clean(refused.path, token))
                if not batch:
                    break
        if not batch:
            continue
        # Mark only after the reply is parsed; earlier batches stay marked if a later one fails.
        sent = {s.uid for s in batch}
        accepted = [u for u in body["accepted"] if u in sent]
        duplicates = [u for u in body["duplicates"] if u in sent]
        store.mark_pushed(accepted + duplicates, now)
        stats["pushed"] += len(accepted)
        stats["duplicates"] += len(duplicates)
        stats["batches"] += 1
    stats["parked"] = len(store.refused_stories())
    return stats
