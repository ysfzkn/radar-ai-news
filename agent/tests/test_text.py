import random
import re
import time

from radar.text import clean_summary, element_inner, strip_blocks, title_tokens


def test_clean_summary():
    html = "<p>Hello <b>world</b> &amp; all</p><script>x()</script>"
    assert clean_summary(html) == "Hello world & all"
    assert len(clean_summary("x" * 900)) == 500


def test_clean_summary_style_and_whitespace():
    assert clean_summary("<style>p{color:red}</style><p>a \n\t b</p>") == "a b"


def test_title_tokens():
    tokens = title_tokens("A2UI 1.0 is now a release candidate!")
    assert tokens == {"a2ui", "1.0", "now", "release", "candidate"}
    assert title_tokens("İstanbul için yeni model") == {"istanbul", "yeni", "model"}


def test_title_tokens_turkish_letters_and_versions():
    assert title_tokens("Değişiklik şimdi v2.0.1") == {"değişiklik", "şimdi", "v2.0.1"}


def test_clean_summary_is_quick_on_unclosed_tags():
    for html in ("<" * 60_000, "<script>" * 8_000, "<style a" * 8_000):
        start = time.perf_counter()
        clean_summary(html)
        assert time.perf_counter() - start < 0.5


def test_clean_summary_still_drops_whole_blocks_and_tags():
    html = "<SCRIPT type=x>bad()</script ><p a='1'>keep</p><style>s</STYLE>"
    assert clean_summary(html) == "keep"


def test_strip_blocks_matches_the_lazy_regex_it_replaced():
    old = re.compile(r"<(script|style|form)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
    parts = ["<script>", "<SCRIPT a=1>", "</script>", "</script >", "<style>", "</style>"]
    parts += ["<form>", "</FORM>", "<scripts>", "x", " ", "<p>", "</p>"]
    rng = random.Random(7)
    for _ in range(3000):
        html = "".join(rng.choice(parts) for _ in range(rng.randint(0, 12)))
        assert strip_blocks(html, ("script", "style", "form")) == old.sub(" ", html), html


def test_element_inner_is_the_first_closed_region():
    assert element_inner("<main>a</main><main>b</main>", "main") == "a"
    assert element_inner("<main x=1>a<main>b</MAIN >", "main") == "a<main>b"
    assert element_inner("<main>never closed", "main") is None
    assert element_inner("<mainx>a</mainx>", "main") is None
