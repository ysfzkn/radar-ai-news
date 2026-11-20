import io
import json
import subprocess
import sys
from datetime import timedelta

import httpx
import pytest

from fakes import FakeLLM
from radar import cli
from radar.budget import BudgetExceeded
from radar.daily import run_daily
from radar.models import Draft, FactCard, Score, StoryText
from radar.score import ScoreBatch
from radar.store import SqliteStore
from test_cli import ARTICLE_HTML, rss, write_sources

ADMIN = "https://admin.example.com"
SECRETS = {
    "RADAR_INGEST_TOKEN": "test-ingest-token",
    "TELEGRAM_BOT_TOKEN": "123456:test-bot-token",
    "ANTHROPIC_API_KEY": "test-anthropic-key",
    "RADAR_SMTP_PASSWORD": "test-smtp-password",
    "RADAR_STATE_KEY": "test-passphrase-0123456789",
}
ENV = {
    "RADAR_ADMIN_URL": ADMIN,
    "RADAR_INGEST_TOKEN": SECRETS["RADAR_INGEST_TOKEN"],
    "TELEGRAM_BOT_TOKEN": SECRETS["TELEGRAM_BOT_TOKEN"],
    "TELEGRAM_CHAT_ID": "42",
}
TEXT = StoryText(
    title="Quantum robots launch", summary="Quantum robots launch today.", dev_line="Try it."
)
DRAFT = Draft(fact_card=FactCard(what="Launch.", who=[], numbers=[], versions=[]), tr=TEXT, en=TEXT)


def llm(writes: list | None = None, risk: bool = True) -> FakeLLM:
    """Scores every candidate highly (with a risk flag: the story goes to review)."""

    class Scripted(FakeLLM):
        def parse(self, **kwargs):
            if kwargs["step"] == "score":
                ids = [int(line[1 : line.index("]")]) for line in kwargs["user"].splitlines()]
                flags = ["regulation"] if risk else []
                scores = [
                    Score(
                        cluster_id=i,
                        relevance=5,
                        novelty=5,
                        usefulness=5,
                        category="tooling",
                        risk_flags=flags,
                    )
                    for i in ids
                ]
                self._replies["score"] = [ScoreBatch(scores=scores)]
            return super().parse(**kwargs)

    return Scripted({"write": writes if writes is not None else [DRAFT] * 4})


class World:
    """Sources, the admin service and Telegram behind one MockTransport."""

    def __init__(self, now, admin=None, telegram=None):
        self.now = now
        self.admin = admin or self.accept
        self.telegram = telegram or (lambda r: httpx.Response(200, json={"ok": True}))
        self.requests: list[httpx.Request] = []
        self.kinds: list[str] = []

    @staticmethod
    def accept(request):
        uids = [s["uid"] for s in json.loads(request.content)["stories"]]
        return httpx.Response(200, json={"accepted": uids, "duplicates": []})

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "admin.example.com":
            return self.admin(request)
        if request.url.host == "api.telegram.org":
            return self.telegram(request)
        if request.url.path == "/feed":
            return httpx.Response(
                200, content=rss(request.url.host.removesuffix(".test"), self.now)
            )
        return httpx.Response(200, headers={"content-type": "text/html"}, text=ARTICLE_HTML)

    def http(self, kind: str) -> httpx.Client:
        self.kinds.append(kind)
        return httpx.Client(transport=httpx.MockTransport(self.handler))

    def to(self, host: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.host == host]

    def notices(self) -> list[str]:
        return [json.loads(r.content)["text"] for r in self.to("api.telegram.org")]


def daily(tmp_path, now, world, env=ENV, factory=None, sources=None, max_stories=2):
    out = io.StringIO()
    code = run_daily(
        db_path=tmp_path / "r.db",
        sources_path=sources or write_sources(tmp_path),
        max_stories=max_stories,
        env=env,
        now=now,
        http=world.http,
        llm_factory=factory or (lambda meter: llm()),
        out=out,
    )
    lines = out.getvalue().splitlines()
    assert len(lines) == 1
    return code, json.loads(lines[0])


def test_the_chain_collects_writes_pushes_and_notifies_about_a_review_story(tmp_path, now, capsys):
    world = World(now)
    code, summary = daily(tmp_path, now, world)
    assert code == 0
    assert summary["collected"]["sources_ok"] == 2 and summary["collected"]["new_items"] == 4
    assert summary["run"]["written"] == 2 and summary["run"]["review"] == 2
    assert summary["push"]["pushed"] == 2 and summary["push"]["rejected"] == []
    assert summary["review"] == 2 and summary["published"] == 0
    assert summary["failed_step"] is None and summary["cap_reached"] is False
    assert world.notices() == [
        "Radar · 19 Kas\n2 haber onayını bekliyor: https://admin.example.com/admin"
    ]
    assert capsys.readouterr().err == ""
    store = SqliteStore(str(tmp_path / "r.db"))
    try:
        assert store.unpushed_stories() == []
        assert store.last_run()["kind"] == "run"
    finally:
        store.close()


def test_a_quiet_published_run_sends_no_notice(tmp_path, now):
    world = World(now)
    code, summary = daily(tmp_path, now, world, factory=lambda meter: llm(risk=False))
    assert code == 0 and summary["published"] == 2 and summary["review"] == 0
    assert world.to("api.telegram.org") == []


def test_a_cap_reached_run_still_pushes_what_was_written_says_so_and_exits_0(tmp_path, now):
    world = World(now)
    writes = [DRAFT, BudgetExceeded("daily cap would be exceeded")]
    code, summary = daily(tmp_path, now, world, factory=lambda meter: llm(writes))
    assert code == 0
    assert summary["cap_reached"] is True and summary["failed_step"] is None
    assert summary["run"]["budget_stopped"] is True and summary["run"]["written"] == 1
    assert summary["push"]["pushed"] == 1 and summary["review"] == 1
    (notice,) = world.notices()
    assert "Günlük harcama sınırına ulaşıldı; kalan haberler yarına kaldı." in notice
    assert "1 haber onayını bekliyor" in notice


def earlier_story(tmp_path, now) -> str:
    store = SqliteStore(str(tmp_path / "r.db"), cli.MIGRATIONS)
    try:
        run = store.start_run("run", now - timedelta(days=1))
        cluster = store.create_cluster("earlier", now - timedelta(days=1))
        store.insert_story(
            cluster_id=cluster,
            run_id=run,
            status="review",
            reasons=["risk: regulation"],
            score=Score(cluster_id=cluster, relevance=3, novelty=3, usefulness=3, category="model"),
            draft=DRAFT,
            source_url="https://example.com/a",
            source_count=1,
            created_at=now - timedelta(days=1),
        )
        return store.unpushed_stories()[0].uid
    finally:
        store.close()


def test_a_failed_run_step_still_pushes_earlier_stories_and_exits_1(tmp_path, now):
    uid = earlier_story(tmp_path, now)
    world = World(now)

    def broken(meter):
        raise RuntimeError(f"model refused {SECRETS['ANTHROPIC_API_KEY']}")

    code, summary = daily(tmp_path, now, world, factory=broken)
    assert code == 1
    assert summary["failed_step"] == "run" and summary["error"] == "RuntimeError"
    assert summary["push"]["pushed"] == 1 and summary["review"] == 0  # not of this run
    sent = json.loads(world.to("admin.example.com")[0].content)["stories"]
    assert [s["uid"] for s in sent] == [uid]
    (notice,) = world.notices()
    assert notice.splitlines()[-1] == "Hata (run): RuntimeError"
    store = SqliteStore(str(tmp_path / "r.db"))
    try:
        assert store.last_run()["stats"]["error"] == "RuntimeError"
    finally:
        store.close()


def test_a_failed_notice_is_one_stderr_line_and_does_not_change_the_exit_code(
    tmp_path, now, capsys
):
    world = World(now, telegram=lambda r: httpx.Response(500, text=r.url.path))
    code, summary = daily(tmp_path, now, world)
    assert code == 0 and summary["review"] == 2
    err = capsys.readouterr().err
    assert err.splitlines() == ["notice failed: telegram: 500"]
    assert SECRETS["TELEGRAM_BOT_TOKEN"] not in err and "api.telegram.org" not in err


def test_a_failed_notice_after_a_failed_step_keeps_exit_1(tmp_path, now, capsys):
    def boom(request):
        raise httpx.ConnectError(f"no route to {request.url}", request=request)

    world = World(now, telegram=boom)
    code, _ = daily(tmp_path, now, world, factory=lambda meter: 1 / 0)
    assert code == 1
    assert capsys.readouterr().err.splitlines() == ["notice failed: telegram: ConnectError"]


def test_without_admin_settings_push_is_skipped_and_reported(tmp_path, now):
    world = World(now)
    env = {k: v for k, v in ENV.items() if k not in ("RADAR_ADMIN_URL", "RADAR_INGEST_TOKEN")}
    code, summary = daily(tmp_path, now, world, env=env)
    assert code == 0
    assert summary["push"] == {"skipped": True} and summary["admin_url"] is None
    assert summary["review"] == 0 and summary["run"]["review"] == 2
    assert world.to("admin.example.com") == [] and "admin" not in world.kinds


def test_a_refused_story_is_reported_and_exits_0(tmp_path, now):
    def refuse_first(request):
        uids = [s["uid"] for s in json.loads(request.content)["stories"]]
        if len(uids) == 2:
            return httpx.Response(
                400, json={"error": "invalid", "path": "stories.0.texts.tr.title"}
            )
        return World.accept(request)

    world = World(now, admin=refuse_first)
    code, summary = daily(tmp_path, now, world)
    assert code == 0
    assert len(summary["push"]["rejected"]) == 1 and summary["push"]["parked"] == 1
    assert summary["push"]["refused_paths"] == ["texts.tr.title"]
    assert summary["review"] == 1
    (notice,) = world.notices()
    assert "1 haberi yönetim servisi kabul etmedi (texts.tr.title)." in notice


def test_the_summary_line_is_json_and_contains_no_secret(tmp_path, now, capsys):
    leaky = f"bad {SECRETS['RADAR_INGEST_TOKEN']} {SECRETS['RADAR_STATE_KEY']} at {ADMIN}/x?y=1"
    world = World(now, admin=lambda r: httpx.Response(500, json={"error": leaky}))
    env = {**ENV, **SECRETS, "RADAR_SMTP_HOST": ""}
    out = io.StringIO()
    code = run_daily(
        db_path=tmp_path / "r.db",
        sources_path=write_sources(tmp_path),
        max_stories=2,
        env=env,
        now=now,
        http=world.http,
        llm_factory=lambda meter: llm(),
        out=out,
    )
    assert code == 1
    (line,) = out.getvalue().splitlines()
    summary = json.loads(line)
    assert summary["failed_step"] == "push"
    assert summary["error"].startswith("PushError: admin service answered 500")
    assert "/x?y=1" not in summary["error"]
    notices = " ".join(world.notices())
    seen = line + capsys.readouterr().err + notices
    for value in SECRETS.values():
        assert value not in seen
    for request in world.to("api.telegram.org"):
        assert SECRETS["RADAR_INGEST_TOKEN"] not in request.content.decode()


def test_collect_failure_stops_the_chain(tmp_path, now):
    world = World(now)

    def never(meter):
        raise AssertionError("the run step must not start")

    missing = str(tmp_path / "missing.yaml")
    code, summary = daily(tmp_path, now, world, factory=never, sources=missing)
    assert code == 1
    assert summary["failed_step"] == "collect" and summary["run"] is None
    assert summary["push"] is None and summary["collected"] == {}
    assert world.to("admin.example.com") == []
    (notice,) = world.notices()
    assert notice.splitlines()[-1].startswith("Hata (collect): ")


def test_cli_daily_passes_its_options(tmp_path, monkeypatch):
    import radar.daily

    seen: dict = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return 0

    monkeypatch.setattr(radar.daily, "run_daily", fake)
    db = str(tmp_path / "d.db")
    argv = ["daily", "--db", db, "--sources", str(tmp_path / "s.yaml"), "--max-stories", "3"]
    assert cli.main(argv) == 0
    assert str(seen["db_path"]) == db and seen["max_stories"] == 3
    assert seen["out"] is sys.stdout and callable(seen["http"]) and callable(seen["llm_factory"])
    assert cli.main(["daily", "--db", db]) == 0
    assert seen["max_stories"] == 8


def test_daily_does_not_import_anthropic():
    code = (
        "import sys, radar.daily;"
        "sys.exit(1 if any(m.startswith('anthropic') for m in sys.modules) else 0)"
    )
    assert subprocess.run([sys.executable, "-c", code]).returncode == 0


@pytest.mark.parametrize("kind", ["admin", "telegram"])
def test_the_default_clients_never_follow_redirects(kind):
    with cli._daily_client(kind) as client:
        assert client.follow_redirects is False and client.timeout.read == 30
