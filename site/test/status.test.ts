import { describe, expect, it } from "vitest";
import { siteStatus } from "../src/lib/status";
import type { PublicStory } from "../src/lib/schema";

function story(n: number, date: string, lang: "tr" | "en" | "both", urls: string[], main = urls[0] ?? "https://example.com/a"): PublicStory {
  const text = { title: `t${n}`, summary: "s", dev_line: "d" };
  return {
    uid: n.toString(16).padStart(32, "0"),
    category: "model",
    publish_mode: "auto",
    edited: false,
    source_count: urls.length,
    source_url: main,
    sources: urls.map((url, i) => ({ name: `S${i}`, url })),
    try_url: null,
    created_at: `${date}T09:00:00.000Z`,
    published_at: `${date}T09:00:00.000Z`,
    texts: lang === "both" ? { tr: text, en: text } : { [lang]: text },
  };
}

describe("siteStatus", () => {
  it("names the newest edition, every story of the language and the distinct source hosts", () => {
    const stories = [
      story(1, "2026-11-19", "both", ["https://www.example.com/a", "https://blog.other.org/x"]),
      story(2, "2026-11-20", "both", ["https://example.com/b"]),
      story(3, "2026-11-20", "tr", ["https://third.dev/c"], "https://fourth.io/z"),
    ];
    expect(siteStatus(stories, "tr")).toEqual({ issue: 2, date: "2026-11-20", stories: 3, sources: 4 });
    expect(siteStatus(stories, "en")).toEqual({ issue: 2, date: "2026-11-20", stories: 2, sources: 2 });
  });

  it("is null when the language has no story", () => {
    expect(siteStatus([], "tr")).toBeNull();
    expect(siteStatus([story(1, "2026-11-20", "tr", [])], "en")).toBeNull();
  });
});
