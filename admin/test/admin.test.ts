import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
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

  it("a stale version answers 409 and shows `Bu haber başka bir yerde değişti`", async () => {
    const uid = await seed();
    const res = await post(`/admin/stories/${uid}/edit`, editFields(7));
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain("Bu haber başka bir yerde değişti. Güncel hâli aşağıda.");
    expect(body).toContain("A2UI 1.0 aday sürümü yayında"); // the current text, not the stale form
    expect(body).toContain('name="version" value="1"');
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
    for (const s of ["Neden onay bekliyor", "Kaydet", "Onayla ve yayınla", "Kaynağı kontrol ettim", "Reddet"])
      expect(body).toContain(s);
    expect(body).not.toContain("Yayından kaldır");
    expect(body).toContain('lang="en"');
    expect(body).toMatch(/28 \/ 90/); // "A2UI 1.0 aday sürümü yayında"
    const published = await seed({ status: "published" });
    const pub = await (await get(`/admin/stories/${published}`)).text();
    expect(pub).toContain("Kaydet");
    expect(pub).toContain("Yayından kaldır");
    expect(pub).not.toContain("Onayla ve yayınla");
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

  it("sends the CSP, no-store, nosniff and no-referrer headers", async () => {
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
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
  });

  it("serves the stylesheet and the script with their content types", async () => {
    const css = await get("/admin/app.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("Content-Type")).toContain("text/css");
    const cssText = await css.text();
    expect(cssText).toContain(":root");
    expect(cssText).toContain("prefers-color-scheme: dark");
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
});
