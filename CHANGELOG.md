# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Sources: the Hacker News front page (`hn-front`, stories with at least 100 points, any subject; the scorer keeps what is about tech and AI). For the per-source limit a story led by Hacker News counts for the site it points to.
- Site: the home page opens with a calm hero of about half a screen: the edition's dateline, the slogan "Her sabah. Kısa ve öz." / "Every morning. Short and to the point.", one line saying what Radar is ("Günün teknoloji ve yapay zekâ haberleri.") and a link to how it works, beside the day's radar. On a phone the radar sits under the words, tipped further back so it is wide and low.
- Site: the home page's toolbar: a search over every story (it opens the archive's search; a link to the archive without script) and topic chips with each topic's count of the day, which show only that topic's stories and grey the radar's other blips without any script. The day's stories follow grouped by topic, each group linking to its topic page, every story keeping its number.
- Site: the navigation is a frequency dial, a tuning scale with the four sections as stations and an accent needle on the current one (pure CSS from `aria-current`; it follows the pointer and the focus and glides between pages with view transitions). On a phone it is fixed to the foot of the window.
- Site: a readout panel beside the scope from 48rem, one row per story (number, bearing, sources, topic, title), linked both ways with its blip; and ghost blips for a thin edition: up to eight stories of the previous seven days, small and faint, linking to their editions.
- Site: the masthead's date and counts settle in like a departure board, once per view; the subscribe label decodes on hover.
- Site: signal bars on each story (1, 2–3, 4+ sources); the horizon follows Istanbul's time (sun and gulls by day, moon and lit windows at night); `ping` in the command palette pulses the scope.
- Site: a livelier horizon, redrawn in three depths with recognisable landmarks (the Süleymaniye with four minarets, the Galata Tower's gallery and cap, the medrese's fluted minarets, the Great Mosque of Divriği with its portal, pyramid caps and stout minaret, Sivas castle's towers and flag): a ferry crosses under the Bosphorus Bridge, the Eastern Express passes behind Sivas now and then, clouds drift, stars come out at night.
- Site: the horizon's landmarks tell their names, without script: pick one (a tap, a click, the arrow keys) and it is drawn in ink with its name small under the ground line, one at a time; nothing is written under the drawing otherwise. Press the radar dish and it sends one ring across the skyline and a Kangal comes to keep watch. Nothing is stored.

### Changed

- Site: no page links GitHub any more. The footer's GitHub and source code links and the Künye page's two GitHub links are gone, the Künye page no longer says the source code is open, and a wrong story is reported through ozkanyusuf.com instead of a GitHub issue.
- Agent: no source leads more than two stories of one day's edition, fresh and backlog together; the places a prolific source would have taken go to the next best stories of other sources. `radar run` reports `skipped_source_limit`.
- Automation: the daily workflow is scheduled for 21:15 UTC (00:15 in Istanbul) instead of 04:15 UTC, so a run that GitHub starts hours late still finishes before morning.
- Site: the scope is drawn as a three-dimensional radar instrument: a body with a wall and a ground shadow, a lit bezel with bearings, a glass face with a gleam, and blips standing on stems above their shadows, the louder the taller. On a phone an edition page's scope may be 352 px wide (it is tipped back, so no taller than before).
- Site: buttons sink into their shadow on press and fill with the accent from the left on hover; the TR / EN switch is a two-position slider; copy buttons turn into a check after copying. The language switch moved to the first row of the top strip.

- Site: the loading screen plays every time the site is entered (a new visit, a link from elsewhere, a reload), not once per browser session, and not when moving between the site's pages. The session key `radar:intro` is gone.
- Site: the pause button is gone ("Hareketi durdur" / "Pause motion", on the scope and in the footer), and with it the session key `radar:still`: the site stores nothing in the browser. The looping motion runs with or without script; the system setting for reduced motion still stops all of it.
- Site: a calmer phone home page: the dateline as a two-part block, the slogan and the "Nasıl çalışır →" link on their own rows, the radar in a band of its own with room above its blips and under its shadow (never edge to edge, its blips still 32 px targets), the readout one centred line under it, the toolbar under a hairline with 40 px chips whose row fades at its far end, more air between groups; a story's label row reads from the left.
- Site: the horizon is always drawn whole (on a phone across the whole window) instead of cropped to its middle.

## [1.0.0] - 2026-11-21

The first public release: the site is live at radar.ozkanyusuf.com, the admin service runs on Cloudflare behind Access, and the daily workflow has run on GitHub.

### Added

- Agent: a 14-day backlog. When a day has fewer than five qualifying fresh stories, it is topped up to five from stories of the last 14 days that Radar never wrote and that still matter, judged by a stricter bar and their own scoring question. The floor is a target: a weak story is not written to reach it.
- Agent: duplicates are checked against every story written in the last 30 days, by link, by title (with the same numbers and versions) and by the scorer.
- Agent: the writer is told when an event was first reported; a story about an older event that does not say when goes to review.
- Agent: `radar daily --review-all` (nothing is published automatically) and `--collect-only` (sources only, no model call); the daily workflow takes them as the `mode` input.
- Admin: a run page ("Çalıştır") that starts the daily workflow on GitHub with a chosen mode and story count, shows the recent runs and keeps a history of starts. It needs the `GITHUB_DISPATCH_TOKEN` secret and stays off without it.
- Admin: a new header, tab bar and status strip.
- Site: a loading screen on the first page of a browser session (about 2.3 seconds, skippable, never with reduced motion), replacing the 1.2-second opening that a real network nearly always skipped.
- Site: a command palette (`Ctrl K` or `/`), `j`/`k` between stories, a shortcut sheet, copy buttons, a status line in the footer, a "no signal" 404 page, page transitions, and Open Graph and Twitter card data with an image.
- Site: the horizon is Istanbul and Sivas on one ground; `/admin` forwards to the review screen.

- Repository scaffold, community files and CI.
- The `radar` command reads `agent/.env` on start. A variable already set in the environment wins over the file.
- Site: a small first-party script (at most 30 000 bytes for all of it, no library, no tracking) that only adds to pages which are complete without it. Archive search over titles, summaries and category names with Turkish folding, topic, month and 3+ source filters kept in the address, matched words marked, an empty state; and a heat strip of the last 26 weeks.
- Site: the scope, a radar of the day's stories on every edition page, and an opening of at most 1.2 seconds, once per browser session (session storage key `radar:intro`), never with reduced motion.
- Site: category emblems (paper cut-outs) on the lead story and the topic pages; the "Neden önemli" line inks in word by word; the end of an edition says "Bugünlük bu kadar." with its reading time; a horizon drawing above every page's footer.
- Site: a pause button for looping motion ("Hareketi durdur" / "Pause motion") on the scope and in the footer, remembered for the browser session (key `radar:still`); without script nothing loops.
- Site: `Strict-Transport-Security` and `Permissions-Policy` headers.

### Changed

- Site: the Künye / About page says what the script does, that search words stay in the browser and the page address (and so in its history) and go to no one else, and the two session keys it keeps, instead of saying the site has no script.

### Fixed

- Site: the click, tap or key that skips the opening no longer follows a link under it.
- Site: the scope's blips are in story order for Tab and screen readers, and their targets are at least 32 px on a phone.
- Site: the archive heat strip is one tab stop (arrow keys move between days) and its lightest squares have 3:1 contrast.
- Site: the "Neden önemli" line is readable before it inks in; a failing scope script no longer stops the opening; the search keeps the archive list when something fails, waits for a pause in typing and links only plain same-site paths.

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
