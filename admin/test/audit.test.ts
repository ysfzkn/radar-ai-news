// A decision and its history row land together or not at all. These tests run against the
// history table as migration 0001 made it (no 'restored' action), as on a database that has not
// had 0002 applied, and against a history row that is already taken.
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import { app } from "../src/index";
import type { IngestStory } from "../src/schema";
import { approveStory, getStory, insertStories, rejectStory, restoreStory } from "../src/stories";

const HOUR = 3600_000;
const ORIGIN = "http://localhost";
const dev = { ...env, DEV_NO_AUTH: "1" };
type Json = Record<string, any>;

const queriesOf = (name: string): string[] => env.TEST_MIGRATIONS.find((m) => m.name.startsWith(name))!.queries;

// Rebuilds story_events as 0001 created it, then puts the current one back afterwards.
beforeAll(async () => {
  const create = queriesOf("0001").find((q) => q.includes("CREATE TABLE story_events"))!;
  await env.DB.batch([env.DB.prepare("DROP TABLE story_events"), env.DB.prepare(create)]);
});
afterAll(async () => {
  await env.DB.prepare("DROP TABLE story_events").run();
  const rebuild = queriesOf("0002").filter((q) => !/INSERT INTO|DROP TABLE/.test(q));
  await env.DB.batch(rebuild.map((q) => env.DB.prepare(q)));
});

let n = 0;
async function seed(): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = (++n).toString(16).padStart(32, "a");
  s.created_at = new Date(Date.now() - 5 * HOUR).toISOString();
  s.status = "review";
  await insertStories(env.DB, [s as IngestStory], new Date());
  return s.uid;
}

const actions = async (uid: string) => (await getStory(env.DB, uid))!.events.map((e) => e.action);

describe("a decision and its history row", () => {
  it("restore without migration 0002 changes nothing and fails at the store", async () => {
    const uid = await seed();
    expect(await rejectStory(env.DB, uid, 1, null, "owner", new Date())).toEqual({ ok: true });
    await expect(restoreStory(env.DB, uid, 2, "owner", new Date())).rejects.toThrow();
    expect(await getStory(env.DB, uid)).toMatchObject({ status: "rejected", version: 2 });
    expect(await actions(uid)).toEqual(["ingested", "rejected"]);
  });

  it("restore without migration 0002 answers with an error page, not a redirect, and changes nothing", async () => {
    const uid = await seed();
    await rejectStory(env.DB, uid, 1, null, "owner", new Date());
    const res = await app.fetch(
      new Request(`${ORIGIN}/admin/stories/${uid}/restore`, {
        method: "POST",
        headers: { Origin: ORIGIN },
        body: new URLSearchParams({ version: "2" }),
      }),
      dev,
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const body = await res.text();
    expect(body).toContain('<p class="notice" role="alert">');
    expect(body).not.toMatch(/D1_ERROR|CHECK constraint|SQLITE/);
    expect(await getStory(env.DB, uid)).toMatchObject({ status: "rejected", version: 2 });
    expect(await actions(uid)).toEqual(["ingested", "rejected"]);
  });

  it("an approval whose history row cannot be written is not applied either", async () => {
    const uid = await seed();
    // A stray row already holds the slot the approval's event would take.
    await env.DB.prepare(
      "INSERT INTO story_events (story_uid, version, action, actor, at) VALUES (?, 2, 'edited', 'x', '2026-01-01T00:00:00Z')",
    )
      .bind(uid)
      .run();
    await expect(approveStory(env.DB, uid, 1, "owner", new Date())).rejects.toThrow();
    expect(await getStory(env.DB, uid)).toMatchObject({ status: "review", version: 1, published_at: null });
  });

  it("a repeated decision with the same version writes no second row and reports the conflict", async () => {
    const uid = await seed();
    expect(await rejectStory(env.DB, uid, 1, null, "owner", new Date())).toEqual({ ok: true });
    expect(await rejectStory(env.DB, uid, 1, null, "owner", new Date())).toEqual({ ok: false, error: "conflict" });
    expect(await actions(uid)).toEqual(["ingested", "rejected"]);
  });
});
