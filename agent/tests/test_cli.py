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


CREDENTIAL_ENV = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_CONFIG_DIR",
    "ANTHROPIC_PROFILE",
    "ANTHROPIC_FEDERATION_RULE_ID",
    "ANTHROPIC_ORGANIZATION_ID",
    "ANTHROPIC_IDENTITY_TOKEN",
    "ANTHROPIC_IDENTITY_TOKEN_FILE",
)


def no_credentials(monkeypatch, tmp_path, platform="win32"):
    for name in CREDENTIAL_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    monkeypatch.setattr(cli.Path, "home", lambda: tmp_path / "home")
    monkeypatch.setattr(cli.sys, "platform", platform)


def profile_file(config_dir, name="default"):
    path = config_dir / "configs" / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}", encoding="utf-8")
    return path


def test_credential_from_env(monkeypatch, tmp_path):
    no_credentials(monkeypatch, tmp_path)
    assert not cli._has_credential()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    assert not cli._has_credential()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    assert cli._has_credential()
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "dummy")
    assert cli._has_credential()


def test_credential_from_federation_env(monkeypatch, tmp_path):
    no_credentials(monkeypatch, tmp_path)
    monkeypatch.setenv("ANTHROPIC_FEDERATION_RULE_ID", "r")
    monkeypatch.setenv("ANTHROPIC_ORGANIZATION_ID", "o")
    assert not cli._has_credential()
    monkeypatch.setenv("ANTHROPIC_IDENTITY_TOKEN_FILE", str(tmp_path / "token"))
    assert cli._has_credential()


def test_windows_profile_lives_under_appdata(monkeypatch, tmp_path):
    no_credentials(monkeypatch, tmp_path, platform="win32")
    profile_file(tmp_path / "home" / ".config" / "anthropic")  # not where the SDK looks
    assert not cli._has_credential()
    (tmp_path / "appdata" / "Anthropic" / "configs").mkdir(parents=True)  # a bare directory
    assert not cli._has_credential()
    profile_file(tmp_path / "appdata" / "Anthropic")
    assert cli._has_credential()


def test_windows_without_appdata_uses_roaming_under_home(monkeypatch, tmp_path):
    no_credentials(monkeypatch, tmp_path, platform="win32")
    monkeypatch.delenv("APPDATA")
    profile_file(tmp_path / "home" / "AppData" / "Roaming" / "Anthropic")
    assert cli._has_credential()


def test_posix_profile_lives_under_dot_config(monkeypatch, tmp_path):
    no_credentials(monkeypatch, tmp_path, platform="linux")
    profile_file(tmp_path / "appdata" / "Anthropic")  # ignored off Windows
    assert not cli._has_credential()
    profile_file(tmp_path / "home" / ".config" / "anthropic")
    assert cli._has_credential()


def test_config_dir_env_overrides_the_platform_default(monkeypatch, tmp_path):
    no_credentials(monkeypatch, tmp_path)
    profile_file(tmp_path / "appdata" / "Anthropic")
    monkeypatch.setenv("ANTHROPIC_CONFIG_DIR", str(tmp_path / "custom"))
    assert not cli._has_credential()
    profile_file(tmp_path / "custom")
    assert cli._has_credential()


def test_active_profile_comes_from_env_then_pointer_file(monkeypatch, tmp_path):
    no_credentials(monkeypatch, tmp_path)
    config = tmp_path / "appdata" / "Anthropic"
    profile_file(config, "default")
    (config / "active_config").write_text("work\n", encoding="utf-8")
    assert not cli._has_credential()  # the pointer names work, and work.json is missing
    profile_file(config, "work")
    assert cli._has_credential()
    monkeypatch.setenv("ANTHROPIC_PROFILE", "dev")
    assert not cli._has_credential()
    profile_file(config, "dev")
    assert cli._has_credential()
    monkeypatch.setenv("ANTHROPIC_PROFILE", "../dev")  # the SDK rejects such a name
    assert not cli._has_credential()


def test_cli_run_without_credentials_exits_2(tmp_path, monkeypatch, capsys):
    no_credentials(monkeypatch, tmp_path)
    (tmp_path / "home" / ".config" / "anthropic").mkdir(parents=True)  # a bare directory
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


def test_cli_dry_run_estimate_follows_the_reserve_rule(tmp_path, monkeypatch, now, capsys):
    import radar.budget
    import radar.score
    from radar.score import SCORE_MODEL
    from radar.score import SYSTEM as SCORE_SYSTEM
    from radar.source import MAX_LINKS_CHARS, MAX_SOURCE_CHARS
    from radar.write import SYSTEM as WRITE_SYSTEM
    from radar.write import WRITE_MODEL

    monkeypatch.setattr(cli, "make_client", lambda: run_client(now))
    monkeypatch.setattr(radar.score, "score_user_message", lambda cands: "ğ" * 10)  # 20 bytes
    seen: list[tuple] = []
    real = radar.budget.worst_case_usd

    def spy(model, input_bytes, max_tokens):
        seen.append((model, input_bytes, max_tokens))
        return real(model, input_bytes, max_tokens)

    monkeypatch.setattr(radar.budget, "worst_case_usd", spy)
    assert main(run_args(tmp_path, "--dry-run", "--max-stories", "3")) == 0
    out = json.loads(capsys.readouterr().out)
    writer_bytes = len(WRITE_SYSTEM.encode("utf-8")) + MAX_SOURCE_CHARS + MAX_LINKS_CHARS + 300
    assert seen == [
        (SCORE_MODEL, len(SCORE_SYSTEM.encode("utf-8")) + 20, 4000),
        (WRITE_MODEL, writer_bytes, 2000),
    ]
    # each writer call may be billed twice (declined attempt plus fallback)
    expected = real(SCORE_MODEL, len(SCORE_SYSTEM.encode("utf-8")) + 20, 4000)
    expected += 3 * 2 * real(WRITE_MODEL, writer_bytes, 2000)
    assert out["worst_case_usd"] == round(expected, 4)


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
    assert stats["scoring_failed"] is False
    assert main(["budget", "--db", str(tmp_path / "r.db")]) == 0
    budget = json.loads(capsys.readouterr().out)
    assert budget["spent_usd"] == 0.0062 and budget["tokens"] == 3400 and budget["calls"] == 2
    assert budget["by_step"]["score"]["calls"] == 1 and budget["by_step"]["write"]["calls"] == 1


def test_cli_run_records_an_unexpected_error_and_reraises(tmp_path, monkeypatch, now, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setattr(cli, "make_client", lambda: run_client(now))

    class Broken:
        def parse(self, **kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr(cli, "_make_llm", lambda meter: Broken())
    with pytest.raises(RuntimeError, match="boom"):
        main(run_args(tmp_path))
    assert capsys.readouterr().out == ""
    store = SqliteStore(str(tmp_path / "r.db"))
    try:
        run = store.last_run()
    finally:
        store.close()
    assert run["kind"] == "run" and run["finished_at"] is not None
    assert run["stats"]["error"] == "RuntimeError" and run["stats"]["sources_ok"] == 2


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


# --- radar push ---------------------------------------------------------------------------


def push_db(tmp_path, now, count: int) -> str:
    from radar.models import Draft, FactCard, Score, StoryText

    path = str(tmp_path / "push.db")
    store = SqliteStore(path, cli.MIGRATIONS)
    run = store.start_run("run", now)
    for n in range(count):
        cluster = store.create_cluster(f"cluster {n}", now)
        text = StoryText(title=f"t{n}", summary="s", dev_line="d")
        store.insert_story(
            cluster_id=cluster,
            run_id=run,
            status="review",
            reasons=[],
            score=Score(cluster_id=cluster, relevance=3, novelty=3, usefulness=3, category="model"),
            draft=Draft(
                fact_card=FactCard(what="x", who=[], numbers=[], versions=[]), tr=text, en=text
            ),
            source_url="https://example.com/a",
            source_count=1,
            created_at=now,
        )
    store.close()
    return path


def no_push_env(monkeypatch):
    monkeypatch.delenv("RADAR_ADMIN_URL", raising=False)
    monkeypatch.delenv("RADAR_INGEST_TOKEN", raising=False)


def forbid_http(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("no request expected")

    monkeypatch.setattr(httpx.Client, "send", boom)


def test_cli_push_without_token_exits_2(tmp_path, monkeypatch, now, capsys):
    no_push_env(monkeypatch)
    forbid_http(monkeypatch)
    db = push_db(tmp_path, now, 1)
    assert main(["push", "--db", db, "--url", "https://admin.example.com"]) == 2
    captured = capsys.readouterr()
    assert "RADAR_INGEST_TOKEN" in captured.err and captured.out == ""


def test_cli_push_without_url_exits_2(tmp_path, monkeypatch, now, capsys):
    no_push_env(monkeypatch)
    monkeypatch.setenv("RADAR_INGEST_TOKEN", "test-token")
    forbid_http(monkeypatch)
    assert main(["push", "--db", push_db(tmp_path, now, 1)]) == 2
    assert "RADAR_ADMIN_URL" in capsys.readouterr().err


def test_cli_push_rejects_a_plain_http_remote_url(tmp_path, monkeypatch, now, capsys):
    no_push_env(monkeypatch)
    monkeypatch.setenv("RADAR_INGEST_TOKEN", "test-token")
    forbid_http(monkeypatch)
    argv = ["push", "--db", push_db(tmp_path, now, 1), "--url", "http://admin.example.com"]
    assert main(argv) == 2
    err = capsys.readouterr().err
    assert len(err.strip().splitlines()) == 1 and "test-token" not in err


def test_cli_push_with_nothing_to_push_makes_no_request(tmp_path, monkeypatch, now, capsys):
    no_push_env(monkeypatch)
    monkeypatch.setenv("RADAR_INGEST_TOKEN", "test-token")
    monkeypatch.setenv("RADAR_ADMIN_URL", "https://admin.example.com")
    forbid_http(monkeypatch)
    assert main(["push", "--db", push_db(tmp_path, now, 0)]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "pushed": 0,
        "duplicates": 0,
        "batches": 0,
        "rejected": [],
        "parked": 0,
    }


def test_cli_push_sends_and_prints_stats(tmp_path, monkeypatch, now, capsys):
    no_push_env(monkeypatch)
    monkeypatch.setenv("RADAR_INGEST_TOKEN", "test-token")
    monkeypatch.setenv("RADAR_ADMIN_URL", "https://admin.example.com/")
    db = push_db(tmp_path, now, 2)
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        uids = [s["uid"] for s in json.loads(request.content)["stories"]]
        return httpx.Response(200, json={"accepted": uids, "duplicates": []})

    real = httpx.Client
    monkeypatch.setattr(
        httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw)
    )
    assert main(["push", "--db", db]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "pushed": 2,
        "duplicates": 0,
        "batches": 1,
        "rejected": [],
        "parked": 0,
    }
    assert str(seen[0].url) == "https://admin.example.com/api/ingest"
    store = SqliteStore(db)
    try:
        assert store.unpushed_stories() == []
    finally:
        store.close()


def test_cli_push_failure_exits_1_without_the_token(tmp_path, monkeypatch, now, capsys):
    no_push_env(monkeypatch)
    monkeypatch.setenv("RADAR_INGEST_TOKEN", "test-token")
    monkeypatch.setenv("RADAR_ADMIN_URL", "https://admin.example.com")
    db = push_db(tmp_path, now, 1)
    real = httpx.Client
    handler = lambda r: httpx.Response(500, json={"error": "boom"})  # noqa: E731
    monkeypatch.setattr(
        httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw)
    )
    assert main(["push", "--db", db]) == 1
    captured = capsys.readouterr()
    assert "500" in captured.err and "test-token" not in captured.err + captured.out


def test_cli_push_with_a_rejected_story_exits_1_and_names_it(tmp_path, monkeypatch, now, capsys):
    no_push_env(monkeypatch)
    monkeypatch.setenv("RADAR_INGEST_TOKEN", "test-token")
    monkeypatch.setenv("RADAR_ADMIN_URL", "https://admin.example.com")
    db = push_db(tmp_path, now, 2)

    def handler(request):
        uids = [s["uid"] for s in json.loads(request.content)["stories"]]
        if len(uids) == 2:
            return httpx.Response(
                400, json={"error": "invalid", "path": "stories.0.texts.en.title"}
            )
        return httpx.Response(200, json={"accepted": uids, "duplicates": []})

    real = httpx.Client
    monkeypatch.setattr(
        httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw)
    )
    store = SqliteStore(db)
    try:
        first = store.unpushed_stories()[0].uid
    finally:
        store.close()
    assert main(["push", "--db", db]) == 1
    captured = capsys.readouterr()
    stats = json.loads(captured.out)
    assert stats["pushed"] == 1 and stats["rejected"] == [first] and stats["parked"] == 1
    lines = captured.err.strip().splitlines()
    assert len(lines) == 1
    assert first in lines[0] and "stories.0.texts.en.title" in lines[0]
    assert "test-token" not in captured.err + captured.out


def refusing_client(monkeypatch, seen: list):
    """Refuse the first story of any two-story request; accept anything smaller."""

    def handler(request):
        seen.append(request)
        uids = [s["uid"] for s in json.loads(request.content)["stories"]]
        if len(uids) == 2:
            return httpx.Response(
                400, json={"error": "invalid", "path": "stories.0.texts.tr.title"}
            )
        return httpx.Response(200, json={"accepted": uids, "duplicates": []})

    real = httpx.Client
    monkeypatch.setattr(
        httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw)
    )


def push_env(monkeypatch):
    no_push_env(monkeypatch)
    monkeypatch.setenv("RADAR_INGEST_TOKEN", "test-token")
    monkeypatch.setenv("RADAR_ADMIN_URL", "https://admin.example.com")


def test_cli_push_exits_1_only_when_this_call_refused_something(tmp_path, monkeypatch, now, capsys):
    push_env(monkeypatch)
    db = push_db(tmp_path, now, 2)
    seen: list = []
    refusing_client(monkeypatch, seen)
    assert main(["push", "--db", db]) == 1
    capsys.readouterr()
    count = len(seen)
    assert main(["push", "--db", db]) == 0
    captured = capsys.readouterr()
    assert json.loads(captured.out)["parked"] == 1 and captured.err == ""
    assert len(seen) == count  # nothing left to send, so no request


def test_cli_retry_refused_sends_the_parked_story_again(tmp_path, monkeypatch, now, capsys):
    push_env(monkeypatch)
    db = push_db(tmp_path, now, 2)
    refusing_client(monkeypatch, [])
    assert main(["push", "--db", db]) == 1
    capsys.readouterr()
    assert main(["push", "--db", db, "--retry-refused"]) == 0
    stats = json.loads(capsys.readouterr().out)
    assert stats["pushed"] == 1 and stats["parked"] == 0 and stats["rejected"] == []


def test_cli_list_refused_prints_and_makes_no_request(tmp_path, monkeypatch, now, capsys):
    no_push_env(monkeypatch)
    forbid_http(monkeypatch)
    db = push_db(tmp_path, now, 2)
    store = SqliteStore(db)
    try:
        uid = store.unpushed_stories()[0].uid
        store.mark_refused(uid, "texts.tr.title", now)
    finally:
        store.close()
    assert main(["push", "--db", db, "--list-refused"]) == 0
    captured = capsys.readouterr()
    (line,) = captured.out.strip().splitlines()
    assert uid in line and "texts.tr.title" in line and "t0" in line
    assert now.isoformat() in line
    assert captured.err == ""
