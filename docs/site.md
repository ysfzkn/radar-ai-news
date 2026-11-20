# The site

`site/` is the public face of Radar: a static website, built with [Astro](https://astro.build), that shows the published stories as numbered daily editions in Turkish and English.

Status: the site builds and runs on your machine, with demo data or against a local admin service. It has never been deployed, and nothing rebuilds it on a schedule yet. The [Deploy](#deploy) section was written from documentation and has not been run.

## What it is, and what it is not

- It is static files. After the build there is no server code.
- It has no JavaScript at all, no cookies, and makes no request to any third party. Fonts are served from the site itself: body text uses the reader's system font, and headings use one self-hosted font (Bricolage Grotesque).
- It holds no secret and cannot change anything. All it knows is what the admin service's public endpoint returned at build time.
- It does not promise a publishing hour. A story appears when the site is next built after the story was published.
- It has no page for a single story, no search, no e-mail subscription and no images. A story's permanent link is an anchor on its edition page, for example `/2026-11-20/#s-1a2b3c4d` (the anchor is `s-` plus the first 8 characters of the story's uid).
- It is light only. There is no dark theme and no theme switch.

## Where the data comes from

At build time the site reads published stories from the admin service's public endpoint, `GET /api/stories`. The endpoint needs no sign-in. It returns only stories whose status is `published`, and only the fields a reader sees. It never returns the reasons the agent gave, the score, the fact card, the history of decisions, or any e-mail address.

### The public read contract (version 1)

```
GET /api/stories?limit=<1..200, default 100>&cursor=<opaque>
```

Response, `200`:

```json
{
  "version": 1,
  "stories": [
    {
      "uid": "32 lowercase hex characters",
      "category": "tooling",
      "publish_mode": "auto",
      "edited": false,
      "source_count": 3,
      "source_url": "https://example.com/post",
      "sources": [{"name": "Example Blog", "url": "https://example.com/blog/post"}],
      "try_url": "https://example.com/try",
      "created_at": "2026-11-20T00:15:44.893Z",
      "published_at": "2026-11-20T00:15:44.893Z",
      "texts": {
        "tr": {"title": "...", "summary": "...", "dev_line": "..."},
        "en": {"title": "...", "summary": "...", "dev_line": "..."}
      }
    }
  ],
  "next": null
}
```

- `publish_mode` is `auto` when the agent published the story and `human` when a person approved it. `edited` is true when a person changed the text.
- `texts` holds `tr`, `en` or both. Text is trimmed. A language whose title, summary or developer line is empty after trimming is left out, and a story with no usable language is not returned at all, so a page may hold fewer than `limit` stories.
- `source_count` is a whole number and may be `0`.
- `sources` lists only entries with a non-empty name (trimmed) and an `http:` or `https:` link; sources without a name are left out. `try_url` is `null` unless it is an `http:` or `https:` link.
- Stories come newest `published_at` first, then by `uid`. `next` is an opaque cursor for the following page, or `null` after the last page. Pass it back unchanged as `cursor`.
- A `limit` outside 1 to 200 (or not a whole number) and a malformed `cursor` give `400` with `{"error": "invalid"}`.
- Responses carry `Cache-Control: public, max-age=60`.

The site reads every page with `limit=200`, follows `next` until it is `null`, and validates each story. Anything that does not match the contract stops the build.

## Editions, numbers and the weekly digest

- An **edition** is the set of stories whose `published_at` falls on one calendar day in Istanbul (UTC+3, all year). A day with no stories has no edition.
- **Numbers** count the days that have an edition, oldest first: the oldest edition is number 1. A page's address uses the date, never the number. If a story is taken down and its day becomes empty, the later numbers shift down by one, but no link breaks.
- Inside an edition **every published story of the day is shown**, ordered by number of sources (most first), then by publish time. The site never hides a published story.
- The **weekly digest** is the ten stories of one ISO week (Monday to Sunday, Istanbul days) with the most sources, ordered the same way. No model is involved.
- A **topic page** lists one category's newest 30 stories.
- A story with only one language available appears only on that language's pages.

## Pages

| Turkish | English | What it shows |
| --- | --- | --- |
| `/` | `/en/` | The newest edition |
| `/YYYY-MM-DD/` | `/en/YYYY-MM-DD/` | One edition |
| `/arsiv/` | `/en/archive/` | All editions |
| `/konu/<category>/` | `/en/topic/<category>/` | A category's newest 30 stories |
| `/hafta/` | `/en/week/` | The weekly digests |
| `/hafta/YYYY-Www/` | `/en/week/YYYY-Www/` | One weekly digest |
| `/yontem/` | `/en/method/` | How stories are collected, written and checked |
| `/rss.xml` | `/en/rss.xml` | RSS feed, newest 50 stories |

The build also writes `sitemap-index.xml` and `404.html`. Site copy, in both languages, lives in `site/src/lib/copy.ts`.

## Run it locally

You need Node 22 and no account. Nothing here calls a paid API.

### With demo data

```bash
cd site
npm ci
npm run dev                  # serves http://localhost:4321
```

Without `RADAR_API_URL` and without a fetched data file, the site uses invented demo stories from `site/fixtures/stories.json` and shows a "demo data" banner on every page. A demo build also marks every page `noindex` for search engines, and its two RSS feeds carry no items: the feed title starts with "Demo data" ("Örnek veri" in Turkish) and the feed description is the banner's sentence, so invented stories never reach a feed reader. To build static files into `site/dist/`: `npm run build`. To look at them: `npx astro preview`.

### Against a local admin service

Start the admin service as described in [admin.md](admin.md) (`npm run db:migrate:local`, `npm run dev`, `npm run seed`) and approve a story. Then, in `site/`, bash:

```bash
cd site
RADAR_API_URL=http://localhost:8787 npm run build:live
npx astro preview            # serves http://localhost:4321
```

PowerShell:

```powershell
cd site
$env:RADAR_API_URL = "http://localhost:8787"
npm run build:live
npx astro preview
```

`build:live` runs `npm run fetch` (which downloads every published story into `site/.data/stories.json`) and then the build. No banner is shown. `RADAR_API_URL` must be an `https://` address; `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. The fetch does not follow redirects.

Things to know:

- A plain `npm run build` or `npm run dev` also uses `site/.data/stories.json` if it exists. To go back to demo data, delete the `site/.data/` folder. The site's own tests refuse to run while that folder exists, so they cannot quietly build real data.
- `RADAR_STORIES_FILE` can point at any file in the same shape (`{"stories": [...]}`); it takes priority over the other two sources.
- If the API cannot be reached or answers something invalid, the fetch exits with an error and the build does not start. The site never builds from half the data. A `site/.data/stories.json` left by an earlier successful fetch stays in place, though, so delete it if you do not want a later plain build to use it.

Checks: `npm run check` (types), `npm test` and `npm run build` in `site/`.

## Deploy

These steps were written from documentation and have not been run. The Worker and the site have never been deployed. Nothing rebuilds the site on a schedule yet. Expect to adjust them.

1. Deploy the admin service first ([admin.md](admin.md#deploy)) so that `https://<worker-host>/api/stories` answers.
2. Pick any static host that can run a Node build. In `site/`, the build command is `npm ci && npm run build:live` and the output folder is `dist`. Set two build variables: `RADAR_API_URL` (the Worker's origin, `https://...`) and `SITE_URL` (the address the site will have, for example `https://radar.example.com`). `SITE_URL` is used for the sitemap and the feed links; without it the build uses the project owner's address, `https://radar.ozkanyusuf.com`.
3. `site/public/_headers` sets the security headers (a strict Content-Security-Policy, `nosniff`, `X-Frame-Options: DENY` and a referrer policy). The file uses Cloudflare Pages syntax. Other hosts ignore it and need the same headers set in their own configuration. It has not been checked on a real host.
4. `site/public/robots.txt` names the sitemap at the project owner's address. Edit it if the site lives elsewhere.
5. Optional: let the Worker rebuild the site when the published set changes. Create a deploy hook at your host (a URL that starts a build when it receives a `POST`), then give it to the Worker as a secret: `npx wrangler secret put SITE_DEPLOY_HOOK`. The Worker then posts to it after a story is approved, unpublished, edited while published, or ingested as already published. It only uses an `https://` URL, never logs it, and ignores a failed call. This has never been run against a real hook.

Until a schedule or hook is in place, the site shows what was published at its last build.
