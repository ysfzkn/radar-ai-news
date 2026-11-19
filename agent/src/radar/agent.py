"""One agent pass: score new clusters, write the best, verify, route."""

from datetime import datetime

import httpx

from radar.budget import BudgetExceeded, day_start
from radar.cluster import WINDOW
from radar.llm import LLM, LLMError, Refused
from radar.models import Candidate, Score
from radar.score import MAX_EDITION, score_candidates, select
from radar.source import build_source, is_thin
from radar.store import SqliteStore
from radar.verify import route, verify
from radar.write import write_story

MAX_ATTEMPTS = 3


def plan_scoring(
    store: SqliteStore, candidates: list[Candidate], now: datetime
) -> tuple[list[Candidate], dict[int, Score], list[Candidate], int]:
    """Return (fresh candidates, their cached scores, still to score, skipped_retry).

    A cluster that already failed is left out once it has MAX_ATTEMPTS attempts, or when it
    was attempted today (Istanbul day).
    """
    written = store.story_cluster_ids([c.cluster_id for c in candidates])
    unwritten = [c for c in candidates if c.cluster_id not in written]
    attempts = store.attempts_for([c.cluster_id for c in unwritten])
    today = day_start(now)

    def blocked(c: Candidate) -> bool:
        tries = attempts.get(c.cluster_id, [])
        return len(tries) >= MAX_ATTEMPTS or any(at >= today for at in tries)

    fresh = [c for c in unwritten if not blocked(c)]
    cached = store.scores_for([c.cluster_id for c in fresh])
    to_score = [c for c in fresh if c.cluster_id not in cached]
    return fresh, cached, to_score, len(unwritten) - len(fresh)


def run_agent(
    store: SqliteStore,
    candidates: list[Candidate],
    llm: LLM,
    client: httpx.Client,
    now: datetime,
    run_id: int,
    max_stories: int = MAX_EDITION,
) -> dict:
    stats = {
        "scored": 0,
        "selected": 0,
        "written": 0,
        "published": 0,
        "review": 0,
        "skipped_thin": 0,
        "skipped_retry": 0,
        "failed": 0,
        "scoring_failed": False,
        "budget_stopped": False,
    }
    # The edition is per Istanbul day: stories already written today count against it.
    limit = max(0, max_stories - len(store.stories_since(day_start(now))))
    if limit == 0:
        return stats
    fresh, scores, to_score, stats["skipped_retry"] = plan_scoring(store, candidates, now)
    if to_score:
        try:
            new = score_candidates(llm, to_score)
        except BudgetExceeded:
            stats["budget_stopped"] = True
            return stats
        except (Refused, LLMError):
            stats["scoring_failed"] = True
        else:
            stats["scored"] = len(to_score)
            store.save_scores(new, now)
            scores = {**scores, **{s.cluster_id: s for s in new}}
    chosen = select(fresh, scores, limit)
    stats["selected"] = len(chosen)
    clusters = {c.id: c for c in store.clusters_since(now - WINDOW)}
    for candidate in chosen:
        cluster = clusters.get(candidate.cluster_id)
        if cluster is None:
            continue
        doc = build_source(candidate, cluster, client)
        if is_thin(doc):
            stats["skipped_thin"] += 1
            store.record_attempt(
                cluster_id=candidate.cluster_id, run_id=run_id, outcome="thin", at=now
            )
            continue
        score = scores[candidate.cluster_id]
        try:
            draft = write_story(llm, candidate, score, doc)
        except BudgetExceeded:
            stats["budget_stopped"] = True
            break
        except (Refused, LLMError) as exc:
            stats["failed"] += 1
            outcome = "refused" if isinstance(exc, Refused) else "failed"
            store.record_attempt(
                cluster_id=candidate.cluster_id, run_id=run_id, outcome=outcome, at=now
            )
            continue
        status, reasons = route(candidate, score, verify(draft, doc))
        store.insert_story(
            cluster_id=candidate.cluster_id,
            run_id=run_id,
            status=status,
            reasons=reasons,
            score=score,
            draft=draft,
            source_url=doc.url,
            source_count=candidate.source_count,
            created_at=now,
        )
        stats["written"] += 1
        stats[status] += 1
    return stats
