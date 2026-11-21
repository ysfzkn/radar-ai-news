# The agent

The daily job on GitHub Actions, its notices and its saved state are described in [automation.md](automation.md). This page covers the agent itself.

`radar run` turns the collector's candidates into stories: it scores them, writes the best ones in Turkish and English, checks the text against its source and decides whether a human must look at it. Everything lands in the local SQLite database. Nothing is published anywhere.

## The seven steps

| # | Step | Model call? |
| --- | --- | --- |
| 1 | Collect: fetch every source, store new items up to 14 days old | no |
| 2 | Cluster items about the same story and rank candidates in two lanes: fresh and backlog | no |
| 3 | Score each new fresh candidate: relevance, novelty, usefulness, category, risk flags, repeat | yes, one batched call (`claude-haiku-5-5`) |
| 4 | Select: apply the thresholds in [methodology.md](methodology.md) and keep at most `--max-stories` (default 8) per Istanbul calendar day, counting stories already written that day | no |
| 5 | Build the source document: the primary article's text and links plus the feed title and summary of every item in the cluster (community tier included), at most 6,000 characters of text and 2,000 characters of links. A source under 200 characters is "thin" and is skipped without a model call | no |
| 6 | Write: a fact card plus a title, summary and developer line in Turkish and English | yes, one call per story (`claude-sonnet-5-5`) |
| 7 | Verify and route: deterministic checks, then `published` or `review` | no |
| 8 | Only when the day still has fewer than 5 stories: score the backlog with its own question and write the best that pass its stricter bar, steps 5 to 7 again, up to 5 | yes, one more batched scoring call, then one call per story |

Scores are cached per cluster, and a cluster that already has a story is never processed again. The edition is per Istanbul calendar day: once `--max-stories` stories have been written that day, a later run that day scores nothing and writes nothing.

### Fresh, backlog and the floor of five

A cluster's age is the earliest date any of its items gives: the feed's published date, or, for a feed that gives none, the time the store first saw the item. An item published ten days ago and read for the first time today is ten days old.

- **Fresh**: first reported within the last 36 hours. The best 30 are scored. They always come first, up to the day's maximum (8, or `--max-stories`).
- **Backlog**: first reported more than 36 hours and at most 14 days ago, with no story yet. They are ranked by the same importance as fresh ones (tier, number of sources, points, Türkiye) halved for every week of age. Clusters already written, blocked by earlier attempts or matching a written story (see the duplicate rule in [methodology.md](methodology.md)) are dropped first; then the best 20 are scored, in one call, with a different question ("does a developer still need to know this this week?").
- **The floor.** After the fresh stories are written, if the day (stories of earlier runs that day included) has fewer than 5, the backlog is scored and written until the day reaches 5, never past `--max-stories` (so `--max-stories 3` gives at most 3). A backlog story must pass a stricter bar than a fresh one; when nothing passes, the day has fewer than 5. A fresh story that turns out thin or fails is replaced from the backlog. At most 3 backlog stories more than the number still needed are tried, for those that turn out thin or fail. When the day already has 5, the backlog is not scored at all.

Clustering follows the item's own date: a title joins a cluster only when the item was published within 72 hours of the dates the cluster already spans, so an old item read today joins the cluster of its own days, not today's. A shared link joins its cluster whatever the dates.

A cached score is used again only when it answered the same question (a fresh score is never used for the backlog), when no story has been written since it was asked (otherwise the scorer could not have flagged it as a repeat of that story, so it is asked again, with the new story in its list) and, for the backlog, when it is less than 48 hours old.

The backlog can only hold what the store has seen. Feeds list a limited number of recent entries (Radar keeps at most 50 per source per fetch), so a story that fell off every feed before Radar read it cannot come back, and the store's history starts with its first run. Migration `0005_backlog.sql` adds the columns this needs (a score's question, repeat flag and story watermark; a story's first-report time and lane) to an existing database in place; scores stored before it count as fresh scores asked before any story existed, so they are asked again once a story exists.

When a later run makes model calls and when it does not:

- **No calls** when the day's edition is full, or when nothing new is eligible and nothing failed before: every candidate already has a usable score, and every eligible cluster already has a story.
- **Calls** when a new cluster appears (it is scored), when the scorer left a candidate out of its reply (it is sent again), when a story was written since a candidate's score (it is scored again), when the day has fewer than 5 stories and backlog candidates have no usable backlog score, and when an eligible cluster has no story yet. That includes stories that failed, were refused or had a thin source on an earlier run. Each of those is recorded as an attempt: the cluster is not tried again the same Istanbul day, and after three attempts it is dropped. A write request that got no reply from the API (a connection error, a timeout or an HTTP error status such as a rate limit or an outage) costs nothing and is not an attempt: the cluster is tried again on the next run.

> **Status when this page was written:** the agent was tested only with scripted fake model replies. No paid run against the real API had been made, so real token counts and costs are not yet known. The backlog, the floor of five, the repeat flag and the dating rule were added later and have likewise run only against fake feeds and fake model replies: how many backlog stories a real day yields, and how well the model judges "still matters" and "repeat", are not known yet.

## Two models

- `claude-haiku-5-5` scores. Scoring is a short, structured judgement over many items, so the cheapest model is enough.
- `claude-sonnet-5-5` writes. The writer must stay faithful to a source and produce natural Turkish, which is worth the higher price, and it is called only for the few stories that pass selection.

Source text is untrusted: the article text is passed inside `<source>` tags and the links inside `<links>` tags, the prompt tells the model to ignore instructions found in either, and nothing in them is executed or followed. A closing tag inside the data, in any letter case or spacing, is escaped so it cannot end the block early. Links containing whitespace or longer than 200 characters are dropped.

The writer runs with a server-side fallback pinned to `claude-sonnet-5` (priced like `claude-sonnet-5-5` in the meter): if `claude-sonnet-5-5` declines, the request is retried on `claude-sonnet-5`. Both attempts can be billed, and each is recorded as its own usage row.

## The budget

- **Hard daily cap: $0.25**, counted per calendar day in Istanbul time (UTC+3). Override with the environment variable `RADAR_DAILY_CAP_USD` (a positive number; an invalid value makes `radar run` and `radar budget` exit with code 2).
- **Estimate before every request.** Before every request the meter estimates its cost: input tokens estimated as one token per two bytes of UTF-8 text plus 1,000, at the model's input price, plus the full `max_tokens` at its output price. When a fallback is allowed (the writer), the estimate is doubled, because a declined attempt and the fallback attempt can both be billed. If today's spend plus that estimate is above the cap, the request is not sent. This is an estimate, not a guaranteed maximum: the real token count is known only after the call.
- **When the cap is hit.** The run stops cleanly. Stories already written are kept, the run record gets `budget_stopped: true`, and the command still exits 0.
- **Token target.** 30,000 tokens a day is a design target. It is reported (`tokens_today`, `over_token_target`) but not enforced. A full day of 8 stories may go over it, more so since each scoring call now carries up to 100 titles of written stories.
- **Does a day of 5 to 8 stories fit the default cap?** By the meter's own rule, checked in the tests: each writer call reserves about $0.065 (twice the single-attempt estimate of about $0.032: about 10,400 bytes of prompt and 2,000 output tokens), and both scoring calls cost at most about $0.003 each. If a story really costs about $0.02, 8 fit under $0.25 with room to spare; if every story cost its full single-attempt estimate, 6 still fit; if every story were billed twice (the fallback used every time), only 3 would. Real costs have not been measured.
- **Prices are a snapshot.** The meter's prices (USD per million tokens, input / output: Haiku 0.10 / 0.50, Sonnet 2.00 / 10.00) were entered by hand and may be out of date. Confirm them on Anthropic's pricing page before relying on the cap. A model the table does not know is billed at the highest rates in it.
- Every call is recorded with its step, model, input tokens, output tokens (thinking tokens included) and cost.

## Commands

```bash
uv run radar run                 # collect, then score, write, verify, route
uv run radar run --max-stories 2 # a smaller, cheaper run
uv run radar run --dry-run       # collect only, no credential needed
uv run radar budget              # today's spend
uv run radar push                # send finished stories to the admin service
uv run radar push --list-refused # show stories the service refused
uv run radar daily               # collect, run, push, then send a notice if one is needed
uv run radar state save --file state.bin   # the database as one encrypted file
uv run radar state load --file state.bin   # restore it
```

`radar run` needs an Anthropic credential, found the way the Anthropic SDK finds it: the environment variable `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`; the workload identity variables (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID` and `ANTHROPIC_IDENTITY_TOKEN` or `ANTHROPIC_IDENTITY_TOKEN_FILE`); or a profile stored by the Anthropic CLI login, that is the file `configs/<profile>.json` in the SDK's config directory. That directory is `ANTHROPIC_CONFIG_DIR` if set, otherwise `%APPDATA%\Anthropic` on Windows and `~/.config/anthropic` elsewhere; the profile is `ANTHROPIC_PROFILE`, else the name in the `active_config` file there, else `default`. An empty directory does not count. Without a credential it prints a message and exits 2 before collecting. The key is read only by the SDK; Radar never stores or logs it.

`radar run` prints one JSON line: the collector's statistics (where `failed` lists the failed source ids, `candidates` counts the fresh lane and `backlog_candidates` the whole backlog before anything is dropped) plus `scored` (both lanes), `scored_backlog`, `selected` and `written` (both lanes) with `selected_fresh`, `selected_backlog`, `written_fresh` and `written_backlog`, `published`, `review`, `skipped_duplicate` (candidates that matched a written story by link or title), `skipped_repeat` (candidates the scorer flagged as a repeat), `skipped_thin`, `skipped_retry` (candidates left out because an earlier attempt failed: they were already tried today or have used all three attempts), `stories_failed` (refusals, replies that were cut off or invalid, and other SDK errors while writing, and sources that could not be built; each is an attempt), `unavailable` (write requests that got no reply from the API; not attempts), `scoring_failed` (`true` when the scoring call was refused or failed; cached scores are still used), `budget_stopped`, `llm_calls` (usage rows recorded, one per billed attempt), `tokens_today`, `cost_today_usd` and `over_token_target`. Then it prints one line per story written: `<status>  <category>  <English title>`. Exit codes: 0 normally (also after a budget stop), 1 when every source failed, 2 for a missing credential or an invalid cap. Exit code 1 does not mean nothing happened: the agent still runs on the candidates already stored, so it may have written stories and spent money. If an unexpected error stops the run, the run record is closed with an `error` field naming the exception class, and the error is raised.

`--dry-run` collects, makes no model call and prints `would_score` (fresh candidates that would be sent to the scorer), `would_score_backlog` (backlog candidates that would be, if the day fell short of 5), `worst_case_usd` and `cap_usd`. `worst_case_usd` uses the same estimate as the meter: both scoring calls (as if the backlog were needed), plus `--max-stories` writer calls, each sized at the writer prompt plus 6,000 characters of source, 2,000 characters of links and 600 for the rest (the dates line included), and doubled for the fallback. It counts characters of source and links as one byte each, so non-English text can cost more than it shows, and it ignores stories already written today. It is an estimate, not a forecast or a guaranteed maximum. Real cost has not been measured yet.

`radar budget` prints one JSON line for the current Istanbul day: `cap_usd`, `spent_usd`, `left_usd`, `tokens`, `calls` and a `by_step` breakdown.

`radar push` sends finished stories to the admin service (see [admin.md](admin.md)) and prints one JSON line: `pushed`, `duplicates`, `batches`, `rejected` (uids the service refused in this call) and `parked` (stories refused earlier or now, still unsent). A refused story is parked in the database with the field the service named, and later pushes leave it out. Exit code 1 means a story was refused in this call or the push failed; stories parked by earlier runs do not fail it. `radar push --list-refused` prints one line per parked story (uid, time of the refusal, field, Turkish title) and sends nothing; it needs neither the admin URL nor the token. `radar push --retry-refused` sends parked stories again too; one that is accepted, or reported as a duplicate, is no longer parked, and one refused again keeps its place with the new field and time.
`radar daily` runs collect, run and push in one process and then sends a notice by Telegram or e-mail when one is needed; its output, exit codes and notices are in [automation.md](automation.md). `radar state save --file FILE` writes the database as one encrypted file and `radar state load --file FILE` restores it (add `--force` to replace an existing database); both read the passphrase from `RADAR_STATE_KEY`, which must be at least 16 characters (a newline at the end counts as a character). They exit 2 without a usable passphrase and 1 when the file or key is wrong. Both take `--db`, like the other commands.

## What the fetcher accepts

A source response is read up to 5 MB, counted both as the bytes that arrive and as the bytes they decode to; a larger one is refused (by its declared length, or while it is being read) and the source is counted as failed. Only gzip is asked for and accepted as a compression; a response with any other `Content-Encoding` is refused. One fetch, redirects and name lookups included, has 20 seconds; the deadline is checked before each hop, after each lookup, when the headers are in and after every chunk of the body, and a fetch that is still waiting with nothing to check (a name server that does not answer, headers sent a byte at a time) is given up after 35 seconds. The fetcher follows a redirect only when the target is an `http://` or `https://` address that is not obviously internal, and at most 5 times. An address is refused when it is not http(s), when it is `localhost` or a name ending in `.localhost`, `.local` or `.internal`, or when it is an IP address that is not publicly routable (private, loopback, link-local, site-local, NAT64, IPv4-compatible and IPv4-translated IPv6, and similar ranges; numeric shorthand such as `2130706433` is treated as an address). A host name is resolved, in the form the connection will use, before every hop, and refused when it does not resolve or any of its addresses is not publicly routable. The connection resolves it again, so a name whose answer changes between the two lookups (DNS rebinding) is not caught.

Of an article page only the first 300,000 characters are parsed. It is decoded by its byte-order mark, else by its declared charset when that is a real text encoding, else as UTF-8; an unknown or odd charset and a malformed link do not stop anything (the link is skipped). If building the source for a story fails anyway, that story counts as failed and is recorded as an attempt, and the run goes on with the next one. Feeds are parsed with feedparser's HTML sanitiser off (it is quadratic on a hostile feed); every title and summary taken from a feed has all its markup removed by Radar's own linear stripping instead.

## Environment variables

`.env.example` lists them. The `radar` command also reads `agent/.env` when that file exists: copy `.env.example` to `agent/.env` and fill it in. A variable that is already set to a non-empty value in the environment (a shell export, a CI secret) always wins over the file. Blank lines, `#` comments and empty values are skipped; a leading `export ` and one pair of matching quotes around a value are removed. Only `agent/.env` is read, from wherever you start `radar`; a `.env` in the repository root or the current folder is not.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `run`, `daily` | Model credential (other ways are described above) |
| `RADAR_DB_PATH` | all commands | Database path; `--db` overrides it |
| `RADAR_DAILY_CAP_USD` | `run`, `daily`, `budget` | Daily spend cap, default 0.25 |
| `RADAR_ADMIN_URL`, `RADAR_INGEST_TOKEN` | `push`, `daily` | Admin service origin and its ingest token |
| `RADAR_STATE_KEY` | `state` | Passphrase for the saved database: 32 or more random characters, generated (16 is the least accepted; see [automation.md](automation.md#the-state-file)) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `daily` | Telegram notices, on when both are set |
| `RADAR_SMTP_HOST`, `RADAR_SMTP_PORT`, `RADAR_SMTP_USER`, `RADAR_SMTP_PASSWORD`, `RADAR_MAIL_FROM`, `RADAR_MAIL_TO` | `daily` | E-mail notices, on when the host is set; port defaults to 587 |

Secrets are never accepted as command-line flags and never printed.

## Running without publishing

Stories are rows in the local database (`dev-notes/local.db`, or `--db`/`RADAR_DB_PATH`). They stay there until `radar push` (or `radar daily`) sends them to the admin service: `published` ones are then served by its public endpoint, from which the site is built, and `review` ones wait for a person on the review screen; the daily job sends a notice when one is waiting ([admin.md](admin.md), [site.md](site.md), [automation.md](automation.md)). Nothing has been deployed yet and the scheduled job has never run. Delete the database file to start over.
