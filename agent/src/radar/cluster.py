"""Cross-source story clustering: shared URL first, then title similarity.

A title joins a cluster only when the item's own date lies within WINDOW of the dates the
cluster already spans: reports of one event come within days of each other, whenever the
store happens to read them. An item published ten days ago and read today joins the
cluster of its own days, not today's. A shared URL joins whatever the dates.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from radar.models import StoredItem
from radar.prefilter import LOOKBACK
from radar.store import SqliteStore
from radar.text import title_tokens

WINDOW = timedelta(hours=72)
JACCARD_MIN = 0.5


@dataclass
class _Open:
    id: int
    tokens: frozenset[str]
    start: datetime
    end: datetime
    urls: set[str] = field(default_factory=set)

    def near(self, at: datetime) -> bool:
        return self.start - WINDOW <= at <= self.end + WINDOW


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def assign_clusters(store: SqliteStore, new_items: list[StoredItem], now: datetime) -> int:
    """Attach each item to a cluster; return the number of clusters created."""
    open_clusters = []
    for c in sorted(store.clusters_since(now - LOOKBACK - WINDOW), key=lambda c: c.id):
        dates = [c.first_seen, *(i.published_at for i in c.items)]
        open_clusters.append(
            _Open(c.id, title_tokens(c.title), min(dates), max(dates), {i.url for i in c.items})
        )
    created = 0
    for item in sorted(new_items, key=lambda i: (i.published_at, i.id)):
        target = next((c for c in open_clusters if item.url in c.urls), None)
        if target is None:
            tokens = title_tokens(item.title)
            best, best_score = None, 0.0
            for c in open_clusters:
                if not c.near(item.published_at):
                    continue
                score = _jaccard(tokens, c.tokens)
                if score > best_score:
                    best, best_score = c, score
            if best is not None and best_score >= JACCARD_MIN:
                target = best
        if target is None:
            cluster_id = store.create_cluster(item.title, item.published_at)
            target = _Open(
                cluster_id, title_tokens(item.title), item.published_at, item.published_at
            )
            open_clusters.append(target)
            created += 1
        store.set_cluster(item.id, target.id)
        target.urls.add(item.url)
        target.start = min(target.start, item.published_at)
        target.end = max(target.end, item.published_at)
    return created
