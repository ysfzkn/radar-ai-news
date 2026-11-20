import ipaddress
import re
import unicodedata
from urllib.parse import urlsplit

from .models import Candidate, Draft, Score, SourceDoc, Status

LIMITS = {"title": 90, "summary": 320, "dev_line": 200}

_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_CLOSERS = "\"'”’)]}»"
_QUOTES = ("'", "’")


def _fold(text: str) -> str:
    return text.replace("İ", "i").replace("I", "i").replace("ı", "i").lower()


_ALLOWED = {
    _fold(word)
    for word in (
        "AI API SDK CLI UI LLM RC Radar JSON HTTP URL CPU GPU OS PR ML "
        "January February March April May June July August September October "
        "November December Jan Feb Mar Apr Jun Jul Aug Sep Oct Nov Dec "
        "Ocak Şubat Mart Nisan Mayıs Haziran Temmuz Ağustos Eylül Ekim Kasım Aralık"
    ).split()
}


def _text_fields(draft: Draft) -> list[tuple[str, str]]:
    out = []
    for lang in ("tr", "en"):
        story = getattr(draft, lang)
        for key in ("title", "summary", "dev_line"):
            out.append((f"{lang}.{key}", getattr(story, key)))
    return out


def _check_lengths(draft: Draft) -> list[str]:
    issues = []
    for where, text in _text_fields(draft):
        limit = LIMITS[where.split(".")[1]]
        if len(text) > limit:
            issues.append(f"{where}: too long ({len(text)} > {limit})")
    return issues


def _check_numbers(draft: Draft, source: str) -> list[str]:
    source_numbers = set(_NUMBER.findall(source.replace(",", ".")))
    fields = _text_fields(draft) + [("fact_card.what", draft.fact_card.what)]
    fields += [("fact_card.numbers", t) for t in draft.fact_card.numbers]
    fields += [("fact_card.versions", t) for t in draft.fact_card.versions]
    fields += [("fact_card.who", t) for t in draft.fact_card.who]
    issues: list[str] = []
    for where, text in fields:
        for raw in _NUMBER.findall(text):
            issue = f"{where}: number '{raw}' not in source"
            if raw.replace(",", ".") not in source_numbers and issue not in issues:
                issues.append(issue)
    return issues


def _strip(token: str) -> str:
    start, end = 0, len(token)
    while start < end and not token[start].isalnum():
        start += 1
    while end > start and not token[end - 1].isalnum():
        end -= 1
    return token[start:end]


def _names(text: str) -> list[str]:
    names = []
    sentence_start = True
    for raw in text.split():
        token = _strip(raw)
        for quote in _QUOTES:
            token = token.split(quote)[0]
        token = _strip(token)
        if any(c.isalpha() for c in token):
            mixed = any(c.isdigit() for c in token)
            inner_upper = any(c.isupper() for c in token[1:])
            if inner_upper or mixed or (token[0].isupper() and not sentence_start):
                names.append(token)
        sentence_start = raw.rstrip(_CLOSERS)[-1:] in (".", "!", "?", ":")
    return names


def _allowed(token: str) -> bool:
    if _fold(token) in _ALLOWED:
        return True
    # plural of an all-caps allowlisted acronym: APIs, LLMs, SDKs
    stem = token[:-1]
    return token.endswith("s") and len(stem) > 1 and stem.isupper() and _fold(stem) in _ALLOWED


def _in_source(name: str, folded_source: str) -> bool:
    """Whole-word match in the folded source. `'` is not a word character, so a source
    `Google's` or `Google'ın` still matches `Google`."""
    pattern = r"(?<!\w)" + re.escape(_fold(name)) + r"(?!\w)"
    return re.search(pattern, folded_source) is not None


def _allowlisted_compound(token: str) -> bool:
    """`AI-powered`, `API-first`: no digit, an allowlisted part, every other part a plain
    lowercase word. Any other hyphenated token is a name and must occur whole."""
    parts = token.split("-")
    if len(parts) < 2 or any(c.isdigit() for c in token):
        return False
    allowed = [p for p in parts if _allowed(p)]
    others = [p for p in parts if not _allowed(p)]
    return bool(allowed) and all(p.isalpha() and p.islower() for p in others)


def _name_ok(name: str, folded_source: str) -> bool:
    return _allowed(name) or _allowlisted_compound(name) or _in_source(name, folded_source)


def _check_names(draft: Draft, source: str) -> list[str]:
    folded_source = _fold(source)
    fields = _text_fields(draft) + [("fact_card.what", draft.fact_card.what)]
    found = [(where, name) for where, text in fields for name in _names(text)]
    found += [("fact_card.who", name) for name in draft.fact_card.who]
    issues: list[str] = []
    for where, name in found:
        if _name_ok(name, folded_source):
            continue
        issue = f"{where}: name '{name}' not in source"
        if issue not in issues:
            issues.append(issue)
    return issues


# Text a hijacked source could get the writer to repeat. Radar's own texts never need a
# link, a domain, an address, a handle or a command (the try link is a separate, checked
# field), so any of these sends the story to a human, even when the source says the same.
# This is a tripwire, not a guarantee: it catches the usual shapes and their common
# disguises, and a determined source can still word an instruction past it.
_URL = re.compile(r"\b(?:[a-z][a-z0-9+.-]*://|www\.)\S+", re.IGNORECASE)
# Labels may hold any letter (IDN names such as şifre-yenile.com); the last label is
# letters only, or an xn-- (punycode) label.
_DOMAIN = re.compile(
    r"(?<![\w.-])(?:[^\W_](?:[\w-]*[^\W_])?\.)+([^\W\d_]{2,63}|xn--[a-z0-9-]+)(?![\w-])(/\S*)?",
    re.IGNORECASE,
)
_IPV4 = re.compile(r"(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?![\w]|\.\d)(?::\d+)?(/\S*)?")
_IPV6 = re.compile(r"(?<![\w:])\[?((?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})\]?(?![\w:])(/\S*)?", re.I)
_HANDLE = re.compile(r"(?<![\w@.])@[^\W][\w.]*(?<!\.)")
# A last label that is a common file extension makes a file name (README.md, llama.cpp),
# not a domain, but only when the same token is in the source and no path follows: md,
# py and rs are also top-level domains. Popular top-level domains (.sh, .io, .ai, .dev,
# .app) are deliberately not here, and zip and mov never excuse a token.
_FILE_EXTENSIONS = frozenset(
    "md mdx txt rst json jsonl yaml yml toml ini cfg conf lock env xml csv tsv html htm css "
    "scss js mjs cjs jsx ts tsx py pyi ipynb rs go rb java kt kts swift c h cc cpp hpp cs php "
    "lua zig dart vue svelte wasm sql proto gguf safetensors onnx pt pth bin gz tgz tar "
    "pdf png jpg jpeg gif svg webp mp4 log".split()
)
_DOTTED_NAMES = frozenset({"asp.net", "socket.io"})
_COMMAND = re.compile(
    r"\$\(|\||&&"
    r"|\b(?:curl|wget)\s+(?:-|\S*[./:])"
    r"|\bsudo\s+\w"
    r"|\brm\s+-\w"
    r"|\bchmod\s+[+0-7]"
    r"|\b(?:bash|sh|zsh)\s+-c\b"
    r"|\b(?:powershell|pwsh)(?:\.exe)?\s+-\w"
    r"|\b(?:pip3?|pipx|uv|npm|pnpm|yarn|bun|brew|apt|apt-get|cargo|gem|go|conda|winget|choco)"
    r"\s+(?:install|add|i|get)\b"
    r"|\b(?:pipx|uv|npm|pnpm|yarn|bun)\s+(?:run|exec|dlx|create|x)\s+\S"
    r"|\b(?:npx|uvx|bunx)\s+\w"
    r"|\bdocker\s+(?:run|pull)\b"
    r"|\bpython3?\s+-m\s+\w"
    r"|\bgit\s+clone\b"
    r"|\b(?:iex|irm|iwr|invoke-expression|invoke-restmethod|invoke-webrequest)\b",
    re.IGNORECASE,
)
_SHOWN = 60  # characters of an offending token quoted in the reason

# Disguises a reader undoes: evil[.]com, evil(.)com, evil{.}com, evil[dot]com,
# evil (dot) com, evil dot com, and ideographic full stops.
_DISGUISED_DOT = re.compile(
    r"\s*(?:\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\})\s*"
    r"|(?<=[^\W_])\s+dot\s+(?=[^\W_])",
    re.IGNORECASE,
)
_FULL_STOPS = str.maketrans({"。": ".", "｡": ".", "．": "."})


def _normalise(text: str) -> str:
    """The text as a reader sees it: compatibility forms folded (full-width letters),
    invisible format characters (zero-width, bidi controls) removed, disguised dots undone."""
    text = unicodedata.normalize("NFKC", text).translate(_FULL_STOPS)
    text = "".join(c for c in text if unicodedata.category(c) != "Cf")
    return _DISGUISED_DOT.sub(".", text)


def _ip(candidate: str) -> bool:
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return False
    return True


def _named_in(token: str, source: str) -> bool:
    """`token` occurs in the (normalised, lowercased) source as a whole token, as the
    domain pattern would find it there."""
    pattern = r"(?<![\w.-])" + re.escape(token.lower()) + r"(?![\w-])"
    return re.search(pattern, source) is not None


def _domains(text: str, source: str) -> list[str]:
    found = [m.group(0) for m in _URL.finditer(text)]
    rest = _URL.sub(" ", text)
    for m in _IPV4.finditer(rest):
        if _ip(m.group(0).split("/", 1)[0].split(":", 1)[0]):
            found.append(m.group(0))
    for m in _IPV6.finditer(rest):
        if any(c.isdigit() for c in m.group(1)) and _ip(m.group(1)):
            found.append(m.group(0))
    for m in _DOMAIN.finditer(rest):
        token, tld, path = m.group(0), m.group(1).lower(), m.group(2)
        if token.lower() in _DOTTED_NAMES:
            continue
        if tld in _FILE_EXTENSIONS and not path and _named_in(token, source):
            continue
        found.append(token)
    return found


def _check_injection(draft: Draft, source: str) -> list[str]:
    fields = _text_fields(draft) + [("fact_card.what", draft.fact_card.what)]
    source = _normalise(source).lower()
    issues: list[str] = []
    for where, raw in fields:
        text = _normalise(raw)
        found = [f"link or domain '{t[:_SHOWN]}'" for t in _domains(text, source)]
        found += [f"handle '{m.group(0)[:_SHOWN]}'" for m in _HANDLE.finditer(_URL.sub(" ", text))]
        if "`" in text:
            found.append("backticks")
        found += [f"command-like text '{m.group(0)}'" for m in _COMMAND.finditer(text)]
        for what in found:
            issue = f"{where}: {what}"
            if issue not in issues:
                issues.append(issue)
    return issues


def _host(url: str) -> str:
    host = (urlsplit(url).hostname or "").rstrip(".")
    return host.removeprefix("www.")


def _same_site(a: str, b: str) -> bool:
    """Equal, or `a` is a subdomain of `b` (docs.example.com of example.com), or `a` is a
    parent of `b` with at least two labels (example.com of blog.example.com; never a bare
    `com`). With no list of public suffixes, a shared host such as github.io still counts."""
    if not (a and b):
        return False
    return a == b or a.endswith("." + b) or ("." in a and b.endswith("." + a))


def _check_try_url(url: str | None, doc: SourceDoc) -> list[str]:
    if url is None:
        return []
    if url not in doc.article_links:
        return ["fact_card.try_url: not a source link"]
    host = _host(url)
    if not any(_same_site(host, _host(s)) for s in [doc.url, *doc.source_urls]):
        return [f"fact_card.try_url: host '{host[:_SHOWN]}' is not a source host"]
    return []


def verify(draft: Draft, doc: SourceDoc) -> list[str]:
    issues = _check_lengths(draft) + _check_numbers(draft, doc.text)
    issues += _check_names(draft, doc.text)
    issues += _check_injection(draft, doc.text)
    issues += _check_try_url(draft.fact_card.try_url, doc)
    return issues


def route(candidate: Candidate, score: Score, issues: list[str]) -> tuple[Status, list[str]]:
    reasons = ["verify: " + i for i in issues]
    reasons += ["risk: " + f for f in score.risk_flags]
    if not candidate.has_primary:
        reasons.append("no primary source")
    return ("review" if reasons else "published"), reasons
