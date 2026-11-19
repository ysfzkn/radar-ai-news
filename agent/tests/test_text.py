from radar.text import clean_summary, title_tokens


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
