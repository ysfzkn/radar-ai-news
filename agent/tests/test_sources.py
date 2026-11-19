import pytest

from radar.models import Tier
from radar.sources import load_sources

GH = "https://github.blog/feed/"


def write(tmp_path, body: str) -> str:
    p = tmp_path / "sources.yaml"
    p.write_text(body, encoding="utf-8")
    return str(p)


ENTRY = """  - id: {id}
    name: {id} name
    tier: {tier}
    kind: feed
    url: {url}
{extra}"""


def doc(*entries: str) -> str:
    return "sources:\n" + "".join(entries)


def test_loads_enabled_sources_only(tmp_path):
    path = write(
        tmp_path,
        doc(
            ENTRY.format(id="github-blog", tier="primary", url=GH, extra=""),
            ENTRY.format(
                id="anthropic-news",
                tier="primary",
                url="https://www.anthropic.com/news",
                extra="    enabled: false\n",
            ),
        ),
    )
    sources = load_sources(path)
    assert [s.id for s in sources] == ["github-blog"]
    assert sources[0].tier == Tier.PRIMARY


def test_duplicate_id_raises(tmp_path):
    entry = ENTRY.format(id="github-blog", tier="primary", url=GH, extra="")
    path = write(tmp_path, doc(entry, entry))
    with pytest.raises(ValueError, match="github-blog"):
        load_sources(path)


def test_unknown_tier_raises(tmp_path):
    path = write(
        tmp_path,
        doc(ENTRY.format(id="x", tier="gossip", url="https://x.example/feed", extra="")),
    )
    with pytest.raises(ValueError, match="gossip"):
        load_sources(path)


def test_non_http_url_raises(tmp_path):
    path = write(
        tmp_path,
        doc(ENTRY.format(id="x", tier="primary", url="ftp://x", extra="")),
    )
    with pytest.raises(ValueError, match="ftp://x"):
        load_sources(path)


def test_repo_sources_file_is_valid():
    assert len(load_sources("../sources.yaml")) >= 15
