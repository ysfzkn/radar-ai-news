import json
import sys
from datetime import timedelta
from email.utils import format_datetime

import httpx
import pytest

from radar import cli
from radar.cli import collect, main
from radar.models import Source, Tier
from radar.store import SqliteStore


def src(id_: str) -> Source:
    return Source(id=id_, name=id_, tier=Tier.PRIMARY, kind="feed", url=f"https://{id_}.test/feed")


TOPICS = {"a": ("quantum robots", "garden compilers"), "b": ("volcano databases", "violin kernels")}


def rss(prefix: str, now) -> bytes:
    items = "".join(
        f"<item><title>{TOPICS[prefix][n]} launch</title>"
        f"<link>https://{prefix}.test/{n}</link><description>d</description>"
        f"<pubDate>{format_datetime(now - timedelta(hours=1 + n))}</pubDate></item>"
        for n in range(2)
    )
    return (
        '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>'
        f"<link>https://{prefix}.test</link><description>d</description>{items}</channel></rss>"
    ).encode()


def client(now, broken: frozenset[str] = frozenset()) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host.removesuffix(".test")
        if host in broken:
            return httpx.Response(500)
        return httpx.Response(200, content=rss(host, now))

    return httpx.Client(transport=httpx.MockTransport(handler))


def write_sources(tmp_path) -> str:
    path = tmp_path / "sources.yaml"
    path.write_text(
        "sources:\n"
        + "".join(
            f"  - id: {i}\n    name: {i}\n    tier: primary\n    kind: feed\n"
            f"    url: https://{i}.test/feed\n"
            for i in ("a", "b")
        ),
        encoding="utf-8",
    )
    return str(path)


def test_collect_stats(store, now):
    stats = collect(store, [src("a"), src("b")], client(now), now)
    assert stats["llm_calls"] == 0 and stats["sources_ok"] == 2 and stats["new_items"] == 4
    assert stats["failed"] == [] and stats["new_clusters"] == 4


def test_collect_twice_adds_nothing(store, now):
    sources = [src("a"), src("b")]
    collect(store, sources, client(now), now)
    again = collect(store, sources, client(now), now)
    assert again["new_items"] == 0 and again["new_clusters"] == 0


def run_collect(tmp_path, monkeypatch, now, broken, capsys):
    monkeypatch.setattr(cli, "make_client", lambda: client(now, frozenset(broken)))
    db = tmp_path / "sub" / "radar.db"
    argv = ["collect", "--db", str(db), "--sources", write_sources(tmp_path), "--show", "2"]
    code = main(argv)
    return code, db, capsys.readouterr().out


def test_one_bad_source_does_not_fail_the_run(tmp_path, monkeypatch, now, capsys):
    code, db, out = run_collect(tmp_path, monkeypatch, now, {"a"}, capsys)
    assert code == 0
    stats = json.loads(out.splitlines()[0])
    assert stats["failed"] == ["a"] and stats["sources_ok"] == 1
    assert len(out.splitlines()) == 3  # stats line plus two candidates
    store = SqliteStore(str(db))
    try:
        run = store.last_run()
    finally:
        store.close()
    assert run["finished_at"] is not None and run["stats"] == stats


def test_all_sources_failing_exits_1(tmp_path, monkeypatch, now, capsys):
    code, _, out = run_collect(tmp_path, monkeypatch, now, {"a", "b"}, capsys)
    assert code == 1
    assert json.loads(out.splitlines()[0])["sources_failed"] == 2


def test_check_sources_reports_each_source_and_exits_0(tmp_path, monkeypatch, now, capsys):
    monkeypatch.setattr(cli, "make_client", lambda: client(now, frozenset({"b"})))
    assert main(["check-sources", "--sources", write_sources(tmp_path)]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == "a: ok 2 items" and lines[1].startswith("b: FAIL ")


def test_no_anthropic_import():
    import radar.cli  # noqa: F401

    assert not any(m.startswith("anthropic") for m in sys.modules)


def test_main_requires_a_command():
    with pytest.raises(SystemExit):
        main([])
