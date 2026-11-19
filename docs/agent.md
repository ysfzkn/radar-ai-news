# The agent

`radar run` turns the collector's candidates into stories: it scores them, writes the best ones in Turkish and English, checks the text against its source and decides whether a human must look at it. Everything lands in the local SQLite database. Nothing is published anywhere.

## The seven steps

| # | Step | Model call? |
| --- | --- | --- |
| 1 | Collect: fetch every source, store new items | no |
| 2 | Cluster items about the same story and rank candidates | no |
| 3 | Score each new candidate: relevance, novelty, usefulness, category, risk flags | yes, one batched call (`claude-haiku-5-5`) |
| 4 | Select: apply the thresholds in [methodology.md](methodology.md) and keep at most `--max-stories` (default 8) | no |
| 5 | Build the source document: the primary article's text and links plus the cluster's feed text, at most 6,000 characters. A source under 200 characters is "thin" and is skipped without a model call | no |
| 6 | Write: a fact card plus a title, summary and developer line in Turkish and English | yes, one call per story (`claude-sonnet-5-5`) |
| 7 | Verify and route: deterministic checks, then `published` or `review` | no |

Scores are cached per cluster, and a cluster that already has a story is never processed again. A second `radar run` with unchanged feeds therefore makes zero model calls.

> **Status when this page was written:** the agent was tested only with scripted fake model replies. No paid run against the real API had been made, so real token counts and costs are not yet known.

## Two models

- `claude-haiku-5-5` scores. Scoring is a short, structured judgement over many items, so the cheapest model is enough.
- `claude-sonnet-5-5` writes. The writer must stay faithful to a source and produce natural Turkish, which is worth the higher price, and it is called only for the few stories that pass selection.

Source text is untrusted: it is passed inside `<source>` tags, the prompt tells the model to ignore instructions found there, and nothing in it is executed or followed.

## The budget

- **Hard daily cap: $0.25**, counted per calendar day in Istanbul time (UTC+3). Override with the environment variable `RADAR_DAILY_CAP_USD` (a positive number; an invalid value makes `radar run` and `radar budget` exit with code 2).
- **Worst case.** Before every request the meter computes the most it could cost: the input size (estimated pessimistically as one token per two characters) at the model's input price plus the full `max_tokens` at its output price. If today's spend plus that worst case is above the cap, the request is not sent.
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

`radar run` needs an Anthropic credential: the environment variable `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`), or a login stored by the Anthropic CLI. Without one it prints a message and exits 2 before collecting. The key is read only by the SDK from the environment; Radar never stores or logs it.

`radar run` prints one JSON line: the collector's statistics plus `scored`, `selected`, `written`, `published`, `review`, `skipped_thin`, `failed` (refusals and API errors), `budget_stopped`, `llm_calls`, `tokens_today`, `cost_today_usd` and `over_token_target`. Then it prints one line per story written: `<status>  <category>  <English title>`. Exit codes: 0 normally (also after a budget stop), 1 when every source failed, 2 for a missing credential or an invalid cap.

`--dry-run` collects, makes no model call and prints `would_score` (candidates that would be sent to the scorer), `worst_case_usd` (scoring them plus `--max-stories` writer calls at full source length) and `cap_usd`. That figure is a ceiling, not a forecast; real runs cost a small fraction of it.

`radar budget` prints one JSON line for the current Istanbul day: `cap_usd`, `spent_usd`, `left_usd`, `tokens`, `calls` and a `by_step` breakdown.

## Running without publishing

Stories are rows in the local database (`dev-notes/local.db`, or `--db`/`RADAR_DB_PATH`). `published` and `review` are only status values; no website, feed or message is produced by this version. Delete the database file to start over.
