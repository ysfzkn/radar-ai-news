import { Hono } from "hono";
import type { Env } from "./env";
import { listPublished, type PublicCursor } from "./stories";

export const publicApi = new Hono<{ Bindings: Env }>();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

// The cursor is `published_at~uid`: an ISO timestamp that survives a round trip through
// toISOString(), then 32 lowercase hex characters.
function parseCursor(raw: string): PublicCursor | null {
  const m = /^(.+)~([0-9a-f]{32})$/.exec(raw);
  const at = m?.[1];
  const uid = m?.[2];
  if (!at || !uid) return null;
  const time = Date.parse(at);
  if (Number.isNaN(time) || new Date(time).toISOString() !== at) return null;
  return { published_at: at, uid };
}

const invalid = () => Response.json({ error: "invalid" }, { status: 400 });

publicApi.get("/api/stories", async (c) => {
  const rawLimit = c.req.query("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    if (!/^[0-9]{1,3}$/.test(rawLimit)) return invalid();
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_LIMIT) return invalid();
  }
  const rawCursor = c.req.query("cursor");
  let cursor: PublicCursor | null = null;
  if (rawCursor !== undefined) {
    cursor = parseCursor(rawCursor);
    if (!cursor) return invalid();
  }
  const { stories, next } = await listPublished(c.env.DB, limit, cursor);
  return c.json({ version: 1, stories, next: next ? `${next.published_at}~${next.uid}` : null }, 200, {
    "Cache-Control": "public, max-age=60",
    "X-Content-Type-Options": "nosniff",
  });
});
