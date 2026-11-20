import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import type { IngestStory } from "../src/schema";
import {
  approveStory,
  countStories,
  getStory,
  insertStories,
  istanbulDay,
  likePattern,
  listEdition,
  listStories,
  nextInQueue,
  publishedToday,
  queueFilter,
  rejectStory,
  restoreStory,
  searchTerms,
  storyPosition,
  unpublishStory,
} from "../src/stories";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const HOUR = 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const db = env.DB;
type Json = Record<string, any>;

let n = 0;
async function seed(
  opts: { ageMs?: number; status?: "review" | "published"; mutate?: (s: Json) => void; at?: Date } = {},
): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = (++n).toString(16).padStart(32, "c");
  s.created_at = ago(opts.ageMs ?? HOUR);
  s.status = opts.status ?? "review";
  opts.mutate?.(s);
  await insertStories(db, [s as IngestStory], opts.at ?? NOW);
  return s.uid;
}

const setPublishedAt = (uid: string, at: string) =>
  db.prepare("UPDATE stories SET published_at = ? WHERE uid = ?").bind(at, uid).run();

describe("restore", () => {
  it("returns a rejected story to review, clears decided_at, bumps the version and writes a 'restored' event", async () => {
    const uid = await seed({ ageMs: 10 * HOUR });
    await rejectStory(db, uid, 1, "yanlış", "owner@example.com", NOW);
    const later = new Date(NOW.getTime() + 60_000);
    expect(await restoreStory(db, uid, 2, "owner@example.com", later)).toEqual({ ok: true });
    const s = (await getStory(db, uid))!;
    expect(s).toMatchObject({ status: "review", version: 3, decided_at: null });
    expect(s.events.at(-1)).toMatchObject({ action: "restored", actor: "owner@example.com", at: later.toISOString() });
  });

  it("restores a story that was taken down (also rejected)", async () => {
    const uid = await seed({ status: "published" });
    await unpublishStory(db, uid, 1, "neden", "owner", NOW);
    expect(await restoreStory(db, uid, 2, "owner", NOW)).toEqual({ ok: true });
    expect((await getStory(db, uid))!.status).toBe("review");
  });

  it("is refused from review, published and expired, with a stale version, and for an unknown uid", async () => {
    const review = await seed();
    expect(await restoreStory(db, review, 1, "o", NOW)).toEqual({ ok: false, error: "wrong_status" });
    const published = await seed({ status: "published" });
    expect(await restoreStory(db, published, 1, "o", NOW)).toEqual({ ok: false, error: "wrong_status" });
    const rejected = await seed();
    await rejectStory(db, rejected, 1, null, "o", NOW);
    expect(await restoreStory(db, rejected, 1, "o", NOW)).toEqual({ ok: false, error: "conflict" });
    expect(await restoreStory(db, "f".repeat(32), 1, "o", NOW)).toEqual({ ok: false, error: "not_found" });
    expect((await getStory(db, rejected))!.events.map((e) => e.action)).toEqual(["ingested", "rejected"]);
  });

  it("is refused once the 72-hour review window has passed, and the story stays rejected", async () => {
    const uid = await seed({ ageMs: 72 * HOUR });
    await rejectStory(db, uid, 1, null, "o", new Date(NOW.getTime() - HOUR));
    expect(await restoreStory(db, uid, 2, "o", NOW)).toEqual({ ok: false, error: "expired" });
    const s = (await getStory(db, uid))!;
    expect(s).toMatchObject({ status: "rejected", version: 2 });
  });
});

describe("next in queue", () => {
  it("picks the first review story after the given position, then wraps to the first, else null", async () => {
    const a = await seed({ ageMs: 30 * HOUR });
    const b = await seed({ ageMs: 20 * HOUR });
    const c = await seed({ ageMs: 10 * HOUR });
    const at = async (uid: string) => {
      const s = (await getStory(db, uid))!;
      return { created_at: s.created_at, uid };
    };
    const posB = await at(b);
    await rejectStory(db, b, 1, null, "o", NOW);
    expect(await nextInQueue(db, posB, NOW)).toBe(c);
    const posC = await at(c);
    await approveStory(db, c, 1, "o", NOW);
    expect(await nextInQueue(db, posC, NOW)).toBe(a);
    const posA = await at(a);
    await rejectStory(db, a, 1, null, "o", NOW);
    expect(await nextInQueue(db, posA, NOW)).toBeNull();
  });

  it("skips a story whose window has passed (and expires it)", async () => {
    const old = await seed({ ageMs: 73 * HOUR });
    const done = await seed({ ageMs: 5 * HOUR });
    const fresh = await seed({ ageMs: 2 * HOUR });
    const s = (await getStory(db, done))!;
    await rejectStory(db, done, 1, null, "o", NOW);
    expect(await nextInQueue(db, { created_at: s.created_at, uid: done }, NOW)).toBe(fresh);
    await rejectStory(db, fresh, 1, null, "o", NOW);
    expect(await nextInQueue(db, { created_at: s.created_at, uid: done }, NOW)).toBeNull();
    expect((await getStory(db, old))!.status).toBe("expired");
  });
});

describe("queue filter", () => {
  it("caps q at 100 characters, trims it, ignores an unknown category", () => {
    expect(queueFilter(undefined, undefined)).toEqual({ q: "", cat: null });
    expect(queueFilter("  model  ", "security")).toEqual({ q: "model", cat: "security" });
    expect(queueFilter("x".repeat(150), "bogus").q).toHaveLength(100);
    expect(queueFilter("a", "constructor").cat).toBeNull();
    // 100 UTF-16 units, as the input's maxlength counts; a surrogate pair is never cut in half.
    expect(queueFilter("x".repeat(98) + "😀", undefined).q).toBe("x".repeat(98) + "😀");
    expect(queueFilter("x".repeat(99) + "😀", undefined).q).toBe("x".repeat(99));
    expect(queueFilter("x".repeat(100) + "😀", undefined).q).toBe("x".repeat(100));
  });

  it("escapes %, _ and the escape character in the LIKE pattern", () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });

  it("finds by Turkish or English title, by category, and treats % and _ literally", async () => {
    const tr = await seed({ mutate: (s) => (s.texts.tr.title = "Yeni ajan çatısı") });
    const en = await seed({ mutate: (s) => (s.texts.en.title = "Agent framework ships") });
    const pct = await seed({ mutate: (s) => ((s.texts.tr.title = "Fiyat %50 düştü"), (s.category = "industry")) });
    await seed({ mutate: (s) => (s.texts.tr.title = "Fiyat 50 düştü") });
    const uids = async (q: string, cat: string | null = null) =>
      (await listStories(db, "review", 50, 0, { q, cat })).map((s) => s.uid);
    expect(await uids("ajan")).toEqual([tr]);
    expect(await uids("FRAMEWORK")).toEqual([en]);
    expect(await uids("%50")).toEqual([pct]);
    expect(await uids("_")).toEqual([]);
    expect(await uids("", "industry")).toEqual([pct]);
    expect(await uids("Fiyat", "industry")).toEqual([pct]);
    expect(await countStories(db, "review", { q: "Fiyat", cat: null })).toBe(2);
    expect(await countStories(db, "review", { q: "", cat: null })).toBe(4);
  });

  it("needs every word in one title, and finds a word too long for LIKE literally", async () => {
    const long = "ç".repeat(30); // 60 bytes: over D1's 50-byte LIKE pattern limit
    const a = await seed({ mutate: (s) => (s.texts.tr.title = `Ajan çatısı ${long} sürüm`) });
    await seed({ mutate: (s) => ((s.texts.tr.title = "Ajan haberi"), (s.texts.en.title = "Framework release")) });
    const uids = async (q: string) => (await listStories(db, "review", 50, 0, { q, cat: null })).map((s) => s.uid);
    expect(await uids("ajan sürüm")).toEqual([a]);
    expect(await uids("ajan framework")).toEqual([]);
    expect(await uids(long)).toEqual([a]);
    expect(await uids(`${long}%`)).toEqual([]);
  });
});

describe("queue search and Turkish letters", () => {
  it("şifre finds Şifre and istanbul finds İstanbul, and the other way round", async () => {
    const sifre = await seed({ mutate: (s) => (s.texts.tr.title = "Şifre yöneticisinde açık") });
    const ist = await seed({ mutate: (s) => (s.texts.tr.title = "İstanbul'da yapay zekâ buluşması") });
    const upper = await seed({ mutate: (s) => (s.texts.tr.title = "ILIK GELİŞME") });
    const uids = async (q: string) => (await listStories(db, "review", 50, 0, { q, cat: null })).map((s) => s.uid);
    expect(await uids("şifre")).toEqual([sifre]);
    expect(await uids("ŞİFRE")).toEqual([sifre]);
    expect(await uids("istanbul")).toEqual([ist]);
    expect(await uids("İSTANBUL")).toEqual([ist]);
    expect(await uids("ılık gelişme")).toEqual([upper]);
    expect(await countStories(db, "review", { q: "istanbul", cat: null })).toBe(1);
  });

  it("uses at most ten words and says which", () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i + 1}`);
    expect(searchTerms(words.join(" "))).toEqual({ used: words.slice(0, 10), ignored: 2 });
    expect(searchTerms("  a   b ")).toEqual({ used: ["a", "b"], ignored: 0 });
  });
});

describe("today's edition", () => {
  it("the Istanbul day runs from 21:00 UTC to 21:00 UTC", () => {
    expect(istanbulDay(new Date("2026-11-20T12:00:00Z"))).toEqual({
      start: "2026-11-19T21:00:00.000Z",
      end: "2026-11-20T21:00:00.000Z",
    });
    expect(istanbulDay(new Date("2026-11-20T21:30:00Z")).start).toBe("2026-11-20T21:00:00.000Z");
  });

  it("lists the stories published today, newest first then uid, as the public endpoint orders them", async () => {
    const early = await seed({ status: "published" });
    const late = await seed({ status: "published" });
    const tie = await seed({ status: "published" });
    const yesterday = await seed({ status: "published" });
    await seed();
    await setPublishedAt(early, "2026-11-19T22:00:00.000Z");
    await setPublishedAt(late, "2026-11-20T09:00:00.000Z");
    await setPublishedAt(tie, "2026-11-20T09:00:00.000Z");
    await setPublishedAt(yesterday, "2026-11-19T20:59:59.999Z");
    const list = await listEdition(db, NOW);
    const sorted = [late, tie].sort();
    expect(list.map((s) => s.uid)).toEqual([...sorted, early]);
    expect(list[2]).toMatchObject({ title_tr: "A2UI 1.0 aday sürümü yayında", category: "protocol", published_at: "2026-11-19T22:00:00.000Z" });
    expect(await publishedToday(db, NOW)).toBe(3);
  });
});

describe("position", () => {
  it("gives the place, the total and the neighbours in the review order", async () => {
    const a = await seed({ ageMs: 30 * HOUR });
    const b = await seed({ ageMs: 20 * HOUR });
    const c = await seed({ ageMs: 10 * HOUR });
    expect(await storyPosition(db, b, "review", NOW)).toEqual({ index: 2, total: 3, prev: a, next: c });
    expect(await storyPosition(db, a, "review", NOW)).toEqual({ index: 1, total: 3, prev: null, next: b });
    expect(await storyPosition(db, c, "review", NOW)).toEqual({ index: 3, total: 3, prev: b, next: null });
    expect(await storyPosition(db, c, "published", NOW)).toBeNull();
  });

  it("follows the newest-decision-first order of the other tabs and the edition order", async () => {
    const x = await seed();
    const y = await seed();
    await rejectStory(db, x, 1, null, "o", new Date(NOW.getTime() - HOUR));
    await rejectStory(db, y, 1, null, "o", NOW);
    expect(await storyPosition(db, y, "rejected", NOW)).toEqual({ index: 1, total: 2, prev: null, next: x });
    const p = await seed({ status: "published" });
    const q = await seed({ status: "published" });
    await setPublishedAt(p, "2026-11-20T08:00:00.000Z");
    await setPublishedAt(q, "2026-11-20T09:00:00.000Z");
    expect(await storyPosition(db, p, "edition", NOW)).toEqual({ index: 2, total: 2, prev: q, next: null });
  });
});
