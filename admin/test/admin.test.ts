import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import { COPY } from "../src/copy";
import { app } from "../src/index";
import type { IngestStory } from "../src/schema";
import { getStory, insertStories, rejectStory } from "../src/stories";
import { categoryLabel, layout } from "../src/views/layout";
import { html } from "hono/html";

const HOUR = 3600_000;
const ORIGIN = "http://localhost";
const dev = { ...env, DEV_NO_AUTH: "1" };
type Json = Record<string, any>;

let n = 0;
// Inserts one story created `ageMs` before the real clock (the routes use the real clock).
async function seed(
  opts: { ageMs?: number; status?: "review" | "published"; mutate?: (s: Json) => void } = {},
): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = (++n).toString(16).padStart(32, "a");
  s.created_at = new Date(Date.now() - (opts.ageMs ?? HOUR)).toISOString();
  s.status = opts.status ?? "review";
  opts.mutate?.(s);
  await insertStories(env.DB, [s as IngestStory], new Date());
  return s.uid;
}

// Inserts `count` review stories titled "Sıra 1" (oldest, first in the queue) to "Sıra count".
async function seedQueue(count: number): Promise<void> {
  const stories = Array.from({ length: count }, (_, i) => {
    const s = structuredClone((sample as Json).stories[0]) as Json;
    s.uid = (++n).toString(16).padStart(32, "b");
    s.created_at = new Date(Date.now() - 60 * HOUR + i * 60_000).toISOString();
    s.status = "review";
    s.texts.tr.title = `Sıra ${i + 1}`;
    return s as IngestStory;
  });
  await insertStories(env.DB, stories, new Date());
}

const cardCount = (body: string): number => (body.match(/<li class="card">/g) ?? []).length;

const get = (path: string, e: Json = dev) => app.fetch(new Request(`${ORIGIN}${path}`), e);

async function post(path: string, fields: Record<string, string>, origin: string | null = ORIGIN): Promise<Response> {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  return app.fetch(
    new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: new URLSearchParams(fields) }),
    dev,
  );
}

const editFields = (version: number, change: Record<string, string> = {}): Record<string, string> => ({
  version: String(version),
  category: "model",
  try_url: "",
  tr_title: "Yeni başlık",
  tr_summary: "Yeni özet.",
  tr_dev_line: "Yeni geliştirici notu.",
  en_title: "New title",
  en_summary: "New summary.",
  en_dev_line: "New developer line.",
  ...change,
});

// The edit fields exactly as the stored story holds them (what an untouched form posts).
async function storedFields(uid: string): Promise<Record<string, string>> {
  const s = (await getStory(env.DB, uid))!;
  const fields: Record<string, string> = {
    version: String(s.version),
    category: s.category,
    try_url: s.fact_card.try_url ?? "",
  };
  for (const lang of ["tr", "en"] as const)
    for (const f of ["title", "summary", "dev_line"] as const) fields[`${lang}_${f}`] = s.texts[lang][f];
  return fields;
}

const actionsOf = (s: { events: { action: string }[] }): string[] => s.events.map((e) => e.action);

describe("admin screen", () => {
  it("shows the review queue with the Turkish title, the reasons and the time left", async () => {
    await seed({ ageMs: 57.5 * HOUR });
    await seed({ ageMs: 70 * HOUR, mutate: (s) => (s.texts.tr.title = "Acil haber") });
    const res = await get("/admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain('lang="tr"');
    expect(body).toContain("Radar · Onay");
    expect(body).toContain("dev@localhost");
    for (const tab of ["Bekleyen", "Yayında", "Reddedilen", "Süresi dolan"]) expect(body).toContain(tab);
    expect(body).toContain("A2UI 1.0 aday sürümü yayında");
    expect(body).toContain("en.summary: number 40% not in source");
    expect(body).toContain("4 kaynak");
    expect(body).toContain("Protokol");
    expect(body).toContain("Kalan süre: 14 sa");
    expect(body).toMatch(/class="[^"]*warn[^"]*"[^>]*>Kalan süre: 1 sa/);
    expect(body).not.toMatch(/class="[^"]*warn[^"]*"[^>]*>Kalan süre: 14 sa/);
    expect(body).not.toContain("style=");
    expect(body).not.toMatch(/<script>/);
  });

  it("shows the empty state and the publish mode on published cards", async () => {
    expect(await (await get("/admin")).text()).toContain("Bekleyen haber yok.");
    await seed({ status: "published" });
    const body = await (await get("/admin?status=published")).text();
    expect(body).toContain("otomatik yayın");
  });

  it("escapes a hostile title and reason in the queue and on the story page", async () => {
    const uid = await seed({
      mutate: (s) => {
        s.texts.tr.title = "<script>alert(1)</script>";
        s.texts.en.title = "<script>alert(1)</script>";
        s.reasons = ['" onmouseover="x'];
      },
    });
    for (const path of ["/admin", `/admin/stories/${uid}`]) {
      const body = await (await get(path)).text();
      expect(body).toContain("&lt;script&gt;");
      expect(body).toContain("&quot; onmouseover");
      expect(body).not.toContain("<script>alert(1)</script>");
      expect(body).not.toContain('" onmouseover="x');
    }
  });

  it("renders the try link and source links only as http(s) hrefs with rel noopener noreferrer", async () => {
    const uid = await seed({
      mutate: (s) => {
        s.fact_card.try_url = "https://try.example/demo";
        s.sources = [
          { name: "Good", url: "https://good.example/post", tier: 1 },
          { name: "Evil", url: "javascript:alert(1)", tier: 2 },
        ];
      },
    });
    const body = await (await get(`/admin/stories/${uid}`)).text();
    expect(body).toMatch(/<a href="https:\/\/try\.example\/demo" target="_blank" rel="noopener noreferrer">/);
    expect(body).toMatch(/<a href="https:\/\/good\.example\/post" target="_blank" rel="noopener noreferrer">/);
    expect(body).not.toContain('href="javascript:');
    expect(body).toContain("javascript:alert(1)"); // shown as plain text
    const anchors = body.match(/<a [^>]*target="_blank"[^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(a).toContain('rel="noopener noreferrer"');
  });

  it("escapes a quote in the try URL and a source URL inside value and href attributes", async () => {
    const hostile = 'https://a.example/"onx="1';
    const uid = await seed({
      mutate: (s) => {
        s.fact_card.try_url = hostile;
        s.sources = [{ name: "Quoted", url: 'https://b.example/"onx="1', tier: 1 }];
      },
    });
    const body = await (await get(`/admin/stories/${uid}`)).text();
    expect(body).toContain('value="https://a.example/&quot;onx=&quot;1"');
    expect(body).toContain('href="https://a.example/&quot;onx=&quot;1"');
    expect(body).toContain('href="https://b.example/&quot;onx=&quot;1"');
    expect(body).not.toContain('"onx="1');
  });

  it("refuses an approve without an Access token and leaves the story unchanged", async () => {
    const uid = await seed();
    const before = (await getStory(env.DB, uid))!;
    const access = { ...env, ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com", ACCESS_AUD: "aud" };
    const res = await app.fetch(
      new Request(`${ORIGIN}/admin/stories/${uid}/approve`, {
        method: "POST",
        headers: { Origin: ORIGIN },
        body: new URLSearchParams({ version: "1", checked: "on" }),
      }),
      access,
    );
    expect(res.status).toBe(401);
    const after = (await getStory(env.DB, uid))!;
    expect(after.status).toBe("review");
    expect(after.version).toBe(before.version);
    expect(after.events.length).toBe(before.events.length);
  });

  it("answers 401 without an Access token when Access is configured", async () => {
    await seed();
    const res = await get("/admin", { ...env, ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com", ACCESS_AUD: "aud" });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain("A2UI");
    expect(body).not.toContain("Radar");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves /healthz outside the admin authentication", async () => {
    const res = await get("/healthz", env);
    expect(res.status).toBe(200);
  });

  it("refuses a POST without Origin and with a foreign Origin", async () => {
    const uid = await seed();
    for (const origin of [null, "https://evil.example"]) {
      const res = await post(`/admin/stories/${uid}/approve`, { version: "1", checked: "on" }, origin);
      expect(res.status).toBe(403);
    }
    const s = await getStory(env.DB, uid);
    expect(s).toMatchObject({ status: "review", version: 1 });
  });

  it("refuses a POST whose Origin is the string null (a no-referrer form) and changes nothing", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/approve`, { version: "1", checked: "on" }, "null");
    expect(res.status).toBe(403);
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "review", version: 1 });
    expect(actionsOf(s)).toEqual(["ingested"]);
  });

  it("approve without the checkbox answers 400 and leaves the story in review", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/approve`, { version: "1" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Onaylamadan önce kaynağı kontrol ettiğini işaretle.");
    expect((await getStory(env.DB, uid))!.status).toBe("review");
  });

  it("approve with the checkbox publishes and redirects 303 to /admin?done=approved", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/approve`, { version: "1", checked: "on" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin?done=approved");
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "published", publish_mode: "human" });
    expect(s.events.at(-1)).toMatchObject({ action: "approved", actor: "dev@localhost" });
  });

  it("an edit with a stale version answers 409, keeps the typed text, carries the current version and saves nothing", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/edit`, editFields(7, { tr_title: "Benim başlığım" }));
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(COPY.conflictKept);
    expect(body).not.toContain(COPY.failures.conflict);
    expect(body).toMatch(/<textarea id="tr_title"[^>]*>Benim başlığım<\/textarea>/);
    expect(body).toMatch(/<textarea id="en_summary"[^>]*>New summary\.<\/textarea>/);
    expect(body).toContain("14 / 90"); // the counter follows the typed title
    expect(body).toContain('name="version" value="1"'); // the story's current version
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "review", version: 1, edited: false });
    expect(s.texts.tr.title).toBe("A2UI 1.0 aday sürümü yayında");
    expect(actionsOf(s)).toEqual(["ingested"]);
  });

  it("a second save from that page succeeds and overwrites", async () => {
    const uid = await seed();
    // Someone else saves first.
    expect((await post(`/admin/stories/${uid}/edit`, editFields(1, { tr_title: "Başkasının başlığı" }))).status).toBe(303);
    const stale = await post(`/admin/stories/${uid}/edit`, editFields(1, { tr_title: "Benim başlığım" }));
    expect(stale.status).toBe(409);
    const body = await stale.text();
    const version = body.match(/name="version" value="(\d+)"/)?.[1];
    expect(version).toBe("2");
    const again = await post(`/admin/stories/${uid}/edit`, editFields(Number(version), { tr_title: "Benim başlığım" }));
    expect(again.status).toBe(303);
    const s = (await getStory(env.DB, uid))!;
    expect(s.version).toBe(3);
    expect(s.texts.tr.title).toBe("Benim başlığım");
  });

  it("a stale edit of a story rejected meanwhile shows the plain conflict message and no form", async () => {
    const uid = await seed();
    await rejectStory(env.DB, uid, 1, null, "owner@example.com", new Date());
    const res = await post(`/admin/stories/${uid}/edit`, editFields(1, { tr_title: "Benim başlığım" }));
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(COPY.failures.conflict);
    expect(body).not.toContain(COPY.conflictKept);
    expect(body).not.toContain("Benim başlığım");
    expect(body).not.toContain("<textarea");
  });

  it("a stale reject still shows the plain conflict message", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/reject`, { version: "7", note: "Benim notum" });
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(COPY.failures.conflict);
    expect(body).not.toContain(COPY.conflictKept);
    expect((await getStory(env.DB, uid))!.status).toBe("review");
  });

  it("rejects a version that is not a positive integer", async () => {
    const uid = await seed();
    for (const version of ["0", "-1", "1.5", "abc", ""]) {
      const res = await post(`/admin/stories/${uid}/reject`, { version });
      expect(res.status).toBe(400);
    }
    expect((await getStory(env.DB, uid))!.status).toBe("review");
  });

  it("edit saves both languages and returns to the story page", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/edit`, editFields(1, { try_url: "https://try.example/x" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/admin/stories/${uid}?done=saved`);
    const s = (await getStory(env.DB, uid))!;
    expect(s.version).toBe(2);
    expect(s.category).toBe("model");
    expect(s.fact_card.try_url).toBe("https://try.example/x");
    expect(s.texts.tr).toEqual({ title: "Yeni başlık", summary: "Yeni özet.", dev_line: "Yeni geliştirici notu." });
    expect(s.texts.en).toEqual({ title: "New title", summary: "New summary.", dev_line: "New developer line." });
    expect(s.events.at(-1)).toMatchObject({ action: "edited", actor: "dev@localhost" });
    const page = await (await get(`/admin/stories/${uid}`)).text();
    expect(page).toContain("Yeni başlık");
    expect(page).toContain("düzenlendi");
  });

  it("an over-long edit keeps what was typed and names the field", async () => {
    const uid = await seed({ status: "published" });
    const long = "ö".repeat(321);
    const res = await post(`/admin/stories/${uid}/edit`, editFields(1, { tr_summary: long }));
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("Yayınlamak için metin çok uzun: Türkçe özet");
    expect(body).toContain(long);
    expect(body).toContain("Yeni başlık");
    expect(body).toContain("321 / 320");
    expect((await getStory(env.DB, uid))!.version).toBe(1);
  });

  it("reject with an empty note rejects and redirects to /admin?done=rejected", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/reject`, { version: "1", note: "" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin?done=rejected");
    const s = (await getStory(env.DB, uid))!;
    expect(s.status).toBe("rejected");
    expect(s.events.at(-1)).toMatchObject({ action: "rejected", note: null });
  });

  it("unpublish without a note answers 400", async () => {
    const uid = await seed({ status: "published" });
    const res = await post(`/admin/stories/${uid}/unpublish`, { version: "1", note: "  " });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Eksik ya da geçersiz alan var.");
    expect((await getStory(env.DB, uid))!.status).toBe("published");
    const ok = await post(`/admin/stories/${uid}/unpublish`, { version: "1", note: "Yanlış rakam" });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("Location")).toBe(`/admin/stories/${uid}?done=unpublished`);
    expect((await getStory(env.DB, uid))!.status).toBe("rejected");
  });

  it("a wrong-status action answers 409", async () => {
    const uid = await seed({ status: "published" });
    const res = await post(`/admin/stories/${uid}/approve`, { version: "1", checked: "on" });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Bu işlem haberin şu anki durumunda yapılamaz.");
  });

  it("approving a story past 72 hours answers 409 with the expiry message", async () => {
    const uid = await seed({ ageMs: 73 * HOUR });
    const res = await post(`/admin/stories/${uid}/approve`, { version: "1", checked: "on" });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Bu haberin 72 saatlik süresi doldu.");
  });

  it("shows the review buttons and the published buttons", async () => {
    const review = await seed();
    const body = await (await get(`/admin/stories/${review}`)).text();
    for (const s of ["Neden onay bekliyor", "Kaydet", "Kaydet ve onayla", "Kaynağı kontrol ettim", "Reddet"])
      expect(body).toContain(s);
    expect(body).not.toContain("Yayından kaldır");
    expect(body).toContain('lang="en"');
    expect(body).toMatch(/28 \/ 90/); // "A2UI 1.0 aday sürümü yayında"
    const published = await seed({ status: "published" });
    const pub = await (await get(`/admin/stories/${published}`)).text();
    expect(pub).toContain("Kaydet");
    expect(pub).toContain("Yayından kaldır");
    expect(pub).not.toContain("Kaydet ve onayla");
  });

  it("rejected and expired stories render no form", async () => {
    const rejected = await seed();
    await rejectStory(env.DB, rejected, 1, "Kaynak zayıf", "owner@example.com", new Date());
    const expired = await seed({ ageMs: 73 * HOUR });
    await get("/admin"); // expires it
    expect((await getStory(env.DB, expired))!.status).toBe("expired");
    for (const uid of [rejected, expired]) {
      const res = await get(`/admin/stories/${uid}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).not.toContain("<form");
      expect(body).not.toContain("<textarea");
      expect(body).toContain("A2UI 1.0 aday sürümü yayında");
    }
    expect(await (await get(`/admin/stories/${rejected}`)).text()).toContain("Kaynak zayıf");
  });

  it("sends the CSP, no-store, nosniff and same-origin referrer headers", async () => {
    const uid = await seed();
    const responses = [
      await get("/admin"),
      await get(`/admin/stories/${uid}`),
      await get("/admin/stories/nope"),
      await get("/admin/app.css"),
      await get("/admin/app.js"),
      await post(`/admin/stories/${uid}/approve`, { version: "1" }, null),
      await post(`/admin/stories/${uid}/reject`, { version: "1" }),
    ];
    for (const res of responses) {
      expect(res.headers.get("Content-Security-Policy")).toBe(
        "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
    }
  });

  it("serves the stylesheet and the script with their content types", async () => {
    const css = await get("/admin/app.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("Content-Type")).toContain("text/css");
    const cssText = await css.text();
    expect(cssText).toContain(":root");
    const js = await get("/admin/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("Content-Type")).toContain("javascript");
  });

  it("an unknown ?status= falls back to review; an unknown uid is a 404 page", async () => {
    await seed();
    const body = await (await get("/admin?status=bogus")).text();
    expect(body).toContain("A2UI 1.0 aday sürümü yayında");
    expect(body).toMatch(/aria-current="page"[^>]*>Bekleyen/);
    const res = await get("/admin/stories/ffffffffffffffffffffffffffffffff");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("Haber bulunamadı.");
    const missing = await post("/admin/stories/ffffffffffffffffffffffffffffffff/reject", { version: "1" });
    expect(missing.status).toBe(404);
  });

  it("opening the queue expires a 73-hour-old review story", async () => {
    const old = await seed({ ageMs: 73 * HOUR });
    const fresh = await seed({ ageMs: HOUR });
    const body = await (await get("/admin")).text();
    expect((await getStory(env.DB, old))!.status).toBe("expired");
    expect((await getStory(env.DB, fresh))!.status).toBe("review");
    expect(body).toMatch(/Süresi dolan[^<]*<[^>]*>1</);
  });

  it("serves a stylesheet with no dark-mode rule and the light colour scheme", async () => {
    const css = await (await get("/admin/app.css")).text();
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("--bg: #f7f7f4");
  });

  it("declares the light colour scheme in the page head", async () => {
    const body = await (await get("/admin")).text();
    expect(body).toContain('<meta name="color-scheme" content="light">');
  });

  it("shows the time left, the category and the source count as text on a review card", async () => {
    await seed({ ageMs: 70 * HOUR });
    const body = await (await get("/admin")).text();
    const card = body.slice(body.indexOf('<li class="card">'));
    expect(card).toMatch(/<span class="chip[^"]*">Protokol<\/span>/);
    expect(card).toMatch(/<span class="chip warn">Kalan süre: 1 sa<\/span>/);
    expect(card).toMatch(/>4 kaynak · a2ui\.org</);
    expect(card.indexOf("Kalan süre")).toBeLessThan(card.indexOf("A2UI 1.0 aday sürümü yayında"));
  });

  it("pages the queue: 51 review stories give 50 cards and a `Sonraki sayfa` link to page=2", async () => {
    await seedQueue(51);
    const body = await (await get("/admin")).text();
    expect(cardCount(body)).toBe(50);
    expect(body).toContain(">Sıra 1<");
    expect(body).toContain(">Sıra 50<");
    expect(body).not.toContain(">Sıra 51<");
    expect(body).toMatch(/<a [^>]*href="\/admin\?status=review&amp;page=2"[^>]*>Sonraki sayfa<\/a>/);
    expect(body).not.toContain("Önceki sayfa");
  });

  it("exactly 50 review stories give 50 cards and no `Sonraki sayfa` link", async () => {
    await seedQueue(50);
    const body = await (await get("/admin")).text();
    expect(cardCount(body)).toBe(50);
    expect(body).not.toContain("Sonraki sayfa");
    expect(body).not.toContain('class="pager"');
  });

  it("page 2 shows the 51st story and a `Önceki sayfa` link; page=abc and page=0 are page 1", async () => {
    await seedQueue(51);
    const second = await (await get("/admin?status=review&page=2")).text();
    expect(cardCount(second)).toBe(1);
    expect(second).toContain(">Sıra 51<");
    expect(second).toMatch(/<a [^>]*href="\/admin\?status=review&amp;page=1"[^>]*>Önceki sayfa<\/a>/);
    expect(second).not.toContain("Sonraki sayfa");
    for (const page of ["abc", "0", "-1", "1.5", "1001"]) {
      const body = await (await get(`/admin?status=review&page=${page}`)).text();
      expect(cardCount(body)).toBe(50);
      expect(body).toContain(">Sıra 1<");
      expect(body).not.toContain("Önceki sayfa");
    }
  });

  it("an unknown path under /admin/ is the 404 page inside the layout", async () => {
    const res = await get("/admin/nothing-here");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const body = await res.text();
    expect(body).toContain(COPY.notFound);
    for (const tab of ["Bekleyen", "Yayında", "Reddedilen", "Süresi dolan"]) expect(body).toContain(tab);
  });

  it("an unknown path under /admin/ without a token is 401 when Access is configured", async () => {
    const res = await get("/admin/nothing-here", {
      ...env,
      ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
      ACCESS_AUD: "aud",
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain(COPY.notFound);
    expect(body).not.toContain("Bekleyen");
  });
});

describe("save and approve", () => {
  it("save-and-approve stores the typed text and publishes it", async () => {
    const uid = await seed();
    const fields = { ...(await storedFields(uid)), tr_title: "Elle düzeltilmiş başlık", checked: "on" };
    const res = await post(`/admin/stories/${uid}/approve`, fields);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin?done=approved");
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "published", publish_mode: "human", edited: true, version: 3 });
    expect(s.texts.tr.title).toBe("Elle düzeltilmiş başlık");
    expect(actionsOf(s)).toEqual(["ingested", "edited", "approved"]);
  });

  it("save-and-approve with unchanged text publishes without an edit event", async () => {
    const uid = await seed();
    const fields = await storedFields(uid);
    // Surrounding spaces are not a change: the stored text is trimmed.
    const res = await post(`/admin/stories/${uid}/approve`, {
      ...fields,
      tr_title: `  ${fields.tr_title}\n`,
      checked: "on",
    });
    expect(res.status).toBe(303);
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "published", edited: false, version: 2 });
    expect(actionsOf(s)).toEqual(["ingested", "approved"]);
  });

  it("save-and-approve without the checkbox saves nothing and keeps the typed text in the form", async () => {
    const uid = await seed();
    const fields = { ...(await storedFields(uid)), tr_title: "Kaydedilmemiş başlık" };
    const res = await post(`/admin/stories/${uid}/approve`, fields);
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain(COPY.mustCheck);
    expect(body).toMatch(/<textarea id="tr_title"[^>]*>Kaydedilmemiş başlık<\/textarea>/);
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "review", version: 1, edited: false });
    expect(s.texts.tr.title).toBe("A2UI 1.0 aday sürümü yayında");
  });

  it("save-and-approve with a 100-character title saves the edit, stays in review and says so", async () => {
    const uid = await seed();
    const long = "ç".repeat(100);
    const res = await post(`/admin/stories/${uid}/approve`, { ...(await storedFields(uid)), tr_title: long, checked: "on" });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain(`${COPY.savedNotApproved} Yayınlamak için metin çok uzun: Türkçe başlık`);
    expect(body).toContain("100 / 90");
    expect(body).toContain('name="version" value="2"'); // the saved version, ready for the next try
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "review", version: 2, edited: true });
    expect(s.texts.tr.title).toBe(long);
    expect(actionsOf(s)).toEqual(["ingested", "edited"]);
  });

  it("save-and-approve with a stale version keeps the typed text too and publishes nothing", async () => {
    const uid = await seed();
    const fields = { ...(await storedFields(uid)), version: "7", tr_title: "Bayat başlık", checked: "on" };
    const res = await post(`/admin/stories/${uid}/approve`, fields);
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(COPY.conflictKept);
    expect(body).not.toContain(COPY.savedNotApproved);
    expect(body).toMatch(/<textarea id="tr_title"[^>]*>Bayat başlık<\/textarea>/);
    expect(body).toContain('name="version" value="1"');
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "review", version: 1, edited: false });
    expect(s.texts.tr.title).toBe("A2UI 1.0 aday sürümü yayında");
    expect(actionsOf(s)).toEqual(["ingested"]);
  });

  it("a stale save-and-approve on a story approved meanwhile shows the plain conflict and the stored text", async () => {
    const uid = await seed();
    const stale = { ...(await storedFields(uid)), tr_title: "Bayat başlık", checked: "on" };
    // Approved in another tab first.
    expect((await post(`/admin/stories/${uid}/approve`, { version: "1", checked: "on" })).status).toBe(303);
    const res = await post(`/admin/stories/${uid}/approve`, stale);
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(COPY.failures.conflict);
    expect(body).not.toContain(COPY.conflictKept);
    expect(body).not.toContain("Bayat başlık");
    expect(body).toMatch(/<textarea id="tr_title"[^>]*>A2UI 1\.0 aday sürümü yayında<\/textarea>/);
    expect(body).not.toContain("data-dirty");
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "published", version: 2, edited: false });
    expect(s.texts.tr.title).toBe("A2UI 1.0 aday sürümü yayında");
  });

  it("a stale save-and-approve without the checkbox on a story edited meanwhile is a conflict that keeps the typed text", async () => {
    const uid = await seed();
    const stale = { ...(await storedFields(uid)), tr_title: "Bayat başlık" };
    // Edited in another tab first.
    expect((await post(`/admin/stories/${uid}/edit`, editFields(1))).status).toBe(303);
    const res = await post(`/admin/stories/${uid}/approve`, stale);
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(COPY.conflictKept);
    expect(body).not.toContain(COPY.mustCheck);
    expect(body).toMatch(/<textarea id="tr_title"[^>]*>Bayat başlık<\/textarea>/);
    expect(body).toContain('name="version" value="2"');
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "review", version: 2, edited: true });
    expect(s.texts.tr.title).toBe("Yeni başlık");
    expect(actionsOf(s)).toEqual(["ingested", "edited"]);
  });

  it("a stale save-and-approve without the checkbox on a story approved meanwhile shows the plain conflict and the stored text", async () => {
    const uid = await seed();
    const stale = { ...(await storedFields(uid)), tr_title: "Bayat başlık" };
    // Approved in another tab first.
    expect((await post(`/admin/stories/${uid}/approve`, { version: "1", checked: "on" })).status).toBe(303);
    const res = await post(`/admin/stories/${uid}/approve`, stale);
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(COPY.failures.conflict);
    expect(body).not.toContain(COPY.conflictKept);
    expect(body).not.toContain(COPY.mustCheck);
    expect(body).not.toContain("Bayat başlık");
    expect(body).toMatch(/<textarea id="tr_title"[^>]*>A2UI 1\.0 aday sürümü yayında<\/textarea>/);
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "published", version: 2, edited: false });
    expect(s.texts.tr.title).toBe("A2UI 1.0 aday sürümü yayında");
    expect(actionsOf(s)).toEqual(["ingested", "approved"]);
  });

  it("approve with a changed title on a published story answers 409 and saves nothing", async () => {
    const uid = await seed({ status: "published" });
    const before = (await getStory(env.DB, uid))!;
    const res = await post(`/admin/stories/${uid}/approve`, {
      ...(await storedFields(uid)),
      tr_title: "Başka başlık",
      checked: "on",
    });
    expect(res.status).toBe(409);
    const s = (await getStory(env.DB, uid))!;
    expect(s.texts.tr.title).toBe(before.texts.tr.title);
    expect(s.version).toBe(before.version);
    expect(actionsOf(s)).toEqual(actionsOf(before));
  });

  it("approve without edit fields still approves the saved text", async () => {
    const uid = await seed();
    await post(`/admin/stories/${uid}/edit`, editFields(1));
    const res = await post(`/admin/stories/${uid}/approve`, { version: "2", checked: "on" });
    expect(res.status).toBe(303);
    const s = (await getStory(env.DB, uid))!;
    expect(s).toMatchObject({ status: "published", version: 3 });
    expect(s.texts.tr.title).toBe("Yeni başlık");
    expect(actionsOf(s)).toEqual(["ingested", "edited", "approved"]);
  });

  it("the save button posts to /edit and the approve button to /approve from one form", async () => {
    const uid = await seed();
    const body = await (await get(`/admin/stories/${uid}`)).text();
    expect(body.match(/<form [^>]*id="story-form"/g)?.length).toBe(1);
    const buttons = body.match(/<button [^>]*>[^<]*<\/button>/g) ?? [];
    const save = buttons.find((b) => b.includes(`>${COPY.save}<`));
    const approve = buttons.find((b) => b.includes(`>${COPY.approve}<`));
    expect(save).toMatch(/form="story-form"/);
    expect(save).toMatch(/formaction="[^"]*\/stories\/[0-9a-f]+\/edit"/);
    expect(approve).toMatch(/form="story-form"/);
    expect(approve).toMatch(/formaction="[^"]*\/stories\/[0-9a-f]+\/approve"/);
    expect(approve).toMatch(/class="[^"]*primary/);
    expect(body).toContain(COPY.approveNote);
  });

  it("the checkbox is not required in HTML", async () => {
    const uid = await seed();
    const body = await (await get(`/admin/stories/${uid}`)).text();
    const form = body.slice(body.indexOf('id="story-form"'));
    const box = form.slice(0, form.indexOf("</form>")).match(/<input [^>]*id="checked"[^>]*>/)?.[0];
    expect(box).toBeDefined(); // inside the story form
    expect(box).not.toContain("required");
  });

  it("a published story shows Kaydet and the take-down form but no approve button", async () => {
    const uid = await seed({ status: "published" });
    const body = await (await get(`/admin/stories/${uid}`)).text();
    expect(body).toMatch(/<button [^>]*formaction="[^"]*\/edit"[^>]*>Kaydet<\/button>/);
    expect(body).toMatch(/<form [^>]*action="[^"]*\/unpublish"/);
    expect(body).toContain(COPY.unpublish);
    expect(body).not.toContain(COPY.approve);
    expect(body).not.toContain("/approve");
    expect(body).not.toContain('id="checked"');
  });
});

const setSourceUrl = (uid: string, url: string) =>
  env.DB.prepare("UPDATE stories SET source_url = ? WHERE uid = ?").bind(url, uid).run();

// The action bar of a story page, from its opening tag to the end of the form.
const actionBarOf = (body: string): string => {
  const start = body.indexOf('<div class="action-bar');
  return body.slice(start, body.indexOf("</form>", start));
};

describe("review screen", () => {
  const REASONS = [
    "risk: security_incident",
    "verify: tr.title: too long (100 > 90)",
    "verify: en.summary: number 40% not in source",
    "plain note",
  ];

  it("shows reasons with a Turkish kind chip and marks only raw text as English", async () => {
    const uid = await seed({ mutate: (s) => (s.reasons = REASONS) });
    for (const path of ["/admin", `/admin/stories/${uid}`]) {
      const body = await (await get(path)).text();
      expect(body).toContain('<span class="chip risk">Risk</span> <span class="reason-text">güvenlik olayı</span>');
      expect(body).toContain(
        '<span class="chip verify">Doğrulama</span> <span class="reason-text">Türkçe başlık çok uzun (100 / 90)</span>',
      );
      expect(body).toContain(
        '<span class="chip verify">Doğrulama</span> <span class="reason-text" lang="en">İngilizce özet: number 40% not in source</span>',
      );
      expect(body).toContain('<span class="chip">Not</span> <span class="reason-text" lang="en">plain note</span>');
      expect(body).not.toContain('<ul class="reasons" lang="en">');
    }
  });

  it("escapes a hostile reason inside the new reason markup", async () => {
    const uid = await seed({
      mutate: (s) =>
        (s.reasons = ["risk: <img src=x onerror=alert(1)>", 'verify: tr.title: "><script>alert(1)</script>', "<b>x</b>"]),
    });
    for (const path of ["/admin", `/admin/stories/${uid}`]) {
      const body = await (await get(path)).text();
      expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(body).toContain("Türkçe başlık: &quot;&gt;&lt;script&gt;");
      expect(body).toContain("&lt;b&gt;x&lt;/b&gt;");
      expect(body).not.toContain("<img");
      expect(body).not.toContain("<script>alert");
      expect(body).not.toContain("<b>x");
    }
  });

  it("the review queue has a summary line with the count and the soonest deadline; other tabs do not", async () => {
    expect(await (await get("/admin")).text()).not.toContain("haber bekliyor");
    await seed({ ageMs: 10 * HOUR });
    await seed({ ageMs: 68.5 * HOUR });
    await seed({ status: "published" });
    const body = await (await get("/admin")).text();
    expect(body).toContain('<p class="queue-summary">2 haber bekliyor · en yakın süre 3 sa</p>');
    expect(body.indexOf("queue-summary")).toBeLessThan(body.indexOf('<ul class="cards">'));
    for (const status of ["published", "rejected", "expired"]) {
      expect(await (await get(`/admin?status=${status}`)).text()).not.toContain("haber bekliyor");
    }
  });

  it("the summary on page 2 still counts the whole queue and names its soonest deadline", async () => {
    await seedQueue(51); // the oldest is 60 hours old: 12 hours left
    const body = await (await get("/admin?status=review&page=2")).text();
    expect(body).toContain("51 haber bekliyor · en yakın süre 11 sa");
  });

  it("a card shows the main source's host, and nothing for a non-http source url", async () => {
    const good = await seed({ mutate: (s) => (s.source_url = "https://www.example.com/post?id=1") });
    const bad = await seed({ mutate: (s) => (s.texts.tr.title = "Kötü kaynak") });
    await setSourceUrl(bad, "javascript:alert(1)");
    const body = await (await get("/admin")).text();
    const cards = body.split('<li class="card">').slice(1);
    const goodCard = cards.find((c) => c.includes(good))!;
    const badCard = cards.find((c) => c.includes(bad))!;
    expect(goodCard).toContain('<p class="meta">4 kaynak · www.example.com</p>');
    expect(badCard).toContain('<p class="meta">4 kaynak</p>');
    expect(body).not.toContain("javascript:");
  });

  it("the action bar links to the main source with rel noopener noreferrer on a review story only", async () => {
    const review = await seed();
    const bar = actionBarOf(await (await get(`/admin/stories/${review}`)).text());
    const link = `<a class="source-link" href="https://a2ui.org/blog/1-0-rc" target="_blank" rel="noopener noreferrer">${COPY.openSource}</a>`;
    expect(COPY.openSource).toBe("Kaynağı aç ↗");
    expect(bar).toContain(link);
    expect(bar.indexOf('id="checked"')).toBeLessThan(bar.indexOf(link));
    expect(bar.indexOf(link)).toBeLessThan(bar.indexOf(`>${COPY.save}<`));

    const published = await seed({ status: "published" });
    expect(await (await get(`/admin/stories/${published}`)).text()).not.toContain(COPY.openSource);

    const bad = await seed();
    await setSourceUrl(bad, "javascript:alert(1)");
    const badBody = await (await get(`/admin/stories/${bad}`)).text();
    expect(badBody).not.toContain(COPY.openSource);
    expect(badBody).not.toContain('href="javascript:');
  });

  it("the stylesheet has no box-shadow", async () => {
    const css = await (await get("/admin/app.css")).text();
    expect(css).not.toContain("box-shadow");
    expect(css).toMatch(/\.action-bar \{[^}]*border-top: 1px solid var\(--line\)/);
  });

  it("the page carries the hidden unsaved-changes notice and the script toggles a dirty class", async () => {
    for (const status of ["review", "published"] as const) {
      const uid = await seed({ status });
      const bar = actionBarOf(await (await get(`/admin/stories/${uid}`)).text());
      expect(bar).toContain(`<p class="unsaved" id="unsaved" role="status" hidden>${COPY.unsaved}</p>`);
    }
    expect(COPY.unsaved).toBe("Kaydedilmemiş değişiklik var");
    const js = await (await get("/admin/app.js")).text();
    expect(js).toContain('getElementById("story-form")');
    expect(js).toContain('classList.toggle("dirty"');
    expect(js).toContain(".hidden = !dirty");
    expect(js).toContain('addEventListener("beforeunload"');
    expect(js).toContain('removeEventListener("beforeunload"');
    expect(js).toContain('addEventListener("submit"');
    expect(js).toContain("data-limit"); // the live counters stay
  });

  it("the brand is the echo arcs: an 18 px inline svg of three accent arcs, hidden from assistive tech", async () => {
    const body = await (await get("/admin")).text();
    const svg = body.match(/<svg [^>]*>[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(svg).toContain('class="mark"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('width="18" height="18"');
    expect(svg).toContain('aria-hidden="true"');
    for (const x of [5, 11, 17]) expect(svg).toContain(`<path class="mark-arc" d="M${x} 4A13 13 0 0 1 ${x} 20"/>`);
    expect(svg.match(/<(circle|line|path|rect|polygon|polyline|ellipse)[\s/>]/g)?.length).toBe(3);
    expect(svg).not.toMatch(/(fill|stroke|style)=/);
    const css = await (await get("/admin/app.css")).text();
    expect(css).toMatch(
      /\.mark-arc \{[^}]*fill: none;[^}]*stroke: var\(--accent\);[^}]*stroke-width: 2\.25;[^}]*stroke-linecap: round;/,
    );
    for (const old of [".brand::before", "mark-lit", "mark-dim", "mark-dot", "mark-ring", "mark-sweep", "mark-blip"])
      expect(css + svg).not.toContain(old);
  });
  it("a page that keeps unsaved typed text marks the form dirty; a normal story page does not", async () => {
    const uid = await seed();
    const normal = await (await get(`/admin/stories/${uid}`)).text();
    expect(normal).toMatch(/<form [^>]*id="story-form"/);
    expect(normal).not.toContain("data-dirty");

    const conflict = await (await post(`/admin/stories/${uid}/edit`, editFields(7, { tr_title: "Benim başlığım" }))).text();
    expect(conflict).toMatch(/<form [^>]*id="story-form"[^>]*data-dirty="1"/);
    expect(conflict).toContain(`<p class="unsaved" id="unsaved" role="status" hidden>`);

    const published = await seed({ status: "published" });
    const tooLong = await post(`/admin/stories/${published}/edit`, editFields(1, { tr_summary: "ö".repeat(321) }));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.text()).toMatch(/<form [^>]*id="story-form"[^>]*data-dirty="1"/);

    const js = await (await get("/admin/app.js")).text();
    expect(js).toContain('hasAttribute("data-dirty")');
  });
});

// The confirmation notice of a page, or undefined.
const doneNotice = (body: string): string | undefined => body.match(/<p class="notice done"[^>]*>[^<]*<\/p>/)?.[0];

describe("feedback and foresight", () => {
  it("a successful save redirects with done=saved and the story page then says Kaydedildi.", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/edit`, editFields(1));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/admin/stories/${uid}?done=saved`);
    const body = await (await get(res.headers.get("Location")!)).text();
    expect(doneNotice(body)).toBe('<p class="notice done" role="status">Kaydedildi.</p>');
    expect(COPY.done.saved).toBe("Kaydedildi.");
    // The plain story page says nothing.
    expect(await (await get(`/admin/stories/${uid}`)).text()).not.toContain('class="notice');
  });

  it("approve, reject and take-down redirect with their hints and the next page shows the message", async () => {
    const approved = await seed();
    const a = await post(`/admin/stories/${approved}/approve`, { version: "1", checked: "on" });
    expect(a.status).toBe(303);
    expect(a.headers.get("Location")).toBe("/admin?done=approved");
    expect(doneNotice(await (await get("/admin?done=approved")).text())).toContain(">Haber yayınlandı.<");

    const edited = await seed();
    const e = await post(`/admin/stories/${edited}/approve`, {
      ...(await storedFields(edited)),
      tr_title: "Elle düzeltilmiş başlık",
      checked: "on",
    });
    expect(e.status).toBe(303);
    expect(e.headers.get("Location")).toBe("/admin?done=approved");

    const rejected = await seed();
    const r = await post(`/admin/stories/${rejected}/reject`, { version: "1", note: "" });
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/admin?done=rejected");
    expect(doneNotice(await (await get("/admin?done=rejected")).text())).toContain(">Haber reddedildi.<");

    const published = await seed({ status: "published" });
    const u = await post(`/admin/stories/${published}/unpublish`, { version: "1", note: "Yanlış rakam" });
    expect(u.status).toBe(303);
    expect(u.headers.get("Location")).toBe(`/admin/stories/${published}?done=unpublished`);
    const page = await (await get(u.headers.get("Location")!)).text();
    expect(doneNotice(page)).toBe('<p class="notice done" role="status">Haber yayından kaldırıldı.</p>');
  });

  it("an unknown or hostile done value shows nothing and is not reflected", async () => {
    const uid = await seed();
    const values = ["%3Cscript%3E", "x", "approved%22", "x&done=approved", "constructor", "toString", ""];
    for (const base of ["/admin", `/admin/stories/${uid}`]) {
      for (const v of values) {
        const body = await (await get(`${base}?done=${v}`)).text();
        expect(body).not.toContain('class="notice');
        for (const message of Object.values(COPY.done)) expect(body).not.toContain(message);
        expect(body).not.toMatch(/<script>/);
        expect(body).not.toContain('approved"');
        expect(body).not.toContain("constructor");
      }
    }
  });

  it("a failure message wins over a done hint", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/edit?done=saved`, editFields(7));
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(`<p class="notice" role="alert">${COPY.conflictKept}</p>`);
    expect(body).not.toContain(COPY.done.saved);
    const shell = String(
      await layout({
        title: "t",
        email: "a@b",
        counts: { review: 0, published: 0, rejected: 0, expired: 0 },
        active: null,
        message: "Hata",
        done: COPY.done.saved,
        body: html``,
      }),
    );
    expect(shell).toContain('<p class="notice" role="alert">Hata</p>');
    expect(shell).not.toContain(COPY.done.saved);
  });

  it("the story page shows a preview built from the stored text, English parts marked lang=en", async () => {
    for (const status of ["review", "published"] as const) {
      const uid = await seed({ status });
      const body = await (await get(`/admin/stories/${uid}`)).text();
      const s = (await getStory(env.DB, uid))!;
      expect(body).toContain(`<h2 id="preview-h">${COPY.previewHeading}</h2>`);
      expect(COPY.previewHeading).toBe("Sitede görünüm");
      const preview = body.slice(body.indexOf('id="preview-h"'), body.indexOf('id="fact-h"'));
      for (const lang of ["tr", "en"] as const) {
        expect(preview).toContain(
          `<span class="pv-tag" id="pv_${lang}_category"${lang === "en" ? ' lang="tr"' : ""}>Protokol</span>`,
        );
        for (const f of ["title", "summary", "dev_line"] as const)
          expect(preview).toContain(`id="pv_${lang}_${f}">${s.texts[lang][f]}</`);
      }
      expect(preview).toContain('<div class="pv-story" lang="en">');
      // The story line as the site draws it: one paragraph led by an inline pill, then the text.
      for (const lang of ["tr", "en"] as const) {
        expect(preview).toContain(
          `<p class="pv-why"><span class="pv-why-label">${COPY.previewDev[lang]}</span> <span id="pv_${lang}_dev_line">${s.texts[lang].dev_line}</span></p>`,
        );
      }
      expect(preview).not.toContain("pv-dev");
      expect(COPY.previewDev).toEqual({ tr: "Neden önemli", en: "Why it matters" });
      expect(preview.indexOf('id="pv_tr_title"')).toBeLessThan(preview.indexOf('id="pv_en_title"'));
      // Directly under the reasons, above the fact card.
      expect(body.indexOf('id="reasons-h"')).toBeLessThan(body.indexOf('id="preview-h"'));
      const between = body.slice(body.indexOf('id="reasons-h"'), body.indexOf('id="preview-h"'));
      expect(between.match(/<section /g)?.length).toBe(1);
    }
  });

  it("after a kept-text re-render the preview shows the typed text, escaped", async () => {
    const uid = await seed();
    const hostile = "<img src=x onerror=alert(1)>";
    const res = await post(
      `/admin/stories/${uid}/edit`,
      editFields(7, { tr_title: hostile, en_summary: '"><b>x</b>', category: "security" }),
    );
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain('id="pv_tr_title">&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(body).toContain('id="pv_en_summary">&quot;&gt;&lt;b&gt;x&lt;/b&gt;</p>');
    expect(body).toContain('id="pv_tr_category">Güvenlik</span>');
    expect(body).not.toContain("<img");
    expect(body).not.toContain("<b>x");
  });

  it("read-only stories have no preview", async () => {
    const rejected = await seed();
    await rejectStory(env.DB, rejected, 1, null, "owner@example.com", new Date());
    const body = await (await get(`/admin/stories/${rejected}`)).text();
    expect(body).not.toContain(COPY.previewHeading);
    expect(body).not.toContain('id="pv_');
  });

  it("the script updates the preview with textContent only and never uses innerHTML", async () => {
    const js = await (await get("/admin/app.js")).text();
    expect(js).toContain('"pv_"');
    expect(js).toContain(".textContent = ");
    expect(js).toContain('getElementById("category")');
    expect(js).toContain('addEventListener("change"');
    for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("])
      expect(js).not.toContain(bad);
  });

  it("the script submits through the save button on Ctrl+S and Cmd+S and only when the form exists", async () => {
    const js = await (await get("/admin/app.js")).text();
    for (const s of [
      'addEventListener("keydown"',
      "ctrlKey",
      "metaKey",
      'toLowerCase() === "s"',
      "preventDefault()",
      ".repeat",
      "requestSubmit(save)",
      "save.click()",
    ])
      expect(js).toContain(s);
    expect(js.indexOf("if (!form) return;")).toBeGreaterThan(-1);
    expect(js.indexOf('addEventListener("keydown"')).toBeGreaterThan(js.indexOf("if (!form) return;"));
    expect(js.indexOf('addEventListener("keydown"')).toBeGreaterThan(js.indexOf("if (save)"));
    const uid = await seed();
    const body = await (await get(`/admin/stories/${uid}`)).text();
    expect(body).toMatch(/<button [^>]*id="save-button"[^>]*formaction="[^"]*\/edit"[^>]*>Kaydet<\/button>/);
    expect(body.match(/id="save-button"/g)?.length).toBe(1);
  });

  it("the page title starts with the waiting count and has no prefix at zero", async () => {
    expect(await (await get("/admin")).text()).toContain("<title>Bekleyen · Radar · Onay</title>");
    const uid = await seed();
    await seed();
    await seed({ status: "published" });
    expect(await (await get("/admin?status=published")).text()).toContain("<title>(2) Yayında · Radar · Onay</title>");
    expect(await (await get(`/admin/stories/${uid}`)).text()).toContain(
      "<title>(2) A2UI 1.0 aday sürümü yayında · Radar · Onay</title>",
    );
    expect(await (await get("/admin/nothing")).text()).toContain("<title>(2) Bulunamadı · Radar · Onay</title>");
  });

  it("the empty review queue shows the brand mark", async () => {
    const body = await (await get("/admin")).text();
    expect(body).toMatch(/<div class="empty"><svg class="mark"[^>]*>[\s\S]*?<\/svg><p>Bekleyen haber yok\.<\/p><\/div>/);
    const other = await (await get("/admin?status=rejected")).text();
    expect(other).toContain('<div class="empty"><p>Bu listede haber yok.</p></div>');
  });

  it("the side column has a thin scrollbar in the control colour, and the done notice uses the ok colours", async () => {
    const css = await (await get("/admin/app.css")).text();
    expect(css).toMatch(/\.story-side \{[^}]*scrollbar-width: thin;[^}]*scrollbar-color: var\(--control-border\) transparent;/);
    expect(css).toMatch(/\.notice\.done \{[^}]*background: var\(--ok-soft\);[^}]*color: var\(--ok\);/);
    expect(css).not.toContain(".pv-dev");
    const rule = (selector: string) => css.match(new RegExp(`\\n${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`))![1];
    // The pill: ink with the page colour (16.6:1), fully rounded, the label size; inline.
    const pill = rule(".pv-why-label");
    for (const d of [
      "background: var(--ink);",
      "color: var(--bg);",
      "border-radius: 999px;",
      "padding: 0.125rem 0.5rem;",
      "font-size: 0.75rem;",
      "letter-spacing: 0.04em;",
      "text-transform: uppercase;",
    ])
      expect(pill).toContain(d);
    expect(pill).not.toMatch(/display:/);
    // The line itself: the text at 1rem, no box.
    const line = rule(".pv-why");
    expect(line).toContain("font-size: 1rem;");
    expect(line).not.toMatch(/border|background/);
    expect(css).toMatch(/\.pv-title \{[^}]*font-size: 1\.125rem;[^}]*font-weight: 700;/);
    expect(css).not.toContain("box-shadow");
  });

  it("the story line is labelled Neden önemli in the form, the read-only texts and the messages", async () => {
    expect(COPY.fields.dev_line).toBe("Neden önemli");
    expect(COPY.fieldName.dev_line).toBe("neden önemli satırı");
    const uid = await seed({ status: "published" });
    const page = await (await get(`/admin/stories/${uid}`)).text();
    expect(page).toContain('<label for="tr_dev_line">Neden önemli</label>');
    expect(page).not.toContain("Geliştirici");
    const res = await post(`/admin/stories/${uid}/edit`, editFields(1, { tr_dev_line: "x".repeat(201) }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Yayınlamak için metin çok uzun: Türkçe neden önemli satırı");
    const rejected = await seed();
    await rejectStory(env.DB, rejected, 1, null, "owner@example.com", new Date());
    expect(await (await get(`/admin/stories/${rejected}`)).text()).toContain('<dt lang="tr">Neden önemli</dt>');
  });

  it("Ctrl+S in a field of another form leaves that form alone and keeps the browser default", async () => {
    const js = await (await get("/admin/app.js")).text();
    const handler = js.slice(js.indexOf('addEventListener("keydown"'));
    expect(handler).toMatch(/var target = event\.target;\s*if \(target && target\.form && target\.form !== form\) return;/);
    expect(handler.indexOf("target.form !== form")).toBeLessThan(handler.indexOf("preventDefault()"));
  });

  it("the script syncs the preview with the fields once at load", async () => {
    const js = await (await get("/admin/app.js")).text();
    expect(js).toMatch(/field\.addEventListener\("input", show\);\s*show\(\);/);
    expect(js).toMatch(/category\.addEventListener\("change", showCategory\);\s*showCategory\(\);/);
  });

  it("below 64rem the preview follows the edit form and comes before the decision card; from 64rem it stays in the side column", async () => {
    const css = await (await get("/admin/app.css")).text();
    const narrow = css.slice(0, css.indexOf("@media"));
    expect(narrow).toMatch(/\.story-main \{ display: contents; \}/);
    expect(narrow).toMatch(/\.story-main > \* \{ order: 1; \}/);
    expect(narrow).toMatch(/\.preview \{ order: 2; \}/);
    expect(narrow).toMatch(/\.story-main > \.danger-card \{ order: 3; \}/);
    expect(narrow).toMatch(/\.history-panel \{ order: 4; \}/);
    const wide = css.slice(css.indexOf("@media (min-width: 64rem)"));
    expect(wide).toMatch(/\.story-main \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*gap: var\(--space-5\);/);
    expect(wide).toMatch(/\.preview \{ order: 0; \}/);
    // In the markup the preview stays directly under the reasons, inside the side column.
    const uid = await seed();
    const body = await (await get(`/admin/stories/${uid}`)).text();
    const side = body.slice(body.indexOf('<div class="story-side">'), body.indexOf('<div class="story-main">'));
    expect(side).toContain('id="preview-h"');
    expect(body.indexOf('<section class="danger-card"')).toBeGreaterThan(body.indexOf('id="story-form"'));
  });

  it("a category label never comes from the prototype", () => {
    expect(categoryLabel("security")).toBe("Güvenlik");
    for (const value of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(categoryLabel(value)).toBe(value);
  });

  it("the script drops the done parameter from the address once the page has loaded", async () => {
    const js = await (await get("/admin/app.js")).text();
    expect(js).toContain("history.replaceState");
    // Before the queue page's early return, so it runs on every page.
    expect(js.indexOf("replaceState")).toBeLessThan(js.indexOf("if (!form) return;"));
    const cases: [string, string | null][] = [
      ["/admin?done=approved", "/admin"],
      ["/admin?status=review&done=rejected", "/admin?status=review"],
      ["/admin/stories/abc?done=saved#story-form", "/admin/stories/abc#story-form"],
      ["/admin?status=published", null],
    ];
    for (const [address, expected] of cases) {
      const page = runScript(js, address);
      expect(page.replaced, address).toEqual(expected === null ? [] : [expected]);
    }
  });

  it("the save key submits once until the page is shown again, and only as plain Ctrl+S or Cmd+S", async () => {
    const js = await (await get("/admin/app.js")).text();
    expect(js).toContain("!event.altKey && !event.shiftKey");
    expect(js).toContain('addEventListener("pageshow"');
    const page = runScript(js, "/admin/stories/abc", { form: true });
    const key = (extra: Record<string, boolean> = {}) => page.key({ key: "s", ctrlKey: true, ...extra });
    key();
    expect(page.submits).toBe(1);
    key();
    key({ metaKey: true, ctrlKey: false });
    expect(page.submits).toBe(1);
    // Restored from the back/forward cache: the key works again.
    page.fire("pageshow");
    key({ metaKey: true, ctrlKey: false });
    expect(page.submits).toBe(2);
    page.fire("pageshow");
    key({ altKey: true });
    key({ shiftKey: true });
    expect(page.submits).toBe(2);
    // Every plain save key is taken from the browser, sent or not; the modified ones are left alone.
    expect(page.prevented).toBe(4);
  });
});

interface ScriptPage {
  replaced: string[];
  submits: number;
  prevented: number;
  key(init: Record<string, unknown>): void;
  fire(type: string): void;
}

// Runs app.js against a small stand-in for the browser: the address, history, and with `form`
// a story form whose save button submits it (firing the form's submit listeners, as a browser does).
function runScript(js: string, address: string, opts: { form?: boolean } = {}): ScriptPage {
  const url = new URL(address, ORIGIN);
  const listeners: Record<string, ((event: any) => void)[]> = {};
  const on = (type: string, fn: (event: any) => void) => (listeners[type] ??= []).push(fn);
  const page: ScriptPage = {
    replaced: [],
    submits: 0,
    prevented: 0,
    key: (init) => {
      const event = { target: null, repeat: false, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...init, preventDefault: () => page.prevented++ };
      for (const fn of listeners.keydown ?? []) fn(event);
    },
    fire: (type) => {
      for (const fn of listeners[type] ?? []) fn({ persisted: true });
    },
  };
  const formListeners: Record<string, (() => void)[]> = {};
  const form = {
    elements: [],
    querySelector: () => null,
    querySelectorAll: () => [],
    hasAttribute: () => false,
    addEventListener: (type: string, fn: () => void) => (formListeners[type] ??= []).push(fn),
    requestSubmit: () => {
      page.submits++;
      for (const fn of formListeners.submit ?? []) fn();
    },
  };
  const save = { click: () => form.requestSubmit() };
  const ids: Record<string, unknown> = opts.form ? { "story-form": form, "save-button": save } : {};
  const document = {
    addEventListener: on,
    querySelectorAll: () => [],
    getElementById: (id: string) => ids[id] ?? null,
  };
  const window = {
    location: { pathname: url.pathname, search: url.search, hash: url.hash },
    history: { state: null, replaceState: (_state: unknown, _title: string, next: string) => page.replaced.push(next) },
    addEventListener: on,
    removeEventListener: () => {},
  };
  new Function("document", "window", "history", "location", js)(document, window, window.history, window.location);
  for (const fn of listeners.DOMContentLoaded ?? []) fn({});
  return page;
}
