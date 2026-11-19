from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from pathlib import Path

import httpx
import pytest

from radar.fetch import fetch_all, make_client
from radar.fetch.feed import fetch_feed
from radar.fetch.hn import fetch_hn
from radar.models import Source, Tier

FIXTURES = Path(__file__).parent / "fixtures"


def src(id_: str, kind: str = "feed") -> Source:
    return Source(id=id_, name=id_, tier=Tier.PRIMARY, kind=kind, url=f"https://{id_}.test/x")


def client_for(routes: dict[str, httpx.Response | bytes]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        body = routes[str(request.url)]
        if isinstance(body, httpx.Response):
            return body
        return httpx.Response(200, content=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def rss(entries: list[tuple[str, datetime | None, str]]) -> bytes:
    items = ""
    for i, (title, dt, desc) in enumerate(entries):
        date = f"<pubDate>{format_datetime(dt)}</pubDate>" if dt else ""
        items += (
            f"<item><title>{title}</title><link>https://e.test/{i}</link>"
            f"<description>{desc}</description>{date}</item>"
        )
    return (
        '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>'
        f"<link>https://e.test</link><description>d</description>{items}</channel></rss>"
    ).encode()


def test_feed_parses_atom_and_rss(now):
    for name in ("atom.xml", "rss.xml"):
        s = src("a")
        items = fetch_feed(s, client_for({s.url: fixture(name)}), now)
        assert len(items) == 2
        assert all(i.published_at.utcoffset() == timedelta(0) for i in items)
        assert all(i.url.startswith("https://example.com/") for i in items)
        assert all(not i.url.endswith("/") and "utm_" not in i.url for i in items)
    atom = fetch_feed(s := src("a"), client_for({s.url: fixture("atom.xml")}), now)
    assert atom[0].url == "https://example.com/posts/one?id=1"
    assert atom[0].published_at == datetime(2026, 11, 19, 7, 0, tzinfo=UTC)
    assert atom[0].source_id == "a"


def test_entry_without_date_gets_run_time(now):
    s = src("a")
    body = rss([("Undated", None, "x")])
    items = fetch_feed(s, client_for({s.url: body}), now)
    assert [i.published_at for i in items] == [now]


def test_summary_is_clean_and_capped(now):
    s = src("a")
    desc = "&lt;p&gt;" + ("word &lt;b&gt;bold&lt;/b&gt; " * 100) + "&lt;/p&gt;"
    items = fetch_feed(s, client_for({s.url: rss([("T", now, desc)])}), now)
    assert "<" not in items[0].summary
    assert 0 < len(items[0].summary) <= 500


def test_caps_at_50_newest(now):
    s = src("a")
    entries = [(f"e{i}", now - timedelta(minutes=i + 1), "") for i in range(60)]
    items = fetch_feed(s, client_for({s.url: rss(entries)}), now)
    assert len(items) == 50
    assert [i.title for i in items] == [f"e{i}" for i in range(50)]


def test_drops_entries_older_than_72h(now):
    s = src("a")
    entries = [
        ("old", now - timedelta(hours=73), ""),
        ("fresh", now - timedelta(hours=71), ""),
    ]
    items = fetch_feed(s, client_for({s.url: rss(entries)}), now)
    assert [i.title for i in items] == ["fresh"]


def test_html_error_page_is_a_failed_source(now):
    s = src("a")
    with pytest.raises(ValueError, match="not a feed"):
        fetch_feed(s, client_for({s.url: fixture("not_a_feed.html")}), now)


def test_hn_maps_points_and_falls_back_to_item_url(now):
    s = src("hn", "hn")
    items = fetch_hn(s, client_for({s.url: fixture("hn.json")}), now)
    by_url = {i.url: i for i in items}
    assert len(items) == 3
    assert [i.published_at for i in items] == sorted(
        (i.published_at for i in items), reverse=True
    )
    assert by_url["https://github.com/RunanywhereAI/trnrt"].points == 54
    assert by_url["https://news.ycombinator.com/item?id=50549188"].points == 56
    assert all(i.published_at.utcoffset() == timedelta(0) for i in items)


def test_hn_applies_the_72h_window(now):
    s = src("hn", "hn")
    far_future = now + timedelta(days=30)
    assert fetch_hn(s, client_for({s.url: fixture("hn.json")}), far_future) == []


def test_fetch_all_isolates_failures(now):
    a, b = src("a"), src("b")
    client = client_for(
        {a.url: httpx.Response(500), b.url: fixture("atom.xml")},
    )
    report = fetch_all([a, b], client, now)
    assert set(report.errors) == {"a"}
    assert len(report.items) == 2
    assert "\n" not in report.errors["a"]


def test_fetch_all_reports_html_page_and_malformed_xml_and_continues(now):
    a, b, c = src("a"), src("b"), src("c")
    client = client_for(
        {
            a.url: fixture("not_a_feed.html"),
            b.url: b"<rss><channel><item>",
            c.url: fixture("rss.xml"),
        }
    )
    report = fetch_all([a, b, c], client, now)
    assert set(report.errors) == {"a", "b"}
    assert len(report.items) == 2


def test_make_client_defaults():
    with make_client() as c:
        assert c.timeout.read == 15
        assert c.headers["user-agent"] == "radar-bot/0.1 (+https://radar.ozkanyusuf.com)"
        assert c.follow_redirects is True


@pytest.mark.parametrize(
    "body",
    [
        b"<html><head><title>503</title></head><body><h1>503</h1></body></html>",
        b"<!DOCTYPE html><html><body><p>Service unavailable</p></body></html>",
        b'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>503</h1></body></html>',
    ],
)
def test_well_formed_html_page_is_a_failed_source(now, body):
    s = src("a")
    with pytest.raises(ValueError, match="not a feed"):
        fetch_feed(s, client_for({s.url: body}), now)


@pytest.mark.parametrize(
    "body",
    [
        b'<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>',
        b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title></feed>',
    ],
)
def test_valid_empty_feed_is_not_a_failure(now, body):
    s = src("a")
    assert fetch_feed(s, client_for({s.url: body}), now) == []


def feed_with_links(*links: str) -> bytes:
    items = "".join(
        f"<item><title>t{i}</title><link>{link}</link><description>d</description></item>"
        for i, link in enumerate(links)
    )
    return (
        '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>'
        f"<link>https://e.test</link><description>d</description>{items}</channel></rss>"
    ).encode()


def test_feed_skips_an_entry_with_a_malformed_port(now):
    s = src("a")
    body = feed_with_links("http://example.com:abc/x", "https://e.test/good")
    items = fetch_feed(s, client_for({s.url: body}), now)
    assert [i.url for i in items] == ["https://e.test/good"]


def test_feed_skips_an_entry_with_a_relative_link(now):
    s = src("a")
    body = feed_with_links("/relative/path", "https://e.test/good")
    items = fetch_feed(s, client_for({s.url: body}), now)
    assert [i.url for i in items] == ["https://e.test/good"]
