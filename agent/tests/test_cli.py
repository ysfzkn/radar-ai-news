import io
import json
import sys
from datetime import timedelta
from email.utils import format_datetime

import httpx
import pytest

from radar import cli
from radar.cli import collect, main
from radar.models import RawItem, Source, Tier
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


def test_collect_clusters_items_left_over_from_an_interrupted_run(store, now):
    items = [
        RawItem(
            source_id="a",
            url=f"https://a.test/{n}",
            title=TOPICS["a"][n] + " launch",
            published_at=now - timedelta(hours=1 + n),
        )
        for n in range(2)
    ]
    store.upsert_sources([src("a")])
    store.insert_items(items)  # inserted, never clustered
    empty = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    stats = collect(store, [src("a")], empty, now)
    window = store.items_since(now - timedelta(hours=72))
    assert len(window) == 2 and all(i.cluster_id is not None for i in window)
    assert stats["new_items"] == 0 and stats["new_clusters"] > 0


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


def test_show_output_is_utf8_even_on_a_cp1254_stdout(tmp_path, monkeypatch, now):
    title = "GPT\u20116.2 Astra \u00e7\u0131\u011f\u015f\u00fc\u00f6"
    body = (
        '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>t</title>'
        f"<link>https://a.test</link><description>d</description><item><title>{title}</title>"
        "<link>https://a.test/1</link><description>d</description>"
        f"<pubDate>{format_datetime(now - timedelta(hours=1))}</pubDate></item></channel></rss>"
    ).encode()
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body)))
    monkeypatch.setattr(cli, "make_client", lambda: http)
    raw = io.BytesIO()
    stream = io.TextIOWrapper(raw, encoding="cp1254")
    monkeypatch.setattr(sys, "stdout", stream)
    argv = ["collect", "--db", str(tmp_path / "r.db"), "--sources", write_sources(tmp_path)]
    assert main([*argv, "--show", "3"]) == 0
    stream.flush()
    assert title in raw.getvalue().decode("utf-8")


# --- radar run / budget -------------------------------------------------------------------

ARTICLE_HTML = (
    "<html><body><article><p>"
    + "Quantum robots launch brings garden compilers to agents everywhere today. " * 5
    + "</p></article></body></html>"
)


def run_client(now) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/feed":
            return httpx.Response(200, content=rss(request.url.host.removesuffix(".test"), now))
        return httpx.Response(200, headers={"content-type": "text/html"}, text=ARTICLE_HTML)

    return httpx.Client(transport=httpx.MockTransport(handler))


def run_args(tmp_path, *extra) -> list[str]:
    return ["run", "--db", str(tmp_path / "r.db"), "--sources", write_sources(tmp_path), *extra]


def scripted_llm(count: int = 1):
    from fakes import FakeLLM
    from radar.models import Draft, FactCard, Score, StoryText
    from radar.score import ScoreBatch

    text = StoryText(
        title="Quantum robots launch", summary="Quantum robots launch today.", dev_line="Try it."
    )
    draft = Draft(
        fact_card=FactCard(what="Launch.", who=[], numbers=[], versions=[]), tr=text, en=text
    )

    class Scripted(FakeLLM):
        def parse(self, **kwargs):
            if kwargs["step"] == "score":
                ids = [int(line[1 : line.index("]")]) for line in kwargs["user"].splitlines()]
                scores = [
                    Score(cluster_id=i, relevance=5, novelty=5, usefulness=5, category="tooling")
                    for i in ids
                ]
                self._replies["score"] = [ScoreBatch(scores=scores)]
            self._replies.setdefault("write", [draft] * count)
            return super().parse(**kwargs)

    return Scripted({})


def test_cli_run_prints_stats_and_records_the_run(tmp_path, monkeypatch, now, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setattr(cli, "make_client", lambda: run_client(now))
    llm = scripted_llm(count=4)
    monkeypatch.setattr(cli, "_make_llm", lambda meter: llm)
    assert main(run_args(tmp_path, "--max-stories", "2")) == 0
    lines = capsys.readouterr().out.splitlines()
    stats = json.loads(lines[0])
    assert stats["written"] == 2 and stats["selected"] == 2 and stats["budget_stopped"] is False
    assert stats["llm_calls"] == 0 and stats["over_token_target"] is False  # fake bypasses meter
    assert stats["cost_today_usd"] == 0 and stats["tokens_today"] == 0
    assert len(lines) == 3 and lines[1].split("  ")[0] in ("published", "review")
    assert lines[1].endswith("Quantum robots launch")
    store = SqliteStore(str(tmp_path / "r.db"))
    try:
        run = store.last_run()
    finally:
        store.close()
    assert run["kind"] == "run" and run["stats"] == stats


def test_cli_second_run_makes_no_model_calls(tmp_path, monkeypatch, now, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setattr(cli, "make_client", lambda: run_client(now))
    monkeypatch.setattr(cli, "_make_llm", lambda meter: scripted_llm(count=4))
    assert main(run_args(tmp_path, "--max-stories", "8")) == 0
    capsys.readouterr()
    second = scripted_llm()
    monkeypatch.setattr(cli, "_make_llm", lambda meter: second)
    assert main(run_args(tmp_path, "--max-stories", "8")) == 0
    stats = json.loads(capsys.readouterr().out.splitlines()[0])
    assert second.calls == [] and stats["scored"] == 0 and stats["written"] == 0


def test_cli_run_without_credentials_exits_2(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    monkeypatch.setattr(cli.Path, "home", lambda: tmp_path / "nohome")
    called = []
    monkeypatch.setattr(cli, "make_client", lambda: called.append(1))
    assert main(run_args(tmp_path)) == 2
    captured = capsys.readouterr()
    assert captured.out == "" and called == []
    assert captured.err.strip() == (
        'No Anthropic credential found. Set ANTHROPIC_API_KEY or run "ant auth login".'
    )


def test_cli_run_rejects_an_invalid_cap(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setenv("RADAR_DAILY_CAP_USD", "abc")
    assert main(run_args(tmp_path)) == 2
    assert "RADAR_DAILY_CAP_USD" in capsys.readouterr().err


def test_cli_dry_run_makes_no_calls(tmp_path, monkeypatch, now, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(cli, "make_client", lambda: run_client(now))

    def boom(meter):
        raise AssertionError("dry run must not build an LLM")

    monkeypatch.setattr(cli, "_make_llm", boom)
    assert main(run_args(tmp_path, "--dry-run", "--max-stories", "2")) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["would_score"] == 4 and out["cap_usd"] == 0.25
    assert 0 < out["worst_case_usd"] < 0.25
    store = SqliteStore(str(tmp_path / "r.db"))
    try:
        assert store.last_run()["kind"] == "collect"
        assert store.usage_since(now - timedelta(days=3650)) == []
    finally:
        store.close()


def test_cli_budget_reports_todays_spend(tmp_path, capsys):
    from datetime import UTC, datetime

    store = SqliteStore(str(tmp_path / "r.db"), cli.MIGRATIONS)
    at = datetime.now(UTC)
    usage = dict(run_id=None, at=at)
    store.record_usage(
        step="score",
        model="claude-haiku-5-5",
        input_tokens=1000,
        output_tokens=200,
        cost_usd=0.0002,
        **usage,
    )
    store.record_usage(
        step="write",
        model="claude-sonnet-5-5",
        input_tokens=2000,
        output_tokens=500,
        cost_usd=0.009,
        **usage,
    )
    store.close()
    assert main(["budget", "--db", str(tmp_path / "r.db")]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["cap_usd"] == 0.25 and out["calls"] == 2 and out["tokens"] == 3700
    assert out["spent_usd"] == 0.0092 and out["left_usd"] == 0.2408
    assert out["by_step"]["write"] == {
        "calls": 1,
        "input_tokens": 2000,
        "output_tokens": 500,
        "cost_usd": 0.009,
    }


def test_collect_still_does_not_import_anthropic_or_agent_modules():
    import subprocess

    code = (
        "import sys, radar.cli;"
        "bad=[m for m in sys.modules if m.startswith('anthropic') or m in "
        "('radar.llm','radar.agent','radar.score','radar.write')];"
        "sys.exit(1 if bad else 0)"
    )
    assert subprocess.run([sys.executable, "-c", code]).returncode == 0


def metered_send(calls: list[dict]):
    from types import SimpleNamespace

    from radar.models import Draft, FactCard, Score, StoryText
    from radar.score import ScoreBatch

    text = StoryText(
        title="Quantum robots launch", summary="Quantum robots launch today.", dev_line="Try it."
    )
    draft = Draft(
        fact_card=FactCard(what="Launch.", who=[], numbers=[], versions=[]), tr=text, en=text
    )

    def send(**request):
        calls.append(request)
        if request["output_format"] is ScoreBatch:
            lines = request["messages"][0]["content"].splitlines()
            ids = [int(ln[1 : ln.index("]")]) for ln in lines]
            scores = [
                Score(cluster_id=i, relevance=5, novelty=5, usefulness=5, category="tooling")
                for i in ids
            ]
            body, usage = ScoreBatch(scores=scores).model_dump_json(), (1000, 200)
        else:
            body, usage = draft.model_dump_json(), (2000, 200)
        return SimpleNamespace(
            model=request["model"],
            usage=SimpleNamespace(input_tokens=usage[0], output_tokens=usage[1]),
            stop_reason="end_turn",
            stop_details=None,
            content=[SimpleNamespace(type="text", text=body)],
        )

    return send


def use_metered_llm(monkeypatch, now, calls):
    from radar.llm import AnthropicLLM

    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setattr(cli, "make_client", lambda: run_client(now))
    send = metered_send(calls)
    monkeypatch.setattr(cli, "_make_llm", lambda meter: AnthropicLLM(meter, send=send))


def test_cli_run_reports_metered_usage_and_budget_agrees(tmp_path, monkeypatch, now, capsys):
    calls: list[dict] = []
    use_metered_llm(monkeypatch, now, calls)
    assert main(run_args(tmp_path, "--max-stories", "1")) == 0
    stats = json.loads(capsys.readouterr().out.splitlines()[0])
    # score: 1000 in / 200 out on haiku = 0.0002; write: 2000 in / 200 out on sonnet = 0.006
    assert stats["llm_calls"] == 2 and len(calls) == 2
    assert stats["tokens_today"] == 3400 and stats["cost_today_usd"] == 0.0062
    assert stats["failed"] == [] and stats["stories_failed"] == 0 and stats["written"] == 1
    assert main(["budget", "--db", str(tmp_path / "r.db")]) == 0
    budget = json.loads(capsys.readouterr().out)
    assert budget["spent_usd"] == 0.0062 and budget["tokens"] == 3400 and budget["calls"] == 2
    assert budget["by_step"]["score"]["calls"] == 1 and budget["by_step"]["write"]["calls"] == 1


def test_cli_budget_stop_keeps_exit_0_and_records_it(tmp_path, monkeypatch, now, capsys):
    calls: list[dict] = []
    use_metered_llm(monkeypatch, now, calls)
    monkeypatch.setenv("RADAR_DAILY_CAP_USD", "0.01")  # scoring fits, a writer call does not
    assert main(run_args(tmp_path, "--max-stories", "1")) == 0
    stats = json.loads(capsys.readouterr().out.splitlines()[0])
    assert stats["budget_stopped"] is True and stats["written"] == 0 and stats["llm_calls"] == 1
    store = SqliteStore(str(tmp_path / "r.db"))
    try:
        run = store.last_run()
        steps = {row["step"] for row in store.usage_since(now - timedelta(days=3650))}
    finally:
        store.close()
    assert run["kind"] == "run" and run["stats"]["budget_stopped"] is True
    assert steps == {"score"} and [c["output_format"].__name__ for c in calls] == ["ScoreBatch"]
