"""Source document: the primary article's text and links plus the cluster's feed text.

Page content is untrusted data. This module only extracts text and links from it;
it never follows links or evaluates anything.
"""

import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

from radar.models import Candidate, Cluster, SourceDoc
from radar.text import clean_summary

MAX_SOURCE_CHARS = 6000
MIN_SOURCE_CHARS = 200
MAX_LINKS = 50

_HTML_TYPES = ("text/html", "application/xhtml+xml")
_NOISE = re.compile(
    r"<(script|style|nav|header|footer|aside|form)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)


def _region_pattern(tag: str) -> re.Pattern[str]:
    return re.compile(rf"<{tag}\b[^>]*>(.*?)</{tag}\s*>", re.IGNORECASE | re.DOTALL)


_REGIONS = [_region_pattern(t) for t in ("article", "main", "body")]


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value:
                    self.hrefs.append(value.strip())


def _region(html: str) -> str:
    for pattern in _REGIONS:
        match = pattern.search(html)
        if match:
            return _NOISE.sub(" ", match.group(1))
    return _NOISE.sub(" ", html)


def _links(region: str, base_url: str) -> list[str]:
    parser = _LinkParser()
    parser.feed(region)
    out: list[str] = []
    for href in parser.hrefs:
        if href.startswith("#"):
            continue
        absolute = urljoin(base_url, href).split("#", 1)[0]
        if urlsplit(absolute).scheme not in ("http", "https") or absolute in out:
            continue
        out.append(absolute)
    return out[:MAX_LINKS]


def _fetch(url: str, client: httpx.Client) -> str:
    try:
        response = client.get(url)
    except httpx.HTTPError:
        return ""
    if not response.is_success:
        return ""
    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in _HTML_TYPES:
        return ""
    try:
        return response.text
    except (UnicodeDecodeError, LookupError):
        return ""


def build_source(candidate: Candidate, cluster: Cluster, client: httpx.Client) -> SourceDoc:
    html = _fetch(candidate.url, client)
    article = ""
    links: list[str] = []
    if html:
        region = _region(html)
        article = clean_summary(region, limit=MAX_SOURCE_CHARS)
        links = _links(region, candidate.url)
    lines = [f"{item.title}. {item.summary}".strip() for item in cluster.items]
    for item in cluster.items:
        if item.url not in links:
            links.append(item.url)
    text = "\n".join(([article] if article else []) + lines)[:MAX_SOURCE_CHARS]
    return SourceDoc(url=candidate.url, text=text, links=links)


def is_thin(doc: SourceDoc) -> bool:
    return len(doc.text) < MIN_SOURCE_CHARS
