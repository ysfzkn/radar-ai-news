# Running it every day

The agent can run by itself every morning on GitHub Actions. This page describes what the job does, how it keeps its database between runs, when it sends a notice, and how to set it up.

> **Status:** the workflow (`.github/workflows/daily.yml`) first ran on GitHub on 2026-11-21, started by hand with two stories: both jobs succeeded, the state file was handed from one job to the other and pushed to `radar-state`, and the stories reached the admin service. What has not been seen yet: a scheduled run, a run that fails part-way (whether the state survives it), the `mode` input and the 14-day backlog on real feeds, and a real Telegram or e-mail notice (those paths were exercised only against fakes).

## What the job does

The workflow is `.github/workflows/daily.yml`. It is scheduled for 21:15 UTC (00:15 in Istanbul, just after the day turns there), so the edition is ready by morning even when GitHub starts the run late: its scheduler does not keep the minute, and the first scheduled runs of this repository started more than eight hours after their time. It can also be started by hand from the Actions tab.

It does nothing unless the repository variable `RADAR_ENABLED` is `true`. Two runs never overlap: a second one waits for the first (it is queued, not cancelled). The first job is stopped after 20 minutes, and the `radar daily` step alone after 15, so that a step that hangs still leaves time to save the state; the push job is stopped after 5.

The workflow has two jobs. The first, `daily`, does all the work and can only read the repository; the second, `push`, only saves the state branch and is the one job allowed to write. The steps, in order:

1. Check out the repository, note where the database will live (a file in the runner's temporary folder), install [uv](https://docs.astral.sh/uv/) (an exact version, set in the workflow) and the agent's dependencies exactly as `uv.lock` records them (`uv sync --locked`, which fails instead of updating a lock that is out of date).
2. **Restore state.** First check that `RADAR_STATE_KEY` is set and at least 16 characters long; if not, the job stops here, before anything is spent. Then fetch the encrypted database from the branch `radar-state` and decrypt it (see [The state file](#the-state-file)). If the branch does not exist yet, print one line and start from an empty database.
3. **Run.** `uv run radar daily`, with `--max-stories` only when the manual-run input `max_stories` is filled in (it must be a whole number), and `--review-all` or `--collect-only` when the manual-run input `mode` is `review_all` or `collect_only`. `mode` is a closed choice (`normal`, `review_all`, `collect_only`; default `normal`); a scheduled run has no inputs and is a normal run. Both inputs reach the script through the step's `env:`, and any other value of either stops the step with exit 1 before the agent runs. The run's title on GitHub names the mode and the count (`Daily · review_all · 3`; `Daily · normal` for a scheduled run); the admin's run page reads it from there.
4. **Save state.** Whether or not the run succeeded, encrypt the database into `state.bin`. If the run wrote no database (it failed before it began), there is nothing to save and this step does nothing. This step is skipped when the restore step itself failed, so a wrong key never overwrites good state with a new one.
5. **Hand over the state file.** When the save step produced a file, upload it as the workflow artifact `radar-state`, kept for one day. It is the same encrypted file that is public on the branch, and in a public repository the artifact can be downloaded by other GitHub users too.
6. **Push state** (the `push` job). It starts after the first job, also when that job failed, but only when the save step produced a file. It checks out the repository without keeping the token, downloads the artifact and pushes the file to the `radar-state` branch. If the push fails, the job fails and the branch keeps the previous state, so that run's entries (including its spend ledger) are lost.

Only the steps that need a secret get it, through the step's `env:`. No step prints a secret or passes one on a command line. The workflow's own token needs `contents: write` for one reason: replacing the `radar-state` branch. The workflow as a whole is read-only, and only the `push` job raises this to `contents: write`. That job runs no uv, no dependency and no agent code: a checkout that does not keep the token (`persist-credentials: false`), the artifact download, and git. The job that runs uv, the dependencies and the agent has a read-only token, so even a malicious dependency in it cannot push with it (it could still read what that job holds, which includes the secrets the run step is given: the model key, the ingest token and the notice credentials). This is what the workflow is written to do; it has not run on GitHub yet, and protecting `main` so that the Actions token cannot push to it is still worth doing. Restoring reads the branch without a token, which works because the repository is public; a private repository would need the token in the restore step too. Scheduled workflows run only from the repository's default branch, and GitHub pauses scheduled workflows in a public repository after 60 days without repository activity (a new commit or a manual run starts them again). While one run is queued, a newer queued run replaces it. The only actions used are `actions/checkout`, `actions/upload-artifact`, `actions/download-artifact` and `astral-sh/setup-uv` (the last only in the read-only job), each pinned to a full commit id with its release named in a comment, so a moved tag cannot change what runs. `.github/dependabot.yml` asks Dependabot for weekly update proposals for these pins and for the agent's, the admin's and the site's dependencies. To update one, look up the new release's commit (`git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>`; for an annotated tag, use the `^{}` line) and change both the id and the comment.

## What `radar daily` does

`radar daily` runs the whole chain in one process:

1. **Collect** the sources and rank candidates, as `radar collect` does.
2. **Run** the agent (score, write, verify, route), under the hard daily spend cap, as `radar run` does.
3. **Push** the finished stories to the admin service, as `radar push` does. Without `RADAR_ADMIN_URL` and `RADAR_INGEST_TOKEN` this step is skipped.
4. **Send a notice** when one is needed.

Run it locally from `agent/`:

```bash
uv run radar daily
uv run radar daily --max-stories 2
```

PowerShell is the same; set variables with `$env:NAME = "value"`.

Two flags change what a run may do; they cannot be combined:

- `--review-all` publishes nothing by itself. A story that would have been published goes to review with the one reason `manual run: review requested` (shown in Turkish on the review screen); a story with reasons of its own keeps them.
- `--collect-only` stops after the collection: it builds no model client (so it needs no Anthropic credential and costs nothing), writes no story and pushes nothing, not even stories left from earlier runs. The run is recorded with the kind `collect`. A notice is sent only when something needs attention, and then starts with "Yalnızca kaynaklar toplandı; haber yazılmadı." `--collect-only` with `--max-stories` is a usage error (exit 2).

```bash
uv run radar daily --review-all --max-stories 3
uv run radar daily --collect-only
```

It prints one JSON line to standard output: `collected` (the collector's statistics), `run` (the agent's statistics, or `null` if that step did not happen), `push` (the push statistics, `{"skipped": true}` when it was skipped, or `null`), `review` and `published` (the stories this push delivered, whichever run wrote them, that are waiting for review or were published automatically; a story the service refused is not counted, and both are 0 when the push was skipped or failed), `cap_reached`, `failed_step` (`collect`, `run`, `push` or `null`), `error` (one line, or `null`), `waiting` (when the push was skipped, the number of stories still waiting to be sent; otherwise 0), `mode` (`normal`, `review_all` or `collect_only`; with `collect_only`, `run` and `push` are `null`) and `admin_url`, which is the admin service's scheme, host and port only (no path, no user name), or `null` when the address is missing or not allowed. Parked-story field names in `push` are filtered the same way as in the notice: only plain field names are kept.

**Exit codes:** 0 on a normal run; 1 when a step failed (the first failure is the one reported) or when no source could be read (`sources_ok` is 0; the chain still continues and pushes what earlier runs wrote, and `failed_step` stays `null`); 2 for a usage error such as `--max-stories 0`. A failed step does not stop the others from being tried where that is safe: a failed run still pushes what was already written, and a failed collection skips the run and the push. Reaching the daily cap is not a failure: stories already written are kept and the exit code is still 0. A failed notice is one line on standard error and does not change the exit code. An interruption (for example a cancelled job) still closes the run record. Failures are named by the step and the error's class; the text of an error is shown only for errors written for this purpose, with addresses and secrets removed.

## Notices

A notice is sent when the push delivered at least one story that is waiting for review (a story an earlier run wrote but could not send counts too), or when something needs attention: a step failed, the daily cap stopped the run, half or more of the sources failed, the admin service refused a story, or the push was skipped because `RADAR_ADMIN_URL` or `RADAR_INGEST_TOKEN` is missing while stories are waiting to be sent (the exit code stays 0 in that case, so the notice is the only sign). A quiet, healthy run sends nothing.

A notice is a few lines of Turkish text: the date, how many stories wait for review (with the address of the review screen, built from the admin origin), how many were published automatically, and one line for each kind of trouble. A refused story is described by the name of the field the service objected to (for example `texts.tr.title`). **A notice never contains story text.**

Two channels exist, and both can be on at once:

- **Telegram**, when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set.
- **E-mail** through any SMTP server, when `RADAR_SMTP_HOST` is set. The connection always upgrades with STARTTLS. The port is `RADAR_SMTP_PORT` (default 587); the login happens only if `RADAR_SMTP_USER` is set, with `RADAR_SMTP_PASSWORD`. The sender is `RADAR_MAIL_FROM` (default: the SMTP user) and the recipient is `RADAR_MAIL_TO`.

With neither set, the summary is only printed, and when a notice was needed one line on standard error says `notice needed but no channel is configured`. A channel that fails prints one line on standard error and never includes a token, a URL or a password.

## The state file

The agent keeps everything it knows in one SQLite database: the sources, items, clusters, drafts of stories that have not been pushed or reviewed yet, and the spend ledger that enforces the daily cap. A GitHub runner starts empty every time, so the job saves the database at the end of each run and restores it at the start of the next.

**What the file is.** `radar state save` takes a consistent copy of the database, compresses it with gzip and encrypts it. The key is derived from the passphrase in `RADAR_STATE_KEY` with scrypt and a fresh random salt each time, and the encryption is Fernet from the `cryptography` package. The file is `state.bin`, and it is force-pushed as the only commit of the branch `radar-state`: the branch always has exactly one commit with one file. That does not make old states disappear at once: a replaced file can stay retrievable from the host for some time (through forks, caches or the commit's id), so a leaked old passphrase still exposes the files it encrypted. Rotating the key protects new files only.

**Why it is encrypted.** The repository is public, and so is its branch. The database holds drafts of stories that are still waiting for a person, the text fetched from sources, and the full history of the agent's work. Encryption keeps those out of public view; the file itself is readable by anyone, so the passphrase is what protects it: use a long random one.

**What is not private.** The job log of a public repository is public, and the one JSON summary line in it reveals: today's model cost and token totals, the number of stories collected, written, published and waiting, the ids of sources that failed, and the admin service's origin (scheme, host and port). It never holds story text, a token or a password. The encryption is not meant to hide those daily totals. If they matter to you, keep the repository private.

**The passphrase.** Generate it, do not choose it: anyone can download `state.bin` from the public branch and try passphrases offline for as long as they like, and scrypt only slows each guess down. Use at least 32 random characters, for example the output of `openssl rand -base64 32` (44 characters), or a password manager's generator set to 32 characters or more. Do not reuse it anywhere else. `RADAR_STATE_KEY` must be at least 16 characters, otherwise the state commands exit with code 2; that is a floor against mistakes, not a recommendation. The workflow checks this at the start of the restore step, on the first run too, so a missing or short key stops the job before anything is spent. Every character counts, including a newline at the end: a value saved in a secret with a trailing newline is a different key from the same text without one. Paste it without one.

**How the branch is pushed.** The `push` job builds the commit directly (`git commit-tree`, with the identity `github-actions[bot]`) and pushes it with the workflow's token. The token is given to that one `git push` through git's environment (`GIT_CONFIG_COUNT`, as the same authorization header `actions/checkout` would otherwise write), so it is never written to `.git/config`, never in a command line or a URL, and never printed; the header's base64 form is masked in the log as well. Nothing from that branch is ever checked out into the work tree.

**The first run.** When the branch `radar-state` does not exist (and the key is long enough), the restore step prints one line, the run starts from an empty database, and the save step creates the branch.

**A wrong key.** When the branch exists but cannot be decrypted or read (a different passphrase, a damaged file), the restore step fails and the job stops before any model call. This is deliberate: starting over silently would reset the spend ledger, and the agent would write and push old stories again. The save step is skipped, so the saved state is left alone. Fix the secret, or, if the state is lost for good, delete the `radar-state` branch to start over on purpose.

**Reading the state yourself.** Fetch `state.bin` from the branch, then, in `agent/` (the database path is your choice; `radar budget` shows the spend ledger):

```bash
git fetch origin radar-state
git show FETCH_HEAD:state.bin > state.bin
export RADAR_STATE_KEY=...           # the same passphrase
uv run radar state load --db /tmp/radar-copy.db --file state.bin
uv run radar budget --db /tmp/radar-copy.db
```

PowerShell:

```powershell
git fetch origin radar-state
cmd /c "git show FETCH_HEAD:state.bin > state.bin"   # a plain `>` can change bytes in older PowerShell
$env:RADAR_STATE_KEY = "..."
uv run radar state load --db radar-copy.db --file state.bin
uv run radar budget --db radar-copy.db
```

`radar state load` refuses to replace a database that already exists unless you add `--force`; it checks the restored database for damage before putting it in place; and it removes the old database's side files so they cannot be replayed over it. `radar state save --db PATH --file FILE` is the opposite direction. A bad key or file prints one line (`state: cannot decrypt (wrong key or damaged file)`, for example) and exits 1.

**Rotating the key.** The job can only read a state saved with the key it is given, so the file on the branch has to be re-encrypted before the secret changes. Set the repository variable `RADAR_ENABLED` to anything but `true` first (so no run starts in the middle), and set it back afterwards. Work in a scratch directory outside the repository, so no plaintext database or `.bin` file lands in the work tree. In bash, from `agent/`:

```bash
scratch=$(mktemp -d)
git fetch origin radar-state
git show FETCH_HEAD:state.bin > "$scratch/old.bin"
read -rs RADAR_STATE_KEY; export RADAR_STATE_KEY     # the OLD passphrase; nothing is echoed
uv run radar state load --db "$scratch/rotate.db" --file "$scratch/old.bin"
read -rs RADAR_STATE_KEY; export RADAR_STATE_KEY     # the NEW passphrase
uv run radar state save --db "$scratch/rotate.db" --file "$scratch/new.bin"
unset RADAR_STATE_KEY
cd "$(git rev-parse --show-toplevel)"
blob=$(git hash-object -w --no-filters "$scratch/new.bin")
tree=$(printf '100644 blob %s\tstate.bin\n' "$blob" | git mktree)
commit=$(GIT_AUTHOR_NAME=you GIT_AUTHOR_EMAIL=you@example.invalid GIT_COMMITTER_NAME=you GIT_COMMITTER_EMAIL=you@example.invalid git commit-tree "$tree" -m state)
git push --force origin "$commit:refs/heads/radar-state"
rm -rf "$scratch"
```

Then update the `RADAR_STATE_KEY` secret and set `RADAR_ENABLED` back. Pushing the branch by hand starts the CI workflow on it; it will fail there (the branch has no code) and can be ignored. This is the same plumbing the save step uses; the whole rotation was not run end to end.

In PowerShell, the simplest way is to run the block above in Git Bash. To use PowerShell instead, set `$env:RADAR_STATE_KEY` by hand for each of the two `radar state` commands, in a session whose history is not saved (for example after `Set-PSReadLineOption -HistorySaveStyle SaveNothing`), use `cmd /c` for the `git show` line, and clear the variable afterwards. A secure prompt such as `Read-Host -AsSecureString` does not produce an environment variable, so it cannot be used here.

## Refused stories

If the admin service refuses a story, the agent parks it at once with the name of the field the service objected to, and does not send it again. The notice mentions the field name. `radar push --list-refused` lists parked stories without contacting the service, and `radar push --retry-refused` sends them again after you have fixed the cause. Details: [admin.md](admin.md#when-a-push-is-refused). To look at the parked stories of the saved state, load it as shown above first.

## Set it up

This part has not been tried on GitHub.

1. Push the repository to GitHub, and deploy the admin service and the site first ([admin.md](admin.md#deploy), [site.md](site.md#deploy)). The job pushes to the admin service; it cannot do that before it exists.
2. Add the secrets and variables below under Settings, Secrets and variables, Actions, including `RADAR_ENABLED` set to `true`. The job, a manual run included, is skipped unless that variable is `true`. Generate `RADAR_STATE_KEY` rather than typing one (`openssl rand -base64 32`), paste it without a trailing newline, and keep a copy in a password manager: without it the saved state cannot be read.
3. Start a first manual run (see below). Do it well away from 21:15 UTC, since the schedule is live from step 2 on.
4. After the first run has been checked, leave `RADAR_ENABLED` on, or set it to anything else to stop the schedule again.

| Name | Kind | What it is for | Needed |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | Model calls | required |
| `RADAR_STATE_KEY` | secret | Passphrase that encrypts the saved database: generate 32 or more random characters, such as `openssl rand -base64 32` (16 is the least accepted) | required |
| `RADAR_INGEST_TOKEN` | secret | Token the admin service accepts for pushes (its `INGEST_TOKEN`) | required to push |
| `RADAR_ADMIN_URL` | variable | The admin service's origin, `https://...` | required to push |
| `RADAR_ENABLED` | variable | `true` turns the scheduled run on | required |
| `RADAR_DAILY_CAP_USD` | variable | Daily spend cap in dollars (default 0.25) | optional |
| `TELEGRAM_BOT_TOKEN` | secret | Telegram notices | optional |
| `TELEGRAM_CHAT_ID` | secret | Telegram chat that receives them | optional |
| `RADAR_SMTP_HOST` | variable | SMTP server for e-mail notices (turns e-mail on) | optional |
| `RADAR_SMTP_PORT` | variable | SMTP port (default 587) | optional |
| `RADAR_SMTP_USER` | secret | SMTP user name | optional |
| `RADAR_SMTP_PASSWORD` | secret | SMTP password | optional |
| `RADAR_MAIL_FROM` | secret | Sender address of the notice | optional |
| `RADAR_MAIL_TO` | secret | Recipient address of the notice | optional |

Without the push settings the job still collects and writes stories, and the summary says the push was skipped; nothing reaches the review screen, and the notice (on a channel that is set) says how many stories are waiting to be sent.

**The first manual run.** Open the Actions tab, pick the "Daily" workflow, choose "Run workflow" and enter `2` as `max_stories`. This writes at most two stories, which keeps the first paid run small. `RADAR_ENABLED` must already be `true` (step 2). Afterwards:

- read the log of the run: the one JSON line, and the "Saved state" line at the end;
- check that the branch `radar-state` exists with one commit and one file;
- run `radar budget` on the loaded state (see [Reading the state yourself](#the-state-file)) and compare `spent_usd` with the usage shown in the Anthropic Console. `radar budget` shows the current Istanbul day only, so compare on the day of the run. The meter's prices are a snapshot and may be out of date; see [agent.md](agent.md#the-budget).

**Starting a run from the admin screen.** The admin's run page ("Çalıştır") starts this workflow on `main` with the `mode` and `max_stories` inputs, through GitHub's `workflow_dispatch` API, with a fine-grained token that has only Actions read and write on this repository (the Worker secret `GITHUB_DISPATCH_TOKEN`, and `GITHUB_REPO`). It refuses while a run is queued or in progress. `RADAR_ENABLED` still decides: with it off, a run started from there is skipped like any other. Setup and details: [admin.md](admin.md#running-the-agent-from-here-çalıştır-adminrun). It has not been used against the real GitHub API.

**Stopping it.** Delete the variable `RADAR_ENABLED` or set it to anything other than `true`. The job is skipped from the next start on. A run already in progress finishes. Disabling the workflow in the Actions tab works too.

## The site is not rebuilt on a timer

Nothing rebuilds the site on a schedule. The admin service's deploy hook fires when the set of published stories changes (a story is approved, unpublished, edited while published, or arrives already published), and no page of the site depends on the clock, so a rebuild with no change would produce the same pages. See [site.md](site.md#deploy). This part has never been run against a real hook either.
