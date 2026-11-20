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


def body_with(now, reasons=None, sources=None, **card) -> dict:
    """The payload entry for the fixture story with some fields replaced."""
    story, fixture_sources = fixture_story(now)
    fact_card = story.draft.fact_card.model_copy(update=card)
    story = story.model_copy(
        update={
            "reasons": story.reasons if reasons is None else reasons,
            "draft": story.draft.model_copy(update={"fact_card": fact_card}),
        }
    )
    used = fixture_sources if sources is None else sources
    return build_payload([story], {UID: used})["stories"][0]


def test_reasons_are_clamped_to_twenty_of_300_characters(now):
    reasons = [f"r{n}: " + "x" * 400 for n in range(25)]
    sent = body_with(now, reasons=reasons)["reasons"]
    assert len(sent) == 20
    assert sent == [r[:300] for r in reasons[:20]]


@pytest.mark.parametrize("field", ["who", "numbers", "versions"])
def test_fact_card_lists_are_clamped_to_thirty_of_200_characters(now, field):
    entries = [f"{n}-" + "y" * 250 for n in range(35)]
    sent = body_with(now, **{field: entries})["fact_card"][field]
    assert sent == [e[:200] for e in entries[:30]]


def test_fact_card_what_is_cut_to_1000_characters(now):
    assert body_with(now, what="w" * 1500)["fact_card"]["what"] == "w" * 1000


def test_sources_are_clamped_to_thirty(now):
    sources = [{"name": f"s{n}", "url": f"https://s{n}.example/a", "tier": 2} for n in range(35)]
    sent = body_with(now, sources=sources)["sources"]
    assert sent == sources[:30]


@pytest.mark.parametrize(
    "try_url",
    ["", "none", "example.com/x", "ftp://example.com/x", "https://e.example/" + "a" * 1983],
)
def test_try_url_that_the_worker_rejects_is_dropped(now, try_url):
    assert body_with(now, try_url=try_url)["fact_card"]["try_url"] is None


@pytest.mark.parametrize(
    "try_url",
    ["https://a2ui.org/try", "HTTP://localhost:3000/demo", "https://e.example/" + "a" * 1982],
)
def test_valid_try_url_is_kept(now, try_url):
    assert body_with(now, try_url=try_url)["fact_card"]["try_url"] == try_url


def test_text_fields_and_urls_are_sent_as_stored(now):
    story, sources = fixture_story(now)
    long = StoryText(title="T" * 400, summary="", dev_line="d" * 700)
    story = story.model_copy(
        update={
            "source_url": "not a url",
            "draft": story.draft.model_copy(update={"tr": long}),
        }
    )
    sources = [{"name": "n", "url": "nope", "tier": 1}]
    sent = build_payload([story], {UID: sources})["stories"][0]
    assert sent["texts"]["tr"] == long.model_dump()
    assert sent["source_url"] == "not a url"
    assert sent["sources"] == sources


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
    assert stats == {"pushed": 1, "duplicates": 1, "batches": 1, "rejected": [], "parked": 0}
    assert requests[0].headers["Authorization"] == "Bearer test-token"
    assert str(requests[0].url) == "https://admin.example.com/api/ingest"
    assert store.unpushed_stories() == []


def test_push_sends_batches_of_twenty(store, now):
    add_stories(store, now, 45)
    requests: list[httpx.Request] = []
    stats = push_stories(store, mock_client(echo_accept(requests)), URL, TOKEN, now)
    sizes = [len(json.loads(r.content)["stories"]) for r in requests]
    assert BATCH == 20 and sizes == [20, 20, 5]
    assert stats == {"pushed": 45, "duplicates": 0, "batches": 3, "rejected": [], "parked": 0}
    assert store.unpushed_stories() == []


def reject_uids(bad: set[str], requests: list[httpx.Request]):
    """Answer like the Worker: 400 naming the first bad story's index, else accept all."""

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        uids = [s["uid"] for s in json.loads(request.content)["stories"]]
        for index, uid in enumerate(uids):
            if uid in bad:
                path = f"stories.{index}.texts.tr.title"
                return httpx.Response(400, json={"error": "invalid", "path": path})
        return httpx.Response(200, json={"accepted": uids, "duplicates": []})

    return handler


def test_rejected_story_is_skipped_and_the_rest_are_pushed(store, now):
    uids = add_stories(store, now, 3)
    requests: list[httpx.Request] = []
    reported: list[tuple[str, str]] = []
    stats = push_stories(
        store,
        mock_client(reject_uids({uids[1]}, requests)),
        URL,
        TOKEN,
        now,
        on_reject=lambda uid, path: reported.append((uid, path)),
    )
    assert len(requests) == 2
    assert [s["uid"] for s in json.loads(requests[1].content)["stories"]] == [uids[0], uids[2]]
    assert stats == {
        "pushed": 2,
        "duplicates": 0,
        "batches": 1,
        "rejected": [uids[1]],
        "parked": 1,
    }
    assert [s.uid for s in store.unpushed_stories()] == []
    assert [s.uid for s in store.unpushed_stories(include_refused=True)] == [uids[1]]
    assert reported == [(uids[1], "stories.1.texts.tr.title")]


def test_every_story_rejected_marks_nothing_and_stops(store, now):
    uids = add_stories(store, now, 3)
    requests: list[httpx.Request] = []
    stats = push_stories(store, mock_client(reject_uids(set(uids), requests)), URL, TOKEN, now)
    assert len(requests) == 3
    assert stats["rejected"] == uids and stats["pushed"] == 0
    assert [s.uid for s in store.unpushed_stories(include_refused=True)] == uids


def test_nothing_rejected_reports_an_empty_list(store, now):
    add_stories(store, now, 1)
    stats = push_stories(store, mock_client(echo_accept([])), URL, TOKEN, now)
    assert stats["rejected"] == []


@pytest.mark.parametrize("path", ["stories", "version", "", "stories.7.uid", "stories.x.uid"])
def test_400_without_a_story_index_in_the_batch_still_raises(store, now, path):
    add_stories(store, now, 2)
    client = mock_client(lambda r: httpx.Response(400, json={"error": "invalid", "path": path}))
    with pytest.raises(PushError, match="400"):
        push_stories(store, client, URL, TOKEN, now)
    assert len(store.unpushed_stories()) == 2


@pytest.mark.parametrize("error", [httpx.UnsupportedProtocol("no"), ValueError("bad url")])
def test_unsupported_protocol_is_a_push_error(store, now, error):
    add_stories(store, now, 1)

    def handler(request):
        raise error

    with pytest.raises(PushError, match=type(error).__name__) as info:
        push_stories(store, mock_client(handler), "ftp://admin.example.com", TOKEN, now)
    assert "admin.example.com" not in str(info.value)
    assert len(store.unpushed_stories()) == 1


def test_invalid_url_becomes_push_error(store, now):
    add_stories(store, now, 1)
    with pytest.raises(PushError, match="InvalidURL"):
        push_stories(store, mock_client(echo_accept([])), "https://a\x00b.example", TOKEN, now)
    assert len(store.unpushed_stories()) == 1


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


def refusal(path: str = "texts.tr.title"):
    return {"error": "invalid", "path": f"stories.0.{path}"}


def test_a_refused_story_is_parked_with_the_field_and_not_sent_next_time(store, now):
    (uid,) = add_stories(store, now, 1)
    first: list[httpx.Request] = []
    stats = push_stories(store, mock_client(reject_uids({uid}, first)), URL, TOKEN, now)
    assert stats["rejected"] == [uid]
    (parked,) = store.refused_stories()
    assert parked.uid == uid and parked.refused_at == now
    assert parked.refused_path == "texts.tr.title" and parked.pushed_at is None
    second: list[httpx.Request] = []
    again = push_stories(store, mock_client(echo_accept(second)), URL, TOKEN, now)
    assert second == []
    assert again == {"pushed": 0, "duplicates": 0, "batches": 0, "rejected": [], "parked": 1}


def test_the_stored_path_is_cleaned_and_cut_to_200_characters(store, now):
    add_stories(store, now, 1)
    path = "texts.tr." + TOKEN + "x" * 300
    client = mock_client(
        lambda r: httpx.Response(400, json={"error": "invalid", "path": f"stories.0.{path}"})
    )
    push_stories(store, client, URL, TOKEN, now)
    stored = store.refused_stories()[0].refused_path
    assert TOKEN not in stored and len(stored) == 200 and stored.startswith("texts.tr.[redacted]")


def test_parked_count_is_reported(store, now):
    uids = add_stories(store, now, 4)
    requests: list[httpx.Request] = []
    stats = push_stories(
        store, mock_client(reject_uids({uids[0], uids[2]}, requests)), URL, TOKEN, now
    )
    assert stats["pushed"] == 2 and stats["parked"] == 2
    assert push_stories(store, mock_client(echo_accept([])), URL, TOKEN, now)["parked"] == 2


def test_retry_refused_sends_parked_stories_and_clears_the_mark_when_accepted(store, now):
    uids = add_stories(store, now, 2)
    push_stories(store, mock_client(reject_uids({uids[0]}, [])), URL, TOKEN, now)
    requests: list[httpx.Request] = []
    stats = push_stories(
        store, mock_client(echo_accept(requests)), URL, TOKEN, now, retry_refused=True
    )
    assert [s["uid"] for s in json.loads(requests[0].content)["stories"]] == [uids[0]]
    assert stats == {"pushed": 1, "duplicates": 0, "batches": 1, "rejected": [], "parked": 0}
    assert store.refused_stories() == []
    row = store._conn.execute(
        "SELECT pushed_at, refused_at, refused_path FROM stories WHERE uid = ?", (uids[0],)
    ).fetchone()
    assert row["pushed_at"] is not None and row["refused_at"] is None
    assert row["refused_path"] is None


def test_retry_refused_clears_the_mark_when_the_story_is_a_duplicate(store, now):
    (uid,) = add_stories(store, now, 1)
    push_stories(store, mock_client(reject_uids({uid}, [])), URL, TOKEN, now)
    client = mock_client(lambda r: httpx.Response(200, json={"accepted": [], "duplicates": [uid]}))
    stats = push_stories(store, client, URL, TOKEN, now, retry_refused=True)
    assert stats["duplicates"] == 1 and stats["parked"] == 0 and store.refused_stories() == []


def test_retry_refused_keeps_the_mark_with_the_new_path_when_refused_again(store, now):
    from datetime import timedelta

    (uid,) = add_stories(store, now, 1)
    push_stories(store, mock_client(reject_uids({uid}, [])), URL, TOKEN, now)
    later = now + timedelta(days=1)

    def handler(request):
        return httpx.Response(400, json=refusal("texts.en.summary"))

    stats = push_stories(store, mock_client(handler), URL, TOKEN, later, retry_refused=True)
    assert stats["rejected"] == [uid] and stats["parked"] == 1
    (parked,) = store.refused_stories()
    assert parked.refused_path == "texts.en.summary" and parked.refused_at == later
