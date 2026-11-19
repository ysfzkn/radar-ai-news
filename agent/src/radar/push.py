"""`radar push`: send finished stories to the admin service."""

from datetime import UTC, datetime
from urllib.parse import urlsplit

import httpx

from radar.models import Story
from radar.store import SqliteStore

BATCH = 20
VERSION = 1
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
MESSAGE_LIMIT = 200


class PushError(Exception):
    pass


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


def _story_body(story: Story, sources: list[dict]) -> dict:
    draft = story.draft
    return {
        "uid": story.uid,
        "category": story.category,
        "status": story.status,
        "reasons": story.reasons,
        "score": {
            "relevance": story.score.relevance,
            "novelty": story.score.novelty,
            "usefulness": story.score.usefulness,
            "total": story.score.total,
            "risk_flags": list(story.score.risk_flags),
        },
        "fact_card": draft.fact_card.model_dump(),
        "source_url": story.source_url,
        "source_count": story.source_count,
        "sources": [{"name": s["name"], "url": s["url"], "tier": int(s["tier"])} for s in sources],
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


def _post(client: httpx.Client, url: str, token: str, payload: dict) -> dict:
    endpoint = url.rstrip("/") + "/api/ingest"
    try:
        response = client.post(endpoint, json=payload, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as exc:
        # The exception text can echo request details, so only its type is reported.
        raise PushError(f"could not reach the admin service ({type(exc).__name__})") from None
    if response.status_code != 200:
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
    store: SqliteStore, client: httpx.Client, url: str, token: str, now: datetime
) -> dict:
    stories = store.unpushed_stories()
    stats = {"pushed": 0, "duplicates": 0, "batches": 0}
    for start in range(0, len(stories), BATCH):
        batch = stories[start : start + BATCH]
        sources = {s.uid: store.story_sources(s.cluster_id) for s in batch}
        body = _post(client, url, token, build_payload(batch, sources))
        # Mark only after the reply is parsed; earlier batches stay marked if a later one fails.
        sent = {s.uid for s in batch}
        accepted = [u for u in body["accepted"] if u in sent]
        duplicates = [u for u in body["duplicates"] if u in sent]
        store.mark_pushed(accepted + duplicates, now)
        stats["pushed"] += len(accepted)
        stats["duplicates"] += len(duplicates)
        stats["batches"] += 1
    return stats
