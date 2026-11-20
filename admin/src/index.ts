import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticate, sameOrigin, type Identity } from "./auth";
import { COPY, failureMessage } from "./copy";
import type { Env } from "./env";
import { ingest } from "./ingest";
import type { Status } from "./schema";
import {
  approveStory,
  counts,
  editStory,
  expireStale,
  getStory,
  listStories,
  PAGE_SIZE,
  rejectStory,
  unpublishStory,
  type EditPatch,
  type Failure,
  type Result,
} from "./stories";
import { CSS, JS } from "./views/assets";
import { STATUSES, layout, storyPath, type View } from "./views/layout";
import { queueView } from "./views/queue";
import { notFoundView, storyView, type Draft } from "./views/story";

type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
type Ctx = Context<AppEnv>;

export const app = new Hono<AppEnv>();

app.get("/healthz", (c) => c.text("ok"));
app.route("/", ingest);

// ---------------------------------------------------------------------------
// Admin screen: everything at /admin and under it is authenticated.
// ---------------------------------------------------------------------------

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
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

async function page(
  c: Ctx,
  p: { title: string; active: Status | null; body: View; message?: string },
  status: ContentfulStatusCode = 200,
): Promise<Response> {
  const shell = layout({ ...p, email: c.get("identity").email, counts: await counts(c.env.DB) });
  return c.html(shell, status);
}

const MAX_PAGE = 1000;

// ?page=N with N an integer from 1 to MAX_PAGE; anything else is page 1.
function pageNumber(raw: string | undefined): number {
  if (!raw || !/^[1-9][0-9]{0,3}$/.test(raw)) return 1;
  const n = Number(raw);
  return n <= MAX_PAGE ? n : 1;
}

app.get("/admin", async (c) => {
  const asked = c.req.query("status");
  const status: Status = STATUSES.find((s) => s === asked) ?? "review";
  const current = pageNumber(c.req.query("page"));
  const now = new Date();
  await expireStale(c.env.DB, now);
  // One row more than a page tells whether an older page exists.
  const rows = await listStories(c.env.DB, status, PAGE_SIZE + 1, (current - 1) * PAGE_SIZE);
  const body = queueView(status, rows.slice(0, PAGE_SIZE), now, { current, hasMore: rows.length > PAGE_SIZE });
  return page(c, { title: COPY.tabs[status], active: status, body });
});

// The story page from a fresh read, optionally with a message and the user's own form values.
async function storyPage(
  c: Ctx,
  uid: string,
  status: ContentfulStatusCode = 200,
  message?: string,
  draft?: Draft,
): Promise<Response> {
  const story = await getStory(c.env.DB, uid);
  if (!story) return page(c, { title: COPY.notFoundTitle, active: null, body: notFoundView() }, 404);
  const body = storyView(story, new Date(), draft);
  const title = story.texts.tr?.title ?? COPY.notFoundTitle;
  return page(c, { title, active: story.status, body, ...(message ? { message } : {}) }, status);
}

app.get("/admin/stories/:uid", (c) => storyPage(c, c.req.param("uid")));

interface Form {
  version: number;
  text: (name: string) => string;
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
  return { version, text };
}

const FAILURE_STATUS: Record<Failure, ContentfulStatusCode> = {
  not_found: 404,
  conflict: 409,
  wrong_status: 409,
  expired: 409,
  too_long: 400,
  invalid: 400,
};

function afterResult(c: Ctx, uid: string, result: Result, success: string, draft?: Draft): Promise<Response> | Response {
  if (result.ok) return c.redirect(success, 303);
  const keep = draft && (result.error === "too_long" || result.error === "invalid") ? draft : undefined;
  return storyPage(c, uid, FAILURE_STATUS[result.error], failureMessage(result.error, result.detail), keep);
}

const badRequest = (c: Ctx) => c.text(COPY.badRequest, 400);

app.post("/admin/stories/:uid/edit", async (c) => {
  const uid = c.req.param("uid");
  const form = await readForm(c.req.raw);
  if (!form) return badRequest(c);
  const textsFor = (lang: "tr" | "en") => ({
    title: form.text(`${lang}_title`),
    summary: form.text(`${lang}_summary`),
    dev_line: form.text(`${lang}_dev_line`),
  });
  const draft: Draft = {
    category: form.text("category"),
    try_url: form.text("try_url"),
    texts: { tr: textsFor("tr"), en: textsFor("en") },
  };
  const patch: EditPatch = {
    category: draft.category,
    try_url: draft.try_url.trim() === "" ? null : draft.try_url,
    texts: draft.texts,
  };
  const result = await editStory(c.env.DB, uid, form.version, patch, c.get("identity").email, new Date());
  return afterResult(c, uid, result, storyPath(uid), draft);
});

app.post("/admin/stories/:uid/approve", async (c) => {
  const uid = c.req.param("uid");
  const form = await readForm(c.req.raw);
  if (!form) return badRequest(c);
  if (form.text("checked") !== "on") return storyPage(c, uid, 400, COPY.mustCheck);
  const result = await approveStory(c.env.DB, uid, form.version, c.get("identity").email, new Date());
  return afterResult(c, uid, result, "/admin");
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
  return afterResult(c, uid, result, storyPath(uid));
});

// Any other path under /admin: the not-found page, reached only after the middleware signed the user in.
app.all("/admin/*", (c) => page(c, { title: COPY.notFoundTitle, active: null, body: notFoundView() }, 404));

// Hourly cron (see wrangler.jsonc): expires review stories aged 72 hours or more.
async function scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  await expireStale(env.DB, new Date(controller.scheduledTime));
}

export default { fetch: app.fetch, scheduled };
