"""Never write the same event twice: compare a cluster with every story of the last 30 days.

The rule, in order:
1. Link: any item URL of the cluster equals the source URL of a written story or the URL of
   any item in that story's cluster (URLs are canonical: https, no www, no tracking query).
2. Title: any title of the cluster (its own and each item's) and any title of a written
   story (each of its items' titles and the Turkish and English titles Radar wrote) share
   at least TITLE_MATCH of their words (Jaccard over `title_tokens`) and carry exactly the
   same tokens with digits in them, so "Rust 1.80" never matches "Rust 1.81".
3. Meaning: the scorer sees the titles Radar wrote and flags a repeat (see score.py).

1 and 2 run here, before any model is asked and again just before each write, so a story
written earlier in the same run counts. They are lexical: a re-report in other words or in
another language, or a follow-up whose title shares too few words, is left to 3, which is
a model's judgment and can miss. Only stories in this store are known: anything on the site
that this database never wrote is invisible to all three.
"""

from datetime import datetime, timedelta

from radar.models import Cluster
from radar.text import title_tokens

WRITTEN_WINDOW = timedelta(days=30)
TITLE_MATCH = 0.6


def _numbers(tokens: frozenset[str]) -> frozenset[str]:
    return frozenset(t for t in tokens if any(ch.isdigit() for ch in t))


def _same(a: frozenset[str], b: frozenset[str]) -> bool:
    if not a or not b or _numbers(a) != _numbers(b):
        return False
    return len(a & b) / len(a | b) >= TITLE_MATCH


def same_title(a: str, b: str) -> bool:
    return _same(title_tokens(a), title_tokens(b))


def _cluster_titles(cluster: Cluster) -> list[frozenset[str]]:
    titles = dict.fromkeys([cluster.title, *(i.title for i in cluster.items)])
    return [title_tokens(t) for t in titles]


class WrittenIndex:
    """What Radar wrote: `refs` as `SqliteStore.written_refs` returns them, newest first."""

    def __init__(self, refs: list[dict]) -> None:
        self._urls: set[str] = set()
        self._titles: list[frozenset[str]] = []
        self._recent: list[tuple[datetime, str]] = []
        for ref in refs:
            self._urls |= set(ref["urls"])
            self._titles += [title_tokens(t) for t in ref["titles"]]
            self._recent.append((ref["created_at"], ref["title"]))

    def matches(self, cluster: Cluster) -> bool:
        if any(item.url in self._urls for item in cluster.items):
            return True
        return any(_same(t, w) for t in _cluster_titles(cluster) for w in self._titles)

    def add(
        self,
        cluster: Cluster,
        titles: list[str],
        url: str | None = None,
        at: datetime | None = None,
    ) -> None:
        """Count a story just written in this run."""
        self._urls |= {i.url for i in cluster.items} | ({url} if url else set())
        self._titles += _cluster_titles(cluster) + [title_tokens(t) for t in titles]
        if at is not None and titles:
            self._recent.insert(0, (at, titles[0]))

    def recent(self, limit: int) -> list[tuple[datetime, str]]:
        """(created, English title) of the newest `limit` stories, newest first."""
        return self._recent[:limit]
