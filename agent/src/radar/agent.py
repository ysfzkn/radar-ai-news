"""One agent pass: score new clusters, write the best, verify, route."""

from datetime import datetime

import httpx

from radar.budget import BudgetExceeded
from radar.cluster import WINDOW
from radar.llm import LLM, LLMError, Refused
from radar.models import Candidate, Score
from radar.score import MAX_EDITION, score_candidates, select
from radar.source import build_source, is_thin
from radar.store import SqliteStore
from radar.verify import route, verify
from radar.write import write_story


def plan_scoring(
    store: SqliteStore, candidates: list[Candidate]
) -> tuple[list[Candidate], dict[int, Score], list[Candidate]]:
    """Return (fresh candidates, cached scores for them, candidates still to score)."""
    written = store.story_cluster_ids([c.cluster_id for c in candidates])
    fresh = [c for c in candidates if c.cluster_id not in written]
    cached = store.scores_for([c.cluster_id for c in fresh])
    return fresh, cached, [c for c in fresh if c.cluster_id not in cached]


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
        "failed": 0,
        "budget_stopped": False,
    }
    fresh, scores, to_score = plan_scoring(store, candidates)
    if to_score:
        try:
            new = score_candidates(llm, to_score)
        except BudgetExceeded:
            stats["budget_stopped"] = True
            return stats
        except (Refused, LLMError):
            stats["failed"] += 1
        else:
            stats["scored"] = len(to_score)
            store.save_scores(new, now)
            scores = {**scores, **{s.cluster_id: s for s in new}}
    chosen = select(fresh, scores, max_stories)
    stats["selected"] = len(chosen)
    clusters = {c.id: c for c in store.clusters_since(now - WINDOW)}
    for candidate in chosen:
        cluster = clusters.get(candidate.cluster_id)
        if cluster is None:
            continue
        doc = build_source(candidate, cluster, client)
        if is_thin(doc):
            stats["skipped_thin"] += 1
            continue
        score = scores[candidate.cluster_id]
        try:
            draft = write_story(llm, candidate, score, doc)
        except BudgetExceeded:
            stats["budget_stopped"] = True
            break
        except (Refused, LLMError):
            stats["failed"] += 1
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
