import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from radar.models import Candidate, Cluster, SourceDoc, StoredItem
from radar.source import (
    MAX_HTML_CHARS,
    MAX_LINKS_CHARS,
    MAX_SOURCE_CHARS,
    build_source,
    is_thin,
)

FIXTURE = Path(__file__).parent / "fixtures" / "article.html"
URL = "https://github.blog/a2ui-1-0"
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


def _item(i: int, url: str, title: str, summary: str) -> StoredItem:
    return StoredItem(
        id=i,
        cluster_id=1,
        source_id="s",
        url=url,
        title=title,
        summary=summary,
        published_at=NOW,
    )


def _cluster(*items: StoredItem) -> Cluster:
    return Cluster(id=1, title="A2UI 1.0", first_seen=NOW, items=list(items))


def _candidate() -> Candidate:
    return Candidate(
        cluster_id=1,
        title="A2UI 1.0",
        url=URL,
        summary="s",
        source_count=2,
        has_primary=True,
        is_turkey=False,
        score=1.0,
    )


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _html_client(body: str) -> httpx.Client:
    headers = {"content-type": "text/html; charset=utf-8"}
    return _client(lambda r: httpx.Response(200, text=body, headers=headers))


def _two_items() -> Cluster:
    return _cluster(
        _item(1, URL, "A2UI 1.0", "Announcing A2UI 1.0."),
        _item(2, "https://news.example/a2ui", "A2UI ships", "Coverage of the release."),
    )


def test_extracts_article_text_and_links():
    doc = build_source(_candidate(), _two_items(), _html_client(FIXTURE.read_text("utf-8")))
    assert doc.url == URL
    assert "A2UI protocol reaches 1.0 & ships a stable renderer" in doc.text
    for absent in ("NAVIGATION TEXT", "FOOTER TEXT", "SITE HEADER TEXT", "SCRIPT TEXT"):
        assert absent not in doc.text
    assert doc.links == [
        "https://github.com/a2ui/a2ui?tab=readme",
        "https://github.blog/docs/start",
        URL,
        "https://news.example/a2ui",
    ]
    assert len(doc.links) == len(set(doc.links))
    assert doc.article_links == doc.links[:2]


def test_item_titles_and_summaries_are_appended():
    doc = build_source(_candidate(), _two_items(), _html_client(FIXTURE.read_text("utf-8")))
    assert "A2UI ships. Coverage of the release." in doc.text
    assert doc.text.index("stable renderer") < doc.text.index("A2UI ships. Coverage")


def test_fetch_failure_falls_back_to_feed_text():
    doc = build_source(_candidate(), _two_items(), _client(lambda r: httpx.Response(500)))
    assert doc.text == "A2UI 1.0. Announcing A2UI 1.0.\nA2UI ships. Coverage of the release."
    assert doc.links == [URL, "https://news.example/a2ui"]
    assert doc.article_links == []


def test_transport_error_does_not_raise():
    def boom(request):
        raise httpx.ConnectTimeout("slow", request=request)

    doc = build_source(_candidate(), _two_items(), _client(boom))
    assert "Announcing A2UI 1.0." in doc.text
    assert doc.links == [URL, "https://news.example/a2ui"]


def test_non_html_response_is_ignored():
    client = _client(
        lambda r: httpx.Response(
            200, content=b"%PDF-1.4 secret pdf text", headers={"content-type": "application/pdf"}
        )
    )
    doc = build_source(_candidate(), _two_items(), client)
    assert "pdf text" not in doc.text
    assert doc.text.startswith("A2UI 1.0. Announcing A2UI 1.0.")


def test_text_is_capped_at_6000():
    body = "<html><body><article><p>" + ("word " * 5000) + "</p></article></body></html>"
    doc = build_source(_candidate(), _two_items(), _html_client(body))
    assert len(doc.text) == MAX_SOURCE_CHARS == 6000


def test_falls_back_to_main_then_body():
    main = "<body><div>OUTSIDE</div><main><p>inside main</p></main></body>"
    doc = build_source(_candidate(), _cluster(), _html_client(main))
    assert doc.text == "inside main"
    body = "<html><body><nav>menu</nav><p>plain body</p><footer>foot</footer></body></html>"
    doc = build_source(_candidate(), _cluster(), _html_client(body))
    assert doc.text == "plain body"


def test_links_capped_at_50_before_cluster_urls():
    anchors = "".join(f'<a href="https://x.example/{i}">l</a>' for i in range(80))
    doc = build_source(_candidate(), _two_items(), _html_client(f"<article>{anchors}</article>"))
    assert doc.links[:50] == [f"https://x.example/{i}" for i in range(50)]
    assert doc.links[50:] == [URL, "https://news.example/a2ui"]


def test_links_with_whitespace_or_over_200_chars_are_dropped():
    keep = "https://x.example/" + "k" * 182  # exactly 200 characters
    long = "https://x.example/" + "l" * 183  # 201 characters
    anchors = "".join(
        f'<a href="{h}">l</a>'
        for h in ("https://x.example/a b", "https://x.example/nb sp", long, keep)
    )
    cluster = _cluster(
        _item(1, URL, "A2UI 1.0", "Announcing A2UI 1.0."),
        _item(2, "https://news.example/" + "n" * 200, "A2UI ships", "Coverage."),
    )
    doc = build_source(_candidate(), cluster, _html_client(f"<article>{anchors}</article>"))
    assert len(keep) == 200
    assert doc.links == [keep, URL]
    assert doc.article_links == [keep]


def test_joined_links_are_capped_at_2000_chars():
    hrefs = [f"https://x.example/{i:02d}/" + "p" * 79 for i in range(30)]  # 100 chars each
    anchors = "".join(f'<a href="{h}">l</a>' for h in hrefs)
    doc = build_source(_candidate(), _two_items(), _html_client(f"<article>{anchors}</article>"))
    # 19 links take 19 * 100 + 18 newlines = 1_918 chars; a 20th would make 2_019
    assert MAX_LINKS_CHARS == 2000
    assert doc.links == hrefs[:19]
    assert doc.article_links == hrefs[:19]
    assert len("\n".join(doc.links)) <= MAX_LINKS_CHARS


def test_cluster_urls_are_links_but_not_article_links():
    doc = build_source(_candidate(), _two_items(), _html_client(FIXTURE.read_text("utf-8")))
    assert "https://news.example/a2ui" in doc.links
    assert "https://news.example/a2ui" not in doc.article_links


def test_thin_source():
    assert is_thin(SourceDoc(url=URL, text="x" * 150, links=[]))
    assert not is_thin(SourceDoc(url=URL, text="x" * 250, links=[]))


ADVERSARIAL = [
    "<form>" * 10_000,
    "<article>" * 7_000,
    "<" * 60_000,
    "<script>" * 7_500,
    "<article><main><body>" + "<nav a=1" * 7_000,
]


@pytest.mark.parametrize("body", ADVERSARIAL, ids=["form", "article", "lt", "script", "attrs"])
def test_a_page_of_unclosed_tags_is_handled_quickly(body):
    assert len(body) >= 50_000
    start = time.perf_counter()
    build_source(_candidate(), _two_items(), _html_client(body))
    assert time.perf_counter() - start < 1.0


def test_only_the_first_300_kb_of_a_page_is_read():
    filler = "<p>" + "word " * 70_000 + "</p>"  # 350 KB of ordinary text
    late = '<a href="https://late.example/x">late</a>'
    body = f"<article>{filler}{late}</article>"
    assert len(body) > MAX_HTML_CHARS == 300_000
    doc = build_source(_candidate(), _two_items(), _html_client(body))
    assert "https://late.example/x" not in doc.links
    assert doc.text.startswith("word word")


def test_source_urls_are_the_primary_url_and_the_cluster_items():
    doc = build_source(_candidate(), _two_items(), _html_client(FIXTURE.read_text("utf-8")))
    assert doc.source_urls == [URL, "https://news.example/a2ui"]


ARTICLE_TEXT = "Alpha engine 2.0 adds streaming support for agents. " * 8


@pytest.mark.parametrize(
    "charset",
    [
        "undefined",
        "utf-16",
        "idna",
        "punycode",
        "zlib",
        "bz2",
        "hex",
        "base64",
        "uu",
        "quopri",
        "rot13",
        "unicode_escape",
        "no-such-codec",
        "",
    ],
)
def test_a_hostile_or_unknown_charset_falls_back_to_utf8(charset):
    body = f"<html><body><article><p>{ARTICLE_TEXT}</p></article></body></html>".encode()
    headers = {"content-type": f"text/html; charset={charset}"}
    client = _client(lambda r: httpx.Response(200, content=body, headers=headers))
    doc = build_source(_candidate(), _two_items(), client)
    assert ARTICLE_TEXT.strip() in doc.text


def test_a_real_charset_is_still_used():
    body = "<html><body><article><p>Türkçe karakterler: ğüşıöç</p></article></body></html>"
    headers = {"content-type": "text/html; charset=iso-8859-9"}
    client = _client(
        lambda r: httpx.Response(200, content=body.encode("iso-8859-9"), headers=headers)
    )
    assert "ğüşıöç" in build_source(_candidate(), _two_items(), client).text


def test_a_malformed_link_is_skipped_and_the_rest_are_kept():
    page = (
        '<html><body><article><a href="http://[">bad</a>'
        '<a href="http://[::1">bad</a><a href="https://good.example/x">good</a>'
        f"<p>{ARTICLE_TEXT}</p></article></body></html>"
    )
    doc = build_source(_candidate(), _two_items(), _html_client(page))
    assert doc.article_links == ["https://good.example/x"]


def test_many_distinct_links_are_collected_quickly():
    page = "<html><body><article>" + "".join(f"<a href=/{i}>" for i in range(30_000))
    page = page[:MAX_HTML_CHARS]
    started = time.perf_counter()
    doc = build_source(_candidate(), _two_items(), _html_client(page))
    assert time.perf_counter() - started < 1.5
    assert doc.article_links[0] == "https://github.blog/0"
