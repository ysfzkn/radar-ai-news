"""Source document: the primary article's text and links plus the cluster's feed text.

Page content is untrusted data. This module only extracts text and links from it;
it never follows links or evaluates anything.
"""

from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

from radar.fetch.common import FetchRefused, get
from radar.models import Candidate, Cluster, SourceDoc
from radar.text import clean_summary, element_inner, strip_blocks

MAX_HTML_CHARS = 300_000  # only this much of a page is parsed
MAX_SOURCE_CHARS = 6000
MIN_SOURCE_CHARS = 200
MAX_LINKS = 50
MAX_LINK_CHARS = 200
MAX_LINKS_CHARS = 2000  # the links joined with newlines, as the writer sees them

_HTML_TYPES = ("text/html", "application/xhtml+xml")
_NOISE = ("script", "style", "nav", "header", "footer", "aside", "form")
_REGIONS = ("article", "main", "body")


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
    for tag in _REGIONS:
        inner = element_inner(html, tag)
        if inner is not None:
            return strip_blocks(inner, _NOISE)
    return strip_blocks(html, _NOISE)


def _usable(url: str) -> bool:
    return len(url) <= MAX_LINK_CHARS and not any(c.isspace() for c in url)


def _cap(links: list[str]) -> list[str]:
    out: list[str] = []
    used = 0
    for link in links:
        used += len(link) + (1 if out else 0)
        if used > MAX_LINKS_CHARS:
            break
        out.append(link)
    return out


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
        if not _usable(absolute):
            continue
        out.append(absolute)
    return out[:MAX_LINKS]


def _fetch(url: str, client: httpx.Client) -> str:
    try:
        response = get(client, url)
    except (httpx.HTTPError, FetchRefused):
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
    # Cut before any parsing: the work below must stay bounded whatever the page is.
    html = _fetch(candidate.url, client)[:MAX_HTML_CHARS]
    article = ""
    article_links: list[str] = []
    if html:
        region = _region(html)
        article = clean_summary(region, limit=MAX_SOURCE_CHARS)
        article_links = _links(region, candidate.url)
    lines = [f"{item.title}. {item.summary}".strip() for item in cluster.items]
    links = list(article_links)
    for item in cluster.items:
        if _usable(item.url) and item.url not in links:
            links.append(item.url)
    links = _cap(links)
    article_links = [link for link in article_links if link in links]
    text = "\n".join(([article] if article else []) + lines)[:MAX_SOURCE_CHARS]
    return SourceDoc(url=candidate.url, text=text, links=links, article_links=article_links)


def is_thin(doc: SourceDoc) -> bool:
    return len(doc.text) < MIN_SOURCE_CHARS
