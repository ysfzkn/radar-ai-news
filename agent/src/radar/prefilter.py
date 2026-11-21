from datetime import datetime, timedelta

from radar.models import Candidate, Cluster, Lane, Source, Tier

FRESH = timedelta(hours=36)
# How far back a story may still be chosen (the backlog): an event first reported up to
# this long ago. The fetcher keeps items this old too (fetch.common.MAX_AGE).
LOOKBACK = timedelta(days=14)
FRESH_LIMIT = 30
# Backlog candidates the scorer is asked about in one run, at most.
BACKLOG_LIMIT = 20
# A backlog story's importance halves every week of age.
HALF_LIFE = timedelta(days=7)
TIER_BASE = {
    Tier.PRIMARY: 3.0,
    Tier.COMMUNITY: 1.0,
    Tier.COMMENTARY: 1.5,
    Tier.TURKEY: 2.0,
}


def first_reported(cluster: Cluster) -> datetime:
    """The earliest date any of its sources gave the event: an item's published date (the
    time the store first saw it, for a feed that gives none), or the cluster's own."""
    return min([cluster.first_seen, *(i.published_at for i in cluster.items)])


def _candidate(
    cluster: Cluster, by_id: dict[str, Source], lane: Lane, decay: float = 1.0
) -> Candidate | None:
    known = [(i, by_id[i.source_id]) for i in cluster.items if i.source_id in by_id]
    if not known:
        return None
    cluster_sources = {s.id: s for _, s in known}.values()
    source_count = len(cluster_sources)
    max_points = max(i.points for i, _ in known)
    is_turkey = any(s.tier == Tier.TURKEY for s in cluster_sources)
    score = (
        max(TIER_BASE[s.tier] * s.weight for s in cluster_sources)
        + 1.0 * (source_count - 1)
        + min(max_points, 500) / 250
        + (1.0 if is_turkey else 0.0)
    )
    rep, _ = min(known, key=lambda p: (p[1].tier, p[0].published_at))
    return Candidate(
        cluster_id=cluster.id,
        title=rep.title,
        url=rep.url,
        summary=rep.summary,
        source_count=source_count,
        has_primary=any(s.tier == Tier.PRIMARY for s in cluster_sources),
        is_turkey=is_turkey,
        score=round(score * decay, 4) if decay != 1.0 else score,
        first_reported=first_reported(cluster),
        lane=lane,
    )


def _ranked(found: list[tuple[Candidate, datetime]], limit: int | None) -> list[Candidate]:
    found.sort(key=lambda r: (r[0].score, r[1]), reverse=True)
    return [c for c, _ in (found if limit is None else found[:limit])]


def rank_candidates(
    clusters: list[Cluster], sources: list[Source], now: datetime, limit: int = FRESH_LIMIT
) -> list[Candidate]:
    """The fresh lane: clusters first reported within FRESH, best first."""
    by_id = {s.id: s for s in sources}
    found = []
    for cluster in clusters:
        if first_reported(cluster) < now - FRESH:
            continue
        candidate = _candidate(cluster, by_id, "fresh")
        if candidate is not None:
            found.append((candidate, cluster.first_seen))
    return _ranked(found, limit)


def rank_backlog(
    clusters: list[Cluster], sources: list[Source], now: datetime, limit: int | None = None
) -> list[Candidate]:
    """The backlog lane: clusters first reported more than FRESH and at most LOOKBACK ago,
    by the fresh lane's importance (tier, sources, points, Türkiye) halved every HALF_LIFE.

    No limit by default: the agent drops written, blocked and duplicate clusters first and
    only then keeps the best BACKLOG_LIMIT, so stories written yesterday cannot crowd out
    the ones still worth a look.
    """
    by_id = {s.id: s for s in sources}
    found = []
    for cluster in clusters:
        reported = first_reported(cluster)
        if reported >= now - FRESH or reported < now - LOOKBACK:
            continue
        decay = 0.5 ** ((now - reported) / HALF_LIFE)
        candidate = _candidate(cluster, by_id, "backlog", decay)
        if candidate is not None:
            found.append((candidate, reported))
    return _ranked(found, limit)
