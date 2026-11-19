from pathlib import Path

import yaml

from radar.models import Source, Tier

_TIERS = {t.name.lower(): t for t in Tier}


def load_sources(path: str) -> list[Source]:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    seen: set[str] = set()
    sources: list[Source] = []
    for entry in data.get("sources", []):
        sid = entry.get("id", "<missing id>")
        if sid in seen:
            raise ValueError(f"duplicate source id: {sid}")
        seen.add(sid)
        tier_name = str(entry.get("tier", "")).lower()
        if tier_name not in _TIERS:
            raise ValueError(f"source {sid}: unknown tier {entry.get('tier')!r}")
        url = str(entry.get("url", ""))
        if not url.startswith(("http://", "https://")):
            raise ValueError(f"source {sid}: url must be http(s), got {url!r}")
        sources.append(Source(**{**entry, "tier": _TIERS[tier_name]}))
    return [s for s in sources if s.enabled]
