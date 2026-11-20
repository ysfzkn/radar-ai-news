import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "../fixtures/ingest-sample.json";
import { app } from "../src/index";
import { notifySite } from "../src/notify";
import type { IngestStory } from "../src/schema";
import { insertStories } from "../src/stories";

type Json = Record<string, any>;

const HOOK = "https://hooks.example/deploy/test-hook";
const ORIGIN = "http://localhost";
const hooked = { ...env, DEV_NO_AUTH: "1", INGEST_TOKEN: "test-token", SITE_DEPLOY_HOOK: HOOK };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

let n = 0;
async function seed(status: "review" | "published"): Promise<string> {
  const s = structuredClone((sample as Json).stories[0]) as Json;
  s.uid = (++n).toString(16).padStart(32, "e");
  s.status = status;
  s.created_at = new Date(Date.now() - 3600_000).toISOString();
  await insertStories(env.DB, [s as IngestStory], new Date());
  return s.uid;
}

const admin = (path: string, fields: Record<string, string>, e: Json = hooked) =>
  app.fetch(
    new Request(`${ORIGIN}${path}`, { method: "POST", headers: { Origin: ORIGIN }, body: new URLSearchParams(fields) }),
    e,
  );

const editFields = (change: Record<string, string> = {}): Record<string, string> => ({
  version: "1",
  category: "model",
  try_url: "",
  tr_title: "Yeni başlık",
  tr_summary: "Yeni özet.",
  tr_dev_line: "Yeni geliştirici notu.",
  en_title: "New title",
  en_summary: "New summary.",
  en_dev_line: "New developer line.",
  ...change,
});

function ingest(status: "review" | "published", e: Json = hooked, uid = "f".repeat(32)) {
  const body = structuredClone(sample) as Json;
  body.stories[0].uid = uid;
  body.stories[0].status = status;
  return app.fetch(
    new Request(`${ORIGIN}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify(body),
    }),
    e,
  );
}

const postedOnce = (): void => {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(HOOK, { method: "POST" });
};

describe("deploy hook", () => {
  it("posts once to the hook after approve, take-down, an edit of a published story and an ingest of a published story", async () => {
    const review = await seed("review");
    expect((await admin(`/admin/stories/${review}/approve`, { ...editFields(), checked: "on" })).status).toBe(303);
    postedOnce();

    fetchMock.mockClear();
    const live = await seed("published");
    expect((await admin(`/admin/stories/${live}/unpublish`, { version: "1", note: "Yanlış" })).status).toBe(303);
    postedOnce();

    fetchMock.mockClear();
    const live2 = await seed("published");
    expect((await admin(`/admin/stories/${live2}/edit`, editFields())).status).toBe(303);
    postedOnce();

    fetchMock.mockClear();
    expect((await ingest("published")).status).toBe(200);
    postedOnce();
  });

  it("does not post after an edit of a review story, a reject or an ingest of review stories only", async () => {
    const review = await seed("review");
    expect((await admin(`/admin/stories/${review}/edit`, editFields())).status).toBe(303);
    const other = await seed("review");
    expect((await admin(`/admin/stories/${other}/reject`, { version: "1", note: "" })).status).toBe(303);
    expect((await ingest("review")).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not post after an approve that fails or an ingest of a duplicate published story", async () => {
    const review = await seed("review");
    expect((await admin(`/admin/stories/${review}/approve`, { version: "1" })).status).toBe(400);
    expect((await admin(`/admin/stories/${review}/approve`, { version: "9", checked: "on" })).status).toBe(409);
    expect((await ingest("published")).status).toBe(200);
    fetchMock.mockClear();
    expect((await ingest("published")).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the hook is unset, is http:// or is not a URL", async () => {
    for (const hook of [undefined, "", "http://hooks.example/deploy", "not a url", "ftp://hooks.example/x"]) {
      notifySite({ ...env, SITE_DEPLOY_HOOK: hook }, (p) => void p);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    const uid = await seed("review");
    const insecure = { ...hooked, SITE_DEPLOY_HOOK: "http://hooks.example/x" };
    expect((await admin(`/admin/stories/${uid}/approve`, { ...editFields(), checked: "on" }, insecure)).status).toBe(303);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hands the request to the wait function and logs nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const waited: Promise<unknown>[] = [];
    notifySite({ ...env, SITE_DEPLOY_HOOK: HOOK }, (p) => waited.push(p));
    expect(waited).toHaveLength(1);
    expect(await waited[0]).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
  });

  it("a failing hook does not fail the request", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const uid = await seed("review");
    const res = await admin(`/admin/stories/${uid}/approve`, { ...editFields(), checked: "on" });
    expect(res.status).toBe(303);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
