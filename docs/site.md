# The site

`site/` is the public face of Radar: a static website, built with [Astro](https://astro.build), that shows the day's tech and AI news as numbered daily editions in Turkish and English. It is Yusuf Özkan's personal project: the top strip shows `ozkanyusuf.com` beside the wordmark, and the footer signs it with links to his site and GitHub account.

Status: the site builds and runs on your machine, with demo data or against a local admin service. The project's own site is live at [radar.ozkanyusuf.com](https://radar.ozkanyusuf.com) since 2026-11-21, on Cloudflare Pages. Nothing rebuilds it on a timer, and none is needed: the admin service's deploy hook rebuilds it when the published set changes (seen working on the first approved stories), and no page depends on the build's clock (the footer's horizon reads the reader's own clock in the browser, below). The [Deploy](#deploy) section says how it was set up.

## What it is, and what it is not

- It is static files. After the build there is no server code.
- It sets no cookies, does no tracking and makes no request to any third party. Links that leave the site (sources, the try button, the owner's site) open in a new tab. The site links neither the owner's GitHub account nor Radar's repository. Fonts are served from the site itself: body text uses the reader's system font, and headings use one self-hosted font (Bricolage Grotesque).
- Every page is complete without JavaScript. The site's own small script (all of it together at most 30 000 bytes, no library, loaded from the site itself) only adds to a page:
  - `boot.js`, first in every page's head, marks the page as scripted and decides whether this page opens with the loading screen (below). It stores nothing.
  - On every page: the command palette and keyboard shortcuts. `Ctrl K` or `⌘K` (anywhere), or `/` (outside a field), opens a palette listing the site's pages (today, archive, week, the eight topics, Künye / About, subscribe, the RSS feed, the other language) and, as the reader types, the stories of that language from `/search-tr.json` or `/search-en.json`, fetched from the site on first use. Arrow keys move, Enter opens, Esc closes. `j` / `k` go to the next and the previous story, `[` / `]` to the previous and the next issue or week, `?` opens the list of shortcuts. These keys do nothing while the reader types in a field or holds Ctrl, ⌘ or Alt. A small button in the top strip (from 40em, with script only) shows the key and opens the palette on a click.
  - Copy buttons: after the feed command on the subscribe page, and a "bağlantı" / "link" button in each story's label row that copies the story's address. They write to the clipboard only when pressed; for a moment after, the mark turns into a check (✓) and the label reads "Kopyalandı" / "Copied".
  - Typing `ping` in the palette and pressing Enter closes it and makes the scope (on a page without one, the brand mark) pulse once.
  - The departure board (`scripts/board.ts`): an edition's big date and the masthead's counts (stories, sources, minutes) settle in once per page view when first in view, after the loading screen: each character flips through three glyphs and lands, left to right, in about half a second. The subscribe button's label decodes the same way while a mouse comes onto it. The text is in the page from the start; while it flips, the element holds the real text for assistive tech (visually hidden) and the flipping glyphs hidden from it, each in a cell as wide as its real character, so nothing moves. Never with reduced motion.
  - The horizon's hours (`scripts/sky.ts`): from 19:00 to 06:00 Istanbul time (UTC+3, worked out from the reader's clock; nothing is fetched) the page gets the class `night`: the horizon shows a moon and stars instead of the sun and the gulls, and its windows, the ferry's, the train's and the Maiden's Tower's lamp lit in the accent. Without script it shows the day.
  - On the archive: the search. Its data, `/search-tr.json` or `/search-en.json`, is fetched from the site on first use. What the reader types stays in the browser and in the page's address (`?q=…`), so it is also in the browser history; when the reader reloads the page or clicks a result, that address goes to this site only, never to anyone else. Typing searches after a pause of 150 ms, and a query counts at most 10 words. The heat strip is one tab stop; with script the arrow keys, Home and End move between its days.
  - On the home page: the search field under the hero takes the words typed into it to the archive's search (`/arsiv/?q=…` / `/en/archive/?q=…`), which runs them there; it is revealed by script, so without script the field stays hidden and a link to the archive stands in its place. After the loading screen the hero's words and its radar rise into place once (`scripts/scope.ts` adds the class when the loading screen's cover lifts); without the loading screen they are simply there.
  - On an edition page and on the home page: the scope's pointer tilt and the hollow blip of a story read for two seconds; the "Neden önemli" / "Why it matters" line inking in word by word the first time it is seen; and the end of the edition switching off like a screen.
  - The loading screen plays every time the site is entered (a new visit, a typed address, a link from elsewhere, a reload), on whichever page that is, and not when the reader moves between the site's pages (the referrer is the site itself); nothing is stored for it: `boot.js` paints the page ink before the first paint, then `scripts/intro.ts` draws a scope on a canvas for about 2.3 seconds, counted from when that script starts: three range rings with the page's headlines running round them as glyphs (on a page without headlines, its description), a sweep that lights each glyph and each story's blip as it passes, a counter from 000 to 100 with a status line ("SİNYAL ARANIYOR" … "HAZIR" / "ACQUIRING SIGNAL" … "READY"), then the rings close into the mark `)))` with the issue under it, and an iris opens from the mark while the mark flies to its place beside the wordmark. Whatever happens, `boot.js` removes it 3.5 seconds after the page started (and without script the ink cover clears itself at 3.5 seconds). It is skipped on back/forward, in a hidden tab, on any click or key press, and when the reader asks for reduced motion; the click, tap or key that skips it is consumed, so it never follows a link the loading screen covered. Headlines reach only the canvas, never the page.
  - There is no pause button: the looping motion (the sweep, the blip echoes and the changing readout, the horizon's slow life) runs with or without script, and the reader's system setting for reduced motion is what stops it.
  - The site stores nothing in the browser: no `localStorage`, no `sessionStorage`, no cookie.
  - Story text reaches the page from a script only as text, never as markup. The Content-Security-Policy in `site/public/_headers` allows scripts, styles, fonts, images and requests from the site's own origin only.
- It holds no secret and cannot change anything. All it knows is what the admin service's public endpoint returned at build time.
- It does not promise a publishing hour. A story appears when the site is next built after the story was published.
- A story carries **no label** saying whether a person read it. The Künye page (About in English; see [Pages](#pages)) explains that every story is written by a language model, and which kinds of story a person reads before they are published.
- The subscribe page can carry the e-mail newsletter's form: one plain HTML form (an address, the page's language, a hidden trap field) that posts to the admin Worker, which stores the address and mails a confirmation link (see [admin.md](admin.md#the-e-mail-newsletter)). It is behind a switch, `OPEN_BY_DEFAULT` in `site/src/lib/newsletter.ts`, which is on since 2026-11-23. With the switch off the page is RSS only and says there is no newsletter; with it on, the page opens with the form, the Künye's privacy section gains a paragraph on what is stored, and the Worker's answer comes back as `#mail-sent`, `#mail-invalid`, `#mail-later`, `#mail-error` or `#mail-closed` at the end of the page's address: the notice with that id is shown with `:target`, without script, and the loading screen does not play for a reader coming back this way. The CSP's `form-action` names the site itself and the Worker's origin for this (the Worker answers the form with a redirect back to the site, which a browser also checks against `form-action`). `RADAR_NEWSLETTER=1` or `=0` sets the switch for one build; the tests build both states, the open one into `site/dist-newsletter/`.
- It has no page for a single story and no images in its pages. The one picture is the share card, `site/public/og.png` (1200 × 630: the scope, the mark and the address), named by the Open Graph and Twitter card tags every page carries (title, description, address, type and the card). It is drawn by `node site/scripts/og-image.mjs` with Node alone (no dependency) and kept in the repository; run the script again after changing the drawing. "Subscribe free" means the RSS feed: the subscribe page shows the feed address and asks for nothing. A story's permanent link is an anchor on its edition page, for example `/2026-11-20/#s-1a2b3c4d` (the anchor is `s-` plus the first 8 characters of the story's uid).
- It is light only. There is no dark theme and no theme switch.
- Each category has its own colour, used for the story's category tag, its number, the bar beside a story opened from a link, the heading of its topic page and the category text in a topic page's list; the brand red stays for the mark, the issue label, the echo meter and link underlines. Security uses a wine red, so it does not read as the brand red. The lead story of an edition sits in a card with a hard shadow, and so do the two buttons (subscribe, try it); inside the lead card the try button is flat. A button lifts a pixel on hover while the accent wipes in from the left under a white label (5.5:1), and a press sinks it into its shadow (it moves by the shadow's 3 px and the shadow goes) before it comes back.
- Every page has a TR / EN control in the top strip: the current language is marked, and the other links to the same page in that language, or to that language's home page when the page has no counterpart. It is drawn as a two-position slider: an ink thumb lies under the current language, nudges towards the other one under the pointer, and slides across between the two languages' pages.
- The navigation is a **dial** (`Masthead.astro`): a receiver's tuning scale under the top strip, a fine ruler of ticks (an SVG drawing) with the four sections, Bugün · Arşiv · Hafta · Künye, as its stations and one accent needle on the current station. It is a real `<nav>` of four links. The page itself carries `aria-current="page"`; a page under a station carries `aria-current="true"` on it (`lib/nav.ts`): the newest edition's own address is under today, an older edition and a topic under the archive, a week under the weeks; the subscribe page and the 404 page are on no station and show no needle. Where the needle rests is CSS from `aria-current` alone; a pointer or the focus on a station moves it there and it returns when they leave. Between pages it glides to its new station (it has its own `view-transition-name`); without view transitions it is simply in place. Below 40em the dial is fixed to the foot of the window, full width, each station a 44 px target, with the safe-area inset under it and room left under the footer; the top strip then keeps the wordmark, the language switch and the subscribe button.
- Each story's label row ends with its echo meter and three **signal bars**: one lit for one source, two for 2–3, three for 4 or more, named "Sinyal: zayıf / orta / güçlü" ("Signal: weak / fair / strong").
- Each story's number is its permanent link: it points at the story's anchor on its edition page, and a story opened from such a link is marked with a bar in its category colour.
- When printed, a page is one plain column of ink on white: the navigation, banner, scope, search, pager, horizon and footer are left out (an edition prints its plain index instead of the scope, and an archive printed mid-search prints its full list), every animation is off, and the address of each source and try link is printed after it.
- Each category has an emblem, a small paper cut-out in its colours (linked nodes, stacked layers, a scaffold, a gear and spanner, a flask, a padlock, a workshop with a chimney, a sealed document). It stands on the lead story's card at 56 px and opens the topic page at 96 px; its sheets lift slightly off their shadows as it scrolls into view. It is decoration: the category's name is always written beside it.
- Every page's footer ends with a status line, as from a terminal: `$ radar status`, then the newest edition's number and date, the number of stories in that language and the number of distinct source sites, counted at build (`site/src/lib/status.ts`).
- An empty state (no edition yet, a topic or week with no stories) is a dashed frame with a comment's `//` in the label face. The 404 page shows an empty scope with a flat trace under "Sinyal yok / No signal", in both languages, with links home, to the archives and to the weeks.
- Moving between pages of the site, the new page is scanned in from the top over the old one (a CSS cross-document view transition, about a third of a second; the top strip stays in place). Browsers without view transitions simply load the page, and readers who ask for reduced motion get no transition.
- Every page ends with a horizon over the footer (`Horizon.astro`): a line drawing of two cities on one ground, 640 × 112, always shown whole (1:1 in the reading column, across the whole window on a phone), in three depths: far and thin, the Bosphorus Bridge, the old city's hills and Sivas's castle hill with its towers and a flag in the accent; in the middle, the Maiden's Tower on its rock, the Süleymaniye with its four minarets and cascading domes, the Galata Tower, plain roofs whose tallest carries a small radar dish that turns, the Çifte Minareli Medrese's portal between its two fluted minarets, and poplars; near and a little heavier, the water and the ground. Buildings are filled with the page's colour, so what stands in front hides what stands behind. Its slow motions, all CSS: the dish turns, three gulls glide, a ferry crosses under the bridge and turns back, the Eastern Express (Doğu Ekspresi) passes behind Sivas about once every 75 seconds, two clouds drift. In the evening and at night (with script) a moon and stars, no gulls, and lit windows. The drawing is hidden from assistive tech and left out of print.
- The horizon's names: nothing is written under the drawing. Its seven landmarks (Boğaz Köprüsü, Kız Kulesi, Süleymaniye Camii, Galata Kulesi, Çifte Minareli Medrese, Divriği Ulu Camii, Sivas Kalesi) are each a visually hidden radio button with a 36 px label laid over the landmark, named by it for assistive tech. A tap, a click or the arrow keys picks one: the landmark is drawn in ink and its name shows small under the ground line at its place, one name at a time (a landmark under the pointer is drawn in ink too). The radar dish is a checkbox of its own: pressed, it sends one ring across the skyline and a Kangal trots in from the east to stand by it (with reduced motion it is simply there); pressed again, the Kangal leaves. No script, nothing stored: a reload starts afresh.
- The end of an edition reads "Bugünlük bu kadar." / "That's all for today." with the edition's reading time (words ÷ 200, rounded up, counted at build).
- Most motion is CSS: the echo meter's arcs light up in turn on load, buttons press, a thin reading-progress line fills at the top of an edition page, later stories rise slightly as they scroll in, the scope's sweep turns every 6 seconds and the horizon's dish, gulls, ferry, train and clouds move slowly (20 seconds or more); these loops run with or without script, and there is no pause button (the loading screen does not loop: it ends on its own). All of it, and the loading screen, the page transition, the ink-in and the tilt, is off when the reader's system asks for reduced motion; the scroll-driven parts only run in browsers that support them, and without them every story is simply shown.

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
- `texts` holds `tr`, `en` or both. Text is trimmed. A language whose title, summary or last line (`dev_line`, shown on the site as "Neden önemli" / "Why it matters") is empty after trimming is left out, and a story with no usable language is not returned at all, so a page may hold fewer than `limit` stories.
- `source_count` is a whole number and may be `0`.
- `sources` lists only entries with a non-empty name (trimmed) and an `http:` or `https:` link; sources without a name are left out. `try_url` is `null` unless it is an `http:` or `https:` link.
- Stories come newest `published_at` first, then by `uid`. `next` is an opaque cursor for the following page, or `null` after the last page. Pass it back unchanged as `cursor`.
- A `limit` outside 1 to 200 (or not a whole number) and a malformed `cursor` give `400` with `{"error": "invalid"}`.
- Responses carry `Cache-Control: public, max-age=60`.

The site reads every page with `limit=200`, follows `next` until it is `null`, and validates each story. Anything that does not match the contract stops the build.

## Editions, numbers and the weekly digest

- An **edition** is the set of stories whose `published_at` falls on one calendar day in Istanbul (UTC+3, all year). A day with no stories has no edition.
- **Numbers** count the days that have an edition, oldest first: the oldest edition is number 1. A page's address uses the date, never the number. If a story is taken down and its day becomes empty, the later numbers shift down by one, but no link breaks.
- The home page (both languages) opens with a **hero** (`Hero.astro`) of about half a screen: the edition's one h1 set small as a dateline ("Sayı 4 · 20 Kasım 2026 Cuma · 5 haber · 18 kaynak · ~2 dk"), the two promises as the slogan, large, each on its line with an accent full stop ("Her sabah. Kısa ve öz." / "Every morning. Short and to the point."), one line that says what Radar is ("Günün teknoloji ve yapay zekâ haberleri." / "The day's tech and AI news.") and a quiet link "Nasıl çalışır →" / "How it works →" to the Künye / About page. Beside the words stands the day's **radar**: the edition's own scope (below), with no card round it, the only one on the page. On a wide screen (from 48rem) the band is a little wider than the reading column (up to 58rem), the words on the left and the radar on the right, 24rem across (20rem up to 64rem); at 1280 × 800 the first story's card starts on the first screen. On a phone (under 48rem) the page is one calm column with a clear rhythm: the dateline as a two-part block (the issue pill and the date, then the counts), the slogan, the line, the link on its own row; then the radar in a band of its own, 2rem under the link so the blips that stand above its far rim never touch the words, 20.5 to 21rem wide in the middle of the column (never edge to edge; its blips stay at least 32 px for a thumb), tipped further back (63° instead of 52°) so it is wide and low, with its readout one centred line clear under its ground shadow; then the toolbar under a hairline. At 390 × 844 the first screen ends at the first topic heading; the lead story starts below it. The hero is left out of print; on a site without editions it shows the words alone, with a small label in place of the dateline.
- Under the hero, the home page has a **toolbar**: a search field over every story ("Tüm haberlerde ara…" / "Search all stories…", which opens the archive's search with the words; a link to the archive without script) and the **topic chips**: "Tümü" / "All" and the eight topics, each with its number of stories that day (the day's topics first, the empty ones after them, dashed). The chips are radio buttons, so they work without script and with the keyboard; the stylesheet shows only the chosen topic's stories (a story the address points at stays), greys the radar's other blips and their shadows, and for a topic with no story that day shows "Bugün bu konuda haber yok." / "No story on this topic today." with a link to its topic page. The day's stories follow **grouped by topic**, in the order the topics first come in the edition (so the lead's topic first), each group under a small heading in its colour with a link to all of that topic's stories; every story keeps its number, the first is still the lead, and the titles are h3 under the h2 topic headings. The plain index under it follows the same order. On a phone the chips are 40 px tall, in one row that scrolls sideways and fades out over its last 3rem (the one mask on the site), so the next chip shows there is more.
- An edition page opens with a **masthead**: the issue number, the date in large type, the number of stories, the total number of sources and the reading time. It is followed by the **scope**, a radar on which every story is a blip that links to it (nearer the centre, more sources); on wide screens it sits in a sticky rail beside the stories, and on a phone it is at most 352 px wide. The scope is drawn as an instrument seen from above at an angle, in CSS 3D over SVG drawn at build: a soft ground shadow, a body whose wall is six slices one under another, a bezel ring lit from the upper left with ticks and bearings (000 to 330) and a red index, a glass face with its graduation, range rings and a gleam, the sweep with its fading trail, and the blips standing above the face on stems, each over its soft shadow; the louder a story, the nearer the centre and the taller it stands. Each blip's head is drawn taller than round so that, seen at the dish's angle, it faces the reader. The light, the shadows and the instrument's extra warm greys are the only gradients on the site besides the sweep's fade; the pointer still tilts the dish a little. From 48rem a **readout panel** stands beside it (under it in the rail from 72rem, and left out when the window is under 52rem tall there): one mono row per story with its number, bearing, source count, topic and title, each a link to the story. A row and its blip light each other on hover or focus. The panel repeats the blips for the eye only, so it is hidden from assistive tech and its links are out of the tab order. When an edition has fewer than five stories, its scope also shows up to eight stories of the editions of the seven days before as small, faint **ghost** blips, after the day's own blips in the document; each links to the story on its own edition and is named as earlier ("Önceki baskı, 18 Kas: …" / "Earlier edition, 18 Nov: …"). Under it, the markup keeps a plain **index** of the day's stories (with each story's echo arcs), shown when the page is printed or read without its stylesheet. The first story is the **lead**.
- Each story ends with one line under the label **Neden önemli** / **Why it matters**: why the news matters to a reader.
- Inside an edition **every published story of the day is shown**, ordered by number of sources (most first), then by publish time. The site never hides a published story.
- The **weekly digest** is the ten stories of one ISO week (Monday to Sunday, Istanbul days) with the most sources, ordered the same way. No model is involved.
- A **topic page** lists one category's newest 30 stories.
- A story with only one language available appears only on that language's pages.

## Pages

| Turkish | English | What it shows |
| --- | --- | --- |
| `/` | `/en/` | The newest edition |
| `/YYYY-MM-DD/` | `/en/YYYY-MM-DD/` | One edition: a masthead, an index of the day's stories and the lead story first |
| `/arsiv/` | `/en/archive/` | All editions; each row shows the date, the lead story's headline, the number of stories and the total number of sources. With script, a search over every story's title, summary and category name (Turkish letters fold, so `sifre` finds `şifre`), with topic, month and "3+ sources" filters kept in the address; at most 100 results are listed. A heat strip shows the last 26 weeks |
| `/konu/<category>/` | `/en/topic/<category>/` | A category's emblem and newest 30 stories |
| `/hafta/` | `/en/week/` | The weekly digests |
| `/hafta/YYYY-Www/` | `/en/week/YYYY-Www/` | One weekly digest |
| `/kunye/` | `/en/about/` | Künye / About: who makes Radar, and how stories are collected, written and checked |
| `/abone/` | `/en/subscribe/` | Subscribe free: the RSS feed address and how to use it |
| `/rss.xml` | `/en/rss.xml` | RSS feed, newest 50 stories |

The build also writes `sitemap-index.xml`, `404.html` and the search data `search-tr.json` / `search-en.json`. Site copy, in both languages, lives in `site/src/lib/copy.ts`.

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

- A plain `npm run build` or `npm run dev` also uses `site/.data/stories.json` if it exists. To go back to demo data, delete the `site/.data/` folder.
- `RADAR_DEMO=1` forces the demo data, ahead of `RADAR_STORIES_FILE` and `site/.data/stories.json`; the site's build tests set it for their demo build, so they never build real data by accident. `npm run fetch` (and so `build:live`) refuses to run while it is set.
- `RADAR_STORIES_FILE` can point at any file in the same shape (`{"stories": [...]}`); it takes priority over the other two sources.
- If the API cannot be reached or answers something invalid, the fetch exits with an error and the build does not start. The site never builds from half the data. The fetch deletes any older `site/.data/stories.json` before it starts, so after a failed fetch a later plain build falls back to the demo data and shows its banner instead of quietly using stale stories.

Checks: `npm run check` (types), `npm test` and `npm run build` in `site/`. The tests build into their own git-ignored folders (`site/dist-demo/`, `site/dist-hostile/`, `site/dist-empty/`, `site/dist-real/`, `site/dist-newsletter/`) and never write `site/dist/`, so a preview of `site/dist/` is left alone.

## Deploy

The project's own site was deployed this way on Cloudflare Pages (a Pages project, not a Worker: only Pages takes a custom domain by CNAME when the domain's DNS is hosted elsewhere). Other hosts were not tried.

1. Deploy the admin service first ([admin.md](admin.md#deploy)) so that `https://<worker-host>/api/stories` answers.
2. Pick any static host that can run a Node build. In `site/`, the build command is `npm ci && npm run build:live` and the output folder is `dist`. Set two build variables: `RADAR_API_URL` (the Worker's origin, `https://...`) and `SITE_URL` (the address the site will have, for example `https://radar.example.com`). `SITE_URL` is used for the sitemap and the feed links; without it the build uses the project owner's address, `https://radar.ozkanyusuf.com`. Do not set `RADAR_DEMO` there: with `RADAR_DEMO=1` the fetch stops with an error instead of building the demo data.
3. `site/public/_headers` sets the security headers (a strict Content-Security-Policy, `nosniff`, `X-Frame-Options: DENY`, a referrer policy, `Strict-Transport-Security: max-age=31536000` and a `Permissions-Policy` that turns off the camera, microphone, geolocation, payment and other device features). The file uses Cloudflare Pages syntax. Other hosts ignore it and need the same headers set in their own configuration. It has not been checked on a real host.
4. `site/public/robots.txt` names the sitemap at the project owner's address. Edit it if the site lives elsewhere.
5. Optional: let the Worker rebuild the site when the published set changes. Create a deploy hook at your host (a URL that starts a build when it receives a `POST`), then give it to the Worker as a secret: `npx wrangler secret put SITE_DEPLOY_HOOK`. The Worker then posts to it after a story is approved, unpublished, edited while published, or ingested as already published. It only uses an `https://` URL, never logs it, and ignores a failed call. This has never been run against a real hook.

Nothing rebuilds the site on a timer. Without the hook, the site shows what was published at its last build; with it, a build starts when the published set changes. See also [automation.md](automation.md#the-site-is-not-rebuilt-on-a-timer).
