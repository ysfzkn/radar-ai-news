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
    source = source.replace(",", ".")
    fields = _text_fields(draft)
    fields += [("fact_card.numbers", t) for t in draft.fact_card.numbers]
    fields += [("fact_card.versions", t) for t in draft.fact_card.versions]
    issues: list[str] = []
    for where, text in fields:
        for raw in _NUMBER.findall(text):
            pattern = r"(?<![\d.])" + re.escape(raw.replace(",", ".")) + r"(?!\d)"
            issue = f"{where}: number '{raw}' not in source"
            if not re.search(pattern, source) and issue not in issues:
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


def _check_names(draft: Draft, source: str) -> list[str]:
    folded_source = _fold(source)
    found = [(where, name) for where, text in _text_fields(draft) for name in _names(text)]
    found += [("fact_card.who", name) for name in draft.fact_card.who]
    issues: list[str] = []
    for where, name in found:
        folded = _fold(name)
        if folded in _ALLOWED or folded in folded_source:
            continue
        issue = f"{where}: name '{name}' not in source"
        if issue not in issues:
            issues.append(issue)
    return issues


def verify(draft: Draft, doc: SourceDoc) -> list[str]:
    issues = _check_lengths(draft) + _check_numbers(draft, doc.text)
    issues += _check_names(draft, doc.text)
    url = draft.fact_card.try_url
    if url is not None and url not in doc.links:
        issues.append("fact_card.try_url: not a source link")
    return issues


def route(candidate: Candidate, score: Score, issues: list[str]) -> tuple[Status, list[str]]:
    reasons = ["verify: " + i for i in issues]
    reasons += ["risk: " + f for f in score.risk_flags]
    if not candidate.has_primary:
        reasons.append("no primary source")
    return ("review" if reasons else "published"), reasons
