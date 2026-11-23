import { Hono, type Context } from "hono";
import { confirmMail } from "./email";
import type { Env } from "./env";
import { confirmLink, mailConfig, sendOne, siteUrl } from "./mail";
import type { Lang } from "./schema";
import {
  confirmSubscriber,
  findByToken,
  markConfirmSent,
  normalizeEmail,
  removeSubscriber,
  requestSubscription,
} from "./subscribers";
import { PAGE_CSS, PAGE_CSS_PATH, askView, resultView, type SiteLinks } from "./views/newsletter";

// The e-mail newsletter's public addresses. None needs a sign-in; none sets or reads a cookie.
//
//   POST /api/subscribe              the site's form: stores the address as pending and mails a
//                                    confirmation link, then sends the reader back to the site.
//   GET  /api/subscribe/confirm      the link in that mail: a page with one button.
//   POST /api/subscribe/confirm      the button: the address is confirmed.
//   GET  /api/unsubscribe            the link under every mail: a page with one button.
//   POST /api/unsubscribe            the button, and a mail client's own one-click unsubscribe
//                                    (RFC 8058): the address is deleted.
//
// A change needs a POST, so a mail scanner that opens every link in a mail neither confirms an
// address nor removes a reader.

export const newsletter = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

const FORM_MAX_BYTES = 4096;

// The token is in these pages' address: nothing is cached and no address is passed on as a referrer.
const PAGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

const links = (env: Env, lang: Lang): SiteLinks => {
  const site = siteUrl(env);
  return lang === "tr" ? { home: `${site}/`, subscribe: `${site}/abone/` } : { home: `${site}/en/`, subscribe: `${site}/en/subscribe/` };
};

// What the site's subscribe page shows after the form: each is the id of a notice on that page,
// shown when the address ends with it.
export type FormState = "sent" | "invalid" | "later" | "error" | "closed";

function back(c: Ctx, lang: Lang, state: FormState): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: `${links(c.env, lang).subscribe}#mail-${state}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

newsletter.get(PAGE_CSS_PATH, (c) =>
  c.body(PAGE_CSS, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  }),
);

newsletter.post("/api/subscribe", async (c) => {
  // A plain HTML form only, and a small one: the body is measured as read, not as declared.
  if (!(c.req.header("Content-Type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return c.text("Bad Request", 400);
  }
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (!Number.isFinite(declared) || declared > FORM_MAX_BYTES) return c.text("Payload Too Large", 413);
  const raw = await c.req.raw.arrayBuffer();
  if (raw.byteLength > FORM_MAX_BYTES) return c.text("Payload Too Large", 413);
  const form = new URLSearchParams(new TextDecoder().decode(raw));
  const lang: Lang = form.get("lang") === "en" ? "en" : "tr";
  // A field no reader sees or fills in. Whoever fills it gets the same answer as everyone else.
  const trap = form.get("website");
  if (typeof trap === "string" && trap.trim() !== "") return back(c, lang, "sent");
  const email = normalizeEmail(form.get("email"));
  if (!email) return back(c, lang, "invalid");
  const cfg = mailConfig(c.env);
  if (!cfg) return back(c, lang, "closed");

  const now = new Date();
  const request = await requestSubscription(c.env.DB, email, lang, now);
  if (request.kind === "later") return back(c, lang, "later");
  if (request.kind === "quiet") return back(c, lang, "sent");
  const { subscriber } = request;
  const mail = confirmMail(lang, { confirmUrl: confirmLink(cfg, subscriber.token), siteUrl: cfg.siteUrl });
  const result = await sendOne(cfg, { to: subscriber.email, mail }, `radar-confirm-${subscriber.id}-${now.getTime()}`);
  if (!result.ok) {
    console.error("confirmation mail not sent", result.error);
    return back(c, lang, "error");
  }
  await markConfirmSent(c.env.DB, subscriber.id, now);
  return back(c, lang, "sent");
});

// The language of a page for a link nobody is behind: Turkish unless the browser asks for another.
function guessLang(c: Ctx): Lang {
  const accept = c.req.header("Accept-Language") ?? "";
  return accept === "" || /(^|,)\s*tr\b/i.test(accept) ? "tr" : "en";
}

const pageOf = (c: Ctx, view: ReturnType<typeof resultView>, status: 200 | 404 = 200) => c.html(view, status, PAGE_HEADERS);

function invalid(c: Ctx): Response | Promise<Response> {
  const lang = guessLang(c);
  return pageOf(c, resultView(lang, "invalid", links(c.env, lang)), 404);
}

newsletter.get("/api/subscribe/confirm", async (c) => {
  const token = c.req.query("token") ?? "";
  const reader = await findByToken(c.env.DB, token);
  if (!reader) return invalid(c);
  const site = links(c.env, reader.lang);
  if (reader.status === "confirmed") return pageOf(c, resultView(reader.lang, "confirmed", site));
  return pageOf(c, askView(reader.lang, "confirm", reader.email, `/api/subscribe/confirm?token=${reader.token}`, site));
});

newsletter.post("/api/subscribe/confirm", async (c) => {
  const reader = await confirmSubscriber(c.env.DB, c.req.query("token") ?? "", new Date());
  if (!reader) return invalid(c);
  return pageOf(c, resultView(reader.lang, "confirmed", links(c.env, reader.lang)));
});

newsletter.get("/api/unsubscribe", async (c) => {
  const reader = await findByToken(c.env.DB, c.req.query("token") ?? "");
  if (!reader) return invalid(c);
  const site = links(c.env, reader.lang);
  return pageOf(c, askView(reader.lang, "leave", reader.email, `/api/unsubscribe?token=${reader.token}`, site));
});

// Leaving always answers "you are off the list": it is true for a token nobody has, too, and a
// mail client's one-click request expects a plain success.
newsletter.post("/api/unsubscribe", async (c) => {
  const reader = await removeSubscriber(c.env.DB, c.req.query("token") ?? "");
  const lang = reader?.lang ?? guessLang(c);
  return pageOf(c, resultView(lang, "left", links(c.env, lang)));
});
