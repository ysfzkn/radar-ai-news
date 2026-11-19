from datetime import timedelta

import httpx

from fakes import FakeLLM
from radar.agent import run_agent
from radar.budget import BudgetExceeded
from radar.llm import LLMError, Refused
from radar.models import Candidate, Draft, FactCard, RawItem, Score, StoryText
from radar.score import ScoreBatch

ARTICLE = (
    "<html><body><article><p>"
    + "Alpha engine 2.0 adds streaming support for agents and ships a new quickstart. " * 4
    + "</p></article></body></html>"
)


def http(ok: bool = True) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if not ok:
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": "text/html"}, text=ARTICLE)

    return httpx.Client(transport=httpx.MockTransport(handler))


def world(store, now, count: int = 3, summary: str = "d") -> list[Candidate]:
    candidates = []
    for n in range(count):
        title = f"Alpha engine {n} launch"
        url = f"https://s{n}.test/a"
        store.insert_items(
            [
                RawItem(
                    source_id="github-blog",
                    url=url,
                    title=title,
                    summary=summary,
                    published_at=now - timedelta(hours=1),
                )
            ]
        )
        cid = store.create_cluster(title, now)
        stored = [i for i in store.items_since(now - timedelta(hours=3)) if i.url == url][0]
        store.set_cluster(stored.id, cid)
        candidates.append(
            Candidate(
                cluster_id=cid,
                title=title,
                url=url,
                summary=summary,
                source_count=1,
                has_primary=True,
                is_turkey=False,
                score=1.0 - n / 10,
            )
        )
    return candidates


def score(cid: int, total: int = 5) -> Score:
    return Score(
        cluster_id=cid, relevance=total, novelty=total, usefulness=total, category="tooling"
    )


def draft(extra: str = "") -> Draft:
    text = StoryText(
        title="Alpha engine 2.0 adds streaming",
        summary=f"The alpha engine adds streaming support for agents.{extra}",
        dev_line="Try the new quickstart.",
    )
    return Draft(
        fact_card=FactCard(what="Alpha engine 2.0 ships.", who=[], numbers=[], versions=["2.0"]),
        tr=text,
        en=text,
    )


def three_scores(candidates) -> ScoreBatch:
    ids = [c.cluster_id for c in candidates]
    return ScoreBatch(scores=[score(ids[0]), score(ids[1]), score(ids[2], total=1)])


def test_run_agent_happy_path(store, now, run_id):
    candidates = world(store, now)
    llm = FakeLLM({"score": [three_scores(candidates)], "write": [draft(), draft(" It grew 77%.")]})
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert stats == {
        "scored": 3,
        "selected": 2,
        "written": 2,
        "published": 1,
        "review": 1,
        "skipped_thin": 0,
        "failed": 0,
        "budget_stopped": False,
    }
    stories = store.stories_since(now)
    assert sorted(s.status for s in stories) == ["published", "review"]
    assert all(s.source_url.startswith("https://s") and s.source_count == 1 for s in stories)


def test_second_run_makes_no_model_calls(store, now, run_id):
    candidates = world(store, now)
    llm = FakeLLM({"score": [three_scores(candidates)], "write": [draft(), draft()]})
    run_agent(store, candidates, llm, http(), now, run_id)
    llm2 = FakeLLM({})
    again = run_agent(store, candidates, llm2, http(), now, store.start_run("run", now))
    assert llm2.calls == [] and again["scored"] == 0 and again["written"] == 0


def test_cached_scores_are_reused_for_unwritten_clusters(store, now, run_id):
    candidates = world(store, now, count=1)
    store.save_scores([score(candidates[0].cluster_id, total=1)], now - timedelta(days=1))
    llm = FakeLLM({})
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert llm.calls == [] and stats["scored"] == 0 and stats["selected"] == 0


def test_cached_score_above_threshold_is_written_without_scoring(store, now, run_id):
    candidates = world(store, now, count=1)
    store.save_scores([score(candidates[0].cluster_id)], now - timedelta(days=1))
    llm = FakeLLM({"write": [draft()]})
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert [c["step"] for c in llm.calls] == ["write"] and stats["written"] == 1


def test_thin_source_skips_the_writer(store, now, run_id):
    candidates = world(store, now, count=1)
    llm = FakeLLM({"score": [ScoreBatch(scores=[score(candidates[0].cluster_id)])]})
    stats = run_agent(store, candidates, llm, http(ok=False), now, run_id)
    assert stats["skipped_thin"] == 1 and stats["written"] == 0
    assert [c["step"] for c in llm.calls] == ["score"]


def test_refusal_fails_one_story_and_continues(store, now, run_id):
    candidates = world(store, now, count=2)
    llm = FakeLLM(
        {
            "score": [ScoreBatch(scores=[score(c.cluster_id) for c in candidates])],
            "write": [Refused("no"), draft()],
        }
    )
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert stats["failed"] == 1 and stats["written"] == 1 and not stats["budget_stopped"]


def test_llm_error_during_write_counts_as_failed(store, now, run_id):
    candidates = world(store, now, count=1)
    llm = FakeLLM(
        {"score": [ScoreBatch(scores=[score(candidates[0].cluster_id)])], "write": [LLMError("x")]}
    )
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert stats["failed"] == 1 and stats["written"] == 0


def test_scoring_error_scores_nothing_but_uses_cached(store, now, run_id):
    candidates = world(store, now, count=2)
    store.save_scores([score(candidates[0].cluster_id)], now - timedelta(days=1))
    llm = FakeLLM({"score": [LLMError("x")], "write": [draft()]})
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert stats["failed"] == 1 and stats["written"] == 1 and stats["scored"] == 1
    assert store.scores_for([c.cluster_id for c in candidates]).keys() == {candidates[0].cluster_id}


def test_budget_stop_keeps_finished_stories(store, now, run_id):
    candidates = world(store, now, count=2)
    llm = FakeLLM(
        {
            "score": [ScoreBatch(scores=[score(c.cluster_id) for c in candidates])],
            "write": [draft(), BudgetExceeded("cap")],
        }
    )
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert stats["written"] == 1 and stats["budget_stopped"] is True
    assert len(store.stories_since(now)) == 1


def test_scoring_blocked_by_budget_writes_nothing(store, now, run_id):
    candidates = world(store, now, count=2)
    llm = FakeLLM({"score": [BudgetExceeded("cap")]})
    stats = run_agent(store, candidates, llm, http(), now, run_id)
    assert stats["budget_stopped"] is True and stats["written"] == 0
    assert [c["step"] for c in llm.calls] == ["score"]
