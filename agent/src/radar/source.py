"""Source document: the primary article's text and links plus the cluster's feed text.

Page content is untrusted data. This module only extracts text and links from it;
it never follows links or evaluates anything.
"""

import codecs
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
# Text encodings a page may name. Anything else (an unknown name, a codec that is not a
# text encoding such as zlib or base64, idna, punycode, utf-16 without a BOM) is ignored
# and the page is read as UTF-8 with bad bytes replaced.
_CHARSETS = frozenset(
    ["utf-8", "ascii", "koi8-r", "koi8-u", "mac-roman", "cp866", "cp874"]
    + [f"iso8859-{n}" for n in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16)]
    + [f"cp{n}" for n in range(1250, 1259)]
    + ["shift_jis", "cp932", "euc_jp", "iso2022_jp", "gb2312", "gbk", "gb18030"]
    + ["big5", "big5hkscs", "euc_kr", "cp949"]
)
_BOMS = (
    (codecs.BOM_UTF8, "utf-8-sig"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
)


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
    seen: set[str] = set()
    for href in parser.hrefs:
        if len(out) == MAX_LINKS:
            break
        if href.startswith("#"):
            continue
        try:
            absolute = urljoin(base_url, href).split("#", 1)[0]
            scheme = urlsplit(absolute).scheme
        except ValueError:  # `http://[` and other malformed links: skip this one
            continue
        if scheme not in ("http", "https") or absolute in seen or not _usable(absolute):
            continue
        seen.add(absolute)
        out.append(absolute)
    return out


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
    return _decode(response)


def _decode(response: httpx.Response) -> str:
    """The page as text: a BOM first, then the declared charset if it is a real text
    encoding, else UTF-8. Never raises; undecodable bytes become U+FFFD."""
    content = response.content
    for bom, name in _BOMS:
        if content.startswith(bom):
            return content.decode(name, errors="replace")
    name = "utf-8"
    try:
        declared = codecs.lookup(response.charset_encoding or "utf-8").name
    except (LookupError, ValueError):
        declared = name
    if declared in _CHARSETS:
        name = declared
    try:
        return content.decode(name, errors="replace")
    except Exception:  # a codec bug must not end the run
        return content.decode("utf-8", errors="replace")


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
    return SourceDoc(
        url=candidate.url,
        text=text,
        links=links,
        article_links=article_links,
        source_urls=list(dict.fromkeys([candidate.url] + [i.url for i in cluster.items])),
    )


def is_thin(doc: SourceDoc) -> bool:
    return len(doc.text) < MIN_SOURCE_CHARS
