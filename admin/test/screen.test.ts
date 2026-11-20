// The review flow: the next story after a decision, the story's place in its list, the queue's
// search and status strip, undoing a rejection, today's edition, and the phone layout and keys.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import { COPY } from "../src/copy";
import { app } from "../src/index";
import type { IngestStory } from "../src/schema";
import { getStory, insertStories, istanbulDay, rejectStory } from "../src/stories";

const HOUR = 3600_000;
const ORIGIN = "http://localhost";
const dev = { ...env, DEV_NO_AUTH: "1" };
type Json = Record<string, any>;

let n = 0;
async function seed(
  opts: { ageMs?: number; status?: "review" | "published"; title?: string; category?: string; enTitle?: string } = {},
): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = (++n).toString(16).padStart(32, "d");
  s.created_at = new Date(Date.now() - (opts.ageMs ?? HOUR)).toISOString();
  s.status = opts.status ?? "review";
  if (opts.title) s.texts.tr.title = opts.title;
  if (opts.enTitle) s.texts.en.title = opts.enTitle;
  if (opts.category) s.category = opts.category;
  await insertStories(env.DB, [s as IngestStory], new Date());
  return s.uid;
}

const get = (path: string) => app.fetch(new Request(`${ORIGIN}${path}`), dev);
const text = async (path: string) => (await get(path)).text();

async function post(path: string, fields: Record<string, string>, origin: string | null = ORIGIN): Promise<Response> {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  return app.fetch(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: new URLSearchParams(fields) }), dev);
}

const notice = (body: string): string => body.match(/<p class="notice[^"]*"[^>]*>[^<]*<\/p>/)?.[0] ?? "";

describe("the next story after a decision", () => {
  it("approve goes to the next story in queue order and says so; the last decision goes to the all-done queue", async () => {
    const a = await seed({ ageMs: 30 * HOUR });
    const b = await seed({ ageMs: 20 * HOUR });
    const c = await seed({ ageMs: 10 * HOUR });
    const r1 = await post(`/admin/stories/${b}/approve`, { version: "1", checked: "on" });
    expect(r1.status).toBe(303);
    expect(r1.headers.get("Location")).toBe(`/admin/stories/${c}?done=next_approved`);
    expect(notice(await text(r1.headers.get("Location")!))).toBe(
      '<p class="notice done" role="status">Onaylandı. Sıradaki haber.</p>',
    );
    // After the last in the queue, back to the first one skipped.
    const r2 = await post(`/admin/stories/${c}/reject`, { version: "1", note: "" });
    expect(r2.headers.get("Location")).toBe(`/admin/stories/${a}?done=next_rejected`);
    expect(notice(await text(r2.headers.get("Location")!))).toContain(">Reddedildi. Sıradaki haber.<");
    const r3 = await post(`/admin/stories/${a}/reject`, { version: "1", note: "" });
    expect(r3.headers.get("Location")).toBe("/admin?done=rejected");
    const queue = await text("/admin?done=rejected");
    expect(queue).toContain('<div class="empty all-done">');
    expect(queue).toContain(COPY.emptyReviewTitle);
  });

  it("save-and-approve goes to the next story too", async () => {
    const a = await seed({ ageMs: 30 * HOUR });
    const b = await seed({ ageMs: 20 * HOUR });
    const s = (await getStory(env.DB, a))!;
    const fields: Record<string, string> = { version: "1", category: s.category, try_url: "", checked: "on" };
    for (const lang of ["tr", "en"] as const)
      for (const f of ["title", "summary", "dev_line"] as const) fields[`${lang}_${f}`] = s.texts[lang][f];
    fields.tr_title = "Elle düzeltildi";
    const res = await post(`/admin/stories/${a}/approve`, fields);
    expect(res.headers.get("Location")).toBe(`/admin/stories/${b}?done=next_approved`);
    expect((await getStory(env.DB, a))!.texts.tr.title).toBe("Elle düzeltildi");
  });

  it("a failed decision stays on the story as before", async () => {
    const a = await seed();
    await seed();
    const res = await post(`/admin/stories/${a}/approve`, { version: "9", checked: "on" });
    expect(res.status).toBe(409);
  });
});

describe("the story's place in its list", () => {
  it("shows 2 / 3 with links to the stories either side, in queue order", async () => {
    const a = await seed({ ageMs: 30 * HOUR });
    const b = await seed({ ageMs: 20 * HOUR });
    const c = await seed({ ageMs: 10 * HOUR });
    const body = await text(`/admin/stories/${b}`);
    const nav = body.slice(body.indexOf('<nav class="story-nav"'), body.indexOf("</nav>", body.indexOf('<nav class="story-nav"')));
    expect(nav).toContain(`<a class="nav-link" id="story-prev" rel="prev" href="/admin/stories/${a}">← Önceki</a>`);
    expect(nav).toContain(`<a class="nav-link" id="story-next" rel="next" href="/admin/stories/${c}">Sonraki →</a>`);
    expect(nav).toContain('<span class="visually-hidden">Sıra: </span>2 / 3');
    const first = await text(`/admin/stories/${a}`);
    expect(first).not.toContain('id="story-prev"');
    expect(first).toContain("1 / 3");
  });

  it("from today's edition it steps through the edition and goes back there; a foreign `from` is ignored", async () => {
    const p = await seed({ status: "published" });
    const body = await text(`/admin/stories/${p}?from=edition`);
    expect(body).toContain('<a href="/admin/edition">Bugünkü baskıya dön</a>');
    expect(body).toMatch(/<a href="\/admin\/edition"[^>]*aria-current="page"/);
    expect(body).toContain('<input type="hidden" name="from" value="edition">');
    for (const from of ["https://evil.example", "%2F%2Fevil.example", "review"]) {
      const other = await text(`/admin/stories/${p}?from=${from}`);
      expect(other).toContain('<a href="/admin?status=published">Kuyruğa dön</a>');
      expect(other).not.toContain("evil.example");
      expect(other).not.toContain('name="from"');
    }
  });
});

describe("search and filter in the queue", () => {
  it("finds by Turkish or English title, keeps q and cat on tabs and pages, and offers Temizle", async () => {
    await seed({ title: "Yeni ajan çatısı", category: "framework" });
    await seed({ title: "Başka haber", enTitle: "Agent framework ships", category: "framework" });
    await seed({ title: "Model haberi", category: "model" });
    const body = await text("/admin?q=ajan");
    expect(body).toContain("Yeni ajan çatısı");
    expect(body).not.toContain("Model haberi");
    expect(body).toContain('<p class="results">1 sonuç · <strong>“ajan”</strong> <a class="clear" href="/admin?status=review">Temizle</a></p>');
    expect(await text("/admin?cat=model")).toContain('<p class="results">1 sonuç · <strong>Model</strong> <a class="clear"');
    expect((await text("/admin?q=framework")).match(/<li class="card">/g)?.length).toBe(1);
    const byCat = await text("/admin?cat=framework");
    expect(byCat.match(/<li class="card">/g)?.length).toBe(2);
    expect(byCat).toContain('<a class="chip-link" href="/admin?status=review&amp;cat=framework" aria-current="true">Çatı</a>');
    expect(byCat).toContain('<input type="hidden" name="cat" value="framework">');
    // The tabs keep the search.
    expect(byCat).toContain('href="/admin?status=published&amp;cat=framework"');
    expect(byCat).toContain('href="/admin/edition?cat=framework"');
    const both = await text("/admin?q=haber&cat=model");
    expect(both).toContain("Model haberi");
    expect(both).not.toContain("Başka haber</a>");
  });

  it("ignores an unknown category, caps q at 100 characters and escapes it in the value attribute", async () => {
    await seed();
    const unknown = await text("/admin?cat=constructor");
    expect(unknown.match(/<li class="card">/g)?.length).toBe(1);
    expect(unknown).not.toContain('class="results"');
    const hostile = encodeURIComponent('"><script>alert(1)</script>');
    const body = await text(`/admin?q=${hostile}`);
    expect(body).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(body).not.toContain("<script>alert");
    expect(body).toContain(COPY.emptyFiltered);
    const long = await text(`/admin?q=${"y".repeat(150)}`);
    expect(long).toContain(`value="${"y".repeat(100)}"`);
    expect(long).not.toContain("y".repeat(101));
    expect(long).toContain('maxlength="100"');
  });

  it("a search with % or _ matches them literally", async () => {
    await seed({ title: "Fiyat %50 düştü" });
    await seed({ title: "Fiyat 50 düştü" });
    expect((await text("/admin?q=%2550")).match(/<li class="card">/g)?.length).toBe(1);
    expect(await text("/admin?q=_")).toContain(COPY.emptyFiltered);
  });

  it("paging links carry the search", async () => {
    const stories = Array.from({ length: 51 }, (_, i) => {
      const s = structuredClone((sample as Json).stories[0]) as Json;
      s.uid = (++n).toString(16).padStart(32, "e");
      s.created_at = new Date(Date.now() - 60 * HOUR + i * 60_000).toISOString();
      s.status = "review";
      s.texts.tr.title = `Arama ${i + 1}`;
      return s as IngestStory;
    });
    await insertStories(env.DB, stories, new Date());
    const body = await text("/admin?q=Arama&cat=protocol");
    expect(body).toContain('href="/admin?status=review&amp;q=Arama&amp;cat=protocol&amp;page=2"');
    expect(body).toContain("51 sonuç");
  });
});

describe("undo a rejection", () => {
  it("returns a rejected story to the queue from a same-origin form and records who did it", async () => {
    const uid = await seed({ ageMs: 5 * HOUR });
    await rejectStory(env.DB, uid, 1, "yanlış", "owner@example.com", new Date());
    const page = await text(`/admin/stories/${uid}`);
    expect(page).toContain(`<form method="post" action="/admin/stories/${uid}/restore" class="stack">`);
    expect(page).toContain('<button type="submit" id="restore-button">Geri al: kuyruğa döndür</button>');
    const res = await post(`/admin/stories/${uid}/restore`, { version: "2" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/admin/stories/${uid}?done=restored`);
    const s = (await getStory(env.DB, uid))!;
    expect(s.status).toBe("review");
    expect(s.events.at(-1)).toMatchObject({ action: "restored", actor: "dev@localhost" });
    const after = await text(res.headers.get("Location")!);
    expect(notice(after)).toContain(">Haber kuyruğa döndü.<");
    expect(after).toContain("Kuyruğa döndürüldü · dev@localhost");
  });

  it("refuses a foreign origin and a missing one, and changes nothing", async () => {
    const uid = await seed();
    await rejectStory(env.DB, uid, 1, null, "o", new Date());
    for (const origin of ["https://evil.example", null, "null"]) {
      const res = await post(`/admin/stories/${uid}/restore`, { version: "2" }, origin);
      expect(res.status).toBe(403);
    }
    expect((await getStory(env.DB, uid))!).toMatchObject({ status: "rejected", version: 2 });
  });

  it("a stale version gets the conflict page; a story in review gets the wrong-status message", async () => {
    const uid = await seed();
    const wrong = await post(`/admin/stories/${uid}/restore`, { version: "1" });
    expect(wrong.status).toBe(409);
    expect(await wrong.text()).toContain(COPY.failures.wrong_status);
    await rejectStory(env.DB, uid, 1, null, "o", new Date());
    const stale = await post(`/admin/stories/${uid}/restore`, { version: "1" });
    expect(stale.status).toBe(409);
    expect(await stale.text()).toContain(COPY.failures.conflict);
    expect((await getStory(env.DB, uid))!.status).toBe("rejected");
    expect((await post(`/admin/stories/${uid}/restore`, { version: "x" })).status).toBe(400);
  });

  it("past the 72 hours the page has no button and says why, and a post is refused with the reason", async () => {
    const uid = await seed({ ageMs: 73 * HOUR });
    await rejectStory(env.DB, uid, 1, null, "o", new Date(Date.now() - 2 * HOUR));
    const page = await text(`/admin/stories/${uid}`);
    expect(page).not.toContain('id="restore-button"');
    expect(page).toContain(COPY.restoreExpired);
    const res = await post(`/admin/stories/${uid}/restore`, { version: "2" });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(`<p class="notice" role="alert">${COPY.restoreExpired}</p>`);
    expect((await getStory(env.DB, uid))!).toMatchObject({ status: "rejected", version: 2 });
  });

  it("is not reachable by GET", async () => {
    const uid = await seed();
    await rejectStory(env.DB, uid, 1, null, "o", new Date());
    expect((await get(`/admin/stories/${uid}/restore`)).status).toBe(404);
    expect((await getStory(env.DB, uid))!.status).toBe("rejected");
  });
});

describe("today's edition", () => {
  it("lists today's stories newest first with time, category and a take-down behind a disclosure", async () => {
    const early = await seed({ status: "published", title: "Erken haber" });
    const late = await seed({ status: "published", title: "Geç haber", category: "security" });
    const old = await seed({ status: "published", title: "Dünkü haber" });
    const day = istanbulDay(new Date());
    const set = (uid: string, at: string) =>
      env.DB.prepare("UPDATE stories SET published_at = ? WHERE uid = ?").bind(at, uid).run();
    await set(early, new Date(Date.parse(day.start) + HOUR).toISOString());
    await set(late, new Date(Date.parse(day.start) + 2 * HOUR).toISOString());
    await set(old, new Date(Date.parse(day.start) - HOUR).toISOString());
    const body = await text("/admin/edition");
    expect(body).toMatch(/<a href="\/admin\/edition" aria-current="page">Bugün <span class="tab-count">2<\/span><\/a>/);
    expect(body).toContain("<h1 class=\"page-title\">Bugünkü baskı");
    expect(body.indexOf("Geç haber")).toBeLessThan(body.indexOf("Erken haber"));
    expect(body).not.toContain("Dünkü haber");
    expect(body).toContain('<span class="chip ok">01:00</span>'); // 22:00 UTC is 01:00 in Istanbul
    expect(body).toContain('<span class="chip">Güvenlik</span>');
    expect(body).toContain(`href="/admin/stories/${late}?from=edition"`);
    expect(body).toContain(`<form method="post" action="/admin/stories/${late}/unpublish" class="stack">`);
    expect(body).toMatch(/<details class="takedown">\s*<summary>Yayından kaldır…<\/summary>/);
    expect(body.match(/<textarea [^>]*required/g)?.length).toBe(2);
  });

  it("taking a story down from the edition comes back to it; a foreign `from` goes to the story", async () => {
    const a = await seed({ status: "published" });
    const b = await seed({ status: "published" });
    const res = await post(`/admin/stories/${a}/unpublish`, { version: "1", note: "Yanlış", from: "edition" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin/edition?done=unpublished");
    expect(notice(await text("/admin/edition?done=unpublished"))).toContain(">Haber yayından kaldırıldı.<");
    const other = await post(`/admin/stories/${b}/unpublish`, { version: "1", note: "x", from: "https://evil.example" });
    expect(other.headers.get("Location")).toBe(`/admin/stories/${b}?done=unpublished`);
    const refused = await post(`/admin/stories/${b}/unpublish`, { version: "2", note: "x", from: "edition" }, "https://evil.example");
    expect(refused.status).toBe(403);
    // An empty note is still refused.
    const c = await seed({ status: "published" });
    expect((await post(`/admin/stories/${c}/unpublish`, { version: "1", note: " ", from: "edition" })).status).toBe(400);
  });

  it("says so when nothing is published yet today", async () => {
    await seed();
    const body = await text("/admin/edition");
    expect(body).toContain(`<div class="empty"><p>${COPY.editionEmpty}</p></div>`);
    expect(body).toContain('<span class="tab-count">0</span>');
  });

  it("escapes a hostile title", async () => {
    const s = structuredClone((sample as Json).stories[0]) as Json;
    s.uid = "f".repeat(31) + "0";
    s.status = "published";
    s.created_at = new Date().toISOString();
    s.texts.tr.title = "<img src=x onerror=alert(1)>";
    await insertStories(env.DB, [s as IngestStory], new Date());
    const body = await text("/admin/edition");
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain("<img");
  });
});

describe("keys, phone layout and field help", () => {
  it("every page has the hidden keyboard hint and the shortcut sheet, with no inline script or style", async () => {
    for (const path of ["/admin", "/admin/edition", `/admin/stories/${await seed()}`]) {
      const body = await text(path);
      expect(body).toContain('<button type="button" class="kbd-hint" id="shortcuts-open" aria-haspopup="dialog" hidden>Klavye: <kbd>?</kbd></button>');
      expect(body).toContain('<dialog class="sheet" id="shortcuts" aria-labelledby="shortcuts-h">');
      expect(body).not.toMatch(/<script>|style=|\son[a-z]+=/);
    }
  });

  it("the story page marks the approve button and the reject note for the keys", async () => {
    const uid = await seed();
    const body = await text(`/admin/stories/${uid}`);
    expect(body).toMatch(/<button type="submit" class="primary" id="approve-button"[^>]*formaction="[^"]*\/approve"/);
    expect(body).toContain('<textarea id="reject_note" name="note"');
  });

  it("every edit field has a counter against its limit, in the danger colour over it", async () => {
    const uid = await seed();
    const body = await text(`/admin/stories/${uid}`);
    for (const id of ["tr_title", "tr_summary", "tr_dev_line", "en_title", "en_summary", "en_dev_line", "try_url", "reject_note"])
      expect(body).toContain(`id="${id}_count"`);
    expect(body).toContain('<p class="counter" id="try_url_count">0 / 2000</p>');
    expect(body).toContain('<p class="counter" id="reject_note_count">0 / 500</p>');
    const long = await post(`/admin/stories/${uid}/edit`, {
      version: "9",
      category: "model",
      try_url: "",
      tr_title: "x".repeat(95),
      tr_summary: "a",
      tr_dev_line: "b",
      en_title: "c",
      en_summary: "d",
      en_dev_line: "e",
    });
    expect(await long.text()).toContain('<p class="counter over" id="tr_title_count">95 / 90</p>');
    const css = await (await get("/admin/app.css")).text();
    expect(css).toMatch(/\.counter\.over \{[^}]*color: var\(--danger\);/);
    // The save button is never disabled, by markup or by script.
    expect(body).not.toMatch(/<button[^>]*disabled/);
    expect(await (await get("/admin/app.js")).text()).not.toContain("disabled");
  });

  it("at 640 px and below the action bar is fixed to the bottom, with room kept under the form and 44 px targets", async () => {
    const css = await (await get("/admin/app.css")).text();
    const phone = css.slice(css.indexOf("@media (max-width: 40rem)"));
    expect(phone).toMatch(/\.action-bar \{[^}]*position: fixed;[^}]*bottom: 0;/);
    expect(phone).toMatch(/body:has\(\.action-bar\) \{[^}]*padding-bottom: 11rem;/);
    expect(phone).toMatch(/\.bar-buttons button \{ min-height: 3rem; \}/);
    expect(phone).toMatch(/\.tabs \{[^}]*overflow-x: auto;/);
    expect(css).toContain("--tap: 2.75rem;");
    expect(css).not.toContain("box-shadow");
  });

  it("on a phone the bar also leads to the reject card, as a link that rejects nothing by itself", async () => {
    const uid = await seed();
    const body = await text(`/admin/stories/${uid}`);
    const bar = body.slice(body.indexOf('<div class="action-bar">'), body.indexOf("</form>", body.indexOf('<div class="action-bar">')));
    expect(bar).toContain('<a class="bar-reject" href="#reject-card">Reddet…</a>');
    expect(bar).not.toContain("/reject");
    expect(body).toContain('<section class="danger-card" id="reject-card"');
    // Not offered where there is nothing to reject.
    const published = await seed({ status: "published" });
    expect(await text(`/admin/stories/${published}`)).not.toContain("bar-reject");
    const css = await (await get("/admin/app.css")).text();
    expect(css).toMatch(/\.bar-reject \{[^}]*display: none;/);
    const phone = css.slice(css.indexOf("@media (max-width: 40rem)"), css.indexOf("@media (min-width: 40rem)"));
    expect(phone).toMatch(/\.bar-reject \{[^}]*display: inline-flex;[^}]*min-height: 3rem;/);
    // Three in a row at 375 px: the two short controls take their own width, approve the rest.
    expect(phone).toMatch(/\.bar-buttons\.decide \{[^}]*grid-template-columns: auto auto minmax\(0, 1fr\);/);
  });

  it("keys move the selection and the focus, open the sheet, and never submit anything", async () => {
    const js = await (await get("/admin/app.js")).text();
    const page = keyPage(js);
    page.key({ key: "j" });
    expect(page.selected()).toBe(0);
    expect(page.focused).toEqual(["row0"]);
    page.key({ key: "j" });
    page.key({ key: "j" });
    page.key({ key: "j" }); // stays on the last row
    expect(page.selected()).toBe(2);
    page.key({ key: "k" });
    expect(page.selected()).toBe(1);
    page.key({ key: "Enter", target: page.body });
    expect(page.clicked).toEqual(["row1"]);
    // Typing in a field, or with a modifier held, leaves every key alone.
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) page.key({ key: "j", target: { tagName } });
    page.key({ key: "j", target: { tagName: "DIV", isContentEditable: true } });
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) page.key({ key: "j", [mod]: true });
    expect(page.selected()).toBe(1);
    page.key({ key: "a" });
    page.key({ key: "r" });
    expect(page.focused.slice(-2)).toEqual(["approve-button", "reject_note"]);
    page.key({ key: "n" });
    page.key({ key: "n", repeat: true });
    page.key({ key: "p" });
    expect(page.clicked).toEqual(["row1", "story-next", "story-prev"]);
    // "?" (with Shift, as most keyboards type it) toggles the sheet; while it is open other keys rest.
    page.key({ key: "?", shiftKey: true });
    expect(page.sheetOpen()).toBe(true);
    page.key({ key: "n" });
    expect(page.clicked).toHaveLength(3);
    page.key({ key: "?", shiftKey: true });
    expect(page.sheetOpen()).toBe(false);
    expect(page.hintShown()).toBe(true);
    expect(page.submits).toBe(0);
    expect(page.prevented).toBe(page.handled);
  });
});

// A small stand-in for a browser page with three queue rows, the story links, the approve button,
// the reject note and the shortcut sheet. It counts focus moves, link clicks and form submits.
function keyPage(js: string) {
  const listeners: Record<string, ((event: any) => void)[]> = {};
  const on = (type: string, fn: (event: any) => void) => (listeners[type] ??= []).push(fn);
  const state = { focused: [] as string[], clicked: [] as string[], submits: 0, prevented: 0, handled: 0 };
  const el = (id: string) => ({ id, focus: () => state.focused.push(id), click: () => state.clicked.push(id), requestSubmit: () => state.submits++ });
  const rows = [0, 1, 2].map((i) => {
    const classes = new Set<string>();
    const link = el(`row${i}`);
    return {
      classes,
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
      querySelector: () => link,
    };
  });
  const sheet = { open: false, showModal: () => (sheet.open = true), close: () => (sheet.open = false) };
  const opener = { hidden: true, addEventListener: () => {} };
  const ids: Record<string, unknown> = {
    shortcuts: sheet,
    "shortcuts-open": opener,
    "story-next": el("story-next"),
    "story-prev": el("story-prev"),
    "approve-button": el("approve-button"),
    reject_note: el("reject_note"),
  };
  const body = { tagName: "BODY" };
  const document = {
    body,
    documentElement: { tagName: "HTML" },
    addEventListener: on,
    querySelectorAll: (sel: string) => (sel === ".cards > .card" ? rows : []),
    getElementById: (id: string) => ids[id] ?? null,
  };
  const window = { location: { pathname: "/admin", search: "", hash: "" }, history: {}, addEventListener: on, removeEventListener: () => {} };
  new Function("document", "window", js)(document, window);
  for (const fn of listeners.DOMContentLoaded ?? []) fn({});
  return {
    ...state,
    get focused() { return state.focused; },
    get clicked() { return state.clicked; },
    get submits() { return state.submits; },
    get prevented() { return state.prevented; },
    get handled() { return state.handled; },
    body,
    key(init: Record<string, unknown>) {
      const event = { target: null, repeat: false, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...init, preventDefault: () => state.prevented++ };
      const before = state.focused.length + state.clicked.length + Number(sheet.open);
      for (const fn of listeners.keydown ?? []) fn(event);
      if (state.focused.length + state.clicked.length + Number(sheet.open) !== before) state.handled++;
    },
    selected: () => rows.findIndex((r) => r.classes.has("is-selected")),
    sheetOpen: () => sheet.open,
    hintShown: () => opener.hidden === false,
  };
}
