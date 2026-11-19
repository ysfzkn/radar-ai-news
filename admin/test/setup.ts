import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

// The pool gives each test file its own storage, but not each test: tests in one
// file share D1. Apply the schema once per file, then empty the tables before
// every test so no test sees another's rows.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM story_events"),
    env.DB.prepare("DELETE FROM story_texts"),
    env.DB.prepare("DELETE FROM stories"),
  ]);
});
