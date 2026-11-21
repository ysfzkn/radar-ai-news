"""Notices for the owner after a daily run: a short Turkish text, Telegram and e-mail."""

import re
import smtplib
import ssl
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from urllib.parse import urlsplit

import httpx

from radar.budget import ISTANBUL

LIMIT = 1500
ERROR_CHARS = 300
MAX_PATHS = 5
PATH_CHARS = 100
MONTHS = ("Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara")
TELEGRAM = "https://api.telegram.org/bot{token}/sendMessage"
FIELD_PATH = re.compile(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*")

# The third-person possessive suffix after a number depends on its last spoken word.
_UNITS = ("'ı", "'i", "'si", "'ü", "'ü", "'i", "'sı", "'si", "'i", "'u")
_TENS = ("", "'u", "'si", "'u", "'ı", "'si", "'ı", "'i", "'i", "'ı")


class NotifyError(Exception):
    """A notice could not be sent. The text never holds a token, a URL or a password."""


@dataclass
class Summary:
    collected: dict  # the collect statistics
    run: dict | None  # the run statistics, None if the step did not happen
    push: dict | None
    review: int  # review stories this push delivered, whichever run wrote them
    published: int  # auto-published stories this push delivered, whichever run wrote them
    cap_reached: bool
    failed_step: str | None  # "collect" | "run" | "push"
    error: str | None  # one line, already cleaned of secrets
    admin_url: str | None
    waiting: int = 0  # unsent stories, counted when the push was skipped for missing settings
    mode: str = "normal"  # "normal" | "review_all" | "collect_only" (see radar.daily.MODES)


def _possessive(n: int) -> str:
    """`4'ü`, `5'i`, `6'sı` …: correct for 0–99; larger numbers follow their last two digits."""
    units, tens = n % 10, (n // 10) % 10
    if units == 0 and tens > 0:
        return f"{n}{_TENS[tens]}"
    return f"{n}{_UNITS[units]}"


def _sources_failing(s: Summary) -> bool:
    failed = s.collected.get("sources_failed", 0)
    total = s.collected.get("sources_ok", 0) + failed
    return total > 0 and failed * 2 >= total


def _rejected(s: Summary) -> list:
    return list((s.push or {}).get("rejected") or [])


def _unsent(s: Summary) -> int:
    """Stories left waiting because the push was skipped (the admin settings are missing)."""
    return s.waiting if (s.push or {}).get("skipped") else 0


def _trouble(s: Summary) -> bool:
    return bool(s.failed_step or s.cap_reached or _unsent(s) or _sources_failing(s) or _rejected(s))


def needs_notice(s: Summary) -> bool:
    return s.review > 0 or _trouble(s)


def _date(now: datetime | None) -> str:
    local = (now or datetime.now(UTC)).astimezone(ISTANBUL)
    return f"{local.day} {MONTHS[local.month - 1]}"


def field_paths(values: object) -> list[str]:
    """Field names only (`texts.tr.title`), each once, at most MAX_PATHS + 1 of them
    (one more than is shown, so a message can say there were more); anything else the
    admin service sent is dropped."""
    found: list[str] = []
    for path in values if isinstance(values, list) else []:
        if isinstance(path, str) and len(path) <= PATH_CHARS and FIELD_PATH.fullmatch(path):
            if path not in found:
                found.append(path)
        if len(found) > MAX_PATHS:
            break
    return found


def origin(url: str | None) -> str | None:
    """Scheme, host and port of an http(s) URL; user-info, path, query and fragment go."""
    try:
        parts = urlsplit(url or "")
        host, port = parts.hostname, parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not host:
        return None
    host = f"[{host}]" if ":" in host else host
    return f"{parts.scheme}://{host}" + (f":{port}" if port is not None else "")


def render(s: Summary, *, now: datetime | None = None) -> str:
    """Turkish plain text, only the lines that apply; never story text, never a secret."""
    lines = [f"Radar · {_date(now)}"]
    if s.mode == "collect_only":
        lines.append("Yalnızca kaynaklar toplandı; haber yazılmadı.")
    if s.review > 0:
        admin = origin(s.admin_url)
        where = f": {admin}/admin" if admin else ""
        lines.append(f"{s.review} haber onayını bekliyor{where}")
    if s.published > 0:
        lines.append(f"{s.published} haber otomatik yayımlandı")
    if s.cap_reached:
        lines.append("Günlük harcama sınırına ulaşıldı; kalan haberler yarına kaldı.")
    unsent = _unsent(s)
    if unsent > 0:
        lines.append(f"Yönetim servisi ayarlı değil; {unsent} haber gönderilmeyi bekliyor.")
    if _sources_failing(s):
        failed = s.collected.get("sources_failed", 0)
        total = s.collected.get("sources_ok", 0) + failed
        lines.append(f"{total} kaynaktan {_possessive(failed)} okunamadı.")
    rejected = _rejected(s)
    if rejected:
        paths = field_paths((s.push or {}).get("refused_paths"))
        shown = ", ".join(paths[:MAX_PATHS]) + (", …" if len(paths) > MAX_PATHS else "")
        where = f" ({shown})" if paths else ""
        lines.append(f"{len(rejected)} haberi yönetim servisi kabul etmedi{where}.")
    if s.failed_step:
        error = " ".join((s.error or "").split())[:ERROR_CHARS]
        lines.append(f"Hata ({s.failed_step}): {error}" if error else f"Hata ({s.failed_step})")
    return "\n".join(lines)[:LIMIT]


def subject(s: Summary, *, now: datetime | None = None) -> str:
    text = f"Radar · {_date(now)}"
    if s.review > 0:
        text += " · onay bekleyen haber var"
    if _trouble(s):
        text += " · dikkat gerekiyor"
    return text


def _good_token(token: str) -> bool:
    """A loose shape check before the token goes into a URL path."""
    return bool(token) and not any(c.isspace() or c in "/\\?#" for c in token)


def send_telegram(client: httpx.Client, token: str, chat_id: str, text: str) -> None:
    if not _good_token(token):
        raise NotifyError("telegram: bad token")
    body = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
    try:
        response = client.post(TELEGRAM.format(token=token), json=body, follow_redirects=False)
    except Exception as exc:
        # The exception text can hold the request URL, and with it the token.
        raise NotifyError(f"telegram: {type(exc).__name__}") from None
    if response.status_code != 200:
        raise NotifyError(f"telegram: {response.status_code}")
    try:
        ok = response.json().get("ok") is True
    except (ValueError, AttributeError):
        ok = False
    if not ok:
        raise NotifyError("telegram: ok false")


def send_email(
    text: str, subject: str, env: Mapping[str, str], sender: type = smtplib.SMTP
) -> None:
    """Send `text` when RADAR_SMTP_HOST is set; STARTTLS always, login when a user is set."""
    host = env.get("RADAR_SMTP_HOST") or ""
    if not host:
        return
    try:
        port = int(env.get("RADAR_SMTP_PORT") or 587)
    except ValueError:
        raise NotifyError("email: bad RADAR_SMTP_PORT") from None
    user = env.get("RADAR_SMTP_USER") or ""
    sender_address = env.get("RADAR_MAIL_FROM") or user
    recipient = env.get("RADAR_MAIL_TO") or ""
    if not sender_address or not recipient:
        raise NotifyError("email: set RADAR_MAIL_FROM and RADAR_MAIL_TO")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender_address
    msg["To"] = recipient
    msg.set_content(text, charset="utf-8")
    try:
        with sender(host, port, timeout=30) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if user:
                smtp.login(user, env.get("RADAR_SMTP_PASSWORD") or "")
            smtp.send_message(msg)
    except Exception as exc:
        # SMTP errors can echo what was sent, the password included.
        raise NotifyError(f"email: {type(exc).__name__}") from None
