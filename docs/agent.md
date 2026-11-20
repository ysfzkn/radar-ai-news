# The agent

The daily job on GitHub Actions, its notices and its saved state are described in [automation.md](automation.md). This page covers the agent itself.

`radar run` turns the collector's candidates into stories: it scores them, writes the best ones in Turkish and English, checks the text against its source and decides whether a human must look at it. Everything lands in the local SQLite database. Nothing is published anywhere.

## The seven steps

| # | Step | Model call? |
| --- | --- | --- |
| 1 | Collect: fetch every source, store new items | no |
| 2 | Cluster items about the same story and rank candidates | no |
| 3 | Score each new candidate: relevance, novelty, usefulness, category, risk flags | yes, one batched call (`claude-haiku-5-5`) |
| 4 | Select: apply the thresholds in [methodology.md](methodology.md) and keep at most `--max-stories` (default 8) per Istanbul calendar day, counting stories already written that day | no |
| 5 | Build the source document: the primary article's text and links plus the feed title and summary of every item in the cluster (community tier included), at most 6,000 characters of text and 2,000 characters of links. A source under 200 characters is "thin" and is skipped without a model call | no |
| 6 | Write: a fact card plus a title, summary and developer line in Turkish and English | yes, one call per story (`claude-sonnet-5-5`) |
| 7 | Verify and route: deterministic checks, then `published` or `review` | no |

Scores are cached per cluster, and a cluster that already has a story is never processed again. The edition is per Istanbul calendar day: once `--max-stories` stories have been written that day, a later run that day scores nothing and writes nothing.

When a later run makes model calls and when it does not:

- **No calls** when the day's edition is full, or when nothing new is eligible and nothing failed before: every candidate already has a score, and every eligible cluster already has a story.
- **Calls** when a new cluster appears (it is scored), when the scorer left a candidate out of its reply (it is sent again), and when an eligible cluster has no story yet. That includes stories that failed, were refused or had a thin source on an earlier run. Each of those is recorded as an attempt: the cluster is not tried again the same Istanbul day, and after three attempts it is dropped. A write request that got no reply from the API (a connection error, a timeout or an HTTP error status such as a rate limit or an outage) costs nothing and is not an attempt: the cluster is tried again on the next run.

> **Status when this page was written:** the agent was tested only with scripted fake model replies. No paid run against the real API had been made, so real token counts and costs are not yet known.

## Two models

- `claude-haiku-5-5` scores. Scoring is a short, structured judgement over many items, so the cheapest model is enough.
- `claude-sonnet-5-5` writes. The writer must stay faithful to a source and produce natural Turkish, which is worth the higher price, and it is called only for the few stories that pass selection.

Source text is untrusted: the article text is passed inside `<source>` tags and the links inside `<links>` tags, the prompt tells the model to ignore instructions found in either, and nothing in them is executed or followed. A closing tag inside the data, in any letter case or spacing, is escaped so it cannot end the block early. Links containing whitespace or longer than 200 characters are dropped.

The writer runs with a server-side fallback pinned to `claude-sonnet-5` (priced like `claude-sonnet-5-5` in the meter): if `claude-sonnet-5-5` declines, the request is retried on `claude-sonnet-5`. Both attempts can be billed, and each is recorded as its own usage row.

## The budget

- **Hard daily cap: $0.25**, counted per calendar day in Istanbul time (UTC+3). Override with the environment variable `RADAR_DAILY_CAP_USD` (a positive number; an invalid value makes `radar run` and `radar budget` exit with code 2).
- **Estimate before every request.** Before every request the meter estimates its cost: input tokens estimated as one token per two bytes of UTF-8 text plus 1,000, at the model's input price, plus the full `max_tokens` at its output price. When a fallback is allowed (the writer), the estimate is doubled, because a declined attempt and the fallback attempt can both be billed. If today's spend plus that estimate is above the cap, the request is not sent. This is an estimate, not a guaranteed maximum: the real token count is known only after the call.
- **When the cap is hit.** The run stops cleanly. Stories already written are kept, the run record gets `budget_stopped: true`, and the command still exits 0.
- **Token target.** 30,000 tokens a day is a design target. It is reported (`tokens_today`, `over_token_target`) but not enforced.
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

`radar run` prints one JSON line: the collector's statistics (where `failed` lists the failed source ids) plus `scored`, `selected`, `written`, `published`, `review`, `skipped_thin`, `skipped_retry` (candidates left out because an earlier attempt failed: they were already tried today or have used all three attempts), `stories_failed` (refusals, replies that were cut off or invalid, and other SDK errors while writing; each is an attempt), `unavailable` (write requests that got no reply from the API; not attempts), `scoring_failed` (`true` when the scoring call was refused or failed; cached scores are still used), `budget_stopped`, `llm_calls` (usage rows recorded, one per billed attempt), `tokens_today`, `cost_today_usd` and `over_token_target`. Then it prints one line per story written: `<status>  <category>  <English title>`. Exit codes: 0 normally (also after a budget stop), 1 when every source failed, 2 for a missing credential or an invalid cap. Exit code 1 does not mean nothing happened: the agent still runs on the candidates already stored, so it may have written stories and spent money. If an unexpected error stops the run, the run record is closed with an `error` field naming the exception class, and the error is raised.

`--dry-run` collects, makes no model call and prints `would_score` (candidates that would be sent to the scorer), `worst_case_usd` and `cap_usd`. `worst_case_usd` uses the same estimate as the meter: scoring the candidates, plus `--max-stories` writer calls, each sized at the writer prompt plus 6,000 characters of source, 2,000 characters of links and 300 for the rest, and doubled for the fallback. It counts characters of source and links as one byte each, so non-English text can cost more than it shows, and it ignores stories already written today. It is an estimate, not a forecast or a guaranteed maximum. Real cost has not been measured yet.

`radar budget` prints one JSON line for the current Istanbul day: `cap_usd`, `spent_usd`, `left_usd`, `tokens`, `calls` and a `by_step` breakdown.

`radar push` sends finished stories to the admin service (see [admin.md](admin.md)) and prints one JSON line: `pushed`, `duplicates`, `batches`, `rejected` (uids the service refused in this call) and `parked` (stories refused earlier or now, still unsent). A refused story is parked in the database with the field the service named, and later pushes leave it out. Exit code 1 means a story was refused in this call or the push failed; stories parked by earlier runs do not fail it. `radar push --list-refused` prints one line per parked story (uid, time of the refusal, field, Turkish title) and sends nothing; it needs neither the admin URL nor the token. `radar push --retry-refused` sends parked stories again too; one that is accepted, or reported as a duplicate, is no longer parked, and one refused again keeps its place with the new field and time.
`radar daily` runs collect, run and push in one process and then sends a notice by Telegram or e-mail when one is needed; its output, exit codes and notices are in [automation.md](automation.md). `radar state save --file FILE` writes the database as one encrypted file and `radar state load --file FILE` restores it (add `--force` to replace an existing database); both read the passphrase from `RADAR_STATE_KEY`, which must be at least 16 characters (a newline at the end counts as a character). They exit 2 without a usable passphrase and 1 when the file or key is wrong. Both take `--db`, like the other commands.

## What the fetcher accepts

A source response is read up to 5 MB; a larger one is refused (by its declared length, or while it is being read) and the source is counted as failed. The fetcher follows a redirect only when the target is an `http://` or `https://` address that is not obviously internal, and at most 5 times. An address is refused when it is not http(s), when it is `localhost` or a name ending in `.localhost`, `.local` or `.internal`, or when it is an IP address that is not publicly routable (private, loopback, link-local and similar ranges; numeric shorthand such as `2130706433` is treated as an address). Host names are not resolved: a public-looking name whose DNS record points at a private address is not caught by this check.

## Environment variables

`.env.example` lists them. The `radar` command also reads `agent/.env` when that file exists: copy `.env.example` to `agent/.env` and fill it in. A variable that is already set to a non-empty value in the environment (a shell export, a CI secret) always wins over the file. Blank lines, `#` comments and empty values are skipped; a leading `export ` and one pair of matching quotes around a value are removed. Only `agent/.env` is read, from wherever you start `radar`; a `.env` in the repository root or the current folder is not.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `run`, `daily` | Model credential (other ways are described above) |
| `RADAR_DB_PATH` | all commands | Database path; `--db` overrides it |
| `RADAR_DAILY_CAP_USD` | `run`, `daily`, `budget` | Daily spend cap, default 0.25 |
| `RADAR_ADMIN_URL`, `RADAR_INGEST_TOKEN` | `push`, `daily` | Admin service origin and its ingest token |
| `RADAR_STATE_KEY` | `state` | Passphrase for the saved database, 16 characters or more |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `daily` | Telegram notices, on when both are set |
| `RADAR_SMTP_HOST`, `RADAR_SMTP_PORT`, `RADAR_SMTP_USER`, `RADAR_SMTP_PASSWORD`, `RADAR_MAIL_FROM`, `RADAR_MAIL_TO` | `daily` | E-mail notices, on when the host is set; port defaults to 587 |

Secrets are never accepted as command-line flags and never printed.

## Running without publishing

Stories are rows in the local database (`dev-notes/local.db`, or `--db`/`RADAR_DB_PATH`). They stay there until `radar push` (or `radar daily`) sends them to the admin service: `published` ones are then served by its public endpoint, from which the site is built, and `review` ones wait for a person on the review screen; the daily job sends a notice when one is waiting ([admin.md](admin.md), [site.md](site.md), [automation.md](automation.md)). Nothing has been deployed yet and the scheduled job has never run. Delete the database file to start over.
