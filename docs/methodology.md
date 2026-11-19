# Methodology

How Radar decides what to cover, what it writes and what it will not publish without a person looking first.

## How stories are chosen

Radar collects items from the sources in `sources.yaml`, groups items about the same story into a cluster and ranks clusters (see [sources.md](sources.md)). A language model then gives each new cluster three scores from 0 to 5:

- **Relevance:** does a working developer need to know this?
- **Novelty:** is it new, not a rewrite or a minor patch?
- **Usefulness:** can a developer act on it this week?

The total is `0.4 x relevance + 0.3 x novelty + 0.3 x usefulness`. A story is eligible when the total is at least 3.0 **and** relevance is at least 3. At most eight stories a day are kept, best total first. Turkish-language stories with a total of at least 3.5 may replace up to two of the lower non-Turkish picks, so local news is not crowded out. Scores are stored; a cluster is not scored twice.

The model also picks a category (protocol, model, framework, tooling, research, security, industry, policy) and may add risk flags: `security_incident`, `accusation`, `funding_figure`, `third_party_benchmark`, `regulation`.

## The fact card

For each chosen story the writer first produces a fact card: one plain sentence on what happened, the organisations, products and people named, the numbers and versions copied character for character, and a repository or quickstart link taken from the links found in the source. The Turkish and English texts are written from the same card, so they say the same thing.

The writer sees only the source document: the primary article's text (capped at 6,000 characters) plus the titles and summaries the feeds gave for that story. It is told to use only facts the source states. If the source is shorter than 200 characters, no story is written.

## What the verifier checks

The check is deterministic code, not another model. For each draft it checks:

- **Length.** Title at most 90 characters, summary at most 320, developer line at most 200.
- **Numbers.** Every number in the texts and in the fact card must appear in the source. A decimal comma and a decimal point are treated alike (`1,5` and `1.5`), and a number is not accepted just because it sits inside a longer one (`40` inside `2040`).
- **Names.** Capitalised words, words with inner capitals (`LangGraph`) and words mixing letters and digits must appear in the source, ignoring case.
- **Link.** The "try it" link must be one of the links found in the source.

## What it cannot check

The verifier is a safety net, not proof of accuracy. It does not:

- judge whether the developer line is good advice; it only checks the numbers and names in it;
- check a plain word at the start of a sentence as a name, because ordinary sentences start with capitals; an invented product name in first position can pass;
- understand meaning: a draft can reuse a real number or name from the source in a wrong claim and pass;
- accept a number written with different grouping than the source (`10000` against `10,000`); such a story is sent to review rather than passed, which is safe but noisy;
- check acronyms on a short allowlist (AI, API, SDK, CLI, UI, LLM and similar) or month names, in either language, ever.

A human reading remains the real check, which is why anything doubtful is routed to review.

## What sends a story to a human

A story is `published` only if it has no verification issue, no risk flag and a primary source. Otherwise it is `review`, with the reasons recorded:

- any verification issue (`verify: ...`);
- any risk flag from the scorer (`risk: ...`);
- no primary source among the cluster's items (`no primary source`).

Nothing leaves the local database in this version, so `published` means "passed the automatic checks", not "online".

## How stories are labelled

Every story keeps its category, its status and reasons, the scores, the primary source URL and the number of sources that covered it, and both language versions. The wording is plain, with no hype words, emojis or first person. A story is AI-assisted: it is written by a model from the cited source and checked by the rules above.
