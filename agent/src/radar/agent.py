"""One agent pass: score new clusters, write the best, verify, route.

Fresh stories (first reported within prefilter.FRESH) come first, up to the edition's
maximum. When the day still has fewer than score.MIN_EDITION stories, the backlog (first
reported up to prefilter.LOOKBACK ago, never written) is scored with its own question and
tops the day up, but only with stories that pass its stricter bar.
"""

from collections.abc import Callable
from datetime import datetime, timedelta

import httpx

from radar.budget import ISTANBUL, BudgetExceeded, day_start
from radar.cluster import WINDOW
from radar.dedup import WRITTEN_WINDOW, WrittenIndex
from radar.llm import LLM, LLMError, LLMUnavailable, Refused
from radar.models import Candidate, Cluster, Lane, Score
from radar.prefilter import BACKLOG_LIMIT, LOOKBACK, first_reported
from radar.score import (
    MAX_EDITION,
    MIN_EDITION,
    WRITTEN_SHOWN,
    score_candidates,
    select,
    select_backlog,
)
from radar.source import build_source, is_thin
from radar.store import SqliteStore
from radar.verify import route, verify
from radar.write import write_story

MAX_ATTEMPTS = 3
# The reason a story carries when a run asked for every story to wait for a person
# (`radar daily --review-all`) and nothing else held it back. The admin screen shows it in
# Turkish.
REVIEW_ALL_REASON = "manual run: review requested"
# A backlog score is asked again after this long: the story has aged since.
BACKLOG_SCORE_TTL = timedelta(hours=48)
# Backlog stories tried beyond the number still needed, for those that turn out thin or fail.
BACKLOG_SPARES = 3


def plan_scoring(
    store: SqliteStore,
    candidates: list[Candidate],
    now: datetime,
    lane: Lane = "fresh",
    keep: Callable[[Candidate], bool] | None = None,
) -> tuple[list[Candidate], dict[int, Score], list[Candidate], int]:
    """Return (candidates of `lane` still open, their usable cached scores, still to score,
    skipped_retry).

    A cluster that already has a story is left out; so is one that failed MAX_ATTEMPTS
    times, or was attempted today (Istanbul day). `keep` drops more (duplicates); the
    backlog is then cut to its best BACKLOG_LIMIT. A cached score is used only when it
    answered this lane's question and no story was written since it was asked; a backlog
    score also expires after BACKLOG_SCORE_TTL.
    """
    mine = [c for c in candidates if c.lane == lane]
    written = store.story_cluster_ids([c.cluster_id for c in mine])
    unwritten = [c for c in mine if c.cluster_id not in written]
    attempts = store.attempts_for([c.cluster_id for c in unwritten])
    today = day_start(now)

    def blocked(c: Candidate) -> bool:
        tries = attempts.get(c.cluster_id, [])
        return len(tries) >= MAX_ATTEMPTS or any(at >= today for at in tries)

    open_ = [c for c in unwritten if not blocked(c)]
    skipped = len(unwritten) - len(open_)
    if lane == "backlog":
        # Best first, and only as far as needed: `keep` is not asked about the rest.
        ranked = sorted(open_, key=lambda c: (-c.score, c.cluster_id))
        open_ = []
        for c in ranked:
            if len(open_) == BACKLOG_LIMIT:
                break
            if keep is None or keep(c):
                open_.append(c)
    elif keep is not None:
        open_ = [c for c in open_ if keep(c)]
    cached = store.scores_for(
        [c.cluster_id for c in open_],
        lens=lane,
        watermark=store.story_watermark(),
        scored_since=now - BACKLOG_SCORE_TTL if lane == "backlog" else None,
    )
    to_score = [c for c in open_ if c.cluster_id not in cached]
    return open_, cached, to_score, skipped


def _local_day(at: datetime):
    return at.astimezone(ISTANBUL).date()


class _Pass:
    """One run's state: the statistics, the clusters, and what has been written."""

    def __init__(self, store, llm, client, now, run_id, review_all) -> None:
        self.store, self.llm, self.client = store, llm, client
        self.now, self.run_id, self.review_all = now, run_id, review_all
        self.stats = {
            "scored": 0,
            "scored_backlog": 0,
            "selected": 0,
            "selected_fresh": 0,
            "selected_backlog": 0,
            "written": 0,
            "written_fresh": 0,
            "written_backlog": 0,
            "published": 0,
            "review": 0,
            "skipped_thin": 0,
            "skipped_retry": 0,
            "skipped_duplicate": 0,
            "skipped_repeat": 0,
            "failed": 0,
            "unavailable": 0,
            "scoring_failed": False,
            "budget_stopped": False,
        }
        self.clusters: dict[int, Cluster] = {}
        self.index = WrittenIndex([])

    def load(self) -> None:
        since = self.now - LOOKBACK - WINDOW
        self.clusters = {c.id: c for c in self.store.clusters_since(since)}
        self.index = WrittenIndex(self.store.written_refs(self.now - WRITTEN_WINDOW))

    def is_duplicate(self, c: Candidate) -> bool:
        cluster = self.clusters.get(c.cluster_id)
        if cluster is not None and self.index.matches(cluster):
            self.stats["skipped_duplicate"] += 1
            return True
        return False

    def scores(self, candidates: list[Candidate], lane: Lane):
        """Plan and score one lane: (open candidates, scores), or None on a budget stop."""
        open_, scores, to_score, skipped = plan_scoring(
            self.store, candidates, self.now, lane, keep=lambda c: not self.is_duplicate(c)
        )
        self.stats["skipped_retry"] += skipped
        if to_score:
            watermark = self.store.story_watermark()
            try:
                new = score_candidates(
                    self.llm,
                    to_score,
                    now=self.now,
                    lane=lane,
                    written=self.index.recent(WRITTEN_SHOWN),
                )
            except BudgetExceeded:
                self.stats["budget_stopped"] = True
                return None
            except (Refused, LLMError):
                self.stats["scoring_failed"] = True
            else:
                self.stats["scored"] += len(to_score)
                if lane == "backlog":
                    self.stats["scored_backlog"] += len(to_score)
                self.store.save_scores(new, self.now, lens=lane, watermark=watermark)
                scores = {**scores, **{s.cluster_id: s for s in new}}
        self.stats["skipped_repeat"] += sum(
            1 for c in open_ if c.cluster_id in scores and scores[c.cluster_id].repeat
        )
        return open_, scores

    def write(self, candidate: Candidate, score: Score, lane: Lane) -> str:
        """Try one story: "written", "skipped" or "stop" (the budget ran out)."""
        stats, store, now = self.stats, self.store, self.now
        cluster = self.clusters.get(candidate.cluster_id)
        if cluster is None:
            return "skipped"
        if self.index.matches(cluster):  # a story written earlier in this run
            stats["skipped_duplicate"] += 1
            return "skipped"
        stats["selected"] += 1
        stats[f"selected_{lane}"] += 1
        try:
            doc = build_source(candidate, cluster, self.client)
        except Exception:  # one hostile page must not end the run; not retried today
            stats["failed"] += 1
            store.record_attempt(
                cluster_id=candidate.cluster_id, run_id=self.run_id, outcome="failed", at=now
            )
            return "skipped"
        if is_thin(doc):
            stats["skipped_thin"] += 1
            store.record_attempt(
                cluster_id=candidate.cluster_id, run_id=self.run_id, outcome="thin", at=now
            )
            return "skipped"
        reported = candidate.first_reported or first_reported(cluster)
        doc = doc.model_copy(
            update={"reported_on": _local_day(reported), "edition_on": _local_day(now)}
        )
        try:
            draft = write_story(self.llm, candidate, score, doc)
        except BudgetExceeded:
            stats["budget_stopped"] = True
            return "stop"
        except LLMUnavailable:
            # No reply came back, so nothing was paid: not an attempt (ruling R7).
            stats["unavailable"] += 1
            return "skipped"
        except (Refused, LLMError) as exc:
            stats["failed"] += 1
            outcome = "refused" if isinstance(exc, Refused) else "failed"
            store.record_attempt(
                cluster_id=candidate.cluster_id, run_id=self.run_id, outcome=outcome, at=now
            )
            return "skipped"
        status, reasons = route(candidate, score, verify(draft, doc))
        if self.review_all and status == "published":
            status, reasons = "review", [REVIEW_ALL_REASON]
        store.insert_story(
            cluster_id=candidate.cluster_id,
            run_id=self.run_id,
            status=status,
            reasons=reasons,
            score=score,
            draft=draft,
            source_url=doc.url,
            source_count=candidate.source_count,
            created_at=now,
            reported_at=reported,
            lane=lane,
        )
        self.index.add(cluster, [draft.en.title, draft.tr.title], doc.url, now)
        stats["written"] += 1
        stats[f"written_{lane}"] += 1
        stats[status] += 1
        return "written"


def run_agent(
    store: SqliteStore,
    candidates: list[Candidate],
    llm: LLM,
    client: httpx.Client,
    now: datetime,
    run_id: int,
    max_stories: int = MAX_EDITION,
    review_all: bool = False,
) -> dict:
    run = _Pass(store, llm, client, now, run_id, review_all)
    stats = run.stats
    # The edition is per Istanbul day: stories already written today count against it.
    written_today = len(store.stories_since(day_start(now)))
    limit = max(0, max_stories - written_today)
    if limit == 0:
        return stats
    floor = max(0, min(MIN_EDITION, max_stories) - written_today)
    run.load()

    planned = run.scores(candidates, "fresh")
    if planned is None:
        return stats
    fresh, scores = planned
    for candidate in select(fresh, scores, limit):
        if run.write(candidate, scores[candidate.cluster_id], "fresh") == "stop":
            return stats

    need = min(floor, limit) - stats["written"]
    if need <= 0 or not any(c.lane == "backlog" for c in candidates):
        return stats
    planned = run.scores(candidates, "backlog")
    if planned is None:
        return stats
    backlog, scores = planned
    for candidate in select_backlog(backlog, scores, len(backlog)):
        if stats["written_backlog"] >= need or stats["selected_backlog"] >= need + BACKLOG_SPARES:
            break
        if run.write(candidate, scores[candidate.cluster_id], "backlog") == "stop":
            break
    return stats
