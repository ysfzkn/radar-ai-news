import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import { BATCH_SIZE, BATCHES_PER_RUN, editionNumber, istanbulClock, sendDaily, todaysEdition } from "../src/daily";
import worker from "../src/index";
import type { IngestStory } from "../src/schema";
import { insertStories } from "../src/stories";

type Json = Record<string, any>;

const ORIGIN = "https://admin.example";
const mailEnv = { ...env, RESEND_API_KEY: "test-key", MAIL_FROM: "bulten@radar.example", PUBLIC_URL: ORIGIN } as typeof env;

// 23 November 2026, 09:17 in Istanbul: inside the sending hours.
const MORNING = new Date("2026-11-23T06:17:00.000Z");

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json({ data: [] }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

let n = 0;
async function publish(at: string, change: (s: Json) => void = () => {}): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = (++n).toString(16).padStart(32, "9");
  s.status = "published";
  s.created_at = at;
  change(s);
  await insertStories(env.DB, [s as IngestStory], new Date(at));
  return s.uid;
}

let readers = 0;
async function reader(lang: "tr" | "en" = "tr", status: "confirmed" | "pending" = "confirmed", mailedDay: string | null = null) {
  const i = ++readers;
  const token = i.toString(16).padStart(64, "e");
  const email = `reader${i}@example.com`;
  await env.DB
    .prepare("INSERT INTO subscribers (email, lang, status, token, created_at, mailed_day) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(email, lang, status, token, "2026-11-01T00:00:00.000Z", mailedDay)
    .run();
  return { email, token };
}

const mailedDays = async (): Promise<(string | null)[]> =>
  (await env.DB.prepare("SELECT mailed_day FROM subscribers ORDER BY id").all<{ mailed_day: string | null }>()).results.map((r) => r.mailed_day);
const batch = (call = 0): Json[] => JSON.parse(fetchMock.mock.calls[call]![1].body as string);

describe("istanbulClock", () => {
  it("gives the Istanbul day and hour of a moment", () => {
    expect(istanbulClock(new Date("2026-11-22T21:00:00.000Z"))).toEqual({ day: "2026-11-23", hour: 0 });
    expect(istanbulClock(new Date("2026-11-23T20:59:59.000Z"))).toEqual({ day: "2026-11-23", hour: 23 });
  });
});

describe("the daily mail", () => {
  it("mails today's edition once to each confirmed reader, in the reader's language, with their own leave link", async () => {
    await publish("2026-11-22T22:00:00.000Z"); // 01:00 on the 23rd in Istanbul
    const tr = await reader("tr");
    const en = await reader("en");
    await reader("tr", "pending");

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const outcome = await sendDaily(mailEnv, MORNING);
    expect(outcome).toEqual({ day: "2026-11-23", sent: 2, skipped: 0, failed: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails/batch");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.headers["Idempotency-Key"]).toMatch(/^radar-daily-2026-11-23-[0-9a-f]+-\d+-\d+-2$/);

    const mails = batch();
    expect(mails.map((m) => m.to)).toEqual([[tr.email], [en.email]]);
    expect(mails[0]!.from).toBe("Radar <bulten@radar.example>");
    expect(mails[0]!.subject).toBe("Radar 1 · A2UI 1.0 aday sürümü yayında");
    expect(mails[0]!.html).toContain('<html lang="tr"');
    expect(mails[1]!.html).toContain('<html lang="en"');
    for (const [mail, r] of [[mails[0]!, tr], [mails[1]!, en]] as const) {
      const leave = `${ORIGIN}/api/unsubscribe?token=${r.token}`;
      expect(mail.headers).toEqual({ "List-Unsubscribe": `<${leave}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
      expect(mail.html).toContain(`href="${leave}"`);
      expect(mail.text).toContain(leave);
      expect(mail.html).not.toContain("radar.invalid");
      expect(mail.text).not.toContain("radar.invalid");
    }
    expect(mails[0]!.html).not.toContain(en.token);
    expect(await mailedDays()).toEqual(["2026-11-23", "2026-11-23", null]);
    // The log says how many, never to whom.
    expect(log.mock.calls).toEqual([["daily mail: 2026-11-23, 2 sent"]]);
    log.mockRestore();

    // The next hourly job the same day: nothing left to send.
    fetchMock.mockClear();
    expect(await sendDaily(mailEnv, new Date(MORNING.getTime() + 3600_000))).toMatchObject({ sent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing before 07:00 or from 22:00 in Istanbul, and nothing while sending is not set up", async () => {
    await publish("2026-11-22T22:00:00.000Z");
    await reader();
    expect(await sendDaily(mailEnv, new Date("2026-11-23T03:17:00.000Z"))).toBeNull(); // 06:17
    expect(await sendDaily(mailEnv, new Date("2026-11-23T19:17:00.000Z"))).toBeNull(); // 22:17
    expect(await sendDaily({ ...mailEnv, RESEND_API_KEY: undefined } as typeof env, MORNING)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sendDaily(mailEnv, new Date("2026-11-23T04:17:00.000Z"))).toMatchObject({ sent: 1 }); // 07:17
  });

  it("sends nothing on a day without a published story: yesterday's stories and stories in review do not count", async () => {
    await publish("2026-11-22T10:00:00.000Z");
    await publish("2026-11-23T05:00:00.000Z", (s) => (s.status = "review"));
    await reader();
    expect(await sendDaily(mailEnv, MORNING)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await mailedDays()).toEqual([null]);
  });

  it("orders the edition as the site does and numbers it by the days that have stories", async () => {
    await publish("2026-11-20T08:00:00.000Z");
    await publish("2026-11-21T08:00:00.000Z");
    const few = await publish("2026-11-23T04:00:00.000Z", (s) => (s.source_count = 1));
    const many = await publish("2026-11-23T05:00:00.000Z", (s) => (s.source_count = 6));
    expect((await todaysEdition(env.DB, MORNING)).map((s) => s.uid)).toEqual([many, few]);
    expect(await editionNumber(env.DB, MORNING)).toBe(3);
    await reader();
    await sendDaily(mailEnv, MORNING);
    expect(batch()[0]!.subject).toMatch(/^Radar 3 · /);
    expect(batch()[0]!.html.match(/<td height="10"/g)).toHaveLength(2);
  });

  it("a reader who confirms later the same day gets the edition from the next job; one already mailed today does not", async () => {
    await publish("2026-11-22T22:00:00.000Z");
    await reader("tr", "confirmed", "2026-11-23");
    const late = await reader("tr", "confirmed", "2026-11-22");
    expect(await sendDaily(mailEnv, MORNING)).toMatchObject({ sent: 1 });
    expect(batch().map((m) => m.to)).toEqual([[late.email]]);
  });

  it("when the service refuses a batch, nobody in it is marked and the next job tries again with the same key", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await publish("2026-11-22T22:00:00.000Z");
    const r = await reader();
    fetchMock.mockResolvedValueOnce(Response.json({ message: `${r.email} quota` }, { status: 429 }));
    expect(await sendDaily(mailEnv, MORNING)).toEqual({ day: "2026-11-23", sent: 0, skipped: 0, failed: true });
    expect(await mailedDays()).toEqual([null]);
    expect(err.mock.calls).toEqual([["daily mail: a batch was not accepted", "rate_limited"]]);
    err.mockRestore();

    expect(await sendDaily(mailEnv, new Date(MORNING.getTime() + 3600_000))).toMatchObject({ sent: 1, failed: false });
    expect(fetchMock.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[0]![1].headers["Idempotency-Key"]);
    expect(await mailedDays()).toEqual(["2026-11-23"]);
  });

  it("sends in batches and stops at the job's ceiling; the next job takes the rest", async () => {
    await publish("2026-11-22T22:00:00.000Z");
    const total = BATCH_SIZE * BATCHES_PER_RUN + 3;
    await env.DB.batch(
      Array.from({ length: total }, (_, i) =>
        env.DB
          .prepare("INSERT INTO subscribers (email, lang, status, token, created_at) VALUES (?, 'tr', 'confirmed', ?, ?)")
          .bind(`many${i}@example.com`, i.toString(16).padStart(64, "d"), "2026-11-01T00:00:00.000Z"),
      ),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await sendDaily(mailEnv, MORNING)).toMatchObject({ sent: BATCH_SIZE * BATCHES_PER_RUN });
    expect(fetchMock).toHaveBeenCalledTimes(BATCHES_PER_RUN);
    expect(batch()).toHaveLength(BATCH_SIZE);
    expect(await sendDaily(mailEnv, new Date(MORNING.getTime() + 3600_000))).toMatchObject({ sent: 3 });
    expect((await mailedDays()).every((d) => d === "2026-11-23")).toBe(true);
    const to = fetchMock.mock.calls.flatMap((_, i) => batch(i).map((m) => m.to[0]));
    expect(new Set(to).size).toBe(total);
    log.mockRestore();
  });

  it("the hourly job sends it, and a failure there neither throws nor stops the expiry", async () => {
    await publish("2026-11-22T22:00:00.000Z");
    await reader();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await worker.scheduled(createScheduledController({ scheduledTime: MORNING }), mailEnv, {} as ExecutionContext);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await mailedDays()).toEqual(["2026-11-23"]);
    log.mockRestore();

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      ...mailEnv,
      DB: new Proxy(env.DB, {
        get(target, prop) {
          const value = (target as any)[prop];
          if (prop === "prepare") {
            return (sql: string) => {
              if (sql.includes("subscribers")) throw new Error("subscribers table is gone");
              return value.call(target, sql);
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    } as typeof env;
    await worker.scheduled(createScheduledController({ scheduledTime: new Date(MORNING.getTime() + 3600_000) }), broken, {} as ExecutionContext);
    expect(err.mock.calls.map((c) => c[0])).toEqual(["newsletter: purge failed", "newsletter: daily mail failed"]);
    err.mockRestore();
  });
});
