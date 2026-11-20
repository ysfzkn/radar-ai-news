import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchAllStories, refreshStoriesFile } from "../scripts/fetch-stories.mjs";

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

describe("refreshStoriesFile", () => {
  // A stale file from an earlier fetch, in a fresh temporary folder.
  const withStaleFile = async (run: (file: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), "radar-fetch-"));
    try {
      const file = join(dir, ".data", "stories.json");
      mkdirSync(join(dir, ".data"));
      writeFileSync(file, JSON.stringify({ stories: [story(9)] }));
      await run(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("removes an existing file when the fetch fails", async () => {
    await withStaleFile(async (file) => {
      await expect(refreshStoriesFile(file, base, () => reply({ error: "no" }, 500))).rejects.toThrow(
        /500/,
      );
      expect(existsSync(file)).toBe(false);
    });
  });

  it("replaces an existing file when the fetch succeeds", async () => {
    await withStaleFile(async (file) => {
      const fake = () => reply({ version: 1, stories: [story(1), story(2)], next: null });
      await expect(refreshStoriesFile(file, base, fake)).resolves.toBe(2);
      const written = JSON.parse(readFileSync(file, "utf8"));
      expect(written).toEqual({ stories: [story(1), story(2)] });
    });
  });

  it("creates the folder when there is no file yet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "radar-fetch-"));
    try {
      const file = join(dir, ".data", "stories.json");
      const fake = () => reply({ version: 1, stories: [], next: null });
      await expect(refreshStoriesFile(file, base, fake)).resolves.toBe(0);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ stories: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
