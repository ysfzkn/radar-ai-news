import re

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


def verify(draft: Draft, doc: SourceDoc) -> list[str]:
    issues = _check_lengths(draft) + _check_numbers(draft, doc.text)
    issues += _check_names(draft, doc.text)
    url = draft.fact_card.try_url
    if url is not None and url not in doc.article_links:
        issues.append("fact_card.try_url: not a source link")
    return issues


def route(candidate: Candidate, score: Score, issues: list[str]) -> tuple[Status, list[str]]:
    reasons = ["verify: " + i for i in issues]
    reasons += ["risk: " + f for f in score.risk_flags]
    if not candidate.has_primary:
        reasons.append("no primary source")
    return ("review" if reasons else "published"), reasons
