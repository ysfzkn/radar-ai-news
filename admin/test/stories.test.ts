import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import type { IngestStory } from "../src/schema";
import {
  approveStory,
  counts,
  editStory,
  expireStale,
  getStory,
  insertStories,
  listStories,
  rejectStory,
  unpublishStory,
  type EditPatch,
} from "../src/stories";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const HOUR = 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const db = env.DB;
type Json = Record<string, any>;

let n = 0;
// Inserts one story whose created_at is `ageMs` before NOW; returns its uid.
async function seed(
  opts: { ageMs?: number; status?: "review" | "published"; mutate?: (s: Json) => void } = {},
): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = (++n).toString(16).padStart(32, "0");
  s.created_at = ago(opts.ageMs ?? HOUR);
  s.status = opts.status ?? "review";
  opts.mutate?.(s);
  await insertStories(db, [s as IngestStory], NOW);
  return s.uid;
}

const patchFrom = async (uid: string, change: (p: EditPatch) => void = () => {}): Promise<EditPatch> => {
  const s = (await getStory(db, uid))!;
  const p: EditPatch = { category: s.category, try_url: s.fact_card.try_url, texts: structuredClone(s.texts) };
  change(p);
  return p;
};

const events = async (uid: string) =>
  (await db.prepare("SELECT * FROM story_events WHERE story_uid = ? ORDER BY id").bind(uid).all<Json>()).results;

describe("queue", () => {
  it("lists the review queue soonest-to-expire first, with expires_at = created_at + 72h", async () => {
    const newer = await seed({ ageMs: 2 * HOUR });
    const older = await seed({ ageMs: 30 * HOUR });
    const list = await listStories(db, "review");
    expect(list.map((s) => s.uid)).toEqual([older, newer]);
    expect(list[0]).toMatchObject({
      status: "review",
      publish_mode: null,
      edited: false,
      source_count: 4,
      created_at: ago(30 * HOUR),
      expires_at: new Date(NOW.getTime() - 30 * HOUR + 72 * HOUR).toISOString(),
      title_tr: "A2UI 1.0 aday sürümü yayında",
      reasons: ["en.summary: number 40% not in source"],
    });
    expect(await listStories(db, "review", 1)).toHaveLength(1);
  });

  it("lists other statuses newest decision first, falling back for auto-published stories", async () => {
    const a = await seed();
    const b = await seed();
    const auto = await seed({ status: "published", ageMs: 5 * HOUR });
    await rejectStory(db, a, 1, null, "owner", new Date(NOW.getTime() - 2 * HOUR));
    await rejectStory(db, b, 1, null, "owner", new Date(NOW.getTime() - 1 * HOUR));
    expect((await listStories(db, "rejected")).map((s) => s.uid)).toEqual([b, a]);
    expect((await listStories(db, "published")).map((s) => s.uid)).toEqual([auto]);
  });

  it("counts stories per status", async () => {
    await seed();
    await seed();
    await seed({ status: "published" });
    const r = await seed();
    await rejectStory(db, r, 1, null, "owner", NOW);
    expect(await counts(db)).toEqual({ review: 2, published: 1, rejected: 1, expired: 0 });
  });

  it("getStory returns events oldest first and null for an unknown uid", async () => {
    const uid = await seed();
    await editStory(db, uid, 1, await patchFrom(uid), "owner", NOW);
    await approveStory(db, uid, 2, "owner", NOW);
    const story = (await getStory(db, uid))!;
    expect(story.events.map((e) => e.action)).toEqual(["ingested", "edited", "approved"]);
    expect(story.version).toBe(3);
    expect(story.texts.tr.title).toBe("A2UI 1.0 aday sürümü yayında");
    expect(story.sources).toHaveLength(1);
    expect(await getStory(db, "f".repeat(32))).toBeNull();
  });
});

describe("approve", () => {
  it("approves: published, human, published_at set, one 'approved' event with the actor", async () => {
    const uid = await seed();
    expect(await approveStory(db, uid, 1, "me@example.com", NOW)).toEqual({ ok: true });
    const s = (await getStory(db, uid))!;
    expect(s).toMatchObject({
      status: "published",
      publish_mode: "human",
      published_at: NOW.toISOString(),
      decided_at: NOW.toISOString(),
      version: 2,
    });
    const ev = await events(uid);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ version: 2, action: "approved", actor: "me@example.com", at: NOW.toISOString() });
  });

  it("refuses to approve a story whose Turkish summary has 321 characters", async () => {
    const make = (len: number) => (s: Json) => (s.texts.tr.summary = "x".repeat(len));
    const bad = await seed({ mutate: make(321) });
    expect(await approveStory(db, bad, 1, "owner", NOW)).toEqual({ ok: false, error: "too_long", detail: "tr.summary" });
    expect((await getStory(db, bad))!.status).toBe("review");
    expect(await events(bad)).toHaveLength(1);
    const ok = await seed({ mutate: make(320) });
    expect(await approveStory(db, ok, 1, "owner", NOW)).toEqual({ ok: true });
  });

  it("reports the first over-long field in the order tr title, summary, dev_line, then en", async () => {
    const uid = await seed({
      mutate: (s) => {
        s.texts.en.title = "x".repeat(91);
        s.texts.tr.dev_line = "x".repeat(201);
      },
    });
    expect(await approveStory(db, uid, 1, "owner", NOW)).toEqual({ ok: false, error: "too_long", detail: "tr.dev_line" });
  });

  it("refuses a stale version and writes no event", async () => {
    const uid = await seed();
    await editStory(db, uid, 1, await patchFrom(uid), "owner", NOW); // now version 2
    const before = await events(uid);
    expect(await approveStory(db, uid, 1, "owner", NOW)).toEqual({ ok: false, error: "conflict" });
    expect(await rejectStory(db, uid, 1, null, "owner", NOW)).toEqual({ ok: false, error: "conflict" });
    expect(await events(uid)).toEqual(before);
    const s = (await getStory(db, uid))!;
    expect(s).toMatchObject({ status: "review", version: 2, decided_at: null });
  });

  it("only one of two simultaneous approvals wins and exactly one event is written", async () => {
    const uid = await seed();
    const results = await Promise.all([
      approveStory(db, uid, 1, "tab-a", NOW),
      approveStory(db, uid, 1, "tab-b", NOW),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "conflict" });
    expect(await events(uid)).toHaveLength(2);
    expect((await getStory(db, uid))!.version).toBe(2);
  });

  it("refuses approve after reject", async () => {
    const uid = await seed();
    expect(await rejectStory(db, uid, 1, "no", "owner", NOW)).toEqual({ ok: true });
    expect(await approveStory(db, uid, 2, "owner", NOW)).toEqual({ ok: false, error: "wrong_status" });
    expect((await getStory(db, uid))!.status).toBe("rejected");
    expect(await events(uid)).toHaveLength(2);
  });

  it("returns not_found for an unknown uid", async () => {
    expect(await approveStory(db, "f".repeat(32), 1, "owner", NOW)).toEqual({ ok: false, error: "not_found" });
  });

  it("expires a story aged exactly 72h on approve", async () => {
    const uid = await seed({ ageMs: 72 * HOUR });
    expect(await approveStory(db, uid, 1, "owner", NOW)).toEqual({ ok: false, error: "expired" });
    const s = (await getStory(db, uid))!;
    expect(s).toMatchObject({ status: "expired", version: 2, decided_at: NOW.toISOString(), published_at: null });
    const ev = await events(uid);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ version: 2, action: "expired", actor: "system" });
  });

  it("expires an over-long story before reporting too_long", async () => {
    const uid = await seed({ ageMs: 80 * HOUR, mutate: (s) => (s.texts.tr.summary = "x".repeat(900)) });
    expect(await approveStory(db, uid, 1, "owner", NOW)).toEqual({ ok: false, error: "expired" });
  });

  it("approves a story aged 71h59m", async () => {
    const uid = await seed({ ageMs: 72 * HOUR - 60_000 });
    expect(await approveStory(db, uid, 1, "owner", NOW)).toEqual({ ok: true });
    expect((await getStory(db, uid))!.status).toBe("published");
  });
});

describe("edit", () => {
  it("edit keeps the status, sets edited, bumps version, stores trimmed text", async () => {
    const uid = await seed();
    const before = (await getStory(db, uid))!;
    const patch = await patchFrom(uid, (p) => {
      p.texts.tr.title = "  Yeni başlık  ";
      p.texts.en.dev_line = "\n new line ";
      p.category = "tooling";
      p.try_url = " https://example.com/try ";
    });
    expect(await editStory(db, uid, 1, patch, "owner", NOW)).toEqual({ ok: true });
    const s = (await getStory(db, uid))!;
    expect(s).toMatchObject({ status: "review", edited: true, version: 2, category: "tooling", decided_at: null });
    expect(s.texts.tr.title).toBe("Yeni başlık");
    expect(s.texts.en.dev_line).toBe("new line");
    expect(s.texts.tr.summary).toBe(before.texts.tr.summary);
    expect(s.fact_card).toEqual({ ...before.fact_card, try_url: "https://example.com/try" });
    const ev = await events(uid);
    expect(ev[1]).toMatchObject({ version: 2, action: "edited", actor: "owner", at: NOW.toISOString() });
  });

  it("edit does not change published_at or publish_mode of a published story", async () => {
    const uid = await seed();
    await approveStory(db, uid, 1, "owner", NOW);
    const later = new Date(NOW.getTime() + HOUR);
    expect(await editStory(db, uid, 2, await patchFrom(uid), "owner", later)).toEqual({ ok: true });
    expect(await getStory(db, uid)).toMatchObject({
      status: "published",
      publish_mode: "human",
      published_at: NOW.toISOString(),
      decided_at: NOW.toISOString(),
      edited: true,
    });
  });

  it("edit refuses an empty title, a 301-character title, a javascript: try_url, an unknown category", async () => {
    const uid = await seed();
    const cases: Array<[(p: EditPatch) => void, Json]> = [
      [(p) => (p.texts.tr.title = "   "), { ok: false, error: "invalid", detail: "tr.title" }],
      [(p) => (p.texts.en.title = "x".repeat(301)), { ok: false, error: "too_long", detail: "en.title" }],
      [(p) => (p.try_url = "javascript:alert(1)"), { ok: false, error: "invalid", detail: "try_url" }],
      [(p) => (p.category = "nope"), { ok: false, error: "invalid", detail: "category" }],
    ];
    for (const [change, expected] of cases) {
      expect(await editStory(db, uid, 1, await patchFrom(uid, change), "owner", NOW)).toEqual(expected);
    }
    expect(await getStory(db, uid)).toMatchObject({ version: 1, edited: false });
    expect(await events(uid)).toHaveLength(1);
  });

  it("edit is refused on rejected and expired stories", async () => {
    const r = await seed();
    await rejectStory(db, r, 1, null, "owner", NOW);
    const e = await seed({ ageMs: 80 * HOUR });
    expect(await expireStale(db, NOW)).toBe(1);
    expect(await editStory(db, r, 2, await patchFrom(r), "owner", NOW)).toEqual({ ok: false, error: "wrong_status" });
    expect(await editStory(db, e, 2, await patchFrom(e), "owner", NOW)).toEqual({ ok: false, error: "wrong_status" });
  });

  it("edit of a published story refuses a 91-character title", async () => {
    const title91 = (p: EditPatch) => (p.texts.tr.title = "x".repeat(91));
    const pub = await seed({ status: "published" });
    expect(await editStory(db, pub, 1, await patchFrom(pub, title91), "owner", NOW)).toEqual({
      ok: false,
      error: "too_long",
      detail: "tr.title",
    });
    const rev = await seed();
    expect(await editStory(db, rev, 1, await patchFrom(rev, title91), "owner", NOW)).toEqual({ ok: true });
  });
});

describe("reject and unpublish", () => {
  it("reject stores a trimmed note, or NULL when empty, and refuses over 500 characters", async () => {
    const a = await seed();
    const b = await seed();
    const c = await seed();
    expect(await rejectStory(db, a, 1, "  not relevant ", "owner", NOW)).toEqual({ ok: true });
    expect(await rejectStory(db, b, 1, "   ", "owner", NOW)).toEqual({ ok: true });
    expect((await events(a))[1]).toMatchObject({ action: "rejected", note: "not relevant" });
    expect((await events(b))[1]?.note).toBeNull();
    expect(await rejectStory(db, c, 1, "x".repeat(501), "owner", NOW)).toEqual({
      ok: false,
      error: "invalid",
      detail: "note",
    });
    expect(await rejectStory(db, c, 1, "x".repeat(500), "owner", NOW)).toEqual({ ok: true });
    expect(await getStory(db, a)).toMatchObject({ status: "rejected", decided_at: NOW.toISOString() });
  });

  it("unpublish needs a note, clears published_at, ends in rejected", async () => {
    const uid = await seed();
    await approveStory(db, uid, 1, "owner", NOW);
    for (const note of ["", "   ", "x".repeat(501)]) {
      expect(await unpublishStory(db, uid, 2, note, "owner", NOW)).toEqual({ ok: false, error: "invalid", detail: "note" });
    }
    expect((await getStory(db, uid))!.status).toBe("published");
    const later = new Date(NOW.getTime() + HOUR);
    expect(await unpublishStory(db, uid, 2, " wrong figure ", "owner", later)).toEqual({ ok: true });
    const s = (await getStory(db, uid))!;
    expect(s).toMatchObject({ status: "rejected", published_at: null, version: 3, decided_at: later.toISOString() });
    expect(s.events.at(-1)).toMatchObject({ action: "unpublished", note: "wrong figure" });
  });

  it("unpublish is refused for a story in review", async () => {
    const uid = await seed();
    expect(await unpublishStory(db, uid, 1, "why", "owner", NOW)).toEqual({ ok: false, error: "wrong_status" });
  });
});

describe("expireStale", () => {
  it("expires only review stories aged >= 72h, one event each, and is idempotent", async () => {
    const old1 = await seed({ ageMs: 72 * HOUR });
    const old2 = await seed({ ageMs: 100 * HOUR });
    const fresh = await seed({ ageMs: 72 * HOUR - 1 });
    const pub = await seed({ ageMs: 200 * HOUR, status: "published" });
    expect(await expireStale(db, NOW)).toBe(2);
    expect(await expireStale(db, NOW)).toBe(0);
    expect(await counts(db)).toEqual({ review: 1, published: 1, rejected: 0, expired: 2 });
    for (const uid of [old1, old2]) {
      const ev = await events(uid);
      expect(ev).toHaveLength(2);
      expect(ev[1]).toMatchObject({ action: "expired", actor: "system", version: 2, at: NOW.toISOString() });
      expect(await getStory(db, uid)).toMatchObject({ status: "expired", decided_at: NOW.toISOString() });
    }
    expect((await getStory(db, fresh))!.status).toBe("review");
    expect(await events(pub)).toHaveLength(1);
  });
});
