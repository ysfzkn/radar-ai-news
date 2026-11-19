import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const insertStory = (uid: string, status: string) =>
  env.DB.prepare(
    `INSERT INTO stories (uid, category, status, score, fact_card, source_url, source_count, created_at, received_at)
     VALUES (?, 'models', ?, '{}', '{}', 'https://example.com', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  )
    .bind(uid, status)
    .run();

const insertEvent = (uid: string, version: number) =>
  env.DB.prepare(
    `INSERT INTO story_events (story_uid, version, action, actor, at)
     VALUES (?, ?, 'ingested', 'agent', '2026-01-01T00:00:00.000Z')`,
  )
    .bind(uid, version)
    .run();

describe("schema", () => {
  it("rejects an unknown status", async () => {
    await expect(insertStory("s-bad", "draft")).rejects.toThrow();
  });

  it("allows one event per story version", async () => {
    await insertStory("s-1", "review");
    await insertEvent("s-1", 1);
    await expect(insertEvent("s-1", 1)).rejects.toThrow();
    await insertEvent("s-1", 2);
  });

  it("starts each test with an empty database", async () => {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM stories").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
