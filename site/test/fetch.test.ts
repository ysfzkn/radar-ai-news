import { describe, expect, it } from "vitest";
import { fetchAllStories } from "../scripts/fetch-stories.mjs";

const story = (n: number) => ({
  uid: n.toString(16).padStart(32, "0"),
  category: "tooling",
  publish_mode: "auto",
  edited: false,
  source_count: 1,
  source_url: "https://example.com/post",
  sources: [],
  try_url: null,
  created_at: "2026-11-20T05:00:00.000Z",
  published_at: "2026-11-20T05:00:00.000Z",
  texts: { en: { title: `T${n}`, summary: "s", dev_line: "d" } },
});

const reply = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

const base = "https://api.example.com";

describe("fetchAllStories", () => {
  it("follows next cursors and returns every story once", async () => {
    const urls: string[] = [];
    const pages: Record<string, { stories: unknown[]; next: string | null }> = {
      first: { stories: [story(1), story(2)], next: "c 1/a" },
      "c 1/a": { stories: [story(3)], next: "c2" },
      c2: { stories: [story(4)], next: null },
    };
    const fake = (url: string) => {
      urls.push(url);
      const cursor = new URL(url).searchParams.get("cursor");
      return reply({ version: 1, ...pages[cursor ?? "first"] });
    };
    const stories = await fetchAllStories(base, fake);
    expect((stories as { uid: string }[]).map((s) => s.uid)).toEqual(
      [1, 2, 3, 4].map((n) => story(n).uid),
    );
    expect(urls).toEqual([
      `${base}/api/stories?limit=200`,
      `${base}/api/stories?limit=200&cursor=${encodeURIComponent("c 1/a")}`,
      `${base}/api/stories?limit=200&cursor=c2`,
    ]);
  });

  it("refuses http:// on a non-local host and a non-URL", async () => {
    const never = () => {
      throw new Error("must not fetch");
    };
    await expect(fetchAllStories("http://api.example.com", never)).rejects.toThrow(/https/);
    await expect(fetchAllStories("ftp://localhost", never)).rejects.toThrow(/https/);
    await expect(fetchAllStories("not a url", never)).rejects.toThrow(/RADAR_API_URL/);
    await expect(fetchAllStories("", never)).rejects.toThrow(/RADAR_API_URL/);
    await expect(fetchAllStories(undefined, never)).rejects.toThrow(/RADAR_API_URL/);
  });

  it("allows http:// on localhost, 127.0.0.1 and [::1]", async () => {
    const fake = () => reply({ version: 1, stories: [], next: null });
    for (const origin of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"]) {
      await expect(fetchAllStories(origin, fake)).resolves.toEqual([]);
    }
  });

  it("throws on a non-200 answer, on a body without `stories`, and after 200 pages", async () => {
    await expect(fetchAllStories(base, () => reply({ error: "no" }, 500))).rejects.toThrow(/500/);
    await expect(fetchAllStories(base, () => reply({ version: 1, next: null }))).rejects.toThrow(
      /stories/,
    );
    await expect(fetchAllStories(base, () => reply({ stories: [], next: 7 }))).rejects.toThrow(
      /next/,
    );
    let calls = 0;
    const endless = () => {
      calls += 1;
      return reply({ version: 1, stories: [], next: `c${calls}` });
    };
    await expect(fetchAllStories(base, endless)).rejects.toThrow(/200/);
    expect(calls).toBe(200);
  });

  it("asks with redirect: 'error' or 'manual'", async () => {
    const seen: unknown[] = [];
    const fake = (_url: string, init?: RequestInit) => {
      seen.push(init?.redirect);
      return reply({ version: 1, stories: [], next: null });
    };
    await fetchAllStories(base, fake);
    expect(["error", "manual"]).toContain(seen[0]);
  });
});
