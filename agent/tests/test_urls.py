from radar.urls import canonicalize


def test_canonicalize():
    raw = "HTTP://www.Example.com/post/?utm_source=x&id=7#top"
    assert canonicalize(raw) == "https://example.com/post?id=7"
    assert canonicalize("https://example.com/") == "https://example.com/"
    assert canonicalize("https://example.com/a?b=2&ref=hn&a=1") == "https://example.com/a?b=2&a=1"


def test_canonicalize_drops_tracking_params():
    url = "https://example.com/a?fbclid=1&gclid=2&source=rss&keep=1&utm_medium=m"
    assert canonicalize(url) == "https://example.com/a?keep=1"
    assert canonicalize("https://example.com/a?ref=x") == "https://example.com/a"
