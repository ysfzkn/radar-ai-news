# Setup

This page covers running the Radar collector on your own machine. It needs no API key and no account, and it makes no model calls.

## Prerequisites

- Python 3.12
- [uv](https://docs.astral.sh/uv/)

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

It prints one line per source, `ok <n> items` or `FAIL <reason>`, and always exits 0. A source that is `ok` with 0 items simply published nothing in the last 72 hours.

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
