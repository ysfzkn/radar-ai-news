from datetime import UTC, datetime
from pathlib import Path

import httpx

from radar.models import Candidate, Cluster, SourceDoc, StoredItem
from radar.source import MAX_SOURCE_CHARS, build_source, is_thin

FIXTURE = Path(__file__).parent / "fixtures" / "article.html"
URL = "https://github.blog/a2ui-1-0"
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


def _item(i: int, url: str, title: str, summary: str) -> StoredItem:
    return StoredItem(
        id=i, cluster_id=1, source_id="s", url=url, title=title, summary=summary,
        published_at=NOW,
    )


def _cluster(*items: StoredItem) -> Cluster:
    return Cluster(id=1, title="A2UI 1.0", first_seen=NOW, items=list(items))


def _candidate() -> Candidate:
    return Candidate(
        cluster_id=1, title="A2UI 1.0", url=URL, summary="s", source_count=2,
        has_primary=True, is_turkey=False, score=1.0,
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


def test_item_titles_and_summaries_are_appended():
    doc = build_source(_candidate(), _two_items(), _html_client(FIXTURE.read_text("utf-8")))
    assert "A2UI ships. Coverage of the release." in doc.text
    assert doc.text.index("stable renderer") < doc.text.index("A2UI ships. Coverage")


def test_fetch_failure_falls_back_to_feed_text():
    doc = build_source(_candidate(), _two_items(), _client(lambda r: httpx.Response(500)))
    assert doc.text == "A2UI 1.0. Announcing A2UI 1.0.\nA2UI ships. Coverage of the release."
    assert doc.links == [URL, "https://news.example/a2ui"]


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
    doc = build_source(
        _candidate(), _two_items(), _html_client(f"<article>{anchors}</article>")
    )
    assert doc.links[:50] == [f"https://x.example/{i}" for i in range(50)]
    assert doc.links[50:] == [URL, "https://news.example/a2ui"]


def test_thin_source():
    assert is_thin(SourceDoc(url=URL, text="x" * 150, links=[]))
    assert not is_thin(SourceDoc(url=URL, text="x" * 250, links=[]))
