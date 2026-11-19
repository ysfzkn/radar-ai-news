from radar.models import Candidate, Draft, FactCard, Score, SourceDoc, StoryText
from radar.verify import route, verify

SRC = "Google released A2UI 1.0 on Nov 19. Downloads grew 1.5 times. Works with LangGraph."


def doc(text=SRC, links=(), article_links=None):
    article = list(links) if article_links is None else list(article_links)
    return SourceDoc(url="https://x.test/a", text=text, links=list(links), article_links=article)


def story(title="A2UI 1.0", summary="Google released it.", dev_line="Works with LangGraph."):
    return StoryText(title=title, summary=summary, dev_line=dev_line)


def draft(tr=None, en=None, who=(), numbers=(), versions=(), try_url=None):
    return Draft(
        fact_card=FactCard(
            what="w",
            who=list(who),
            numbers=list(numbers),
            versions=list(versions),
            try_url=try_url,
        ),
        tr=tr or story(),
        en=en or story(),
    )


def test_clean_draft_has_no_issues():
    d = draft(
        tr=story("A2UI 1.0", "Google, indirmeler 1,5 kat arttı.", "LangGraph ile çalışır."),
        who=["Google"],
        numbers=["1,5"],
        versions=["1.0"],
    )
    assert verify(d, doc()) == []


def test_invented_number_is_reported():
    d = draft(en=story(summary="Google says usage grew 40%."))
    assert verify(d, doc()) == ["en.summary: number '40' not in source"]


def test_turkish_decimal_comma_matches():
    assert verify(draft(tr=story(summary="Google 1,5 kat.")), doc()) == []


def test_number_must_not_match_inside_a_longer_one():
    d = draft(en=story(summary="Google 40."))
    assert verify(d, doc(SRC + " 2040 and 1.40")) == ["en.summary: number '40' not in source"]


def test_invented_name_is_reported():
    d = draft(en=story(title="OpenAI ships A2UI"))
    assert verify(d, doc()) == ["en.title: name 'OpenAI' not in source"]


def test_turkish_suffix_is_stripped():
    d = draft(tr=story(summary="Google'ın aracı, LangGraph’a bağlanır."))
    assert verify(d, doc()) == []


def test_turkish_capital_i_folds():
    d = draft(tr=story(summary="Toplantı bugün İstanbul yakınında."))
    assert verify(d, doc(SRC + " held near istanbul")) == []


def test_sentence_initial_plain_word_is_not_a_name():
    d = draft(en=story(summary="Developers can try it."))
    assert verify(d, doc()) == []


def test_sentence_initial_camelcase_is_still_checked():
    d = draft(en=story(summary="OpenAI says hello."))
    assert verify(d, doc()) == ["en.summary: name 'OpenAI' not in source"]


def test_allowlisted_tokens_pass():
    d = draft(
        en=story(summary="Use the new AI SDK in November."),
        tr=story(summary="Yeni AI SDK Kasım ayında."),
    )
    assert verify(d, doc()) == []


def test_too_long_fields_are_reported():
    d = draft(
        tr=story(title="a" * 97, summary="b" * 321, dev_line="c" * 201),
        en=story(title="d" * 90),
    )
    assert verify(d, doc()) == [
        "tr.title: too long (97 > 90)",
        "tr.summary: too long (321 > 320)",
        "tr.dev_line: too long (201 > 200)",
    ]


def test_try_url_must_be_a_source_link():
    link = "https://x.test/try"
    assert verify(draft(try_url=link), doc(links=[link])) == []
    assert verify(draft(try_url=link), doc()) == ["fact_card.try_url: not a source link"]


def test_try_url_must_come_from_the_primary_article():
    community = "https://news.ycombinator.com/item?id=1"
    d = doc(links=["https://x.test/try", community], article_links=["https://x.test/try"])
    assert verify(draft(try_url=community), d) == ["fact_card.try_url: not a source link"]
    assert verify(draft(try_url="https://x.test/try"), d) == []


def test_fact_card_entries_are_checked():
    d = draft(who=["Microsoft"], numbers=["99%"], versions=["v7.1"])
    assert verify(d, doc()) == [
        "fact_card.numbers: number '99' not in source",
        "fact_card.versions: number '7.1' not in source",
        "fact_card.who: name 'Microsoft' not in source",
    ]


def test_punctuation_around_tokens_is_stripped():
    d = draft(en=story(summary='Built by (Google), with "A2UI" and LangGraph.'))
    assert verify(d, doc()) == []


def test_colon_starts_a_new_sentence():
    d = draft(en=story(summary="Note: Developers can try it."))
    assert verify(d, doc()) == []


def test_multi_word_who_must_occur_as_written():
    assert verify(draft(who=["Google DeepMind"]), doc(SRC + " Google DeepMind")) == []
    assert verify(draft(who=["Google DeepMind"]), doc(SRC + " Google and DeepMind")) == [
        "fact_card.who: name 'Google DeepMind' not in source"
    ]


def test_version_token_yields_number_and_name_checks():
    d = draft(en=story(summary="Try GPT-6.2 now."))
    assert verify(d, doc()) == [
        "en.summary: number '6.2' not in source",
        "en.summary: name 'GPT-6.2' not in source",
    ]


def test_repeated_problem_is_reported_once():
    d = draft(en=story(summary="OpenAI and OpenAI grew 40 and 40."))
    assert verify(d, doc()) == [
        "en.summary: number '40' not in source",
        "en.summary: name 'OpenAI' not in source",
    ]


def test_issue_order_is_length_numbers_names_link():
    d = draft(
        en=story(title="OpenAI " + "x" * 90, summary="Up 40."),
        who=["Microsoft"],
        try_url="https://nope.test",
    )
    assert verify(d, doc()) == [
        "en.title: too long (97 > 90)",
        "en.summary: number '40' not in source",
        "en.title: name 'OpenAI' not in source",
        "fact_card.who: name 'Microsoft' not in source",
        "fact_card.try_url: not a source link",
    ]


def test_fact_card_what_is_checked_for_numbers_and_names():
    d = draft()
    d.fact_card.what = "Google and OpenAI shipped 40 tools."
    assert verify(d, doc()) == [
        "fact_card.what: number '40' not in source",
        "fact_card.what: name 'OpenAI' not in source",
    ]


def test_fact_card_what_sits_after_the_texts_and_before_who():
    d = draft(en=story(dev_line="Ask Anthropic, 41."), who=["Microsoft"], numbers=["42"])
    d.fact_card.what = "Today Mistral did 43 things in a sentence with no length limit " + "x" * 400
    assert verify(d, doc()) == [
        "en.dev_line: number '41' not in source",
        "fact_card.what: number '43' not in source",
        "fact_card.numbers: number '42' not in source",
        "en.dev_line: name 'Anthropic' not in source",
        "fact_card.what: name 'Mistral' not in source",
        "fact_card.who: name 'Microsoft' not in source",
    ]


def test_names_match_whole_words_only():
    src = SRC + " The metadata format changed."
    assert verify(draft(en=story(summary="Google and Meta.")), doc(src)) == [
        "en.summary: name 'Meta' not in source"
    ]
    assert verify(draft(who=["Meta"]), doc(src)) == ["fact_card.who: name 'Meta' not in source"]
    assert verify(draft(who=["Meta"]), doc(src + " Meta, the company.")) == []


def test_source_possessive_still_matches_the_name():
    for src in ("Meta's model is out.", "Meta'nın modeli çıktı.", "Meta’s model is out."):
        d = draft(en=story(summary="Google and Meta."), who=["Meta"])
        assert verify(d, doc(SRC + " " + src)) == []


def test_plural_allowlisted_acronyms_pass():
    d = draft(en=story(summary="Google adds APIs, LLMs and SDKs."))
    assert verify(d, doc()) == []
    d = draft(en=story(summary="Google adds Radars and APIS."))
    assert verify(d, doc()) == [
        "en.summary: name 'Radars' not in source",
        "en.summary: name 'APIS' not in source",
    ]


def test_hyphenated_tokens_are_checked_part_by_part():
    d = draft(en=story(summary="Google ships AI-powered and Google-backed LangGraph-ready tools."))
    assert verify(d, doc()) == []
    d = draft(en=story(summary="Google ships OpenAI-backed tools."))
    assert verify(d, doc()) == ["en.summary: name 'OpenAI-backed' not in source"]


def candidate(has_primary=True):
    return Candidate(
        cluster_id=1,
        title="t",
        url="u",
        summary="s",
        source_count=1,
        has_primary=has_primary,
        is_turkey=False,
        score=1.0,
    )


def score_with(*flags):
    return Score(
        cluster_id=1,
        relevance=3,
        novelty=3,
        usefulness=3,
        category="model",
        risk_flags=list(flags),
    )


def test_route_publishes_only_when_clean():
    assert route(candidate(), score_with(), []) == ("published", [])


def test_route_sends_issues_risk_and_missing_primary_to_review():
    status, reasons = route(
        candidate(False), score_with("funding_figure"), ["en.title: too long (95 > 90)"]
    )
    assert status == "review"
    assert reasons == [
        "verify: en.title: too long (95 > 90)",
        "risk: funding_figure",
        "no primary source",
    ]


def test_invented_number_routes_to_review():
    issues = verify(draft(en=story(summary="Up 40%.")), doc())
    assert route(candidate(), score_with(), issues)[0] == "review"


def test_number_must_equal_a_whole_source_token():
    d = draft(en=story(summary="Google 1."))
    assert verify(d, doc(SRC.replace("19", "20"))) == ["en.summary: number '1' not in source"]
    d = draft(en=story(summary="Google 40."))
    assert verify(d, doc(SRC + " 40.5")) == ["en.summary: number '40' not in source"]


def test_number_at_end_of_source_sentence_matches():
    d = draft(en=story(summary="Google 7."))
    assert verify(d, doc(SRC + " Released 7.")) == []


def test_thousands_separator_matches_same_form():
    d = draft(en=story(summary="Google 10,000."))
    assert verify(d, doc(SRC + " Over 10,000 users.")) == []
