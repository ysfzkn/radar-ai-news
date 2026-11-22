"""No source leads more than PER_SOURCE stories of one edition."""

from datetime import timedelta

from fakes import FakeLLM
from radar.agent import run_agent
from radar.models import Candidate
from radar.score import PER_SOURCE, ScoreBatch, within_source_limit
from test_backlog import backlog, draft, fresh, good, http, make


def bare(cid: int) -> Candidate:
    return Candidate(
        cluster_id=cid,
        title=f"t{cid}",
        url=f"https://x.test/{cid}",
        summary="d",
        source_count=1,
        has_primary=True,
        is_turkey=False,
        score=1.0,
    )


def led_by(store, stories) -> list[str]:
    lead = store.lead_sources([s.cluster_id for s in stories])
    return sorted(lead[s.cluster_id] for s in stories)


def test_the_limit_is_two():
    assert PER_SOURCE == 2


def test_the_best_two_of_a_source_stay_and_the_rest_of_the_order_is_kept():
    ordered = [bare(n) for n in range(1, 7)]
    sources = {1: "a", 2: "a", 3: "a", 4: "b", 5: "a"}  # 6 has no known source
    kept = within_source_limit(ordered, sources, {})
    assert [c.cluster_id for c in kept] == [1, 2, 4, 6]


def test_stories_the_edition_already_has_count():
    ordered = [bare(1), bare(2), bare(3)]
    kept = within_source_limit(ordered, {1: "a", 2: "a", 3: "b"}, {"a": 1, "b": 2})
    assert [c.cluster_id for c in kept] == [1]


def test_a_cluster_is_led_by_its_first_source_by_tier_then_time(store, now):
    both = make(store, now, age=timedelta(hours=2), lane="fresh", n=0, source="hn")
    extra = make(store, now, age=timedelta(hours=1), lane="fresh", n=1)
    item = [i for i in store.items_since(now - timedelta(hours=3)) if i.url == extra.url][0]
    store.set_cluster(item.id, both.cluster_id)
    assert store.lead_sources([both.cluster_id, 99999]) == {both.cluster_id: "github-blog"}


def test_a_hacker_news_story_is_counted_by_the_site_it_points_to(store, now):
    one = make(store, now, age=timedelta(hours=2), lane="fresh", n=0, source="hn", host="blog")
    two = make(store, now, age=timedelta(hours=2), lane="fresh", n=1, source="hn", host="other")
    assert store.lead_sources([one.cluster_id, two.cluster_id]) == {
        one.cluster_id: "site:blog0.test",
        two.cluster_id: "site:other1.test",
    }


def test_a_prolific_source_gets_two_places_and_the_others_keep_theirs(store, now, run_id):
    loud = fresh(store, now, 4)
    quiet = fresh(store, now, 2, start=4, source="webrazzi-ai")
    candidates = [*loud, *quiet]
    llm = FakeLLM(
        {"score": [ScoreBatch(scores=[good(c) for c in candidates])], "write": [draft()] * 4}
    )
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert stats["written"] == 4 and stats["skipped_source_limit"] == 2
    stories = store.stories_since(now)
    assert led_by(store, stories) == ["github-blog", "github-blog", "webrazzi-ai", "webrazzi-ai"]
    assert {s.cluster_id for s in stories} >= {loud[0].cluster_id, loud[1].cluster_id}


def test_a_later_run_of_the_day_counts_what_the_day_already_has(store, now, run_id):
    first = fresh(store, now, 2)
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(c) for c in first])], "write": [draft()] * 2})
    assert run_agent(store, first, llm, http(), now, run_id)["written"] == 2

    later = now + timedelta(hours=1)
    more = [*fresh(store, now, 2, start=2), *fresh(store, now, 1, start=4, source="webrazzi-ai")]
    llm = FakeLLM({"score": [ScoreBatch(scores=[good(c) for c in more])], "write": [draft()]})
    stats = run_agent(store, [*first, *more], llm, http(), later, store.start_run("agent", later))
    assert stats["written"] == 1 and stats["skipped_source_limit"] == 2
    assert led_by(store, store.stories_since(now)) == ["github-blog", "github-blog", "webrazzi-ai"]


def test_the_backlog_cannot_take_a_source_past_the_limit(store, now, run_id):
    new = fresh(store, now, 1)
    old = [*backlog(store, now, 3), *backlog(store, now, 1, start=9, source="webrazzi-ai")]
    llm = FakeLLM(
        {
            "score": [
                ScoreBatch(scores=[good(c) for c in new]),
                ScoreBatch(scores=[good(c, novelty=5) for c in old]),
            ],
            "write": [draft()] * 3,
        }
    )
    stats = run_agent(store, [*new, *old], llm, http(), now, run_id)
    assert stats["written_fresh"] == 1 and stats["written_backlog"] == 2
    assert stats["skipped_source_limit"] == 2
    assert led_by(store, store.stories_since(now)) == ["github-blog", "github-blog", "webrazzi-ai"]
