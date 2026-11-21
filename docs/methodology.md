# Methodology

How Radar decides what to cover, what it writes and what it will not publish without a person looking first.

## How stories are chosen

Radar collects items from the sources in `sources.yaml`, groups items about the same story into a cluster and ranks clusters (see [sources.md](sources.md)). A language model then gives each new cluster three scores from 0 to 5:

- **Relevance:** does a working developer need to know this?
- **Novelty:** is it new, not a rewrite or a minor patch?
- **Usefulness:** can a developer act on it this week?

The total is `0.4 x relevance + 0.3 x novelty + 0.3 x usefulness`. A story is eligible when the total is at least 3.0 **and** relevance is at least 3. At most eight stories a day are kept, best total first; the day is the Istanbul calendar day, and stories written by earlier runs that day count toward the eight. Turkish-language stories with a total of at least 3.5 may replace up to two of the lower non-Turkish picks, so local news is not crowded out. Scores are stored and reused, unless a story was written since (see below).

The model also picks a category (protocol, model, framework, tooling, research, security, industry, policy) and may add risk flags: `security_incident`, `accusation`, `funding_figure`, `third_party_benchmark`, `regulation`. Each item it rates tells it when the story was first reported.

### Fresh first, then the backlog

The scoring above is for **fresh** stories: first reported within the last 36 hours. When fewer than five stories qualify for the day, Radar looks at its **backlog**: stories first reported up to 14 days ago that it has never written. "First reported" is the earliest date any source gave, so an item a feed dates ten days back is ten days old even if Radar read it today. Backlog stories are ranked by the same importance signals as fresh ones (source tier, how many sources carried the story, points, Türkiye), and that importance halves for every week of age; the best 20 are then scored with a different question in place of novelty: **is it still important to know this week?** A minor, stale or superseded item scores low, and the older the item, the higher the bar.

The backlog bar is stricter than the fresh one. A backlog story is eligible only when its total is at least 3.5, relevance at least 4 and "still matters" at least 3. Backlog stories only top the day up to five, never past the day's maximum, and there are no Türkiye slots among them. Five is a target, not a promise: when nothing in the backlog passes, the day has fewer stories.

### Never the same event twice

Before a story is scored, and again just before it is written, its cluster is compared with every story Radar wrote in the last 30 days:

- **Same link.** Any item link of the cluster equals the source link of a written story or the link of any item behind it. Links are compared after canonicalisation (https, no `www.`, no tracking parameters).
- **Same title.** Any title in the cluster and any title of a written story (the items behind it and the Turkish and English titles Radar wrote) share at least 60% of their words, and contain exactly the same numbers and versions. So "Rust 1.80 released" never matches "Rust 1.81 released", and a new version is not mistaken for a repeat.
- **Same event, other words.** The scorer sees the titles of up to 100 recent stories and flags an item as a repeat when it reports the same event again: a re-report, a recap, a translation, or a follow-up with no substantial new development. A repeat is never chosen. Because the list changes whenever a story is written, a score asked before the latest story was written is asked again.

What this cannot catch: the first two rules are about words and links, so a re-report in other words or in another language is left to the model, which can miss. Two reports of one event that land in the same run, in two clusters with different words, are only caught if the second matches the first by link or title once the first is written. Radar only knows the stories in its own database: a story on the site that this database never wrote is invisible to all three rules. And a genuinely new development with a title very close to an older story's (same words, same numbers) is skipped as a duplicate.

### Saying when

The writer is told, outside the source text, the day the event was first reported and the day of the edition. When the event is two or more calendar days old, it must say when it happened, in both languages ("on 10 November", "10 Kasım'da"), and must not call it today's news. The verifier checks this (see below).

## The fact card

For each chosen story the writer first produces a fact card: one plain sentence on what happened, the organisations, products and people named, the numbers and versions copied character for character, and a repository or quickstart link taken from the links found in the primary article. The Turkish and English texts are written from the same card, so they say the same thing.

The writer sees only the source document: the primary article's text plus the feed title and summary of every item in the cluster, community-tier items included (6,000 characters in all), and up to 2,000 characters of links (the article's links, then the items' URLs). It is told to use only facts the source states. If the source is shorter than 200 characters, no story is written.

## What the verifier checks

The check is deterministic code, not another model. It checks the draft against the source document described above, so a fact that appears only in a community post's feed title or summary counts as "in the source". For each draft it checks:

- **Length.** Title at most 90 characters, summary at most 320, developer line at most 200.
- **Dating.** For an event first reported two or more Istanbul calendar days before the edition, the English title or summary must name the month it was first reported in, and so must the Turkish one; no text may say "today" or "bugün". A date written from the dates Radar gave the writer counts as a source fact for the number and name checks. This checks that the month is named, not that the day is right: a wrong day passes when that number happens to appear in the source or in the dates.
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

Every story keeps its category, its status and reasons, when its event was first reported and whether it came from the fresh lane or the backlog (both in the agent's database only: the admin service and the site do not receive them yet), the scores, the primary source URL and the number of sources that covered it, and both language versions. The source links a story shows are built when it is sent: an item's own URL is shown only when it is on the site of the configured source that carried it (the host of its feed URL, or a subdomain of it); otherwise that source's own site is shown. A Hacker News item points wherever its submitter chose, so it shows `news.ycombinator.com` (or its discussion page, for a post with no link) and never the submitted page. Such an item still counts toward the number of sources. The writer is instructed to avoid hype words, emojis and the first person, but the verifier does not check that. No separate "AI-assisted" label is stored; the stored data is what is listed above.
