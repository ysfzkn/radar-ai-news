"""Text helpers: summary cleaning and title tokenization."""

import html as html_lib
import re

_BLOCKS = re.compile(r"<(script|style)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_TAGS = re.compile(r"<[^>]*>")
_SPACE = re.compile(r"\s+")
_TOKEN = re.compile(r"[a-z0-9çğıöşü]+(?:\.[0-9]+)*")
_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "is",
        "are",
        "of",
        "for",
        "to",
        "in",
        "on",
        "and",
        "with",
        "ve",
        "ile",
        "bir",
        "için",
        "de",
        "da",
    }
)


def clean_summary(html: str, limit: int = 500) -> str:
    text = _BLOCKS.sub(" ", html)
    text = _TAGS.sub(" ", text)
    text = html_lib.unescape(text)
    return _SPACE.sub(" ", text).strip()[:limit]


def title_tokens(title: str) -> frozenset[str]:
    lowered = title.replace("İ", "i").lower()
    return frozenset(t for t in _TOKEN.findall(lowered) if t not in _STOPWORDS)
