import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import { app } from "../src/index";
import type { IngestStory } from "../src/schema";
import { insertStories, listPublished, publishedPageSql } from "../src/stories";

type Json = Record<string, any>;

const get = (path: string, init?: RequestInit) => app.fetch(new Request(`http://localhost${path}`, init), env);

let n = 0;
// Inserts one story created and ingested at `at`, so a published one gets `at` as published_at.
async function seed(status: string, at = "2026-11-20T05:00:00.000Z", uid?: string): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = uid ?? (++n).toString(16).padStart(32, "c");
  s.status = status;
  s.created_at = at;
  await insertStories(env.DB, [s as IngestStory], new Date(at));
  return s.uid;
}

const ids = (body: Json): string[] => body.stories.map((s: Json) => s.uid);

describe("GET /api/stories", () => {
  it("returns only published stories, newest first, with the documented fields and nothing else", async () => {
    await seed("review", "2026-11-20T01:00:00.000Z");
    const old = await seed("published", "2026-11-19T05:00:00.000Z");
    const fresh = await seed("published", "2026-11-20T05:00:00.000Z");
    const rejected = await seed("rejected", "2026-11-20T02:00:00.000Z");
    const expired = await seed("expired", "2026-11-20T03:00:00.000Z");

    const res = await get("/api/stories");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = (await res.json()) as Json;
    expect(Object.keys(body).sort()).toEqual(["next", "stories", "version"]);
    expect(body.version).toBe(1);
    expect(body.next).toBeNull();
    expect(ids(body)).toEqual([fresh, old]);
    expect(ids(body)).not.toContain(rejected);
    expect(ids(body)).not.toContain(expired);

    const story = body.stories[0];
    expect(Object.keys(story).sort()).toEqual(
      [
        "category", "created_at", "edited", "publish_mode", "published_at", "source_count",
        "source_url", "sources", "texts", "try_url", "uid",
      ].sort(),
    );
    expect(story).toMatchObject({
      uid: fresh,
      category: "protocol",
      publish_mode: "auto",
      edited: false,
      source_count: 4,
      source_url: "https://a2ui.org/blog/1-0-rc",
      sources: [{ name: "GitHub Blog", url: "https://github.blog/a2ui-1-0" }],
      try_url: null,
      created_at: "2026-11-20T05:00:00.000Z",
      published_at: "2026-11-20T05:00:00.000Z",
    });
    expect(Object.keys(story.sources[0]).sort()).toEqual(["name", "url"]);
    expect(Object.keys(story.texts).sort()).toEqual(["en", "tr"]);
    expect(Object.keys(story.texts.tr).sort()).toEqual(["dev_line", "summary", "title"]);
    expect(story.texts.tr.title).toBe("A2UI 1.0 aday sürümü yayında");
    expect(JSON.stringify(body)).not.toMatch(/reasons|score|fact_card|events/);
  });

  it("needs no token and sets Cache-Control public, max-age=60", async () => {
    const res = await get("/api/stories");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("pages with limit and cursor, with no story repeated or skipped across two pages", async () => {
    const all: string[] = [];
    for (let i = 0; i < 5; i++) all.push(await seed("published", `2026-11-20T0${i}:00:00.000Z`));
    const expected = [...all].reverse();

    const first = (await (await get("/api/stories?limit=3")).json()) as Json;
    expect(ids(first)).toEqual(expected.slice(0, 3));
    expect(typeof first.next).toBe("string");
    const second = (await (await get(`/api/stories?limit=3&cursor=${encodeURIComponent(first.next)}`)).json()) as Json;
    expect(ids(second)).toEqual(expected.slice(3));
    expect(second.next).toBeNull();
  });

  it("serves a page of 200 with texts for every story", async () => {
    const stories = Array.from({ length: 205 }, (_, i) => {
      const s = structuredClone((sample as Json).stories[0]) as Json;
      s.uid = (i + 1).toString(16).padStart(32, "d");
      s.status = "published";
      s.created_at = new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString();
      return s as IngestStory;
    });
    await insertStories(env.DB, stories, new Date("2026-11-20T06:00:00.000Z"));
    const body = (await (await get("/api/stories?limit=200")).json()) as Json;
    expect(body.stories).toHaveLength(200);
    expect(body.next).not.toBeNull();
    expect(body.stories.every((s: Json) => s.texts.tr && s.texts.en)).toBe(true);
  });

  it("orders two stories with the same published_at by uid", async () => {
    const b = await seed("published", "2026-11-20T05:00:00.000Z", "b".repeat(32));
    const a = await seed("published", "2026-11-20T05:00:00.000Z", "a".repeat(32));
    const page1 = (await (await get("/api/stories?limit=1")).json()) as Json;
    expect(ids(page1)).toEqual([a]);
    const page2 = (await (await get(`/api/stories?limit=1&cursor=${encodeURIComponent(page1.next)}`)).json()) as Json;
    expect(ids(page2)).toEqual([b]);
    expect(page2.next).toBeNull();
  });

  it("rejects limit=0, limit=201, limit=abc and a cursor that does not parse with 400", async () => {
    const cursors = [
      "garbage",
      `2026-11-20~${"a".repeat(32)}`,
      `2026-11-20T05:00:00Z~${"a".repeat(32)}`,
      `2026-11-20T05:00:00.000Z~${"A".repeat(32)}`,
      "2026-11-20T05:00:00.000Z~abc",
      `2026-13-40T05:00:00.000Z~${"a".repeat(32)}`,
    ];
    const paths = [
      "/api/stories?limit=0",
      "/api/stories?limit=201",
      "/api/stories?limit=abc",
      "/api/stories?limit=1.5",
      ...cursors.map((c) => `/api/stories?cursor=${encodeURIComponent(c)}`),
    ];
    for (const path of paths) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid" });
    }
  });

  it("trims texts, drops a source with a non-http url and nulls a non-http try_url", async () => {
    const uid = await seed("published");
    await env.DB.batch([
      env.DB
        .prepare("UPDATE stories SET sources = ?, fact_card = ? WHERE uid = ?")
        .bind(
          JSON.stringify([
            { name: "Good", url: "https://good.example/a", tier: 1 },
            { name: "Bad", url: "javascript:alert(1)", tier: 2 },
          ]),
          JSON.stringify({ try_url: "javascript:alert(1)" }),
          uid,
        ),
      env.DB
        .prepare("UPDATE story_texts SET title = ?, summary = ?, dev_line = ? WHERE story_uid = ? AND lang = 'tr'")
        .bind("  Başlık \n", " Özet ", "\tNot  ", uid),
    ]);
    const story = ((await (await get("/api/stories")).json()) as Json).stories[0];
    expect(story.sources).toEqual([{ name: "Good", url: "https://good.example/a" }]);
    expect(story.try_url).toBeNull();
    expect(story.texts.tr).toEqual({ title: "Başlık", summary: "Özet", dev_line: "Not" });

    await env.DB
      .prepare("UPDATE stories SET fact_card = ?, publish_mode = NULL WHERE uid = ?")
      .bind(JSON.stringify({ try_url: "https://try.example/x" }), uid)
      .run();
    const again = ((await (await get("/api/stories")).json()) as Json).stories[0];
    expect(again.try_url).toBe("https://try.example/x");
    expect(again.publish_mode).toBe("auto");
  });

  it("keeps one malformed stored row from breaking the feed", async () => {
    const good = await seed("published", "2026-11-20T05:00:00.000Z");
    const badSources = await seed("published", "2026-11-20T04:00:00.000Z");
    const badCard = await seed("published", "2026-11-20T03:00:00.000Z");
    const oddShapes = await seed("published", "2026-11-20T02:00:00.000Z");
    const nullCard = await seed("published", "2026-11-20T01:00:00.000Z");
    await env.DB.batch([
      env.DB.prepare("UPDATE stories SET sources = 'not json' WHERE uid = ?").bind(badSources),
      env.DB.prepare("UPDATE stories SET fact_card = 'not json' WHERE uid = ?").bind(badCard),
      env.DB
        .prepare("UPDATE stories SET sources = ?, fact_card = ? WHERE uid = ?")
        .bind(JSON.stringify([null, "x", 5, { name: "Ok", url: "https://ok.example/" }]), '"text"', oddShapes),
      env.DB.prepare("UPDATE stories SET sources = ?, fact_card = 'null' WHERE uid = ?").bind('{"a":1}', nullCard),
    ]);
    const res = await get("/api/stories");
    expect(res.status).toBe(200);
    const byUid = new Map<string, Json>((((await res.json()) as Json).stories as Json[]).map((s) => [s.uid, s]));
    expect(byUid.size).toBe(5);
    expect(byUid.get(good)!.sources).toHaveLength(1);
    expect(byUid.get(badSources)).toMatchObject({ sources: [] });
    expect(byUid.get(badCard)).toMatchObject({ try_url: null });
    expect(byUid.get(badCard)!.sources).toHaveLength(1);
    expect(byUid.get(oddShapes)).toMatchObject({ sources: [{ name: "Ok", url: "https://ok.example/" }], try_url: null });
    expect(byUid.get(nullCard)).toMatchObject({ sources: [], try_url: null });
  });

  it("leaves out a language whose text row is missing", async () => {
    const uid = await seed("published");
    await env.DB.prepare("DELETE FROM story_texts WHERE story_uid = ? AND lang = 'en'").bind(uid).run();
    const story = ((await (await get("/api/stories")).json()) as Json).stories[0];
    expect(Object.keys(story.texts)).toEqual(["tr"]);
  });

  it("keeps a source count of 0, drops nameless sources and leaves out a language with a blank text", async () => {
    const uid = await seed("published");
    await env.DB.batch([
      env.DB
        .prepare("UPDATE stories SET source_count = 0, sources = ? WHERE uid = ?")
        .bind(
          JSON.stringify([
            { name: "", url: "https://empty.example/", tier: 1 },
            { name: "  ", url: "https://blank.example/", tier: 1 },
            { name: " Named ", url: "https://named.example/", tier: 2 },
          ]),
          uid,
        ),
      env.DB.prepare("UPDATE story_texts SET title = ' \n ' WHERE story_uid = ? AND lang = 'tr'").bind(uid),
    ]);
    const story = ((await (await get("/api/stories")).json()) as Json).stories[0];
    expect(story.uid).toBe(uid);
    expect(story.source_count).toBe(0);
    expect(story.sources).toEqual([{ name: "Named", url: "https://named.example/" }]);
    expect(Object.keys(story.texts)).toEqual(["en"]);
  });

  it("leaves out a story with no usable language and pages across it without a repeat or a gap", async () => {
    const newer = await seed("published", "2026-11-20T05:00:00.000Z");
    const blank = await seed("published", "2026-11-20T04:00:00.000Z");
    const older = await seed("published", "2026-11-20T03:00:00.000Z");
    await env.DB.batch([
      env.DB.prepare("UPDATE story_texts SET title = '   ' WHERE story_uid = ? AND lang = 'tr'").bind(blank),
      env.DB.prepare("UPDATE story_texts SET dev_line = '\t' WHERE story_uid = ? AND lang = 'en'").bind(blank),
    ]);
    expect(ids((await (await get("/api/stories")).json()) as Json)).toEqual([newer, older]);

    for (const limit of [1, 2]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const query: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
        const body = (await (await get(`/api/stories?limit=${limit}${query}`)).json()) as Json;
        seen.push(...ids(body));
        cursor = body.next;
        if (cursor === null) break;
      }
      expect(cursor, `limit=${limit}`).toBeNull();
      expect(seen, `limit=${limit}`).toEqual([newer, older]);
    }
  });

  it("a story taken down is gone from the next response", async () => {
    const uid = await seed("published");
    expect(ids((await (await get("/api/stories")).json()) as Json)).toEqual([uid]);
    const res = await app.fetch(
      new Request(`http://localhost/admin/stories/${uid}/unpublish`, {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: new URLSearchParams({ version: "1", note: "Yanlış" }),
      }),
      { ...env, DEV_NO_AUTH: "1" },
    );
    expect(res.status).toBe(303);
    expect(ids((await (await get("/api/stories")).json()) as Json)).toEqual([]);
  });

  it("returns an empty list and next null on an empty database", async () => {
    const res = await get("/api/stories");
    expect(await res.json()).toEqual({ version: 1, stories: [], next: null });
  });

  it("does not answer other methods", async () => {
    const res = await get("/api/stories", { method: "POST" });
    expect([404, 405]).toContain(res.status);
  });

  it("listPublished uses at most two queries however many stories it returns", async () => {
    for (let i = 0; i < 3; i++) await seed("published", `2026-11-20T0${i}:00:00.000Z`);
    const calls: string[] = [];
    const spy = new Proxy(env.DB, {
      get(target, prop) {
        const value = (target as any)[prop];
        if (prop === "prepare" || prop === "batch") {
          return (...args: unknown[]) => (calls.push(String(prop)), value.apply(target, args));
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const out = await listPublished(spy as D1Database, 100, null);
    expect(out.stories).toHaveLength(3);
    // One SELECT for the stories, then at most one batch (one query) for the texts.
    expect(calls.filter((c) => c === "batch").length).toBeLessThanOrEqual(1);
    expect(calls.filter((c) => c === "prepare").length).toBeLessThanOrEqual(2);
  });
});

describe("the public feed's index", () => {
  // The planner's answer for the exact statement listPublished runs, with and without a cursor.
  const plan = async (cursor: boolean): Promise<string[]> => {
    const binds = cursor ? ["2026-11-20T05:00:00.000Z", "2026-11-20T05:00:00.000Z", "a".repeat(32), 51] : [51];
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${publishedPageSql(cursor)}`)
      .bind(...binds)
      .all<{ detail: string }>();
    return results.map((r) => r.detail);
  };

  it("reads published rows through idx_stories_status_published in feed order, with no sort step", async () => {
    for (const cursor of [false, true]) {
      const details = await plan(cursor);
      expect(details.join(" | ")).toMatch(/USING INDEX idx_stories_status_published/);
      expect(details.join(" | ")).not.toMatch(/TEMP B-TREE/);
    }
  });
});
