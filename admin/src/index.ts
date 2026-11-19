import { Hono } from "hono";
import type { Env } from "./env";

export const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.text("ok"));

// Hourly cron (see wrangler.jsonc). Expiry of old reviews arrives in a later task.
async function scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {}

export default { fetch: app.fetch, scheduled };
