import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import { COPY } from "../src/copy";
import { app } from "../src/index";
import type { IngestStory } from "../src/schema";
import { getStory, insertStories, rejectStory } from "../src/stories";

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

  it("approve with the checkbox publishes and redirects 303 to /admin", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/approve`, { version: "1", checked: "on" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin");
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
    expect(res.headers.get("Location")).toBe(`/admin/stories/${uid}`);
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

  it("reject with an empty note rejects and redirects to /admin", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/reject`, { version: "1", note: "" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin");
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
    expect(ok.headers.get("Location")).toBe(`/admin/stories/${uid}`);
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
    expect(res.headers.get("Location")).toBe("/admin");
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

  it("the brand is the radar mark: an 18 px inline svg of a radar screen, hidden from assistive tech", async () => {
    const body = await (await get("/admin")).text();
    const svg = body.match(/<svg [^>]*>[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(svg).toContain('class="mark"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('width="18" height="18"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('<circle class="mark-ring" cx="12" cy="12" r="9.25"/>');
    expect(svg).toContain('<line class="mark-sweep" x1="12" y1="12" x2="18.54" y2="5.46"/>');
    expect(svg).toContain('<circle class="mark-blip" cx="7.75" cy="14.25" r="1.9"/>');
    expect(svg.match(/<(circle|line|path|rect|polygon|polyline|ellipse)[\s/>]/g)?.length).toBe(3);
    expect(svg).not.toMatch(/(fill|stroke|style)=/);
    const css = await (await get("/admin/app.css")).text();
    expect(css).toMatch(/\.mark-ring \{[^}]*stroke: var\(--ink\)/);
    expect(css).toMatch(/\.mark-sweep \{[^}]*stroke: var\(--accent\)/);
    expect(css).toMatch(/\.mark-blip \{[^}]*fill: var\(--accent\)/);
    for (const old of [".brand::before", "mark-lit", "mark-dim", "mark-dot"]) expect(css).not.toContain(old);
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
