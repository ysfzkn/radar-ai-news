import json
import subprocess
import sys
from datetime import UTC, datetime

import httpx
import pytest

from radar.notify import (
    NotifyError,
    Summary,
    needs_notice,
    render,
    send_email,
    send_telegram,
    subject,
)

NOW = datetime(2026, 11, 19, 22, 30, tzinfo=UTC)  # already 20 November in Istanbul
TOKEN = "123456:test-token"
PASSWORD = "test-password"


def healthy(**changes) -> Summary:
    values = dict(
        collected={"sources_ok": 7, "sources_failed": 0, "new_items": 12, "candidates": 5},
        run={"written": 0, "budget_stopped": False},
        push={"pushed": 0, "duplicates": 0, "batches": 0, "rejected": [], "parked": 0},
        review=0,
        published=0,
        cap_reached=False,
        failed_step=None,
        error=None,
        admin_url="https://admin.example.com",
    )
    values.update(changes)
    return Summary(**values)


def refused_push() -> dict:
    return {
        "pushed": 1,
        "duplicates": 0,
        "batches": 1,
        "rejected": ["0123456789abcdef0123456789abcdef"],
        "parked": 1,
        "refused_paths": ["texts.tr.title"],
    }


def test_a_quiet_healthy_run_needs_no_notice():
    assert not needs_notice(healthy())
    assert not needs_notice(healthy(published=3))
    assert not needs_notice(healthy(collected={"sources_ok": 4, "sources_failed": 3}))
    assert not needs_notice(healthy(collected={}, push=None))


@pytest.mark.parametrize(
    "changes",
    [
        {"review": 1},
        {"failed_step": "run", "error": "RuntimeError"},
        {"cap_reached": True},
        {"collected": {"sources_ok": 3, "sources_failed": 3}},
        {"collected": {"sources_ok": 0, "sources_failed": 1}},
        {"push": refused_push()},
    ],
    ids=["review", "failed-step", "cap", "half-the-sources", "every-source", "refusal"],
)
def test_each_condition_needs_a_notice(changes):
    assert needs_notice(healthy(**changes))


def test_a_skipped_push_with_stories_waiting_needs_a_notice():
    assert needs_notice(healthy(push={"skipped": True}, waiting=3))
    assert not needs_notice(healthy(push={"skipped": True}, waiting=0))
    assert not needs_notice(healthy(push={"skipped": True}))
    # Only a push skipped for missing settings is meant; a pushed run has nothing waiting.
    assert not needs_notice(healthy(waiting=3))


def test_a_skipped_push_line_sits_after_the_cap_line_and_before_the_sources_line():
    summary = healthy(
        collected={"sources_ok": 1, "sources_failed": 1},
        run={"written": 1, "budget_stopped": True},
        push={"skipped": True},
        cap_reached=True,
        waiting=4,
        admin_url=None,
    )
    assert render(summary, now=NOW).splitlines() == [
        "Radar · 20 Kas",
        "Günlük harcama sınırına ulaşıldı; kalan haberler yarına kaldı.",
        "Yönetim servisi ayarlı değil; 4 haber gönderilmeyi bekliyor.",
        "2 kaynaktan 1'i okunamadı.",
    ]
    assert subject(summary, now=NOW) == "Radar · 20 Kas · dikkat gerekiyor"
    assert "gönderilmeyi" not in render(healthy(waiting=4), now=NOW)


def test_render_lists_only_the_lines_that_apply_and_stays_under_1500_characters():
    assert render(healthy(review=2), now=NOW) == (
        "Radar · 20 Kas\n2 haber onayını bekliyor: https://admin.example.com/admin"
    )
    assert render(healthy(review=1, admin_url=None), now=NOW) == (
        "Radar · 20 Kas\n1 haber onayını bekliyor"
    )
    everything = healthy(
        collected={"sources_ok": 3, "sources_failed": 4},
        review=2,
        published=3,
        cap_reached=True,
        push=refused_push(),
        failed_step="push",
        error="PushError: admin service answered 500",
    )
    assert render(everything, now=NOW).splitlines() == [
        "Radar · 20 Kas",
        "2 haber onayını bekliyor: https://admin.example.com/admin",
        "3 haber otomatik yayımlandı",
        "Günlük harcama sınırına ulaşıldı; kalan haberler yarına kaldı.",
        "7 kaynaktan 4'ü okunamadı.",
        "1 haberi yönetim servisi kabul etmedi (texts.tr.title).",
        "Hata (push): PushError: admin service answered 500",
    ]
    huge = healthy(
        push={**refused_push(), "rejected": ["u"] * 500, "refused_paths": ["texts.a"] * 500},
        failed_step="run",
        error="E" * 5000,
    )
    assert len(render(huge, now=NOW)) <= 1500


@pytest.mark.parametrize(
    ("ok", "failed", "line"),
    [
        (1, 1, "2 kaynaktan 1'i okunamadı."),
        (1, 2, "3 kaynaktan 2'si okunamadı."),
        (0, 3, "3 kaynaktan 3'ü okunamadı."),
        (1, 5, "6 kaynaktan 5'i okunamadı."),
        (0, 6, "6 kaynaktan 6'sı okunamadı."),
        (1, 9, "10 kaynaktan 9'u okunamadı."),
        (0, 10, "10 kaynaktan 10'u okunamadı."),
        (0, 20, "20 kaynaktan 20'si okunamadı."),
        (0, 40, "40 kaynaktan 40'ı okunamadı."),
        (10, 13, "23 kaynaktan 13'ü okunamadı."),
    ],
)
def test_the_source_line_uses_the_right_turkish_suffix(ok, failed, line):
    text = render(healthy(collected={"sources_ok": ok, "sources_failed": failed}), now=NOW)
    assert text.splitlines()[1] == line


def test_render_never_contains_story_text():
    story_title = "Gizli başlık: A2UI 1.0 çıktı"
    summary = healthy(
        collected={"sources_ok": 1, "sources_failed": 1, "failed": ["a"]},
        run={"written": 1, "title": story_title},
        push={**refused_push(), "refused_paths": [story_title]},
        review=1,
    )
    text = render(summary, now=NOW)
    assert story_title not in text and "Gizli" not in text
    assert "1 haberi yönetim servisi kabul etmedi." in text


def test_the_subject_names_what_needs_attention():
    assert subject(healthy(review=1), now=NOW) == "Radar · 20 Kas · onay bekleyen haber var"
    assert subject(healthy(cap_reached=True), now=NOW) == "Radar · 20 Kas · dikkat gerekiyor"
    both = healthy(review=1, failed_step="run", error="RuntimeError")
    assert subject(both, now=NOW) == "Radar · 20 Kas · onay bekleyen haber var · dikkat gerekiyor"


def telegram(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_telegram_posts_the_text_to_the_bot_endpoint():
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"ok": True, "result": {}})

    send_telegram(telegram(handler), TOKEN, "42", "Radar · 20 Kas")
    (request,) = seen
    assert request.method == "POST"
    assert str(request.url) == f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    assert json.loads(request.content) == {
        "chat_id": "42",
        "text": "Radar · 20 Kas",
        "disable_web_page_preview": True,
    }


def leaks(exc: NotifyError) -> bool:
    text = f"{exc} {exc!r} {exc.args}"
    return TOKEN in text or "api.telegram.org" in text or "test-token" in text


@pytest.mark.parametrize(
    "answer",
    [
        lambda r: httpx.Response(401, json={"ok": False, "description": f"bad {TOKEN}"}),
        lambda r: httpx.Response(200, json={"ok": False}),
        lambda r: httpx.Response(200, text="not json"),
        lambda r: httpx.Response(302, headers={"location": f"https://evil.test/{TOKEN}"}),
    ],
    ids=["401", "ok-false", "not-json", "redirect"],
)
def test_telegram_failures_never_leak_the_token_or_the_url(answer):
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        return answer(request)

    with pytest.raises(NotifyError) as caught:
        send_telegram(telegram(handler), TOKEN, "42", "x")
    assert str(caught.value).startswith("telegram: ") and not leaks(caught.value)
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None or caught.value.__suppress_context__
    assert len(seen) == 1  # a redirect is never followed


def test_telegram_transport_error_text_never_leaks():
    def handler(request):
        raise httpx.ConnectError(f"cannot reach {request.url}", request=request)

    with pytest.raises(NotifyError) as caught:
        send_telegram(telegram(handler), TOKEN, "42", "x")
    assert str(caught.value) == "telegram: ConnectError" and not leaks(caught.value)
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


@pytest.mark.parametrize("token", ["", "12/34", "12 34", "12\n34"])
def test_a_bad_telegram_token_is_refused_without_sending(token):
    def handler(request):
        raise AssertionError("no request expected")

    with pytest.raises(NotifyError, match="^telegram: bad token$"):
        send_telegram(telegram(handler), token, "42", "x")


class FakeSMTP:
    """Records what smtplib.SMTP would have been asked to do; sends nothing."""

    instances: list["FakeSMTP"] = []
    fail_on: str | None = None

    def __init__(self, host, port, timeout=None):
        self.calls: list[tuple] = [("connect", host, port, timeout)]
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append(("quit",))
        return False

    def _step(self, name, *args):
        self.calls.append((name, *args))
        if FakeSMTP.fail_on == name:
            raise OSError(f"{name} failed for {args}")

    def starttls(self, **kwargs):
        self._step("starttls")

    def login(self, user, password):
        self._step("login", user, password)

    def send_message(self, msg):
        self._step("send_message", msg)


@pytest.fixture
def smtp():
    FakeSMTP.instances = []
    FakeSMTP.fail_on = None
    yield FakeSMTP
    FakeSMTP.instances = []
    FakeSMTP.fail_on = None


MAIL_ENV = {
    "RADAR_SMTP_HOST": "smtp.example.com",
    "RADAR_SMTP_USER": "radar@example.com",
    "RADAR_SMTP_PASSWORD": PASSWORD,
    "RADAR_MAIL_FROM": "radar@example.com",
    "RADAR_MAIL_TO": "owner@example.com",
}


def test_email_uses_starttls_logs_in_and_sends_utf8(smtp):
    send_email("2 haber onayını bekliyor", "Radar · 20 Kas", MAIL_ENV, sender=smtp)
    (conn,) = smtp.instances
    names = [c[0] for c in conn.calls]
    assert names == ["connect", "starttls", "login", "send_message", "quit"]
    assert conn.calls[0] == ("connect", "smtp.example.com", 587, 30)
    assert conn.calls[2] == ("login", "radar@example.com", PASSWORD)
    msg = conn.calls[3][1]
    assert msg["Subject"] == "Radar · 20 Kas"
    assert msg["From"] == "radar@example.com" and msg["To"] == "owner@example.com"
    assert msg.get_content_type() == "text/plain" and msg.get_content_charset() == "utf-8"
    assert msg.get_content().strip() == "2 haber onayını bekliyor"


def test_email_without_a_user_skips_login_and_honours_the_port(smtp):
    env = {k: v for k, v in MAIL_ENV.items() if k not in ("RADAR_SMTP_USER",)}
    send_email("x", "s", {**env, "RADAR_SMTP_PORT": "2525"}, sender=smtp)
    (conn,) = smtp.instances
    assert [c[0] for c in conn.calls] == ["connect", "starttls", "send_message", "quit"]
    assert conn.calls[0][2] == 2525


def test_email_is_not_sent_without_a_host(smtp):
    send_email("x", "s", {k: v for k, v in MAIL_ENV.items() if k != "RADAR_SMTP_HOST"}, smtp)
    assert smtp.instances == []


@pytest.mark.parametrize("step", ["starttls", "login", "send_message"])
def test_email_failure_does_not_leak_the_password(smtp, step):
    smtp.fail_on = step
    with pytest.raises(NotifyError) as caught:
        send_email("x", "s", MAIL_ENV, sender=smtp)
    assert str(caught.value) == "email: OSError"
    assert PASSWORD not in f"{caught.value!r} {caught.value.args}"
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


def test_notify_does_not_import_anthropic():
    code = (
        "import sys, radar.notify;"
        "sys.exit(1 if any(m.startswith('anthropic') for m in sys.modules) else 0)"
    )
    assert subprocess.run([sys.executable, "-c", code]).returncode == 0
