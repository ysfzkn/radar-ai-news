# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository scaffold, community files and CI.

## [0.3.0] - 2026-11-20

### Added

- Admin service (`admin/`, a Cloudflare Worker with D1): ingest endpoint, review queue and story screens in Turkish, edit, approve, reject and unpublish, Cloudflare Access sign-in verified by the Worker, hourly expiry of review stories after 72 hours.
- `radar push` sends finished stories to the admin service. A story the admin service refuses is skipped and listed under `rejected` (exit code 1) without holding up the others; it stays unpushed.
- `radar run` reports `unavailable`: write requests that got no reply from the API (connection error, timeout, HTTP error status). They are not counted as attempts, so an outage or a rate limit does not use up a story's retries.
- `npm run seed` loads three invented demo stories into a local server; the local trial needs no account.
- Documentation: `docs/admin.md`.

## [0.2.0] - 2026-11-19

### Added

- `radar run`: scores candidates, writes bilingual (Turkish and English) stories with a fact card, verifies them against the source and routes each one to `published` or `review`. Results are stored locally only.
- `radar run --dry-run` (collect and show the worst-case cost, no model call) and `radar budget` (today's spend per step).
- Hard daily spend cap of $0.25 (override with `RADAR_DAILY_CAP_USD`), per-call usage records and a 30,000-token daily target report.
- Deterministic verifier (length, numbers, names, link) and risk routing.
- Documentation: `docs/agent.md` and `docs/methodology.md`.

## [0.1.0] - 2026-11-19

### Added

- Collector: feed and Hacker News fetchers with per-source failure isolation, URL and text normalization.
- Cross-source story clustering and a candidate prefilter and ranking.
- SQLite store with migrations and run records.
- `radar collect` and `radar check-sources` commands; `sources.yaml` source registry. No LLM calls.
