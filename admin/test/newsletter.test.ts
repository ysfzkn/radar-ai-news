import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { mailConfig } from "../src/mail";
import {
  CONFIRM_GAP_MS,
  CONFIRM_PER_HOUR,
  CONFIRM_SENDS_MAX,
  PENDING_TTL_MS,
  normalizeEmail,
  purgePending,
  subscriberCounts,
} from "../src/subscribers";

type Json = Record<string, any>;

const ORIGIN = "https://admin.example";
const SITE = "https://radar.ozkanyusuf.com";
const mailEnv = { ...env, RESEND_API_KEY: "test-key", MAIL_FROM: "bulten@radar.example", PUBLIC_URL: ORIGIN };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json({ id: "mail-1" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const subscribe = (fields: Record<string, string>, e: Json = mailEnv) =>
  app.fetch(new Request(`${ORIGIN}/api/subscribe`, { method: "POST", body: new URLSearchParams(fields) }), e);
const call = (method: string, path: string, e: Json = mailEnv, headers: Record<string, string> = {}) =>
  app.fetch(new Request(`${ORIGIN}${path}`, { method, headers }), e);

interface Row {
  id: number;
  email: string;
  lang: string;
  status: string;
  token: string;
  confirm_sends: number;
  confirm_sent_at: string | null;
}
const rows = async (): Promise<Row[]> => (await env.DB.prepare("SELECT * FROM subscribers ORDER BY id").all<Row>()).results;
const sentBody = (call = 0): Json => JSON.parse(fetchMock.mock.calls[call]![1].body as string);

describe("normalizeEmail", () => {
  it("trims and lower-cases an address, and refuses what is not one", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("a.b+radar@mail.example.org")).toBe("a.b+radar@mail.example.org");
    for (const bad of [
      "", "ada", "ada@", "@example.com", "ada@example", "ada@@example.com", "ada @example.com", "ada@exa mple.com",
      "ada@example.com\nBcc: x@y.z", "ada@example.com,eve@example.com", "<ada@example.com>", '"ada"@example.com',
      "ada..b@example.com", "ada@-example.com", `${"a".repeat(65)}@example.com`, `a@${"b".repeat(250)}.com`, null, 7,
    ]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull();
    }
  });
});

describe("POST /api/subscribe", () => {
  it("stores the address as pending, mails one confirmation link and sends the reader back to the site", async () => {
    const res = await subscribe({ email: " Ada@Example.com ", lang: "tr", website: "" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`${SITE}/abone/#mail-sent`);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const [row] = await rows();
    expect(row).toMatchObject({ email: "ada@example.com", lang: "tr", status: "pending", confirm_sends: 1 });
    expect(row!.token).toMatch(/^[0-9a-f]{64}$/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.headers["Idempotency-Key"]).toMatch(/^radar-confirm-\d+-\d+$/);
    const body = sentBody();
    expect(body.from).toBe("Radar <bulten@radar.example>");
    expect(body.to).toEqual(["ada@example.com"]);
    expect(body.subject).toBe("Radar aboneliğini onayla");
    const link = `${ORIGIN}/api/subscribe/confirm?token=${row!.token}`;
    expect(body.html).toContain(`href="${link}"`);
    expect(body.text).toContain(link);
    expect(body.headers).toBeUndefined();
  });

  it("answers in English for lang=en and sends the reader back to the English page", async () => {
    const res = await subscribe({ email: "ada@example.com", lang: "en" });
    expect(res.headers.get("Location")).toBe(`${SITE}/en/subscribe/#mail-sent`);
    expect(sentBody().subject).toBe("Confirm your Radar subscription");
    expect((await rows())[0]!.lang).toBe("en");
  });

  it("refuses an address that is not one, and stores and sends nothing", async () => {
    for (const email of ["", "ada", "ada@example", "a@b.c\r\nBcc: x@y.zz"]) {
      const res = await subscribe({ email, lang: "tr" });
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe(`${SITE}/abone/#mail-invalid`);
    }
    expect(await rows()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives a filled trap field the usual answer, and stores and sends nothing", async () => {
    const res = await subscribe({ email: "bot@example.com", lang: "tr", website: "https://spam.example" });
    expect(res.headers.get("Location")).toBe(`${SITE}/abone/#mail-sent`);
    expect(await rows()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the newsletter is not open, and stores nothing, while sending is not set up", async () => {
    for (const e of [
      { ...env, RESEND_API_KEY: undefined, MAIL_FROM: undefined, PUBLIC_URL: undefined },
      { ...mailEnv, RESEND_API_KEY: "" },
      { ...mailEnv, MAIL_FROM: "Radar <bulten@radar.example>" },
      { ...mailEnv, PUBLIC_URL: "http://admin.example" },
      { ...mailEnv, PUBLIC_URL: "https://admin.example/path" },
    ]) {
      expect(mailConfig(e as any)).toBeNull();
      const res = await subscribe({ email: "ada@example.com", lang: "tr" }, e);
      expect(res.headers.get("Location")).toBe(`${SITE}/abone/#mail-closed`);
    }
    expect(await rows()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not tell whether an address is known: a confirmed reader gets the same answer and no mail", async () => {
    await subscribe({ email: "ada@example.com", lang: "tr" });
    const [row] = await rows();
    await call("POST", `/api/subscribe/confirm?token=${row!.token}`);
    fetchMock.mockClear();
    const res = await subscribe({ email: "ADA@example.com", lang: "en" });
    expect(res.headers.get("Location")).toBe(`${SITE}/en/subscribe/#mail-sent`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "confirmed", lang: "tr" });
  });

  it("mails a pending address again only after ten minutes, with the same link, and never more than three times", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T08:00:00.000Z"));
    await subscribe({ email: "ada@example.com", lang: "tr" });
    await subscribe({ email: "ada@example.com", lang: "tr" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const token = (await rows())[0]!.token;

    for (let n = 2; n <= CONFIRM_SENDS_MAX + 1; n++) {
      vi.setSystemTime(new Date(Date.now() + CONFIRM_GAP_MS));
      const res = await subscribe({ email: "ada@example.com", lang: "en" });
      expect(res.headers.get("Location")).toBe(`${SITE}/en/subscribe/#mail-sent`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(CONFIRM_SENDS_MAX);
    const [row] = await rows();
    expect(row).toMatchObject({ token, confirm_sends: CONFIRM_SENDS_MAX, lang: "en", status: "pending" });
    expect(sentBody(1).html).toContain(token);
  });

  it("stops sending confirmation mails, to anyone, past the hourly limit, and says to try later", async () => {
    const at = new Date().toISOString();
    await env.DB.batch(
      Array.from({ length: CONFIRM_PER_HOUR }, (_, i) =>
        env.DB
          .prepare("INSERT INTO subscribers (email, lang, status, token, created_at, confirm_sent_at, confirm_sends) VALUES (?, 'tr', 'pending', ?, ?, ?, 1)")
          .bind(`r${i}@example.com`, i.toString(16).padStart(64, "a"), at, at),
      ),
    );
    const res = await subscribe({ email: "ada@example.com", lang: "tr" });
    expect(res.headers.get("Location")).toBe(`${SITE}/abone/#mail-later`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(CONFIRM_PER_HOUR);
  });

  it("reports a mail that could not be sent, counts nothing as sent and lets the reader try again at once", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(Response.json({ message: "ada@example.com is not allowed" }, { status: 422 }));
    const res = await subscribe({ email: "ada@example.com", lang: "tr" });
    expect(res.headers.get("Location")).toBe(`${SITE}/abone/#mail-error`);
    expect((await rows())[0]).toMatchObject({ confirm_sends: 0, confirm_sent_at: null });
    // Only the outcome's name is logged: not the address, not the service's answer.
    expect(JSON.stringify(err.mock.calls)).not.toContain("ada@example.com");
    expect(err.mock.calls[0]).toEqual(["confirmation mail not sent", "invalid"]);

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect((await subscribe({ email: "ada@example.com", lang: "tr" })).headers.get("Location")).toContain("#mail-error");
    expect((await subscribe({ email: "ada@example.com", lang: "tr" })).headers.get("Location")).toContain("#mail-sent");
    expect((await rows())[0]).toMatchObject({ confirm_sends: 1 });
    err.mockRestore();
  });

  it("refuses a body that is not a form or is too large", async () => {
    const json = await app.fetch(
      new Request(`${ORIGIN}/api/subscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      mailEnv,
    );
    expect(json.status).toBe(400);
    const big = await app.fetch(
      new Request(`${ORIGIN}/api/subscribe`, { method: "POST", body: new URLSearchParams({ email: "a".repeat(5000) }) }),
      mailEnv,
    );
    expect(big.status).toBe(413);
    expect(await rows()).toEqual([]);
  });
});

describe("confirming", () => {
  const pending = async (lang = "tr"): Promise<Row> => {
    await subscribe({ email: "ada@example.com", lang });
    return (await rows())[0]!;
  };

  it("the link shows a page with one button and changes nothing; the button confirms", async () => {
    const row = await pending();
    const page = await call("GET", `/api/subscribe/confirm?token=${row.token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(page.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    const html = await page.text();
    expect(html).toContain('<html lang="tr">');
    expect(html).toContain("ada@example.com");
    expect(html).toContain(`<form method="post" action="/api/subscribe/confirm?token=${row.token}">`);
    expect(html).not.toMatch(/<script|style=|onclick/);
    expect((await rows())[0]!.status).toBe("pending");

    const done = await call("POST", `/api/subscribe/confirm?token=${row.token}`);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("Abonelik onaylandı.");
    expect((await rows())[0]).toMatchObject({ status: "confirmed" });
    expect(await subscriberCounts(env.DB)).toEqual({ confirmed: 1, pending: 0 });

    // The link and the button again: still confirmed, and the page says so.
    expect(await (await call("GET", `/api/subscribe/confirm?token=${row.token}`)).text()).toContain("Abonelik onaylandı.");
    expect((await call("POST", `/api/subscribe/confirm?token=${row.token}`)).status).toBe(200);
  });

  it("speaks the reader's language", async () => {
    const row = await pending("en");
    const html = await (await call("GET", `/api/subscribe/confirm?token=${row.token}`)).text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Confirm subscription");
  });

  it("answers 404 with the 'not valid' page for a missing, malformed or unknown token", async () => {
    await pending();
    for (const query of ["", "?token=", "?token=abc", `?token=${"f".repeat(64)}`, `?token=${"F".repeat(64)}`, "?token=' OR 1=1 --"]) {
      for (const method of ["GET", "POST"]) {
        const res = await call(method, `/api/subscribe/confirm${query}`);
        expect(res.status, `${method} ${query}`).toBe(404);
        expect(await res.text()).toContain("Bu bağlantı geçerli değil.");
      }
    }
    expect((await call("GET", "/api/subscribe/confirm", mailEnv, { "Accept-Language": "en-GB,en;q=0.9" })).status).toBe(404);
    expect(
      await (await call("GET", "/api/subscribe/confirm", mailEnv, { "Accept-Language": "en-GB,en;q=0.9" })).text(),
    ).toContain("This link is not valid.");
    expect((await rows())[0]!.status).toBe("pending");
  });

  it("escapes what it shows", async () => {
    await env.DB
      .prepare("INSERT INTO subscribers (email, lang, status, token, created_at) VALUES (?, 'tr', 'pending', ?, ?)")
      .bind('"><b>x</b>@example.com', "b".repeat(64), new Date().toISOString())
      .run();
    const html = await (await call("GET", `/api/subscribe/confirm?token=${"b".repeat(64)}`)).text();
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("an address not confirmed within 7 days is deleted, and its link stops working", async () => {
    const row = await pending();
    await purgePending(env.DB, new Date(Date.now() + PENDING_TTL_MS - 60_000));
    expect(await rows()).toHaveLength(1);
    await purgePending(env.DB, new Date(Date.now() + PENDING_TTL_MS + 60_000));
    expect(await rows()).toEqual([]);
    expect((await call("POST", `/api/subscribe/confirm?token=${row.token}`)).status).toBe(404);
  });

  it("a confirmed reader is never deleted for age", async () => {
    const row = await pending();
    await call("POST", `/api/subscribe/confirm?token=${row.token}`);
    await purgePending(env.DB, new Date(Date.now() + 10 * PENDING_TTL_MS));
    expect(await rows()).toHaveLength(1);
  });
});

describe("leaving", () => {
  const confirmed = async (): Promise<Row> => {
    await subscribe({ email: "ada@example.com", lang: "tr" });
    const row = (await rows())[0]!;
    await call("POST", `/api/subscribe/confirm?token=${row.token}`);
    return row;
  };

  it("the link shows a page with one button and deletes nothing; the button deletes the address", async () => {
    const row = await confirmed();
    const page = await call("GET", `/api/unsubscribe?token=${row.token}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`<form method="post" action="/api/unsubscribe?token=${row.token}">`);
    expect(html).toContain("ada@example.com");
    expect(await rows()).toHaveLength(1);

    const done = await call("POST", `/api/unsubscribe?token=${row.token}`);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("Abonelikten çıktın.");
    expect(await rows()).toEqual([]);
  });

  it("takes a mail client's one-click request: a POST with no Origin and the RFC 8058 body", async () => {
    const row = await confirmed();
    const res = await app.fetch(
      new Request(`${ORIGIN}/api/unsubscribe?token=${row.token}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
      mailEnv,
    );
    expect(res.status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it("leaving twice, or with a token nobody has, still answers that the reader is off the list", async () => {
    const row = await confirmed();
    await call("POST", `/api/unsubscribe?token=${row.token}`);
    expect((await call("POST", `/api/unsubscribe?token=${row.token}`)).status).toBe(200);
    expect((await call("POST", "/api/unsubscribe?token=nope")).status).toBe(200);
    // The page before the button, though, says the link is no longer valid.
    expect((await call("GET", `/api/unsubscribe?token=${row.token}`)).status).toBe(404);
  });

  it("after leaving, the same address can subscribe again and gets a new link", async () => {
    const row = await confirmed();
    await call("POST", `/api/unsubscribe?token=${row.token}`);
    fetchMock.mockClear();
    await subscribe({ email: "ada@example.com", lang: "tr" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const again = (await rows())[0]!;
    expect(again.status).toBe("pending");
    expect(again.token).not.toBe(row.token);
  });
});

describe("the newsletter's pages", () => {
  it("serve their stylesheet from this Worker and need no sign-in", async () => {
    const res = await call("GET", "/api/newsletter.css", env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(await res.text()).toContain(".plate{");
  });
});
