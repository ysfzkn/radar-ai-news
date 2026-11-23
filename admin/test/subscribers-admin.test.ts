// The admin's readers page (/admin/subscribers): what it shows, and deleting a reader.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { SUBSCRIBERS_PAGE, lastMailing, subscriberTotals } from "../src/subscribers";

type Json = Record<string, any>;

const ORIGIN = "http://localhost";
const dev = { ...env, DEV_NO_AUTH: "1", RESEND_API_KEY: undefined, MAIL_FROM: undefined, PUBLIC_URL: undefined };
const sending = { ...dev, RESEND_API_KEY: "test-key", MAIL_FROM: "bulten@radar.example", PUBLIC_URL: "https://admin.example" };

const get = (path: string, e: Json = sending) => app.fetch(new Request(`${ORIGIN}${path}`), e);
const post = (path: string, e: Json = sending, headers: Record<string, string> = { Origin: ORIGIN }) =>
  app.fetch(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: new URLSearchParams() }), e);
const decode = (html: string) => html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

let n = 0;
async function reader(
  change: Partial<{ email: string; lang: string; status: string; mailed_day: string | null; confirmed_at: string | null }> = {},
): Promise<{ id: number; email: string; token: string }> {
  const i = ++n;
  const row = {
    email: `okur${i}@ornek.com`,
    lang: "tr",
    status: "confirmed",
    mailed_day: null,
    confirmed_at: "2026-11-22T09:00:00.000Z",
    ...change,
  };
  const token = i.toString(16).padStart(64, "c");
  const result = await env.DB
    .prepare("INSERT INTO subscribers (email, lang, status, token, created_at, confirmed_at, mailed_day) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(row.email, row.lang, row.status, token, "2026-11-22T08:30:00.000Z", row.status === "confirmed" ? row.confirmed_at : null, row.mailed_day)
    .run();
  return { id: result.meta.last_row_id as number, email: row.email, token };
}

const emails = async (): Promise<string[]> =>
  (await env.DB.prepare("SELECT email FROM subscribers ORDER BY id").all<{ email: string }>()).results.map((r) => r.email);

describe("GET /admin/subscribers", () => {
  it("is the Aboneler page of the header, marked as the current page, and says so when nobody has subscribed", async () => {
    const res = await get("/admin/subscribers");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).toMatch(/<a class="top-link subs-link" href="\/admin\/subscribers" aria-current="page">Aboneler<\/a>/);
    expect(body).toContain("Henüz abone yok.");
    expect(body).toContain("<dt>Son gönderim</dt><dd>Henüz yok</dd>");
    expect(body).not.toMatch(/\sstyle=|<script>/);
    expect(await (await get("/admin")).text()).toMatch(/<a class="top-link subs-link" href="\/admin\/subscribers">Aboneler<\/a>/);
  });

  it("shows the counts, the languages of confirmed readers and the latest edition mailed", async () => {
    await reader({ mailed_day: "2026-11-22" });
    await reader({ mailed_day: "2026-11-23" });
    await reader({ lang: "en", mailed_day: "2026-11-23" });
    await reader({ lang: "en", status: "pending" });
    expect(await subscriberTotals(env.DB)).toEqual({ confirmed: 3, pending: 1, tr: 2, en: 1 });
    expect(await lastMailing(env.DB)).toEqual({ day: "2026-11-23", readers: 2 });

    const body = await (await get("/admin/subscribers")).text();
    expect(body).toContain("<dt>Onaylı abone</dt><dd>3</dd>");
    expect(body).toContain("<dt>Onay bekleyen</dt><dd>1</dd>");
    expect(body).toContain("<dt>Dil (onaylı)</dt><dd>2 TR · 1 EN</dd>");
    expect(body).toContain("<dt>Son gönderim</dt><dd>23 Kas · 2 okur</dd>");
  });

  it("lists every address, newest first, with its state, language, dates and the last edition mailed", async () => {
    const first = await reader({ mailed_day: "2026-11-23" });
    const second = await reader({ lang: "en", status: "pending" });
    const third = await reader();
    const body = decode(await (await get("/admin/subscribers")).text());
    const rows = [...body.matchAll(/<li class="sub-row">([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.match(/<p class="sub-email">([^<]*)<\/p>/)![1])).toEqual([third.email, second.email, first.email]);
    // Stored as UTC, shown in Istanbul time.
    expect(rows[2]).toContain('<p class="meta">Türkçe · Kayıt: 22 Kas 11:30 · Onay: 22 Kas 12:00 · Son sayı: 23 Kas</p>');
    expect(rows[2]).toContain('<span class="chip ok">Onaylı</span>');
    expect(rows[1]).toContain('<p class="meta">İngilizce · Kayıt: 22 Kas 11:30</p>');
    expect(rows[1]).toContain('<span class="chip warn">Onay bekliyor</span>');
    expect(rows[0]).toContain("Henüz bülten gitmedi");
    expect(rows[0]).toContain(`<form method="post" action="/admin/subscribers/${third.id}/delete"`);
    expect(rows[0]).toContain('<button type="submit" class="danger">Evet, aboneyi sil</button>');
  });

  it("never shows a reader's token, and escapes an address", async () => {
    const r = await reader({ email: '"><b>x</b>@ornek.com' });
    const body = await (await get("/admin/subscribers")).text();
    expect(body).not.toContain(r.token);
    expect(body).not.toContain("<b>x</b>");
    expect(body).toContain("&lt;b&gt;x&lt;/b&gt;@ornek.com");
  });

  it("pages by a hundred", async () => {
    await env.DB.batch(
      Array.from({ length: SUBSCRIBERS_PAGE + 2 }, (_, i) =>
        env.DB
          .prepare("INSERT INTO subscribers (email, lang, status, token, created_at) VALUES (?, 'tr', 'confirmed', ?, ?)")
          .bind(`p${i}@ornek.com`, i.toString(16).padStart(64, "f"), "2026-11-01T00:00:00.000Z"),
      ),
    );
    const first = await (await get("/admin/subscribers")).text();
    expect(first.match(/<li class="sub-row">/g)).toHaveLength(SUBSCRIBERS_PAGE);
    expect(first).toContain('<a class="pager-link next" rel="next" href="/admin/subscribers?page=2">');
    expect(first).not.toContain('rel="prev"');
    const second = await (await get("/admin/subscribers?page=2")).text();
    expect(second.match(/<li class="sub-row">/g)).toHaveLength(2);
    expect(second).toContain('<a class="pager-link" rel="prev" href="/admin/subscribers">');
    expect(second).not.toContain('rel="next"');
    expect(await (await get("/admin/subscribers?page=9")).text()).toContain("Bu sayfada adres yok.");
  });

  it("warns when this Worker cannot send, and not when it can", async () => {
    expect(await (await get("/admin/subscribers", dev)).text()).toContain("Bu Worker şu an e-posta gönderemiyor");
    expect(await (await get("/admin/subscribers")).text()).not.toContain("Bu Worker şu an e-posta gönderemiyor");
  });

  it("is closed without a sign-in", async () => {
    await reader();
    const res = await get("/admin/subscribers", { ...sending, DEV_NO_AUTH: undefined });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("@ornek.com");
  });
});

describe("POST /admin/subscribers/:id/delete", () => {
  it("deletes that reader and no other, and says so", async () => {
    const keep = await reader();
    const gone = await reader();
    const res = await post(`/admin/subscribers/${gone.id}/delete`);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin/subscribers?done=subscriber_removed");
    expect(await emails()).toEqual([keep.email]);
    const after = await (await get("/admin/subscribers?done=subscriber_removed")).text();
    expect(after).toContain('<p class="notice done" role="status">Abone silindi.</p>');
    // The reader's own links are dead too.
    expect((await app.fetch(new Request(`https://admin.example/api/unsubscribe?token=${gone.token}`), sending)).status).toBe(404);
  });

  it("answers 404 for a reader who is already gone and 400 for an id that is not a number; nothing is deleted", async () => {
    const r = await reader();
    const missing = await post(`/admin/subscribers/${r.id + 50}/delete`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Bu abone bulunamadı");
    for (const id of ["0", "abc", "1;DROP", "-1", "1.5", `${r.id} OR 1=1`]) {
      expect((await post(`/admin/subscribers/${encodeURIComponent(id)}/delete`)).status, id).toBe(400);
    }
    expect(await emails()).toEqual([r.email]);
  });

  it("refuses a request from another origin or without a sign-in", async () => {
    const r = await reader();
    expect((await post(`/admin/subscribers/${r.id}/delete`, sending, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post(`/admin/subscribers/${r.id}/delete`, sending, {})).status).toBe(403);
    expect((await post(`/admin/subscribers/${r.id}/delete`, { ...sending, DEV_NO_AUTH: undefined })).status).toBe(503);
    expect(await emails()).toEqual([r.email]);
  });

  it("a GET to the delete address deletes nothing", async () => {
    const r = await reader();
    expect((await get(`/admin/subscribers/${r.id}/delete`)).status).toBe(404);
    expect(await emails()).toEqual([r.email]);
  });
});
