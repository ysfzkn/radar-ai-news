import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import sample from "../fixtures/ingest-sample.json";

const TOKEN = "test-token";
const testEnv = { ...env, INGEST_TOKEN: TOKEN };

type Json = Record<string, any>;
const clone = (): Json => structuredClone(sample) as Json;

function post(body: unknown, opts: { token?: string | null; env?: any; type?: string | null; raw?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.type !== null) headers["content-type"] = opts.type ?? "application/json";
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return app.fetch(
    new Request("http://localhost/api/ingest", {
      method: "POST",
      headers,
      body: opts.raw ?? JSON.stringify(body),
    }),
    opts.env ?? testEnv,
  );
}

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe("ingest", () => {
  it("accepts the shared fixture and stores story, both texts and an 'ingested' event", async () => {
    const res = await post(sample);
    expect(res.status).toBe(200);
    const uid = (sample as Json).stories[0].uid;
    expect(await res.json()).toEqual({ accepted: [uid], duplicates: [] });

    const story = await env.DB.prepare("SELECT * FROM stories WHERE uid = ?").bind(uid).first<Json>();
    expect(story).toMatchObject({
      status: "review",
      publish_mode: null,
      published_at: null,
      version: 1,
      edited: 0,
      category: "protocol",
      source_count: 4,
      created_at: "2026-11-19T12:00:00.000Z",
    });
    expect(story!.received_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(JSON.parse(story!.score).total).toBe(4.4);
    expect(JSON.parse(story!.fact_card).who).toEqual(["Google"]);

    const texts = await env.DB.prepare("SELECT lang, title FROM story_texts WHERE story_uid = ? ORDER BY lang")
      .bind(uid)
      .all<Json>();
    expect(texts.results.map((r) => r.lang)).toEqual(["en", "tr"]);
    const event = await env.DB.prepare("SELECT * FROM story_events WHERE story_uid = ?").bind(uid).first<Json>();
    expect(event).toMatchObject({ version: 1, action: "ingested", actor: "agent", at: story!.received_at });
  });

  it("stores an auto-published story with publish_mode 'auto' and published_at = created_at", async () => {
    const body = clone();
    body.stories[0].status = "published";
    expect((await post(body)).status).toBe(200);
    const story = await env.DB.prepare("SELECT * FROM stories").first<Json>();
    expect(story).toMatchObject({ status: "published", publish_mode: "auto", published_at: story!.created_at });
  });

  it("normalises created_at to toISOString form", async () => {
    const body = clone();
    body.stories[0].created_at = "2026-11-19T12:00:00+00:00";
    await post(body);
    const story = await env.DB.prepare("SELECT created_at FROM stories").first<Json>();
    expect(story!.created_at).toBe("2026-11-19T12:00:00.000Z");
  });

  it("reports a known uid as duplicate and changes nothing", async () => {
    const uid = (sample as Json).stories[0].uid;
    await post(sample);
    await env.DB.prepare("UPDATE stories SET source_count = 99 WHERE uid = ?").bind(uid).run();
    await env.DB.prepare("UPDATE story_texts SET title = 'edited' WHERE story_uid = ?").bind(uid).run();
    const res = await post(sample);
    expect(await res.json()).toEqual({ accepted: [], duplicates: [uid] });
    const story = await env.DB.prepare("SELECT source_count FROM stories").first<Json>();
    expect(story!.source_count).toBe(99);
    const t = await env.DB.prepare("SELECT title FROM story_texts WHERE lang = 'en'").first<Json>();
    expect(t!.title).toBe("edited");
    expect(await count("story_events")).toBe(1);
    expect(await count("story_texts")).toBe(2);
  });

  it("treats a repeated uid within one request as a duplicate", async () => {
    const body = clone();
    body.stories.push(structuredClone(body.stories[0]));
    const res = await post(body);
    const uid = body.stories[0].uid;
    expect(await res.json()).toEqual({ accepted: [uid], duplicates: [uid] });
    expect(await count("stories")).toBe(1);
    expect(await count("story_texts")).toBe(2);
  });

  it("is all-or-nothing", async () => {
    const body = clone();
    const second = structuredClone(body.stories[0]);
    second.uid = "f".repeat(32);
    second.texts.tr.title = "";
    body.stories.push(second);
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", path: "stories.1.texts.tr.title" });
    expect(await count("stories")).toBe(0);
    expect(await count("story_texts")).toBe(0);
    expect(await count("story_events")).toBe(0);
  });

  it.each([
    ["javascript:alert(1)", "source_url"],
    ["javascript:alert(1)", "fact_card.try_url"],
    ["data:text/html,x", "sources.0.url"],
  ])("rejects a non-http URL in %s", async (url, field) => {
    const body = clone();
    const parts = field.split(".");
    let target: any = body.stories[0];
    for (const p of parts.slice(0, -1)) target = target[/^\d+$/.test(p) ? Number(p) : p];
    target[parts.at(-1)!] = url;
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", path: `stories.0.${field}` });
    expect(await count("stories")).toBe(0);
  });

  it("rejects an unknown key", async () => {
    const body = clone();
    body.stories[0].extra = 1;
    expect((await post(body)).status).toBe(400);
    const top = { ...clone(), extra: 1 };
    expect((await post(top)).status).toBe(400);
  });

  it("rejects an empty title, 21 stories, a status of 'rejected', a created_at two days ahead", async () => {
    const empty = clone();
    empty.stories[0].texts.en.title = "";
    expect((await post(empty)).status).toBe(400);

    const many = clone();
    many.stories = Array.from({ length: 21 }, (_, i) => ({
      ...structuredClone(many.stories[0]),
      uid: i.toString(16).padStart(32, "0"),
    }));
    expect((await post(many)).status).toBe(400);

    const rejected = clone();
    rejected.stories[0].status = "rejected";
    expect((await post(rejected)).status).toBe(400);

    const future = clone();
    future.stories[0].created_at = new Date(Date.now() + 2 * 86400_000).toISOString();
    const res = await post(future);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", path: "stories.0.created_at" });
    expect(await count("stories")).toBe(0);
  });

  it("rejects bad uid, category, scores and limits", async () => {
    const cases: Array<[string, (s: Json) => void]> = [
      ["stories.0.uid", (s) => (s.uid = "ABC")],
      ["stories.0.category", (s) => (s.category = "models")],
      ["stories.0.score.relevance", (s) => (s.score.relevance = 6)],
      ["stories.0.score.novelty", (s) => (s.score.novelty = 1.5)],
      ["stories.0.score.total", (s) => (s.score.total = 5.5)],
      ["stories.0.score.risk_flags.0", (s) => (s.score.risk_flags = ["nope"])],
      ["stories.0.sources.0.tier", (s) => (s.sources[0].tier = 5)],
      ["stories.0.sources", (s) => (s.sources = [])],
      ["stories.0.texts.en.title", (s) => (s.texts.en.title = "x".repeat(301))],
      ["stories.0.created_at", (s) => (s.created_at = "not a date")],
    ];
    for (const [path, mutate] of cases) {
      const body = clone();
      mutate(body.stories[0]);
      const res = await post(body);
      expect(res.status, path).toBe(400);
      expect(await res.json(), path).toEqual({ error: "invalid", path });
    }
  });

  it("answers 400 with an empty path for a body that is not JSON", async () => {
    const res = await post(null, { raw: "{nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", path: "" });
  });

  it("answers 401 without a token and with a wrong token of the same length", async () => {
    expect((await post(sample, { token: null })).status).toBe(401);
    expect((await post(sample, { token: "test-tokex" })).status).toBe(401);
    expect(await count("stories")).toBe(0);
  });

  it("answers 401 when INGEST_TOKEN is not configured", async () => {
    for (const token of [undefined, ""]) {
      const e = { ...env, INGEST_TOKEN: token };
      expect((await post(sample, { env: e, token: "" })).status).toBe(401);
      expect((await post(sample, { env: e, token: "anything" })).status).toBe(401);
    }
    expect(await count("stories")).toBe(0);
  });

  it("answers 413 for a body over 256 KB and 415 for text/plain", async () => {
    const big = await post(null, { raw: "x".repeat(256 * 1024 + 1) });
    expect(big.status).toBe(413);
    expect((await post(sample, { type: "text/plain" })).status).toBe(415);
    expect((await post(sample, { type: null })).status).toBe(415);
  });
});
