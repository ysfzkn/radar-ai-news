import { Hono } from "hono";
import type { Env } from "./env";
import { MAX_BODY_BYTES, ingestRequest } from "./schema";
import { insertStories } from "./stories";

export const ingest = new Hono<{ Bindings: Env }>();

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

// Hash both sides so the comparison is over equal-length digests, then compare
// every byte without stopping early.
async function tokenMatches(presented: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// Reads at most `limit` bytes; null when the body is larger. Counts the bytes
// actually received, so a missing or lying Content-Length changes nothing.
async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const invalid = (path: string) => Response.json({ error: "invalid", path }, { status: 400 });

ingest.post("/api/ingest", async (c) => {
  const expected = c.env.INGEST_TOKEN;
  const header = c.req.header("authorization") ?? "";
  const presented = /^Bearer (.+)$/.exec(header)?.[1] ?? "";
  // Compare even when nothing usable was sent, so timing does not tell the cases apart.
  const matches = await tokenMatches(presented, expected || "");
  if (!expected || !presented || !matches) {
    return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return c.json({ error: "unsupported_media_type" }, 415);

  const bytes = await readLimited(c.req.raw, MAX_BODY_BYTES);
  if (!bytes) return c.json({ error: "too_large" }, 413);

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return invalid("");
  }

  const parsed = ingestRequest.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = (issue?.path ?? []).map(String);
    if (issue?.code === "unrecognized_keys" && issue.keys[0] !== undefined) path.push(issue.keys[0]);
    return invalid(path.join("."));
  }

  return c.json(await insertStories(c.env.DB, parsed.data.stories, new Date()));
});
