# The agent

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
- **Calls** when a new cluster appears (it is scored), when the scorer left a candidate out of its reply (it is sent again), and when an eligible cluster has no story yet. That includes stories that failed, were refused or had a thin source on an earlier run: they leave no record and are tried again on the next run.

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
```

`radar run` needs an Anthropic credential, found the way the Anthropic SDK finds it: the environment variable `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`; the workload identity variables (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID` and `ANTHROPIC_IDENTITY_TOKEN` or `ANTHROPIC_IDENTITY_TOKEN_FILE`); or a profile stored by the Anthropic CLI login, that is the file `configs/<profile>.json` in the SDK's config directory. That directory is `ANTHROPIC_CONFIG_DIR` if set, otherwise `%APPDATA%\Anthropic` on Windows and `~/.config/anthropic` elsewhere; the profile is `ANTHROPIC_PROFILE`, else the name in the `active_config` file there, else `default`. An empty directory does not count. Without a credential it prints a message and exits 2 before collecting. The key is read only by the SDK; Radar never stores or logs it.

`radar run` prints one JSON line: the collector's statistics (where `failed` lists the failed source ids) plus `scored`, `selected`, `written`, `published`, `review`, `skipped_thin`, `stories_failed` (refusals and API errors while writing), `scoring_failed` (`true` when the scoring call was refused or failed; cached scores are still used), `budget_stopped`, `llm_calls` (usage rows recorded, one per billed attempt), `tokens_today`, `cost_today_usd` and `over_token_target`. Then it prints one line per story written: `<status>  <category>  <English title>`. Exit codes: 0 normally (also after a budget stop), 1 when every source failed, 2 for a missing credential or an invalid cap. Exit code 1 does not mean nothing happened: the agent still runs on the candidates already stored, so it may have written stories and spent money. If an unexpected error stops the run, the run record is closed with an `error` field naming the exception class, and the error is raised.

`--dry-run` collects, makes no model call and prints `would_score` (candidates that would be sent to the scorer), `worst_case_usd` and `cap_usd`. `worst_case_usd` uses the same estimate as the meter: scoring the candidates, plus `--max-stories` writer calls, each sized at the writer prompt plus 6,000 characters of source, 2,000 characters of links and 300 for the rest, and doubled for the fallback. It counts characters of source and links as one byte each, so non-English text can cost more than it shows, and it ignores stories already written today. It is an estimate, not a forecast or a guaranteed maximum. Real cost has not been measured yet.

`radar budget` prints one JSON line for the current Istanbul day: `cap_usd`, `spent_usd`, `left_usd`, `tokens`, `calls` and a `by_step` breakdown.

## Running without publishing

Stories are rows in the local database (`dev-notes/local.db`, or `--db`/`RADAR_DB_PATH`). `published` and `review` are only status values; no website, feed or message is produced by this version. Delete the database file to start over.
