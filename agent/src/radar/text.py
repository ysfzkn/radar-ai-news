"""Text helpers: summary cleaning and title tokenization."""

import html as html_lib
import re

# `[^<>]*`, not `[^>]*`: a run of `<` with no `>` must not be rescanned from every `<`
# (quadratic on a hostile page).
_TAGS = re.compile(r"<[^<>]*>")
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


def _opener(tags: tuple[str, ...]) -> re.Pattern[str]:
    return re.compile(rf"<({'|'.join(tags)})\b[^<>]*>", re.IGNORECASE)


def _closer(tag: str) -> re.Pattern[str]:
    return re.compile(rf"</{tag}\s*>", re.IGNORECASE)


def element_inner(html: str, tag: str) -> str | None:
    """The text between the first `<tag ...>` and the next `</tag>`, or None.

    Two linear searches. A lazy `<tag>(.*?)</tag>` regex instead rescans to the end of the
    page from every unclosed `<tag>`, which is quadratic on a hostile page.
    """
    start = _opener((tag,)).search(html)
    if start is None:
        return None
    end = _closer(tag).search(html, start.end())
    return None if end is None else html[start.end() : end.start()]


def strip_blocks(html: str, tags: tuple[str, ...]) -> str:
    """Replace every `<tag ...>...</tag>` block (for the given tags) with a space.

    The result a lazy `<tag ...>.*?</tag>` regex substitution gives, in linear time: for
    each tag the next closing tag is remembered, so a missing one is searched for once,
    not once per opening tag.
    """
    opener = _opener(tags)
    closers = {tag: _closer(tag) for tag in tags}
    known: dict[str, re.Match[str] | None] = {}
    out: list[str] = []
    pos = search = 0
    while (m := opener.search(html, search)) is not None:
        tag = m.group(1).lower()
        close = known.get(tag)
        if tag not in known or (close is not None and close.start() < m.end()):
            close = known[tag] = closers[tag].search(html, m.end())
        if close is None:
            search = m.end()
            continue
        out.append(html[pos : m.start()])
        out.append(" ")
        pos = search = close.end()
    out.append(html[pos:])
    return "".join(out)


def clean_summary(html: str, limit: int = 500) -> str:
    text = strip_blocks(html, ("script", "style"))
    text = _TAGS.sub(" ", text)
    text = html_lib.unescape(text)
    return _SPACE.sub(" ", text).strip()[:limit]


def title_tokens(title: str) -> frozenset[str]:
    lowered = title.replace("İ", "i").lower()
    return frozenset(t for t in _TOKEN.findall(lowered) if t not in _STOPWORDS)
