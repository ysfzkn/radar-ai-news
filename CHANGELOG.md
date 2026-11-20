# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository scaffold, community files and CI.
- The `radar` command reads `agent/.env` on start. A variable already set in the environment wins over the file.

## [0.5.0] - 2026-11-20

### Added

- `radar daily`: collect, run and push in one command, then send a notice by Telegram or e-mail (any SMTP server) when a story waits for review or something needs attention. A notice never contains story text.
- `radar state save` and `radar state load`: the database as one encrypted file (gzip, scrypt-derived key, Fernet), keyed by `RADAR_STATE_KEY` (at least 16 characters).
- Scheduled workflow `.github/workflows/daily.yml`: runs `radar daily` at 04:15 UTC when the repository variable `RADAR_ENABLED` is `true`, and keeps the database between runs on the branch `radar-state`. Written and checked by a test that reads the file; it has never run on GitHub.
- `radar push --list-refused` and `--retry-refused`. A story the admin service refuses is parked at once with the field the service named and is not sent again.
- A source fetcher that reads at most 5 MB per response and follows a redirect only to a public http(s) address, at most 5 hops. Host names are not resolved, so a public name that points at a private address is not caught.
- Admin screen: reasons shown in Turkish where their shape is known, a source link in the action bar, an unsaved-changes notice.
- Site: an edition opens with a masthead (issue, date, number of stories, reading time) and an index of the day's stories; the first story is the lead.
- Documentation: `docs/automation.md`.

### Changed

- Site: stories no longer carry a label. The method page explains that every story is written by a language model and which ones a person reads first. The brand mark is redrawn.
- Admin: when a save meets a newer version, the typed text is kept (for a story still open to that action), the form takes the current version and the message says saving will overwrite the other change.
- Admin: an auto-published story's `published_at` is the moment the admin service received it.

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
