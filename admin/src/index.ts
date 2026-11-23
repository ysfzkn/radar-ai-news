import { Hono, type Context } from "hono";
import { html } from "hono/html";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticate, sameOrigin, type Identity } from "./auth";
import { z } from "zod";
import { COPY, failureMessage } from "./copy";
import type { Env } from "./env";
import { RUN_MODES, dispatchRun, githubConfig, isActive, listRuns, type RunInputs, type RunsResult } from "./github";
import { sendDaily } from "./daily";
import { mailConfig } from "./mail";
import { ingest } from "./ingest";
import { newsletter } from "./newsletter";
import { notifySite, waiter } from "./notify";
import { publicApi } from "./public";
import type { Lang, Status } from "./schema";
import { cooldownLeft, finishDispatch, recentDispatches, reserveDispatch } from "./runs";
import {
  approveStory,
  counts,
  countStories,
  editStory,
  expireStale,
  getStory,
  listEdition,
  listStories,
  nextInQueue,
  PAGE_SIZE,
  publishedToday,
  queueFilter,
  rejectStory,
  restoreStory,
  storyPosition,
  unpublishStory,
  type EditPatch,
  type Failure,
  type QueueFilter,
  type Result,
  type StoryFull,
  type Tab,
} from "./stories";
import { SUBSCRIBERS_PAGE, lastMailing, listSubscribers, purgePending, removeById, subscriberTotals } from "./subscribers";
import { CSS, JS } from "./views/assets";
import { editionView } from "./views/edition";
import { STATUSES, formatDay, layout, listHref, storyPath, type Page, type View } from "./views/layout";
import { queueView, type QueueStrip } from "./views/queue";
import { busyMessage, minutesLeft, runView } from "./views/run";
import { draftFrom, notFoundView, storyView, type Draft } from "./views/story";
import { subscribersHref, subscribersView } from "./views/subscribers";

type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
type Ctx = Context<AppEnv>;

export const app = new Hono<AppEnv>();

app.get("/healthz", (c) => c.text("ok"));
app.route("/", ingest);
app.route("/", publicApi);
app.route("/", newsletter);

// ---------------------------------------------------------------------------
// Admin screen: everything at /admin and under it is authenticated.
// ---------------------------------------------------------------------------

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

function secure(res: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value);
  return res;
}

const isAdminPath = (path: string): boolean => path === "/admin" || path.startsWith("/admin/");

app.use("*", async (c, next) => {
  if (!isAdminPath(c.req.path)) return next();
  const identity = await authenticate(c.req.raw, c.env);
  if (identity instanceof Response) return secure(identity);
  if (!sameOrigin(c.req.raw)) return secure(c.text(COPY.forbidden, 403));
  c.set("identity", identity);
  await next();
  c.res = secure(c.res);
});

app.get("/admin/app.css", (c) => c.body(CSS, 200, { "Content-Type": "text/css; charset=utf-8" }));
app.get("/admin/app.js", (c) => c.body(JS, 200, { "Content-Type": "text/javascript; charset=utf-8" }));

// The confirmations a redirect may ask for with ?done=; any other value says nothing.
const DONE = ["saved", "approved", "rejected", "unpublished", "restored", "next_approved", "next_rejected", "dispatched", "subscriber_removed"] as const;
type Done = (typeof DONE)[number];

function doneMessage(c: Ctx): string | undefined {
  const asked = c.req.query("done");
  const known = DONE.find((d) => d === asked);
  return known ? COPY.done[known] : undefined;
}

const withDone = (path: string, done: Done): string => `${path}?done=${done}`;

async function page(
  c: Ctx,
  p: {
    title: string;
    active: Page | null;
    body: View;
    message?: string;
    done?: string | undefined;
    counts?: Record<Status, number>;
    today?: number;
    filter?: QueueFilter;
  },
  status: ContentfulStatusCode = 200,
): Promise<Response> {
  const all = p.counts ?? (await counts(c.env.DB));
  const edition = p.today ?? (await publishedToday(c.env.DB, new Date()));
  const shell = layout({ ...p, email: c.get("identity").email, counts: { ...all, edition } });
  return c.html(shell, status);
}

const MAX_PAGE = 1000;

// ?page=N with N an integer from 1 to MAX_PAGE; anything else is page 1.
function pageNumber(raw: string | undefined): number {
  if (!raw || !/^[1-9][0-9]{0,3}$/.test(raw)) return 1;
  const n = Number(raw);
  return n <= MAX_PAGE ? n : 1;
}

// ?q= and ?cat= of the queue's search, validated (see queueFilter).
const filterOf = (c: Ctx): QueueFilter => queueFilter(c.req.query("q"), c.req.query("cat"));

app.get("/admin", async (c) => {
  const asked = c.req.query("status");
  const status: Status = STATUSES.find((s) => s === asked) ?? "review";
  const current = pageNumber(c.req.query("page"));
  const filter = filterOf(c);
  const filtered = filter.q !== "" || filter.cat !== null;
  const now = new Date();
  await expireStale(c.env.DB, now);
  // One row more than a page tells whether a next page exists.
  const rows = await listStories(c.env.DB, status, PAGE_SIZE + 1, (current - 1) * PAGE_SIZE, filter);
  const all = await counts(c.env.DB);
  const today = await publishedToday(c.env.DB, now);
  let strip: QueueStrip | null = null;
  if (status === "review") {
    // The whole queue, whatever the search: oldest first, so its first story also expires soonest.
    const first = (await listStories(c.env.DB, "review", 1, 0))[0];
    strip = { waiting: all.review, today, oldest: first ? { created_at: first.created_at, expires_at: first.expires_at } : null };
  }
  const total = filtered ? await countStories(c.env.DB, status, filter) : null;
  const body = queueView(status, rows.slice(0, PAGE_SIZE), now, { current, hasMore: rows.length > PAGE_SIZE }, { filter, total, strip });
  return page(c, { title: COPY.tabs[status], active: status, body, counts: all, today, filter, done: doneMessage(c) });
});

app.get("/admin/edition", async (c) => {
  const now = new Date();
  const rows = await listEdition(c.env.DB, now);
  const body = editionView(rows, formatDay(now));
  return page(c, { title: COPY.editionHeading, active: "edition", body, today: rows.length, filter: filterOf(c), done: doneMessage(c) });
});

// The story page from a fresh read, optionally with a message and the user's own form values.
// The list it steps through is today's edition when the page was opened from there
// (`from=edition`, matched against the known name, never used as an address) and the story is in
// it; otherwise the tab of the story's own status.
async function storyPage(
  c: Ctx,
  uid: string,
  status: ContentfulStatusCode = 200,
  message?: string,
  draft?: Draft,
  done?: string,
  from?: string,
): Promise<Response> {
  const story = await getStory(c.env.DB, uid);
  if (!story) return page(c, { title: COPY.notFoundTitle, active: null, body: notFoundView() }, 404);
  const now = new Date();
  let tab: Tab = story.status;
  let position = null;
  if (from === "edition") {
    position = await storyPosition(c.env.DB, uid, "edition", now);
    if (position) tab = "edition";
  }
  position ??= await storyPosition(c.env.DB, uid, story.status, now);
  const body = storyView(story, now, draft, draft !== undefined && differs(story, draft), { tab, position });
  const title = story.texts.tr?.title ?? COPY.notFoundTitle;
  return page(c, { title, active: tab, body, done, ...(message ? { message } : {}) }, status);
}

app.get("/admin/stories/:uid", (c) =>
  storyPage(c, c.req.param("uid"), 200, undefined, undefined, doneMessage(c), c.req.query("from")),
);

interface Form {
  version: number;
  text: (name: string) => string;
  has: (name: string) => boolean;
}

// null when the body is not a form or `version` is not a positive integer.
async function readForm(request: Request): Promise<Form | null> {
  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return null;
  }
  const text = (name: string): string => {
    const value = data.get(name);
    return typeof value === "string" ? value : "";
  };
  const raw = text("version");
  const version = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(version)) return null;
  return { version, text, has: (name) => data.has(name) };
}

const LANGS = ["tr", "en"] as const;
const TEXT_FIELDS = ["title", "summary", "dev_line"] as const;

// The edit fields of a form, as typed.
function draftOf(form: Form): Draft {
  const textsFor = (lang: Lang) => ({
    title: form.text(`${lang}_title`),
    summary: form.text(`${lang}_summary`),
    dev_line: form.text(`${lang}_dev_line`),
  });
  return {
    category: form.text("category"),
    try_url: form.text("try_url"),
    texts: { tr: textsFor("tr"), en: textsFor("en") },
  };
}

const patchOf = (d: Draft): EditPatch => ({
  category: d.category,
  try_url: d.try_url.trim() === "" ? null : d.try_url,
  texts: d.texts,
});

// Whether saving the draft would change the stored story (texts and link compared trimmed).
function differs(story: StoryFull, d: Draft): boolean {
  const stored = draftFrom(story);
  if (d.category !== stored.category || d.try_url.trim() !== stored.try_url.trim()) return true;
  return LANGS.some((lang) => TEXT_FIELDS.some((f) => d.texts[lang][f].trim() !== stored.texts[lang][f].trim()));
}

const FAILURE_STATUS: Record<Failure, ContentfulStatusCode> = {
  not_found: 404,
  conflict: 409,
  wrong_status: 409,
  expired: 409,
  too_long: 400,
  invalid: 400,
};

// A version conflict on a form with edit fields: while the story is still in one of `keepFor`, the
// page shows what was typed, with the story's current version, so the next save is a deliberate
// overwrite. Otherwise (rejected or expired meanwhile; for approve, also published meanwhile, so a
// stale form cannot become an edit of a live story) the story is shown as it is now.
async function conflictPage(c: Ctx, uid: string, draft: Draft, keepFor: readonly Status[]): Promise<Response> {
  const story = await getStory(c.env.DB, uid);
  if (!story || !keepFor.includes(story.status))
    return storyPage(c, uid, FAILURE_STATUS.conflict, failureMessage("conflict"));
  return storyPage(c, uid, FAILURE_STATUS.conflict, COPY.conflictKept, draft);
}

const EDITABLE: readonly Status[] = ["review", "published"];

function afterResult(
  c: Ctx,
  uid: string,
  result: Result,
  success: string,
  draft?: Draft,
  keepFor: readonly Status[] = EDITABLE,
): Promise<Response> | Response {
  if (result.ok) return c.redirect(success, 303);
  if (draft && result.error === "conflict") return conflictPage(c, uid, draft, keepFor);
  const keep = draft && (result.error === "too_long" || result.error === "invalid") ? draft : undefined;
  return storyPage(c, uid, FAILURE_STATUS[result.error], failureMessage(result.error, result.detail), keep);
}

const badRequest = (c: Ctx) => c.text(COPY.badRequest, 400);

// After an approval or a rejection: the next story waiting in the queue (in queue order, after the
// one just decided), or the queue itself, which then shows its all-done state. Built from a uid
// read from the database and fixed paths only.
// The decision is already stored when this runs, so a failure here (the lookup, the expiry) must not turn into the error page: it falls back to the queue with the usual notice.
// Only the error's name is logged, never story text.
async function afterDecision(c: Ctx, uid: string, kind: "approved" | "rejected"): Promise<string> {
  try {
    const decided = await getStory(c.env.DB, uid);
    const next = decided ? await nextInQueue(c.env.DB, { created_at: decided.created_at, uid }, new Date()) : null;
    if (!next) return withDone("/admin", kind);
    return withDone(storyPath(next), kind === "approved" ? "next_approved" : "next_rejected");
  } catch (e) {
    console.error("after a decision: the next story could not be found", e instanceof Error ? e.name : "error");
    return withDone("/admin", kind);
  }
}

// The deploy hook after a stored decision; it never throws.
function tellSite(c: Ctx): void {
  try {
    notifySite(c.env, waiter(c));
  } catch (e) {
    console.error("deploy hook not called", e instanceof Error ? e.name : "error");
  }
}

app.post("/admin/stories/:uid/edit", async (c) => {
  const uid = c.req.param("uid");
  const form = await readForm(c.req.raw);
  if (!form) return badRequest(c);
  const draft = draftOf(form);
  const result = await editStory(c.env.DB, uid, form.version, patchOf(draft), c.get("identity").email, new Date());
  // An edit keeps the status, so a story that is published now was published before it.
  if (result.ok && (await getStory(c.env.DB, uid))?.status === "published") tellSite(c);
  return afterResult(c, uid, result, withDone(storyPath(uid), "saved"), draft);
});

// "Kaydet ve onayla": saves the form's text when it differs from the stored story, then approves.
// A body without the edit fields (no tr_title) approves the saved text, as before.
app.post("/admin/stories/:uid/approve", async (c) => {
  const uid = c.req.param("uid");
  const form = await readForm(c.req.raw);
  if (!form) return badRequest(c);
  const draft = form.has("tr_title") ? draftOf(form) : undefined;
  if (form.text("checked") !== "on") {
    // A stale form is a conflict first: re-rendering it with the current version would let the
    // next click save its old text over the newer one.
    if (draft) {
      const current = await getStory(c.env.DB, uid);
      if (current && current.version !== form.version) return conflictPage(c, uid, draft, ["review"]);
    }
    return storyPage(c, uid, 400, COPY.mustCheck, draft);
  }
  const actor = c.get("identity").email;
  let version = form.version;
  let saved = false;
  if (draft) {
    const story = await getStory(c.env.DB, uid);
    // Only a story in review is saved here; any other status goes straight to approveStory, which refuses it.
    if (story?.status === "review" && differs(story, draft)) {
      const edited = await editStory(c.env.DB, uid, version, patchOf(draft), actor, new Date());
      if (!edited.ok) return afterResult(c, uid, edited, "/admin", draft, ["review"]);
      version += 1;
      saved = true;
    }
  }
  const result = await approveStory(c.env.DB, uid, version, actor, new Date());
  if (result.ok) {
    tellSite(c);
    return c.redirect(await afterDecision(c, uid, "approved"), 303);
  }
  if (!saved) return afterResult(c, uid, result, "/admin", draft, ["review"]);
  const message = `${COPY.savedNotApproved} ${failureMessage(result.error, result.detail)}`;
  return storyPage(c, uid, FAILURE_STATUS[result.error], message);
});

app.post("/admin/stories/:uid/reject", async (c) => {
  const uid = c.req.param("uid");
  const form = await readForm(c.req.raw);
  if (!form) return badRequest(c);
  const note = form.text("note");
  const result = await rejectStory(
    c.env.DB,
    uid,
    form.version,
    note.trim() === "" ? null : note,
    c.get("identity").email,
    new Date(),
  );
  if (result.ok) return c.redirect(await afterDecision(c, uid, "rejected"), 303);
  return afterResult(c, uid, result, "/admin");
});

app.post("/admin/stories/:uid/unpublish", async (c) => {
  const uid = c.req.param("uid");
  const form = await readForm(c.req.raw);
  if (!form) return badRequest(c);
  const result = await unpublishStory(
    c.env.DB,
    uid,
    form.version,
    form.text("note"),
    c.get("identity").email,
    new Date(),
  );
  if (result.ok) tellSite(c);
  // From today's edition the answer goes back there; `from` is compared with the one known name.
  const back = form.text("from") === "edition" ? listHref("edition") : storyPath(uid);
  return afterResult(c, uid, result, withDone(back, "unpublished"));
});

// "Geri al": a rejected story goes back to the queue, while its 72 hours last.
app.post("/admin/stories/:uid/restore", async (c) => {
  const uid = c.req.param("uid");
  const form = await readForm(c.req.raw);
  if (!form) return badRequest(c);
  const result = await restoreStory(c.env.DB, uid, form.version, c.get("identity").email, new Date());
  if (!result.ok && result.error === "expired") return storyPage(c, uid, FAILURE_STATUS.expired, COPY.restoreExpired);
  return afterResult(c, uid, result, withDone(storyPath(uid), "restored"));
});

// ---------------------------------------------------------------------------
// "Çalıştır": starting the daily workflow on GitHub Actions (see src/github.ts, src/runs.ts).
// ---------------------------------------------------------------------------

// The run page. `runs` is GitHub's list when the caller already has it, so a refusal does not ask
// GitHub twice; otherwise it is read here (when running from here is set up at all).
async function runPage(
  c: Ctx,
  p: { status?: ContentfulStatusCode; message?: string; runs?: RunsResult; form?: RunInputs } = {},
): Promise<Response> {
  const cfg = githubConfig(c.env);
  const now = new Date();
  const runs = cfg ? (p.runs ?? (await listRuns(cfg))) : null;
  const cooldownMs = await cooldownLeft(c.env.DB, now);
  const history = await recentDispatches(c.env.DB);
  const body = runView({ configured: cfg !== null, runs, cooldownMs, history, form: p.form, hasMessage: p.message !== undefined });
  return page(
    c,
    { title: COPY.run.title, active: "run", body, done: doneMessage(c), ...(p.message ? { message: p.message } : {}) },
    p.status ?? 200,
  );
}

app.get("/admin/run", (c) => runPage(c));

// The form's two fields, each from a closed list; nothing typed is passed on. The story count is
// "" (the agent's default) or 1 to 8, and is dropped for "collect only", which writes no story.
const runForm = z.object({
  mode: z.enum(RUN_MODES),
  stories: z.union([z.literal(""), z.string().regex(/^[1-8]$/)]),
});

async function readRunForm(request: Request): Promise<RunInputs | null> {
  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return null;
  }
  const parsed = runForm.safeParse({ mode: data.get("mode"), stories: data.get("stories") ?? "" });
  if (!parsed.success) return null;
  const { mode, stories } = parsed.data;
  return { mode, stories: mode === "collect_only" || stories === "" ? null : Number(stories) };
}

// Checks, in order: set up; a valid choice; GitHub's list readable and no run queued or running;
// the cool-down (with the row that records this start, written in the same statement); then the
// start itself, whose answer completes the row. Only a start GitHub accepted redirects.
app.post("/admin/run", async (c) => {
  const cfg = githubConfig(c.env);
  if (!cfg) return runPage(c, { status: 503 });
  const inputs = await readRunForm(c.req.raw);
  if (!inputs) return runPage(c, { status: 400, message: COPY.run.invalid });
  const runs = await listRuns(cfg);
  if (!runs.ok) return runPage(c, { status: 502, message: COPY.run.unknownState, runs, form: inputs });
  const active = runs.runs.find(isActive);
  if (active) return runPage(c, { status: 409, message: busyMessage(active), runs, form: inputs });
  const now = new Date();
  const id = await reserveDispatch(c.env.DB, c.get("identity").email, inputs, now);
  if (id === null) {
    const left = await cooldownLeft(c.env.DB, now);
    return runPage(c, { status: 409, message: COPY.run.cooldown(minutesLeft(left)), runs, form: inputs });
  }
  const result = await dispatchRun(cfg, inputs);
  await finishDispatch(c.env.DB, id, result, new Date());
  if (result.ok) return c.redirect(withDone("/admin/run", "dispatched"), 303);
  return runPage(c, { status: 502, message: COPY.run.dispatchFailed(COPY.run.failures[result.error]), runs, form: inputs });
});

// ---------------------------------------------------------------------------
// "Aboneler": the newsletter's readers (see src/subscribers.ts). Read-only but for one action,
// deleting a reader, which is what leaving the list does too.
// ---------------------------------------------------------------------------

async function subscribersPage(c: Ctx, p: { status?: ContentfulStatusCode; message?: string } = {}): Promise<Response> {
  const current = pageNumber(c.req.query("page"));
  // One row more than a page tells whether a next page exists.
  const rows = await listSubscribers(c.env.DB, SUBSCRIBERS_PAGE + 1, (current - 1) * SUBSCRIBERS_PAGE);
  const body = subscribersView({
    totals: await subscriberTotals(c.env.DB),
    last: await lastMailing(c.env.DB),
    rows: rows.slice(0, SUBSCRIBERS_PAGE),
    page: { current, hasMore: rows.length > SUBSCRIBERS_PAGE },
    sending: mailConfig(c.env) !== null,
  });
  return page(
    c,
    { title: COPY.subscribers.title, active: "subscribers", body, done: doneMessage(c), ...(p.message ? { message: p.message } : {}) },
    p.status ?? 200,
  );
}

app.get("/admin/subscribers", (c) => subscribersPage(c));

// The id is digits only; nothing else reaches the database. Who was deleted is not recorded
// anywhere: keeping the address in a history would defeat the deletion.
app.post("/admin/subscribers/:id/delete", async (c) => {
  const raw = c.req.param("id");
  if (!/^[1-9][0-9]{0,14}$/.test(raw)) return badRequest(c);
  const removed = await removeById(c.env.DB, Number(raw));
  if (!removed) return subscribersPage(c, { status: 404, message: COPY.subscribers.notFound });
  return c.redirect(withDone(subscribersHref(), "subscriber_removed"), 303);
});

// An error thrown on an admin page (for example a decision whose history row the database refused,
// so the batch was rolled back) is an error page, never a success redirect. It says nothing about
// the cause; the details go to the Worker's log only. The tab numbers are read if the database
// answers, and left out (zeros) if it does not.
app.onError(async (err, c) => {
  console.error(err);
  if (!isAdminPath(c.req.path) || !c.get("identity")) return c.text("Internal Server Error", 500);
  let all: Record<Status, number> = { review: 0, published: 0, rejected: 0, expired: 0 };
  try {
    all = await counts(c.env.DB);
  } catch {
    // keep the zeros
  }
  const body = html`<h1>${COPY.serverErrorTitle}</h1><p><a href="/admin">${COPY.back}</a></p>`;
  return c.html(
    layout({ title: COPY.serverErrorTitle, email: c.get("identity").email, counts: all, active: null, message: COPY.serverError, body }),
    500,
  );
});

// Any other path under /admin: the not-found page, reached only after the middleware signed the user in.
app.all("/admin/*", (c) => page(c, { title: COPY.notFoundTitle, active: null, body: notFoundView() }, 404));

// Hourly cron (see wrangler.jsonc): expires review stories aged 72 hours or more, deletes
// newsletter addresses left unconfirmed for 7 days, and mails today's edition to the readers who
// have not had it (see src/daily.ts). The newsletter's steps never stop the expiry or each other:
// a failure is logged by its name only.
async function scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  const now = new Date(controller.scheduledTime);
  await expireStale(env.DB, now);
  for (const [name, step] of [
    ["purge", () => purgePending(env.DB, now)],
    ["daily mail", () => sendDaily(env, now)],
  ] as const) {
    try {
      await step();
    } catch (e) {
      console.error(`newsletter: ${name} failed`, e instanceof Error ? e.name : "error");
    }
  }
}

export default { fetch: app.fetch, scheduled };
