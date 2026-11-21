import socket
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from pathlib import Path

import httpx
import pytest

from radar.fetch import common, fetch_all, make_client
from radar.fetch.common import MAX_BYTES, MAX_SECONDS, FetchRefused, get, public_http_url
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


def test_drops_entries_older_than_14_days(now):
    s = src("a")
    entries = [
        ("old", now - timedelta(days=14, hours=1), ""),
        ("fresh", now - timedelta(days=13, hours=23), ""),
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
    assert [i.published_at for i in items] == sorted((i.published_at for i in items), reverse=True)
    assert by_url["https://github.com/RunanywhereAI/trnrt"].points == 54
    assert by_url["https://news.ycombinator.com/item?id=50549188"].points == 56
    assert all(i.published_at.utcoffset() == timedelta(0) for i in items)


def test_hn_applies_the_14_day_window(now):
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
        assert c.follow_redirects is False


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


def routed(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


def test_a_body_over_the_cap_fails_that_source_only(now):
    a, b = src("a"), src("b")
    big = b"x" * (6 * 1024 * 1024)
    client = client_for({a.url: big, b.url: fixture("atom.xml")})
    report = fetch_all([a, b], client, now)
    assert set(report.errors) == {"a"}
    assert report.errors["a"].startswith("FetchRefused")
    assert len(report.items) == 2


def test_a_declared_content_length_over_the_cap_is_refused_without_reading():
    class Exploding(httpx.SyncByteStream):
        def __iter__(self):
            raise AssertionError("body was read")
            yield b""

    def handler(request):
        return httpx.Response(
            200, headers={"content-length": str(MAX_BYTES + 1)}, stream=Exploding()
        )

    with pytest.raises(FetchRefused):
        get(routed(handler), "https://a.test/x")


CHUNK = 64 * 1024


class Large(httpx.SyncByteStream):
    """A body of twice the cap sent in chunks; counts how many chunks were read."""

    def __init__(self):
        self.chunks = 0

    def __iter__(self):
        for _ in range(2 * MAX_BYTES // CHUNK):
            self.chunks += 1
            yield b"x" * CHUNK


def test_a_streamed_body_without_a_content_length_is_cut_off_at_the_cap():
    body = Large()

    def handler(request):
        response = httpx.Response(200, stream=body)
        assert "content-length" not in response.headers
        return response

    with pytest.raises(FetchRefused, match="^response too large$"):
        get(routed(handler), "https://a.test/x")
    # Reading stopped just past the cap instead of taking the whole body.
    assert body.chunks == MAX_BYTES // CHUNK + 1


def test_a_content_length_that_lies_low_does_not_lift_the_cap():
    body = Large()

    def handler(request):
        return httpx.Response(200, headers={"content-length": "100"}, stream=body)

    with pytest.raises(FetchRefused, match="^response too large$"):
        get(routed(handler), "https://a.test/x")
    assert body.chunks == MAX_BYTES // CHUNK + 1


def test_a_streamed_body_exactly_at_the_cap_is_accepted():
    class Exact(httpx.SyncByteStream):
        def __iter__(self):
            for _ in range(MAX_BYTES // CHUNK):
                yield b"x" * CHUNK

    response = get(routed(lambda request: httpx.Response(200, stream=Exact())), "https://a.test/x")
    assert len(response.content) == MAX_BYTES


@pytest.mark.parametrize(
    "target",
    [
        "http://169.254.169.254/latest",
        "http://10.0.0.1/x",
        "http://127.0.0.1/x",
        "http://[::1]/x",
        "http://localhost/x",
    ],
)
def test_a_redirect_to_a_link_local_or_private_address_is_refused(target):
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={"location": target})

    with pytest.raises(FetchRefused):
        get(routed(handler), "https://a.test/x")
    assert seen == ["https://a.test/x"]


def test_a_redirect_to_a_public_address_is_followed():
    def handler(request):
        if request.url.host == "a.test":
            return httpx.Response(301, headers={"location": "https://93.184.216.34/y"})
        return httpx.Response(200, content=b"hello")

    response = get(routed(handler), "https://a.test/x")
    assert response.content == b"hello"
    assert response.text == "hello"


def test_more_than_five_redirects_is_refused():
    def handler(request):
        n = int(request.url.path.strip("/") or 0)
        return httpx.Response(302, headers={"location": f"/{n + 1}"})

    with pytest.raises(FetchRefused):
        get(routed(handler), "https://a.test/0")


def test_five_redirects_are_followed():
    def handler(request):
        n = int(request.url.path.strip("/") or 0)
        if n < 5:
            return httpx.Response(302, headers={"location": f"/{n + 1}"})
        return httpx.Response(200, content=b"done")

    assert get(routed(handler), "https://a.test/0").content == b"done"


def test_a_relative_location_is_resolved_against_the_current_url():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        if request.url.path == "/dir/start":
            return httpx.Response(302, headers={"location": "next"})
        return httpx.Response(200, content=b"ok")

    get(routed(handler), "https://a.test/dir/start")
    assert seen == ["https://a.test/dir/start", "https://a.test/dir/next"]


def test_a_refused_start_url_is_never_sent():
    def handler(request):
        raise AssertionError("sent")

    with pytest.raises(FetchRefused):
        get(routed(handler), "http://127.0.0.1/x")


def test_json_and_error_status_behave_as_before():
    def handler(request):
        if request.url.path == "/bad":
            return httpx.Response(503, content=b"down")
        return httpx.Response(200, json={"hits": []}, headers={"content-encoding": "identity"})

    client = routed(handler)
    assert get(client, "https://a.test/ok").json() == {"hits": []}
    with pytest.raises(httpx.HTTPStatusError):
        get(client, "https://a.test/bad").raise_for_status()


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("ftp://example.com/x", False),
        ("file:///etc/passwd", False),
        ("https:///nohost", False),
        ("not a url", False),
        ("http://0.0.0.0/", False),
        ("http://127.0.0.1/", False),
        ("http://10.1.2.3/", False),
        ("http://172.16.0.1/", False),
        ("http://192.168.1.1/", False),
        ("http://169.254.169.254/", False),
        ("http://[::1]/", False),
        ("http://[fe80::1]/", False),
        ("http://[fc00::1]/", False),
        ("http://[ff02::1]/", False),
        ("http://[::ffff:10.0.0.1]/", False),
        ("http://224.0.0.1/", False),
        ("http://localhost/", False),
        ("http://app.localhost/", False),
        ("http://printer.local/", False),
        ("http://db.internal/", False),
        ("https://example.com/x", True),
        ("http://93.184.216.34/", True),
        ("http://[::ffff:93.184.216.34]/", True),
        ("https://[2606:2800:220:1:248:1893:25c8:1946]/", True),
    ],
)
def test_public_http_url(url, ok):
    assert public_http_url(url) is ok


def test_existing_fetch_behaviour_is_unchanged_for_a_normal_feed(now):
    s = src("a")
    gz_free = fixture("atom.xml")
    items = fetch_feed(s, client_for({s.url: gz_free}), now)
    assert len(items) == 2


def test_the_article_page_fetch_is_guarded_too():
    from radar.source import _fetch

    def handler(request):
        return httpx.Response(302, headers={"location": "http://10.0.0.1/x"})

    assert _fetch("https://a.test/x", routed(handler)) == ""


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_an_unencoded_body_that_trickles_in_is_cut_off_at_the_total_deadline(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(common, "_clock", clock)

    class Trickle(httpx.SyncByteStream):
        def __init__(self):
            self.chunks = 0

        def __iter__(self):
            # Each chunk arrives inside the per-read timeout, but they never stop.
            for _ in range(MAX_BYTES // 1024):
                clock.now += 1.0
                self.chunks += 1
                yield b"x" * 1024

    body = Trickle()
    with pytest.raises(FetchRefused, match="^response too slow$"):
        get(routed(lambda request: httpx.Response(200, stream=body)), "https://a.test/x")
    assert body.chunks == int(MAX_SECONDS) + 1


def test_the_deadline_covers_every_redirect_hop(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(common, "_clock", clock)
    seen = []

    def handler(request):
        seen.append(request.url.path)
        clock.now += MAX_SECONDS / 2 + 0.1
        return httpx.Response(302, headers={"location": f"/{len(seen)}"})

    with pytest.raises(FetchRefused, match="^response too slow$"):
        get(routed(handler), "https://a.test/0")
    assert seen == ["/0", "/1"]


def test_a_quick_response_is_unaffected_by_the_deadline():
    assert get(routed(lambda r: httpx.Response(200, content=b"ok")), "https://a.test/x").content


def resolving_to(monkeypatch, mapping: dict[str, list[str]]) -> list[str]:
    asked: list[str] = []

    def resolver(host: str) -> list[str]:
        asked.append(host)
        if host not in mapping:
            raise socket.gaierror("unknown host")
        return mapping[host]

    monkeypatch.setattr(common, "_resolver", resolver)
    return asked


def never_sent(request):
    raise AssertionError("sent")


@pytest.mark.parametrize(
    "addresses",
    [
        ["127.0.0.1"],
        ["10.0.0.7"],
        ["169.254.169.254"],
        ["::1"],
        ["fe80::1%eth0"],
        ["::ffff:192.168.0.1"],
        ["93.184.216.34", "10.0.0.1"],  # one private answer is enough to refuse
        [],
    ],
)
def test_a_name_that_resolves_to_a_non_public_address_is_never_sent(monkeypatch, addresses):
    resolving_to(monkeypatch, {"rebind.example": addresses})
    with pytest.raises(FetchRefused):
        get(routed(never_sent), "https://rebind.example/x")


def test_a_name_that_does_not_resolve_is_refused(monkeypatch):
    resolving_to(monkeypatch, {})
    with pytest.raises(FetchRefused):
        get(routed(never_sent), "https://nowhere.example/x")


def test_a_redirect_to_a_name_with_a_private_address_is_refused(monkeypatch):
    asked = resolving_to(
        monkeypatch, {"a.example": ["93.184.216.34"], "inside.example": ["10.1.2.3"]}
    )
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://inside.example/meta"})

    with pytest.raises(FetchRefused):
        get(routed(handler), "https://a.example/x")
    assert seen == ["https://a.example/x"]
    assert asked == ["a.example", "inside.example"]


def test_a_name_with_only_public_addresses_is_fetched(monkeypatch):
    resolving_to(monkeypatch, {"a.example": ["93.184.216.34", "2606:2800:220:1::1"]})
    assert get(routed(lambda r: httpx.Response(200, content=b"ok")), "https://a.example/").content


def test_an_ip_literal_is_not_resolved(monkeypatch):
    asked = resolving_to(monkeypatch, {})
    get(routed(lambda r: httpx.Response(200, content=b"ok")), "http://93.184.216.34/")
    assert asked == []


def test_the_default_resolver_asks_getaddrinfo(monkeypatch):
    calls = []

    def fake_getaddrinfo(host, port, *args, **kwargs):
        calls.append((host, port))
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0)),
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2606:2800:220:1::1", 0, 0, 0)),
        ]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    assert common.resolve("a.example") == ["93.184.216.34", "2606:2800:220:1::1"]
    assert calls == [("a.example", None)]


# Bodies that decode to little or nothing: the cap and the deadline count the raw bytes.

GZIP_HEADER_WITH_NAME = b"\x1f\x8b\x08\x08\x00\x00\x00\x00\x00\xff"  # FNAME flag set


class EndlessGzipName(httpx.SyncByteStream):
    """A gzip header whose file-name field never ends: bytes for ever, no output."""

    def __init__(self, clock=None):
        self.chunks = 0
        self.clock = clock

    def __iter__(self):
        yield GZIP_HEADER_WITH_NAME
        while True:
            if self.clock is not None:
                self.clock.now += 1.0
            self.chunks += 1
            yield b"A" * CHUNK


class Body(httpx.SyncByteStream):
    """A body sent as a stream, as a real connection gives it (not read in advance)."""

    def __init__(self, data: bytes):
        self.data = data

    def __iter__(self):
        for start in range(0, len(self.data), CHUNK):
            yield self.data[start : start + CHUNK]


def gzip_response(stream) -> httpx.Response:
    return httpx.Response(200, headers={"content-encoding": "gzip"}, stream=stream)


def test_a_gzip_body_that_decodes_to_nothing_is_cut_off_at_the_total_deadline(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(common, "_clock", clock)
    body = EndlessGzipName(clock)
    with pytest.raises(FetchRefused, match="^response too slow$"):
        get(routed(lambda request: gzip_response(body)), "https://a.test/x")
    assert body.chunks == int(MAX_SECONDS) + 1


def test_a_gzip_body_that_decodes_to_nothing_is_cut_off_at_the_cap_on_raw_bytes():
    body = EndlessGzipName()
    with pytest.raises(FetchRefused, match="^response too large$"):
        get(routed(lambda request: gzip_response(body)), "https://a.test/x")
    # The 10 header bytes plus 80 full chunks pass the cap: reading stopped there.
    assert body.chunks == MAX_BYTES // CHUNK


def test_a_gzip_bomb_is_refused_without_decoding_it_whole():
    import gzip

    bomb = gzip.compress(b"\0" * (50 * MAX_BYTES))  # about 250 KB on the wire
    sizes = []
    real = common.zlib.decompressobj

    def watched(*args):
        inner = real(*args)

        class Watch:
            def decompress(self, data, max_length=0):
                out = inner.decompress(data, max_length)
                sizes.append(len(out))
                return out

        return Watch()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(common.zlib, "decompressobj", watched)
        with pytest.raises(FetchRefused, match="^response too large$"):
            get(routed(lambda request: gzip_response(Body(bomb))), "https://a.test/x")
    assert sizes and max(sizes) <= MAX_BYTES + 1


def test_a_gzip_body_is_decoded():
    import gzip

    body = Body(gzip.compress(b"hello"))
    got = get(routed(lambda request: gzip_response(body)), "https://a.test/x")
    assert got.content == b"hello"
    assert "content-encoding" not in got.headers


@pytest.mark.parametrize("encoding", ["br", "deflate", "zstd", "gzip, gzip"])
def test_an_encoding_other_than_gzip_is_refused(encoding):
    def handler(request):
        return httpx.Response(200, headers={"content-encoding": encoding}, stream=Body(b"\0\0"))

    with pytest.raises(FetchRefused, match="^unsupported content encoding$"):
        get(routed(handler), "https://a.test/x")


def test_only_gzip_is_asked_for():
    seen = []

    def handler(request):
        seen.append(request.headers["accept-encoding"])
        return httpx.Response(200, content=b"ok")

    get(routed(handler), "https://a.test/x")
    assert seen == ["gzip"]


def test_a_wait_for_headers_is_given_up_after_the_hard_stop(monkeypatch):
    import threading
    import time

    monkeypatch.setattr(common, "HARD_SECONDS", 0.3)
    release = threading.Event()

    def handler(request):
        release.wait(10)  # headers that never come
        return httpx.Response(200, content=b"late")

    started = time.monotonic()
    try:
        with pytest.raises(FetchRefused, match="^response too slow$"):
            get(routed(handler), "https://a.test/x")
        assert time.monotonic() - started < 3
    finally:
        release.set()


def test_a_name_lookup_that_never_answers_is_given_up_after_the_hard_stop(monkeypatch):
    import threading
    import time

    monkeypatch.setattr(common, "HARD_SECONDS", 0.3)
    release = threading.Event()

    def resolver(host):
        release.wait(10)
        return ["93.184.216.34"]

    monkeypatch.setattr(common, "_resolver", resolver)
    started = time.monotonic()
    try:
        with pytest.raises(FetchRefused, match="^response too slow$"):
            get(routed(never_sent), "https://slow-dns.example/x")
        assert time.monotonic() - started < 3
    finally:
        release.set()


def test_time_spent_on_name_lookup_counts_against_the_deadline(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(common, "_clock", clock)

    def resolver(host):
        clock.now += MAX_SECONDS + 1
        return ["93.184.216.34"]

    monkeypatch.setattr(common, "_resolver", resolver)
    with pytest.raises(FetchRefused, match="^response too slow$"):
        get(routed(never_sent), "https://slow-dns.example/x")


def test_an_error_inside_the_fetch_reaches_the_caller_unchanged():
    def handler(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(httpx.ConnectError):
        get(routed(handler), "https://a.test/x")


def test_the_name_checked_is_the_name_the_connection_uses(monkeypatch):
    asked = resolving_to(monkeypatch, {"xn--fa-hia.de": ["93.184.216.34"]})
    seen = []

    def handler(request):
        seen.append(request.url.raw_host)
        return httpx.Response(200, content=b"ok")

    get(routed(handler), "http://faß.de/")
    assert asked == ["xn--fa-hia.de"]
    assert seen == [b"xn--fa-hia.de"]


@pytest.mark.parametrize(
    "url",
    [
        "http://[64:ff9b::7f00:1]/",  # NAT64 well-known prefix
        "http://[::127.0.0.1]/",  # IPv4-compatible
        "http://[::ffff:0:127.0.0.1]/",  # SIIT
        "http://[fec0::1]/",  # site-local
    ],
)
def test_ipv6_ranges_that_reach_a_local_address_are_not_public(url):
    assert public_http_url(url) is False


def atom_entry(title: str, summary: str, now: datetime) -> bytes:
    stamp = now.isoformat()
    return (
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>'
        f'<entry><title type="html">{title}</title><link href="https://e.test/1"/>'
        f'<updated>{stamp}</updated><summary type="html">{summary}</summary></entry></feed>'
    ).encode()


def test_a_large_hostile_feed_summary_is_parsed_quickly(now):
    import time

    s = src("a")
    body = atom_entry("Title", "&lt;!--" * 100_000, now)  # 700 KB; minutes with sanitising
    started = time.perf_counter()
    items = fetch_feed(s, client_for({s.url: body}), now)
    assert time.perf_counter() - started < 3
    assert [i.title for i in items] == ["Title"]


def test_feed_title_and_summary_are_stripped_of_markup_without_the_sanitiser(now):
    s = src("a")
    title = "&lt;b&gt;Bold&lt;/b&gt; release &lt;script&gt;alert(1)&lt;/script&gt;"
    summary = "&lt;p onclick='x'&gt;Hello &lt;img src=x onerror=y&gt;world&lt;/p&gt;"
    items = fetch_feed(s, client_for({s.url: atom_entry(title, summary, now)}), now)
    assert items[0].title == "Bold release"
    assert items[0].summary == "Hello world"
