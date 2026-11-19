import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import worker from "../src/index";
import type { IngestStory } from "../src/schema";
import { getStory, insertStories } from "../src/stories";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const HOUR = 3600_000;
type Json = Record<string, any>;

async function seed(uid: string, ageMs: number): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = uid;
  s.created_at = new Date(NOW.getTime() - ageMs).toISOString();
  await insertStories(env.DB, [s as IngestStory], NOW);
  return uid;
}

describe("scheduled", () => {
  it("the scheduled handler expires stale review stories", async () => {
    const stale = await seed("a".repeat(32), 73 * HOUR);
    const fresh = await seed("b".repeat(32), 2 * HOUR);
    const controller = createScheduledController({ scheduledTime: NOW });
    await worker.scheduled(controller, env, {} as ExecutionContext);
    expect((await getStory(env.DB, stale))!.status).toBe("expired");
    expect((await getStory(env.DB, fresh))!.status).toBe("review");
  });
});
