from datetime import datetime, timedelta

from radar.models import Candidate, Cluster, Source, Tier

FRESH = timedelta(hours=36)
TIER_BASE = {
    Tier.PRIMARY: 3.0,
    Tier.COMMUNITY: 1.0,
    Tier.COMMENTARY: 1.5,
    Tier.TURKEY: 2.0,
}


def rank_candidates(
    clusters: list[Cluster], sources: list[Source], now: datetime, limit: int = 30
) -> list[Candidate]:
    by_id = {s.id: s for s in sources}
    ranked: list[tuple[float, datetime, Candidate]] = []
    for cluster in clusters:
        if cluster.first_seen < now - FRESH:
            continue
        known = [(i, by_id[i.source_id]) for i in cluster.items if i.source_id in by_id]
        if not known:
            continue
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
        ranked.append(
            (
                score,
                cluster.first_seen,
                Candidate(
                    cluster_id=cluster.id,
                    title=rep.title,
                    url=rep.url,
                    summary=rep.summary,
                    source_count=source_count,
                    has_primary=any(s.tier == Tier.PRIMARY for s in cluster_sources),
                    is_turkey=is_turkey,
                    score=score,
                ),
            )
        )
    ranked.sort(key=lambda r: (r[0], r[1]), reverse=True)
    return [c for _, _, c in ranked[:limit]]
