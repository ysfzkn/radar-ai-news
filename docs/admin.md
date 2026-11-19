# The admin service

`admin/` is a small Cloudflare Worker (TypeScript, Hono, D1). The agent sends it finished stories with `radar push`; a person reads the ones that need a check, edits them if needed, and approves or rejects them. The screen is in Turkish.

Today the Worker stores stories and lets you review them. There is no public site yet that reads the published stories, and nothing sends a notice when a story arrives.

## What it stores, and what it does not

It stores, per story: the category, status, the reasons the agent gave for sending it to review, the score and risk flags, the fact card, the source links, the Turkish and English title, summary and developer line, and a small history of decisions (who did what, when, with an optional note).

It does not store: the fetched source articles, the agent's prompts or model output, the spend ledger, or any API key. Those stay in the agent's local SQLite file.

## Story lifecycle

| Action | From | To | Rules |
| --- | --- | --- | --- |
| Edit | `review` or `published` | same status | Marks the story as edited. Needs the story's current version. |
| Approve | `review` | `published` | Every text must be within the publish limits and the "I checked the source" box must be ticked. Refused, and the story expired, if it is 72 hours old or more. |
| Reject | `review` | `rejected` | |
| Unpublish | `published` | `rejected` | A note is required. |
| Expire | `review` aged 72 hours or more | `expired` | Hourly, and whenever the queue is opened. |

`rejected` and `expired` are final. Publish limits: title 90, summary 320, developer line 200 characters. The agent may send longer text (up to 300, 1000 and 600); a story over the publish limits must be shortened by hand before it can be approved.

Approve publishes the text as last saved, so save your edits before you approve. Human edits are not re-checked by the fact check: the verifier ran on the agent's text only.

## Sign-in

Cloudflare Access sits in front of `/admin*`. The Worker does not rely on that alone: it verifies the Access token itself (RS256 signature, issuer and audience) and answers 401 if it is missing or invalid. If `ADMIN_EMAILS` (comma-separated) is set, only those e-mail addresses get in; anyone else gets 403.

It fails closed. If sign-in is not configured, the answer is 503, not an open page. The one exception is development: with `DEV_NO_AUTH=1` set and a request to `localhost`, `127.0.0.1` or `[::1]`, the check is skipped. It works nowhere else.

Every `POST` must also carry an `Origin` header equal to the request's own origin, otherwise it is refused with 403.

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

Rules: 1 to 20 stories per request; `status` is `review` or `published`; `category` is one of `protocol`, `model`, `framework`, `tooling`, `research`, `security`, `industry`, `policy`; at most 20 `reasons` of 300 characters; `who`, `numbers` and `versions` at most 30 entries of 200 characters; `what` at most 1000; 1 to 30 `sources`, `name` at most 100, `tier` 1 to 4; every URL at most 2000 characters and `http:` or `https:`; `created_at` must parse and be no more than 24 hours in the future; text fields non-empty and within the ingest limits; unknown keys are rejected.

Responses: `200 {"accepted": [...], "duplicates": [...]}`; `400 {"error": "invalid", "path": "stories.0.texts.tr.title"}` and nothing is stored (all or nothing); `401` for a missing or wrong token; `413` over the size limit; `415` when the content type is not JSON. Sending the same `uid` again is a duplicate, not an error.

## Run it locally

You need Node 22 and no Cloudflare account. Nothing here calls a paid API.

```bash
cd admin
cp .dev.vars.example .dev.vars    # PowerShell: Copy-Item .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev                       # leave it running; serves http://localhost:8787
```

In a second terminal:

```bash
cd admin
npm run seed                      # posts three invented demo stories
```

Open <http://localhost:8787/admin>. The demo data is two stories in the review queue and one published story. One review story is 2 hours old. The other is 68 hours old, so the queue shows `Kalan süre: 4 sa` (4 hours left) on it in a warning colour; it also has a risk flag and a Turkish title of 100 characters, which is over the publish limit of 90, so it must be shortened before it can be approved. Running `npm run seed` again does nothing: the stories are duplicates. The seed script reads the token from `.dev.vars`, never prints it, and refuses any address that is not `localhost`, `127.0.0.1` or `[::1]`. The 68-hour story expires about 4 hours after you seed, because expiry runs whenever the queue is opened. To get the demo data back, delete `admin/.wrangler/`, then run `npm run db:migrate:local` and `npm run seed` again.

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

`radar push` sends every story it has not pushed yet and prints `{"pushed": N, "duplicates": N, "batches": N}`. Running it again right away pushes nothing. It sends the token only to `https://` addresses, or to `http://` on `localhost`, `127.0.0.1` or `[::1]`, and it does not follow redirects.

Checks: `npm run typecheck` and `npm test` in `admin/`.

## Deploy

These steps were written from Cloudflare's documentation and have not been run. Nothing in this project has been deployed. Expect to adjust them.

1. Create the D1 database: `npx wrangler d1 create radar`. Put the id it prints in `database_id` in `admin/wrangler.jsonc`.
2. Create the tables: `npx wrangler d1 migrations apply radar --remote`.
3. Set the ingest secret: `npx wrangler secret put INGEST_TOKEN`. Use a long random value, and use the same one as `RADAR_INGEST_TOKEN` for `radar push`.
4. In Cloudflare Zero Trust, create an Access application that covers `/admin*` on the Worker's hostname and allow only the people who may review. Then add a `vars` block to `admin/wrangler.jsonc` with the team domain (for example `myteam.cloudflareaccess.com`) and the application's audience tag. Neither is a secret:

   ```jsonc
   "vars": {
     "ACCESS_TEAM_DOMAIN": "myteam.cloudflareaccess.com",
     "ACCESS_AUD": "<the application's audience tag>"
   }
   ```

   Both must be set. With only one of them set, or neither, sign-in answers 503 and nothing gets in. Optionally add `ADMIN_EMAILS` the same way. Do not set `DEV_NO_AUTH`. You can set variables in the Cloudflare dashboard instead, but by default `wrangler deploy` treats `wrangler.jsonc` as the source of truth and overwrites dashboard variables, unless `keep_vars` is set to `true` (this is described in the installed wrangler's config schema; I did not run it).
5. Deploy: `npx wrangler deploy`. The hourly expiry cron (`17 * * * *`) in `wrangler.jsonc` is registered by the deploy.
6. Check that `/healthz` answers `ok` and that `/admin` asks you to sign in.
