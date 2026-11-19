import json
import subprocess
import sys

import httpx
import pytest

from radar.models import Draft, FactCard, Score, Story, StoryText
from radar.paths import resolve
from radar.push import BATCH, PushError, allowed_url, build_payload, push_stories

URL = "https://admin.example.com"
TOKEN = "test-token"
UID = "0123456789abcdef0123456789abcdef"


def fixture_story(now) -> tuple[Story, list[dict]]:
    story = Story(
        id=1,
        uid=UID,
        cluster_id=1,
        run_id=1,
        category="protocol",
        status="review",
        reasons=["en.summary: number 40% not in source"],
        score=Score(
            cluster_id=1, relevance=5, novelty=4, usefulness=4, category="protocol", risk_flags=[]
        ),
        draft=Draft(
            fact_card=FactCard(
                what="A2UI 1.0 release candidate was announced.",
                who=["Google"],
                numbers=[],
                versions=["1.0"],
                try_url=None,
            ),
            tr=StoryText(
                title="A2UI 1.0 aday sürümü yayında",
                summary="Arayüz protokolü kararlı sürüme yaklaştı; aday sürüm denemeye açık.",
                dev_line="Örnek uygulamayı çalıştırıp aday sürümü deneyin.",
            ),
            en=StoryText(
                title="A2UI 1.0 release candidate is out",
                summary=(
                    "The UI protocol is close to a stable release; "
                    "the candidate is open for testing."
                ),
                dev_line="Run the sample app and try the release candidate.",
            ),
        ),
        source_url="https://a2ui.org/blog/1-0-rc",
        source_count=4,
        created_at=now,
        published_at=None,
    )
    sources = [{"name": "GitHub Blog", "url": "https://github.blog/a2ui-1-0", "tier": 1}]
    return story, sources


def test_payload_matches_the_shared_fixture(now):
    story, sources = fixture_story(now)
    expected = json.loads(resolve("admin/fixtures/ingest-sample.json").read_text(encoding="utf-8"))
    assert build_payload([story], {UID: sources}) == expected


def add_stories(store, now, count: int) -> list[str]:
    run = store.start_run("run", now)
    for n in range(count):
        cluster = store.create_cluster(f"cluster {n}", now)
        store.insert_story(
            cluster_id=cluster,
            run_id=run,
            status="review",
            reasons=[],
            score=Score(cluster_id=cluster, relevance=3, novelty=3, usefulness=3, category="model"),
            draft=Draft(
                fact_card=FactCard(what="x", who=[], numbers=[], versions=[]),
                tr=StoryText(title=f"t{n}", summary="s", dev_line="d"),
                en=StoryText(title=f"t{n}", summary="s", dev_line="d"),
            ),
            source_url="https://example.com/a",
            source_count=1,
            created_at=now,
        )
    return [s.uid for s in store.unpushed_stories()]


def mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def echo_accept(requests: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        uids = [s["uid"] for s in json.loads(request.content)["stories"]]
        return httpx.Response(200, json={"accepted": uids, "duplicates": []})

    return handler


def test_push_sends_bearer_token_and_marks_accepted_and_duplicates(store, now):
    a, b = add_stories(store, now, 2)
    requests: list[httpx.Request] = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"accepted": [a], "duplicates": [b]})

    stats = push_stories(store, mock_client(handler), URL, TOKEN, now)
    assert stats == {"pushed": 1, "duplicates": 1, "batches": 1}
    assert requests[0].headers["Authorization"] == "Bearer test-token"
    assert str(requests[0].url) == "https://admin.example.com/api/ingest"
    assert store.unpushed_stories() == []


def test_push_sends_batches_of_twenty(store, now):
    add_stories(store, now, 45)
    requests: list[httpx.Request] = []
    stats = push_stories(store, mock_client(echo_accept(requests)), URL, TOKEN, now)
    sizes = [len(json.loads(r.content)["stories"]) for r in requests]
    assert BATCH == 20 and sizes == [20, 20, 5]
    assert stats == {"pushed": 45, "duplicates": 0, "batches": 3}
    assert store.unpushed_stories() == []


def test_server_error_raises_and_marks_nothing(store, now):
    add_stories(store, now, 3)
    before = [s.uid for s in store.unpushed_stories()]
    client = mock_client(
        lambda r: httpx.Response(500, json={"error": "database unavailable", "path": "stories"})
    )
    with pytest.raises(PushError, match="500") as info:
        push_stories(store, client, URL, TOKEN, now)
    assert "database unavailable" in str(info.value)
    assert [s.uid for s in store.unpushed_stories()] == before


def test_earlier_batch_stays_marked_when_a_later_one_fails(store, now):
    add_stories(store, now, 25)
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return echo_accept([])(request)
        return httpx.Response(503, json={"error": "busy"})

    with pytest.raises(PushError):
        push_stories(store, mock_client(handler), URL, TOKEN, now)
    assert len(store.unpushed_stories()) == 5


def test_error_message_never_contains_the_token(store, now):
    add_stories(store, now, 1)
    client = mock_client(lambda r: httpx.Response(401, json={"error": f"bad {TOKEN}", "path": ""}))
    with pytest.raises(PushError) as info:
        push_stories(store, client, URL, TOKEN, now)
    assert TOKEN not in str(info.value)

    def boom(request):
        raise httpx.ConnectError(f"cannot reach with {TOKEN}")

    with pytest.raises(PushError) as info:
        push_stories(store, mock_client(boom), URL, TOKEN, now)
    assert TOKEN not in str(info.value)


def test_error_text_is_cut_to_200_characters(store, now):
    add_stories(store, now, 1)
    client = mock_client(
        lambda r: httpx.Response(400, json={"error": "e" * 500, "path": "p" * 500})
    )
    with pytest.raises(PushError) as info:
        push_stories(store, client, URL, TOKEN, now)
    assert "e" * 201 not in str(info.value) and "p" * 201 not in str(info.value)


def test_non_json_error_body_still_raises_push_error(store, now):
    add_stories(store, now, 1)
    client = mock_client(lambda r: httpx.Response(502, text="<html>bad gateway</html>"))
    with pytest.raises(PushError, match="502"):
        push_stories(store, client, URL, TOKEN, now)
    assert len(store.unpushed_stories()) == 1


def test_malformed_success_body_raises_and_marks_nothing(store, now):
    add_stories(store, now, 1)
    client = mock_client(lambda r: httpx.Response(200, json={"nope": 1}))
    with pytest.raises(PushError):
        push_stories(store, client, URL, TOKEN, now)
    assert len(store.unpushed_stories()) == 1


def test_redirect_is_not_followed(store, now):
    add_stories(store, now, 1)
    requests: list[httpx.Request] = []

    def handler(request):
        requests.append(request)
        return httpx.Response(302, headers={"location": "https://evil.example.com/steal"})

    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)
    with pytest.raises(PushError, match="302"):
        push_stories(store, client, URL, TOKEN, now)
    assert len(requests) == 1 and len(store.unpushed_stories()) == 1


@pytest.mark.parametrize(
    "url,ok",
    [
        ("https://admin.example.com", True),
        ("http://localhost:8787", True),
        ("http://127.0.0.1:8787", True),
        ("http://[::1]:8787", True),
        ("http://admin.example.com", False),
        ("http://localhost.evil.com", False),
        ("ftp://localhost", False),
        ("", False),
    ],
)
def test_allowed_url(url, ok):
    assert allowed_url(url) is ok


def test_push_does_not_import_anthropic():
    code = (
        "import sys, radar.push;"
        "bad=[m for m in sys.modules if m.startswith('anthropic')];"
        "sys.exit(1 if bad else 0)"
    )
    assert subprocess.run([sys.executable, "-c", code]).returncode == 0
