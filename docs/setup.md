# Setup

This page covers running Radar on your own machine. The collector (`radar collect`) needs no API key and no account and makes no model calls. The agent (`radar run`) calls the Anthropic API and needs a key; see [Run the agent](#run-the-agent).

## Prerequisites

- Python 3.12
- [uv](https://docs.astral.sh/uv/)
- Node 22, only for [Review and publish](#review-and-publish)

## Run it

```bash
git clone https://github.com/OWNER/radar.git
cd radar/agent
uv sync
uv run pytest
uv run radar collect --show 10
```

`radar collect` fetches every enabled source in `sources.yaml`, stores new items, groups items about the same story into clusters, and prints one JSON line of run statistics followed by the top candidates (`score  source count  title  url`). It exits 0 when at least one source succeeded and 1 when every source failed. A single failing source never fails the run; it is listed under `failed`.

Running it twice in a row is safe: the second run stores no new items and creates no new clusters.

To test the sources without writing anything to the database:

```bash
uv run radar check-sources
```

It prints one line per source, `<id>: ok <n> items` or `<id>: FAIL <reason>`, and always exits 0. A source that is `ok` with 0 items simply published nothing in the last 72 hours.

## Run the agent

1. Create an Anthropic API key in the Anthropic Console and put it in your environment. Radar reads only the process environment; it does not load a `.env` file (`.env.example` just lists the variable names). Never commit the key:

   ```bash
   export ANTHROPIC_API_KEY=...   # your own key
   ```

2. Preview the cost without spending anything. This collects, makes no model call and prints the number of candidates and a cost estimate (an estimate, not a guaranteed maximum):

   ```bash
   uv run radar run --dry-run
   ```

3. Make the first paid run small:

   ```bash
   uv run radar run --max-stories 2
   uv run radar budget
   ```

A profile saved by the Anthropic CLI login works too; [agent.md](agent.md) lists exactly where Radar looks for a credential. Model calls are capped at $0.25 per Istanbul calendar day (change it with `RADAR_DAILY_CAP_USD`). The meter's prices are a snapshot; check them against Anthropic's pricing page. Stories are written to the local database only; nothing is published. Details: [agent.md](agent.md) and [methodology.md](methodology.md).

## Review and publish

Stories the agent is unsure about wait in a review queue in the admin service (`admin/`, a Cloudflare Worker). `radar push` sends finished stories there; a person edits, approves or rejects them. You can try the whole screen on your machine with demo data, with no account and no paid call. See [admin.md](admin.md).

## Where the data lives

The local database is a SQLite file at `dev-notes/local.db` in the repository root. The folder is created on first run and is git-ignored. Point somewhere else with `--db PATH` or the `RADAR_DB_PATH` environment variable. Delete the file to start over.

## Add a source

Sources are defined only in [`sources.yaml`](../sources.yaml); adding one never needs a code change. Append an entry:

```yaml
  - id: my-source
    name: My Source
    tier: commentary   # primary | community | commentary | turkey
    kind: feed         # feed (RSS or Atom) or hn (Hacker News Algolia search)
    url: https://example.com/feed.xml
    weight: 1.0        # optional
    lang: en           # optional, en or tr
```

Find the feed URL in the site's `<link rel="alternate" type="application/rss+xml">` tag, then run `uv run radar check-sources` and confirm the new line says `ok`. A site with no feed can stay in the file with `enabled: false`.

How sources are tiered and weighted: [sources.md](sources.md).
