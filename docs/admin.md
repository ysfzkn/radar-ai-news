# The admin service

`admin/` is a small Cloudflare Worker (TypeScript, Hono, D1). The agent sends it finished stories with `radar push`; a person reads the ones that need a check, edits them if needed, and approves or rejects them. The screen is in Turkish.

The Worker stores stories, lets you review them, and serves the published ones to the public site through a read-only endpoint (see [Public read endpoint](#public-read-endpoint)). The site is described in [site.md](site.md). Nothing in the admin service sends a notice when a story arrives; the daily job does that after pushing (see [automation.md](automation.md)).

## What it stores, and what it does not

It stores, per story: the category, status, the reasons the agent gave for sending it to review, the score and risk flags, the fact card, the source links, the Turkish and English title, summary and story line (stored as `dev_line`; the screen calls it "Neden önemli", why it matters), and a small history of decisions (who did what, when, with an optional note).

It does not store: the fetched source articles, the agent's prompts or model output, the spend ledger, or any API key. Those stay in the agent's local SQLite file.

## Story lifecycle

| Action | From | To | Rules |
| --- | --- | --- | --- |
| Edit ("Kaydet") | `review` or `published` | same status | Marks the story as edited. Needs the story's current version. |
| Save and approve ("Kaydet ve onayla") | `review` | `published` | Saves the form's text if it differs from the stored story, then approves. Every text must be within the publish limits and the "I checked the source" box ("Kaynağı kontrol ettim") must be ticked. Refused, and the story expired, if it is 72 hours old or more. |
| Reject | `review` | `rejected` | |
| Unpublish | `published` | `rejected` | A note is required. |
| Restore ("Geri al: kuyruğa döndür") | `rejected` | `review` | Undoes a rejection or a take-down. Needs the story's current version. Refused once the story's 72 hours have passed; the story then stays rejected and the page says why. Recorded in the history as "Kuyruğa döndürüldü" with who did it. |
| Expire | `review` aged 72 hours or more | `expired` | Hourly, and whenever the queue is opened. Each story is expired in its own transaction (decision and history row together); a story whose history row cannot be written is skipped and logged, and the others still expire. |

The 72 hours run from the moment the agent wrote the story, not from its arrival here, so a story that was pushed late arrives with less time left for review.

`expired` is final, and so is `rejected` once its 72 hours have passed. A restored story keeps its original deadline. Publish limits: title 90, summary 320, story line ("Neden önemli") 200 characters. The agent may send longer text (up to 300, 1000 and 600); a story over the publish limits must be shortened by hand before it can be approved.

Save and approve is two guarded steps: first the edit is saved (and the story marked as edited), then the story is approved. If the second step is refused, for example because a text is over the publish limit, the edit stays saved and the story stays in review; the screen says so, and you can shorten the text and try again. If the form has not changed anything, nothing is saved and the stored text is approved. Approve never saves anything on a story that is not in review. Human edits are not re-checked by the fact check: the verifier ran on the agent's text only.

## The review screen

- **Next story after a decision.** After an approval (also "Kaydet ve onayla") or a rejection, the screen opens the next story waiting in the queue, in queue order, and says what happened ("Onaylandı. Sıradaki haber." or "Reddedildi. Sıradaki haber."). After the last one in the queue it goes back to the first one you skipped; when nothing waits, it shows the queue with "Hepsi tamam." (all done). The next story ignores any search you had typed.
- **Where you are.** A story page shows its place in its list ("3 / 7") with "← Önceki" and "Sonraki →" links. Opened from today's edition, it steps through the edition instead.
- **Search and categories.** The queue has a search box over the Turkish and English titles and a row of category chips. Every word you type must appear in the same title. Case does not matter for Turkish letters either: a word is looked for as typed and in its Turkish lower-case, upper-case and capitalised forms, so `şifre` finds "Şifre" and `istanbul` finds "İstanbul" (a title that mixes cases inside a word, such as "şİfre", is found only by plain Latin letters' case folding). Only the first ten words are used; with more, the results line shows the ten it searched for and says the rest were ignored. The address carries `q` and `cat`, the tabs and page links keep them, and "Temizle" clears them. The search works without scripts.
- **Status strip.** Over the waiting list: how many stories wait, how many were published today (Istanbul day), how long the oldest has waited, and how long until the next one expires (in the warning colour under 6 hours). A waiting story with under 6 hours left has the warning colour on its card's edge too.
- **Today's edition ("Bugün" tab, `/admin/edition`).** The stories published today in the order the site shows them (newest first), each with its time, category and a "Yayından kaldır…" disclosure holding the take-down form (a reason is still required). After a take-down from here you come back to the edition.
- **Keyboard.** `j` and `k` move down and up the list and `Enter` opens the selected story; on a story `n` and `p` go to the next and previous story, `a` moves to the approve button and `r` to the rejection note; `?` opens the list of shortcuts ("Klavye: ?" at the bottom of the page). Keys do nothing while you type in a field, while an input method is composing a character, or while you hold Ctrl, Cmd or Alt, and no key approves or rejects by itself: you still press the button.
- **On a phone** (640 px wide or less) the tabs and category chips scroll sideways, and the approve bar is fixed to the bottom of the screen with large buttons ("Kaydet", "Reddet…" and "Kaydet ve onayla"; "Reddet…" only takes you down to the rejection card, where the "Reddet" button decides); the page leaves room under it so it never covers the last field.
- **Field counters.** Every edit field, the try link and the notes show a live count against their limit, counted as the server counts (spaces at the ends left out), in red when over. Nothing is blocked by the page: the server decides.

- **Reasons are readable.** The agent writes the reasons it sent a story to review as short English strings. Where their shape is known (a risk flag, a text that is too long, a check on a named field) the screen shows them in Turkish, with a label for the kind of reason. Anything else is shown exactly as written and marked as English.
- **The source link.** The link to the story's main source sits in the action bar next to the buttons, so you can open it while deciding.
- **Unsaved changes.** When you have typed something that is not saved, the screen says so ("Kaydedilmemiş değişiklik var") until you save or leave.
- **When the story changed elsewhere.** If someone else saved the story first, the save is refused. For a story that is still open to the action you were taking, the text you typed stays in the form, the form takes the story's current version, and the message says that saving now will overwrite the other change. Nothing is overwritten until you save again.
- **Confirmations.** After a save, an approval, a rejection, a take-down or a restore the next page says what happened ("Kaydedildi.", "Haber yayınlandı.", "Haber reddedildi.", "Haber yayından kaldırıldı.", "Haber kuyruğa döndü.", and on the next story "Onaylandı. Sıradaki haber." or "Reddedildi. Sıradaki haber."); after a run is started from the run page, "Çalıştırma başlatıldı." The redirect carries a `done` hint in the address; only those eight known values (`saved`, `approved`, `rejected`, `unpublished`, `restored`, `next_approved`, `next_rejected`, `dispatched`) show a message, and anything else shows nothing. With scripts on, the hint is then removed from the address, so a refresh does not repeat the message.
- **Header.** The Radar mark (the three echo arcs) and "Radar Onay" lead back to the queue. On the right are "Çalıştır" (the run page, below) and "Site ↗", which opens the live site (`https://radar.ozkanyusuf.com`, a constant in `admin/src/views/layout.ts`) in a new tab. The signed-in address sits under them on a phone and next to them from 640 px.
- **Tabs and status strip.** The five lists are an underlined tab bar with a count on each. On a phone the bar scrolls sideways; with scripts on, it fades at an edge that has more tabs behind it, and the current tab is scrolled into view. The status strip over the waiting list is one panel of four cells (two by two on a phone).
- **"Sitede görünüm" (how it looks on the site).** On a story that can still be edited, a preview shows the Turkish and English title, summary and "Neden önemli" line roughly as the site draws them. It follows the form while you type.
- **Save key.** Ctrl+S (Cmd+S on a Mac) saves the form, like the "Kaydet" button. It sends the form once; pressing it again while the save is on its way does nothing.
- **Tab title.** The browser tab's title starts with the number of stories waiting for review, for example `(2) Bekleyen · Radar · Onay`, and has no number when none is waiting.
- **Empty queue.** When nothing is waiting, the review queue shows the Radar mark above "Hepsi tamam." (all done) and "Bekleyen haber yok." (no stories waiting), with a link to today's edition ("Bugünkü baskıya bak"). A search that finds nothing says "Aramaya uyan haber yok." instead, and the other tabs say "Bu listede haber yok."
- **When an automatically published story goes live.** `published_at` of a story the agent published is the moment the admin service received it, not the moment the agent created it, so editions on the site follow arrival.

## Running the agent from here ("Çalıştır", `/admin/run`)

The run page starts the daily workflow (`.github/workflows/daily.yml`, see [automation.md](automation.md)) on GitHub Actions without opening GitHub. **This has not been run against the real GitHub API.** Every test answers GitHub's two endpoints with a fake, and the page was looked at only against a local Worker whose GitHub calls were replaced by canned answers. Expect to check it on the first real use.

**What you choose.** A mode, and how many stories:

| Mode | Form value | Workflow input `mode` | Agent flag | What the run does |
| --- | --- | --- | --- | --- |
| Normal | `normal` | `normal` | none | The same as the morning run: collect, write, publish what passes the checks, send the rest to review. |
| Hepsi onaya | `review_all` | `review_all` | `--review-all` | Collect and write, but publish nothing by itself: every new story waits in "Bekleyen". A story that would have been published carries the reason "Hepsi onaya istenen bir çalıştırmadan: kendiliğinden yayınlanmadı." |
| Yalnızca topla | `collect_only` | `collect_only` | `--collect-only` | Read and store the sources only: no model call, no cost, no story, no push. The state is still saved. |

"Haber sayısı" is "Varsayılan (8)" or 1 to 8, sent as the workflow input `max_stories` ("" for the default). It is the cap for the Istanbul day's edition, not a number of extra stories: stories already written today count against it, so after a full morning run a "Normal" run with 3 writes nothing new. It is ignored (sent empty) for "Yalnızca topla". The daily spend cap applies to every run alike. Both fields come from closed lists and are checked on the server (zod); nothing typed is passed on.

**When it refuses.** The page reads the workflow's last 8 runs from GitHub each time it opens. A new run is refused, with the reason on the page, while one of them is queued or in progress; when the list cannot be read (a running job cannot be ruled out); and for 5 minutes after the last start from here that did not fail (GitHub can take a few seconds to list a new run). The cool-down check and the row that records the start are one SQL statement, so two taps at once start one run. A start that failed does not hold the next one back.

**What it shows.** "Son çalıştırmalar": each recent run's state (Kuyrukta, Çalışıyor, Başarılı, Başarısız, İptal edildi, Atlandı, Süre aşıldı), its mode and story count (read from the run's title, see below), when it started (Istanbul time), whether it was scheduled or started by hand, who started it, how long it took, and a link to the run on GitHub. A skipped run usually means `RADAR_ENABLED` is not `true`, and the page says so. "Buradan başlatılanlar": the last 10 starts from this page with who, when, the options and the outcome (Başlatıldı, Başlatılamadı with the reason, or Sonuç bilinmiyor when the Worker stopped before GitHub answered).

**What is recorded.** Migration `0004_run_dispatches.sql` adds the table `run_dispatches` (who, when, mode, story count, outcome `pending`/`dispatched`/`failed`, the failure's name, when GitHub answered) and an index. It only adds, so the previous code keeps working on a migrated database. The row is written as `pending` before GitHub is called and completed with GitHub's answer; a failed start leaves a notice on the page ("Çalıştırma başlatılamadı. …") and a row marked `failed`. GET never writes.

**Security.** The page and the form are under `/admin`, so Access sign-in and the `Origin` check apply as for every other form. The Worker calls only `https://api.github.com` (the runs list and the `dispatches` endpoint of `daily.yml`), with an 8-second timeout and without following redirects. The token is sent in the `Authorization` header only: it is never rendered, logged, put in a redirect or in a message. GitHub's answers are never shown as they came: a failure becomes one of five known outcomes (the key was refused or lacks permission; repository or workflow not found; GitHub refused the request, for example inputs the workflow on `main` does not declare; rate limit; unreachable or too slow), and a run is rebuilt from checked fields, with its link built from `GITHUB_REPO` and the run's numeric id rather than from the address GitHub sent. All output goes through the same escaping as the rest of the screen.

**Without the settings** the page says "Buradan çalıştırma kurulu değil." and offers no form; the history is still shown, and nothing else changes.

### Setting it up

1. Create a fine-grained personal access token on GitHub (Settings, Developer settings, Personal access tokens, Fine-grained tokens): resource owner your account, **Repository access: Only select repositories**, the one repository (`ysfzkn/radar-ai-news`), **Repository permissions: Actions: Read and write** (Metadata: Read-only is added by GitHub automatically). Nothing else. Give it an expiry date and note it.
2. Store it in the Worker as a secret: `npx wrangler secret put GITHUB_DISPATCH_TOKEN` in `admin/`, and paste the token when asked. It is never written to a file.
3. `GITHUB_REPO` is not a secret. It is passed at deploy time by the `deploy` script in `admin/package.json` (`--var GITHUB_REPO:ysfzkn/radar-ai-news`, next to the Access values); a fork changes it there. It is not in `wrangler.jsonc`, which local development and the tests read.
4. Apply the migration, then deploy: `npx wrangler d1 migrations apply radar --remote`, then `npm run deploy`.
5. The workflow is started on `main`, so `main` must have the version of `daily.yml` that declares the `mode` input. Every start sends `mode`, "Normal" included, so until that version is merged GitHub refuses every start and the page says GitHub did not accept the request.

To try it locally, add both to `admin/.dev.vars`; the page then calls the real GitHub API with that token.

## Sign-in

Cloudflare Access sits in front of `/admin*`. The Worker does not rely on that alone: it verifies the Access token itself (RS256 signature, issuer and audience) and answers 401 if it is missing or invalid. If `ADMIN_EMAILS` (comma-separated) is set, only those e-mail addresses get in; anyone else gets 403.

It fails closed. If sign-in is not configured, the answer is 503, not an open page. The one exception is development: with `DEV_NO_AUTH=1` set and a request to `localhost`, `127.0.0.1` or `[::1]`, the check is skipped. It works nowhere else.

Every `POST` must also carry an `Origin` header equal to the request's own origin, otherwise it is refused with 403. Admin pages are sent with `Referrer-Policy: same-origin`: with `no-referrer`, browsers send `Origin: null` on form posts and every click would be refused. A `POST` with `Origin: null` is still refused.

The screen is light only: there is no dark theme and no theme switch. It works with scripts off; the script only adds the live counters, the keyboard shortcuts, the unsaved-changes notice, the live preview, the save key and the fading edge of a sideways-scrolling row. Lists show 50 stories per page, with "Sonraki sayfa" (next page) and "Önceki sayfa" (previous page) links; the address takes `?page=N`.

## Public read endpoint

`GET /api/stories` is public and needs no sign-in. It returns only `published` stories and only what a reader sees: no reasons, score, fact card, history or e-mail addresses. It is what the static site reads at build time. It leaves out sources without a name and any language with an empty text, and does not return a story that has no usable language left. Parameters, response shape and paging are described in [site.md](site.md#the-public-read-contract-version-1). Responses carry `Cache-Control: public, max-age=60`. Migration `0003_public_feed_index.sql` adds an index on `(status, published_at DESC, uid)`, the endpoint's filter and order. The page cursor's `published_at` is also bound as `published_at <= ?`, so the planner seeks into the index at the cursor instead of reading every newer row; a call, with or without a cursor, reads about the rows of its page. Tests check with `EXPLAIN QUERY PLAN` that the query searches the index with a range and needs no sort, and that paging through stories with equal `published_at` returns each once. Not limited by this: anyone can call the endpoint, and the Worker has no rate limit or edge cache of its own.

## Ingest contract (version 1)

`POST /api/ingest` with `Authorization: Bearer <INGEST_TOKEN>` and a JSON body of at most 256 KB:

```json
{
  "version": 1,
  "stories": [
    {
      "uid": "32 lowercase hex characters",
      "category": "protocol",
      "status": "review",
      "reasons": ["en.summary: number 40% not in source"],
      "score": {"relevance": 5, "novelty": 4, "usefulness": 4, "total": 4.4, "risk_flags": []},
      "fact_card": {"what": "...", "who": ["Google"], "numbers": [], "versions": ["1.0"], "try_url": null},
      "source_url": "https://example.com/post",
      "source_count": 4,
      "sources": [{"name": "Example Blog", "url": "https://example.com/post", "tier": 1}],
      "created_at": "2026-11-20T05:00:00+00:00",
      "texts": {
        "tr": {"title": "...", "summary": "...", "dev_line": "..."},
        "en": {"title": "...", "summary": "...", "dev_line": "..."}
      }
    }
  ]
}
```

Rules: 1 to 20 stories per request; `status` is `review` or `published`; `category` is one of `protocol`, `model`, `framework`, `tooling`, `research`, `security`, `industry`, `policy`; at most 20 `reasons` of 300 characters; `who`, `numbers` and `versions` at most 30 entries of 200 characters; `what` at most 1000; 1 to 30 `sources`, `name` at most 100, `tier` 1 to 4; every URL at most 2000 characters and `http:` or `https:`; `created_at` must parse and be no more than 24 hours in the future; text fields non-empty after trimming and within the ingest limits; unknown keys are rejected.

Responses: `200 {"accepted": [...], "duplicates": [...]}`; `400 {"error": "invalid", "path": "stories.0.texts.tr.title"}` and nothing is stored (all or nothing); `401` for a missing or wrong token; `413` over the size limit; `415` when the content type is not JSON. Sending the same `uid` again is a duplicate, not an error.

## Run it locally

You need Node 22 and no Cloudflare account. Nothing here calls a paid API.

```bash
cd admin
cp .dev.vars.example .dev.vars    # PowerShell: Copy-Item .dev.vars.example .dev.vars
npm ci
npm run db:migrate:local
npm run dev                       # leave it running; serves http://localhost:8787
```

In a second terminal:

```bash
cd admin
npm run seed                      # posts three invented demo stories
```

Open <http://localhost:8787/admin>. The demo data is two stories in the review queue and one published story. One review story is 2 hours old. The other is about 68 hours old when seeded, so the queue shows a remaining time such as `Kalan süre: 4 sa` (4 hours left) on it in a warning colour; it also has a risk flag and a Turkish title of 100 characters, which is over the publish limit of 90, so it must be shortened to 90 characters or fewer before `Kaydet ve onayla` accepts it (the screen then says the Turkish title is too long and the story stays in review). Running `npm run seed` again does nothing: the stories are duplicates. The seed script reads the token from `.dev.vars`, never prints it, and refuses any address that is not `localhost`, `127.0.0.1` or `[::1]`. The 68-hour story expires about 4 hours after you seed, because expiry runs whenever the queue is opened. To get the demo data back, delete `admin/.wrangler/`, then run `npm run db:migrate:local` and `npm run seed` again.

The example file sets `INGEST_TOKEN=change-me` and `DEV_NO_AUTH=1`; change the token if you like.

To push real stories from the agent into this local screen, run this in `agent/` with the same token value as in `.dev.vars` (the token is read only from the environment):

```bash
export RADAR_INGEST_TOKEN=...             # the INGEST_TOKEN value from admin/.dev.vars
export RADAR_ADMIN_URL=http://localhost:8787
uv run radar push
```

PowerShell:

```powershell
$env:RADAR_INGEST_TOKEN = "..."           # the INGEST_TOKEN value from admin/.dev.vars
$env:RADAR_ADMIN_URL = "http://localhost:8787"
uv run radar push
```

`radar push` only sends stories that exist in the local agent database. Normally that means `radar run` (which calls the paid Anthropic API) has written some; with none, it prints zeros.

`radar push` sends every story it has not pushed yet and prints `{"pushed": N, "duplicates": N, "batches": N, "rejected": [...], "parked": N}`. Running it again right away pushes nothing. It sends the token only to `https://` addresses, or to `http://` on `localhost`, `127.0.0.1` or `[::1]`, and it does not follow redirects.

### When a push is refused

Before sending, `radar push` trims what it safely can to the ingest limits: at most 20 reasons of 300 characters; at most 30 `who`, `numbers` and `versions` entries of 200 characters; `what` to 1000 characters; at most 30 sources; and a `try_url` that is not an `http://` or `https://` link of at most 2000 characters is sent as no link. The texts and the source links are sent as stored.

If the Worker still refuses a story (for example an empty or over-long text, or a source link it cannot parse), that story is skipped and the rest of its batch is sent again, so other stories are not held up. The skipped story's uid is listed under `rejected`, one line per skipped story on stderr names the field the Worker objected to, and the command exits 1. The story is then parked in the local database with the field the Worker objected to, and later pushes leave it out, so they do not exit 1 because of it; `parked` in the printed statistics counts the stories waiting this way. `radar push --list-refused` shows them (uid, time of the refusal, field and Turkish title) without contacting the service and without needing the address or the token. `radar push --retry-refused` sends the parked stories again, for example after the limits on the service changed; a story that is accepted, or already known to the service, is no longer parked, and one that is refused again stays parked with the new field.

To see an approved story on the site, build the site against this server; see [site.md](site.md#against-a-local-admin-service).

Checks: `npm run typecheck` and `npm test` in `admin/`.

After pulling a change that adds a file under `admin/migrations/` (for example `0002_restored_event.sql`, which lets the history record a restore), run `npm run db:migrate:local` again; it applies only the new files and keeps your data. Migrate first, then start the new code. Every decision and its history row are written in one transaction. What runs after a stored approval or rejection (finding the next story, the deploy hook) cannot undo it: if that step fails, the reviewer is sent to the queue with the usual notice, not to the error page. If the database cannot record the history row, the decision is not made either. So until 0002 is applied, "Geri al" changes nothing: the story stays rejected, no history row is written, and the screen shows an error page ("Sunucuda bir hata oldu; istek tamamlanmadı.") instead of the story.

## Deploy

The project's own Worker was deployed with these steps on 2026-11-20 and 21 (steps 1 to 6 and 8). The run page's GitHub token (below) has not been set on the live Worker yet, so starting a run from the admin has never been done for real.

1. Create the D1 database: `npx wrangler d1 create radar`. Put the id it prints in `database_id` in `admin/wrangler.jsonc` (the file holds the project owner's id; a fork needs its own). The id is not a secret. `preview_database_id` in the same file is the id local development uses, so `npm run dev` keeps its own local database whatever the production id is.
2. Create the tables: `npx wrangler d1 migrations apply radar --remote`.
3. Set the ingest secret: `npx wrangler secret put INGEST_TOKEN`. Use a long random value, and use the same one as `RADAR_INGEST_TOKEN` for `radar push`.
4. In Cloudflare Zero Trust, create an Access application that covers `/admin*` on the Worker's hostname and allow only the people who may review. The application must cover only `/admin`: `/api/*` and `/healthz` stay open. Then put the team domain (for example `myteam.cloudflareaccess.com`) and the application's audience tag into the `deploy` script in `admin/package.json` (the file holds the project owner's values; a fork needs its own). Neither is a secret:

   ```
   wrangler deploy --var ACCESS_TEAM_DOMAIN:myteam.cloudflareaccess.com --var ACCESS_AUD:<the application's audience tag>
   ```

   They are passed at deploy time and not kept in `wrangler.jsonc`, because local development and the tests read that file and would then ask for a sign-in that does not exist on your machine. Both must be set. With only one of them set, or neither, sign-in answers 503 and nothing gets in; a plain `npx wrangler deploy` therefore closes the admin screen until the next `npm run deploy`. Optionally add `ADMIN_EMAILS` the same way. Do not set `DEV_NO_AUTH`. Variables set in the Cloudflare dashboard are overwritten by a deploy unless `--keep-vars` is used.
5. Deploy: `npm run deploy`. The hourly expiry cron (`17 * * * *`) in `wrangler.jsonc` is registered by the deploy.
6. Check that `/healthz` answers `ok`, that `/admin` asks you to sign in, and that `/api/stories` answers without signing in.
7. Later updates: apply new migrations first, then deploy: `npx wrangler d1 migrations apply radar --remote`, then `npm run deploy`. New code can rely on a migration (for example `0002_restored_event.sql` for "Geri al", `0004_run_dispatches.sql` for the run page); against a database without it, that action is refused with an error page and nothing changes. The migrations so far only add or widen (a new action, an index, a table), so the old code keeps working on the migrated database in the minutes between the two steps.
8. Optional: set `GITHUB_DISPATCH_TOKEN` to start the daily run from the admin's run page; see [Setting it up](#setting-it-up).
9. Optional: set `SITE_DEPLOY_HOOK` so the site is rebuilt when the published set changes: `npx wrangler secret put SITE_DEPLOY_HOOK`, with an `https://` deploy-hook URL from the site's host. The Worker posts to it (empty `POST`) after a story is approved, unpublished, edited while published, or ingested as already published. A value that is not `https://` is ignored, the URL is never logged, and a failed call is ignored. This has never been run against a real hook; see [site.md](site.md#deploy).
