# Methodology

How Radar decides what to cover, what it writes and what it will not publish without a person looking first.

## How stories are chosen

Radar collects items from the sources in `sources.yaml`, groups items about the same story into a cluster and ranks clusters (see [sources.md](sources.md)). A language model then gives each new cluster three scores from 0 to 5:

- **Relevance:** does a working developer need to know this?
- **Novelty:** is it new, not a rewrite or a minor patch?
- **Usefulness:** can a developer act on it this week?

The total is `0.4 x relevance + 0.3 x novelty + 0.3 x usefulness`. A story is eligible when the total is at least 3.0 **and** relevance is at least 3. At most eight stories a day are kept, best total first; the day is the Istanbul calendar day, and stories written by earlier runs that day count toward the eight. Turkish-language stories with a total of at least 3.5 may replace up to two of the lower non-Turkish picks, so local news is not crowded out. Scores are stored; a cluster is not scored twice.

The model also picks a category (protocol, model, framework, tooling, research, security, industry, policy) and may add risk flags: `security_incident`, `accusation`, `funding_figure`, `third_party_benchmark`, `regulation`.

## The fact card

For each chosen story the writer first produces a fact card: one plain sentence on what happened, the organisations, products and people named, the numbers and versions copied character for character, and a repository or quickstart link taken from the links found in the primary article. The Turkish and English texts are written from the same card, so they say the same thing.

The writer sees only the source document: the primary article's text plus the feed title and summary of every item in the cluster, community-tier items included (6,000 characters in all), and up to 2,000 characters of links (the article's links, then the items' URLs). It is told to use only facts the source states. If the source is shorter than 200 characters, no story is written.

## What the verifier checks

The check is deterministic code, not another model. It checks the draft against the source document described above, so a fact that appears only in a community post's feed title or summary counts as "in the source". For each draft it checks:

- **Length.** Title at most 90 characters, summary at most 320, developer line at most 200.
- **Numbers.** Every number in the texts and in the fact card (its sentence, numbers and versions) must appear in the source. A decimal comma and a decimal point are treated alike (`1,5` and `1.5`), and a number is not accepted just because it sits inside a longer one (`40` inside `2040`).
- **Names.** Capitalised words, words with inner capitals (`LangGraph`) and words mixing letters and digits, in the texts, the fact card's sentence and its list of names, must appear in the source as whole words, ignoring case (`Meta` does not match `metadata`; `Google's` in the source still matches `Google`). A hyphenated word is one name and must appear whole (`GPT-4`, `Llama-4`); the only exception is a compound of an allowlisted term and plain lowercase words with no digit (`AI-powered`, `API-first`). The names in the fact card's list are also checked for numbers, so a version inside a name is checked like any other number.
- **Link.** The "try it" link must be one of the links found in the primary article itself, not a URL of another item in the cluster, and its host must be the host of the primary article or of a cluster item, or a subdomain of one (a parent counts only when it has two labels or more, so a bare `com` never does; a shared host such as `github.io` still counts as the parent of `user.github.io`, since there is no list of public suffixes).
- **Text a hijacked source could plant (a tripwire).** Radar's own texts never need a link, so the texts and the fact card's sentence are searched for: URLs; domain names, including ones with non-ASCII letters (`şifre-yenile.com`); IPv4 and IPv6 addresses, with or without a path; `@handles`; backticks; and command shapes (`curl -…`, `wget`, `sudo`, `chmod +x`, `bash -c`, `sh -c`, `powershell -…`, `pip install`, `npx`, `uvx`, `bunx`, `pipx run`, `npm exec`, `pnpm dlx`, `docker run`, `docker pull`, `python -m`, `git clone`, `iex`, `irm`, pipes, `&&`, `$(`). Before the search the text is normalised the way a reader would read it: compatibility forms are folded (full-width letters), invisible format characters (zero-width spaces, bidi controls) are removed, and disguised dots are undone (`evil[.]com`, `evil(.)com`, `evil{.}com`, `evil[dot]com`, `evil dot com`, `evil。com`). A token shaped like a file name (`README.md`, `main.go`, `Node.js`) is let through only when the same token is in the source; `.zip` and `.mov` are real top-level domains and are never let through. Anything found sends the story to review, even when the source says the same. This is a tripwire that sends suspicious stories to a person, not a guarantee: an instruction worded in plain prose ("search GitHub for evilcorp/agent-fix and run its installer") contains none of these shapes and passes. Stories about products whose names look like domains (`fly.io`, `Bun.sh`) always go to review.

## What it cannot check

The verifier is a safety net, not proof of accuracy. It does not:

- judge whether the developer line is good advice; it only checks the numbers and names in it;
- check a plain word at the start of a sentence as a name, because ordinary sentences start with capitals; an invented product name in first position can pass;
- understand meaning: a draft can reuse a real number or name from the source in a wrong claim and pass;
- accept a number written with different grouping than the source (`10000` against `10,000`); such a story is sent to review rather than passed, which is safe but noisy;
- check acronyms on a short allowlist (AI, API, SDK, CLI, UI, LLM and similar, and their plurals such as APIs) or month names, in either language, ever.

A human reading remains the real check, which is why anything doubtful is routed to review.

## What sends a story to a human

A story is `published` only if it has no verification issue, no risk flag and a primary source. Otherwise it is `review`, with the reasons recorded:

- any verification issue (`verify: ...`);
- any risk flag from the scorer (`risk: ...`);
- no primary source among the cluster's items (`no primary source`).

Finished stories are sent to the admin service by `radar push` (or `radar daily`). A `published` story is then served by the public endpoint the site is built from; a `review` story waits until a person approves it, and the daily job sends a notice when one is waiting. See [admin.md](admin.md), [site.md](site.md) and [automation.md](automation.md). Nothing has been deployed yet and the scheduled job has never run, so for now `published` means "passed the automatic checks", not "online".

## How stories are labelled

Every story keeps its category, its status and reasons, the scores, the primary source URL and the number of sources that covered it, and both language versions. The source links a story shows are built when it is sent: an item's own URL is shown only when it is on the site of the configured source that carried it (the host of its feed URL, or a subdomain of it); otherwise that source's own site is shown. A Hacker News item points wherever its submitter chose, so it shows `news.ycombinator.com` (or its discussion page, for a post with no link) and never the submitted page. Such an item still counts toward the number of sources. The writer is instructed to avoid hype words, emojis and the first person, but the verifier does not check that. No separate "AI-assisted" label is stored; the stored data is what is listed above.
