from enum import IntEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field


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


Category = Literal[
    "protocol", "model", "framework", "tooling", "research", "security", "industry", "policy"
]
RiskFlag = Literal[
    "security_incident", "accusation", "funding_figure", "third_party_benchmark", "regulation"
]
Status = Literal["published", "review"]
Outcome = Literal["thin", "failed", "refused"]


class Score(BaseModel):
    cluster_id: int
    relevance: int = Field(ge=0, le=5)
    novelty: int = Field(ge=0, le=5)
    usefulness: int = Field(ge=0, le=5)
    category: Category
    risk_flags: list[RiskFlag] = []

    @property
    def total(self) -> float:
        return round(0.4 * self.relevance + 0.3 * self.novelty + 0.3 * self.usefulness, 2)


class FactCard(BaseModel):
    what: str
    who: list[str]
    numbers: list[str]
    versions: list[str]
    try_url: str | None = None


class StoryText(BaseModel):
    title: str
    summary: str
    dev_line: str


class Draft(BaseModel):
    fact_card: FactCard
    tr: StoryText
    en: StoryText


class SourceDoc(BaseModel):
    url: str
    text: str
    links: list[str]  # article links plus cluster item URLs, shown to the writer
    article_links: list[str] = []  # links found in the fetched primary article only


class Story(BaseModel):
    id: int
    uid: str
    cluster_id: int
    run_id: int
    category: Category
    status: Status
    reasons: list[str]
    score: Score
    draft: Draft
    source_url: str
    source_count: int
    created_at: AwareDatetime
    published_at: AwareDatetime | None
    pushed_at: AwareDatetime | None = None
    refused_at: AwareDatetime | None = None
    refused_path: str | None = None  # the field the admin service named, e.g. "texts.tr.title"
