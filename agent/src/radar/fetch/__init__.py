"""Fetchers: turn each configured source into RawItems, isolating failures."""

from dataclasses import dataclass, field
from datetime import datetime

import httpx

from radar.fetch.feed import fetch_feed
from radar.fetch.hn import fetch_hn
from radar.models import RawItem, Source

USER_AGENT = "radar-bot/0.1 (+https://radar.ozkanyusuf.com)"

_FETCHERS = {"feed": fetch_feed, "hn": fetch_hn}


@dataclass
class FetchReport:
    items: list[RawItem] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)


def make_client() -> httpx.Client:
    return httpx.Client(
        timeout=15.0, headers={"User-Agent": USER_AGENT}, follow_redirects=True
    )


def _reason(exc: Exception) -> str:
    message = " ".join(str(exc).split())[:100]
    return f"{type(exc).__name__}: {message}" if message else type(exc).__name__


def fetch_all(sources: list[Source], client: httpx.Client, now: datetime) -> FetchReport:
    report = FetchReport()
    for source in sources:
        try:
            report.items.extend(_FETCHERS[source.kind](source, client, now))
        except Exception as exc:  # one bad source must never stop the run
            report.errors[source.id] = _reason(exc)
    return report
