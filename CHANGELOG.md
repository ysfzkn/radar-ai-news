# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository scaffold, community files and CI.

## [0.4.0] - 2026-11-20

### Added

- Public site (`site/`, a static Astro site): numbered daily editions in Turkish and English, archive, topic pages, weekly digest, method page and RSS feeds. No client JavaScript, no cookies, no third-party requests. Without a data source it builds with invented demo data and a banner; if the API cannot be reached the build fails.
- Public read endpoint `GET /api/stories` on the admin service: published stories only, only reader-facing fields, paged with a cursor.
- Optional deploy hook: when the published set changes, the admin service posts to the URL in the `SITE_DEPLOY_HOOK` secret (an `https://` URL). Written from documentation, never run against a real hook.
- Admin lists show 50 stories per page, with next and previous page links.
- Documentation: `docs/site.md`.

### Changed

- "Kaydet ve onayla" saves the edited text and then approves it. If the approval is refused, the edit stays saved and the story stays in review. Approve never saves anything on a story that is not in review.
- The admin screen is light only.
- Admin pages send `Referrer-Policy: same-origin`. With `no-referrer`, browsers sent `Origin: null` on form posts and every click was refused. A `POST` with `Origin: null` is still refused.

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
