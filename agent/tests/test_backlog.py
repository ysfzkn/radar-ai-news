"""The edition floor: fresh stories first, then the 14-day backlog up to MIN_EDITION."""

from datetime import timedelta

import httpx
import pytest

from fakes import FakeLLM
from radar.agent import run_agent
from radar.models import Candidate, Draft, FactCard, RawItem, Score, StoryText
from radar.score import BACKLOG_SYSTEM, MIN_EDITION, SYSTEM, ScoreBatch

ARTICLE = (
    "<html><body><article><p>"
    + "Alpha engine 2.0 adds streaming support for agents and ships a new quickstart. " * 4
    + "</p></article></body></html>"
)

pytestmark = pytest.mark.usefixtures("no_source_limit")


def http() -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host.startswith("thin"):
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": "text/html"}, text=ARTICLE)

    return httpx.Client(transport=httpx.MockTransport(handler))


TOPICS = (
    "quantum robots",
    "garden compilers",
    "volcano databases",
    "violin kernels",
    "paper satellites",
    "glass routers",
    "copper gardens",
    "silent tensors",
    "amber queues",
    "lunar caches",
    "velvet linkers",
    "frozen shaders",
)


def make(
    store, now, *, age, lane, n, host="s", url=None, title=None, source="github-blog"
) -> Candidate:
    """One item in its own cluster, published `age` before `now`."""
    title = title or f"{TOPICS[n]} launch"
    url = url or f"https://{host}{n}.test/{lane}"
    published = now - age
    store.insert_items(
        [
            RawItem(
                source_id=source,
                url=url,
                title=title,
                summary="d",
                published_at=published,
            )
        ]
    )
    cid = store.create_cluster(title, published)
    stored = [
        i
        for i in store.items_since(published - timedelta(minutes=1))
        if i.url == url and i.source_id == source
    ][0]
    store.set_cluster(stored.id, cid)
    return Candidate(
        cluster_id=cid,
        title=title,
        url=url,
        summary="d",
        source_count=1,
        has_primary=True,
        is_turkey=False,
        score=5.0 - n / 10,
        first_reported=published,
        lane=lane,
    )


def fresh(store, now, count, start=0, **kw):
    return [
        make(store, now, age=timedelta(hours=2), lane="fresh", n=start + i, **kw)
        for i in range(count)
    ]


def backlog(store, now, count, start=6, days=9, **kw):
    return [
        make(store, now, age=timedelta(days=days), lane="backlog", n=start + i, **kw)
        for i in range(count)
    ]


def good(c: Candidate, **kw) -> Score:
    values = {"relevance": 5, "novelty": 4, "usefulness": 4, "category": "tooling"} | kw
    return Score(cluster_id=c.cluster_id, **values)


def draft(en_summary="The alpha engine adds streaming support for agents.", tr_summary=None):
    def text(summary):
        return StoryText(
            title="Alpha engine 2.0 adds streaming",
            summary=summary,
            dev_line="Try the new quickstart.",
        )

    return Draft(
        fact_card=FactCard(what="Alpha engine 2.0 ships.", who=[], numbers=[], versions=["2.0"]),
        tr=text(tr_summary or en_summary),
        en=text(en_summary),
    )


def steps(llm) -> list[str]:
    return [c["step"] for c in llm.calls]


def test_the_floor_is_five_and_the_maximum_stays_eight():
    assert MIN_EDITION == 5


def test_too_few_fresh_stories_are_topped_up_from_the_backlog(store, now, run_id):
    new = fresh(store, now, 2)
    old = backlog(store, now, 4)
    llm = FakeLLM(
        {
            "score": [
                ScoreBatch(scores=[good(c) for c in new]),
                ScoreBatch(scores=[good(c) for c in old]),
            ],
            "write": [draft() for _ in range(5)],
        }
    )
    stats = run_agent(store, new + old, llm, http(), now, run_id)
    assert steps(llm) == ["score", "write", "write", "score", "write", "write", "write"]
    assert llm.calls[0]["system"] == SYSTEM and llm.calls[3]["system"] == BACKLOG_SYSTEM
    assert stats["selected_fresh"] == 2 and stats["written_fresh"] == 2
    assert stats["selected_backlog"] == 3 and stats["written_backlog"] == 3
    assert stats["selected"] == 5 and stats["written"] == 5
    assert stats["scored"] == 6 and stats["scored_backlog"] == 4
    stories = store.stories_since(now - timedelta(days=1))
    assert sorted(s.lane for s in stories) == ["backlog"] * 3 + ["fresh"] * 2
    by_cluster = {s.cluster_id: s for s in stories}
    assert by_cluster[old[0].cluster_id].reported_at == now - timedelta(days=9)


def test_enough_fresh_stories_never_score_the_backlog(store, now, run_id):
    new = fresh(store, now, 5)
    old = backlog(store, now, 2)
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(c) for c in new])], "write": [draft()] * 5})
    stats = run_agent(store, new + old, llm, http(), now, run_id)
    assert steps(llm) == ["score"] + ["write"] * 5
    assert stats["selected_backlog"] == 0 and stats["scored_backlog"] == 0
    assert all(c["system"] == SYSTEM for c in llm.calls if c["step"] == "score")


def test_fresh_stories_beyond_the_floor_are_still_written_up_to_eight(store, now, run_id):
    new = fresh(store, now, 9, start=0)
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(c) for c in new])], "write": [draft()] * 8})
    stats = run_agent(store, new, llm, http(), now, run_id)
    assert stats["written_fresh"] == 8 and stats["written"] == 8


def test_backlog_bar_is_stricter_than_the_fresh_one(store, now, run_id):
    old = backlog(store, now, 4)
    scores = [
        good(old[0]),  # passes
        good(old[1], relevance=3, novelty=5, usefulness=5),  # total 4.2 but relevance 3
        good(old[2], novelty=2),  # no longer matters this week
        good(old[3], relevance=4, novelty=3, usefulness=3),  # total 3.4 < 3.5
    ]
    llm = FakeLLM({"score": [ScoreBatch(scores=scores)], "write": [draft()]})
    stats = run_agent(store, old, llm, http(), now, run_id)
    assert stats["written_backlog"] == 1 and stats["written"] == 1
    assert [s.cluster_id for s in store.stories_since(now - timedelta(days=1))] == [
        old[0].cluster_id
    ]


def test_nothing_good_enough_means_fewer_than_five(store, now, run_id):
    new = fresh(store, now, 1)
    old = backlog(store, now, 2)
    llm = FakeLLM(
        {
            "score": [
                ScoreBatch(scores=[good(new[0])]),
                ScoreBatch(scores=[good(c, relevance=2) for c in old]),
            ],
            "write": [draft()],
        }
    )
    stats = run_agent(store, new + old, llm, http(), now, run_id)
    assert stats["written"] == 1 and stats["written_backlog"] == 0


def test_max_stories_below_the_floor_caps_the_backlog_too(store, now, run_id):
    new = fresh(store, now, 1)
    old = backlog(store, now, 4)
    llm = FakeLLM(
        {
            "score": [
                ScoreBatch(scores=[good(new[0])]),
                ScoreBatch(scores=[good(c) for c in old]),
            ],
            "write": [draft()] * 5,
        }
    )
    stats = run_agent(store, new + old, llm, http(), now, run_id, max_stories=3)
    assert stats["written"] == 3 and stats["written_backlog"] == 2


def test_a_fresh_story_that_fails_is_replaced_from_the_backlog(store, now, run_id):
    new = fresh(store, now, 2) + fresh(store, now, 1, start=2, host="thin")
    old = backlog(store, now, 4)
    llm = FakeLLM(
        {
            "score": [
                ScoreBatch(scores=[good(c) for c in new]),
                ScoreBatch(scores=[good(c) for c in old]),
            ],
            "write": [draft()] * 5,
        }
    )
    stats = run_agent(store, new + old, llm, http(), now, run_id)
    assert stats["skipped_thin"] == 1 and stats["written_fresh"] == 2
    assert stats["written_backlog"] == 3 and stats["written"] == 5


def test_stories_already_written_today_count_toward_the_floor(store, now, run_id):
    first = fresh(store, now, 4)
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(c) for c in first])], "write": [draft()] * 4})
    run_agent(store, first, llm, http(), now, run_id)
    old = backlog(store, now, 3)
    later = now + timedelta(hours=1)
    llm2 = FakeLLM({"score": [ScoreBatch(scores=[good(c) for c in old])], "write": [draft()] * 3})
    stats = run_agent(store, old, llm2, http(), later, store.start_run("run", later))
    assert stats["written_backlog"] == 1 and stats["written"] == 1


def test_a_backlog_item_matching_a_written_story_is_never_scored(store, now, run_id):
    new = fresh(store, now, 1)
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(new[0])])], "write": [draft()]})
    run_agent(store, new, llm, http(), now, run_id)
    # The same link, re-reported by another feed a day later and clustered apart.
    again = make(
        store, now, age=timedelta(days=3), lane="backlog", n=9, url=new[0].url, source="hn"
    )
    other = backlog(store, now, 1, start=10)
    later = now + timedelta(days=1)
    llm2 = FakeLLM({"score": [ScoreBatch(scores=[good(other[0])])], "write": [draft()]})
    stats = run_agent(store, [again, *other], llm2, http(), later, store.start_run("run", later))
    scored_ids = [s for s in llm2.calls[0]["user"].splitlines() if s.startswith("[")]
    assert len(scored_ids) == 1 and scored_ids[0].startswith(f"[{other[0].cluster_id}]")
    assert stats["skipped_duplicate"] == 1 and stats["written_backlog"] == 1


def test_a_backlog_item_with_the_title_of_a_written_story_is_skipped(store, now, run_id):
    new = fresh(store, now, 1, title="Acme ships Widget SDK 3.1 for agents")
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(new[0])])], "write": [draft()]})
    run_agent(store, new, llm, http(), now, run_id)
    later = now + timedelta(days=2)
    same = make(
        store,
        later,
        age=timedelta(days=2),
        lane="backlog",
        n=9,
        title="Widget SDK 3.1 ships for agents, Acme says",
    )
    llm2 = FakeLLM({})
    stats = run_agent(store, [same], llm2, http(), later, store.start_run("run", later))
    assert llm2.calls == [] and stats["skipped_duplicate"] == 1


def test_the_scorer_sees_what_radar_already_wrote_and_a_repeat_is_never_chosen(store, now, run_id):
    new = fresh(store, now, 1)
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(new[0])])], "write": [draft()]})
    run_agent(store, new, llm, http(), now, run_id)
    old = backlog(store, now, 2)
    later = now + timedelta(days=1)
    llm2 = FakeLLM(
        {
            "score": [ScoreBatch(scores=[good(old[0], repeat=True), good(old[1])])],
            "write": [draft()],
        }
    )
    stats = run_agent(store, old, llm2, http(), later, store.start_run("run", later))
    user = llm2.calls[0]["user"]
    assert "Alpha engine 2.0 adds streaming" in user  # the written story's title
    assert stats["skipped_repeat"] == 1 and stats["written_backlog"] == 1
    written = {s.cluster_id for s in store.stories_since(later - timedelta(hours=1))}
    assert old[0].cluster_id not in written and old[1].cluster_id in written


def test_a_fresh_score_is_not_reused_for_the_backlog_question(store, now, run_id):
    old = backlog(store, now, 1)
    store.save_scores([good(old[0])], now - timedelta(hours=1), lens="fresh")
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(old[0])])], "write": [draft()]})
    stats = run_agent(store, old, llm, http(), now, run_id)
    assert steps(llm) == ["score", "write"] and llm.calls[0]["system"] == BACKLOG_SYSTEM
    assert stats["scored_backlog"] == 1


def test_a_recent_backlog_score_is_reused(store, now, run_id):
    old = backlog(store, now, 1)
    store.save_scores([good(old[0])], now - timedelta(hours=1), lens="backlog")
    llm = FakeLLM({"write": [draft()]})
    stats = run_agent(store, old, llm, http(), now, run_id)
    assert steps(llm) == ["write"] and stats["written_backlog"] == 1


def test_an_old_backlog_score_is_asked_again(store, now, run_id):
    old = backlog(store, now, 1)
    store.save_scores([good(old[0])], now - timedelta(days=3), lens="backlog")
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(old[0])])], "write": [draft()]})
    run_agent(store, old, llm, http(), now, run_id)
    assert steps(llm) == ["score", "write"]


def test_a_leftover_is_scored_again_once_a_story_was_written_after_it(store, now, run_id):
    new = fresh(store, now, 2)
    llm = FakeLLM(
        {
            "score": [ScoreBatch(scores=[good(new[0]), good(new[1], relevance=1)])],
            "write": [draft()],
        }
    )
    run_agent(store, new, llm, http(), now, run_id)
    later = now + timedelta(hours=3)
    llm2 = FakeLLM({"score": [ScoreBatch(scores=[good(new[1], relevance=1)])]})
    stats = run_agent(store, new, llm2, http(), later, store.start_run("run", later))
    assert steps(llm2) == ["score"] and stats["scored"] == 1
    assert f"[{new[1].cluster_id}]" in llm2.calls[0]["user"]


def test_the_backlog_scored_per_run_is_capped(store, now, run_id):
    from radar.prefilter import BACKLOG_LIMIT

    old = [
        make(
            store,
            now,
            age=timedelta(days=5),
            lane="backlog",
            n=0,
            url=f"https://b{i}.test/x",
            title=f"backlog topic number{i} release",
        )
        for i in range(BACKLOG_LIMIT + 5)
    ]
    llm = FakeLLM({"score": [ScoreBatch(scores=[])]})
    stats = run_agent(store, old, llm, http(), now, run_id)
    lines = [x for x in llm.calls[0]["user"].splitlines() if x.startswith("[")]
    assert len(lines) == BACKLOG_LIMIT and stats["scored_backlog"] == BACKLOG_LIMIT


def test_the_writer_is_told_when_the_event_happened(store, now, run_id):
    old = backlog(store, now, 1)
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(old[0])])], "write": [draft()]})
    run_agent(store, old, llm, http(), now, run_id)
    user = llm.calls[1]["user"]
    assert "First reported: 10 November 2026" in user
    assert "Edition date: 19 November 2026" in user


def test_a_backlog_story_that_does_not_say_when_waits_for_review(store, now, run_id):
    old = backlog(store, now, 2)
    dated = draft(
        en_summary="On 10 November the alpha engine added streaming support for agents.",
        tr_summary="Alpha engine 10 Kasım'da ajanlar için akış desteği ekledi.",
    )
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(c) for c in old])], "write": [dated, draft()]})
    run_agent(store, old, llm, http(), now, run_id)
    stories = {s.cluster_id: s for s in store.stories_since(now - timedelta(days=1))}
    assert stories[old[0].cluster_id].status == "published"
    undated = stories[old[1].cluster_id]
    assert undated.status == "review"
    assert any(r.startswith("verify: dating:") for r in undated.reasons)


def test_review_all_holds_backlog_stories_too(store, now, run_id):
    old = backlog(store, now, 1)
    dated = draft(
        en_summary="On 10 November the alpha engine added streaming support for agents.",
        tr_summary="Alpha engine 10 Kasım'da ajanlar için akış desteği ekledi.",
    )
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(old[0])])], "write": [dated]})
    stats = run_agent(store, old, llm, http(), now, run_id, review_all=True)
    assert stats["review"] == 1 and stats["published"] == 0
