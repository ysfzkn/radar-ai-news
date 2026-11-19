# Contributing to Radar

Thanks for helping. There are three ways to contribute, in order of how much they help.

## 1. Suggest a source

Radar reads whatever is listed in `sources.yaml`. To add one, edit that file and open a pull
request, or open a source suggestion issue. See [docs/sources.md](docs/sources.md) for how
sources are tiered and weighted.

## 2. Report a wrong or misleading story

If a published story is wrong, outdated, or misleading, open a bug report and include the story URL.

## 3. Improve the code

Local setup is described in [docs/setup.md](docs/setup.md).

Pull requests must pass `ruff` and `pytest` (run both from `agent/`):

```
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
```

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
(for example `feat: add reddit adapter`, `fix: handle empty feed`).
