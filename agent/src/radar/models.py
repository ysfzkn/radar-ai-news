from enum import IntEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel


class Tier(IntEnum):
    PRIMARY = 1
    COMMUNITY = 2
    COMMENTARY = 3
    TURKEY = 4


class Source(BaseModel):
    id: str
    name: str
    tier: Tier
    kind: Literal["feed", "hn"]
    url: str
    weight: float = 1.0
    lang: Literal["en", "tr"] = "en"
    enabled: bool = True


class RawItem(BaseModel):
    source_id: str
    url: str
    title: str
    summary: str = ""
    published_at: AwareDatetime
    points: int = 0


class StoredItem(RawItem):
    id: int
    cluster_id: int | None = None


class Cluster(BaseModel):
    id: int
    title: str
    first_seen: AwareDatetime
    items: list[StoredItem]


class Candidate(BaseModel):
    cluster_id: int
    title: str
    url: str
    summary: str
    source_count: int
    has_primary: bool
    is_turkey: bool
    score: float
